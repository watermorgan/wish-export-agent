import type { PoolClient } from 'pg';
import {
  getSkillById,
  getTemplateById,
  skillCatalog,
  workflowTemplates
} from '@/lib/assistant/catalog';
import { hasDatabaseConfig, queryDb, withDbTransaction } from '@/lib/assistant/db';
import type {
  ArtifactSection,
  AssistantReply,
  AssistantRequest,
  AssistantRole,
  ExecutionPlanStep,
  PendingConfirmation,
  ReviewEntry,
  ReviewStatus,
  TaskRecord,
  TaskStatus,
  ValidationIssue
} from '@/lib/assistant/types';

type StoredTask = {
  record: TaskRecord;
  request: AssistantRequest;
  reply: AssistantReply;
};

export type TaskSnapshot = {
  task: TaskRecord;
  reply: AssistantReply;
  recentTasks: TaskRecord[];
};

type TaskRow = {
  id: string;
  title: string;
  role: TaskRecord['role'];
  task_type: TaskRecord['taskType'];
  task_type_label: string;
  channel: AssistantRequest['channel'];
  question: string;
  files: TaskRecord['files'];
  selected_skill_ids: string[];
  selected_template_id: string | null;
  status: TaskStatus;
  review_status: ReviewStatus;
  summary: string;
  draft_direction: string;
  next_actions: string[];
  risk_alerts: string[];
  pending_confirmation_count: number;
  blocking_issue_count: number;
  review_comment: string | null;
  reviewed_by: AssistantRole | null;
  conversation_id: string | null;
  user_id: string | null;
  request_payload: AssistantRequest;
  reply_payload: AssistantReply;
  raw_payload: unknown;
  created_at: string;
  updated_at: string;
};

type StepRow = {
  step_index: number;
  step_id: string;
  name: string;
  skill_id: string;
  status: ExecutionPlanStep['status'];
  summary: string;
};

type PendingConfirmationRow = {
  confirmation_index: number;
  confirmation_id: string;
  label: string;
  reason: string;
  owner: AssistantRole;
  status: PendingConfirmation['status'];
};

type ValidationIssueRow = {
  issue_index: number;
  issue_id: string;
  severity: ValidationIssue['severity'];
  title: string;
  message: string;
};

type ArtifactRow = {
  section_index: number;
  title: string;
  kind: ArtifactSection['kind'];
  summary: string;
  fields: ArtifactSection['fields'];
};

type AuditEventRow = {
  event_index: number;
  label: string;
  detail: string;
};

type ReviewRow = {
  decision: ReviewEntry['decision'];
  reviewer: AssistantRole;
  comment: string | null;
  created_at: string;
};

const taskStore = new Map<string, StoredTask>();

function deriveNeedsHumanReview(status: TaskStatus, pendingConfirmations: PendingConfirmation[]) {
  if (status === 'approved' || status === 'exported' || status === 'archived') {
    return false;
  }

  if (status === 'failed') {
    return true;
  }

  return pendingConfirmations.some((item) => item.status !== 'confirmed') || true;
}

export function canEditTaskStatus(status: TaskStatus) {
  return ['draft', 'validating', 'blocked', 'pending_user_confirmation', 'returned'].includes(
    status
  );
}

export function canUpdateConfirmationStatus(status: TaskStatus) {
  return ['pending_user_confirmation', 'returned'].includes(status);
}

export function canSubmitTaskStatus(status: TaskStatus) {
  return ['pending_user_confirmation', 'returned'].includes(status);
}

export function canReviewTaskStatus(status: TaskStatus) {
  return status === 'pending_supervisor_review';
}

export function canExportTaskStatus(status: TaskStatus) {
  return status === 'approved';
}

function createTaskId() {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createTaskTitle(question: string, taskTypeLabel: string) {
  const compact = question.trim().replace(/\s+/g, ' ');

  if (compact.length <= 28) {
    return compact;
  }

  return `${taskTypeLabel} · ${compact.slice(0, 28)}...`;
}

function nowIso() {
  return new Date().toISOString();
}

async function acquireTaskWriteLock(client: PoolClient, taskId: string) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [taskId]);
}

function sortTasks(tasks: StoredTask[]) {
  return [...tasks].sort(
    (left, right) =>
      new Date(right.record.updatedAt).getTime() - new Date(left.record.updatedAt).getTime()
  );
}

