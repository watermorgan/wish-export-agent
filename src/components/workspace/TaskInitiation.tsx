import React from 'react';
import { ArchiveBoxIcon, LanguageIcon, EnvelopeIcon, ArrowRightIcon, CloudArrowUpIcon, DocumentIcon } from '@heroicons/react/24/outline';
import { SparklesIcon, CheckCircleIcon } from '@heroicons/react/24/solid';
import type { TaskType } from '@/lib/assistant/types';

interface TaskInitiationProps {
  taskType: TaskType;
  onTaskTypeChange: (type: TaskType) => void;
  question: string;
  onQuestionChange: (q: string) => void;
  files: File[];
  onFileChange: (files: FileList | null) => void;
  onSubmit: () => void;
  isPending: boolean;
}

export function TaskInitiation({
  taskType,
  onTaskTypeChange,
  question,
  onQuestionChange,
  files,
  onFileChange,
  onSubmit,
  isPending
}: TaskInitiationProps) {
  const getTaskIcon = (type: TaskType) => {
    switch (type) {
      case 'bom': return <ArchiveBoxIcon className="w-8 h-8" />;
      case 'feedback': return <LanguageIcon className="w-8 h-8" />;
      case 'reply': return <EnvelopeIcon className="w-8 h-8" />;
      default: return <ArchiveBoxIcon className="w-8 h-8" />;
    }
  };

  const getTaskLabel = (type: TaskType) => {
    switch (type) {
      case 'bom': return '📦 BOM 整理';
      case 'feedback': return '🌐 意见翻译与归并';
      case 'reply': return '💌 客户回复草拟';
      default: return '';
    }
  };
  
  const getTaskDesc = (type: TaskType) => {
    switch (type) {
      case 'bom': return 'Smart Sorting';
      case 'feedback': return 'Auto Translation';
      case 'reply': return 'Smart Draft';
      default: return '';
    }
  };

  const taskOptions: TaskType[] = ['bom', 'feedback', 'reply'];

  return (
    <section className="lg:col-span-7 space-y-10">
      {/* Task Selection */}
      <div>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-slate-800">选择任务类型</h2>
          <a className="text-indigo-400 text-sm font-bold flex items-center gap-1.5 hover:underline decoration-2" href="#">
            Browse Template Library ✨
          </a>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {taskOptions.map((type) => {
            const isActive = taskType === type;
            return (
              <div
                key={type}
                onClick={() => onTaskTypeChange(type)}
                className={`cursor-pointer border-2 p-7 rounded-2xl flex flex-col items-center text-center gap-4 transition-all ${
                  isActive
                    ? 'border-indigo-400 bg-white shadow-[0_10px_30px_-5px_rgba(129,140,248,0.15)]'
                    : 'border-transparent bg-white hover:translate-y-[-4px] hover:shadow-[0_12px_24px_-8px_rgba(0,0,0,0.1)]'
                }`}
              >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${isActive ? 'bg-indigo-50 text-indigo-400' : 'bg-slate-50 text-slate-400'}`}>
                  {getTaskIcon(type)}
                </div>
                <div>
                  <p className={`font-bold ${isActive ? 'text-slate-800 font-black' : 'text-slate-500'}`}>
                    {getTaskLabel(type)}
                  </p>
                  {isActive && (
                    <p className="text-[10px] text-indigo-400/60 font-bold uppercase mt-1">
                      {getTaskDesc(type)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Chain Flow (Example based on taskType) */}
        <div className="mt-6 flex items-center gap-3">
          <div className="bg-indigo-400/10 text-indigo-400 px-5 py-2 rounded-full text-xs font-extrabold flex items-center gap-2">
            <span>✨ 智能解析</span>
          </div>
          <ArrowRightIcon className="text-slate-300 w-4 h-4" />
          <div className="bg-rose-300/10 text-rose-400 px-5 py-2 rounded-full text-xs font-extrabold flex items-center gap-2">
            <span>📋 {taskType === 'bom' ? 'BOM 结构化' : taskType === 'feedback' ? '多语言翻译' : '回复拟定'}</span>
          </div>
        </div>
      </div>

      {/* Upload Section */}
      <div className="space-y-5">
        <div className="relative group">
          <div className="w-full h-72 border-3 border-dashed border-indigo-100 bg-white rounded-2xl flex flex-col items-center justify-center text-center p-10 transition-all hover:bg-indigo-50/30 hover:border-indigo-400/30 relative overflow-hidden">
            <input 
              type="file" 
              multiple 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
              onChange={(e) => onFileChange(e.target.files)} 
            />
            <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mb-6 text-indigo-400 shadow-sm">
              <CloudArrowUpIcon className="w-10 h-10" />
            </div>
            <p className="text-slate-800 text-lg font-bold">把需要处理的 PDF、Excel 拖到这里吧 ~</p>
            <p className="text-slate-400 text-sm mt-2 font-medium">(最多 5 个，单文件 20MB 以内)</p>
          </div>
        </div>
        
        {/* File List */}
        {files.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {files.map((file, i) => (
              <div key={i} className="flex items-center justify-between bg-white p-5 rounded-2xl shadow-sm border border-slate-50">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-emerald-400/10 rounded-xl flex items-center justify-center text-emerald-400">
                    <DocumentIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-700 leading-none truncate max-w-[150px]">{file.name}</p>
                    <p className="text-[10px] text-slate-400 mt-1 font-bold uppercase">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400 font-black text-[10px] uppercase tracking-wider">
                  <CheckCircleIcon className="w-4 h-4" />
                  就绪
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Textarea */}
      <div className="space-y-3">
        <label className="text-sm font-bold text-slate-600 px-1 ml-1 flex items-center gap-2">
          特别说明 <span className="text-[10px] text-slate-300 font-bold uppercase tracking-widest">(Optional)</span>
        </label>
        <textarea 
          className="w-full rounded-2xl bg-white border-2 border-slate-50 p-6 text-slate-800 placeholder:text-slate-300 focus:ring-4 focus:ring-indigo-400/5 focus:border-indigo-400/20 transition-all min-h-[140px] shadow-sm" 
          placeholder="这单客人有什么特殊要求吗？或者需要我特别注意什么..."
          value={question}
          onChange={(e) => onQuestionChange(e.target.value)}
        />
      </div>

      {/* Action */}
      <button 
        className="w-full py-6 bg-gradient-to-r from-indigo-400 to-indigo-500 text-white rounded-3xl font-black text-xl shadow-xl shadow-indigo-400/30 hover:shadow-2xl hover:shadow-indigo-400/40 hover:scale-[1.01] active:scale-[0.98] transition-all flex items-center justify-center gap-4 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={onSubmit}
        disabled={isPending}
      >
        <span>{isPending ? '✨ 魔法处理中...' : '✨ 开始魔法处理 (Start Task)'}</span>
        {!isPending && <SparklesIcon className="w-6 h-6" />}
      </button>
    </section>
  );
}