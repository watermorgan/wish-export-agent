/**
 * AI 披露契约（PR-1 · payload 层）
 *
 * 本模块统一产出 `PdfTranslationSkillDisclosure` 对象，保证所有对外消费方
 * （Web 工作台、Ting 适配层、未来第二个 consumer）在同一口径下渲染
 * “内容由 AI 生成 · 未经人工复核不得直接对外发送” 披露。
 *
 * 设计约束：
 * - 默认文案为 80 分工程稿；最终对外文案由 docs/product/07-ai-disclosure-policy.md 固化。
 * - 字段只新增，不 rename；`watermarkVersion` 预留给 PR-2（PDF/xlsx 水印）。
 * - approved 任务视为已人工复核：`humanReviewRequired=false`、`notForExternalSendWithoutReview=false`。
 */

export type PdfTranslationSkillDisclosure = {
  /** 固定值：标识内容来源为 AI 生成。 */
  contentOrigin: 'ai_generated';
  /** 是否仍需人工复核。task.reviewStatus !== 'approved' 时为 true。 */
  humanReviewRequired: boolean;
  /** 是否禁止未经复核直接对外发送。task.reviewStatus !== 'approved' 时为 true。 */
  notForExternalSendWithoutReview: boolean;
  /** 中文披露文案，consumer 可直接渲染。 */
  disclosureZh: string;
  /** 英文披露文案，consumer 可直接渲染。 */
  disclosureEn: string;
  /**
   * 披露水印版本：
   * - null：本次产物未携带披露水印（PR-1 阶段 PDF/xlsx 尚未渲染水印）
   * - 'v1'：PR-2 之后 PDF 页脚 + xlsx Summary 已带统一披露水印
   */
  watermarkVersion: 'v1' | null;
  /** 披露字段生成时间，供审计。 */
  generatedAt: string;
};

export const AI_DISCLOSURE_TEXT_ZH =
  '本内容由 AI 翻译生成，尚未经过人工复核，不得直接作为对外承诺或正式翻译件使用。';

export const AI_DISCLOSURE_TEXT_EN =
  'This content is AI-generated and has not been human-reviewed. Do not send externally or treat as a binding translation without human verification.';

export const AI_DISCLOSURE_TEXT_APPROVED_ZH =
  '本内容由 AI 翻译生成，已通过人工审核；对外使用前请再次确认商务承诺一致。';

export const AI_DISCLOSURE_TEXT_APPROVED_EN =
  'This content is AI-generated and has been human-reviewed; reconfirm any commercial commitments before external use.';

export function buildAiDisclosure(params?: {
  reviewStatus?: string;
  generatedAt?: string;
  watermarkVersion?: 'v1' | null;
}): PdfTranslationSkillDisclosure {
  const isApproved = params?.reviewStatus === 'approved';
  return {
    contentOrigin: 'ai_generated',
    humanReviewRequired: !isApproved,
    notForExternalSendWithoutReview: !isApproved,
    disclosureZh: isApproved ? AI_DISCLOSURE_TEXT_APPROVED_ZH : AI_DISCLOSURE_TEXT_ZH,
    disclosureEn: isApproved ? AI_DISCLOSURE_TEXT_APPROVED_EN : AI_DISCLOSURE_TEXT_EN,
    watermarkVersion: params?.watermarkVersion ?? null,
    generatedAt: params?.generatedAt ?? new Date().toISOString()
  };
}

/**
 * 当前披露水印开关。环境变量 EXPORT_AGENT_AI_DISCLOSURE=off 时关闭渲染侧水印；
 * 其它值（包括未设置）均视为开启。
 */
export function isDisclosureWatermarkEnabled(): boolean {
  const raw = process.env.EXPORT_AGENT_AI_DISCLOSURE;
  if (typeof raw !== 'string') return true;
  return raw.trim().toLowerCase() !== 'off';
}

/**
 * 构造统一的 footer / watermark 文字。coverage 与 generatedAt 均可选，
 * 缺失时跳过对应分段，避免出现 "Coverage NaN%" 这种不体面的文案。
 */
export function buildDisclosureWatermarkText(params: {
  coveragePct?: number | null;
  generatedAt?: string | null;
}): string {
  const parts: string[] = ['AI Translation Draft', 'Human Review Required'];
  if (typeof params.coveragePct === 'number' && Number.isFinite(params.coveragePct)) {
    parts.push(`Coverage ${Math.round(params.coveragePct)}%`);
  }
  if (typeof params.generatedAt === 'string' && params.generatedAt) {
    parts.push(`Generated ${params.generatedAt}`);
  }
  return parts.join(' · ');
}

export function isPdfTranslationSkillDisclosure(
  value: unknown
): value is PdfTranslationSkillDisclosure {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.contentOrigin === 'ai_generated' &&
    typeof candidate.humanReviewRequired === 'boolean' &&
    typeof candidate.notForExternalSendWithoutReview === 'boolean' &&
    typeof candidate.disclosureZh === 'string' &&
    typeof candidate.disclosureEn === 'string' &&
    (candidate.watermarkVersion === 'v1' || candidate.watermarkVersion === null) &&
    typeof candidate.generatedAt === 'string'
  );
}
