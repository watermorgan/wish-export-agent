import { NextResponse } from 'next/server';
import {
  AssistantTaskServiceError,
  getTingPdfTranslationTaskPayload
} from '@/lib/assistant/service';

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { taskId } = await context.params;
  try {
    return NextResponse.json(await getTingPdfTranslationTaskPayload(taskId));
  } catch (error) {
    if (error instanceof AssistantTaskServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
