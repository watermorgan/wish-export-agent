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


def _load_layout_config() -> dict:
    """Load layout parameters from config/layout-config.json (relative to repo root).
    Falls back silently to empty dict so callers use their hardcoded defaults."""
    config_path = Path(__file__).parent.parent / "config" / "layout-config.json"
    try:
        return json.loads(config_path.read_text(encoding="utf-8")).get("global", {})
    except Exception:
        return {}


def _cfg(key: str, default):
    """Read a global layout config value, falling back to the given default."""
    return _LAYOUT_CONFIG.get(key, default)


_LAYOUT_CONFIG = _load_layout_config()

PANEL_WIDTH = _cfg("panelWidth", 340)
PAGE_PADDING = _cfg("pagePadding", 18)
BOX_PADDING = _cfg("boxPadding", 10)
BOX_GAP = _cfg("boxGap", 10)
MARKER_COLOR = colors.HexColor("#ef4444")
COLUMN_GAP = _cfg("columnGap", 8)
DENSE_PAGE_NOTE_THRESHOLD = _cfg("densePageNoteThreshold", 18)
DENSE_PAGE_CROWDED_THRESHOLD = _cfg("crowdedThreshold", 14)
DENSE_ROW_TOLERANCE = _cfg("denseRowTolerance", 8.0)
DENSE_ROW_MAX_ITEMS = _cfg("denseRowMaxItems", 3)
DENSE_ROW_MAX_SOURCE_CHARS = _cfg("denseRowMaxSourceChars", 100)
INLINE_NOTE_MAX_WIDTH = _cfg("inlineNoteMaxWidth", 188)
INLINE_NOTE_MIN_WIDTH = _cfg("inlineNoteMinWidth", 76)
INLINE_NOTE_MAX_SHIFT = _cfg("inlineNoteMaxShift", 120)
INLINE_NOTE_SCAN_STEP = _cfg("inlineNoteScanStep", 12)
INLINE_NOTE_WIDE_SOURCE_THRESHOLD = _cfg("inlineNoteWideSourceThreshold", 150)
INLINE_NOTE_TALL_SOURCE_THRESHOLD = _cfg("inlineNoteTallSourceThreshold", 48)
INLINE_NOTE_SKETCH_MAX_WIDTH = _cfg("inlineNoteSketchMaxWidth", 124)
INLINE_NOTE_SKETCH_MIN_WIDTH = _cfg("inlineNoteSketchMinWidth", 64)
MARKER_FONT_SIZE = _cfg("markerFontSize", 10)
USE_INLINE_NOTES = os.environ.get("FEEDBACK_RENDER_INLINE_NOTES", "1") != "0"
USE_DENSE_INLINE_NOTES = os.environ.get("FEEDBACK_RENDER_DENSE_INLINE_NOTES") == "1"
USE_SMART_PLACEMENT = os.environ.get("FEEDBACK_RENDER_SMART_PLACEMENT", "1") != "0"

# Smart placement configuration
SMART_PLACEMENT_ENABLED = _cfg("smartPlacementEnabled", True)
TABLE_COMMENT_HEADERS = _cfg("tableCommentHeaders", ["comment", "notes", "备注", "说明", "description"])
INLINE_MIN_FREE_SPACE = _cfg("inlineMinFreeSpace", 20)
INLINE_FONT_BY_SPACE = _cfg("inlineFontBySpace", {"60": 7.0, "40": 6.0, "20": 5.0})
INLINE_MAX_VERTICAL_SHIFT = _cfg("inlineMaxVerticalShift", 24)
BOTTOM_ZONE_MIN_HEIGHT = _cfg("bottomZoneMinHeight", 50)
BOTTOM_ZONE_FONT_SIZE = _cfg("bottomZoneFontSize", 7.0)
BOTTOM_ZONE_COLUMNS = _cfg("bottomZoneColumns", 2)
COLLISION_PADDING = _cfg("collisionPadding", 1)

# Page-level unified render mode thresholds.
# When a page has more notes or more total translation characters than these thresholds,
# the entire page uses panel (right-side CN Notes) mode instead of inline (beside English).
PAGE_INLINE_MAX_NOTES = _cfg("pageInlineMaxNotes", 8)
PAGE_INLINE_MAX_TOTAL_CHARS = _cfg("pageInlineMaxTotalChars", 200)
PAGE_INLINE_MAX_SINGLE_CHARS = _cfg("pageInlineMaxSingleChars", 40)

# AI 披露水印（PR-2）：页脚文字由 export-agent 侧通过环境变量注入。
# EXPORT_AGENT_AI_DISCLOSURE=off 时禁用。
DISCLOSURE_FLAG = os.environ.get("EXPORT_AGENT_AI_DISCLOSURE", "on").strip().lower()
DISCLOSURE_ENABLED = DISCLOSURE_FLAG != "off"
DISCLOSURE_TEXT_DEFAULT = "AI Translation Draft · Human Review Required"
DISCLOSURE_TEXT = os.environ.get("EXPORT_AGENT_AI_DISCLOSURE_TEXT") or DISCLOSURE_TEXT_DEFAULT


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