function listMemoryTasks() {
  return sortTasks([...taskStore.values()]).map((item) => item.record);
}

function getTaskStatusLabel(status: TaskStatus) {
  switch (status) {
    case 'draft':
      return '草稿';
    case 'validating':
      return '校验中';
    case 'blocked':
      return '已阻断';
    case 'pending_user_confirmation':
      return '待人工确认';
    case 'pending_supervisor_review':
      return '待主管审核';
    case 'approved':
      return '已审核通过';
    case 'returned':
      return '已退回';
    case 'exported':
      return '已导出';
    case 'archived':
      return '已归档';
    case 'failed':
      return '执行失败';
  }
}

function getReviewStatusLabel(reviewStatus: ReviewStatus) {
  switch (reviewStatus) {
    case 'not_submitted':
      return '未提交审核';
    case 'pending_review':
      return '待审核';
    case 'returned':
      return '已退回';
    case 'approved':
      return '已通过';
  }
}

function toTaskRecordFromRow(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    role: row.role,
    taskType: row.task_type,
    taskTypeLabel: row.task_type_label,
    question: row.question,
    files: row.files,
    selectedSkillIds: row.selected_skill_ids,
    selectedTemplateId: row.selected_template_id,
    modelOverride: row.request_payload.modelOverride,
    status: row.status,
    reviewStatus: row.review_status,
    summary: row.summary,
    pendingConfirmationCount: row.pending_confirmation_count,
    blockingIssueCount: row.blocking_issue_count,
    reviewComment: row.review_comment ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildTaskRecord(
  id: string,
  request: AssistantRequest,
  reply: AssistantReply,
  createdAt: string,
  updatedAt: string,
  overrides: Partial<TaskRecord> = {}
): TaskRecord {
  return {
    id,
    title: createTaskTitle(request.question, reply.taskTypeLabel),
    role: request.role,
    taskType: reply.taskType,
    taskTypeLabel: reply.taskTypeLabel,
    question: request.question,
    files: request.files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type
    })),
    selectedSkillIds: request.selectedSkillIds,
    selectedTemplateId: request.selectedTemplateId,
    modelOverride: request.modelOverride,
    status: reply.status,
    reviewStatus: reply.reviewStatus,
    summary: reply.summary,
    pendingConfirmationCount: reply.pendingConfirmations.filter(
      (item) => item.status !== 'confirmed'
    ).length,
    blockingIssueCount: reply.blockingIssues.length,
    createdAt,
    updatedAt,
    ...overrides
  };
}

function createStoredTask(
  id: string,
  request: AssistantRequest,
  reply: AssistantReply,
  createdAt: string,
  updatedAt: string,
  overrides: Partial<TaskRecord> = {}
): StoredTask {
  const record = buildTaskRecord(id, request, reply, createdAt, updatedAt, overrides);

  return {
    record,
    request,
    reply: {
      ...reply,
      task: record
    }
  };
}

function setStoredTask(stored: StoredTask) {
  taskStore.set(stored.record.id, stored);
  return stored;
}

function storeSnapshot(id: string, request: AssistantRequest, reply: AssistantReply) {
  const timestamp = nowIso();
  const stored = setStoredTask(createStoredTask(id, request, reply, timestamp, timestamp));

  return {
    task: stored.record,
    reply: stored.reply,
    recentTasks: listMemoryTasks()
  } satisfies TaskSnapshot;
}

function replaceStoredTask(
  taskId: string,
  request: AssistantRequest,
  reply: AssistantReply,
  createdAt: string
) {
  const updatedAt = nowIso();
  const stored = setStoredTask(
    createStoredTask(taskId, request, reply, createdAt, updatedAt, {
      reviewComment: undefined,
      reviewedBy: undefined
    })
  );

  return {
    task: stored.record,
    reply: stored.reply,
    recentTasks: listMemoryTasks()
  } satisfies TaskSnapshot;
}

