import React from 'react';
import { LightBulbIcon, ExclamationTriangleIcon, CalendarIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import type { PendingConfirmation, AssistantRole } from '@/lib/assistant/types';

interface PendingConfirmationsProps {
  confirmations: PendingConfirmation[];
  canEdit: boolean;
  onUpdateStatus: (id: string, status: PendingConfirmation['status']) => void;
  isPending: boolean;
  getRoleLabel: (role: AssistantRole) => string;
}

export function PendingConfirmations({
  confirmations,
  canEdit,
  onUpdateStatus,
  isPending,
  getRoleLabel
}: PendingConfirmationsProps) {
  if (confirmations.length === 0) {
    return (
      <div className="bg-white rounded-2xl overflow-hidden shadow-[0_10px_30px_-5px_rgba(129,140,248,0.15)] border border-slate-50">
        <div className="bg-indigo-50/50 px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LightBulbIcon className="w-6 h-6 text-indigo-400" />
            <h3 className="font-bold text-slate-800">待您确认 (Pending)</h3>
          </div>
          <span className="bg-slate-200 text-slate-500 text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-widest">All Clear</span>
        </div>
        <div className="p-8 text-center text-slate-400">
          <p className="text-sm">暂无高风险项需要确认。</p>
        </div>
      </div>
    );
  }

  const getConfirmationIcon = (label: string) => {
    if (label.includes('交期') || label.includes('Date')) return <CalendarIcon className="w-5 h-5" />;
    return <ExclamationTriangleIcon className="w-5 h-5" />;
  };

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-[0_10px_30px_-5px_rgba(129,140,248,0.15)] border border-slate-50">
      <div className="bg-indigo-50/50 px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">💡</span>
          <h3 className="font-bold text-slate-800">待您确认 (Pending)</h3>
        </div>
        <span className="bg-rose-300 text-white text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-widest">Action Needed</span>
      </div>
      <div className="p-8 space-y-6">
        {confirmations.map((item) => {
          const isConfirmed = item.status === 'confirmed';
          
          return (
            <div key={item.id} className={`p-5 rounded-2xl border shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)] space-y-4 transition-all ${
              isConfirmed ? 'bg-emerald-50/50 border-emerald-100 opacity-70' : 'bg-white border-indigo-50'
            }`}>
              <div className="flex items-start gap-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  isConfirmed ? 'bg-emerald-100 text-emerald-500' : 'bg-orange-400/10 text-orange-400'
                }`}>
                  {isConfirmed ? <CheckCircleIcon className="w-5 h-5" /> : getConfirmationIcon(item.label)}
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-slate-700 font-medium leading-relaxed">
                    <span className={`font-black ${isConfirmed ? 'text-emerald-500' : 'text-orange-400'}`}>
                      [{item.label}]
                    </span>{' '}
                    {item.reason}
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    责任人: {getRoleLabel(item.owner)} · 状态: {item.status === 'required' ? '必须确认' : item.status === 'confirmed' ? '已确认' : item.status === 'returned' ? '已退回' : '建议确认'}
                  </p>
                </div>
              </div>
              
              {canEdit && (
                <div className="flex justify-end gap-2">
                  {!isConfirmed && (
                    <button
                      className="bg-indigo-400/5 text-indigo-400 px-5 py-2 rounded-xl text-xs font-black hover:bg-indigo-400 hover:text-white transition-all disabled:opacity-50"
                      onClick={() => onUpdateStatus(item.id, 'confirmed')}
                      disabled={isPending}
                    >
                      标记已确认
                    </button>
                  )}
                  {item.status !== 'returned' && !isConfirmed && (
                    <button
                      className="bg-rose-300/10 text-rose-400 px-5 py-2 rounded-xl text-xs font-black hover:bg-rose-300 hover:text-white transition-all disabled:opacity-50"
                      onClick={() => onUpdateStatus(item.id, 'returned')}
                      disabled={isPending}
                    >
                      标记退回
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}