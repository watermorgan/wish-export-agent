from __future__ import annotations

import io
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
import os

import pdfplumber
from pypdf import PdfReader, PdfWriter, Transformation
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont


PANEL_WIDTH = 248
PAGE_PADDING = 18
BOX_PADDING = 10
BOX_GAP = 10
MARKER_COLOR = colors.HexColor("#ef4444")
COLUMN_GAP = 8
DENSE_PAGE_NOTE_THRESHOLD = 18
DENSE_ROW_TOLERANCE = 8.0
DENSE_ROW_MAX_ITEMS = 3
DENSE_ROW_MAX_SOURCE_CHARS = 100
INLINE_NOTE_MAX_WIDTH = 188
INLINE_NOTE_MIN_WIDTH = 76
INLINE_NOTE_MAX_SHIFT = 120
INLINE_NOTE_WIDE_SOURCE_THRESHOLD = 150
INLINE_NOTE_TALL_SOURCE_THRESHOLD = 48
MARKER_FONT_SIZE = 10
USE_INLINE_NOTES = os.environ.get("FEEDBACK_RENDER_INLINE_NOTES") == "1"
USE_DENSE_INLINE_NOTES = os.environ.get("FEEDBACK_RENDER_DENSE_INLINE_NOTES") == "1"


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().lower()


def tokenize(value: str) -> list[str]:
    return [token for token in re.split(r"[^a-z0-9]+", normalize_text(value)) if len(token) > 2]


def tokenize_loose(value: str) -> list[str]:
    return [token for token in re.split(r"[^a-z0-9]+", normalize_text(value)) if token]


def clean_translation(value: str) -> str:
    text = (value or "").strip()
    match = re.search(r"\[译文\]\s*(.*)$", text)
    if match:
      return match.group(1).strip()

    if "->" in text:
      return text.split("->", 1)[-1].replace("[译文]", "").strip()

    return text


def normalize_compact(value: str) -> str:
    return re.sub(r"[\s\-_:/]+", "", value or "").strip().lower()


def is_code_like(value: str) -> bool:
    text = (value or "").strip()
    if not text or len(text) < 4:
        return False
    return bool(re.fullmatch(r"[A-Z0-9][A-Z0-9\s./_-]{3,}", text)) and bool(re.search(r"\d", text))


def should_skip_render(source: str, translation: str) -> bool:
    if not source or not translation:
        return True
    normalized_source = normalize_text(source)
    if re.search(r"^hiver\b", normalized_source):
        return True
    if re.search(r"^en attente\b", normalized_source):
        return True
    if normalized_source == "dossier style":
        return True
    if re.search(r"rights reserved|edited on|all rights reserved|tous droits réservés", source, re.I):
        return True
    if re.search(r"^\s*fitting\s*/\s*volume\s*$", normalized_source):
        return True
    if re.search(r"\bsize\b.*\bbase\b.*\bm\d{5,}\b", normalized_source):
        return True
    if re.search(r"^\s*common designated size\s*$", normalized_source):
        return True
    compact_source = normalize_compact(source)
    compact_translation = normalize_compact(translation)
    if compact_source and compact_source == compact_translation:
        return True
    if is_code_like(source) and compact_source in compact_translation:
        return True
    return False


def draw_note_marker(pdf: canvas.Canvas, x: float, y: float, label: str) -> None:
    padding_x = 3
    padding_y = 2
    text_width = pdfmetrics.stringWidth(label, "Helvetica-Bold", MARKER_FONT_SIZE)
    box_width = text_width + padding_x * 2
    box_height = MARKER_FONT_SIZE + padding_y * 2
    pdf.setFillColor(colors.white)
    pdf.setStrokeColor(colors.HexColor("#fca5a5"))
    pdf.roundRect(x, y - 2, box_width, box_height, 4, fill=1, stroke=1)
    pdf.setFillColor(MARKER_COLOR)
    pdf.setFont("Helvetica-Bold", MARKER_FONT_SIZE)
    pdf.drawString(x + padding_x, y + padding_y, label)


def load_structured_translation(response_path: Path) -> dict:
    payload = json.loads(response_path.read_text(encoding="utf-8"))
    for artifact in payload.get("artifacts", []):
        for field in artifact.get("fields", []):
            if isinstance(field, dict) and "structuredData" in field:
                structured = field["structuredData"]
                if (
                    isinstance(structured, dict)
                    and structured.get("version") == "translation_snapshot_v1"
                    and isinstance(structured.get("items"), list)
                ):
                    return structured
                raise RuntimeError(
                    "response.json structuredData is not a translation_snapshot_v1 payload. "
                    "Please rerun translation to generate a fresh snapshot."
                )
    raise RuntimeError("response.json does not contain translation snapshot structuredData.")


def locate_note_bbox(words: list[dict], source: str) -> dict | None:
    source_tokens = tokenize_loose(source)
    if not source_tokens:
        return None

    flattened_tokens: list[tuple[str, int]] = []
    for word_index, word in enumerate(words):
        for token in tokenize_loose(word.get("text", "")):
            flattened_tokens.append((token, word_index))

    word_tokens = [token for token, _ in flattened_tokens]
    best_match = None
    best_score = 0

    for start in range(len(word_tokens)):
        if word_tokens[start] != source_tokens[0]:
            continue

        matched_indexes = []
        source_index = 0
        cursor = start

        while cursor < len(word_tokens) and source_index < len(source_tokens):
            if word_tokens[cursor] == source_tokens[source_index]:
                matched_indexes.append(cursor)
                source_index += 1
            elif matched_indexes:
                break
            cursor += 1

        score = source_index
        if score > best_score and matched_indexes:
            best_score = score
            best_match = matched_indexes

        if best_score == len(source_tokens):
            break

    if not best_match:
        return None

    matched_word_indexes = []
    for token_index in best_match:
        word_index = flattened_tokens[token_index][1]
        if word_index not in matched_word_indexes:
            matched_word_indexes.append(word_index)

    matched_words = [words[index] for index in matched_word_indexes]
    return {
        "x0": min(word["x0"] for word in matched_words),
        "x1": max(word["x1"] for word in matched_words),
        "top": min(word["top"] for word in matched_words),
        "bottom": max(word["bottom"] for word in matched_words),
    }


