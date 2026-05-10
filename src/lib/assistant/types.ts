import type { FeedbackCategory, FeedbackPriority } from '@/lib/feedback/types';
import type { PdfTranslationSkillDisclosure } from '@/lib/assistant/disclosure';

export type AssistantChannel = 'web' | 'feishu' | 'slack' | 'wecom';

export type ChannelMessageKind = 'text' | 'markdown' | 'card';

export type ChannelMessage = {
  kind: ChannelMessageKind;
  content: string;
  title?: string;
  sections?: ArtifactSection[];
  buttons?: { label: string; action: string; value: string }[];
  metadata?: Record<string, unknown>;
};

export type AssistantRole = 'sales' | 'supervisor';

export type TaskType = 'bom' | 'feedback' | 'reply';

export type WorkspaceFeedbackSource = {
  taskId?: string | null;
  fileName: string;
  pageNumber?: number;
  segmentId?: string;
  sourceText?: string;
  currentTranslation?: string;
};

export type WorkspaceFeedbackDraft = {
  category: FeedbackCategory;
  priority: FeedbackPriority;
  source: WorkspaceFeedbackSource & {
    taskId?: string;
    expectedTranslation?: string;
  };
  reporter: string;
  tags: string[];
};

export type TaskPageDirectiveAction = 'force_vision' | 'skip_translation' | 'keep_original';

export type TaskPageDirective = {
  pageNumber: number;
  action: TaskPageDirectiveAction;
  note?: string;
};

export type TaskPageRenderStyle = 'inline' | 'panel';

export type TaskPageRenderStyleDirective = {
  pageNumber: number;
  renderStyle: TaskPageRenderStyle;
};

export type TaskPageOverrides = {
  forceVisionPages?: number[];
  skipTranslationPages?: number[];
  pageDirectives?: TaskPageDirective[];
  pageRenderStyles?: TaskPageRenderStyleDirective[];
};

export type TaskReworkScope = 'pages';

export type TaskReworkMode = 'retranslate' | 'revise';

export type TaskReworkRequest = {
  scope: TaskReworkScope;
  pageNumbers?: number[];
  instruction: string;
  note?: string;
  sourceFeedbackIds?: string[];
  /** rework mode: 'retranslate' = only re-translate (default), 'revise' = re-run vision + translate */
  mode?: TaskReworkMode;
};

export type TaskExecutionControl = {
  pageOverrides?: TaskPageOverrides;
  rework?: TaskReworkRequest | null;
};

export type TaskRevisionKind = 'base' | 'override' | 'rework';
export type TaskRevisionState = 'running' | 'ready' | 'failed' | 'superseded';

export type TaskRevision = {
  id: string;
  taskId: string;
  parentRevisionId?: string | null;
  kind: TaskRevisionKind;
  createdAt: string;
  createdBy: AssistantRole | 'external_agent';
  state: TaskRevisionState;
  reason?: string;
  control?: TaskExecutionControl;
  targetPages?: number[];
  sourceFeedbackIds?: string[];
};

export type UploadedFile = {
  name: string;
  size: number;
  type: string;
  contentText?: string;
  localPath?: string;
  storagePath?: string;
};

/** Source of extracted segment: text layer, vision/OCR, or merged. */
export type SegmentSourceType = 'text_layer' | 'vision' | 'merged';

/** Confidence and provenance for extraction (Phase 1 / V2). */
export type SegmentExtractionMeta = {
  sourceType: SegmentSourceType;
  layoutConfidence: number;
  mergeConfidence: number;
  regionId?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  pageLayoutType?: 'sketch' | 'table' | 'reference' | 'mixed';
};

export type SkillRiskLevel = 'low' | 'medium' | 'high';

export type TaskStatus =
  | 'draft'
  | 'validating'
  | 'blocked'
  | 'pending_user_confirmation'
  | 'pending_supervisor_review'
  | 'approved'
  | 'returned'
  | 'exported'
  | 'archived'
  | 'failed';

export type ReviewStatus =
  | 'not_submitted'
  | 'pending_review'
  | 'returned'
  | 'approved';

export type SkillDefinition = {
  id: string;
  name: string;
  purpose: string;
  inputRequirements: string[];
  outputSchema: string[];
  reviewCheckpoints: string[];
  composableWith: string[];
  riskLevel: SkillRiskLevel;
  taskTypes: TaskType[];
};

