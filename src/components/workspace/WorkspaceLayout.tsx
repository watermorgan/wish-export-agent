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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Apply theme to the document element
    if (mounted) {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme, mounted]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "professional" ? "fresh" : "professional"));
  };

  // Prevent hydration mismatch by returning a skeleton or neutral state until mounted
  // The outer div and main wrapper should have stable classes
  return (
    <div className="min-h-screen bg-ivory font-body text-on-surface selection:bg-primary/20">
      <Sidebar />
      <main className="md:ml-80 min-h-screen pb-20">
        <Header
          role={mounted ? role : "sales"}
          onRoleChange={onRoleChange}
          pendingReviewCount={pendingReviewCount}
          theme={mounted ? theme : "professional"}
          onThemeToggle={toggleTheme}
        />
        <div className="px-8 py-10 max-w-7xl mx-auto">
          {mounted ? children : <div className="animate-pulse space-y-4">
            <div className="h-8 bg-outline/10 rounded w-1/4"></div>
            <div className="h-32 bg-outline/10 rounded"></div>
          </div>}
        </div>
      </main>
    </div>
  );
}