def build_page_assignment(input_pdf: Path, structured: dict) -> tuple[dict[int, list[dict]], list[dict]]:
    segments: list[dict] = []
    for item in structured.get("items", []):
        source = str(item.get("en", "")).strip()
        translation = clean_translation(str(item.get("zh", "")))
        if should_skip_render(source, translation):
            continue
        segments.append(
            {
                "source": source,
                "translation": translation,
                "page_number": item.get("pageNumber"),
                "region_id": item.get("regionId"),
                "source_type": item.get("sourceType"),
                "render_mode": item.get("renderMode"),
                "confidence": item.get("confidence"),
                "bbox": (
                    {
                        "x0": item["bbox"]["x"],
                        "x1": item["bbox"]["x"] + item["bbox"]["w"],
                        "top": item["bbox"]["y"],
                        "bottom": item["bbox"]["y"] + item["bbox"]["h"],
                    }
                    if isinstance(item.get("bbox"), dict)
                    and all(key in item["bbox"] for key in ("x", "y", "w", "h"))
                    else None
                ),
            }
        )

    page_notes: dict[int, list[dict]] = defaultdict(list)
    unassigned: list[dict] = []
    page_words: dict[int, list[dict]] = {}
    page_sizes: dict[int, tuple[float, float]] = {}

    with pdfplumber.open(str(input_pdf)) as pdf:
        page_texts = [normalize_text(page.extract_text() or "") for page in pdf.pages]
        for page_index, page in enumerate(pdf.pages, start=1):
            page_sizes[page_index] = (float(page.width), float(page.height))
            page_words[page_index] = page.extract_words(
                x_tolerance=2,
                y_tolerance=3,
                keep_blank_chars=False,
                use_text_flow=True,
            )

    for item in segments:
        source = item["source"]
        normalized_source = normalize_text(source)
        tokens = tokenize(source)[:10]
        hinted_page = item.get("page_number")

        if hinted_page and item.get("bbox"):
            page_width, page_height = page_sizes.get(int(hinted_page), (0.0, 0.0))
            bbox = item["bbox"]
            max_edge = max(bbox["x1"], bbox["bottom"])
            if page_width and page_height and max_edge <= 1005:
                item["bbox"] = {
                    "x0": bbox["x0"] / 1000 * page_width,
                    "x1": bbox["x1"] / 1000 * page_width,
                    "top": bbox["top"] / 1000 * page_height,
                    "bottom": bbox["bottom"] / 1000 * page_height,
                }
            page_notes[int(hinted_page)].append(item)
            continue

        best_score = 0
        best_page = None

        for page_index, page_text in enumerate(page_texts, start=1):
            if hinted_page and page_index != hinted_page:
                continue
            if normalized_source and normalized_source in page_text:
                score = len(normalized_source) + 100
            else:
                score = sum(1 for token in tokens if token in page_text)

            if score > best_score:
                best_score = score
                best_page = page_index

        if best_page is None or best_score == 0:
            unassigned.append(item)
        else:
            item["bbox"] = locate_note_bbox(page_words.get(best_page, []), source)
            page_notes[best_page].append(item)

    note_number = 1
    for page_number in sorted(page_notes.keys()):
        for item in page_notes[page_number]:
            item["note_number"] = note_number
            note_number += 1

    return dict(page_notes), unassigned


def shorten_text(value: str, max_chars: int) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    if len(text) <= max_chars:
        return text
    return text[: max(0, max_chars - 1)].rstrip() + "…"


def clone_note(note: dict) -> dict:
    return {key: value for key, value in note.items()}


def rects_overlap(a: dict, b: dict, padding: float = 4.0) -> bool:
    return not (
        a["x1"] + padding <= b["x0"]
        or b["x1"] + padding <= a["x0"]
        or a["bottom"] + padding <= b["top"]
        or b["bottom"] + padding <= a["top"]
    )


def choose_inline_note_width(page_width: float, bbox: dict, translation: str) -> float:
    bbox_width = max(0.0, bbox["x1"] - bbox["x0"])
    if bbox_width >= INLINE_NOTE_WIDE_SOURCE_THRESHOLD:
        desired = min(
            max(INLINE_NOTE_MAX_WIDTH, bbox_width - 18),
            max(INLINE_NOTE_MIN_WIDTH, bbox_width - 14),
        )
    else:
        desired = min(
            INLINE_NOTE_MAX_WIDTH,
            max(INLINE_NOTE_MIN_WIDTH, pdfmetrics.stringWidth(translation, "STSong-Light", 11.2) + 8),
        )
    remaining_right = page_width - bbox["x1"] - PAGE_PADDING - 8
    if remaining_right >= desired:
        return desired
    remaining_left = bbox["x0"] - PAGE_PADDING - 8
    if remaining_left >= desired:
        return desired
    return max(INLINE_NOTE_MIN_WIDTH, min(desired, page_width * 0.2))


