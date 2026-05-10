import * as XLSX from 'xlsx';
import { callTranslationModelChat } from '@/lib/assistant/qwen-client';
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export type ExcelTranslationInput = {
  filePath: string;
  fileName: string;
  translationModelOverride?: string;
};

export type ExcelCellTranslation = {
  sheetName: string;
  cellAddress: string;
  originalText: string;
  translatedText?: string;
  error?: string;
};

export type ExcelSheetTranslationInfo = {
  sheetName: string;
  rowCount: number;
  columnCount: number;
  translatedCells: number;
  failedCells: number;
};

export type ExcelTranslationResult = {
  success: boolean;
  originalFileName: string;
  translatedFileName: string;
  translatedFilePath: string;
  sheets: Array<{
    sheetName: string;
    rowCount: number;
    columnCount: number;
    translatedCells: number;
    failedCells: number;
  }>;
  totalCells: number;
  translatedCells: number;
  failedCells: number;
  executionTimeMs: number;
  parseFailedBatches?: number;
  translationBatchErrors?: string[];
  error?: string;
};

export function buildZeroCoverageTranslationError(batchErrors: string[] = []): string {
  const firstError = batchErrors.find((error) => error.trim())?.replace(/^batch \d+:\s*/i, '').trim();
  return [
    'Excel 翻译失败：翻译模型未返回任何有效译文。',
    firstError ? `首个模型错误：${firstError}` : '',
    '请确认本地模型/VPN/API Key 可用后重试。'
  ]
    .filter(Boolean)
    .join(' ');
}

export function extractTextFromCells(worksheet: XLSX.WorkSheet): Array<{ cell: string; text: string }> {
  const cells: Array<{ cell: string; text: string }> = [];
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[cellAddress];
      
      if (cell && cell.t !== 'e') {
        const displayValue = cell.w ?? cell.v;
        const text = displayValue === undefined || displayValue === null ? '' : String(displayValue).trim();
        if (text && text.length > 0) {
          cells.push({ cell: cellAddress, text });
        }
      }
    }
  }

  return cells;
}

function buildTranslationPrompt(texts: string[]): string {
  const items = texts
    .map((text, i) => `${i + 1}. "${text}"`)
    .join('\n');
  return `你是一个专业的外贸文档翻译专家。请将以下英文翻译成中文，保持专业术语和专业语气。

请翻译以下内容，并仅返回一个 JSON 数组，按相同顺序排列翻译结果：

${items}

返回格式：["翻译1", "翻译2", "翻译3", ...]`;
}

type BatchTranslationResult = {
  translations: string[];
  parseFailed: boolean;
  error?: string;
};

function normalizeTranslationArray(values: unknown[], texts: string[]): string[] {
  const translations = values.map((value, index) => {
    const translated = String(value ?? '').trim();
    return translated || texts[index] || '';
  });

  while (translations.length < texts.length) {
    translations.push(texts[translations.length] ?? '');
  }

  return translations.slice(0, texts.length);
}

