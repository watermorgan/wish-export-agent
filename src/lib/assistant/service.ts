import { runAssistant as runExecution } from '@/lib/assistant/execution';
import type { AssistantReply, AssistantRequest } from '@/lib/assistant/types';

/**
 * Service-level entry point for the assistant.
 * In the real LLM orchestration mode (P2), this forwards to the generic
 * sequential runner in execution.ts.
 */
export async function runAssistant(
  request: AssistantRequest
): Promise<AssistantReply> {
  return runExecution(request);
}
