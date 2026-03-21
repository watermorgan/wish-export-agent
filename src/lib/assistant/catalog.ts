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

export const taskTypeOptions: TaskTypeOption[] = [
  {
    id: 'bom',
    label: 'BOM 整理',
    description: '把工艺单、说明资料和图片批注整理成结构化 BOM。'
  },
  {
    id: 'feedback',
    label: '意见翻译与归并',
    description: '处理多来源批注、翻译、去重和主题归并。'
  },
  {
    id: 'reply',
    label: '客户回复草拟',
    description: '基于客户上下文和附件生成可审校的英文回复草稿。'
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
    goal: '把工艺单资料整理成结构化 BOM。',
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
    name: '翻译与归并链',
    goal: '把多来源意见翻译、去重 and 分组。',
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
    goal: '先理解多来源意见，再输出客户回复草稿。',
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
  "请整理工艺单附件，输出结构化 BOM，并列出缺失字段。",
  "请保留英文原文，在每段下方增加中文翻译，仅做翻译，不做归并。",
  "请基于客户邮件和附件，生成英文回复草稿，并把高风险承诺单独列出。",
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
