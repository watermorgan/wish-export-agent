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
      <div className="bg-surface p-8 rounded-2xl shadow-soft border border-outline">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-on-surface">新任务</h2>
          <span className="bg-accent-soft text-primary px-3 py-1 rounded-full text-xs font-bold">
            {currentTemplate?.name ?? "手动组合"}
          </span>
        </div>

        <div className="space-y-8">
          {/* Role selection */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-muted">角色</h3>
            <div className="grid grid-cols-2 gap-4">
              {roleOptions.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setRole(option.id)}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    role === option.id
                      ? "border-primary bg-accent-soft ring-4 ring-primary-soft"
                      : "border-outline bg-surface hover:border-outline-strong"
                  }`}
                >
                  <p className="font-bold text-on-surface">{option.label}</p>
                  <p className="text-xs text-muted mt-1">{option.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Task Type selection */}
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-muted">选择任务类型</h3>
              <button className="text-primary text-xs font-bold hover:underline decoration-2">
                浏览模板库 ✨
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {taskTypeOptions.map((option, index) => {
                const icons = ["inventory_2", "translate", "mail"];
                const icon = icons[index % icons.length];
                const isActive = taskType === option.id;
                
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      setTaskType(option.id);
                      setQuestion(quickPrompts[index]);
                    }}
                    className={`p-6 rounded-2xl border-2 transition-all flex flex-col items-center text-center gap-4 ${
                      isActive
                        ? "border-primary bg-accent-soft shadow-float scale-[1.02]"
                        : "border-transparent bg-surface hover-float"
                    }`}
                  >
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
                      isActive ? "bg-primary-soft text-primary" : "bg-ivory text-muted/50"
                    }`}>
                      <span className="material-symbols-outlined text-3xl">{icon}</span>
                    </div>
                    <div>
                      <p className={`font-black ${isActive ? "text-on-surface" : "text-muted"}`}>{option.label}</p>
                      {isActive && (
                        <p className="text-[10px] text-primary/60 font-bold uppercase mt-1">
                          {option.id === 'bom' ? 'Smart Sorting' : option.id === 'feedback' ? 'Quick Merging' : 'Smart Draft'}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Templates */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-muted">模板</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {workflowTemplates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => applyTemplate(template)}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    selectedTemplateId === template.id
                      ? "border-primary bg-accent-soft ring-4 ring-primary-soft"
                      : "border-outline bg-surface hover:border-outline-strong"
                  }`}
                >
                  <p className="font-bold text-on-surface">{template.name}</p>
                  <p className="text-xs text-muted mt-1">{template.goal}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Skills */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-muted">技能</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {skillCatalog.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => toggleSkill(skill)}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    selectedSkillIds.includes(skill.id)
                      ? "border-primary bg-accent-soft ring-4 ring-primary-soft"
                      : "border-outline bg-surface hover:border-outline-strong"
                  }`}
                >
                  <p className="font-bold text-on-surface">{skill.name}</p>
                  <p className="text-xs text-muted mt-1">{skill.purpose}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Upload */}
          <div className="space-y-5">
            <div className="relative group">
              <div
                className="w-full h-48 border-2 border-dashed border-outline bg-ivory/30 rounded-2xl flex flex-col items-center justify-center text-center p-6 transition-all group-hover:bg-accent-soft group-hover:border-primary-soft"
              >
                <div className="w-12 h-12 bg-surface rounded-xl flex items-center justify-center mb-4 text-primary shadow-sm">
                  <span className="material-symbols-outlined text-2xl">cloud_upload</span>
                </div>
                <p className="text-on-surface font-bold">点击或拖拽上传文件</p>
                <p className="text-muted text-xs mt-1">支持 PDF, Word, Excel, TXT (最大 20MB)</p>
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
                  <div key={`${file.name}-${file.size}`} className="flex items-center justify-between bg-surface p-4 rounded-xl border border-outline shadow-soft">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-accent-soft rounded-lg flex items-center justify-center text-primary">
                        <span className="material-symbols-outlined text-lg">description</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-on-surface truncate">{file.name}</p>
                        <p className="text-[10px] text-muted font-bold uppercase">{file.type} · {formatBytes(file.size)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Question Textarea */}
          <div className="space-y-3">
            <label htmlFor="question" className="text-sm font-bold text-muted">处理要求</label>
            <textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="w-full rounded-2xl bg-surface border-2 border-outline p-6 text-on-surface placeholder:text-muted/40 focus:ring-4 focus:ring-primary-soft focus:border-primary/20 transition-all min-h-[140px] shadow-soft"
              placeholder="例如：请保留英文原文，在每段下方增加中文翻译..."
            />
            <div className="flex flex-wrap gap-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setQuestion(prompt)}
                  className="px-3 py-1.5 bg-surface border border-outline rounded-full text-xs font-medium text-muted hover:border-primary hover:text-primary transition-all"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          {/* Action Row */}
          <div className="pt-4 border-t border-outline">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <span className="text-xs text-muted font-medium">
                {activeTaskId ? `当前任务：${activeTaskId} · ` : ""}
                {currentTemplate?.name ?? `${selectedSkillIds.length} 个技能`} ·
                输入 {deferredQuestion.trim().length} 字
              </span>
              <div className="flex gap-3">
                <button
                  onClick={saveCurrentTask}
                  disabled={isPending || !currentTask}
                  className="px-6 py-3 bg-surface border border-outline text-muted rounded-xl font-bold text-sm hover:bg-ivory disabled:opacity-50 transition-all"
                >
                  保存当前任务
                </button>
                <button
                  onClick={submit}
                  disabled={isPending}
                  className="px-10 py-4 bg-gradient-to-r from-primary to-secondary text-white rounded-2xl font-black text-base shadow-xl shadow-primary/30 hover:shadow-2xl hover:shadow-primary/40 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50 transition-all flex items-center justify-center gap-4"
                >
                  {isPending ? (
                    "处理中..."
                  ) : (
                    <>
                      <span>{currentTask ? "新开一次执行" : "开始魔法处理 (Start Task)"}</span>
                      <span className="material-symbols-outlined text-xl">auto_awesome</span>
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