export type WorkflowTemplate = {
  id: string;
  name: string;
  goal: string;
  scenarios: string[];
  steps: string[];
  allowedSkills: string[];
  blockingConditions: string[];
  deliverables: string[];
  taskType: TaskType;
  status: 'draft' | 'published' | 'archived';
};

export type ValidationIssue = {
  id: string;
  severity: 'warning' | 'blocking';
  title: string;
  message: string;
};

export type ExecutionPlanStep = {
  id: string;
  name: string;
  skillId: string;
  status: 'ready' | 'completed' | 'blocked';
  summary: string;
};

export type PendingConfirmation = {
  id: string;
  label: string;
  reason: string;
  owner: AssistantRole;
  status: 'required' | 'recommended' | 'confirmed' | 'returned';
  updatedBy?: string;
  updatedAt?: string;
};

export type ArtifactField = {
  label: string;
  value: string;
  citation?: string;
  confirmationStatus?: 'required' | 'recommended' | 'confirmed';
  richTextHtml?: string;
  structuredData?: unknown;
};

export type ArtifactSection = {
  title: string;
  kind: 'table' | 'list' | 'text';
  summary: string;
  fields: ArtifactField[];
};

export type AuditEvent = {
  label: string;
  detail: string;
};

export type ReviewEntry = {
  decision: 'approved' | 'returned';
  reviewer: AssistantRole;
  comment?: string;
  createdAt: string;
};

export type PdfArtifactLinkEntry = {
  fileName: string;
  documentMainType: string;
  outputStrategy: string;
  /** 主入口：表格类优先 Excel，线稿类优先预览 */
  primary: 'bilingual_xlsx' | 'annotated_preview';
  bilingualXlsxUrl: string | null;
  annotatedPreviewUrl: string | null;
  /** 原文档标注式翻译 PDF（非列表表格 PDF），供 Ting/UAT 直接交付。 */
  annotatedPdfUrl?: string | null;
  tableStylePdfUrl?: string | null;
};

export type HumanReviewHint = {
  id: string;
  title: string;
  reason: string;
  priority: 'high' | 'medium';
  pageNumbers: number[];
  examples?: string[];
};

export type HumanReviewGuide = {
  summary: string;
  focusPages: number[];
  suggestedAction: string;
  hints: HumanReviewHint[];
};

export type ExcelTranslationSkillPayload = {
  kind: 'excel_translation_skill_v1';
  fileName: string;
  taskType: 'feedback';
  summary: string;
  reviewRequired: boolean;
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
  /** 翻译下载链接 */
  downloadUrl?: string;
  error?: string;
};

export type PdfTranslationSkillPayload = {
  kind: 'pdf_translation_skill_v1';
  fileName: string;
  taskType: 'feedback';
  documentMainType: string;
  outputStrategy: string;
  summary: string;
  reviewRequired: boolean;
  /**
   * 面向所有外部消费方的统一 AI 披露对象；consumer 应直接渲染其中的 zh/en 文案。
   * 具体口径见 docs/product/07-ai-disclosure-policy.md。
   */
  disclosure?: PdfTranslationSkillDisclosure;
  /** 唯一正式交付入口：原文档标注式翻译 PDF。 */
  deliveryPdfUrl?: string | null;
  artifactLinks: PdfArtifactLinkEntry[];
  humanReviewGuide?: HumanReviewGuide;
  /** 页面反馈预填的唯一主链来源，优先来自 translation snapshot。 */
  feedbackSource?: WorkspaceFeedbackSource;
  revision?: {
    id: string;
    kind: TaskRevisionKind;
    parentRevisionId?: string | null;
    revisionCount?: number;
    currentControl?: TaskExecutionControl | null;
  };
  snapshot?: {
    version: 'translation_snapshot_v1';
    fileName: string;
    documentMainType: string;
    outputStrategy: 'annotated_pdf';
    generatedAt: string;
    items?: Array<{
      id: string;
      pageNumber: number;
      regionId: string;
      en: string;
      zh?: string;
      renderMode: 'inline' | 'footnote';
      bbox?: { x: number; y: number; w: number; h: number };
      sourceType: string;
      confidence: number;
      pageLayoutType?: string;
    }>;
  };
  diagnostics: {
    translatedSegmentCount: number;
    translationCoveragePct: number;
    businessSegmentCount?: number;
    translatedBusinessSegmentCount?: number;
    businessTranslationCoveragePct?: number;
    businessPreviewReady?: boolean;
    skippedTranslationPages?: number[];
    activeModel?: string;
    activeProvider?: string;
  };
};

