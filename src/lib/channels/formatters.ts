import type { AssistantReply } from '@/lib/assistant/types';

export function formatReplyAsPlainText(reply: AssistantReply) {
  const selectedSkills = reply.selectedSkills.map((skill) => skill.name).join(' -> ');
  const actions = reply.nextActions.map((item) => `- ${item}`).join('\n');
  const risks = reply.pendingConfirmations
    .map((item) => `- ${item.label}（${item.owner === 'sales' ? '业务员' : '主管'}）`)
    .join('\n');

  return [
    `[${reply.intentLabel} / ${reply.statusLabel}] ${reply.summary}`,
    '',
    `技能链：${selectedSkills || '未选择'}`,
    '',
    '建议动作：',
    actions,
    '',
    '待确认项：',
    risks,
    '',
    `输出方向：${reply.draftDirection}`
  ].join('\n');
}
