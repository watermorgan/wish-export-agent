import { buildAssistantReply } from '@/lib/assistant/execution';
import { maybeRunRealFeedbackTranslation } from '@/lib/assistant/feedback-translation';
import type { AssistantReply, AssistantRequest } from '@/lib/assistant/types';

export async function runAssistant(
  request: AssistantRequest
): Promise<AssistantReply> {
  const reply = buildAssistantReply(request);
  return maybeRunRealFeedbackTranslation(request, reply);
}
