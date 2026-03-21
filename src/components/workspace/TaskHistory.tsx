"use client";

import React from "react";
import type {
  AssistantRole,
  TaskRecord,
} from "@/lib/assistant/types";

interface TaskHistoryProps {
  recentTasks: TaskRecord[];
  pendingReviewTasks: TaskRecord[];
  role: AssistantRole;
  openTask: (id: string) => void;
  isPending: boolean;
}

export function TaskHistory({
  recentTasks,
  pendingReviewTasks,
  role,
  openTask,
  isPending,
}: TaskHistoryProps) {
  const visibleRecentTasks =
    role === "supervisor"
      ? recentTasks
      : recentTasks.filter((task) => task.role === role);

  return (
    <div className="space-y-10">
      {/* Review Queue (only for supervisors or showing count) */}
      <div>
        <div className="flex items-center gap-3 px-2 mb-6">
          <span className="text-xl">📝</span>
          <h3 className="font-bold text-slate-800">
            审核队列 (Audit Queue)
          </h3>
        </div>
        <div className="bg-white rounded-2xl shadow-soft border border-slate-50 divide-y divide-slate-50 overflow-hidden">
          {pendingReviewTasks.length > 0 ? (
            pendingReviewTasks.slice(0, 5).map((task) => (
              <div
                key={`review-${task.id}`}
                className="p-6 hover:bg-indigo-50/20 transition-all group flex items-center justify-between"
              >
                <div className="space-y-1">
                  <p className="text-sm font-black text-slate-800 group-hover:text-primary transition-colors truncate">
                    {task.title}
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    {task.taskTypeLabel} · 待确认 {task.pendingConfirmationCount} 项
                  </p>
                </div>
                <button
                  onClick={() => openTask(task.id)}
                  disabled={isPending}
                  className="bg-secondary/10 text-secondary px-4 py-2 rounded-xl text-xs font-black hover:bg-secondary hover:text-white transition-all disabled:opacity-50"
                >
                  审核
                </button>
              </div>
            ))
          ) : (
            <div className="p-10 text-center text-slate-400 text-sm">
              {role === "supervisor"
                ? "当前没有待审核任务。"
                : "切换到主管角色后可查看待审核任务。"}
            </div>
          )}
        </div>
      </div>

      {/* Recent Tasks */}
      <div>
        <div className="flex items-center gap-3 px-2 mb-6">
          <span className="text-xl">📚</span>
          <h3 className="font-bold text-slate-800">
            最近任务 (Recent Tasks)
          </h3>
        </div>
        <div className="bg-white rounded-2xl shadow-soft border border-slate-50 divide-y divide-slate-50 overflow-hidden">
          {visibleRecentTasks.length > 0 ? (
            visibleRecentTasks.slice(0, 10).map((task) => (
              <div
                key={task.id}
                className="p-6 hover:bg-indigo-50/20 transition-all group flex items-center justify-between"
              >
                <div className="space-y-1">
                  <p className="text-sm font-black text-slate-800 group-hover:text-primary transition-colors truncate">
                    {task.title}
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    {task.taskTypeLabel} · {task.status} · 待确认 {task.pendingConfirmationCount} 项
                  </p>
                </div>
                <button
                  onClick={() => openTask(task.id)}
                  disabled={isPending}
                  className="bg-primary/5 text-primary px-4 py-2 rounded-xl text-xs font-black hover:bg-primary hover:text-white transition-all disabled:opacity-50"
                >
                  打开
                </button>
              </div>
            ))
          ) : (
            <div className="p-10 text-center text-slate-400 text-sm">
              执行一次任务后，这里会保留最近任务。
            </div>
          )}
        </div>
        <button
          className="w-full mt-6 py-4 border-2 border-dashed border-slate-100 rounded-2xl text-slate-400 text-sm font-black hover:bg-white hover:border-primary/20 hover:text-primary transition-all"
        >
          View All History 📖
        </button>
      </div>
    </div>
  );
}
