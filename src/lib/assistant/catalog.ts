import type {
  AssistantRole,
  SkillDefinition,
  TaskType,
  WorkflowTemplate
} from '@/lib/assistant/types';

import bomOrganizerManifest from '../../skills/bom-organizer/manifest.json';
import commentTranslatorManifest from '../../skills/comment-translator/manifest.json';
import commentMergerManifest from '../../skills/comment-merger/manifest.json';
import customerReplyDrafterManifest from '../../skills/customer-reply-drafter/manifest.json';

export type TaskTypeOption = {
  id: TaskType;
  label: string;
  description: string;
};

export type RoleOption = {
  id: AssistantRole;
  label: string;
  description: string;
};

export type BusinessScenarioPreset = {
  id: string;
  title: string;
  summary: string;
  taskType: TaskType;
  templateId: string;
  skillIds: string[];
  prompt: string;
  audienceHint: string;
};

export const taskTypeOptions: TaskTypeOption[] = [
  {
    id: 'bom',
    label: '工艺 / BOM 整理',
    description: '把工艺单、说明资料和图片批注整理成业务可读的结构化清单。'
  },
  {
    id: 'feedback',
    label: '批注翻译与归并',
    description: '把多来源批注翻译成业务能直接判断的双语意见。'
  },
  {
    id: 'reply',
    label: '客户回复草拟',
    description: '基于客户上下文和附件生成可审校、可对外的英文回复草稿。'
  }
];

export const roleOptions: RoleOption[] = [
  {
    id: 'sales',
    label: '业务员',
    description: '发起任务、补录字段、处理待确认项并提交审核。'
  },
  {
    id: 'supervisor',
    label: '主管',
    description: '查看风险、审核结果、发布模板并复用高质量链路。'
  }
];

export const skillCatalog: SkillDefinition[] = [
  bomOrganizerManifest as SkillDefinition,
  commentTranslatorManifest as SkillDefinition,
  commentMergerManifest as SkillDefinition,
  customerReplyDrafterManifest as SkillDefinition
];

export const workflowTemplates: WorkflowTemplate[] = [
  {
    id: 'bom-structuring',
    name: '工艺整理链',
    goal: '按业务视角整理工艺单，先保留关键字段，再补齐缺失项。',
    scenarios: ['工艺单和附件齐全', '目标是形成 BOM 草稿并补录缺失字段'],
    steps: ['bom-organizer'],
    allowedSkills: ['bom-organizer'],
    blockingConditions: ['工艺单缺失', '关键字段缺失过多', '文件不可解析'],
    deliverables: ['BOM 初稿', '缺失字段', '待确认字段'],
    taskType: 'bom',
    status: 'published'
  },
  {
    id: 'translation-merge',
    name: '批注翻译与归并链',
    goal: '把多来源批注翻译成业务可读意见，并保留会影响打样的关键点。',
    scenarios: ['多份批注', '跨语言沟通意见', '需要整理冲突反馈'],
    steps: ['comment-translator', 'comment-merger'],
    allowedSkills: ['comment-translator', 'comment-merger'],
    blockingConditions: ['原文缺失', '上下文不足', '文本质量过低'],
    deliverables: ['双语对照', '主题分组', '冲突项'],
    taskType: 'feedback',
    status: 'published'
  },
  {
    id: 'reply-preparation',
    name: '回复准备链',
    goal: '先理解多来源意见，再输出更像业务口径的客户回复草稿。',
    scenarios: ['先消化客户/内部意见，再形成英文回复'],
    steps: ['comment-translator', 'customer-reply-drafter'],
    allowedSkills: ['comment-translator', 'customer-reply-drafter'],
    blockingConditions: ['价格或交期未确认', '责任归属不明确'],
    deliverables: ['英文草稿', '中文备注', '待确认承诺项'],
    taskType: 'reply',
    status: 'published'
  }
];

export const quickPrompts = [
  '请整理工艺单附件，优先保留业务会看重的关键字段，输出结构化 BOM，并列出缺失项。',
  '请保留英文原文，在每段下方增加中文翻译，优先按打样和确认视角表达，不做无意义归并。',
  '请基于客户邮件和附件，生成英文回复草稿，并把承诺、交期、责任边界单独列出。',
];

export const businessScenarioPresets: BusinessScenarioPreset[] = [
  {
    id: 'bom-fast',
    title: '工艺单快速整理',
    summary: '先保留款式、面料、工艺、价格、交期，再补缺失字段。',
    taskType: 'bom',
    templateId: 'bom-structuring',
    skillIds: ['bom-organizer'],
    prompt:
      '请按业务视角整理工艺单，优先保留款式、面料、工艺、价格、交期等关键字段，列出待确认项。',
    audienceHint: '适合打样前快速梳理'
  },
  {
    id: 'feedback-merge',
    title: '批注翻译给版房',
    summary: '先翻译，再合并重复意见，但不能丢掉影响打样的关键细节。',
    taskType: 'feedback',
    templateId: 'translation-merge',
    skillIds: ['comment-translator', 'comment-merger'],
    prompt:
      '请按业务可读方式翻译批注，保留原文，合并重复项，但不要丢掉会影响打样的关键细节。',
    audienceHint: '适合多来源批注统一处理'
  },
  {
    id: 'reply-draft',
    title: '客户回复草稿',
    summary: '先保证承诺、交期、责任边界清楚，再润色英文表达。',
    taskType: 'reply',
    templateId: 'reply-preparation',
    skillIds: ['comment-translator', 'customer-reply-drafter'],
    prompt:
      '请从业务沟通角度生成英文回复草稿，重点保证承诺、交期、责任边界清晰，避免过度技术化表达。',
    audienceHint: '适合发给客户前的最终把关'
  }
];

export function getSkillById(id: string) {

  return skillCatalog.find((skill) => skill.id === id) ?? null;
}

export function getTemplateById(id: string) {
  return workflowTemplates.find((template) => template.id === id) ?? null;
}

export function getDefaultTemplateForTaskType(taskType: TaskType) {
  return workflowTemplates.find((template) => template.taskType === taskType) ?? null;
}