def normalize_translation_display(value: str) -> str:
    text = clean_translation(value)
    replacements = {
        "圈型拉链": "尼龙拉链",
        "圈形拉链": "尼龙拉链",
        "拉鍊": "拉链",
        "鍊": "链",
        "門": "门",
        "邊": "边",
        "線": "线",
        "綫": "线",
        "車": "车",
        "針": "针",
        "領": "领",
        "裡": "里",
        "號": "号",
        "開": "开",
        "閉": "闭",
        "裝": "装",
        "雙": "双",
        "帶": "带",
        "顏色": "颜色",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
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
    if normalized_source == "style sheet":
        return True
    if re.search(
        r"\b(styliste|designer|graphic designer|graphiste|model maker|modéliste|purchaser|acheteur|n[ée]goce|oversea)\b",
        normalized_source,
    ):
        return True
    if (
        not re.search(r"\b(logo|label|fabric|zip|zipper|pocket|snap|button|lining|embroidery|color|colour|proto|sample)\b", normalized_source)
        and not re.search(r"\d", source)
        and re.fullmatch(r"[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'\- ]{5,}", (source or "").strip())
    ):
        return True
    compact_source = normalize_compact(source)
    compact_translation = normalize_compact(translation)
    if compact_source and compact_source == compact_translation:
        return True
    if is_code_like(source) and compact_source in compact_translation:
        return True
    return False


def marker_box_dimensions(label: str) -> tuple[float, float]:
    padding_x = 3
    padding_y = 2
    text_width = pdfmetrics.stringWidth(label, "Helvetica-Bold", MARKER_FONT_SIZE)
    box_width = text_width + padding_x * 2
    box_height = MARKER_FONT_SIZE + padding_y * 2
    return box_width, box_height


def draw_note_marker(pdf: canvas.Canvas, x: float, y: float, label: str) -> None:
    padding_x = 3
    padding_y = 2
    box_width, box_height = marker_box_dimensions(label)
    pdf.setFillColor(colors.white)
    pdf.setStrokeColor(colors.HexColor("#fca5a5"))
    pdf.roundRect(x, y, box_width, box_height, 4, fill=1, stroke=1)
    pdf.setFillColor(MARKER_COLOR)
    pdf.setFont("Helvetica-Bold", MARKER_FONT_SIZE)
    pdf.drawString(x + padding_x, y + padding_y + 2, label)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(value, maximum))


def compute_marker_position(page_width: float, page_height: float, bbox: dict, label: str) -> tuple[float, float]:
    box_width, box_height = marker_box_dimensions(label)
    bbox_width = max(0.0, bbox["x1"] - bbox["x0"])
    bbox_height = max(0.0, bbox["bottom"] - bbox["top"])
    center_x = (bbox["x0"] + bbox["x1"]) / 2
    center_y = (bbox["top"] + bbox["bottom"]) / 2
    max_x = max(6.0, page_width - box_width - 6.0)
    max_y = max(6.0, page_height - box_height - 6.0)

    # Wide labels read better when centered above the referenced area instead of hanging from the left edge.
    if bbox_width >= 140:
        x = clamp(center_x - box_width / 2, 6.0, max_x)
        y = clamp(page_height - bbox["top"] + 4.0, 6.0, max_y)
        return x, y

    # Tall vertical callouts should keep the marker near the middle of the strip.
    if bbox_height >= 120 and bbox_width <= 90:
        if center_x <= page_width * 0.5:
            x = clamp(bbox["x0"] - box_width - 6.0, 6.0, max_x)
        else:
            x = clamp(bbox["x1"] + 6.0, 6.0, max_x)
        y = clamp(page_height - center_y - box_height / 2, 6.0, max_y)
        return x, y

    x = clamp(bbox["x0"] - box_width - 6.0, 6.0, max_x)
    y = clamp(page_height - bbox["top"] + 4.0, 6.0, max_y)
    return x, y


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
        translation = normalize_translation_display(str(item.get("zh", "")))
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
                "page_layout_type": item.get("pageLayoutType"),
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


def find_table_comment_column(pdf_page, headers: list[str]) -> int | None:
    """Find the column index in tables that matches comment/notes headers.
    Also returns (table_index, col_index) via find_table_comment_column_ex when
    callers need to know which table owns the column."""
    result = find_table_comment_column_ex(pdf_page, headers)
    if result:
        return result[1]
    return None


def find_table_comment_column_ex(pdf_page, headers: list[str]) -> tuple | None:
    """Find (table_index, col_index) in tables that matches comment/notes headers.
    Uses extract() to get header row text and matches against known header names."""
    if not pdf_page:
        return None
    
    tables = pdf_page.find_tables()
    if not tables:
        return None
    
    headers_lower = [h.lower() for h in headers]
    
    for table_idx, table in enumerate(tables):
        table_data = table.extract()
        if not table_data or len(table_data) < 2:
            continue
        header_row = table_data[0]
        for col_idx, cell_text in enumerate(header_row):
            cell_str = (cell_text or "").strip().lower()
            # Check if any header keyword appears in the cell text
            # (cell may contain multi-line text like "Comment\nsomething")
            for kw in headers_lower:
                if kw in cell_str:
                    return (table_idx, col_idx)
    
    return None


def get_table_cells(pdf_page) -> list:
    """Extract table cells from PDF page."""
    if not pdf_page:
        return []
    
    tables = pdf_page.find_tables()
    all_cells = []
    
    for table in tables:
        if hasattr(table, 'cells') and table.cells:
            all_cells.extend(table.cells)
    
    return all_cells


def is_cell_empty(cell_bbox: dict, words: list) -> bool:
    """Check if a table cell is empty of text content."""
    cell_rect = {
        "x0": cell_bbox['x0'],
        "x1": cell_bbox['x1'], 
        "top": cell_bbox['top'],
        "bottom": cell_bbox['bottom']
    }
    
    for word in words:
        word_rect = {
            "x0": word['x0'],
            "x1": word['x1'],
            "top": word['top'],
            "bottom": word['bottom']
        }
        if rects_overlap(cell_rect, word_rect, padding=1.0):
            return False
    
    return True


