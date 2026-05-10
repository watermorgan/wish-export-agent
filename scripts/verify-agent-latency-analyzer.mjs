#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), 'agent-latency-'));
const openclawLog = join(tempDir, 'openclaw.log');
const hermesLog = join(tempDir, 'gateway.log');

writeFileSync(openclawLog, [
  JSON.stringify({
    time: '2026-05-10T09:59:00.000Z',
    message: '[dingtalk] Inbound: from=user-0 text="只入站未完成"'
  }),
  JSON.stringify({
    time: '2026-05-10T10:00:00.000Z',
    message: '[dingtalk] Inbound: from=user-1 text="你好"'
  }),
  JSON.stringify({
    time: '2026-05-10T10:00:12.000Z',
    message: 'first chunk received after 12000ms (start=2026-05-10T10:00:00.000Z)'
  }),
  JSON.stringify({
    time: '2026-05-10T10:00:15.000Z',
    message: 'Finishing card with 42 chars'
  }),
  JSON.stringify({
    time: '2026-05-10T10:01:00.000Z',
    message: 'feishu[main]: Feishu[main] DM from user-feishu: [延迟测试] 飞书纯聊天'
  }),
  JSON.stringify({
    time: '2026-05-10T10:01:01.000Z',
    message: 'feishu[main]: dispatching to agent (session=agent:main:feishu:direct:user-feishu)'
  }),
  JSON.stringify({
    time: '2026-05-10T10:01:12.000Z',
    message: 'feishu[main]: dispatch complete (queuedFinal=true, replies=1)'
  })
].join('\n'));

writeFileSync(hermesLog, [
  '2026-05-10 17:59:59,000 INFO gateway.run: Channel directory built: 0 target(s)',
  "2026-05-10 18:00:00,000 INFO gateway: inbound message: platform=dingtalk user=user-2 chat=chat-a msg='聊聊天'",
  "2026-05-10 18:00:01,000 INFO gateway: inbound message: platform=dingtalk user=user-3 chat=chat-b msg='今天外贸有哪些热点'",
  '2026-05-10 18:02:03,600 INFO gateway: response ready: platform=dingtalk chat=chat-b time=122.6s api_calls=8 response=520 chars',
  '2026-05-10 18:02:04,100 INFO gateway: response ready: platform=dingtalk chat=chat-a time=9.1s api_calls=1 response=55 chars'
].join('\n'));

const output = execFileSync(process.execPath, [
  join(root, 'scripts/analyze-agent-latency.mjs'),
  '--openclaw-log',
  openclawLog,
  '--hermes-log',
  hermesLog,
  '--json'
], { encoding: 'utf8' });
const report = JSON.parse(output);

assertEqual(report.sources[0].events.length, 3, 'OpenClaw event count');
assertEqual(report.sources[0].events[0].verdict, 'unknown', 'OpenClaw unmatched verdict');
assertEqual(report.sources[0].events[1].firstChunkMs, 12000, 'OpenClaw first chunk');
assertEqual(report.sources[0].events[1].totalMs, 15000, 'OpenClaw total');
assertEqual(report.sources[0].events[1].verdict, 'warn', 'OpenClaw verdict');
assertEqual(report.sources[0].events[2].channel, 'feishu', 'OpenClaw feishu channel');
assertEqual(report.sources[0].events[2].totalMs, 12000, 'OpenClaw feishu total');
assertEqual(report.sources[0].events[2].verdict, 'pass', 'OpenClaw feishu verdict');
assertEqual(report.sources[1].events.length, 2, 'Hermes event count');
assertEqual(report.sources[1].events[0].chat, 'chat-a', 'Hermes first chat');
assertEqual(report.sources[1].events[0].totalMs, 9100, 'Hermes first chat total');
assertEqual(report.sources[1].events[0].verdict, 'pass', 'Hermes first chat verdict');
assertEqual(report.sources[1].events[1].chat, 'chat-b', 'Hermes second chat');
assertEqual(report.sources[1].events[1].apiCalls, 8, 'Hermes second chat API calls');
assertEqual(report.sources[1].events[1].totalMs, 122600, 'Hermes second chat total');
assertEqual(report.sources[1].events[1].verdict, 'warn', 'Hermes second chat verdict');
assertEqual(report.sources[1].warnings.length, 1, 'Hermes warning count');

console.log('agent latency analyzer fixture verification passed');

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}