function applyStoredTaskUpdates(
  existing: StoredTask,
  updates: {
    status?: TaskStatus;
    reviewStatus?: ReviewStatus;
    reviewComment?: string;
    reviewedBy?: AssistantRole;
    summary?: string;
  }
) {
  const updatedAt = nowIso();
  const status = updates.status ?? existing.record.status;
  const reviewStatus = updates.reviewStatus ?? existing.record.reviewStatus;
  const pendingConfirmations: PendingConfirmation[] =
    updates.reviewStatus === 'returned'
      ? existing.reply.pendingConfirmations.map((item) =>
          item.status === 'confirmed'
            ? item
            : {
                ...item,
                status: 'returned'
              }
        )
      : existing.reply.pendingConfirmations;
  const record = {
    ...existing.record,
    ...updates,
    status,
    reviewStatus,
    updatedAt
  } satisfies TaskRecord;

  const reply = {
    ...existing.reply,
    status,
    statusLabel: getTaskStatusLabel(status),
    reviewStatus,
    reviewStatusLabel: getReviewStatusLabel(reviewStatus),
    summary: updates.summary ?? existing.reply.summary,
    pendingConfirmations,
    riskAlerts: pendingConfirmations.map((item) => `${item.label}：${item.reason}`),
    auditTrail: [
      ...existing.reply.auditTrail,
      {
        label: '任务状态已更新',
        detail: `当前状态已变更为 ${record.status}，审核状态为 ${record.reviewStatus}。`
      }
    ],
    task: record
  } satisfies AssistantReply;

  const stored = setStoredTask({
    ...existing,
    record,
    reply
  });

  return {
    stored,
    latestAuditEvent: stored.reply.auditTrail.at(-1)
  };
}

async function insertTaskRow(
  client: PoolClient,
  snapshot: TaskSnapshot,
  request: AssistantRequest
) {
  await client.query(
    `
      INSERT INTO tasks (
        id, title, role, task_type, task_type_label, channel, question, files,
        selected_skill_ids, selected_template_id, status, review_status, summary,
        draft_direction, next_actions, risk_alerts, pending_confirmation_count,
        blocking_issue_count, review_comment, reviewed_by, conversation_id, user_id,
        request_payload, reply_payload, raw_payload, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb,
        $9::jsonb, $10, $11, $12, $13,
        $14, $15::jsonb, $16::jsonb, $17,
        $18, $19, $20, $21, $22,
        $23::jsonb, $24::jsonb, $25::jsonb, $26::timestamptz, $27::timestamptz
      )
    `,
    [
      snapshot.task.id,
      snapshot.task.title,
      snapshot.task.role,
      snapshot.task.taskType,
      snapshot.task.taskTypeLabel,
      request.channel,
      snapshot.task.question,
      JSON.stringify(snapshot.task.files),
      JSON.stringify(snapshot.task.selectedSkillIds),
      snapshot.task.selectedTemplateId ?? null,
      snapshot.task.status,
      snapshot.task.reviewStatus,
      snapshot.task.summary,
      snapshot.reply.draftDirection,
      JSON.stringify(snapshot.reply.nextActions),
      JSON.stringify(snapshot.reply.riskAlerts),
      snapshot.task.pendingConfirmationCount,
      snapshot.task.blockingIssueCount,
      snapshot.task.reviewComment ?? null,
      snapshot.task.reviewedBy ?? null,
      request.conversationId ?? null,
      request.userId ?? null,
      JSON.stringify(request),
      JSON.stringify(snapshot.reply),
      JSON.stringify(request.rawPayload ?? null),
      snapshot.task.createdAt,
      snapshot.task.updatedAt
    ]
  );
}