def choose_inline_note_candidate(page_width: float, bbox: dict, note_width: float) -> list[tuple[float, float]]:
    wide_source = (bbox["x1"] - bbox["x0"]) >= 72
    candidates: list[tuple[float, float]] = []

    if wide_source:
        candidates.append((min(page_width - PAGE_PADDING - note_width, bbox["x0"] + 10), bbox["bottom"] + 6))
        candidates.append((min(page_width - PAGE_PADDING - note_width, bbox["x0"] + 24), max(PAGE_PADDING, bbox["top"] - 12)))

    candidates.append((min(page_width - PAGE_PADDING - note_width, bbox["x1"] + 8), max(PAGE_PADDING, bbox["top"] - 2)))
    candidates.append((max(PAGE_PADDING, bbox["x0"] - note_width - 8), max(PAGE_PADDING, bbox["top"] - 2)))
    candidates.append((min(page_width - PAGE_PADDING - note_width, bbox["x0"] + 12), bbox["bottom"] + 10))

    deduped: list[tuple[float, float]] = []
    seen: set[tuple[int, int]] = set()
    for x, top in candidates:
        key = (round(x), round(top))
        if key in seen:
            continue
        seen.add(key)
        deduped.append((x, top))
    return deduped


def choose_inline_note_chars(note_width: float, bbox: dict) -> int:
    bbox_width = max(0.0, bbox["x1"] - bbox["x0"])
    bbox_height = max(0.0, bbox["bottom"] - bbox["top"])
    if bbox_width >= 220 or bbox_height >= 72:
        return 72
    if bbox_width >= 160 or bbox_height >= 48 or note_width >= 200:
        return 56
    if bbox_width >= 110 or note_width >= 140:
        return 46
    return 38


def build_inline_note_layout(
    page_width: float,
    page_height: float,
    notes: list[dict],
    translation_style: ParagraphStyle,
) -> tuple[list[dict], list[dict]]:
    placed: list[dict] = []
    overflow: list[dict] = []

    ordered_notes = sorted(
        [note for note in notes if note.get("bbox") and note.get("translation")],
        key=lambda note: (note["bbox"]["top"], note["bbox"]["x0"]),
    )

    for note in ordered_notes:
        bbox = note["bbox"]
        translation = shorten_text(
            note["translation"],
            choose_inline_note_chars(
                choose_inline_note_width(page_width, bbox, note["translation"]),
                bbox,
            ),
        )
        note_width = choose_inline_note_width(page_width, bbox, translation)
        para = Paragraph(translation, translation_style)
        _, note_height = para.wrap(note_width, 1000)
        note_height += 2
        placed_rect = None

        for candidate_x, candidate_top in choose_inline_note_candidate(page_width, bbox, note_width):
            for shift in range(0, INLINE_NOTE_MAX_SHIFT + 1, 12):
                top = candidate_top + shift
                if top + note_height > page_height - PAGE_PADDING:
                    break

                rect = {
                    "x0": max(PAGE_PADDING, min(candidate_x, page_width - PAGE_PADDING - note_width)),
                    "x1": max(PAGE_PADDING, min(candidate_x, page_width - PAGE_PADDING - note_width)) + note_width,
                    "top": top,
                    "bottom": top + note_height,
                }

                if any(rects_overlap(rect, item["_rect"]) for item in placed):
                    continue
                if rects_overlap(rect, bbox, padding=2.0):
                    continue

                placed_rect = rect
                break

            if placed_rect:
                break

        if not placed_rect:
            overflow.append(note)
            continue

        placed.append(
            {
                **note,
                "_inline_text": translation,
                "_inline_para": para,
                "_rect": placed_rect,
            }
        )

    return placed, overflow


def fit_notes_single_page(page_height: float, notes: list[dict], base_styles: dict) -> tuple[list[dict], dict]:
    available_height = page_height - PAGE_PADDING * 2 - 28
    modes = [
        {"columns": 1, "source_chars": 64, "translation_chars": 64, "source_size": 7.0, "translation_size": 8.8, "source_leading": 8.2, "translation_leading": 10.4},
        {"columns": 1, "source_chars": 48, "translation_chars": 52, "source_size": 6.6, "translation_size": 8.0, "source_leading": 7.6, "translation_leading": 9.2},
        {"columns": 2, "source_chars": 34, "translation_chars": 34, "source_size": 6.2, "translation_size": 7.2, "source_leading": 7.0, "translation_leading": 8.0},
        {"columns": 2, "source_chars": 26, "translation_chars": 28, "source_size": 5.8, "translation_size": 6.6, "source_leading": 6.6, "translation_leading": 7.4},
    ]

    sample_styles = getSampleStyleSheet()
    fallback_result: tuple[list[dict], dict] | None = None

    for mode in modes:
        source_style = ParagraphStyle(
            "source-fit",
            parent=sample_styles["BodyText"],
            fontName="Helvetica",
            fontSize=mode["source_size"],
            leading=mode["source_leading"],
            textColor=base_styles["source"].textColor,
        )
        translation_style = ParagraphStyle(
            "translation-fit",
            parent=sample_styles["BodyText"],
            fontName="STSong-Light",
            fontSize=mode["translation_size"],
            leading=mode["translation_leading"],
            textColor=base_styles["translation"].textColor,
        )

        columns = mode["columns"]
        inner_panel_width = PANEL_WIDTH - PAGE_PADDING * 2
        column_width = (
            inner_panel_width if columns == 1 else (inner_panel_width - COLUMN_GAP) / 2
        )
        note_box_width = column_width
        note_text_width = note_box_width - BOX_PADDING * 2 - 18
        cloned_notes = [clone_note(note) for note in notes]

        total_height = 0.0
        column_heights = [0.0 for _ in range(columns)]
        for note in cloned_notes:
            note["_source_excerpt"] = shorten_text(note["source"], mode["source_chars"])
            note["_translation_excerpt"] = shorten_text(
                note["translation"], mode["translation_chars"]
            )
            source_para = Paragraph(note["_source_excerpt"], source_style)
            translation_para = Paragraph(note["_translation_excerpt"], translation_style)
            _, source_height = source_para.wrap(note_text_width, 1000)
            _, translation_height = translation_para.wrap(note_text_width, 1000)
            note_height = source_height + translation_height + BOX_PADDING * 2 + 8
            note["_render_height"] = note_height

        for note in cloned_notes:
            target_column = min(range(columns), key=lambda idx: column_heights[idx])
            projected = (
                note["_render_height"]
                if column_heights[target_column] == 0
                else column_heights[target_column] + BOX_GAP + note["_render_height"]
            )
            note["_column"] = target_column
            note["_y_offset"] = column_heights[target_column]
            column_heights[target_column] = projected

        used_height = max(column_heights) if column_heights else 0.0
        result = (
            cloned_notes,
            {
                "source": source_style,
                "translation": translation_style,
                "columns": columns,
                "column_width": column_width,
                "used_height": used_height,
            },
        )
        fallback_result = result
        if used_height <= available_height:
            return result

    return fallback_result if fallback_result else ([], {"source": base_styles["source"], "translation": base_styles["translation"], "columns": 1, "column_width": PANEL_WIDTH - PAGE_PADDING * 2, "used_height": 0.0})


