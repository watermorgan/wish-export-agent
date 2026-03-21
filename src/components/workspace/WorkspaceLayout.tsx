"use client";

import React, { useState, useEffect } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  role: "sales" | "supervisor";
  onRoleChange: (role: "sales" | "supervisor") => void;
  pendingReviewCount: number;
}

export type ThemeType = "professional" | "fresh";

export function WorkspaceLayout({
  children,
  role,
  onRoleChange,
  pendingReviewCount,
}: WorkspaceLayoutProps) {
  const [theme, setTheme] = useState<ThemeType>("professional");

  useEffect(() => {
    // Apply theme to the document element
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "professional" ? "fresh" : "professional"));
  };

  return (
    <div className={`min-h-screen bg-ivory font-body text-on-surface selection:bg-primary/20`}>
      <Sidebar />
      <main className="md:ml-80 min-h-screen pb-20">
        <Header
          role={role}
          onRoleChange={onRoleChange}
          pendingReviewCount={pendingReviewCount}
          theme={theme}
          onThemeToggle={toggleTheme}
        />
        <div className="px-8 py-10 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
