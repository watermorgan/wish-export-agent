import { z } from 'zod';
import type { AssistantReply, UploadedFile } from '@/lib/assistant/types';

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

const intentKeywords = {
  quote: ['报价', 'price', 'quotation', 'quote', '成本', '交期'],
  reply: ['回复', '邮件', 'email', '英文', '跟进', 'follow'],
  handoff: ['转交', 'handoff', '谁跟进', '负责人', '分配']
};

function detectIntent(question: string): AssistantReply['intent'] {
  const lower = question.toLowerCase();

  for (const keyword of intentKeywords.quote) {
    if (lower.includes(keyword)) {
      return 'quote';
    }
  }

  for (const keyword of intentKeywords.reply) {
    if (lower.includes(keyword)) {
      return 'reply';
    }
  }

  for (const keyword of intentKeywords.handoff) {
    if (lower.includes(keyword)) {
      return 'handoff';
    }
  }

  return 'summary';
}

function buildSummary(question: string, files: UploadedFile[]) {
  if (files.length === 0) {
    return `已收到问题“${question}”。当前还没有附件，建议至少补充一份客户询盘或产品资料，让智能体有明确上下文。`;
  }

  const fileNames = files.map((file) => file.name).join('、');
  return `已收到 ${files.length} 份资料：${fileNames}。系统会围绕你的问题“${question}”先做信息归纳，再给出后续动作建议。`;
}

function buildDraftDirection(intent: AssistantReply['intent']) {
  switch (intent) {
    case 'quote':
      return '建议输出“报价前检查清单 + 需补充字段 + 面向客户的英文澄清问题”，而不是直接给最终价格。';
    case 'reply':
      return '建议输出“英文回复骨架 + 可替换变量 + 中文备注”，让业务同事能快速审校后发送。';
    case 'handoff':
      return '建议输出“客户背景摘要 + 当前阶段 + 推荐承接角色 + 交接注意事项”。';
    default:
      return '建议输出“客户需求摘要 + 风险点 + 建议动作”，先帮助销售同事理解上下文。';
  }
}

export function buildAssistantReply(input: {
  question: string;
  files: UploadedFile[];
}): AssistantReply {
  const intent = detectIntent(input.question);

  const intentLabelMap: Record<AssistantReply['intent'], string> = {
    summary: '需求梳理',
    reply: '回复草拟',
    quote: '报价准备',
    handoff: '线索交接'
  };

  return {
    intent,
    intentLabel: intentLabelMap[intent],
    summary: buildSummary(input.question, input.files),
    nextActions: [
      '抽取客户国家、产品、数量、目标价、交期和认证要求。',
      '把缺失字段单独列出，供人工补齐或二次追问。',
      '输出面向销售动作的结果，而不是泛泛的聊天式回答。'
    ],
    riskAlerts: [
      '请人工确认最终价格、库存、交付周期与付款条款。',
      '若附件包含客户隐私信息，后续需要补充脱敏和访问控制。',
      '如果文件来源复杂，后续应增加来源追踪和引用片段。'
    ],
    draftDirection: buildDraftDirection(intent)
  };
}