def cluster_notes_by_row(notes: list[dict], tolerance: float = 10.0) -> list[list[dict]]:
    sortable = [note for note in notes if note.get("bbox")]
    sortable.sort(key=lambda item: (item["bbox"]["top"], item["bbox"]["x0"]))

    rows: list[list[dict]] = []
    for note in sortable:
        if not rows:
            rows.append([note])
            continue

        previous_row = rows[-1]
        previous_top = sum(item["bbox"]["top"] for item in previous_row) / len(previous_row)
        if abs(note["bbox"]["top"] - previous_top) <= tolerance:
            previous_row.append(note)
        else:
            rows.append([note])

    for row in rows:
        row.sort(key=lambda item: item["bbox"]["x0"])

    return rows


def format_note_label(note_numbers: list[int]) -> str:
    sorted_numbers = sorted(set(note_numbers))
    if not sorted_numbers:
        return ""

    if len(sorted_numbers) == 1:
        return str(sorted_numbers[0])

    contiguous = sorted_numbers[-1] - sorted_numbers[0] == len(sorted_numbers) - 1
    if contiguous:
        return f"{sorted_numbers[0]}-{sorted_numbers[-1]}"

    if len(sorted_numbers) <= 3:
        return ",".join(str(number) for number in sorted_numbers)

    return f"{sorted_numbers[0]}+{len(sorted_numbers) - 1}"


def split_dense_row(row: list[dict]) -> list[list[dict]]:
    groups: list[list[dict]] = []
    current_group: list[dict] = []
    current_chars = 0

    for note in row:
        source_length = len(re.sub(r"\s+", " ", note.get("source", "")).strip())
        previous = current_group[-1] if current_group else None
        x_gap = 0.0
        if previous and previous.get("bbox") and note.get("bbox"):
            x_gap = note["bbox"]["x0"] - previous["bbox"]["x1"]

        should_split = (
            current_group
            and (
                len(current_group) >= DENSE_ROW_MAX_ITEMS
                or current_chars + source_length > DENSE_ROW_MAX_SOURCE_CHARS
                or x_gap > 140
            )
        )

        if should_split:
            groups.append(current_group)
            current_group = []
            current_chars = 0

        current_group.append(note)
        current_chars += source_length

    if current_group:
        groups.append(current_group)

    return groups


def is_header_like_row(row: list[dict]) -> bool:
    if not row:
        return False

    header_patterns = {
        "fabrics",
        "placement",
        "comment",
        "supplier material code",
        "description",
        "composition type",
        "quantity uom common color",
        "common designated size",
        "supplier",
        "style",
        "only for forecast product colors",
    }

    lowered = [normalize_text(item["source"]) for item in row]
    if sum(1 for item in lowered if item in header_patterns) >= max(3, len(row) // 2):
        return True

    return False


def build_dense_page_rows(notes: list[dict]) -> list[dict]:
    rows = []
    for row in cluster_notes_by_row(notes, tolerance=DENSE_ROW_TOLERANCE):
        if is_header_like_row(row):
            continue

        for group in split_dense_row(row):
            note_numbers = [item["note_number"] for item in group if item.get("note_number")]
            if not note_numbers:
                continue

            source_parts = [item["source"] for item in group if item.get("source")]
            translation_parts = [item["translation"] for item in group if item.get("translation")]
            rows.append(
                {
                    "label": str(min(note_numbers)),
                    "source": " / ".join(source_parts),
                    "translation": "；".join(translation_parts),
                    "bbox": {
                        "x0": min(item["bbox"]["x0"] for item in group),
                        "x1": max(item["bbox"]["x1"] for item in group),
                        "top": min(item["bbox"]["top"] for item in group),
                        "bottom": max(item["bbox"]["bottom"] for item in group),
                    },
                    "note_numbers": note_numbers,
                }
            )

    return rows


def create_dense_marker_overlay(page_width: float, page_height: float, rows: list[dict]) -> PdfReader:
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(page_width, page_height))

    for row in rows:
        bbox = row.get("bbox")
        if not bbox:
            continue

        marker_x = max(6, bbox["x0"] - 14)
        marker_y = min(page_height - 16, page_height - bbox["top"] + 6)
        draw_note_marker(pdf, marker_x, marker_y, row["label"])

    pdf.save()
    buffer.seek(0)
    return PdfReader(buffer)


