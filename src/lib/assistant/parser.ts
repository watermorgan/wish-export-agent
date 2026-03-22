import type { ArtifactField, ArtifactSection, PendingConfirmation } from './types';

export interface ParsedStepResult {
  sections: ArtifactSection[];
  pendingConfirmations: PendingConfirmation[];
}

/**
 * Extracts Markdown tables from text and converts them into ArtifactField[].
 * Each table will be represented as an ArtifactField with structuredData or richTextHtml.
 */
export function parseMarkdownTables(text: string): ArtifactField[] {
  const tables: ArtifactField[] = [];
  const tableRegex = /((?:\|.*\|(?:\n|\r\n?)){2,})/g;
  let match;

  while ((match = tableRegex.exec(text)) !== null) {
    const tableText = match[0].trim();
    const lines = tableText.split(/\r?\n/);
    if (lines.length < 3) continue; // Need header, separator, and at least one row

    const headers = lines[0]
      .split('|')
      .map((h) => h.trim())
      .filter((h) => h !== '');
    
    // Check if second line is a separator line
    if (!lines[1].includes('---') && !lines[1].includes(':---') && !lines[1].includes('---:')) {
      continue;
    }

    const rows = lines.slice(2).map((line) =>
      line
        .split('|')
        .map((c) => c.trim())
        .filter((c, i, arr) => (i === 0 || i === arr.length - 1 ? c !== '' : true))
    );

    tables.push({
      label: headers[0] || '表格数据',
      value: `包含 ${rows.length} 行数据的表格`,
      richTextHtml: `<table class="min-w-full divide-y divide-gray-200 border">
        <thead>
          <tr>
            ${headers.map(h => `<th class="px-4 py-2 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          ${rows.map(row => `<tr>
            ${row.map(cell => `<td class="px-4 py-2 whitespace-nowrap text-sm text-gray-900 border">${cell}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>`,
      structuredData: {
        headers,
        rows
      }
    });
  }

  return tables;
}

/**
 * Extracts bullet points and numbered lists into ArtifactField[].
 */
export function parseMarkdownLists(text: string): ArtifactField[] {
  const fields: ArtifactField[] = [];
  // Match groups of list items
  const listRegex = /((?:(?:^|\n)(?:[*-]|\d+\.)\s+.+)+)/g;
  let match;

  while ((match = listRegex.exec(text)) !== null) {
    const listText = match[0].trim();
    const items = listText.split(/\r?\n/).map(line => line.replace(/^[*-]|\d+\.\s+/, '').trim());
    
    if (items.length > 0) {
      fields.push({
        label: '列表项',
        value: items.join('; '),
        richTextHtml: `<ul class="list-disc pl-5 space-y-1">
          ${items.map(item => `<li>${item}</li>`).join('')}
        </ul>`,
        structuredData: { items }
      });
    }
  }

  return fields;
}

/**
 * Finds patterns like [PENDING_CONFIRMATION] {Label}: {Reason} or just [PENDING_CONFIRMATION].
 */
export function extractRiskMarkers(text: string): PendingConfirmation[] {
  const confirmations: PendingConfirmation[] = [];
  const markerRegex = /\[PENDING_CONFIRMATION\]\s*(.*?)(?:\n|$)/g;
  let match;

  while ((match = markerRegex.exec(text)) !== null) {
    const content = match[1].trim();
    let label = '待确认事项';
    let reason = '';

    if (content.includes(':')) {
      const parts = content.split(':');
      label = parts[0].trim();
      reason = parts.slice(1).join(':').trim();
    } else if (content) {
      label = content;
      reason = '此项内容需要人工核实。';
    } else {
      // If just [PENDING_CONFIRMATION], try to find the surrounding context
      // This is a simple heuristic: take the line before or after if available
      const lines = text.split(/\r?\n/);
      const matchIndex = text.substring(0, match.index).split(/\r?\n/).length - 1;
      reason = lines[matchIndex].replace('[PENDING_CONFIRMATION]', '').trim() || '需要人工确认。';
    }

    confirmations.push({
      id: `pc-${Math.random().toString(36).substring(2, 9)}`,
      label,
      reason,
      owner: 'sales', // Default owner
      status: 'required'
    });
  }

  return confirmations;
}

/**
 * Parses the full LLM output text into a structured result.
 */
export function parseFullResult(text: string, skillId: string): ParsedStepResult {
  const tableFields = parseMarkdownTables(text);
  const listFields = parseMarkdownLists(text);
  const pendingConfirmations = extractRiskMarkers(text);

  const sections: ArtifactSection[] = [];

  if (tableFields.length > 0) {
    sections.push({
      title: `${skillId} - 表格数据`,
      kind: 'table',
      summary: `从执行结果中自动提取了 ${tableFields.length} 个表格。`,
      fields: tableFields
    });
  }

  if (listFields.length > 0) {
    sections.push({
      title: `${skillId} - 列表项`,
      kind: 'list',
      summary: `从执行结果中自动提取了 ${listFields.length} 组列表。`,
      fields: listFields
    });
  }

  // If no structured data found, at least provide the raw text
  if (sections.length === 0) {
    sections.push({
      title: `${skillId} - 执行结果`,
      kind: 'text',
      summary: '原始执行输出。',
      fields: [
        {
          label: 'Raw Output',
          value: text.slice(0, 100) + '...',
          richTextHtml: `<div class="prose max-w-none">${text.replace(/\n/g, '<br/>')}</div>`
        }
      ]
    });
  }

  return {
    sections,
    pendingConfirmations
  };
}
