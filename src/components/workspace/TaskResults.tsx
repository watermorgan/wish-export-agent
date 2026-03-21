import React from 'react';
import type { AssistantReply, AssistantRole, TaskRecord, PendingConfirmation } from '@/lib/assistant/types';
import { PendingConfirmations } from './PendingConfirmations';

interface TaskResultsProps {
  reply: AssistantReply | null;
  currentTask: TaskRecord | null;
  role: AssistantRole;
  isPending: boolean;
  canEditConfirmations: boolean;
  onUpdateConfirmationStatus: (id: string, status: PendingConfirmation['status']) => void;
  onSubmitForReview: () => void;
  onReviewCurrentTask: (decision: 'approved' | 'returned') => void;
  onExportCurrentTask: () => void;
  getRoleLabel: (role: AssistantRole) => string;
}

export function TaskResults({
  reply,
  currentTask,
  role,
  isPending,
  canEditConfirmations,
  onUpdateConfirmationStatus,
  onSubmitForReview,
  onReviewCurrentTask,
  onExportCurrentTask,
  getRoleLabel
}: TaskResultsProps) {
  if (!reply) return null;

  return (
    <aside className="lg:col-span-5 space-y-10">
      <PendingConfirmations
        confirmations={reply.pendingConfirmations}
        canEdit={canEditConfirmations}
        onUpdateStatus={onUpdateConfirmationStatus}
        isPending={isPending}
        getRoleLabel={getRoleLabel}
      />
      
      {/* Result Card */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-50 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h3 className="font-bold text-slate-800">执行结果摘要</h3>
          <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${
            reply.status === 'approved' || reply.status === 'exported' ? 'bg-emerald-400/10 text-emerald-500' :
            reply.status === 'pending_supervisor_review' ? 'bg-indigo-400/10 text-indigo-500' :
            reply.status === 'returned' ? 'bg-orange-400/10 text-orange-500' :
            'bg-slate-100 text-slate-500'
          }`}>
            {reply.statusLabel}
          </span>
        </div>
        
        <p className="text-sm text-slate-600 leading-relaxed">
          {reply.summary}
        </p>

        {/* Action Buttons based on Role & Status */}
        <div className="flex flex-col gap-3 pt-2">
          {role === 'sales' && ['pending_user_confirmation', 'returned'].includes(reply.status) && (
            <button
              className="w-full py-3 bg-indigo-400 text-white rounded-xl font-bold hover:bg-indigo-500 transition-colors disabled:opacity-50"
              onClick={onSubmitForReview}
              disabled={isPending || reply.pendingConfirmations.some(c => c.status === 'required')}
            >
              提交主管审核
            </button>
          )}

          {role === 'supervisor' && reply.status === 'pending_supervisor_review' && (
            <div className="flex gap-3">
              <button
                className="flex-1 py-3 bg-emerald-400 text-white rounded-xl font-bold hover:bg-emerald-500 transition-colors disabled:opacity-50"
                onClick={() => onReviewCurrentTask('approved')}
                disabled={isPending}
              >
                审核通过
              </button>
              <button
                className="flex-1 py-3 bg-rose-400 text-white rounded-xl font-bold hover:bg-rose-500 transition-colors disabled:opacity-50"
                onClick={() => onReviewCurrentTask('returned')}
                disabled={isPending}
              >
                退回修改
              </button>
            </div>
          )}

          {reply.status === 'approved' && (
            <button
              className="w-full py-3 border-2 border-indigo-400 text-indigo-500 rounded-xl font-bold hover:bg-indigo-50 transition-colors disabled:opacity-50"
              onClick={onExportCurrentTask}
              disabled={isPending}
            >
              生成并导出产物
            </button>
          )}
        </div>
        
        {/* Exported Artifact */}
        {reply.status === 'exported' && reply.finalArtifact && (
          <div className="mt-4 p-4 bg-emerald-50 rounded-xl border border-emerald-100 relative group">
            <h4 className="text-emerald-600 font-bold mb-2 text-sm flex items-center gap-2">
              🎉 最终产物
            </h4>
            <div className="max-h-48 overflow-y-auto pr-2">
              <pre className="whitespace-pre-wrap text-[11px] text-slate-700 font-mono">
                {reply.finalArtifact}
              </pre>
            </div>
            <button
              className="absolute top-4 right-4 text-emerald-600 hover:text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-3 py-1 rounded text-xs font-bold transition-colors opacity-0 group-hover:opacity-100"
              onClick={() => navigator.clipboard.writeText(reply.finalArtifact!)}
            >
              复制
            </button>
          </div>
        )}
      </div>
      
      {/* Aesthetic Banner */}
      <div className="relative overflow-hidden h-44 rounded-3xl bg-gradient-to-br from-indigo-400 to-indigo-600 p-8 flex items-end shadow-xl shadow-indigo-400/20">
        <div className="relative z-10">
          <p className="text-white font-black text-2xl leading-tight">Create with <br/> Confidence.</p>
          <p className="text-white/60 text-xs font-bold mt-2 uppercase tracking-widest">Workspace v1.0 ✨</p>
        </div>
        <span className="absolute -right-6 -top-6 text-9xl opacity-10 rotate-12">🚀</span>
      </div>
    </aside>
  );
}