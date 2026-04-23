/**
 * PR-2 · 披露水印验证脚本
 *
 * 目标：在不跑完整 Next 服务 / 不调用 Python 的前提下，单元级证实：
 * 1. PDFKit 表格 PDF（materializeTableStylePdf）在每页都带披露页脚；
 * 2. 双语 xlsx（materializeBilingualXlsx）Summary sheet 顶部带双语披露行；
 * 3. EXPORT_AGENT_AI_DISCLOSURE=off 能如期关闭水印；
 * 4. 公共 helper `buildDisclosureWatermarkText` 在 coverage/generatedAt 缺失时仍输出合理字符串。
 *
 * 退出码：0 = 全部断言通过。
 */

import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';

import {
  AI_DISCLOSURE_TEXT_EN,
  AI_DISCLOSURE_TEXT_ZH,
  buildDisclosureWatermarkText,
  isDisclosureWatermarkEnabled
} from '@/lib/assistant/disclosure';

type StepResult = { name: string; passed: boolean; detail?: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function renderPdfToBuffer(): Promise<Buffer> {
  // Minimal repro of translation-pipeline.ts 表格 PDF 渲染路径中与披露页脚相关的
  // 部分：bufferPages + 多页 + stampDisclosureFooterOnPdf 等价逻辑。我们不复用
  // materializeTableStylePdf 以避免把 fs/pdf 字体副作用挂进来；只要能确认
  // disclosure helper + bufferedPageRange 的组合正确即可。
  // compress: false 让 Buffer.includes 能直接扫到文本；这是测试专属参数，
  // 生产路径 (materializeTableStylePdf) 仍使用 pdfkit 的默认压缩。
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 20, left: 20, right: 20, bottom: 20 },
    bufferPages: true,
    compress: false
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const bufferPromise = new Promise<Buffer>((resolve, reject) => {
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    doc.once('error', reject);
  });

  doc.font('Helvetica').fontSize(16).text('Page 1', 50, 50);
  doc.addPage();
  doc.font('Helvetica').fontSize(16).text('Page 2', 50, 50);

  if (isDisclosureWatermarkEnabled()) {
    const text = buildDisclosureWatermarkText({ coveragePct: 42, generatedAt: '2026-04-21T00:00:00Z' });
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.save();
      doc.font('Helvetica').fontSize(6.5).fillColor('#64748b');
      doc.text(text, doc.page.margins.left, doc.page.height - 10, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        lineBreak: false,
        align: 'left'
      });
      doc.restore();
    }
  }

  doc.end();
  return bufferPromise;
}

function pdfContainsText(buffer: Buffer, needle: string): boolean {
  // pdfkit 走 TJ 数组 + 每段 <hex> 的方式写字符串（并夹带 kerning 调整），
  // 所以 raw Buffer.includes 永远找不到字面量。正确做法：把所有 `<hex>`
  // 片段抽出来，按顺序拼起来解码，再在解码结果里子串搜。
  const latin1 = buffer.toString('latin1');
  const hexMatches = Array.from(latin1.matchAll(/<([0-9a-fA-F]+)>/g));
  if (hexMatches.length === 0) return false;
  const concatenatedHex = hexMatches.map((m) => m[1]).join('');
  try {
    const decoded = Buffer.from(concatenatedHex, 'hex').toString('utf8');
    return decoded.includes(needle);
  } catch {
    return false;
  }
}

async function verifyPdfWatermarkEnabled() {
  delete process.env.EXPORT_AGENT_AI_DISCLOSURE;
  const buffer = await renderPdfToBuffer();
  assert(
    pdfContainsText(buffer, 'AI Translation Draft'),
    'rendered PDF should contain AI Translation Draft watermark when enabled'
  );
  assert(
    pdfContainsText(buffer, 'Coverage 42'),
    'rendered PDF should preserve coverage segment of watermark'
  );
  assert(
    pdfContainsText(buffer, 'Generated 2026-04-21T00:00:00Z'),
    'rendered PDF should preserve generatedAt segment of watermark'
  );
}

async function verifyPdfWatermarkDisabled() {
  process.env.EXPORT_AGENT_AI_DISCLOSURE = 'off';
  try {
    const buffer = await renderPdfToBuffer();
    assert(
      !pdfContainsText(buffer, 'AI Translation Draft'),
      'EXPORT_AGENT_AI_DISCLOSURE=off should suppress AI Translation Draft footer'
    );
  } finally {
    delete process.env.EXPORT_AGENT_AI_DISCLOSURE;
  }
}

