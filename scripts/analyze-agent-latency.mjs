#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const DEFAULT_OPENCLAW_LOG_DIR = '/tmp/openclaw';
const DEFAULT_HERMES_LOG = '/Users/weitao/.hermes/profiles/ting/logs/gateway.log';

function parseArgs(argv) {
  const args = {
    since: null,
    openclawLog: latestOpenClawLog() ?? join(DEFAULT_OPENCLAW_LOG_DIR, 'openclaw-YYYY-MM-DD.log'),
    hermesLog: DEFAULT_HERMES_LOG,
    format: 'text'
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--since') {
      args.since = argv[++i] ?? null;
    } else if (arg === '--openclaw-log') {
      args.openclawLog = argv[++i] ?? args.openclawLog;
    } else if (arg === '--hermes-log') {
      args.hermesLog = argv[++i] ?? args.hermesLog;
    } else if (arg === '--json') {
      args.format = 'json';
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/analyze-agent-latency.mjs [--since ISO_OR_LOCAL] [--json]

Examples:
  node scripts/analyze-agent-latency.mjs --since '2026-05-10 16:43'
  node scripts/analyze-agent-latency.mjs --since 2026-05-10T16:43:00+08:00 --json
`);
}

function latestOpenClawLog() {
  try {
    return readdirSync(DEFAULT_OPENCLAW_LOG_DIR)
      .filter((name) => /^openclaw-\d{4}-\d{2}-\d{2}\.log$/.test(name))
      .map((name) => join(DEFAULT_OPENCLAW_LOG_DIR, name))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0] ?? null;
  } catch {
    return null;
  }
}

function parseSince(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? `${value.replace(' ', 'T')}+08:00`
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --since value: ${value}`);
  }
  return date;
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function readLines(path) {
  try {
    return readFileSync(path, 'utf8').split('\n');
  } catch {
    return [];
  }
}

function parseOpenClaw(path, since) {
  const events = [];
  const warnings = [];

  for (const [index, line] of readLines(path).entries()) {
    if (!line.trim().startsWith('{')) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const time = parseLogTime(entry.time ?? entry._meta?.date);
    if (!time || (since && time < since)) continue;

    const message = stripAnsi(String(entry.message ?? entry['1'] ?? entry['0'] ?? ''));
    if (!message) continue;

    if (/registration not confirmed|contact.*permission|chunks_vec|dreaming cron|read failed|duplicate plugin/i.test(message)) {
      warnings.push({
        runtime: 'openclaw',
        time: time.toISOString(),
        line: index + 1,
        message: compact(message)
      });
    }

    const inbound = message.match(/\[(dingtalk|feishu)\].*Inbound: from=([^ ]+) text="([^"]*)"/i);
    if (inbound) {
      events.push({
        runtime: 'openclaw',
        channel: inbound[1].toLowerCase(),
        line: index + 1,
        inboundAt: time,
        user: inbound[2],
        prompt: inbound[3],
        dispatchAt: null,
        firstChunkAt: null,
        completeAt: null,
        firstChunkMs: null,
        totalMs: null,
        chars: null,
        warnings: []
      });
      continue;
    }

    const dispatch = message.match(/streaming via .*session=([^ ]+)/);
    if (dispatch) {
      const event = lastOpenEvent(events);
      if (event && !event.dispatchAt) {
        event.dispatchAt = time;
        event.session = dispatch[1];
      }
      continue;
    }

    const firstChunk = message.match(/first chunk .*after (\d+)ms.*start=([^)]+)/);
    if (firstChunk) {
      const streamStart = parseLogTime(firstChunk[2]);
      const event = findOpenEventByStreamStart(events, streamStart) ?? lastOpenEvent(events, true);
      if (event && !event.firstChunkAt) {
        event.firstChunkAt = time;
        event.firstChunkMs = Number(firstChunk[1]);
      }
      continue;
    }

    const finishing = message.match(/Finishing card with (\d+) chars/);
    if (finishing) {
      const event = events.find((candidate) => candidate.firstChunkAt && !candidate.completeAt) ?? lastOpenEvent(events, true);
      if (event) {
        event.completeAt = time;
        event.chars = Number(finishing[1]);
        if (event.inboundAt) {
          event.totalMs = time - event.inboundAt;
        }
      }
      continue;
    }
  }

  return { events: events.map(finalizeEvent), warnings };
}

function lastOpenEvent(events, allowCompleted = false) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (allowCompleted || !events[i].completeAt) {
      return events[i];
    }
  }
  return null;
}

function findOpenEventByStreamStart(events, streamStart) {
  if (!streamStart) return null;
  let best = null;
  let bestDelta = Infinity;

  for (const event of events) {
    if (event.firstChunkAt) continue;
    const anchor = event.dispatchAt ?? event.inboundAt;
    if (!anchor) continue;
    const delta = Math.abs(anchor - streamStart);
    if (delta < bestDelta) {
      best = event;
      bestDelta = delta;
    }
  }

  return bestDelta <= 5000 ? best : null;
}

