import { NextResponse } from 'next/server';
import {
  MAX_FILES,
  buildAssistantReply,
  formQuestionSchema,
  uploadedFileSchema
} from '@/lib/assistant/mock-agent';

export async function POST(request: Request) {
  const formData = await request.formData();
  const question = formQuestionSchema.parse(formData.get('question'));

  const files = formData
    .getAll('files')
    .filter((value): value is File => value instanceof File && value.size > 0)
    .map((file) =>
      uploadedFileSchema.parse({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream'
      })
    );

  if (files.length > MAX_FILES) {
    return NextResponse.json(
      {
        error: `一次最多上传 ${MAX_FILES} 个文件。`
      },
      { status: 400 }
    );
  }

  const payload = buildAssistantReply({
    question,
    files
  });

  return NextResponse.json(payload);
}