def score_dense_row_priority(row: dict) -> int:
    source = normalize_text(row.get("source", ""))
    translation = row.get("translation", "").strip()
    if not source:
        return 0

    tokens = [token for token in re.split(r"[^a-z0-9]+", source) if token]
    alpha_tokens = [token for token in tokens if re.search(r"[a-z]", token)]
    numeric_tokens = [token for token in tokens if re.fullmatch(r"[0-9]+(?:mm|cm|pcs|yd)?", token)]

    score = 0
    score += min(len(alpha_tokens), 8) * 3
    score += min(len(translation), 80) // 10

    if any(keyword in source for keyword in ("fabric", "zip", "zipper", "logo", "elastic", "trim", "thread", "pocket", "seam", "packaging", "label", "supplier")):
        score += 6

    if len(alpha_tokens) <= 1:
        score -= 4

    if numeric_tokens and len(numeric_tokens) >= max(1, len(tokens) - 1):
        score -= 5

    if re.fullmatch(r"(0\s*/\s*)+0|0+", source):
        score -= 8

    if re.fullmatch(r"(yd|pcs|mm|cm)(\s*/\s*(yd|pcs|mm|cm))+?", source):
        score -= 6

    return score


def fit_dense_inline_rows(
    page_width: float,
    available_height: float,
    rows: list[dict],
    base_styles: dict,
) -> tuple[list[dict], list[dict], dict] | None:
    if available_height < 120:
        return None

    sample_styles = getSampleStyleSheet()
    usable_width = page_width - PAGE_PADDING * 2
    modes = [
        {"columns": 2, "source_chars": 44, "translation_chars": 56, "source_size": 6.4, "translation_size": 8.0, "source_leading": 7.2, "translation_leading": 9.0},
        {"columns": 3, "source_chars": 34, "translation_chars": 42, "source_size": 6.0, "translation_size": 7.4, "source_leading": 6.8, "translation_leading": 8.2},
        {"columns": 3, "source_chars": 28, "translation_chars": 34, "source_size": 5.7, "translation_size": 6.8, "source_leading": 6.4, "translation_leading": 7.4},
    ]

    best_partial: tuple[list[dict], list[dict], dict] | None = None

    for mode in modes:
        columns = mode["columns"]
        column_width = (usable_width - COLUMN_GAP * (columns - 1)) / columns
        text_width = column_width - BOX_PADDING * 2 - 16
        source_style = ParagraphStyle(
            "dense-inline-source",
            parent=sample_styles["BodyText"],
            fontName="Helvetica",
            fontSize=mode["source_size"],
            leading=mode["source_leading"],
            textColor=colors.HexColor("#64748b"),
        )
        translation_style = ParagraphStyle(
            "dense-inline-translation",
            parent=sample_styles["BodyText"],
            fontName="STSong-Light",
            fontSize=mode["translation_size"],
            leading=mode["translation_leading"],
            textColor=base_styles["translation"].textColor,
        )

        original_rows = [{**row, "_original_index": index} for index, row in enumerate(rows)]
        prioritized_rows = sorted(
            original_rows,
            key=lambda row: (
                -score_dense_row_priority(row),
                row.get("bbox", {}).get("top", 10_000),
                row.get("_original_index", 0),
            ),
        )
        column_heights = [0.0 for _ in range(columns)]
        fitted_rows: list[dict] = []
        overflow_rows: list[dict] = []

        for row in prioritized_rows:
            if score_dense_row_priority(row) <= 0:
                overflow_rows.append(row)
                continue

            row["_source_excerpt"] = shorten_text(row["source"], mode["source_chars"])
            row["_translation_excerpt"] = shorten_text(row["translation"], mode["translation_chars"])
            source_para = Paragraph(row["_source_excerpt"], source_style)
            translation_para = Paragraph(row["_translation_excerpt"], translation_style)
            _, source_height = source_para.wrap(text_width, 1000)
            _, translation_height = translation_para.wrap(text_width, 1000)
            row_height = source_height + translation_height + BOX_PADDING * 2 + 4
            row["_render_height"] = row_height

            target_column = min(range(columns), key=lambda idx: column_heights[idx])
            projected = (
                row_height
                if column_heights[target_column] == 0
                else column_heights[target_column] + BOX_GAP + row_height
            )

            if projected > available_height:
                overflow_rows.append(row)
                continue

            row["_column"] = target_column
            row["_y_offset"] = column_heights[target_column]
            column_heights[target_column] = projected
            fitted_rows.append(row)

        used_height = max(column_heights) if column_heights else 0.0
        if fitted_rows:
            fitted_rows.sort(key=lambda row: (row["_column"], row.get("bbox", {}).get("top", 10_000), row.get("_original_index", 0)))
            overflow_rows.sort(key=lambda row: (row.get("bbox", {}).get("top", 10_000), row.get("_original_index", 0)))
            result = (
                fitted_rows,
                overflow_rows,
                {
                    "columns": columns,
                    "column_width": column_width,
                    "source": source_style,
                    "translation": translation_style,
                    "used_height": used_height,
                },
            )
            if not overflow_rows:
                return result

            if best_partial is None or len(fitted_rows) > len(best_partial[0]):
                best_partial = result

    return best_partial


