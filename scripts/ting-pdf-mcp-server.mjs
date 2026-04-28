import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SERVER_NAME = 'ting-foreign-trade-pdf-local';
const SERVER_VERSION = '0.1.0';
const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_SUCCESS_TASK_ID = 'task_ui_fixture_preview';
const DEFAULT_TEMPLATE_ID = 'translation-merge';
const DEFAULT_SKILL_IDS = ['comment-translator', 'comment-merger'];
const BASE_URL = process.env.EXPORT_AGENT_BASE_URL?.trim();

if (!BASE_URL) {
  process.stderr.write('[ting-foreign-trade-pdf-local] Missing EXPORT_AGENT_BASE_URL\n');
}

const tools = [
  {
    name: 'submit_pdf_translation_task',
    title: 'Submit PDF Translation Task',
    description:
      'Create a PDF translation task through the running export-agent service. For real work provide pdfPath; omit it only for deterministic blocked-smoke flows with explicit selectedSkillIds.',
    annotations: {
      title: 'Submit PDF Translation Task',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'User-facing task intent or translation instruction.'
        },
        pdfPath: {
          type: 'string',
          description: 'Absolute local path to the source PDF.'
        },
        role: {
          type: 'string',
          enum: ['sales', 'supervisor'],
          description: 'Assistant role. Defaults to sales.'
        },
        selectedSkillIds: {
          type: 'array',
          description:
            'Optional override for deterministic diagnostics. Defaults to comment-translator + comment-merger.',
          items: {
            type: 'string'
          }
        },
        selectedTemplateId: {
          type: 'string',
          description: 'Optional template override. Defaults to translation-merge.'
        },
        modelOverride: {
          type: 'string'
        },
        visionModelOverride: {
          type: 'string'
        },
        translationModelOverride: {
          type: 'string'
        }
      },
      required: ['question']
    },
  },
  {
    name: 'get_pdf_translation_task',
    title: 'Get PDF Translation Task',
    description: 'Read a task snapshot from the running export-agent service.',
    annotations: {
      title: 'Get PDF Translation Task',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: `Task id to fetch. Use ${DEFAULT_SUCCESS_TASK_ID} for the deterministic success fixture.`
        }
      },
      required: ['taskId']
    },
  },
  {
    name: 'get_pdf_translation_skill_payload',
    title: 'Get PDF Translation Skill Payload',
    description:
      'Read the stable Ting foreign-trade assistant transport payload for a task from the running export-agent service.',
    annotations: {
      title: 'Get PDF Translation Skill Payload',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: `Task id to fetch. Use ${DEFAULT_SUCCESS_TASK_ID} for the deterministic success fixture.`
        }
      },
      required: ['taskId']
    }
  },
  {
    name: 'submit_task_overrides',
    title: 'Submit Task Overrides',
    description: 'Apply page-level overrides to an existing translation task.',
    annotations: {
      title: 'Submit Task Overrides',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        actor: { type: 'string', enum: ['sales', 'supervisor'] },
        reason: { type: 'string' },
        pageOverrides: { type: 'object' }
      },
      required: ['taskId', 'reason', 'pageOverrides']
    }
  },
  {
    name: 'request_task_rework',
    title: 'Request Task Rework',
    description: 'Request bounded rework for an existing translation task.',
    annotations: {
      title: 'Request Task Rework',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        actor: { type: 'string', enum: ['sales', 'supervisor'] },
        scope: { type: 'string', enum: ['pages'] },
        pageNumbers: { type: 'array', items: { type: 'number' } },
        instruction: { type: 'string' },
        note: { type: 'string' },
        sourceFeedbackIds: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['retranslate', 'revise'], description: "'retranslate' = only re-translate (default), 'revise' = re-run vision OCR + translate" }
      },
      required: ['taskId', 'scope', 'instruction']
    }
  },
  {
    name: 'get_task_revision',
    title: 'Get Task Revision',
    description: 'Read revision lineage for an existing translation task.',
    annotations: {
      title: 'Get Task Revision',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        revisionId: { type: 'string' }
      },
      required: ['taskId', 'revisionId']
    }
  },
  {
    name: 'submit_feedback_case',
    title: 'Submit Feedback Case',
    description: 'Submit a feedback case for long-term learning/governance.',
    annotations: {
      title: 'Submit Feedback Case',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        priority: { type: 'string' },
        source: { type: 'object' },
        reporter: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['category', 'source']
    }
  }
];

