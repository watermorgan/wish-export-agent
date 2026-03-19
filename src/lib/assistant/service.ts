import type { AssistantReply, AssistantRequest } from '@/lib/assistant/types';
import { buildAssistantReply } from '@/lib/assistant/mock-agent';

export async function runAssistant(
  request: AssistantRequest
): Promise<AssistantReply> {
  return buildAssistantReply({
    question: request.question,
    files: request.files
  });
}