def create_dense_inline_overlay(
    page_width: float,
    page_height: float,
    rows: list[dict],
    styles: dict,
) -> tuple[PdfReader | None, list[dict]]:
    if not rows:
        return None, []

    content_bottom = max((row.get("bbox", {}).get("bottom", 0) for row in rows), default=0)
    available_height = page_height - content_bottom - PAGE_PADDING * 2
    fitted = fit_dense_inline_rows(page_width, available_height, rows, styles)
    if not fitted:
        return None, rows

    fitted_rows, overflow_rows, layout = fitted
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(page_width, page_height))

    for row in fitted_rows:
        bbox = row.get("bbox")
        if not bbox:
            continue

        marker_x = max(6, bbox["x0"] - 14)
        marker_y = min(page_height - 16, page_height - bbox["top"] + 6)
        draw_note_marker(pdf, marker_x, marker_y, row["label"])

    band_y = PAGE_PADDING - 6
    band_height = layout["used_height"] + 22
    pdf.setFillColor(colors.HexColor("#f8fbff"))
    pdf.roundRect(
        PAGE_PADDING - 6,
        band_y,
        page_width - (PAGE_PADDING - 6) * 2,
        band_height,
        12,
        fill=1,
        stroke=0,
    )

    pdf.setFillColor(colors.HexColor("#1f4f86"))
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(PAGE_PADDING, PAGE_PADDING + layout["used_height"] + 4, "CN Notes")

    top_y = PAGE_PADDING + layout["used_height"]
    for row in fitted_rows:
        x = PAGE_PADDING + row["_column"] * (layout["column_width"] + COLUMN_GAP)
        y = top_y - row["_y_offset"] - row["_render_height"]

        pdf.setFillColor(colors.white)
        pdf.setStrokeColor(colors.HexColor("#d4e3f4"))
        pdf.roundRect(x, y, layout["column_width"], row["_render_height"], 8, fill=1, stroke=1)

        pdf.setFillColor(MARKER_COLOR)
        pdf.setFont("Helvetica-Bold", 13)
        pdf.drawString(x + 6, y + row["_render_height"] - 15, row["label"])

        source_para = Paragraph(row["_source_excerpt"], layout["source"])
        translation_para = Paragraph(row["_translation_excerpt"], layout["translation"])
        inner_x = x + BOX_PADDING + 14
        inner_y = y + row["_render_height"] - BOX_PADDING
        text_width = layout["column_width"] - BOX_PADDING * 2 - 16
        _, source_height = source_para.wrap(text_width, row["_render_height"])
        source_para.drawOn(pdf, inner_x, inner_y - source_height)
        _, translation_height = translation_para.wrap(text_width, row["_render_height"])
        translation_para.drawOn(pdf, inner_x, inner_y - source_height - 4 - translation_height)

    pdf.save()
    buffer.seek(0)
    return PdfReader(buffer), overflow_rows


def create_overlay_page(page_width: float, page_height: float, page_number: int, notes: list[dict], styles: dict) -> PdfReader:
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(page_width + PANEL_WIDTH, page_height))

    panel_x = page_width
    pdf.setFillColor(colors.HexColor("#f6f8fb"))
    pdf.rect(panel_x, 0, PANEL_WIDTH, page_height, fill=1, stroke=0)

    pdf.setStrokeColor(colors.HexColor("#d6dfeb"))
    pdf.line(panel_x, 0, panel_x, page_height)

    pdf.setFillColor(colors.HexColor("#1f4f86"))
    pdf.setFont("Helvetica-Bold", 12)
    title = f"CN Notes · Page {page_number}"
    pdf.drawString(panel_x + PAGE_PADDING, page_height - PAGE_PADDING - 2, title)

    fitted_notes, layout = fit_notes_single_page(page_height, notes, styles)
    top_y = page_height - PAGE_PADDING - 28

    for note in fitted_notes:
        bbox = note.get("bbox")
        if not bbox:
            continue

        marker_x = max(6, bbox["x0"] - 14)
        marker_y = min(page_height - 16, page_height - bbox["top"] + 6)
        draw_note_marker(pdf, marker_x, marker_y, str(note["note_number"]))

    for note in fitted_notes:
        note_height = note["_render_height"]
        column = note.get("_column", 0)
        x = panel_x + PAGE_PADDING + column * (layout["column_width"] + COLUMN_GAP)
        y = top_y - note["_y_offset"] - note_height

        pdf.setFillColor(colors.white)
        pdf.setStrokeColor(colors.HexColor("#d4e3f4"))
        pdf.roundRect(
            x,
            y,
            layout["column_width"],
            note_height,
            10,
            fill=1,
            stroke=1,
        )

        source_para = Paragraph(note["_source_excerpt"], layout["source"])
        translation_para = Paragraph(note["_translation_excerpt"], layout["translation"])

        pdf.setFillColor(MARKER_COLOR)
        pdf.setFont("Helvetica-Bold", 18 if layout["columns"] == 1 else 16)
        pdf.drawString(x + 4, y + note_height - 22, str(note["note_number"]))

        inner_x = x + BOX_PADDING + 18
        inner_y = y + note_height - BOX_PADDING

        note_width = layout["column_width"] - BOX_PADDING * 2 - 18
        _, source_height = source_para.wrap(note_width, note_height)
        source_para.drawOn(pdf, inner_x, inner_y - source_height)

        _, translation_height = translation_para.wrap(note_width, note_height)
        translation_para.drawOn(pdf, inner_x, inner_y - source_height - 6 - translation_height)

    pdf.save()
    buffer.seek(0)
    return PdfReader(buffer)