function sendMessage(message) {
  const json = JSON.stringify(message);
  // Use JSONL format (newline-delimited JSON) for local MCP command transport clients.
  process.stdout.write(json + '\n');
}

function sendResponse(id, result) {
  sendMessage({
    jsonrpc: '2.0',
    id,
    result
  });
}

function sendError(id, code, message, data) {
  sendMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  });
}

function buildToolResult(structuredContent, options = {}) {
  const {
    isError = false,
    text = JSON.stringify(structuredContent, null, 2)
  } = options;

  return {
    structuredContent,
    content: [
      {
        type: 'text',
        text
      }
    ],
    ...(isError ? { isError: true } : {})
  };
}

function ensureBaseUrl() {
  if (!BASE_URL) {
    return buildToolResult(
      {
        status: 503,
        error: 'EXPORT_AGENT_BASE_URL 未配置，MCP server 无法连接 export-agent 服务。'
      },
      { isError: true }
    );
  }

  return null;
}

async function readJsonResponse(response) {
  const text = await response.text();
  return text.trim() ? JSON.parse(text) : {};
}

async function requestService(pathname, init) {
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, init);
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        payload
      };
    }

    return {
      ok: true,
      status: response.status,
      payload
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 503,
      payload: {
        category: 'backend_unreachable',
        error: `无法连接 export-agent 后端 (${BASE_URL}${pathname})：${detail}`,
        hint: '请执行 npm run service:preflight，确认服务、MCP 文件与 gateway 都已恢复。'
      }
    };
  }
}

function normalizeProtocolVersion(requestedVersion) {
  if (SUPPORTED_PROTOCOLS.includes(requestedVersion)) {
    return requestedVersion;
  }

  return SUPPORTED_PROTOCOLS[0];
}