def calculate_free_space_to_right(bbox: dict, page_words: list, page_width: float) -> float:
    """Calculate available free space to the right of a bounding box."""
    right_edge = bbox["x1"]
    max_x = max(word["x1"] for word in page_words) if page_words else page_width
    
    # Find the nearest word to the right
    nearest_right = page_width
    for word in page_words:
        if word["x0"] > right_edge:
            nearest_right = min(nearest_right, word["x0"])
    
    return max(0, nearest_right - right_edge - 5)  # 5px buffer


def check_collision(candidate_rect: dict, page_words: list, source_bbox: dict | None = None) -> bool:
    """Check if candidate rectangle collides with any existing text."""
    for word in page_words:
        word_rect = {
            "x0": word["x0"],
            "x1": word["x1"],
            "top": word["top"],
            "bottom": word["bottom"]
        }
        
        # Skip if this is the source text itself
        if source_bbox and rects_overlap(word_rect, source_bbox, padding=0):
            continue
            
        if rects_overlap(candidate_rect, word_rect, padding=COLLISION_PADDING):
            return True
    
    return False


def find_collision_free_position(
    source_bbox: dict, 
    page_words: list, 
    text_width: float, 
    text_height: float,
    page_width: float,
    page_height: float
) -> dict | None:
    """Find a collision-free position near source text for inline translation."""
    # Try to the right first
    free_space = calculate_free_space_to_right(source_bbox, page_words, page_width)
    
    if free_space >= INLINE_MIN_FREE_SPACE:
        # Determine font size based on available space
        font_size = determine_font_size_for_space(free_space)
        if font_size:
            candidate_rect = {
                "x0": source_bbox["x1"] + 3,
                "x1": source_bbox["x1"] + 3 + text_width,
                "top": source_bbox["top"],
                "bottom": source_bbox["top"] + text_height
            }
            
            if not check_collision(candidate_rect, page_words, source_bbox):
                return candidate_rect
    
    # Try vertical shifts
    for shift in range(4, INLINE_MAX_VERTICAL_SHIFT + 1, 4):
        for direction in [1, -1]:  # down and up
            candidate_rect = {
                "x0": source_bbox["x1"] + 3,
                "x1": source_bbox["x1"] + 3 + text_width,
                "top": source_bbox["top"] + (direction * shift),
                "bottom": source_bbox["top"] + (direction * shift) + text_height
            }
            
            # Ensure within page bounds
            if candidate_rect["top"] < PAGE_PADDING or candidate_rect["bottom"] > page_height - PAGE_PADDING:
                continue
                
            if not check_collision(candidate_rect, page_words, source_bbox):
                return candidate_rect
    
    # Try below source text
    candidate_rect = {
        "x0": source_bbox["x0"],
        "x1": source_bbox["x0"] + text_width,
        "top": source_bbox["bottom"] + 2,
        "bottom": source_bbox["bottom"] + 2 + text_height
    }
    
    if candidate_rect["bottom"] <= page_height - PAGE_PADDING:
        if not check_collision(candidate_rect, page_words, source_bbox):
            return candidate_rect
    
    return None


def determine_font_size_for_space(free_space: float) -> float | None:
    """Determine appropriate font size based on available space."""
    # Sort thresholds in descending order
    thresholds = sorted([int(k) for k in INLINE_FONT_BY_SPACE.keys()], reverse=True)
    
    for threshold in thresholds:
        if free_space >= threshold:
            return INLINE_FONT_BY_SPACE[str(threshold)]
    
    return None if free_space < INLINE_MIN_FREE_SPACE else INLINE_FONT_BY_SPACE[str(thresholds[-1])]


def detect_bottom_zone(page_words: list, page_height: float) -> float:
    """Detect the y-coordinate of the lowest text/table on the page."""
    if not page_words:
        return PAGE_PADDING
    
    max_bottom = max(word["bottom"] for word in page_words)
    return min(max_bottom + 10, page_height - PAGE_PADDING)


def can_fit_bottom_zone(page_height: float, bottom_y: float) -> bool:
    """Check if bottom zone has enough space."""
    available_height = page_height - bottom_y - PAGE_PADDING
    return available_height >= BOTTOM_ZONE_MIN_HEIGHT


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


def choose_sketch_inline_note_width(page_width: float, bbox: dict, translation: str) -> float:
    desired = min(
        INLINE_NOTE_SKETCH_MAX_WIDTH,
        max(INLINE_NOTE_SKETCH_MIN_WIDTH, pdfmetrics.stringWidth(translation, "STSong-Light", 9.6) + 6),
    )
    remaining_right = page_width - bbox["x1"] - PAGE_PADDING - 6
    if remaining_right >= desired:
        return desired
    remaining_left = bbox["x0"] - PAGE_PADDING - 6
    if remaining_left >= desired:
        return desired
    return max(INLINE_NOTE_SKETCH_MIN_WIDTH, min(desired, page_width * 0.16))


def iter_inline_scan_offsets(limit: int, step: int = INLINE_NOTE_SCAN_STEP) -> list[int]:
    offsets = [0]
    for delta in range(step, limit + step, step):
        offsets.append(delta)
        offsets.append(-delta)
    return offsets