async function updateTaskRow(
  client: PoolClient,
  snapshot: TaskSnapshot,
  request: AssistantRequest
) {
  await client.query(
    `
      UPDATE tasks
      SET
        title = $2,
        role = $3,
        task_type = $4,
        task_type_label = $5,
        channel = $6,
        question = $7,
        files = $8::jsonb,
        selected_skill_ids = $9::jsonb,
        selected_template_id = $10,
        status = $11,
        review_status = $12,
        summary = $13,
        draft_direction = $14,
        next_actions = $15::jsonb,
        risk_alerts = $16::jsonb,
        pending_confirmation_count = $17,
        blocking_issue_count = $18,
        review_comment = $19,
        reviewed_by = $20,
        conversation_id = $21,
        user_id = $22,
        request_payload = $23::jsonb,
        reply_payload = $24::jsonb,
        raw_payload = $25::jsonb,
        created_at = $26::timestamptz,
        updated_at = $27::timestamptz
      WHERE id = $1
    `,
    [
      snapshot.task.id,
      snapshot.task.title,
      snapshot.task.role,
      snapshot.task.taskType,
      snapshot.task.taskTypeLabel,
      request.channel,
      snapshot.task.question,
      JSON.stringify(snapshot.task.files),
      JSON.stringify(snapshot.task.selectedSkillIds),
      snapshot.task.selectedTemplateId ?? null,
      snapshot.task.status,
      snapshot.task.reviewStatus,
      snapshot.task.summary,
      snapshot.reply.draftDirection,
      JSON.stringify(snapshot.reply.nextActions),
      JSON.stringify(snapshot.reply.riskAlerts),
      snapshot.task.pendingConfirmationCount,
      snapshot.task.blockingIssueCount,
      snapshot.task.reviewComment ?? null,
      snapshot.task.reviewedBy ?? null,
      request.conversationId ?? null,
      request.userId ?? null,
      JSON.stringify(request),
      JSON.stringify(snapshot.reply),
      JSON.stringify(request.rawPayload ?? null),
      snapshot.task.createdAt,
      snapshot.task.updatedAt
    ]
  );
}

async function updateTaskMutationRow(
  client: PoolClient,
  taskId: string,
  request: AssistantRequest,
  reply: AssistantReply
) {
  const task = reply.task;

  if (!task) {
    return;
  }

  await client.query(
    `
      UPDATE tasks
      SET
        status = $2,
        review_status = $3,
        summary = $4,
        draft_direction = $5,
        next_actions = $6::jsonb,
        risk_alerts = $7::jsonb,
        pending_confirmation_count = $8,
        blocking_issue_count = $9,
        review_comment = $10,
        reviewed_by = $11,
        request_payload = $12::jsonb,
        reply_payload = $13::jsonb,
        raw_payload = $14::jsonb,
        updated_at = $15::timestamptz
      WHERE id = $1
    `,
    [
      taskId,
      task.status,
      task.reviewStatus,
      task.summary,
      reply.draftDirection,
      JSON.stringify(reply.nextActions),
      JSON.stringify(reply.riskAlerts),
      task.pendingConfirmationCount,
      task.blockingIssueCount,
      task.reviewComment ?? null,
      task.reviewedBy ?? null,
      JSON.stringify(request),
      JSON.stringify(reply),
      JSON.stringify(request.rawPayload ?? null),
      task.updatedAt
    ]
  );
}