function parseHermes(path, since) {
  const events = [];
  const warnings = [];

  for (const [index, line] of readLines(path).entries()) {
    const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),(\d{3})\s+\w+\s+[^:]+:\s+(.*)$/);
    if (!match) continue;
    const time = parseLogTime(`${match[1]}.${match[2]}+08:00`);
    if (!time || (since && time < since)) continue;
    const message = match[3];

    if (/Interrupt recursion|timeout|connection error|Connected via Stream|Disconnected|Another gateway instance|Channel directory built: 0 target/i.test(message)) {
      warnings.push({
        runtime: 'hermes',
        time: time.toISOString(),
        line: index + 1,
        message: compact(message)
      });
    }

    const inbound = message.match(/inbound message: platform=(\w+) user=([^ ]+) chat=([^ ]+) msg='([^']*)'/);
    if (inbound) {
      events.push({
        runtime: 'hermes',
        channel: inbound[1].toLowerCase(),
        line: index + 1,
        inboundAt: time,
        user: inbound[2],
        chat: inbound[3],
        prompt: inbound[4],
        responseReadyAt: null,
        totalMs: null,
        apiCalls: null,
        chars: null
      });
      continue;
    }

    const ready = message.match(/response ready: platform=(\w+).* chat=([^ ]+).* time=([\d.]+)s api_calls=(\d+) response=(\d+) chars/);
    if (ready) {
      const event = [...events]
        .reverse()
        .find((candidate) => candidate.runtime === 'hermes' && !candidate.responseReadyAt && candidate.channel === ready[1].toLowerCase() && candidate.chat === ready[2]);
      if (event) {
        event.responseReadyAt = time;
        event.totalMs = Math.round(Number(ready[3]) * 1000);
        event.apiCalls = Number(ready[4]);
        event.chars = Number(ready[5]);
      }
    }
  }

  return { events: events.map(finalizeEvent), warnings };
}

function parseLogTime(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function finalizeEvent(event) {
  const firstMs = event.firstChunkMs ?? null;
  let totalMs = event.totalMs ?? null;
  const overlapSuspect = firstMs !== null && totalMs !== null && totalMs < firstMs;
  if (overlapSuspect) {
    totalMs = null;
  }
  let verdict = 'pass';
  const toolHeavy = (event.apiCalls ?? 0) > 2 || /热点|记忆|整理|翻译|PDF|Excel|文件|任务/.test(event.prompt ?? '');
  if (firstMs === null && totalMs === null) {
    verdict = 'unknown';
  } else if (toolHeavy) {
    if ((firstMs !== null && firstMs > 30000) || (totalMs !== null && totalMs > 180000)) {
      verdict = 'fail';
    } else if ((firstMs !== null && firstMs > 10000) || (totalMs !== null && totalMs > 120000)) {
      verdict = 'warn';
    }
  } else if ((firstMs !== null && firstMs > 20000) || (totalMs !== null && totalMs > 60000)) {
    verdict = 'fail';
  } else if ((firstMs !== null && firstMs > 10000) || (totalMs !== null && totalMs > 30000)) {
    verdict = 'warn';
  }

  return {
    ...event,
    overlapSuspect,
    totalMs,
    inboundAt: event.inboundAt?.toISOString?.() ?? event.inboundAt,
    dispatchAt: event.dispatchAt?.toISOString?.() ?? event.dispatchAt,
    firstChunkAt: event.firstChunkAt?.toISOString?.() ?? event.firstChunkAt,
    completeAt: event.completeAt?.toISOString?.() ?? event.completeAt,
    responseReadyAt: event.responseReadyAt?.toISOString?.() ?? event.responseReadyAt,
    toolHeavy,
    verdict
  };
}

function compact(value) {
  return value.replace(/\s+/g, ' ').slice(0, 300);
}

function ms(value) {
  if (value === null || value === undefined) return '-';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function printText(report) {
  console.log(`# Agent latency report`);
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Since: ${report.since ?? 'beginning'}\n`);

  for (const source of report.sources) {
    console.log(`## ${source.runtime} (${basename(source.path)})`);
    if (source.events.length === 0) {
      console.log('No events found.\n');
      continue;
    }
    console.log('| verdict | channel | prompt | first | total | api | chars |');
    console.log('| --- | --- | --- | ---: | ---: | ---: | ---: |');
    for (const event of source.events) {
      console.log(`| ${event.verdict} | ${event.channel} | ${compact(event.prompt ?? '')} | ${ms(event.firstChunkMs)} | ${ms(event.totalMs)} | ${event.apiCalls ?? '-'} | ${event.chars ?? '-'} |`);
    }
    console.log('');
  }

  const warnings = report.sources.flatMap((source) => source.warnings);
  if (warnings.length > 0) {
    console.log('## Warnings / noise');
    for (const warning of warnings.slice(-30)) {
      console.log(`- ${warning.runtime} ${warning.time} L${warning.line}: ${warning.message}`);
    }
  }
}

const args = parseArgs(process.argv.slice(2));
const since = parseSince(args.since);
const report = {
  since: since?.toISOString() ?? null,
  sources: [
    { runtime: 'openclaw', path: args.openclawLog, ...parseOpenClaw(args.openclawLog, since) },
    { runtime: 'hermes', path: args.hermesLog, ...parseHermes(args.hermesLog, since) }
  ]
};

if (args.format === 'json') {
  console.log(JSON.stringify(report, null, 2));
} else {
  printText(report);
}
