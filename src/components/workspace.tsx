"use client";

import {
  WorkspaceLayout,
  TaskInitiation,
  TaskResults,
  ConfirmationPanel,
  TaskHistory,
  useTaskActions,
} from "./workspace/index";

export function Workspace() {
  const {
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
    reply,
    recentTasks,
    error,
    isPending,
    deferredQuestion,
    applyTemplate,
    toggleSkill,
    submit,
    saveCurrentTask,
    openTask,
    submitForReview,
    reviewCurrentTask,
    exportCurrentTask,
    updateConfirmationStatus,
    activeTaskId,
  } = useTaskActions();

  const currentTask = reply?.task ?? null;
  const pendingReviewTasks = recentTasks.filter(
    (task) => task.reviewStatus === "pending_review",
  );
  
  const pendingConfirmations = reply?.pendingConfirmations ?? [];
  const canEditConfirmations = [
    "pending_user_confirmation",
    "returned",
  ].includes(currentTask?.status ?? "");

  return (
    <WorkspaceLayout
      role={role}
      onRoleChange={setRole}
      pendingReviewCount={pendingReviewTasks.length}
    >
      {/* Greeting Section */}
      <div className="mb-12">
        <h1 className="font-headline text-5xl font-black text-slate-900 tracking-tight mb-3">
          Good morning, ✨
        </h1>
        <p className="text-slate-400 text-lg font-medium">
          愿你今天的工作也充满灵感与效率。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Left: Task Initiation & Results (7/12) */}
        <div className="lg:col-span-7 space-y-10">
          <TaskInitiation
            role={role}
            setRole={setRole}
            taskType={taskType}
            setTaskType={setTaskType}
            question={question}
            setQuestion={setQuestion}
            selectedTemplateId={selectedTemplateId}
            selectedSkillIds={selectedSkillIds}
            files={files}
            onFileChange={onFileChange}
            isPending={isPending}
            submit={submit}
            saveCurrentTask={saveCurrentTask}
            currentTask={currentTask}
            applyTemplate={applyTemplate}
            toggleSkill={toggleSkill}
            deferredQuestion={deferredQuestion}
            activeTaskId={activeTaskId}
          />
          
          <TaskResults
            reply={reply}
            error={error}
            isPending={isPending}
            role={role}
            submitForReview={submitForReview}
            reviewCurrentTask={reviewCurrentTask}
            exportCurrentTask={exportCurrentTask}
          />
        </div>

        {/* Right: Risks & Recent (5/12) */}
        <aside className="lg:col-span-5 space-y-10">
          <ConfirmationPanel
            pendingConfirmations={pendingConfirmations}
            updateConfirmationStatus={updateConfirmationStatus}
            isPending={isPending}
            canEdit={canEditConfirmations}
          />

          <TaskHistory
            recentTasks={recentTasks}
            pendingReviewTasks={pendingReviewTasks}
            role={role}
            openTask={openTask}
            isPending={isPending}
          />

          {/* Banner */}
          <div className="relative overflow-hidden h-44 rounded-3xl bg-gradient-to-br from-primary to-indigo-600 p-8 flex items-end shadow-xl shadow-primary/20">
            <div className="relative z-10">
              <p className="text-white font-black text-2xl leading-tight">
                Create with <br />
                Confidence.
              </p>
              <p className="text-white/60 text-xs font-bold mt-2 uppercase tracking-widest">
                Design System v1.4.2 ✨
              </p>
            </div>
            <span className="absolute -right-6 -top-6 text-9xl opacity-10 rotate-12">
              🚀
            </span>
            <div className="absolute top-0 right-0 p-6">
              <div className="w-12 h-12 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center text-white">
                <span className="material-symbols-outlined">auto_fix_high</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </WorkspaceLayout>
  );
}