function validateObject(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} 必须是对象。`);
  }

  return value;
}

async function buildUploadedPdf(pdfPath) {
  const resolvedPath = path.resolve(pdfPath);
  const info = await stat(resolvedPath);

  if (!info.isFile()) {
    throw new Error('pdfPath 必须指向文件。');
  }

  return {
    name: path.basename(resolvedPath),
    size: info.size,
    type: 'application/pdf',
    storagePath: resolvedPath
  };
}

async function handleSubmit(argumentsObject) {
  const missingBaseUrl = ensureBaseUrl();
  if (missingBaseUrl) {
    return missingBaseUrl;
  }

  const args = validateObject(argumentsObject ?? {}, 'arguments');
  const question =
    typeof args.question === 'string' && args.question.trim()
      ? args.question.trim()
      : null;

  if (!question) {
    throw new Error('question 为必填项。');
  }

  const hasPdfPath = typeof args.pdfPath === 'string' && args.pdfPath.trim().length > 0;
  const hasSelectedSkillOverride =
    Array.isArray(args.selectedSkillIds) && args.selectedSkillIds.length > 0;

  if (!hasPdfPath && !hasSelectedSkillOverride) {
    throw new Error('pdfPath 为真实 PDF 翻译必填项；仅诊断/回归场景可显式传 selectedSkillIds 覆盖。');
  }

  const files = hasPdfPath ? [await buildUploadedPdf(args.pdfPath)] : [];
  const requestBody = {
    channel: 'web',
    role: args.role === 'supervisor' ? 'supervisor' : 'sales',
    question,
    files,
    taskType: 'feedback',
    selectedTemplateId:
      typeof args.selectedTemplateId === 'string' && args.selectedTemplateId.trim()
        ? args.selectedTemplateId.trim()
        : DEFAULT_TEMPLATE_ID,
    selectedSkillIds: hasSelectedSkillOverride
      ? args.selectedSkillIds
      : DEFAULT_SKILL_IDS,
    ...(typeof args.modelOverride === 'string' && args.modelOverride.trim()
      ? { modelOverride: args.modelOverride.trim() }
      : {}),
    ...(typeof args.visionModelOverride === 'string' && args.visionModelOverride.trim()
      ? { visionModelOverride: args.visionModelOverride.trim() }
      : {}),
    ...(typeof args.translationModelOverride === 'string' && args.translationModelOverride.trim()
      ? { translationModelOverride: args.translationModelOverride.trim() }
      : {})
  };

  const response = await requestService('/api/tasks', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    return buildToolResult(
      {
        status: response.status,
        error:
          typeof response.payload?.error === 'string'
            ? response.payload.error
            : '创建任务失败。'
      },
      { isError: true }
    );
  }

  return buildToolResult(response.payload);
}

async function handleGetTask(argumentsObject) {
  const missingBaseUrl = ensureBaseUrl();
  if (missingBaseUrl) {
    return missingBaseUrl;
  }

  const args = validateObject(argumentsObject ?? {}, 'arguments');
  if (typeof args.taskId !== 'string' || !args.taskId.trim()) {
    throw new Error('taskId 为必填项。');
  }

  const response = await requestService(`/api/tasks/${encodeURIComponent(args.taskId)}`);

  if (!response.ok) {
    return buildToolResult(
      {
        status: response.status,
        error:
          typeof response.payload?.error === 'string'
            ? response.payload.error
            : '读取任务失败。'
      },
      { isError: true }
    );
  }

  return buildToolResult(response.payload);
}

async function handleGetSkillPayload(argumentsObject) {
  const missingBaseUrl = ensureBaseUrl();
  if (missingBaseUrl) {
    return missingBaseUrl;
  }

  const args = validateObject(argumentsObject ?? {}, 'arguments');
  if (typeof args.taskId !== 'string' || !args.taskId.trim()) {
    throw new Error('taskId 为必填项。');
  }

  const response = await requestService(
    `/api/tasks/${encodeURIComponent(args.taskId)}/skill-payload`
  );

  if (!response.ok) {
    return buildToolResult(
      {
        status: response.status,
        error:
          typeof response.payload?.error === 'string'
            ? response.payload.error
            : '读取 skill payload 失败。'
      },
      { isError: true }
    );
  }

  const links = response.payload?.result?.artifactLinks;
  const deliveryPdfUrl =
    typeof response.payload?.result?.deliveryPdfUrl === 'string' &&
    response.payload.result.deliveryPdfUrl
      ? response.payload.result.deliveryPdfUrl
      : null;
  const preferredAnnotatedPdfUrl = Array.isArray(links)
    ? links.find((link) => typeof link?.annotatedPdfUrl === 'string' && link.annotatedPdfUrl)?.annotatedPdfUrl
    : null;
  const fallbackTableStylePdfUrl = Array.isArray(links)
    ? links.find((link) => typeof link?.tableStylePdfUrl === 'string' && link.tableStylePdfUrl)?.tableStylePdfUrl
    : null;
  const preferredDeliveryUrl =
    deliveryPdfUrl ?? preferredAnnotatedPdfUrl ?? fallbackTableStylePdfUrl ?? null;
  const preferredDeliveryType = deliveryPdfUrl
    ? 'annotated_pdf'
    : preferredAnnotatedPdfUrl
      ? 'annotated_pdf'
      : fallbackTableStylePdfUrl
        ? 'table_style_pdf_fallback'
        : 'none';
  const normalizedPayload =
    response.payload &&
    typeof response.payload === 'object' &&
    response.payload.result &&
    typeof response.payload.result === 'object'
      ? {
          ...response.payload,
          result: {
            ...response.payload.result,
            preferredDelivery: {
              url: preferredDeliveryUrl,
              type: preferredDeliveryType,
              strict: true,
              note:
                preferredDeliveryType === 'annotated_pdf'
                  ? '默认必须交付原文标注翻译PDF。'
                  : preferredDeliveryType === 'table_style_pdf_fallback'
                    ? '仅在标注PDF不可用时使用列表表格PDF。'
                    : '当前暂无可交付PDF链接。'
            },
            agentDeliveryPolicy:
              preferredDeliveryType === 'annotated_pdf'
                ? 'use_annotated_pdf_only'
                : preferredDeliveryType === 'table_style_pdf_fallback'
                  ? 'use_table_style_pdf_as_fallback_only'
                  : 'poll_until_pdf_ready'
          }
        }
      : response.payload;
  const guide = deliveryPdfUrl
    ? `唯一交付入口：请只使用 deliveryPdfUrl（原文标注翻译PDF）作为最终给业务的文档，不要再自行把 xlsx/html 转 PDF。\ndeliveryPdfUrl: ${deliveryPdfUrl}`
    : preferredAnnotatedPdfUrl
      ? `交付优先级：请优先使用 annotatedPdfUrl（原文标注翻译PDF）作为最终给业务的文档；仅当 annotatedPdfUrl 不可用时，才使用 tableStylePdfUrl（列表表格PDF）。\npreferredAnnotatedPdfUrl: ${preferredAnnotatedPdfUrl}`
    : fallbackTableStylePdfUrl
      ? `当前未提供 annotatedPdfUrl，请降级使用 tableStylePdfUrl（列表表格PDF）。\nfallbackTableStylePdfUrl: ${fallbackTableStylePdfUrl}`
      : '当前 payload 未提供可下载 PDF 链接，请继续轮询任务或检查服务日志。';

  return buildToolResult(normalizedPayload, {
    text: `${guide}\npreferredDeliveryType: ${preferredDeliveryType}\n\n${JSON.stringify(normalizedPayload, null, 2)}`
  });
}

async function handleSubmitTaskOverrides(argumentsObject) {
  const missingBaseUrl = ensureBaseUrl();
  if (missingBaseUrl) {
    return missingBaseUrl;
  }

  const args = validateObject(argumentsObject ?? {}, 'arguments');
  if (typeof args.taskId !== 'string' || !args.taskId.trim()) {
    throw new Error('taskId 为必填项。');
  }

  const response = await requestService(`/api/tasks/${encodeURIComponent(args.taskId)}/overrides`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      actor: args.actor === 'supervisor' ? 'supervisor' : 'sales',
      reason: typeof args.reason === 'string' ? args.reason : '',
      pageOverrides: args.pageOverrides
    })
  });

  if (!response.ok) {
    return buildToolResult(
      {
        status: response.status,
        ...(response.payload && typeof response.payload === 'object' ? response.payload : {}),
        error:
          typeof response.payload?.error === 'string' ? response.payload.error : '提交页面覆盖失败。'
      },
      { isError: true }
    );
  }

  return buildToolResult(response.payload);
}

async function handleRequestTaskRework(argumentsObject) {
  const missingBaseUrl = ensureBaseUrl();
  if (missingBaseUrl) {
    return missingBaseUrl;
  }

  const args = validateObject(argumentsObject ?? {}, 'arguments');
  if (typeof args.taskId !== 'string' || !args.taskId.trim()) {
    throw new Error('taskId 为必填项。');
  }

  const response = await requestService(`/api/tasks/${encodeURIComponent(args.taskId)}/rework`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      actor: args.actor === 'supervisor' ? 'supervisor' : 'sales',
      reason: typeof args.reason === 'string' ? args.reason : undefined,
      scope: args.scope,
      pageNumbers: args.pageNumbers,
      instruction: args.instruction,
      note: args.note,
      sourceFeedbackIds: args.sourceFeedbackIds
    })
  });

  if (!response.ok) {
    return buildToolResult(
      {
        status: response.status,
        ...(response.payload && typeof response.payload === 'object' ? response.payload : {}),
        error: typeof response.payload?.error === 'string' ? response.payload.error : '提交返工失败。'
      },
      { isError: true }
    );
  }

  return buildToolResult(response.payload);
}

async function handleGetTaskRevision(argumentsObject) {
  const missingBaseUrl = ensureBaseUrl();
  if (missingBaseUrl) {
    return missingBaseUrl;
  }

  const args = validateObject(argumentsObject ?? {}, 'arguments');
  if (typeof args.taskId !== 'string' || !args.taskId.trim()) {
    throw new Error('taskId 为必填项。');
  }
  if (typeof args.revisionId !== 'string' || !args.revisionId.trim()) {
    throw new Error('revisionId 为必填项。');
  }

  const response = await requestService(
    `/api/tasks/${encodeURIComponent(args.taskId)}/revisions/${encodeURIComponent(args.revisionId)}`
  );

  if (!response.ok) {
    return buildToolResult(
      {
        status: response.status,
        error: typeof response.payload?.error === 'string' ? response.payload.error : '读取 revision 失败。'
      },
      { isError: true }
    );
  }

  return buildToolResult(response.payload);
}

async function handleSubmitFeedbackCase(argumentsObject) {
  const missingBaseUrl = ensureBaseUrl();
  if (missingBaseUrl) {
    return missingBaseUrl;
  }

  const args = validateObject(argumentsObject ?? {}, 'arguments');
  const response = await requestService('/api/feedback', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(args)
  });

  if (!response.ok) {
    return buildToolResult(
      {
        status: response.status,
        error: typeof response.payload?.error === 'string' ? response.payload.error : '提交反馈失败。'
      },
      { isError: true }
    );
  }

  return buildToolResult(response.payload);
}

async function handleCall(name, argumentsObject) {
  switch (name) {
    case 'submit_pdf_translation_task':
      return handleSubmit(argumentsObject);
    case 'get_pdf_translation_task':
      return handleGetTask(argumentsObject);
    case 'get_pdf_translation_skill_payload':
      return handleGetSkillPayload(argumentsObject);
    case 'submit_task_overrides':
      return handleSubmitTaskOverrides(argumentsObject);
    case 'request_task_rework':
      return handleRequestTaskRework(argumentsObject);
    case 'get_task_revision':
      return handleGetTaskRevision(argumentsObject);
    case 'submit_feedback_case':
      return handleSubmitFeedbackCase(argumentsObject);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleRequest(message) {
  if (Array.isArray(message)) {
    await Promise.all(message.map((entry) => handleRequest(entry)));
    return;
  }

  if (!message || typeof message !== 'object') {
    return;
  }

  if (!('method' in message)) {
    return;
  }

  const { id, method, params } = message;

  try {
    switch (method) {
      case 'initialize':
        sendResponse(id, {
          protocolVersion: normalizeProtocolVersion(params?.protocolVersion),
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: SERVER_NAME,
            title: 'Export Agent PDF Local MCP',
            version: SERVER_VERSION
          },
          instructions:
            'Use the bounded PDF translation task tools. Business payload remains inside result: pdf_translation_skill_v1.'
        });
        return;
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return;
      case 'ping':
        sendResponse(id, {});
        return;
      case 'tools/list':
        sendResponse(id, {
          tools
        });
        return;
      case 'tools/call': {
        if (!params || typeof params.name !== 'string') {
          sendError(id, -32602, 'Invalid tool call arguments');
          return;
        }
        const result = await handleCall(params.name, params.arguments);
        sendResponse(id, result);
        return;
      }
      default:
        sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    if (method === 'tools/call') {
      sendResponse(id, buildToolResult({ error: messageText }, { isError: true, text: messageText }));
      return;
    }
    sendError(id, -32603, messageText);
  }
}

function parseMessages(buffer) {
  const messages = [];
  let remaining = buffer;

  // Support both JSONL (newline-delimited) and Content-Length framed formats
  while (remaining.length > 0) {
    // Try Content-Length framing first
    const headerEnd = remaining.indexOf('\r\n\r\n');
    const newlineIdx = remaining.indexOf('\n');

    if (headerEnd !== -1 && (newlineIdx === -1 || headerEnd < newlineIdx)) {
      // Content-Length framed format
      const header = remaining.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (match) {
        const contentLength = Number.parseInt(match[1], 10);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + contentLength;

        if (remaining.slice(bodyStart).length < contentLength) {
          break;
        }

        try {
          messages.push(JSON.parse(remaining.slice(bodyStart, bodyEnd)));
        } catch (error) {
          process.stderr.write(
            `[${SERVER_NAME}] invalid framed JSON: ${error instanceof Error ? error.message : String(error)}\n`
          );
        }

        remaining = remaining.slice(bodyEnd);
        continue;
      }
    }

    // JSONL format: newline-delimited JSON
    if (newlineIdx !== -1) {
      const line = remaining.slice(0, newlineIdx).replace(/\r$/, '');
      remaining = remaining.slice(newlineIdx + 1);

      if (line.trim().length === 0) {
        continue;
      }

      try {
        messages.push(JSON.parse(line));
      } catch (error) {
        process.stderr.write(
          `[${SERVER_NAME}] invalid JSONL line: ${error instanceof Error ? error.message : String(error)}\n`
        );
      }
      continue;
    }

    // No complete message yet
    break;
  }

  return {
    messages,
    remaining
  };
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.resume();

process.stdin.on('data', (chunk) => {
  buffer += chunk;

  const parsed = parseMessages(buffer);
  buffer = parsed.remaining;

  for (const message of parsed.messages) {
    handleRequest(message).catch((err) => {
      process.stderr.write(`[${SERVER_NAME}] unhandled error: ${err}\n`);
    });
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});
