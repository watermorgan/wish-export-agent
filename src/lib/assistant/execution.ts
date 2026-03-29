import {
  getDefaultTemplateForTaskType,
  getSkillById,
  getTemplateById,
  skillCatalog,
  taskTypeOptions,
  workflowTemplates
} from '@/lib/assistant/catalog';
import { loadSkillPrompt } from '@/lib/assistant/prompt-loader';
import { generateWithAvailableProvider } from '@/lib/assistant/llm/router';
import { parseFullResult, type ParsedStepResult } from '@/lib/assistant/parser';
import { buildFeedbackSourceReference, type FeedbackSourceReference } from '@/lib/assistant/feedback-source';
import { buildExtractedPdfResultFromText } from '@/lib/assistant/file-extractor';
import { maybeRunRealFeedbackTranslation } from '@/lib/assistant/feedback-translation';
import type {
  ArtifactField,
  ArtifactSection,
  AssistantReply,
  AssistantRequest,
  ExecutionPlanStep,
  PendingConfirmation,
  SkillDefinition,
  TaskType,
  UploadedFile,
  ValidationIssue,
  WorkflowTemplate
} from '@/lib/assistant/types';

export interface StepResult {
  skillId: string;
  skillName: string;
  rawText: string;
  artifacts?: ParsedStepResult;
}

export interface CumulativeContext {
  files: UploadedFile[];
  question: string;
  previousResults: StepResult[];
  structuredSource?: FeedbackSourceReference | null;
}

const taskTypeKeywordMap: Record<TaskType, string[]> = {
  bom: ['bom', '工艺单', '面辅料', '辅料', '料号', '规格'],
  feedback: ['批注', '意见', 'comment', 'feedback', '翻译', '归并'],
  reply: ['回复', '邮件', 'reply', 'email', '英文', '跟进']
};

function inferTaskType(question: string): TaskType {
  const lower = question.toLowerCase();

  for (const [taskType, keywords] of Object.entries(taskTypeKeywordMap) as Array<
    [TaskType, string[]]
  >) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return taskType;
    }
  }

  return 'reply';
}

function pickSelectedSkills(
  request: AssistantRequest,
  taskType: TaskType
): {
  selectedSkills: SkillDefinition[];
  selectedTemplate: WorkflowTemplate | null;
} {
  const selectedTemplate = request.selectedTemplateId
    ? getTemplateById(request.selectedTemplateId)
    : getDefaultTemplateForTaskType(taskType);

  const skillIds =
    request.selectedSkillIds.length > 0
      ? request.selectedSkillIds
      : selectedTemplate?.steps ?? [];

  const selectedSkills = skillIds
    .map((skillId) => getSkillById(skillId))
    .filter((skill): skill is SkillDefinition => Boolean(skill));

  return {
    selectedSkills,
    selectedTemplate
  };
}