def choose_inline_note_candidate(
    page_width: float,
    page_height: float,
    bbox: dict,
    note_width: float,
    note_height: float,
    prefer_side_only: bool = False,
) -> list[tuple[float, float, float]]:
    wide_source = (bbox["x1"] - bbox["x0"]) >= 72
    tall_source = (bbox["bottom"] - bbox["top"]) >= INLINE_NOTE_TALL_SOURCE_THRESHOLD
    center_x = (bbox["x0"] + bbox["x1"]) / 2
    center_y = (bbox["top"] + bbox["bottom"]) / 2
    max_x = max(PAGE_PADDING, page_width - PAGE_PADDING - note_width)
    max_top = max(PAGE_PADDING, page_height - PAGE_PADDING - note_height)

    base_specs: list[tuple[float, float, float, list[int], list[int]]] = [
        (bbox["x1"] + 8, center_y - note_height / 2, 0.0, [0], iter_inline_scan_offsets(60)),
        (bbox["x0"] - note_width - 8, center_y - note_height / 2, 0.8, [0], iter_inline_scan_offsets(60)),
    ]

    if not prefer_side_only:
        base_specs.extend(
            [
                (center_x - note_width / 2, bbox["bottom"] + 8, 1.4, iter_inline_scan_offsets(48), [0, 12, 24]),
                (center_x - note_width / 2, bbox["top"] - note_height - 8, 1.8, iter_inline_scan_offsets(48), [0, -12, -24]),
            ]
        )

    if wide_source:
        base_specs.extend(
            [
                (bbox["x0"] + 8, bbox["bottom"] + 6, 1.1, [0, 18, -18], [0, 10, 22]),
                (bbox["x0"] + 18, bbox["top"] - note_height - 6, 1.6, [0, 18, -18], [0, -10, -22]),
            ]
        )

    if tall_source:
        base_specs.extend(
            [
                (bbox["x1"] + 10, bbox["top"] + 8, 0.6, [0, 12, -12], iter_inline_scan_offsets(72)),
                (bbox["x0"] - note_width - 10, bbox["top"] + 8, 1.0, [0, 12, -12], iter_inline_scan_offsets(72)),
            ]
        )

    candidates: list[tuple[float, float, float]] = []
    for base_x, base_top, penalty, x_offsets, y_offsets in base_specs:
        for x_offset in x_offsets:
            for y_offset in y_offsets:
                x = clamp(base_x + x_offset, PAGE_PADDING, max_x)
                top = clamp(base_top + y_offset, PAGE_PADDING, max_top)
                candidates.append((x, top, penalty))

    deduped: list[tuple[float, float, float]] = []
    seen: set[tuple[int, int]] = set()
    for x, top, penalty in candidates:
        key = (round(x), round(top))
        if key in seen:
            continue
        seen.add(key)
        deduped.append((x, top, penalty))
    return deduped


def score_inline_note_rect(bbox: dict, rect: dict, penalty: float) -> float:
    bbox_center_x = (bbox["x0"] + bbox["x1"]) / 2
    bbox_center_y = (bbox["top"] + bbox["bottom"]) / 2
    rect_center_x = (rect["x0"] + rect["x1"]) / 2
    rect_center_y = (rect["top"] + rect["bottom"]) / 2
    horizontal_gap = max(0.0, max(bbox["x0"] - rect["x1"], rect["x0"] - bbox["x1"]))
    vertical_gap = max(0.0, max(bbox["top"] - rect["bottom"], rect["top"] - bbox["bottom"]))
    center_distance = abs(rect_center_x - bbox_center_x) + abs(rect_center_y - bbox_center_y)
    return penalty * 1000 + center_distance + horizontal_gap * 2.4 + vertical_gap * 2.1


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
        prefer_side_only = note.get("page_layout_type") == "sketch"
        is_sketch = note.get("page_layout_type") == "sketch"
        translation = shorten_text(
            note["translation"],
            choose_inline_note_chars(
                choose_sketch_inline_note_width(page_width, bbox, note["translation"])
                if is_sketch
                else choose_inline_note_width(page_width, bbox, note["translation"]),
                bbox,
            ),
        )
        note_width = (
            choose_sketch_inline_note_width(page_width, bbox, translation)
            if is_sketch
            else choose_inline_note_width(page_width, bbox, translation)
        )
        para_style = translation_style
        if is_sketch:
            para_style = ParagraphStyle(
                "inline-translation-sketch",
                parent=translation_style,
                fontSize=9.6,
                leading=11.0,
            )
        para = Paragraph(translation, para_style)
        _, note_height = para.wrap(note_width, 1000)
        note_height += 2
        placed_rect = None
        placed_score = None

        for candidate_x, candidate_top, penalty in choose_inline_note_candidate(
            page_width,
            page_height,
            bbox,
            note_width,
            note_height,
            prefer_side_only=prefer_side_only,
        ):
            rect = {
                "x0": max(PAGE_PADDING, min(candidate_x, page_width - PAGE_PADDING - note_width)),
                "x1": max(PAGE_PADDING, min(candidate_x, page_width - PAGE_PADDING - note_width)) + note_width,
                "top": candidate_top,
                "bottom": candidate_top + note_height,
            }

            if any(rects_overlap(rect, item["_rect"]) for item in placed):
                continue
            if rects_overlap(rect, bbox, padding=2.0):
                continue

            score = score_inline_note_rect(bbox, rect, penalty)
            if placed_score is None or score < placed_score:
                placed_rect = rect
                placed_score = score

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
        {"columns": 3, "source_chars": 22, "translation_chars": 24, "source_size": 5.4, "translation_size": 6.4, "source_leading": 6.2, "translation_leading": 7.2},
        {"columns": 3, "source_chars": 16, "translation_chars": 20, "source_size": 5.0, "translation_size": 6.0, "source_leading": 5.8, "translation_leading": 6.8},
        {"columns": 4, "source_chars": 14, "translation_chars": 18, "source_size": 4.6, "translation_size": 5.6, "source_leading": 5.4, "translation_leading": 6.4},
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

    ranges: list[tuple[int, int]] = []
    start = sorted_numbers[0]
    end = start
    for number in sorted_numbers[1:]:
        if number == end + 1:
            end = number
            continue
        ranges.append((start, end))
        start = end = number
    ranges.append((start, end))

    parts = [f"{start}-{end}" if start != end else str(start) for start, end in ranges]
    label = ",".join(parts[:2])
    if len(parts) > 2:
        label += f"+{len(parts) - 2}"
    return label


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


