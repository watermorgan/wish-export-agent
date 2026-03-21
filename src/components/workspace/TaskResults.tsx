"use client";

import React from "react";
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

export function TaskResults({
  reply,
  error,
  isPending,
  role,
  submitForReview,
  reviewCurrentTask,
  exportCurrentTask,
}: TaskResultsProps) {
  if (!reply && !error) {
    return (
      <div className="bg-white p-12 rounded-2xl shadow-soft border border-slate-50 text-center">
        <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-6 text-slate-300">
          <span className="material-symbols-outlined text-3xl">auto_fix_high</span>
        </div>
        <h3 className="text-lg font-bold text-slate-800 mb-2">准备就绪</h3>
        <p className="text-slate-400 max-w-sm mx-auto">
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
        <div className="bg-risk-coral/10 border-2 border-risk-coral/20 p-6 rounded-2xl text-risk-coral">
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
          <div className="bg-white p-8 rounded-2xl shadow-soft border border-slate-50">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-xl font-bold text-slate-800">任务摘要</h2>
                <p className="text-sm text-slate-400 mt-1">
                  任务ID：{currentTask?.id} · 状态：{reply.statusLabel}
                </p>
              </div>
              <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold">
                {reply.intentLabel}
              </span>
            </div>
            <p className="text-slate-600 leading-relaxed bg-slate-50/50 p-6 rounded-xl border border-slate-50">
              {reply.summary}
            </p>
            {currentTask?.reviewedBy && (
              <p className="text-xs text-slate-400 mt-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">verified</span>
                最近审核人：{getRoleLabel(currentTask.reviewedBy)}
                {currentTask.reviewComment ? ` · 审核意见：${currentTask.reviewComment}` : ""}
              </p>
            )}
          </div>

          {/* Execution & Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white p-8 rounded-2xl shadow-soft border border-slate-50">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">account_tree</span>
                执行链
              </h3>
              <ul className="space-y-4">
                {reply.executionPlan.map((step) => (
                  <li key={step.id} className="flex gap-3">
                    <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${step.status === "completed" ? "bg-success-mint" : "bg-slate-200"}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-700">{step.name}</p>
                      <p className="text-xs text-slate-400 truncate">{step.summary}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-soft border border-slate-50">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary">bolt</span>
                建议动作
              </h3>
              <ul className="space-y-3">
                {reply.nextActions.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-slate-600">
                    <span className="text-secondary font-bold">·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Artifacts */}
          <div className="bg-white p-8 rounded-2xl shadow-soft border border-slate-50">
            <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">inventory_2</span>
              结构化产物
            </h3>
            <div className="space-y-8">
              {reply.artifacts.map((section) => (
                <div key={section.title} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <h4 className="font-bold text-slate-700">{section.title}</h4>
                    <div className="h-px bg-slate-100 flex-1" />
                  </div>
                  <p className="text-sm text-slate-400">{section.summary}</p>
                  <div className="grid grid-cols-1 gap-4">
                    {section.fields.map((field) => (
                      <div key={field.label} className="bg-slate-50/50 p-4 rounded-xl border border-slate-50">
                        <p className="text-xs font-bold text-slate-400 uppercase mb-2">{field.label}</p>
                        {field.richTextHtml ? (
                          <div
                            className="text-sm text-slate-700 prose prose-sm max-w-none"
                            dangerouslySetInnerHTML={{ __html: field.richTextHtml }}
                          />
                        ) : (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-700">{field.value}</span>
                            {field.confirmationStatus && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                field.confirmationStatus === "required" ? "bg-risk-coral/10 text-risk-coral" : "bg-primary/10 text-primary"
                              }`}>
                                {field.confirmationStatus === "required" ? "待确认" : "建议确认"}
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
            <div className="bg-success-mint/5 border-2 border-success-mint/20 p-8 rounded-2xl">
              <h3 className="font-bold text-success-mint flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined">verified</span>
                🎉 最终产物已生成
              </h3>
              <pre className="whitespace-pre-wrap text-sm text-slate-700 bg-white p-6 rounded-xl border border-success-mint/10 shadow-soft font-mono">
                {reply.finalArtifact}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(reply.finalArtifact!)}
                className="mt-4 px-6 py-2 bg-success-mint text-white rounded-lg text-sm font-bold shadow-lg shadow-success-mint/20 hover:scale-[1.02] transition-all"
              >
                复制到剪贴板
              </button>
            </div>
          )}

          {/* History & Audit */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white p-8 rounded-2xl shadow-soft border border-slate-50">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-slate-400">history</span>
                审核历史
              </h3>
              <div className="space-y-4">
                {reviewHistory.length > 0 ? (
                  reviewHistory.map((item, index) => (
                    <div key={index} className="text-sm border-l-2 border-slate-100 pl-4 py-1">
                      <div className="flex justify-between font-bold text-slate-700 mb-1">
                        <span>{getReviewDecisionLabel(item.decision)}</span>
                        <span className="text-xs text-slate-400 font-normal">
                          {dateTimeFormatter.format(new Date(item.createdAt))}
                        </span>
                      </div>
                      <p className="text-slate-500">
                        {getRoleLabel(item.reviewer)} {item.comment ? `· ${item.comment}` : ""}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400 italic">暂无审核记录</p>
                )}
              </div>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-soft border border-slate-50">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-slate-400">rule</span>
                审计摘要
              </h3>
              <ul className="space-y-3">
                {reply.auditTrail.map((item, i) => (
                  <li key={i} className="text-sm flex justify-between">
                    <span className="font-bold text-slate-600">{item.label}</span>
                    <span className="text-slate-400">{item.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Task Actions */}
          <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-50 flex flex-wrap gap-4 items-center justify-center">
            <button
              disabled={isPending || !currentTask || role !== "sales" || !["pending_user_confirmation", "returned"].includes(reply.status)}
              onClick={submitForReview}
              className="px-6 py-3 bg-primary/10 text-primary rounded-xl font-bold text-sm hover:bg-primary hover:text-white transition-all disabled:opacity-50"
            >
              提交主管审核
            </button>
            <button
              disabled={isPending || !currentTask || role !== "supervisor" || reply.status !== "pending_supervisor_review"}
              onClick={() => reviewCurrentTask("approved")}
              className="px-6 py-3 bg-success-mint/10 text-success-mint rounded-xl font-bold text-sm hover:bg-success-mint hover:text-white transition-all disabled:opacity-50"
            >
              主管通过
            </button>
            <button
              disabled={isPending || !currentTask || role !== "supervisor" || reply.status !== "pending_supervisor_review"}
              onClick={() => reviewCurrentTask("returned")}
              className="px-6 py-3 bg-risk-coral/10 text-risk-coral rounded-xl font-bold text-sm hover:bg-risk-coral hover:text-white transition-all disabled:opacity-50"
            >
              主管退回
            </button>
            <button
              disabled={isPending || !currentTask || reply.status !== "approved"}
              onClick={exportCurrentTask}
              className="px-6 py-3 bg-secondary/10 text-secondary rounded-xl font-bold text-sm hover:bg-secondary hover:text-white transition-all disabled:opacity-50"
            >
              导出任务
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