export type AssistantReplyMetadata = {
  needsHumanReview: boolean;
  providerHits?: string[];
  modelHits?: string[];
  activeProvider?: string;
  activeModel?: string;
  translationMode?: 'fixture' | 'whole-document' | 'section-chunked' | 'real';
  asyncProgress?: {
    phase: 'queued' | 'running' | 'completed' | 'failed';
    stage?: string;
    submittedAt: string;
    startedAt?: string;
    updatedAt?: string;
    completedAt?: string;
  };
  /** 页面可直接渲染的下载/预览入口（与 finalArtifact 中 artifactLinks 一致） */
  pdfArtifactLinks?: PdfArtifactLinkEntry[];
  /** 脱敏说明：为何 A/B 可能 fallback（不含密钥与原始响应） */
  pipelineFallbackHints?: string[];
  /** 给业务员的结构化人工复核建议，供页面/skill/Ting 外贸助手共用。 */
  humanReviewGuide?: HumanReviewGuide;
  /** 稳定的 PDF/Excel skill 输出协议，供页面/skill/Ting 外贸助手共用。 */
  skillPayload?: PdfTranslationSkillPayload | ExcelTranslationSkillPayload;
  taskIteration?: {
    currentRevisionId?: string;
    baseRevisionId?: string;
    revisionCount?: number;
    currentControl?: TaskExecutionControl | null;
    latestRevision?: TaskRevision;
  };
  translationTiming?: {
    totalMs: number;
    sourceBuildMs?: number;
    renderPrepMs?: number;
    stages: Array<{
      id: string;
      label: string;
      durationMs: number;
      chunkCount?: number;
      provider?: string;
    }>;
  };
};

export type AssistantRequest = {
  channel: AssistantChannel;
  role: AssistantRole;
  question: string;
  files: UploadedFile[];
  selectedSkillIds: string[];
  selectedTemplateId?: string | null;
  modelOverride?: string;
  visionModelOverride?: string;
  translationModelOverride?: string;
  taskType?: TaskType;
  conversationId?: string;
  userId?: string;
  rawPayload?: unknown;
};

export type TaskRecord = {
  id: string;
  title: string;
  role: AssistantRole;
  taskType: TaskType;
  taskTypeLabel: string;
  question: string;
  files: UploadedFile[];
  selectedSkillIds: string[];
  selectedTemplateId?: string | null;
  modelOverride?: string;
  visionModelOverride?: string;
  translationModelOverride?: string;
  status: TaskStatus;
  reviewStatus: ReviewStatus;
  summary: string;
  pendingConfirmationCount: number;
  blockingIssueCount: number;
  currentRevisionId?: string;
  baseRevisionId?: string;
  revisionCount?: number;
  lineageMode?: 'in_task_revision';
  reviewComment?: string;
  reviewedBy?: AssistantRole;
  createdAt: string;
  updatedAt: string;
};

export type AssistantReply = {
  intent: TaskType;
  intentLabel: string;
  role: AssistantRole;
  status: TaskStatus;
  statusLabel: string;
  reviewStatus: ReviewStatus;
  reviewStatusLabel: string;
  summary: string;
  nextActions: string[];
  riskAlerts: string[];
  draftDirection: string;
  taskType: TaskType;
  taskTypeLabel: string;
  skillCatalog: SkillDefinition[];
  templates: WorkflowTemplate[];
  selectedSkills: SkillDefinition[];
  selectedTemplate: WorkflowTemplate | null;
  executionPlan: ExecutionPlanStep[];
  pendingConfirmations: PendingConfirmation[];
  blockingIssues: ValidationIssue[];
  validationIssues: ValidationIssue[];
  artifacts: ArtifactSection[];
  auditTrail: AuditEvent[];
  reviewHistory?: ReviewEntry[];
  task?: TaskRecord;
  recentTasks?: TaskRecord[];
  metadata?: AssistantReplyMetadata;
  finalArtifact?: string;
};