def dense_row_gap(a: dict, b: dict) -> float:
    return max(0.0, b["bbox"]["top"] - a["bbox"]["bottom"])


def dense_row_x_overlap(a: dict, b: dict) -> float:
    overlap = max(0.0, min(a["bbox"]["x1"], b["bbox"]["x1"]) - max(a["bbox"]["x0"], b["bbox"]["x0"]))
    width = min(a["bbox"]["x1"] - a["bbox"]["x0"], b["bbox"]["x1"] - b["bbox"]["x0"])
    if width <= 0:
        return 0.0
    return overlap / width


def can_merge_dense_rows(a: dict, b: dict) -> bool:
    if dense_row_gap(a, b) > 28:
        return False
    if dense_row_x_overlap(a, b) < 0.55:
        return False
    combined_numbers = sorted(set((a.get("note_numbers") or []) + (b.get("note_numbers") or [])))
    if len(combined_numbers) > 5:
        return False
    combined_source = " / ".join(filter(None, [a.get("source", ""), b.get("source", "")]))
    return len(re.sub(r"\s+", " ", combined_source).strip()) <= 180


def merge_dense_rows(rows: list[dict]) -> list[dict]:
    if not rows:
        return []

    merged: list[dict] = []
    current = clone_note(rows[0])
    for row in rows[1:]:
        if can_merge_dense_rows(current, row):
            current["source"] = " / ".join(filter(None, [current.get("source", ""), row.get("source", "")]))
            current["translation"] = "；".join(filter(None, [current.get("translation", ""), row.get("translation", "")]))
            current["note_numbers"] = sorted(set((current.get("note_numbers") or []) + (row.get("note_numbers") or [])))
            current["label"] = format_note_label(current["note_numbers"])
            current["bbox"] = {
                "x0": min(current["bbox"]["x0"], row["bbox"]["x0"]),
                "x1": max(current["bbox"]["x1"], row["bbox"]["x1"]),
                "top": min(current["bbox"]["top"], row["bbox"]["top"]),
                "bottom": max(current["bbox"]["bottom"], row["bbox"]["bottom"]),
            }
            continue

        merged.append(current)
        current = clone_note(row)

    merged.append(current)
    return merged


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
                    "label": format_note_label(note_numbers),
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

    return merge_dense_rows(rows)


def should_use_dense_layout(notes: list[dict]) -> bool:
    visible_notes = [note for note in notes if note.get("bbox")]
    if len(visible_notes) > DENSE_PAGE_NOTE_THRESHOLD:
        return True
    if len(visible_notes) < DENSE_PAGE_CROWDED_THRESHOLD:
        return False

    dense_rows = build_dense_page_rows(visible_notes)
    return len(dense_rows) >= 6


def create_dense_marker_overlay(page_width: float, page_height: float, rows: list[dict]) -> PdfReader:
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(page_width, page_height))

    for row in rows:
        bbox = row.get("bbox")
        if not bbox:
            continue

        marker_x, marker_y = compute_marker_position(page_width, page_height, bbox, row["label"])
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

        marker_x, marker_y = compute_marker_position(page_width, page_height, bbox, row["label"])
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

        marker_x, marker_y = compute_marker_position(page_width, page_height, bbox, str(note["note_number"]))
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
        label_font_size = 18 if layout["columns"] == 1 else (16 if layout["columns"] == 2 else (12 if layout["columns"] == 3 else 10))
        pdf.setFont("Helvetica-Bold", label_font_size)
        pdf.drawString(x + 4, y + note_height - (14 if layout["columns"] <= 2 else 10), str(note["note_number"]))

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