function buildValidationIssues(
  taskType: TaskType,
  files: UploadedFile[],
  selectedSkills: SkillDefinition[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (selectedSkills.length === 0) {
    issues.push({
      id: 'missing-skills',
      severity: 'blocking',
      title: '未选择技能',
      message: '请先选择技能或工作流模板，再开始执行。'
    });
  }

  if (taskType === 'bom' && files.length === 0) {
    issues.push({
      id: 'bom-files-missing',
      severity: 'blocking',
      title: '缺少工艺单资料',
      message: 'BOM 整理至少需要一份工艺单或面辅料说明文件。'
    });
  }

  if (taskType === 'feedback' && files.length === 0) {
    issues.push({
      id: 'feedback-context-warning',
      severity: 'warning',
      title: '建议补充批注文件',
      message: '目前只有文本说明，建议补充批注导出或聊天记录，归并结果会更稳定。'
    });
  }

  if (taskType === 'reply' && files.length === 0) {
    issues.push({
      id: 'reply-context-warning',
      severity: 'warning',
      title: '建议补充客户上下文',
      message: '未上传邮件或附件时，系统会优先输出澄清问题清单，而不是完整承诺型草稿。'
    });
  }

  if (
    selectedSkills.some((skill) => skill.id === 'customer-reply-drafter') &&
    !selectedSkills.some((skill) => skill.id === 'comment-translator') &&
    files.length > 1
  ) {
    issues.push({
      id: 'reply-chain-recommendation',
      severity: 'warning',
      title: '建议先做翻译整理',
      message: '当前附件较多，建议先加上“意见翻译”再进行回复草拟，避免遗漏责任归属和否定表达。'
    });
  }

  return issues;
}

function buildExecutionPlan(
  selectedSkills: SkillDefinition[],
  issues: ValidationIssue[]
): ExecutionPlanStep[] {
  const blocked = issues.some((issue) => issue.severity === 'blocking');

  return selectedSkills.map((skill, index) => ({
    id: `${skill.id}-${index + 1}`,
    name: skill.name,
    skillId: skill.id,
    status: blocked && index === 0 ? 'blocked' : 'completed',
    summary: blocked
      ? '执行前校验未通过，当前步骤等待补齐输入后重试。'
      : `已完成 ${skill.name} 的编排执行，并提取结构化产物。`
  }));
}

function buildCitationLabel(files: UploadedFile[], fallback: string) {
  if (files.length === 0) {
    return fallback;
  }

  return files.map((file) => file.name).join('、');
}

function buildArtifactFields(
  pairs: Array<{
    label: string;
    value: string;
    confirmationStatus?: ArtifactField['confirmationStatus'];
  }>,
  citation: string
) {
  return pairs.map((pair) => ({
    ...pair,
    citation
  }));
}

function buildArtifacts(taskType: TaskType, question: string, files: UploadedFile[]) {
  const citation = buildCitationLabel(files, '当前仅依据任务说明生成');

  if (taskType === 'bom') {
    return [
      {
        title: 'BOM 初稿',
        kind: 'table',
        summary: '先形成面辅料结构化草稿，再把低置信字段交给人工确认。',
        fields: buildArtifactFields(
          [
            {
              label: '主面料',
              value: '面料品类待人工确认，系统建议先核对规格、克重和颜色编号。',
              confirmationStatus: 'required'
            },
            {
              label: '辅料',
              value: '纽扣/拉链/织带等辅料已初步聚合，建议逐项确认料号和单位。',
              confirmationStatus: 'required'
            },
            {
              label: '图文冲突',
              value: '图片批注与文字说明存在不一致时，优先进入冲突列表，不自动合并。',
              confirmationStatus: 'required'
            }
          ],
          citation
        )
      },
      {
        title: '缺失字段清单',
        kind: 'list',
        summary: '以下字段建议由业务员或打样同事补录后再提交审核。',
        fields: buildArtifactFields(
          [
            {
              label: '缺失项 1',
              value: '规格/幅宽/损耗中至少有一项不完整。',
              confirmationStatus: 'required'
            },
            {
              label: '缺失项 2',
              value: `请根据任务目标“${question}”补充料号命名口径和单位标准。`,
              confirmationStatus: 'recommended'
            }
          ],
          citation
        )
      }
    ] satisfies ArtifactSection[];
  }

  if (taskType === 'feedback') {
    return [
      {
        title: '双语翻译结果',
        kind: 'list',
        summary: '保留原文语义，不把模糊表达强行翻译成确定结论。',
        fields: buildArtifactFields(
          [
            {
              label: '重点意见 A',
              value: '请核对样衣尺寸偏差的责任归属，避免在对外版本中直接认责。',
              confirmationStatus: 'required'
            },
            {
              label: '重点意见 B',
              value: '客户批注中的否定表达已保留，建议人工确认语气强度。',
              confirmationStatus: 'required'
            }
          ],
          citation
        )
      },
      {
        title: '归并主题',
        kind: 'list',
        summary: '先按工艺、交付风险、样衣修改三类主题归组。',
        fields: buildArtifactFields(
          [
            {
              label: '主题 1',
              value: '工艺修改项：关注尺寸、缝制和辅料替换。'
            },
            {
              label: '主题 2',
              value: '交付风险项：关注确认链路和样衣复核。'
            }
          ],
          citation
        )
      }
    ] satisfies ArtifactSection[];
  }

  return [
    {
      title: '英文回复草稿',
      kind: 'text',
      summary: '当前输出为内部可审校草稿，不可直接作为对外正式承诺。',
      fields: buildArtifactFields(
        [
          {
            label: 'Draft',
            value:
              'Thank you for the updated information. We have reviewed the current materials and prepared the next internal checks. Items related to price, lead time, certification, payment, and logistics remain pending confirmation before external commitment.',
            confirmationStatus: 'required'
          }
        ],
        citation
      )
    },
    {
      title: '中文备注与澄清问题',
      kind: 'list',
      summary: '用于业务员内部沟通和补齐上下文，不直接外发。',
      fields: buildArtifactFields(
        [
          {
            label: '内部备注',
            value: '当前草稿已显式阻断价格、交期、认证、付款、物流类承诺。'
          },
          {
            label: '澄清问题',
            value: `围绕任务“${question}”，建议补充目标数量、交付时间和认证范围。`,
            confirmationStatus: 'recommended'
          }
        ],
        citation
      )
    }
  ] satisfies ArtifactSection[];
}

function buildPendingConfirmations(taskType: TaskType): PendingConfirmation[] {
  if (taskType === 'bom') {
    return [
      {
        id: 'bom-spec',
        label: '确认 BOM 关键字段',
        reason: '规格、单位、颜色、损耗会直接影响后续采购和样衣执行。',
        owner: 'sales',
        status: 'required'
      },
      {
        id: 'bom-conflict',
        label: '确认图文冲突项',
        reason: '冲突字段不能由系统静默合并，必须人工定口径。',
        owner: 'supervisor',
        status: 'required'
      }
    ];
  }

  if (taskType === 'feedback') {
    return [
      {
        id: 'feedback-term',
        label: '确认专业术语译法',
        reason: '术语翻译会影响工艺理解和责任判断。',
        owner: 'sales',
        status: 'required'
      },
      {
        id: 'feedback-ownership',
        label: '确认责任归属表达',
        reason: '涉及否定表达和责任归属时，必须人工过一遍。',
        owner: 'supervisor',
        status: 'required'
      }
    ];
  }

  return [
    {
      id: 'reply-commercial-terms',
      label: '确认价格/交期/认证/付款/物流',
      reason: '这些内容会形成对外商业承诺，必须明确标记为待确认。',
      owner: 'supervisor',
      status: 'required'
    },
    {
      id: 'reply-draft-tone',
      label: '确认英文回复语气',
      reason: '需要确保客户可见内容和内部备注边界清晰。',
      owner: 'sales',
      status: 'required'
    }
  ];
}

function buildNextActions(taskType: TaskType, issues: ValidationIssue[]) {
  if (issues.some((issue) => issue.severity === 'blocking')) {
    return [
      '先按阻断提示补齐资料或调整模板，再重新执行。',
      '不要直接跳过阻断条件进入客户可见输出。',
      '补齐输入后，再进入人工确认与审核链路。'
    ];
  }

  if (taskType === 'bom') {
    return [
      '逐项补录缺失字段，先把低置信字段转为人工确认状态。',
      '把图文冲突项单独提交给主管复核。',
      '审核通过后再导出结构化 BOM。'
    ];
  }

  if (taskType === 'feedback') {
    return [
      '先确认术语、否定表达和责任归属，再决定是否归并冲突意见。',
      '保留原文映射，避免归并后丢失上下文。',
      '主管通过后再形成正式对内/对客版本。'
    ];
  }

  return [
    '先补齐客户上下文中的数量、时间和认证要求。',
    '把价格、交期、付款、物流统一保留为待确认项。',
    '业务员修改草稿后再提交主管审核。'
  ];
}

function buildDraftDirection(taskType: TaskType) {
  if (taskType === 'bom') {
    return '建议输出“结构化 BOM + 缺失字段清单 + 冲突字段列表”，而不是采购或成本结论。';
  }

  if (taskType === 'feedback') {
    return '建议输出“原文/译文对照 + 主题分组 + 冲突项”，先帮团队统一语义口径。';
  }

  return '建议输出“英文回复草稿 + 中文备注 + 澄清问题清单”，明确哪些句子仍待确认。';
}

function buildAuditTrail(
  selectedSkills: SkillDefinition[],
  selectedTemplate: WorkflowTemplate | null,
  issues: ValidationIssue[]
) {
  return [
    {
      label: '执行计划已生成',
      detail: selectedTemplate
        ? `已按模板“${selectedTemplate.name}”生成执行链。`
        : `已按手动技能组合生成 ${selectedSkills.length} 个步骤。`
    },
    {
      label: '执行校验已完成',
      detail:
        issues.length > 0
          ? `发现 ${issues.length} 个校验提醒，需在人工确认或补料后继续。`
          : '当前输入满足模拟执行条件，已进入待人工确认阶段。'
    },
    {
      label: '审计留痕已创建',
      detail: '本次执行已记录技能链路、中间产物和待确认项摘要。'
    }
  ];
}

function shouldBypassLegacyTranslatorStep(
  request: AssistantRequest,
  taskType: TaskType,
  skillId: string
) {
  if (taskType !== 'feedback' || skillId !== 'comment-translator') {
    return false;
  }

  return request.files.some((file) => file.name.toLowerCase().endsWith('.pdf'));
}

export async function runAssistant(request: AssistantRequest): Promise<AssistantReply> {
  const taskType = request.taskType ?? inferTaskType(request.question);
  const taskTypeLabel =
    taskTypeOptions.find((option) => option.id === taskType)?.label ?? '客户回复草拟';
  const { selectedSkills, selectedTemplate } = pickSelectedSkills(request, taskType);
  const validationIssues = buildValidationIssues(taskType, request.files, selectedSkills);
  const blocked = validationIssues.some((issue) => issue.severity === 'blocking');
  const executionPlan = buildExecutionPlan(selectedSkills, validationIssues);
  const pendingConfirmations = buildPendingConfirmations(taskType);

  if (blocked) {
    return {
      intent: taskType,
      intentLabel: taskTypeLabel,
      role: request.role,
      status: 'blocked',
      statusLabel: '已阻断',
      reviewStatus: 'not_submitted',
      reviewStatusLabel: '未提交审核',
      summary: `已按“${taskTypeLabel}”生成执行计划，但当前输入仍存在阻断项，系统不会继续生成可用完成稿。`,
      nextActions: buildNextActions(taskType, validationIssues),
      riskAlerts: pendingConfirmations.map((item) => `${item.label}：${item.reason}`),
      draftDirection: buildDraftDirection(taskType),
      taskType,
      taskTypeLabel,
      skillCatalog,
      templates: workflowTemplates,
      selectedSkills,
      selectedTemplate,
      executionPlan,
      pendingConfirmations,
      blockingIssues: validationIssues.filter((issue) => issue.severity === 'blocking'),
      validationIssues,
      artifacts: buildArtifacts(taskType, request.question, request.files),
      auditTrail: buildAuditTrail(selectedSkills, selectedTemplate, validationIssues),
      metadata: {
        needsHumanReview: true,
        providerHits: [],
        modelHits: [],
        translationMode: 'fixture'
      }
    };
  }

  // Real LLM Orchestration Loop
  const previousResults: StepResult[] = [];
  const providerHits: string[] = [];
  const modelHits: string[] = [];
  let accumulatedArtifacts: ArtifactSection[] = [];
  let accumulatedConfirmations: PendingConfirmation[] = [...pendingConfirmations];
  const skippedLegacySteps: string[] = [];

  for (const skill of selectedSkills) {
    if (shouldBypassLegacyTranslatorStep(request, taskType, skill.id)) {
      skippedLegacySteps.push(skill.id);
      previousResults.push({
        skillId: skill.id,
        skillName: skill.name,
        rawText: '[bypassed] PDF feedback task uses runPdfTranslationPipeline directly.'
      });
      continue;
    }

    const systemPrompt = loadSkillPrompt(skill.id);
    
    // Enrich context for specific skills
    let structuredSource = undefined;
    if (skill.id === 'comment-translator' && request.files.length > 0) {
      // Pick the most relevant source file
      const sourceFile = [...request.files]
        .filter((file) => file.contentText && file.contentText.trim().length > 0)
        .sort((left, right) => (right.contentText?.length ?? 0) - (left.contentText?.length ?? 0))[0];
      
      if (sourceFile) {
        const extractedSource = buildExtractedPdfResultFromText(sourceFile.contentText ?? '');
        if (extractedSource) {
          structuredSource = buildFeedbackSourceReference(extractedSource, {
            name: sourceFile.name
          });
        }
      }
    }

    const context: CumulativeContext = {
      files: request.files,
      question: request.question,
      previousResults,
      structuredSource
    };

    const userPrompt = [
      `User Question: ${request.question}`,
      '',
      '--- Cumulative Context ---',
      JSON.stringify(context, null, 2),
      '',
      '--- End Context ---'
    ].join('\n');

    const result = await generateWithAvailableProvider({
      system: systemPrompt || 'You are a helpful assistant specializing in trade export processes.',
      user: userPrompt,
      modelOverride: request.modelOverride
    });

    providerHits.push(result.provider);
    modelHits.push(result.model ?? request.modelOverride ?? 'default');

    const parsed = parseFullResult(result.text, skill.id);

    const stepResult: StepResult = {
      skillId: skill.id,
      skillName: skill.name,
      // Keep full text for internal tracking, but truncate if it's exceptionally large
      // to avoid overwhelming context in subsequent steps if necessary.
      // However, parseFullResult results are already in accumulatedArtifacts.
      rawText: result.text.length > 3000 ? result.text.slice(0, 3000) + '... (truncated)' : result.text,
      artifacts: parsed
    };
    previousResults.push(stepResult);

    accumulatedArtifacts = [...accumulatedArtifacts, ...parsed.sections];
    if (parsed.pendingConfirmations.length > 0) {
      accumulatedConfirmations = [...accumulatedConfirmations, ...parsed.pendingConfirmations];
    }
  }

  const baseReply: AssistantReply = {
    intent: taskType,
    intentLabel: taskTypeLabel,
    role: request.role,
    status: 'pending_user_confirmation',
    statusLabel: '待人工确认',
    reviewStatus: 'not_submitted',
    reviewStatusLabel: '未提交审核',
    summary: `已按“${taskTypeLabel}”顺序执行了 ${selectedSkills.length} 个技能。`,
    nextActions: buildNextActions(taskType, validationIssues),
    riskAlerts: accumulatedConfirmations.map((item) => `${item.label}：${item.reason}`),
    draftDirection: buildDraftDirection(taskType),
    taskType,
    taskTypeLabel,
    skillCatalog,
    templates: workflowTemplates,
    selectedSkills,
    selectedTemplate,
    executionPlan: executionPlan.map(step => ({ ...step, status: 'completed' })),
    pendingConfirmations: accumulatedConfirmations,
    blockingIssues: [],
    validationIssues: validationIssues.filter(i => i.severity !== 'blocking'),
    artifacts: accumulatedArtifacts.length > 0 ? accumulatedArtifacts : buildArtifacts(taskType, request.question, request.files),
    auditTrail: [
      ...buildAuditTrail(selectedSkills, selectedTemplate, validationIssues),
      ...(skippedLegacySteps.length > 0
        ? [
            {
              label: '旧翻译技能已旁路',
              detail: `PDF feedback 任务已跳过 [${skippedLegacySteps.join(', ')}] 的 router 调用，改由 PDF pipeline 主链执行。`
            }
          ]
        : []),
      {
        label: 'LLM 编排执行完成',
        detail: `顺序执行了 [${selectedSkills.map(s => s.id).join(', ')}]，命中 provider: ${providerHits.join(', ')}；模型: ${modelHits.join(', ')}`
      }
    ],
    metadata: {
      needsHumanReview: true,
      providerHits,
      modelHits,
      activeProvider: providerHits.at(-1),
      activeModel: modelHits.at(-1),
      translationMode: 'real'
    }
  };

  return maybeRunRealFeedbackTranslation(request, baseReply);
}
