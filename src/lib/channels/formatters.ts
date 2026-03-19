import type { AssistantReply } from '@/lib/assistant/types';

export function formatReplyAsPlainText(reply: AssistantReply) {
  const actions = reply.nextActions.map((item) => `- ${item}`).join('\n');
  const risks = reply.riskAlerts.map((item) => `- ${item}`).join('\n');

  return [
    `[${reply.intentLabel}] ${reply.summary}`,
    '',
    '建议动作：',
    actions,
    '',
    '待确认项：',
    risks,
    '',
    `回复方向：${reply.draftDirection}`
  ].join('\n');
}
