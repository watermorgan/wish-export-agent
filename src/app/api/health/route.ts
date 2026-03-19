import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'wish-export-agent',
    mode: 'skeleton'
  });
}