def _load_page_render_overrides() -> dict[int, str]:
    """Load per-page render style overrides from FEEDBACK_RENDER_PAGE_OVERRIDES env.

    Format: "1:inline,3:panel,5:inline" (page_number:render_style pairs)
    render_style must be 'inline' or 'panel'.
    """
    raw = os.environ.get("FEEDBACK_RENDER_PAGE_OVERRIDES", "").strip()
    if not raw:
        return {}
    overrides: dict[int, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if ":" not in pair:
            continue
        page_str, style = pair.split(":", 1)
        try:
            page_num = int(page_str.strip())
        except ValueError:
            continue
        style = style.strip().lower()
        if style in ("inline", "panel"):
            overrides[page_num] = style
    return overrides


def _decide_page_render_style(notes: list[dict], page_number: int, overrides: dict[int, str]) -> str:
    """Decide unified render style for an entire page.

    Returns 'inline' (all beside English) or 'panel' (all in right-side CN Notes).

    Logic:
    1. If user has overridden this page via overrides dict, use that.
    2. Count total notes with translations and total translation characters.
    3. If any single translation exceeds PAGE_INLINE_MAX_SINGLE_CHARS, use panel.
    4. If note count > PAGE_INLINE_MAX_NOTES or total chars > PAGE_INLINE_MAX_TOTAL_CHARS, use panel.
    5. Otherwise use inline.
    """
    if page_number in overrides:
        return overrides[page_number]

    translated = [n for n in notes if n.get("translation")]
    if not translated:
        return "panel"

    total_chars = sum(len(n.get("translation", "")) for n in translated)
    max_single = max(len(n.get("translation", "")) for n in translated)

    if max_single > PAGE_INLINE_MAX_SINGLE_CHARS:
        return "panel"
    if len(translated) > PAGE_INLINE_MAX_NOTES:
        return "panel"
    if total_chars > PAGE_INLINE_MAX_TOTAL_CHARS:
        return "panel"

    return "inline"


def apply_smart_placement_strategies(
    pdf_page,
    page_notes: list[dict],
    page_width: float,
    page_height: float,
    render_styles: dict
) -> tuple[list[dict], list[dict], list[dict]]:
    """Apply smart placement strategies in priority order.
    
    Returns:
        tuple: (table_placed, inline_placed, remaining_for_panel)
    """
    if not USE_SMART_PLACEMENT or not SMART_PLACEMENT_ENABLED:
        return [], [], page_notes
    
    page_words = pdf_page.extract_words(x_tolerance=2, y_tolerance=3, keep_blank_chars=False, use_text_flow=True)
    
    # Strategy 1: Table Column Fill
    table_placed = apply_table_column_fill_strategy(pdf_page, page_notes, page_words, render_styles)
    
    # Get notes not placed by Strategy 1
    remaining_for_strategies = [note for note in page_notes if note not in table_placed]
    
    # Strategy 2: Collision-Free Inline
    inline_placed = apply_collision_free_inline_strategy(remaining_for_strategies, page_words, page_width, page_height, render_styles)
    
    # Get notes not placed by Strategies 1-2
    remaining_for_panel = [note for note in remaining_for_strategies if note not in inline_placed]
    
    return table_placed, inline_placed, remaining_for_panel


def apply_table_column_fill_strategy(
    pdf_page,
    page_notes: list[dict],
    page_words: list,
    render_styles: dict
) -> list[dict]:
    """Strategy 1: Place translations in empty table comment/notes cells."""
    placed = []
    
    # Use the extended version to get the specific table
    col_info = find_table_comment_column_ex(pdf_page, TABLE_COMMENT_HEADERS)
    if col_info is None:
        return placed
    
    table_idx, comment_col_idx = col_info
    tables = pdf_page.find_tables()
    if table_idx >= len(tables):
        return placed
    
    table = tables[table_idx]
    if not hasattr(table, 'cells') or not table.cells:
        return placed
    
    # Build a map of row y-ranges to Comment cells
    # This avoids the fragile note<->row matching
    comment_cells = []
    for row_idx, row in enumerate(table.cells):
        if comment_col_idx >= len(row):
            continue
        cell_bbox = row[comment_col_idx]
        if not cell_bbox or not isinstance(cell_bbox, (tuple, list)) or len(cell_bbox) < 4:
            continue
        # cell_bbox is (x0, top, x1, bottom) tuple
        cell_dict = {
            "x0": cell_bbox[0],
            "x1": cell_bbox[2],
            "top": cell_bbox[1],
            "bottom": cell_bbox[3]
        }
        if is_cell_empty(cell_dict, page_words):
            comment_cells.append(cell_dict)
    
    if not comment_cells:
        return placed
    
    # Match notes to comment cells by y-position overlap
    used_cells = set()
    for note in page_notes:
        if not note.get("bbox") or not note.get("translation"):
            continue
        
        note_bbox = note["bbox"]
        note_center_y = (note_bbox["top"] + note_bbox["bottom"]) / 2
        
        for ci, cell in enumerate(comment_cells):
            if ci in used_cells:
                continue
            # Check if note center falls within cell's y-range (relaxed)
            if cell["top"] - 5 <= note_center_y <= cell["bottom"] + 5:
                placed_note = clone_note(note)
                placed_note["_smart_placement"] = "table_cell"
                placed_note["_cell_bbox"] = cell
                placed_note["_font_size"] = 7.0
                placed.append(placed_note)
                used_cells.add(ci)
                break
    
    return placed
    
    return placed


def apply_collision_free_inline_strategy(
    page_notes: list[dict],
    page_words: list,
    page_width: float,
    page_height: float,
    render_styles: dict
) -> list[dict]:
    """Strategy 2: Place translations with collision detection and adaptive font sizing."""
    placed = []
    
    for note in page_notes:
        if not note.get("bbox") or not note.get("translation"):
            continue
            
        source_bbox = note["bbox"]
        translation = note["translation"]
        
        # Try different font sizes
        for space_threshold in sorted([int(k) for k in INLINE_FONT_BY_SPACE.keys()], reverse=True):
            font_size = INLINE_FONT_BY_SPACE[str(space_threshold)]
            
            # Calculate text dimensions
            text_width = pdfmetrics.stringWidth(translation, "STSong-Light", font_size)
            text_height = font_size * 1.2  # Approximate height with leading
            
            # Try to find collision-free position
            candidate_rect = find_collision_free_position(
                source_bbox, page_words, text_width, text_height, page_width, page_height
            )
            
            if candidate_rect:
                placed_note = clone_note(note)
                placed_note["_smart_placement"] = "inline"
                placed_note["_rect"] = candidate_rect
                placed_note["_font_size"] = font_size
                placed.append(placed_note)
                break
    
    return placed


def create_bottom_zone_overlay(
    page_width: float,
    page_height: float,
    bottom_notes: list[dict],
    page_number: int
) -> PdfReader | None:
    """Strategy 3: Create bottom zone overlay for remaining translations."""
    if not bottom_notes:
        return None
    
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(page_width, page_height))
    
    # Calculate bottom zone position
    bottom_y = detect_bottom_zone([], page_height)  # Will be calculated from actual content
    available_height = page_height - bottom_y - PAGE_PADDING
    
    if available_height < BOTTOM_ZONE_MIN_HEIGHT:
        pdf.save()
        buffer.seek(0)
        return None
    
    # Draw bottom zone background
    zone_y = PAGE_PADDING
    zone_height = available_height
    
    pdf.setFillColor(colors.HexColor("#f8fbff"))
    pdf.roundRect(
        PAGE_PADDING - 6,
        zone_y,
        page_width - (PAGE_PADDING - 6) * 2,
        zone_height,
        12,
        fill=1,
        stroke=0,
    )
    
    # Draw separator line
    pdf.setStrokeColor(colors.HexColor("#d4e3f4"))
    pdf.setLineWidth(1.0)
    pdf.line(PAGE_PADDING, zone_y + zone_height - 1, page_width - PAGE_PADDING, zone_y + zone_height - 1)
    
    # Draw title
    pdf.setFillColor(colors.HexColor("#1f4f86"))
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(PAGE_PADDING, zone_y + zone_height - 8, "CN Notes")
    
    # Organize notes in columns
    column_width = (page_width - PAGE_PADDING * 2 - COLUMN_GAP) / BOTTOM_ZONE_COLUMNS
    current_y = zone_y + zone_height - 28
    current_column = 0
    
    pdf.setFont("STSong-Light", BOTTOM_ZONE_FONT_SIZE)
    pdf.setFillColor(colors.HexColor("#1f4f86"))
    
    for note in bottom_notes:
        if current_column >= BOTTOM_ZONE_COLUMNS:
            current_column = 0
            current_y -= 16
        
        x = PAGE_PADDING + current_column * (column_width + COLUMN_GAP)
        
        # Format: "1. keyword → 中文翻译"
        source_short = shorten_text(note["source"], 30)
        text = f"{note['note_number']}. {source_short} → {note['translation']}"
        
        pdf.drawString(x, current_y, text)
        
        current_column += 1
        if current_column >= BOTTOM_ZONE_COLUMNS:
            current_column = 0
            current_y -= 16
    
    pdf.save()
    buffer.seek(0)
    return PdfReader(buffer)