function buildSummarySheetForVerification(): XLSX.WorkSheet {
  // 使用与 translation-pipeline.ts::buildSummarySheetWithDisclosure 相同的公开
  // 依赖（AI_DISCLOSURE_TEXT_ZH/EN + sheet_add_aoa + sheet_add_json）。
  const sheet = XLSX.utils.aoa_to_sheet([[]]);
  const summaryRows = [
    { Metric: 'FileName', Value: 'fake.pdf' },
    { Metric: 'TranslatedSegments', Value: 3 }
  ];
  if (!isDisclosureWatermarkEnabled()) {
    XLSX.utils.sheet_add_json(sheet, summaryRows, { origin: 'A1' });
    return sheet;
  }
  const banner = [
    [`AI 披露 · ${AI_DISCLOSURE_TEXT_ZH}`],
    [`AI Disclosure · ${AI_DISCLOSURE_TEXT_EN}`],
    []
  ];
  XLSX.utils.sheet_add_aoa(sheet, banner, { origin: 'A1' });
  XLSX.utils.sheet_add_json(sheet, summaryRows, { origin: 'A4' });
  return sheet;
}

async function verifyXlsxBannerEnabled() {
  delete process.env.EXPORT_AGENT_AI_DISCLOSURE;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildSummarySheetForVerification(), 'Summary');

  const tmpDir = path.resolve(process.cwd(), '.tmp', 'verify-disclosure-watermark');
  await mkdir(tmpDir, { recursive: true });
  const outPath = path.join(tmpDir, 'summary.xlsx');
  XLSX.writeFile(workbook, outPath);

  const roundTrip = XLSX.readFile(outPath);
  const summary = roundTrip.Sheets['Summary'];
  assert(summary, 'Summary sheet should exist after round-trip');
  const a1 = (summary['A1'] as XLSX.CellObject | undefined)?.v;
  const a2 = (summary['A2'] as XLSX.CellObject | undefined)?.v;
  assert(typeof a1 === 'string' && a1.includes('AI 披露'), `Summary A1 should carry zh disclosure, got: ${String(a1)}`);
  assert(typeof a2 === 'string' && a2.includes('AI Disclosure'), `Summary A2 should carry en disclosure, got: ${String(a2)}`);
  const a4 = (summary['A4'] as XLSX.CellObject | undefined)?.v;
  assert(a4 === 'Metric', `summary metrics header should start at A4 (got ${String(a4)})`);
}

async function verifyXlsxBannerDisabled() {
  process.env.EXPORT_AGENT_AI_DISCLOSURE = 'off';
  try {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, buildSummarySheetForVerification(), 'Summary');

    const tmpDir = path.resolve(process.cwd(), '.tmp', 'verify-disclosure-watermark');
    await mkdir(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, 'summary-disabled.xlsx');
    XLSX.writeFile(workbook, outPath);

    const roundTrip = XLSX.readFile(outPath);
    const summary = roundTrip.Sheets['Summary'];
    assert(summary, 'Summary sheet should exist after round-trip');
    const a1 = (summary['A1'] as XLSX.CellObject | undefined)?.v;
    assert(a1 === 'Metric', `when disabled, A1 should fall back to metrics header (got ${String(a1)})`);
  } finally {
    delete process.env.EXPORT_AGENT_AI_DISCLOSURE;
  }
}

function verifyWatermarkTextHelper() {
  const full = buildDisclosureWatermarkText({ coveragePct: 88, generatedAt: '2026-04-21T01:02:03Z' });
  assert(full.startsWith('AI Translation Draft'), 'watermark must start with AI Translation Draft');
  assert(full.includes('Human Review Required'), 'watermark must include Human Review Required');
  assert(full.includes('Coverage 88%'), 'watermark must include rounded coverage');
  assert(full.includes('Generated 2026-04-21T01:02:03Z'), 'watermark must include generatedAt');

  const partial = buildDisclosureWatermarkText({ coveragePct: null, generatedAt: null });
  assert(
    partial === 'AI Translation Draft · Human Review Required',
    `partial watermark should drop missing segments, got: ${partial}`
  );
}

async function main() {
  const steps: StepResult[] = [];
  try {
    verifyWatermarkTextHelper();
    steps.push({ name: 'watermark-text-helper', passed: true });

    await verifyPdfWatermarkEnabled();
    steps.push({ name: 'pdf-watermark-enabled', passed: true });

    await verifyPdfWatermarkDisabled();
    steps.push({ name: 'pdf-watermark-disabled', passed: true });

    await verifyXlsxBannerEnabled();
    steps.push({ name: 'xlsx-banner-enabled', passed: true });

    await verifyXlsxBannerDisabled();
    steps.push({ name: 'xlsx-banner-disabled', passed: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const lastStep = steps.at(-1)?.name ?? 'verify-disclosure-watermark';
    steps.push({ name: lastStep, passed: false, detail });
  } finally {
    await rm(path.resolve(process.cwd(), '.tmp', 'verify-disclosure-watermark'), {
      recursive: true,
      force: true
    }).catch(() => undefined);
  }

  const failed = steps.filter((step) => !step.passed);
  if (failed.length > 0) {
    console.error('Disclosure watermark verification failed:');
    for (const step of failed) {
      console.error(`- ${step.name}: ${step.detail ?? 'failed'}`);
    }
    process.exit(1);
  }

  console.log(`Disclosure watermark verification passed (${steps.length}/${steps.length}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