def create_inline_note_overlay(
    page_width: float,
    page_height: float,
    notes: list[dict],
    styles: dict,
) -> tuple[PdfReader | None, list[dict]]:
    if not notes:
        return None, []

    inline_translation_style = ParagraphStyle(
        "inline-translation",
        parent=styles["translation"],
        fontSize=11.2,
        leading=13.2,
        textColor=colors.HexColor("#0a6fd6"),
    )

    placed, overflow = build_inline_note_layout(
        page_width,
        page_height,
        notes,
        inline_translation_style,
    )
    if not placed:
        return None, notes

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(page_width, page_height))

    for note in placed:
        bbox = note["bbox"]
        rect = note["_rect"]
        anchor_y = page_height - ((bbox["top"] + bbox["bottom"]) / 2)
        text_y = page_height - rect["top"] - 1
        anchor_x = bbox["x1"] if rect["x0"] >= bbox["x1"] else bbox["x0"]
        if rect["x0"] > bbox["x1"]:
            line_end_x = rect["x0"] - 4
        elif rect["x1"] < bbox["x0"]:
            line_end_x = rect["x1"] + 4
        else:
            line_end_x = rect["x0"] + 2

        pdf.setStrokeColor(colors.HexColor("#9ac5f5"))
        pdf.setLineWidth(0.8)
        pdf.line(anchor_x, anchor_y, line_end_x, text_y - 2)

        pdf.setFillColor(colors.white)
        pdf.setStrokeColor(colors.white)
        pdf.roundRect(
            rect["x0"] - 2,
            page_height - rect["bottom"] - 1,
            rect["x1"] - rect["x0"] + 4,
            rect["bottom"] - rect["top"] + 2,
            4,
            fill=1,
            stroke=0,
        )

        note["_inline_para"].drawOn(
            pdf,
            rect["x0"],
            page_height - rect["bottom"],
        )

    pdf.save()
    buffer.seek(0)
    return PdfReader(buffer), overflow


def create_dense_review_pages(page_width: float, page_height: float, page_number: int, notes: list[dict], styles: dict) -> list[PdfReader]:
    rows = build_dense_page_rows(notes)
    if not rows:
        return []

    buffer_pages: list[PdfReader] = []
    page_size = (page_width + PANEL_WIDTH, page_height)
    content_x = PAGE_PADDING
    content_width = page_size[0] - PAGE_PADDING * 2
    usable_height = page_height - PAGE_PADDING * 2 - 40

    row_source_style = ParagraphStyle(
        "row-source",
        parent=styles["source"],
        fontSize=7.0,
        leading=8.0,
        textColor=colors.HexColor("#64748b"),
    )
    row_translation_style = ParagraphStyle(
        "row-translation",
        parent=styles["translation"],
        fontSize=8.8,
        leading=10.5,
        textColor=colors.HexColor("#1f4f86"),
    )

    current_rows: list[dict] = []
    current_height = 0.0
    prepared_rows: list[dict] = []
    for row in rows:
        source_text = shorten_text(row["source"], 88)
        translation_text = shorten_text(row["translation"], 112)
        source_para = Paragraph(source_text, row_source_style)
        translation_para = Paragraph(translation_text, row_translation_style)
        _, source_height = source_para.wrap(content_width - 36, 2000)
        _, translation_height = translation_para.wrap(content_width - 36, 2000)
        render_height = source_height + translation_height + 18

        row_copy = {**row, "_source_excerpt": source_text, "_translation_excerpt": translation_text, "_height": render_height}
        projected = render_height if not current_rows else current_height + BOX_GAP + render_height
        if current_rows and projected > usable_height:
            prepared_rows.append(current_rows)
            current_rows = []
            current_height = 0.0

        current_rows.append(row_copy)
        current_height = render_height if current_height == 0 else current_height + BOX_GAP + render_height

    if current_rows:
        prepared_rows.append(current_rows)

    for page_index, page_rows in enumerate(prepared_rows, start=1):
        buffer = io.BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=page_size)
        pdf.setFillColor(colors.white)
        pdf.rect(0, 0, page_size[0], page_size[1], fill=1, stroke=0)

        pdf.setFillColor(colors.HexColor("#1f4f86"))
        pdf.setFont("Helvetica-Bold", 14)
        title = f"CN Review · Page {page_number}"
        if page_index > 1:
            title += f" ({page_index})"
        pdf.drawString(PAGE_PADDING, page_height - PAGE_PADDING - 4, title)

        y = page_height - PAGE_PADDING - 34
        for row in page_rows:
            height = row["_height"]
            y -= height
            pdf.setFillColor(colors.HexColor("#ffffff"))
            pdf.setStrokeColor(colors.HexColor("#d4e3f4"))
            pdf.roundRect(content_x, y, content_width, height, 10, fill=1, stroke=1)

            pdf.setFillColor(MARKER_COLOR)
            pdf.setFont("Helvetica-Bold", 14)
            pdf.drawString(content_x + 8, y + height - 16, row["label"])

            source_para = Paragraph(row["_source_excerpt"], row_source_style)
            translation_para = Paragraph(row["_translation_excerpt"], row_translation_style)
            inner_x = content_x + 34
            inner_y = y + height - 10
            _, source_height = source_para.wrap(content_width - 48, height)
            source_para.drawOn(pdf, inner_x, inner_y - source_height)
            _, translation_height = translation_para.wrap(content_width - 48, height)
            translation_para.drawOn(pdf, inner_x, inner_y - source_height - 6 - translation_height)
            y -= BOX_GAP

        pdf.save()
        buffer.seek(0)
        buffer_pages.append(PdfReader(buffer))

    return buffer_pages