async function replaceTaskChildren(
  client: PoolClient,
  taskId: string,
  reply: AssistantReply,
  createdAt: string
) {
  await client.query(`DELETE FROM task_execution_steps WHERE task_id = $1`, [taskId]);
  await client.query(`DELETE FROM task_pending_confirmations WHERE task_id = $1`, [taskId]);
  await client.query(`DELETE FROM task_validation_issues WHERE task_id = $1`, [taskId]);
  await client.query(`DELETE FROM task_artifacts WHERE task_id = $1`, [taskId]);
  await client.query(`DELETE FROM task_audit_events WHERE task_id = $1`, [taskId]);

  for (const [index, step] of reply.executionPlan.entries()) {
    await client.query(
      `
        INSERT INTO task_execution_steps (
          task_id, step_index, step_id, name, skill_id, status, summary
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [taskId, index, step.id, step.name, step.skillId, step.status, step.summary]
    );
  }

  for (const [index, item] of reply.pendingConfirmations.entries()) {
    await client.query(
      `
        INSERT INTO task_pending_confirmations (
          task_id, confirmation_index, confirmation_id, label, reason, owner, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [taskId, index, item.id, item.label, item.reason, item.owner, item.status]
    );
  }

  for (const [index, issue] of reply.validationIssues.entries()) {
    await client.query(
      `
        INSERT INTO task_validation_issues (
          task_id, issue_index, issue_id, severity, title, message
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [taskId, index, issue.id, issue.severity, issue.title, issue.message]
    );
  }

  for (const [index, section] of reply.artifacts.entries()) {
    await client.query(
      `
        INSERT INTO task_artifacts (
          task_id, section_index, title, kind, summary, fields
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        taskId,
        index,
        section.title,
        section.kind,
        section.summary,
        JSON.stringify(section.fields)
      ]
    );
  }

  for (const [index, event] of reply.auditTrail.entries()) {
    await client.query(
      `
        INSERT INTO task_audit_events (
          task_id, event_index, label, detail, created_at
        ) VALUES ($1, $2, $3, $4, $5::timestamptz)
      `,
      [taskId, index, event.label, event.detail, createdAt]
    );
  }
}

async function insertReviewRecord(
  client: PoolClient,
  taskId: string,
  decision: ReviewStatus,
  reviewer: AssistantRole,
  comment: string | undefined,
  createdAt: string
) {
  await client.query(
    `
      INSERT INTO task_reviews (
        task_id, decision, reviewer, comment, created_at
      ) VALUES ($1, $2, $3, $4, $5::timestamptz)
    `,
    [taskId, decision, reviewer, comment ?? null, createdAt]
  );
}

async function listTasksFromDb() {
  const { rows } = await queryDb<TaskRow>(
    `
      SELECT
        id, title, role, task_type, task_type_label, channel, question, files,
        selected_skill_ids, selected_template_id, status, review_status, summary,
        draft_direction, next_actions, risk_alerts, pending_confirmation_count,
        blocking_issue_count, review_comment, reviewed_by, conversation_id, user_id,
        request_payload, reply_payload, raw_payload, created_at, updated_at
      FROM tasks
      ORDER BY updated_at DESC
    `
  );

  return rows.map(toTaskRecordFromRow);
}

async function getStoredTaskFromDb(taskId: string) {
  const { rows } = await queryDb<TaskRow>(
    `
      SELECT
        id, title, role, task_type, task_type_label, channel, question, files,
        selected_skill_ids, selected_template_id, status, review_status, summary,
        draft_direction, next_actions, risk_alerts, pending_confirmation_count,
        blocking_issue_count, review_comment, reviewed_by, conversation_id, user_id,
        request_payload, reply_payload, raw_payload, created_at, updated_at
      FROM tasks
      WHERE id = $1
      LIMIT 1
    `,
    [taskId]
  );

  const row = rows[0];

  if (!row) {
    return null;
  }

  const [
    stepsResult,
    pendingResult,
    issuesResult,
    artifactsResult,
    auditResult,
    reviewResult
  ] =
    await Promise.all([
      queryDb<StepRow>(
        `
          SELECT step_index, step_id, name, skill_id, status, summary
          FROM task_execution_steps
          WHERE task_id = $1
          ORDER BY step_index ASC
        `,
        [taskId]
      ),
      queryDb<PendingConfirmationRow>(
        `
          SELECT confirmation_index, confirmation_id, label, reason, owner, status
          FROM task_pending_confirmations
          WHERE task_id = $1
          ORDER BY confirmation_index ASC
        `,
        [taskId]
      ),
      queryDb<ValidationIssueRow>(
        `
          SELECT issue_index, issue_id, severity, title, message
          FROM task_validation_issues
          WHERE task_id = $1
          ORDER BY issue_index ASC
        `,
        [taskId]
      ),
      queryDb<ArtifactRow>(
        `
          SELECT section_index, title, kind, summary, fields
          FROM task_artifacts
          WHERE task_id = $1
          ORDER BY section_index ASC
        `,
        [taskId]
      ),
      queryDb<AuditEventRow>(
        `
          SELECT event_index, label, detail
          FROM task_audit_events
          WHERE task_id = $1
          ORDER BY event_index ASC
        `,
        [taskId]
      ),
      queryDb<ReviewRow>(
        `
          SELECT decision, reviewer, comment, created_at
          FROM task_reviews
          WHERE task_id = $1
          ORDER BY created_at DESC
        `,
        [taskId]
      )
    ]);

  const record = toTaskRecordFromRow(row);
  const baseReply = row.reply_payload;
  const selectedSkills = record.selectedSkillIds
    .map((skillId) => getSkillById(skillId))
    .filter((skill) => skill !== null);
  const selectedTemplate = record.selectedTemplateId
    ? getTemplateById(record.selectedTemplateId)
    : null;
  const executionPlan =
    stepsResult.rows.length > 0
      ? stepsResult.rows.map((item) => ({
          id: item.step_id,
          name: item.name,
          skillId: item.skill_id,
          status: item.status,
          summary: item.summary
        }))
      : (baseReply.executionPlan ?? []);
  const pendingConfirmations =
    pendingResult.rows.length > 0
      ? pendingResult.rows.map((item) => ({
          id: item.confirmation_id,
          label: item.label,
          reason: item.reason,
          owner: item.owner,
          status: item.status
        }))
      : (baseReply.pendingConfirmations ?? []);
  const validationIssues =
    issuesResult.rows.length > 0
      ? issuesResult.rows.map((item) => ({
          id: item.issue_id,
          severity: item.severity,
          title: item.title,
          message: item.message
        }))
      : (baseReply.validationIssues ?? []);
  const artifacts =
    artifactsResult.rows.length > 0
      ? artifactsResult.rows.map((item) => ({
          title: item.title,
          kind: item.kind,
          summary: item.summary,
          fields: item.fields
        }))
      : (baseReply.artifacts ?? []);
  const auditTrail =
    auditResult.rows.length > 0
      ? auditResult.rows.map((item) => ({
          label: item.label,
          detail: item.detail
        }))
      : (baseReply.auditTrail ?? []);
  const reviewHistory =
    reviewResult.rows.length > 0
      ? reviewResult.rows.map((item) => ({
          decision: item.decision,
          reviewer: item.reviewer,
          comment: item.comment ?? undefined,
          createdAt: item.created_at
        }))
      : baseReply.reviewHistory ??
        (record.reviewedBy
          ? [
              {
                decision: record.reviewStatus === 'approved' ? 'approved' : 'returned',
                reviewer: record.reviewedBy,
                comment: record.reviewComment,
                createdAt: record.updatedAt
              }
            ]
          : []);

  return setStoredTask({
    record,
    request: row.request_payload,
    reply: {
      ...baseReply,
      intent: record.taskType,
      intentLabel: record.taskTypeLabel,
      role: record.role,
      status: record.status,
      statusLabel: getTaskStatusLabel(record.status),
      reviewStatus: record.reviewStatus,
      reviewStatusLabel: getReviewStatusLabel(record.reviewStatus),
      summary: record.summary,
      nextActions: row.next_actions ?? baseReply.nextActions ?? [],
      riskAlerts: row.risk_alerts ?? baseReply.riskAlerts ?? [],
      draftDirection: row.draft_direction ?? baseReply.draftDirection ?? '',
      taskType: record.taskType,
      taskTypeLabel: record.taskTypeLabel,
      skillCatalog,
      templates: workflowTemplates,
      selectedSkills,
      selectedTemplate,
      executionPlan,
      pendingConfirmations,
      blockingIssues: validationIssues.filter((item) => item.severity === 'blocking'),
      validationIssues,
      artifacts,
      auditTrail,
      reviewHistory,
      task: record,
      metadata: {
        ...baseReply.metadata,
        needsHumanReview: deriveNeedsHumanReview(record.status, pendingConfirmations)
      }
    }
  });
}

export async function createTaskFromExecution(
  request: AssistantRequest,
  reply: AssistantReply
): Promise<TaskSnapshot> {
  const id = createTaskId();
  const snapshot = storeSnapshot(id, request, reply);

  if (!hasDatabaseConfig()) {
    return snapshot;
  }

  await withDbTransaction(async (client) => {
    await acquireTaskWriteLock(client, snapshot.task.id);
    await insertTaskRow(client, snapshot, request);
    await replaceTaskChildren(
      client,
      snapshot.task.id,
      snapshot.reply,
      snapshot.task.createdAt
    );
  });

  return {
    ...snapshot,
    recentTasks: await listTasksFromDb()
  } satisfies TaskSnapshot;
}

export async function updateTaskFromExecution(
  taskId: string,
  request: AssistantRequest,
  reply: AssistantReply
): Promise<TaskSnapshot | null> {
  const existing = taskStore.get(taskId);

  if (!hasDatabaseConfig()) {
    if (!existing) {
      return null;
    }

    return replaceStoredTask(taskId, request, reply, existing.record.createdAt);
  }

  const stored = existing ?? (await getStoredTaskFromDb(taskId));

  if (!stored) {
    return null;
  }

  const snapshot = replaceStoredTask(taskId, request, reply, stored.record.createdAt);

  await withDbTransaction(async (client) => {
    await acquireTaskWriteLock(client, taskId);
    await updateTaskRow(client, snapshot, request);
    await replaceTaskChildren(
      client,
      snapshot.task.id,
      snapshot.reply,
      snapshot.task.updatedAt
    );
  });

  return {
    ...snapshot,
    recentTasks: await listTasksFromDb()
  } satisfies TaskSnapshot;
}

export async function listTasks(): Promise<TaskRecord[]> {
  if (!hasDatabaseConfig()) {
    return listMemoryTasks();
  }

  return listTasksFromDb();
}

export async function getTask(taskId: string): Promise<StoredTask | null> {
  if (!hasDatabaseConfig()) {
    return taskStore.get(taskId) ?? null;
  }

  return getStoredTaskFromDb(taskId);
}

export async function deleteTask(taskId: string): Promise<boolean> {
  if (!hasDatabaseConfig()) {
    return taskStore.delete(taskId);
  }

  const existing = await getStoredTaskFromDb(taskId);

  if (!existing) {
    return false;
  }

  await withDbTransaction(async (client) => {
    await acquireTaskWriteLock(client, taskId);
    await client.query(`DELETE FROM tasks WHERE id = $1`, [taskId]);
  });

  taskStore.delete(taskId);
  return true;
}

export async function deleteTasks(taskIds: string[]): Promise<{
  deletedIds: string[];
  recentTasks: TaskRecord[];
}> {
  const uniqueTaskIds = [...new Set(taskIds.filter(Boolean))];

  if (uniqueTaskIds.length === 0) {
    return {
      deletedIds: [],
      recentTasks: await listTasks()
    };
  }

  if (!hasDatabaseConfig()) {
    const deletedIds = uniqueTaskIds.filter((taskId) => taskStore.delete(taskId));
    return {
      deletedIds,
      recentTasks: listMemoryTasks()
    };
  }

  await withDbTransaction(async (client) => {
    for (const taskId of uniqueTaskIds) {
      await acquireTaskWriteLock(client, taskId);
    }

    await client.query(`DELETE FROM tasks WHERE id = ANY($1::text[])`, [uniqueTaskIds]);
  });

  uniqueTaskIds.forEach((taskId) => {
    taskStore.delete(taskId);
  });

  return {
    deletedIds: uniqueTaskIds,
    recentTasks: await listTasksFromDb()
  };
}

export async function submitTaskForReview(
  taskId: string
): Promise<{ record: TaskRecord; reply: AssistantReply } | null> {
  const existing = hasDatabaseConfig()
    ? await getStoredTaskFromDb(taskId)
    : (taskStore.get(taskId) ?? null);

  if (!existing) {
    return null;
  }

  const result = applyStoredTaskUpdates(existing, {
    status: 'pending_supervisor_review',
    reviewStatus: 'pending_review',
    summary: '业务员已处理待确认项，当前任务已提交主管审核。'
  });

  if (!hasDatabaseConfig()) {
    return {
      record: result.stored.record,
      reply: result.stored.reply
    };
  }

  await withDbTransaction(async (client) => {
    await acquireTaskWriteLock(client, taskId);
    await updateTaskMutationRow(client, taskId, result.stored.request, result.stored.reply);
    await replaceTaskChildren(
      client,
      taskId,
      result.stored.reply,
      result.stored.record.updatedAt
    );
  });

  return {
    record: result.stored.record,
    reply: result.stored.reply
  };
}

export async function reviewTask(
  taskId: string,
  decision: 'approved' | 'returned',
  reviewer: AssistantRole,
  comment?: string
): Promise<{ record: TaskRecord; reply: AssistantReply } | null> {
  const existing = hasDatabaseConfig()
    ? await getStoredTaskFromDb(taskId)
    : (taskStore.get(taskId) ?? null);

  if (!existing) {
    return null;
  }

  const result = applyStoredTaskUpdates(existing, {
    status: decision === 'approved' ? 'approved' : 'returned',
    reviewStatus: decision,
    reviewComment: comment,
    reviewedBy: reviewer,
    summary:
      decision === 'approved'
        ? '主管已审核通过，当前任务可以进入导出阶段。'
        : '主管已退回当前任务，请业务员根据审核意见重新处理。'
  });
  result.stored.reply.reviewHistory = [
    {
      decision,
      reviewer,
      comment,
      createdAt: result.stored.record.updatedAt
    },
    ...(existing.reply.reviewHistory ?? [])
  ];

  if (!hasDatabaseConfig()) {
    return {
      record: result.stored.record,
      reply: result.stored.reply
    };
  }

  await withDbTransaction(async (client) => {
    await acquireTaskWriteLock(client, taskId);
    await updateTaskMutationRow(client, taskId, result.stored.request, result.stored.reply);
    await replaceTaskChildren(
      client,
      taskId,
      result.stored.reply,
      result.stored.record.updatedAt
    );
    await insertReviewRecord(
      client,
      taskId,
      decision,
      reviewer,
      comment,
      result.stored.record.updatedAt
    );
  });

  return {
    record: result.stored.record,
    reply: result.stored.reply
  };
}

export async function exportTask(
  taskId: string
): Promise<{ record: TaskRecord; reply: AssistantReply } | null> {
  const existing = hasDatabaseConfig()
    ? await getStoredTaskFromDb(taskId)
    : (taskStore.get(taskId) ?? null);

  if (!existing) {
    return null;
  }

  const finalArtifact = existing.reply.artifacts.map(section => {
    let text = `## ${section.title}\n${section.summary}\n\n`;
    section.fields.forEach(field => {
      text += `- **${field.label}**: ${field.value}\n`;
    });
    return text;
  }).join('\n');

  const result = applyStoredTaskUpdates(existing, {
    status: 'exported',
    summary: '当前任务已导出，审计记录和执行结果已保留。'
  });
  
  result.stored.reply.finalArtifact = finalArtifact;

  if (!hasDatabaseConfig()) {
    return {
      record: result.stored.record,
      reply: result.stored.reply
    };
  }

  await withDbTransaction(async (client) => {
    await acquireTaskWriteLock(client, taskId);
    await updateTaskMutationRow(client, taskId, result.stored.request, result.stored.reply);
    await replaceTaskChildren(
      client,
      taskId,
      result.stored.reply,
      result.stored.record.updatedAt
    );
  });

  return {
    record: result.stored.record,
    reply: result.stored.reply
  };
}

export async function updateTaskConfirmation(
  taskId: string,
  confirmationId: string,
  updates: { status: PendingConfirmation['status'] },
  updaterRole?: AssistantRole
): Promise<{ record: TaskRecord; reply: AssistantReply } | null> {
  const existing = hasDatabaseConfig()
    ? await getStoredTaskFromDb(taskId)
    : (taskStore.get(taskId) ?? null);

  if (!existing) {
    return null;
  }

  if (!canUpdateConfirmationStatus(existing.record.status)) {
    throw new Error('任务当前状态不允许修改待确认项。');
  }

  const targetConfirmation = existing.reply.pendingConfirmations.find(
    (item) => item.id === confirmationId
  );

  if (!targetConfirmation) {
    throw new Error('待确认项不存在。');
  }

  const pendingConfirmations = existing.reply.pendingConfirmations.map((item) =>
    item.id === confirmationId ? { ...item, status: updates.status, updatedAt: nowIso(), updatedBy: updaterRole ?? 'sales' } : item
  );

  const pendingConfirmationCount = pendingConfirmations.filter(
    (item) => item.status !== 'confirmed'
  ).length;

  const result = applyStoredTaskUpdates(existing, {
    summary: '业务员已更新待确认项状态。'
  });

  result.stored.reply.pendingConfirmations = pendingConfirmations;
  result.stored.record.pendingConfirmationCount = pendingConfirmationCount;
  if (result.stored.reply.task) {
    result.stored.reply.task.pendingConfirmationCount = pendingConfirmationCount;
  }

  if (!hasDatabaseConfig()) {
    taskStore.set(result.stored.record.id, result.stored);
    return {
      record: result.stored.record,
      reply: result.stored.reply
    };
  }

  await withDbTransaction(async (client) => {
    await acquireTaskWriteLock(client, taskId);
    await updateTaskMutationRow(client, taskId, result.stored.request, result.stored.reply);
    await replaceTaskChildren(
      client,
      taskId,
      result.stored.reply,
      result.stored.record.updatedAt
    );
  });

  return {
    record: result.stored.record,
    reply: result.stored.reply
  };
}
