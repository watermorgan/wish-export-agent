'use client';

import { useState, useTransition } from 'react';
import type { WorkspaceFeedbackSource } from '@/lib/assistant/types';
import { buildFeedbackDraft } from '@/lib/feedback/client';
import type { FeedbackCategory } from '@/lib/feedback/types';

type FeedbackCaptureProps = {
  context: WorkspaceFeedbackSource;
};

type FeedbackResponse = {
  id?: string;
  error?: string;
};

const CATEGORY_OPTIONS: Array<{ value: FeedbackCategory; label: string }> = [
  { value: 'translation_error', label: '错翻 / 表达不准' },
  { value: 'term_correction', label: '术语纠正' },
  { value: 'layout_issue', label: '版式问题' },
];

export function FeedbackCapture({ context }: FeedbackCaptureProps) {
  const [category, setCategory] = useState<FeedbackCategory>('translation_error');
  const [expectedTranslation, setExpectedTranslation] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasPrefilledContext =
    Boolean(context.sourceText?.trim()) || Boolean(context.currentTranslation?.trim());

  async function submit() {
    startTransition(async () => {
      try {
        const response = await fetch('/api/feedback', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(
            buildFeedbackDraft({
              ...context,
              category,
              expectedTranslation,
            })
          ),
        });

        const payload = (await response.json()) as FeedbackResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? '提交失败');
        }

        setExpectedTranslation('');
        setMessage(payload.id ? `已记录反馈：${payload.id}` : '反馈已记录。');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '提交失败');
      }
    });
  }

  return (
    <section className="answer-card" data-testid="feedback-capture">
      <h3>反馈这次翻译</h3>
      <p className="meta-note">
        把错译、术语建议或版式问题记下来，后续统一进入复盘和规则收敛。
      </p>

      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>反馈类型</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as FeedbackCategory)}
            disabled={isPending}
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {hasPrefilledContext ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <p className="meta-note">
              文件：{context.fileName}
              {context.pageNumber ? ` · 第 ${context.pageNumber} 页` : ''}
              {context.segmentId ? ` · ${context.segmentId}` : ''}
            </p>
            {context.sourceText ? <p>原文：{context.sourceText}</p> : null}
            {context.currentTranslation ? <p>当前译文：{context.currentTranslation}</p> : null}
          </div>
        ) : (
          <p className="meta-note">当前未拿到可预填的片段内容，本次反馈会绑定到当前文件。</p>
        )}

        <label style={{ display: 'grid', gap: 6 }}>
          <span>期望译法 / 问题描述</span>
          <textarea
            value={expectedTranslation}
            onChange={(event) => {
              setExpectedTranslation(event.target.value);
              if (message) {
                setMessage(null);
              }
            }}
            placeholder="例如：应改为“后腰部橡筋”，或描述具体版式问题。"
            rows={4}
            disabled={isPending}
          />
        </label>

        <div className="action-row">
          <button
            type="button"
            className="secondary-button"
            onClick={submit}
            disabled={isPending || expectedTranslation.trim().length === 0}
          >
            {isPending ? '提交中…' : '记录反馈'}
          </button>
          {message ? <p className="meta-note">{message}</p> : null}
        </div>
      </div>
    </section>
  );
}
