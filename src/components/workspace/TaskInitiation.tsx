"use client";

import React from "react";
import {
  roleOptions,
  skillCatalog,
  taskTypeOptions,
  workflowTemplates,
  quickPrompts,
} from "@/lib/assistant/catalog";
import type {
  AssistantRole,
  SkillDefinition,
  TaskType,
  WorkflowTemplate,
  TaskRecord,
} from "@/lib/assistant/types";

interface TaskInitiationProps {
  role: AssistantRole;
  setRole: (role: AssistantRole) => void;
  taskType: TaskType;
  setTaskType: (type: TaskType) => void;
  question: string;
  setQuestion: (question: string) => void;
  selectedTemplateId: string | null;
  selectedSkillIds: string[];
  files: File[];
  onFileChange: (files: FileList | null) => void;
  isPending: boolean;
  submit: () => void;
  saveCurrentTask: () => void;
  currentTask: TaskRecord | null;
  applyTemplate: (template: WorkflowTemplate) => void;
  toggleSkill: (skill: SkillDefinition) => void;
  deferredQuestion: string;
  activeTaskId: string | null;
}

export function TaskInitiation({
  role,
  setRole,
  taskType,
  setTaskType,
  question,
  setQuestion,
  selectedTemplateId,
  selectedSkillIds,
  files,
  onFileChange,
  isPending,
  submit,
  saveCurrentTask,
  currentTask,
  applyTemplate,
  toggleSkill,
  deferredQuestion,
  activeTaskId,
}: TaskInitiationProps) {
  const currentTemplate = workflowTemplates.find(
    (t) => t.id === selectedTemplateId
  );

  function formatBytes(size: number) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  const visibleFiles = files.length > 0 
    ? files.map(f => ({ name: f.name, size: f.size, type: f.type || "未知类型" }))
    : (currentTask?.files ?? []).map(f => ({ name: f.name, size: f.size, type: f.type || "未知类型" }));

  return (
    <section className="lg:col-span-7 space-y-10">
      <div className="bg-white p-8 rounded-2xl shadow-soft border border-slate-50">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-slate-800">新任务</h2>
          <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold">
            {currentTemplate?.name ?? "手动组合"}
          </span>
        </div>

        <div className="space-y-8">
          {/* Role selection */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-600">角色</h3>
            <div className="grid grid-cols-2 gap-4">
              {roleOptions.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setRole(option.id)}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    role === option.id
                      ? "border-primary bg-primary/5 ring-4 ring-primary/5"
                      : "border-slate-50 bg-white hover:border-slate-200"
                  }`}
                >
                  <p className="font-bold text-slate-800">{option.label}</p>
                  <p className="text-xs text-slate-400 mt-1">{option.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Task Type selection */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-600">任务类型</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {taskTypeOptions.map((option, index) => (
                <button
                  key={option.id}
                  onClick={() => {
                    setTaskType(option.id);
                    setQuestion(quickPrompts[index]);
                  }}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    taskType === option.id
                      ? "border-primary bg-primary/5 ring-4 ring-primary/5"
                      : "border-slate-50 bg-white hover:border-slate-200"
                  }`}
                >
                  <p className="font-bold text-slate-800">{option.label}</p>
                  <p className="text-xs text-slate-400 mt-1">{option.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Templates */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-600">模板</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {workflowTemplates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => applyTemplate(template)}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    selectedTemplateId === template.id
                      ? "border-primary bg-primary/5 ring-4 ring-primary/5"
                      : "border-slate-50 bg-white hover:border-slate-200"
                  }`}
                >
                  <p className="font-bold text-slate-800">{template.name}</p>
                  <p className="text-xs text-slate-400 mt-1">{template.goal}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Skills */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-600">技能</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {skillCatalog.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => toggleSkill(skill)}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    selectedSkillIds.includes(skill.id)
                      ? "border-primary bg-primary/5 ring-4 ring-primary/5"
                      : "border-slate-50 bg-white hover:border-slate-200"
                  }`}
                >
                  <p className="font-bold text-slate-800">{skill.name}</p>
                  <p className="text-xs text-slate-400 mt-1">{skill.purpose}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Upload */}
          <div className="space-y-5">
            <div className="relative group">
              <div
                className="w-full h-48 border-2 border-dashed border-slate-100 bg-slate-50/30 rounded-2xl flex flex-col items-center justify-center text-center p-6 transition-all group-hover:bg-primary/5 group-hover:border-primary/20"
              >
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center mb-4 text-primary shadow-sm">
                  <span className="material-symbols-outlined text-2xl">cloud_upload</span>
                </div>
                <p className="text-slate-800 font-bold">点击或拖拽上传文件</p>
                <p className="text-slate-400 text-xs mt-1">支持 PDF, Word, Excel, TXT (最大 20MB)</p>
                <input
                  aria-label="上传文件"
                  type="file"
                  multiple
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.eml,.msg"
                  onChange={(event) => onFileChange(event.target.files)}
                />
              </div>
            </div>

            {visibleFiles.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {visibleFiles.map((file) => (
                  <div key={`${file.name}-${file.size}`} className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-soft">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                        <span className="material-symbols-outlined text-lg">description</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-700 truncate">{file.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase">{file.type} · {formatBytes(file.size)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Question Textarea */}
          <div className="space-y-3">
            <label htmlFor="question" className="text-sm font-bold text-slate-600">处理要求</label>
            <textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="w-full rounded-2xl bg-white border-2 border-slate-50 p-6 text-slate-800 placeholder:text-slate-300 focus:ring-4 focus:ring-primary/5 focus:border-primary/20 transition-all min-h-[140px] shadow-soft"
              placeholder="例如：请保留英文原文，在每段下方增加中文翻译..."
            />
            <div className="flex flex-wrap gap-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setQuestion(prompt)}
                  className="px-3 py-1.5 bg-white border border-slate-100 rounded-full text-xs font-medium text-slate-500 hover:border-primary hover:text-primary transition-all"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          {/* Action Row */}
          <div className="pt-4 border-t border-slate-50">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <span className="text-xs text-slate-400 font-medium">
                {activeTaskId ? `当前任务：${activeTaskId} · ` : ""}
                {currentTemplate?.name ?? `${selectedSkillIds.length} 个技能`} ·
                输入 {deferredQuestion.trim().length} 字
              </span>
              <div className="flex gap-3">
                <button
                  onClick={saveCurrentTask}
                  disabled={isPending || !currentTask}
                  className="px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 disabled:opacity-50 transition-all"
                >
                  保存当前任务
                </button>
                <button
                  onClick={submit}
                  disabled={isPending}
                  className="px-8 py-3 bg-primary text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  {isPending ? (
                    "处理中..."
                  ) : (
                    <>
                      <span>{currentTask ? "新开一次执行" : "开始魔法处理"}</span>
                      <span className="material-symbols-outlined text-sm">auto_awesome</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