def render_smart_placement_overlays(
    table_placed: list[dict],
    inline_placed: list[dict],
    bottom_notes: list[dict],
    panel_notes: list[dict],
    page_width: float,
    page_height: float,
    page_number: int,
    render_styles: dict
) -> tuple[list[PdfReader], bool]:
    """Render all smart placement overlays.
    
    Returns:
        tuple: (overlay_pages, needs_panel_expansion)
    """
    overlays = []
    needs_panel_expansion = len(panel_notes) > 0
    
    # Create table and inline placement overlay
    if table_placed or inline_placed:
        buffer = io.BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=(page_width, page_height))
        
        # Render table cell placements
        for note in table_placed:
            if note.get("_smart_placement") == "table_cell" and note.get("_cell_bbox"):
                cell_bbox = note["_cell_bbox"]
                pdf.setFillColor(colors.HexColor("#0a6fd6"))
                pdf.setFont("STSong-Light", note.get("_font_size", 7.0))
                
                # Convert coordinates (pdfplumber uses top-left, reportlab uses bottom-left)
                x = cell_bbox["x0"] + 2
                y = page_height - cell_bbox["top"] - note.get("_font_size", 7.0) - 2
                
                pdf.drawString(x, y, note["translation"])
        
        # Render inline placements
        for note in inline_placed:
            if note.get("_smart_placement") == "inline" and note.get("_rect"):
                rect = note["_rect"]
                pdf.setFillColor(colors.HexColor("#0a6fd6"))
                pdf.setFont("STSong-Light", note.get("_font_size", 7.0))
                
                # Convert coordinates
                x = rect["x0"]
                y = page_height - rect["bottom"]
                
                pdf.drawString(x, y, note["translation"])
        
        pdf.save()
        buffer.seek(0)
        overlays.append(PdfReader(buffer))
    
    # Create bottom zone overlay if there are remaining notes
    if bottom_notes:
        bottom_overlay = create_bottom_zone_overlay(page_width, page_height, bottom_notes, page_number)
        if bottom_overlay:
            overlays.append(bottom_overlay)
    
    return overlays, needs_panel_expansion


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

    page_render_overrides = _load_page_render_overrides()

    # Re-open PDF for smart placement analysis
    pdf_for_analysis = pdfplumber.open(str(input_pdf))

    for page_number, page in enumerate(reader.pages, start=1):
        notes_for_page = page_notes.get(page_number, [])
        if not notes_for_page:
            new_page = writer.add_blank_page(
                width=float(page.mediabox.width),
                height=float(page.mediabox.height),
            )
            new_page.merge_transformed_page(page, Transformation().translate(0, 0))
            continue

        page_render_style = _decide_page_render_style(notes_for_page, page_number, page_render_overrides)
        page_width = float(page.mediabox.width)
        page_height = float(page.mediabox.height)

        # ── Try smart placement strategies first ──
        if USE_SMART_PLACEMENT and SMART_PLACEMENT_ENABLED:
            # Get corresponding pdfplumber page for analysis
            pdf_page = None
            try:
                pdf_page = pdf_for_analysis.pages[page_number - 1]
            except (IndexError, AttributeError):
                pass

            if pdf_page:
                # Apply smart placement strategies
                table_placed, inline_placed, remaining_for_panel = apply_smart_placement_strategies(
                    pdf_page, notes_for_page, page_width, page_height, render_styles
                )

                # Separate remaining into bottom zone and panel
                bottom_notes = []
                panel_notes = []
                
                if remaining_for_panel:
                    # Check if bottom zone is available
                    page_words = pdf_page.extract_words(x_tolerance=2, y_tolerance=3, keep_blank_chars=False, use_text_flow=True)
                    bottom_y = detect_bottom_zone(page_words, page_height)
                    
                    if can_fit_bottom_zone(page_height, bottom_y):
                        # Put remaining in bottom zone
                        bottom_notes = remaining_for_panel
                        panel_notes = []
                    else:
                        # Put remaining in panel
                        panel_notes = remaining_for_panel

                # Render smart placement overlays
                smart_overlays, needs_panel = render_smart_placement_overlays(
                    table_placed, inline_placed, bottom_notes, panel_notes,
                    page_width, page_height, page_number, render_styles
                )

                # Create page with appropriate width
                final_width = page_width + (PANEL_WIDTH if needs_panel else 0)
                new_page = writer.add_blank_page(width=final_width, height=page_height)
                new_page.merge_transformed_page(page, Transformation().translate(0, 0))

                # Apply all smart placement overlays
                for overlay in smart_overlays:
                    if overlay.pages:
                        new_page.merge_page(overlay.pages[0])

                # Apply panel overlay if needed
                if needs_panel and panel_notes:
                    panel_overlay = create_overlay_page(
                        page_width, page_height, page_number, panel_notes, render_styles
                    )
                    new_page.merge_page(panel_overlay.pages[0])

                continue

        # ── Fallback to original rendering logic ──
        
        # ── Unified INLINE mode: all translations beside the English source ──
        if page_render_style == "inline" and USE_INLINE_NOTES:
            # Force all notes on this page to inline rendering
            inline_all = [
                {**note, "render_mode": "inline"}
                for note in notes_for_page
                if note.get("bbox") and note.get("translation")
            ]
            inline_overlay, inline_overflow = create_inline_note_overlay(
                page_width,
                page_height,
                inline_all,
                render_styles,
            )
            if inline_overlay and not inline_overflow:
                new_page = writer.add_blank_page(
                    width=page_width,
                    height=page_height,
                )
                new_page.merge_transformed_page(page, Transformation().translate(0, 0))
                new_page.merge_page(inline_overlay.pages[0])
                continue

            # Fallback: inline had overflow or failed, fall through to panel

        # ── Unified PANEL mode: all translations in right-side CN Notes ──
        # This also serves as fallback when inline mode overflows
        panel_notes = [
            {**note, "render_mode": "footnote"}
            for note in notes_for_page
            if note.get("translation")
        ]
        if not panel_notes:
            new_page = writer.add_blank_page(
                width=page_width,
                height=page_height,
            )
            new_page.merge_transformed_page(page, Transformation().translate(0, 0))
            continue

        # ── Always use right-side panel layout (no extra review pages) ──
        # All translations go into the right-side CN Notes panel.
        # fit_notes_single_page will use progressively more columns and smaller
        # fonts to fit everything on a single page.
        new_page = writer.add_blank_page(
            width=page_width + PANEL_WIDTH,
            height=page_height,
        )
        new_page.merge_transformed_page(page, Transformation().translate(0, 0))
        overlay_reader = create_overlay_page(
            page_width,
            page_height,
            page_number,
            panel_notes,
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

    _apply_disclosure_watermark(writer)

    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    with output_pdf.open("wb") as handle:
        writer.write(handle)


def _apply_disclosure_watermark(writer: PdfWriter) -> None:
    """Merge a page-level AI disclosure footer onto every page.

    Gated by EXPORT_AGENT_AI_DISCLOSURE. The footer text is provided by the
    caller via EXPORT_AGENT_AI_DISCLOSURE_TEXT (built from the canonical
    `buildDisclosureWatermarkText` helper on the TS side, so PDF/xlsx/UI
    stay in sync).
    """
    if os.environ.get("EXPORT_AGENT_AI_DISCLOSURE", "on").strip().lower() == "off":
        return
    text = os.environ.get("EXPORT_AGENT_AI_DISCLOSURE_TEXT", "").strip()
    if not text:
        text = "AI Translation Draft · Human Review Required"

    for page in writer.pages:
        media = page.mediabox
        width = float(media.width)
        height = float(media.height)

        buf = io.BytesIO()
        overlay = canvas.Canvas(buf, pagesize=(width, height))
        overlay.setFont("Helvetica", 7)
        overlay.setFillColor(colors.HexColor("#64748b"))
        margin_x = 18
        margin_y = 10
        max_width = max(40, width - margin_x * 2)
        rendered = text
        if overlay.stringWidth(rendered, "Helvetica", 7) > max_width:
            ellipsis = "…"
            while rendered and overlay.stringWidth(rendered + ellipsis, "Helvetica", 7) > max_width:
                rendered = rendered[:-1]
            rendered = rendered + ellipsis
        overlay.drawString(margin_x, margin_y, rendered)
        overlay.save()
        buf.seek(0)
        overlay_page = PdfReader(buf).pages[0]
        page.merge_page(overlay_page)


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
