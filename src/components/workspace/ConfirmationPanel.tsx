"use client";

import React from "react";
import type {
  AssistantRole,
  PendingConfirmation,
} from "@/lib/assistant/types";

interface ConfirmationPanelProps {
  pendingConfirmations: PendingConfirmation[];
  updateConfirmationStatus: (id: string, status: PendingConfirmation["status"]) => void;
  isPending: boolean;
  canEdit: boolean;
}

export function ConfirmationPanel({
  pendingConfirmations,
  updateConfirmationStatus,
  isPending,
  canEdit,
}: ConfirmationPanelProps) {
  function getConfirmationStatusLabel(status: PendingConfirmation["status"]) {
    switch (status) {
      case "required": return "必须确认";
      case "recommended": return "建议确认";
      case "confirmed": return "已确认";
      case "returned": return "已退回";
    }
  }

  function getRoleLabel(role: AssistantRole) {
    return role === "sales" ? "业务员" : "主管";
  }

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-float border border-slate-50">
      <div className="bg-indigo-50/50 px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">💡</span>
          <h3 className="font-bold text-slate-800">待您确认 (Pending)</h3>
        </div>
        <span className="bg-secondary text-white text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-widest">
          Action Needed
        </span>
      </div>
      <div className="p-8 space-y-6">
        {pendingConfirmations.length > 0 ? (
          pendingConfirmations.map((item) => (
            <div
              key={item.id}
              className={`bg-white p-5 rounded-2xl border shadow-soft space-y-4 transition-all ${
                item.status === "confirmed" ? "border-success-mint/20 bg-success-mint/5" : "border-indigo-50"
              }`}
            >
              <div className="flex items-start gap-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  item.status === "required" ? "bg-risk-coral/10 text-risk-coral" : "bg-primary/10 text-primary"
                }`}>
                  <span className="material-symbols-outlined text-lg">
                    {item.status === "required" ? "warning" : "info"}
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-slate-700 font-medium leading-relaxed">
                    <span className={`font-black ${item.status === "required" ? "text-risk-coral" : "text-primary"}`}>
                      [{item.label}]
                    </span>{" "}
                    {item.reason}
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase">
                    责任人：{getRoleLabel(item.owner)} · 状态：{getConfirmationStatusLabel(item.status)}
                  </p>
                </div>
              </div>
              {canEdit && (
                <div className="flex justify-end gap-2">
                  <button
                    disabled={isPending || item.status === "returned"}
                    onClick={() => updateConfirmationStatus(item.id, "returned")}
                    className="bg-slate-50 text-slate-400 px-4 py-2 rounded-xl text-xs font-black hover:bg-risk-coral/10 hover:text-risk-coral transition-all disabled:opacity-50"
                  >
                    退回
                  </button>
                  <button
                    disabled={isPending || item.status === "confirmed"}
                    onClick={() => updateConfirmationStatus(item.id, "confirmed")}
                    className="bg-primary/5 text-primary px-4 py-2 rounded-xl text-xs font-black hover:bg-primary hover:text-white transition-all disabled:opacity-50"
                  >
                    确认
                  </button>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="text-center py-10">
            <p className="text-slate-400 text-sm font-medium">暂时没有待确认项 ✨</p>
          </div>
        )}
      </div>
    </div>
  );
}
