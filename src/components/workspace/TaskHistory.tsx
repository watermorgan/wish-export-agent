import React from 'react';
import type { TaskRecord, AssistantRole } from '@/lib/assistant/types';
import { DocumentMagnifyingGlassIcon } from '@heroicons/react/24/outline';

interface TaskHistoryProps {
  tasks: TaskRecord[];
  role: AssistantRole;
}

export function TaskHistory({ tasks, role }: TaskHistoryProps) {
  return (
    <div>
      <div className="flex items-center gap-3 px-2 mb-6">
        <span className="text-xl">📝</span>
        <h3 className="font-bold text-slate-800">最近任务 (Recent Tasks)</h3>
      </div>
      
      {tasks.length === 0 ? (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-50 text-center text-slate-400">
          执行一次任务后，这里会保留最近任务。
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-50 divide-y divide-slate-50">
          {tasks.slice(0, 5).map((task) => {
            const isApproved = task.status === 'approved' || task.status === 'exported';
            const isDraft = task.status === 'draft';
            
            return (
              <div key={task.id} className="p-6 hover:bg-indigo-50/20 transition-all group first:rounded-t-2xl last:rounded-b-2xl">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-black text-slate-800 group-hover:text-indigo-400 transition-colors truncate max-w-[200px]">
                      {task.title}
                    </p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                      {new Date(task.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                    isApproved ? 'bg-emerald-400/10 text-emerald-400' :
                    isDraft ? 'bg-slate-100 text-slate-400' : 'bg-rose-300/10 text-rose-400'
                  }`}>
                    {task.status === 'pending_supervisor_review' ? 'Pending Review' : 
                     task.status === 'pending_user_confirmation' ? 'Pending Confirm' :
                     task.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      <button className="w-full mt-6 py-4 border-2 border-dashed border-slate-100 rounded-2xl text-slate-400 text-sm font-black hover:bg-white hover:border-indigo-400/20 hover:text-indigo-400 transition-all flex items-center justify-center gap-2">
        <DocumentMagnifyingGlassIcon className="w-5 h-5" />
        View All History
      </button>
    </div>
  );
}