def render_pdf(input_pdf: Path, response_json: Path, output_pdf: Path) -> None:
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))

    structured = load_structured_translation(response_json)
    page_notes, unassigned = build_page_assignment(input_pdf, structured)

    styles = getSampleStyleSheet()
    source_style = ParagraphStyle(
        "source",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9.2,
        textColor=colors.HexColor("#5f6b7a"),
    )
    translation_style = ParagraphStyle(
        "translation",
        parent=styles["BodyText"],
        fontName="STSong-Light",
        fontSize=9.2,
        leading=11.5,
        textColor=colors.HexColor("#1f4f86"),
    )
    render_styles = {"source": source_style, "translation": translation_style}

    reader = PdfReader(str(input_pdf))
    writer = PdfWriter()

    for page_number, page in enumerate(reader.pages, start=1):
        notes_for_page = page_notes.get(page_number, [])
        dense_page = len(notes_for_page) > DENSE_PAGE_NOTE_THRESHOLD

        if dense_page:
            dense_rows = build_dense_page_rows(notes_for_page)
            new_page = writer.add_blank_page(
                width=float(page.mediabox.width),
                height=float(page.mediabox.height),
            )
            new_page.merge_transformed_page(page, Transformation().translate(0, 0))
            if USE_DENSE_INLINE_NOTES:
                inline_overlay, overflow_rows = create_dense_inline_overlay(
                    float(page.mediabox.width),
                    float(page.mediabox.height),
                    dense_rows,
                    render_styles,
                )
                if inline_overlay:
                    new_page.merge_page(inline_overlay.pages[0])
                if overflow_rows:
                    marker_overlay = create_dense_marker_overlay(
                        float(page.mediabox.width),
                        float(page.mediabox.height),
                        overflow_rows,
                    )
                    if not inline_overlay:
                        new_page.merge_page(marker_overlay.pages[0])
                    for review_page in create_dense_review_pages(
                        float(page.mediabox.width),
                        float(page.mediabox.height),
                        page_number,
                        [note for note in notes_for_page if note.get("note_number") in {num for row in overflow_rows for num in row.get("note_numbers", [])}],
                        render_styles,
                    ):
                        writer.add_page(review_page.pages[0])
            else:
                if dense_rows:
                    marker_overlay = create_dense_marker_overlay(
                        float(page.mediabox.width),
                        float(page.mediabox.height),
                        dense_rows,
                    )
                    new_page.merge_page(marker_overlay.pages[0])
                    for review_page in create_dense_review_pages(
                        float(page.mediabox.width),
                        float(page.mediabox.height),
                        page_number,
                        notes_for_page,
                        render_styles,
                    ):
                        writer.add_page(review_page.pages[0])
            continue

        if USE_INLINE_NOTES:
            inline_overlay, inline_overflow = create_inline_note_overlay(
                float(page.mediabox.width),
                float(page.mediabox.height),
                notes_for_page,
                render_styles,
            )
            if inline_overlay:
                new_page = writer.add_blank_page(
                    width=float(page.mediabox.width),
                    height=float(page.mediabox.height),
                )
                new_page.merge_transformed_page(page, Transformation().translate(0, 0))
                new_page.merge_page(inline_overlay.pages[0])
                if inline_overflow:
                    overflow_page = writer.add_blank_page(
                        width=float(page.mediabox.width) + PANEL_WIDTH,
                        height=float(page.mediabox.height),
                    )
                    overflow_page.merge_transformed_page(page, Transformation().translate(0, 0))
                    overlay_reader = create_overlay_page(
                        float(page.mediabox.width),
                        float(page.mediabox.height),
                        page_number,
                        inline_overflow,
                        render_styles,
                    )
                    overflow_page.merge_page(overlay_reader.pages[0])
                continue

        new_page = writer.add_blank_page(
            width=float(page.mediabox.width) + PANEL_WIDTH,
            height=float(page.mediabox.height),
        )
        new_page.merge_transformed_page(page, Transformation().translate(0, 0))
        overlay_reader = create_overlay_page(
            float(page.mediabox.width),
            float(page.mediabox.height),
            page_number,
            notes_for_page,
            render_styles,
        )
        new_page.merge_page(overlay_reader.pages[0])

    if unassigned and os.environ.get("FEEDBACK_RENDER_INCLUDE_UNASSIGNED") == "1":
        appendix_buffer = io.BytesIO()
        appendix_pdf = canvas.Canvas(appendix_buffer, pagesize=(842, 595))
        appendix_pdf.setFillColor(colors.HexColor("#0f172a"))
        appendix_pdf.setFont("Helvetica-Bold", 16)
        appendix_pdf.drawString(40, 555, "Unassigned Notes")
        appendix_pdf.setFillColor(colors.HexColor("#334155"))
        appendix_pdf.setFont("Helvetica", 9)
        y = 525
        for item in unassigned[:20]:
            line = f"- {item['source'][:72]} => {item['translation'][:72]}"
            appendix_pdf.drawString(40, y, line)
            y -= 18
            if y < 40:
                appendix_pdf.showPage()
                y = 555
        appendix_pdf.save()
        appendix_buffer.seek(0)
        appendix_reader = PdfReader(appendix_buffer)
        for page in appendix_reader.pages:
            writer.add_page(page)

    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    with output_pdf.open("wb") as handle:
        writer.write(handle)


def main() -> int:
    if len(sys.argv) != 4:
        print("Usage: python3 scripts/render_feedback_pdf.py <input.pdf> <response.json> <output.pdf>")
        return 1

    input_pdf = Path(sys.argv[1]).resolve()
    response_json = Path(sys.argv[2]).resolve()
    output_pdf = Path(sys.argv[3]).resolve()

    render_pdf(input_pdf, response_json, output_pdf)
    print(str(output_pdf))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