export function normalizeTranslationFallback(responseText: string, texts: string[]): BatchTranslationResult {
  const translations = responseText
    .split('\n')
    .map(line => line.replace(/^\d+[\.\)]\s*/, '').replace(/^["']|["']$/g, '').trim())
    .filter(line => line.length > 0);

  return {
    translations: normalizeTranslationArray(translations, texts),
    parseFailed: true,
    error: 'parse_failed'
  };
}

async function translateBatch(
  texts: string[],
  modelOverride?: string
): Promise<BatchTranslationResult> {
  if (texts.length === 0) {
    return { translations: [], parseFailed: false };
  }

  const prompt = buildTranslationPrompt(texts);

  try {
    const result = await callTranslationModelChat({
      messages: [{ role: 'user', content: prompt }],
      modelOverride
    });

    const responseText = result.text.trim();
    
    let translations: unknown[];
    try {
      // Extract JSON array from response if it contains extra text
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        translations = JSON.parse(jsonMatch[0]);
      } else {
        translations = JSON.parse(responseText);
      }

      if (!Array.isArray(translations)) {
        throw new Error('Response is not an array');
      }

      if (translations.length !== texts.length) {
        console.warn(`Translation count mismatch: expected ${texts.length}, got ${translations.length}`);
      }

      return {
        translations: normalizeTranslationArray(translations, texts),
        parseFailed: false
      };
    } catch (parseError) {
      console.error('Failed to parse translation response as JSON:', parseError);
      return normalizeTranslationFallback(responseText, texts);
    }
  } catch (error) {
    console.error('Translation API call failed:', error);
    return {
      translations: texts,
      parseFailed: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function createOutputPath(originalPath: string): string {
  const exportsDir = join(process.cwd(), '.tmp', 'exports');
  const basename = originalPath.replace(/\.[^/.]+$/, '').split('/').pop() || 'output';
  const hash = createHash('sha256').update(originalPath + Date.now()).digest('hex').slice(0, 8);
  return join(exportsDir, `${basename}_翻译_${hash}.xlsx`);
}

export async function translateExcelFile(
  input: ExcelTranslationInput
): Promise<ExcelTranslationResult> {
  const startTime = Date.now();

  try {
    // Read the Excel file
    const workbook = XLSX.readFile(input.filePath);
    const sheetNames = workbook.SheetNames;

    if (sheetNames.length === 0) {
      return {
        success: false,
        originalFileName: input.fileName,
        translatedFileName: '',
        translatedFilePath: '',
        sheets: [],
        totalCells: 0,
        translatedCells: 0,
        failedCells: 0,
        executionTimeMs: Date.now() - startTime,
        error: 'Excel file contains no sheets'
      };
    }

    const results: ExcelTranslationResult = {
      success: true,
      originalFileName: input.fileName,
      translatedFileName: '',
      translatedFilePath: '',
      sheets: [],
      totalCells: 0,
      translatedCells: 0,
      failedCells: 0,
      executionTimeMs: 0
    };

    // Process each sheet
    for (const sheetName of sheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const cells = extractTextFromCells(worksheet);
      
      if (cells.length === 0) {
        results.sheets.push({
          sheetName,
          rowCount: 0,
          columnCount: 0,
          translatedCells: 0,
          failedCells: 0
        });
        continue;
      }

      // Get sheet dimensions
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      const rowCount = range.e.r - range.s.r + 1;
      const columnCount = range.e.c - range.s.c + 1;

      // Extract texts for translation
      const textsToTranslate = cells.map(c => c.text);
      
      // Translate in batches of 20 to avoid token limits
      const batchSize = 20;
      const allTranslations: string[] = [];
      const batchErrors: string[] = [];
      let parseFailedBatches = 0;

      for (let i = 0; i < textsToTranslate.length; i += batchSize) {
        const batch = textsToTranslate.slice(i, i + batchSize);
        const batchResult = await translateBatch(batch, input.translationModelOverride);
        if (batchResult.parseFailed) {
          parseFailedBatches++;
        }
        if (batchResult.error) {
          batchErrors.push(`batch ${Math.floor(i / batchSize) + 1}: ${batchResult.error}`);
        }
        allTranslations.push(...batchResult.translations);
      }

      // Add translation column to the sheet
      // Compute a column letter beyond the rightmost existing column
      const translationColIndex = range.e.c + 1;
      let translatedCount = 0;
      let failedCount = 0;

      cells.forEach((cell, index) => {
        const translatedText = allTranslations[index];
        
        if (translatedText && translatedText !== cell.text) {
          // Decode the original cell address to get row/column, then replace column
          const cellRef = XLSX.utils.decode_cell(cell.cell);
          const translationCellAddress = XLSX.utils.encode_cell({
            r: cellRef.r,
            c: translationColIndex
          });

          // Set the translated value
          worksheet[translationCellAddress] = {
            t: 's',
            v: translatedText
          };
          translatedCount++;
        } else {
          failedCount++;
        }
      });

      // Update sheet range to include the new column
      if (worksheet['!ref']) {
        const newRange = XLSX.utils.decode_range(worksheet['!ref']);
        newRange.e.c = translationColIndex;
        worksheet['!ref'] = XLSX.utils.encode_range(newRange);
      }

      // Add header for the translation column
      const headerCellAddress = XLSX.utils.encode_cell({
        r: range.s.r,
        c: translationColIndex
      });
      worksheet[headerCellAddress] = {
        t: 's',
        v: '翻译'
      };

      results.sheets.push({
        sheetName,
        rowCount,
        columnCount: columnCount + 1, // +1 for the translation column
        translatedCells: translatedCount,
        failedCells: failedCount
      });

      results.totalCells += cells.length;
      results.translatedCells += translatedCount;
      results.failedCells += failedCount;
      results.parseFailedBatches = (results.parseFailedBatches ?? 0) + parseFailedBatches;
      if (batchErrors.length > 0) {
        results.translationBatchErrors = [
          ...(results.translationBatchErrors ?? []),
          ...batchErrors
        ];
      }
    }

    if (
      results.totalCells > 0 &&
      results.translatedCells === 0 &&
      (results.translationBatchErrors?.length ?? 0) > 0
    ) {
      results.success = false;
      results.executionTimeMs = Date.now() - startTime;
      results.error = buildZeroCoverageTranslationError(results.translationBatchErrors);
      console.error(
        `[excel-translation] Failed: 0/${results.totalCells} cells translated; ${results.translationBatchErrors?.length ?? 0} batch errors`
      );
      return results;
    }

    // Create output file path
    const outputPath = createOutputPath(input.filePath);
    results.translatedFilePath = outputPath;
    results.translatedFileName = outputPath.split('/').pop() || '';

    // Ensure directory exists
    await mkdir(dirname(outputPath), { recursive: true });

    // Write the translated workbook
    XLSX.writeFile(workbook, outputPath);

    results.executionTimeMs = Date.now() - startTime;
    console.log(
      `[excel-translation] Done: ${results.translatedCells}/${results.totalCells} cells translated across ${results.sheets.length} sheets in ${results.executionTimeMs}ms`
    );
    return results;

  } catch (error) {
    console.error('Excel translation failed:', error);
    return {
      success: false,
      originalFileName: input.fileName,
      translatedFileName: '',
      translatedFilePath: '',
      sheets: [],
      totalCells: 0,
      translatedCells: 0,
      failedCells: 0,
      executionTimeMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function translateExcelFileFromBuffer(
  buffer: Buffer,
  fileName: string,
  outputPath: string,
  translationModelOverride?: string
): Promise<ExcelTranslationResult> {
  // Create a temporary file path
  const tempPath = join(process.cwd(), '.tmp', `${Date.now()}-${fileName.replace(/[^\w.-]+/g, '_')}`);

  try {
    // Ensure directory exists
    await mkdir(dirname(tempPath), { recursive: true });

    // Write buffer to temp file
    await writeFile(tempPath, buffer);

    // Translate the file
    const result = await translateExcelFile({
      filePath: tempPath,
      fileName,
      translationModelOverride
    });

    // Move the result to the desired output path if successful
    if (result.success && result.translatedFilePath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await rename(result.translatedFilePath, outputPath);
      result.translatedFilePath = outputPath;
      result.translatedFileName = outputPath.split('/').pop() || '';
    }

    return result;
  } catch (error) {
    throw error;
  } finally {
    // Always clean up temp file
    await unlink(tempPath).catch(() => {});
  }
}

/**
 * Build a stable relative download URL for a translated xlsx output path.
 */
export function buildExcelArtifactUrl(translatedFilePath: string | null | undefined): string | null {
  if (!translatedFilePath) return null;
  // Normalize to a relative path from project root
  const cwd = process.cwd();
  let relative = translatedFilePath;
  if (translatedFilePath.startsWith(cwd)) {
    relative = translatedFilePath.slice(cwd.length);
  }
  return `/api/assistant/artifacts?path=${encodeURIComponent(relative)}`;
}
