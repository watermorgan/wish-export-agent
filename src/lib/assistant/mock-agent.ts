import { z } from 'zod';
import { buildAssistantReply } from '@/lib/assistant/execution';
import type { AssistantRequest } from '@/lib/assistant/types';

export const MAX_FILES = 5;

export const formQuestionSchema = z
  .string({
    error: '请输入问题。'
  })
  .trim()
  .min(6, '问题至少需要 6 个字符。')
  .max(1200, '问题过长，请缩短后再试。');

export const uploadedFileSchema = z.object({
  name: z.string().min(1).max(180),
  size: z.number().nonnegative().max(20 * 1024 * 1024),
  type: z.string().min(1).max(120)
});

export const assistantRoleSchema = z.enum(['sales', 'supervisor']).default('sales');

export const taskTypeSchema = z.enum(['bom', 'feedback', 'reply']).optional();

export const selectedTemplateSchema = z.string().trim().min(1).optional();

export const selectedSkillIdsSchema = z.array(z.string().trim().min(1)).default([]);

export function createAssistantReply(input: AssistantRequest) {
  return buildAssistantReply(input);
}
