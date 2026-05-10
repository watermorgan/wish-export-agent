#!/usr/bin/env node
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OPENCLAW_HOME = '/Users/weitao/.openclaw';
const EXTENSION_ROOT = join(OPENCLAW_HOME, 'extensions', 'dingtalk');
const DIST_PATH = join(EXTENSION_ROOT, 'dist', 'index.js');
const MANIFEST_PATH = join(EXTENSION_ROOT, 'openclaw.plugin.json');
const BACKUP_DIR = join(OPENCLAW_HOME, 'backups');

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');

function main() {
  const report = {
    distPath: DIST_PATH,
    manifestPath: MANIFEST_PATH,
    distPatches: [],
    manifestPatched: false,
    backups: []
  };

  const originalDist = readFileSync(DIST_PATH, 'utf8');
  let nextDist = originalDist;

  nextDist = ensureSilentReplyGuard(nextDist, report.distPatches);
  nextDist = ensureSilentPreviewSuppression(nextDist, report.distPatches);
  nextDist = ensureSilentCardFinishSuppression(nextDist, report.distPatches);
  nextDist = ensureMediaFallbackDoesNotLeakPath(nextDist, report.distPatches);

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const manifestChanged = ensureChannelConfigs(manifest);
  report.manifestPatched = manifestChanged;

  if (!checkOnly) {
    if (nextDist !== originalDist) {
      report.backups.push(backupFile(DIST_PATH));
      writeFileSync(DIST_PATH, nextDist, 'utf8');
    }

    if (manifestChanged) {
      report.backups.push(backupFile(MANIFEST_PATH));
      writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
  }

  console.log(JSON.stringify({
    mode: checkOnly ? 'check' : 'apply',
    changed: !checkOnly && (nextDist !== originalDist || manifestChanged),
    needsPatch: nextDist !== originalDist || manifestChanged,
    ...report
  }, null, 2));
}

function ensureSilentReplyGuard(source, patches) {
  const tokenMarker = 'var DINGTALK_SILENT_REPLY_TOKEN = "NO_REPLY";';
  if (!source.includes(tokenMarker)) {
    source = replaceOnce(
      source,
      'var DEFAULT_MARKDOWN_TITLE = "Moltbot";',
      [
        'var DEFAULT_MARKDOWN_TITLE = "Moltbot";',
        'var DINGTALK_SILENT_REPLY_TOKEN = "NO_REPLY";',
        'function isSilentDingtalkReplyText(text) {',
        '  return typeof text === "string" && text.trim() === DINGTALK_SILENT_REPLY_TOKEN;',
        '}',
        'function isSilentDingtalkReplyPrefixText(text) {',
        '  if (typeof text !== "string") {',
        '    return false;',
        '  }',
        '  const trimmed = text.trimStart();',
        '  if (!trimmed || trimmed.length < 2 || trimmed !== trimmed.toUpperCase()) {',
        '    return false;',
        '  }',
        '  if (/[^A-Z_]/.test(trimmed)) {',
        '    return false;',
        '  }',
        '  if (!DINGTALK_SILENT_REPLY_TOKEN.startsWith(trimmed)) {',
        '    return false;',
        '  }',
        '  return trimmed.includes("_") || trimmed === "NO";',
        '}',
        'function shouldSuppressDingtalkSilentText(text) {',
        '  return isSilentDingtalkReplyText(text);',
        '}'
      ].join('\n')
    );
    patches.push('inserted_silent_reply_helpers');
  }

  const sendGuard = 'if (shouldSuppressDingtalkSilentText(text)) {';
  if (!source.includes(sendGuard)) {
    source = replaceOnce(
      source,
      '  const { cfg, to, text, chatType, title } = params;',
      [
        '  const { cfg, to, text, chatType, title } = params;',
        '  if (shouldSuppressDingtalkSilentText(text)) {',
        '    return {',
        '      messageId: `silent_${Date.now()}`,',
        '      conversationId: to,',
        '      suppressed: true',
        '    };',
        '  }'
      ].join('\n')
    );
    patches.push('inserted_silent_reply_send_guard');
  }

  return source;
}

function ensureSilentPreviewSuppression(source, patches) {
  const marker = 'logger.debug(`[stream] suppressed silent reply preview fragment`)';
  if (source.includes(marker)) {
    return source;
  }

  source = source.replace(
    /(\s+accumulated \+= chunk;\n\s+chunkCount \+= 1;\n)/,
    `$1      if (isSilentDingtalkReplyPrefixText(accumulated)) {\n        logger.debug(\`[stream] suppressed silent reply preview fragment\`);\n        continue;\n      }\n`
  );
  patches.push('inserted_silent_reply_preview_guard');
  return source;
}

function ensureSilentCardFinishSuppression(source, patches) {
  const marker = 'AI Card streaming completed with silent reply suppressed';
  if (source.includes(marker)) {
    return source;
  }

  source = replaceOnce(
    source,
    [
      '    const preparedReply = prepareDingtalkReplyContent({',
      '      text: accumulated,',
      '      logger',
      '    });',
      '    await finishAICard(card, preparedReply.text, (msg) => logger.debug(msg));'
    ].join('\n'),
    [
      '    const preparedReply = prepareDingtalkReplyContent({',
      '      text: accumulated,',
      '      logger',
      '    });',
      '    if (shouldSuppressDingtalkSilentText(preparedReply.text)) {',
      '      await finishAICard(card, "", (msg) => logger.debug(msg));',
      '      logger.info(`AI Card streaming completed with silent reply suppressed`);',
      '      return;',
      '    }',
      '    await finishAICard(card, preparedReply.text, (msg) => logger.debug(msg));'
    ].join('\n')
  );
  patches.push('inserted_silent_reply_finish_guard');
  return source;
}

function ensureMediaFallbackDoesNotLeakPath(source, patches) {
  if (source.includes('文件发送失败：${failedName}，请稍后重试')) {
    return source;
  }

  source = replaceOnce(
    source,
    '        const fallbackText = `\\u{1F4CE} ${mediaUrl}`;',
    [
      '        const failedName = mediaUrl.split("/").pop() || "file";',
      '        const fallbackText = `\\u{1F4CE} 文件发送失败：${failedName}，请稍后重试`;'
    ].join('\n')
  );
  patches.push('replaced_media_path_fallback');
  return source;
}

function ensureChannelConfigs(manifest) {
  manifest.channelConfigs ||= {};
  if (manifest.channelConfigs.dingtalk) {
    return false;
  }

  manifest.channelConfigs.dingtalk = {
    label: 'DingTalk',
    description: '钉钉企业消息渠道配置',
    schema: {
      type: 'object'
    }
  };
  return true;
}

function replaceOnce(source, search, replacement) {
  if (!source.includes(search)) {
    throw new Error(`Patch anchor not found: ${search.slice(0, 80)}`);
  }
  return source.replace(search, replacement);
}

function backupFile(filePath) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const backupPath = join(BACKUP_DIR, `${resolve(filePath).split('/').pop()}.${stamp}.bak`);
  writeFileSync(backupPath, readFileSync(filePath));
  return {
    source: filePath,
    backup: backupPath,
    size: statSync(filePath).size
  };
}

main();
