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

export type UploadedFile = {
  name: string;
  size: number;
  type: string;
  contentText?: string;
  storagePath?: string;
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

export type AssistantReplyMetadata = {
  needsHumanReview: boolean;
  providerHits?: string[];
  modelHits?: string[];
  activeProvider?: string;
  activeModel?: string;
  translationMode?: 'real' | 'fixture' | 'whole-document' | 'section-chunked';
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
  taskType?: TaskType;
  modelOverride?: string;
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
  status: TaskStatus;
  reviewStatus: ReviewStatus;
  summary: string;
  pendingConfirmationCount: number;
  blockingIssueCount: number;
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
