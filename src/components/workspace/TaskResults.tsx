"use client";

import React, { useState, useEffect } from "react";
import type {
  AssistantReply,
  AssistantRole,
  ReviewEntry,
} from "@/lib/assistant/types";

interface TaskResultsProps {
  reply: AssistantReply | null;
  error: string | null;
  isPending: boolean;
  role: AssistantRole;
  submitForReview: () => void;
  reviewCurrentTask: (decision: "approved" | "returned") => void;
  exportCurrentTask: () => void;
}

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(content);
        setCopied(true);
      }}
      className={`mt-4 px-6 py-2 rounded-lg text-sm font-bold shadow-lg transition-all ${
        copied
          ? "bg-primary text-white scale-[0.98]"
          : "bg-success-mint text-white hover:scale-[1.02] shadow-success-mint/20"
      }`}
    >
      {copied ? "已复制！" : "复制到剪贴板"}
    </button>
  );
}

export function TaskResults({
  reply,
  error,
  isPending,
  role,
  submitForReview,
  reviewCurrentTask,
  exportCurrentTask,
}: TaskResultsProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!reply && !error) {
    return (
      <div className="bg-surface p-12 rounded-2xl shadow-soft border border-outline text-center">
        <div className="w-16 h-16 bg-ivory rounded-2xl flex items-center justify-center mx-auto mb-6 text-muted/40">
          <span className="material-symbols-outlined text-3xl">auto_fix_high</span>
        </div>
        <h3 className="text-lg font-bold text-on-surface mb-2">准备就绪</h3>
        <p className="text-muted max-w-sm mx-auto">
          在左侧填写任务要求并上传文件，点击“开始魔法处理”即可在此查看结果。
        </p>
      </div>
    );
  }

  const currentTask = reply?.task;
  const reviewHistory = reply?.reviewHistory ?? [];

  function getRoleLabel(role: AssistantRole) {
    return role === "sales" ? "业务员" : "主管";
  }

  function getReviewDecisionLabel(decision: ReviewEntry["decision"]) {
    return decision === "approved" ? "审核通过" : "退回处理";
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-risk-soft border-2 border-risk-coral/20 p-6 rounded-2xl text-risk-coral">
          <h3 className="font-bold flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined">error</span>
            请求失败
          </h3>
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {reply && (
        <div className="space-y-8">
          {/* Summary Card */}
          <div className="bg-surface p-8 rounded-2xl shadow-soft border border-outline">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-xl font-bold text-on-surface">任务摘要</h2>
                <p className="text-[10px] text-muted font-bold uppercase tracking-widest mt-1">
                  ID: {currentTask?.id} · {reply.statusLabel}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="bg-primary-soft text-primary px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm">
                  {reply.intentLabel}
                </span>
                {reply.metadata?.needsHumanReview && (
                  <span className="bg-secondary-soft text-secondary px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1 shadow-sm">
                    <span className="material-symbols-outlined !text-xs">auto_awesome</span>
                    需要人工审核
                  </span>
                )}
              </div>
            </div>
            <div className="bg-surface p-6 rounded-2xl border border-outline/30 shadow-float leading-relaxed text-on-surface">
              {reply.summary}
            </div>
            {currentTask?.reviewedBy && (
              <p className="text-xs text-muted mt-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">verified</span>
                最近审核人：{getRoleLabel(currentTask.reviewedBy)}
                {currentTask.reviewComment ? ` · 审核意见：${currentTask.reviewComment}` : ""}
              </p>
            )}
          </div>

          {/* Execution & Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-surface p-8 rounded-2xl shadow-soft border border-outline">
              <h3 className="font-bold text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">account_tree</span>
                执行链
              </h3>
              <ul className="space-y-4">
                {reply.executionPlan.map((step) => (
                  <li key={step.id} className="flex gap-4 p-3 rounded-xl hover:bg-ivory/50 transition-colors">
                    <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 shadow-sm ${step.status === "completed" ? "bg-success-mint ring-4 ring-success-mint/10" : "bg-outline-strong ring-4 ring-outline/5"}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-black text-on-surface">{step.name}</p>
                      <p className="text-xs text-muted truncate mt-0.5">{step.summary}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-surface p-8 rounded-2xl shadow-soft border border-outline">
              <h3 className="font-bold text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary">bolt</span>
                建议动作
              </h3>
              <ul className="space-y-3">
                {reply.nextActions.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-on-surface">
                    <span className="text-secondary font-bold">·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Artifacts */}
          <div className="bg-surface p-8 rounded-2xl shadow-soft border border-outline">
            <h3 className="font-bold text-on-surface mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">inventory_2</span>
              结构化产物
            </h3>
            <div className="space-y-8">
              {reply.artifacts.map((section) => (
                <div key={section.title} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <h4 className="font-bold text-on-surface">{section.title}</h4>
                    <div className="h-px bg-outline flex-1" />
                  </div>
                  <p className="text-sm text-muted">{section.summary}</p>
                  <div className="grid grid-cols-1 gap-4">
                    {section.fields.map((field) => (
                      <div key={field.label} className="bg-surface p-5 rounded-2xl border border-outline/30 shadow-soft hover-float transition-all">
                        <p className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">{field.label}</p>
                        {field.richTextHtml ? (
                          <div
                            className="text-sm text-on-surface prose prose-sm max-w-none"
                            dangerouslySetInnerHTML={{ __html: field.richTextHtml }}
                          />
                        ) : (
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-on-surface">{field.value}</span>
                            {field.confirmationStatus && (
                              <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-tight ${
                                field.confirmationStatus === "required" ? "bg-risk-soft text-risk-coral" : "bg-primary-soft text-primary"
                              }`}>
                                {field.confirmationStatus === "required" ? "必须确认" : "建议确认"}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Final Export */}
          {reply.status === "exported" && reply.finalArtifact && (
            <div className="bg-success-soft border-2 border-success-mint/20 p-8 rounded-2xl">
              <h3 className="font-bold text-success-mint flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined">verified</span>
                🎉 最终产物已生成
              </h3>
              <pre className="whitespace-pre-wrap text-sm text-on-surface bg-surface p-6 rounded-xl border border-success-mint/10 shadow-soft font-mono">
                {reply.finalArtifact}
              </pre>
              <CopyButton content={reply.finalArtifact} />
            </div>
          )}

          {/* History & Audit */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-surface p-8 rounded-2xl shadow-soft border border-outline">
              <h3 className="font-bold text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-muted">history</span>
                审核历史
              </h3>
              <div className="space-y-4">
                {reviewHistory.length > 0 ? (
                  reviewHistory.map((item, index) => (
                    <div key={index} className="text-sm border-l-2 border-outline pl-4 py-1">
                      <div className="flex justify-between font-bold text-on-surface mb-1">
                        <span>{getReviewDecisionLabel(item.decision)}</span>
                        <span className="text-xs text-muted font-normal">
                          {mounted ? dateTimeFormatter.format(new Date(item.createdAt)) : "..."}
                        </span>
                      </div>
                      <p className="text-muted">
                        {getRoleLabel(item.reviewer)} {item.comment ? `· ${item.comment}` : ""}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted italic">暂无审核记录</p>
                )}
              </div>
            </div>

            <div className="bg-surface p-8 rounded-2xl shadow-soft border border-outline">
              <h3 className="font-bold text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-muted">rule</span>
                审计摘要
              </h3>
              <ul className="space-y-3">
                {reply.auditTrail.map((item, i) => (
                  <li key={i} className="text-sm flex justify-between">
                    <span className="font-bold text-muted">{item.label}</span>
                    <span className="text-muted">{item.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Task Actions */}
          <div className="bg-surface p-6 rounded-2xl shadow-soft border border-outline flex flex-wrap gap-4 items-center justify-center">
            <button
              disabled={isPending || !currentTask || role !== "sales" || !["pending_user_confirmation", "returned"].includes(reply.status)}
              onClick={submitForReview}
              className="px-6 py-3 bg-primary text-white rounded-xl font-bold text-sm hover:scale-[1.02] shadow-lg shadow-soft transition-all disabled:opacity-50 disabled:bg-primary-soft disabled:text-primary disabled:shadow-none disabled:scale-100"
            >
              提交主管审核
            </button>
            <button
              disabled={isPending || !currentTask || role !== "supervisor" || reply.status !== "pending_supervisor_review"}
              onClick={() => reviewCurrentTask("approved")}
              className="px-6 py-3 bg-success-mint text-white rounded-xl font-bold text-sm hover:scale-[1.02] shadow-lg shadow-success-mint/20 transition-all disabled:opacity-50 disabled:bg-success-soft disabled:text-success-mint disabled:shadow-none disabled:scale-100"
            >
              主管通过
            </button>
            <button
              disabled={isPending || !currentTask || role !== "supervisor" || reply.status !== "pending_supervisor_review"}
              onClick={() => reviewCurrentTask("returned")}
              className="px-6 py-3 bg-risk-coral text-white rounded-xl font-bold text-sm hover:scale-[1.02] shadow-lg shadow-risk-coral/20 transition-all disabled:opacity-50 disabled:bg-risk-soft disabled:text-risk-coral disabled:shadow-none disabled:scale-100"
            >
              主管退回
            </button>
            <button
              disabled={isPending || !currentTask || reply.status !== "approved"}
              onClick={exportCurrentTask}
              className="px-6 py-3 bg-secondary text-white rounded-xl font-bold text-sm hover:scale-[1.02] shadow-lg shadow-soft transition-all disabled:opacity-50 disabled:bg-secondary-soft disabled:text-secondary disabled:shadow-none disabled:scale-100"
            >
              导出任务
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
