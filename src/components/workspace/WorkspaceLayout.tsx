import React from 'react';
import { Sidebar } from '../layout/sidebar';
import { Header } from '../layout/header';
import type { AssistantRole } from '@/lib/assistant/types';

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  role: AssistantRole;
  onRoleChange: (role: AssistantRole) => void;
}

export function WorkspaceLayout({ children, role, onRoleChange }: WorkspaceLayoutProps) {
  return (
    <div className="flex bg-[#f9fafb] font-['Manrope'] text-slate-800 min-h-screen">
      <Sidebar />
      <main className="md:ml-80 flex-1 flex flex-col min-h-screen pb-20">
        <Header role={role} onRoleChange={onRoleChange} />
        
        <div className="px-8 py-10 max-w-7xl mx-auto w-full">
          {/* Greeting Section */}
          <div className="mb-12">
            <h1 className="font-['Manrope'] text-5xl font-black text-slate-900 tracking-tight mb-3">
              Good morning, ✨
            </h1>
            <p className="text-slate-400 text-lg font-medium">愿你今天的工作也充满灵感与效率。</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}