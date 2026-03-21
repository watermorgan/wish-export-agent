"use client";

import React from "react";
import Image from "next/image";

interface HeaderProps {
  role: "sales" | "supervisor";
  onRoleChange: (role: "sales" | "supervisor") => void;
  pendingReviewCount: number;
  theme?: "professional" | "fresh";
  onThemeToggle?: () => void;
}

export function Header({ 
  role, 
  onRoleChange, 
  pendingReviewCount,
  theme = "professional",
  onThemeToggle
}: HeaderProps) {
  return (
    <header
      className="sticky top-0 z-40 bg-ivory/80 backdrop-blur-xl px-8 py-5 flex justify-between items-center border-b border-line/10"
    >
      <div
        className="text-lg font-extrabold text-on-surface flex items-center gap-2"
      >
        <span className="bg-secondary/20 p-1.5 rounded-lg text-secondary">
          <span
            className="material-symbols-outlined !text-sm"
          >auto_awesome</span>
        </span>
        外贸助手 V1
      </div>
      <div className="flex items-center gap-6">
        {/* Role Switcher */}
        <div
          className="hidden lg:flex bg-surface shadow-soft rounded-full p-1 border border-line"
        >
          <button
            onClick={() => onRoleChange("sales")}
            className={`${
              role === "sales"
                ? "bg-primary text-white shadow-lg shadow-primary/20"
                : "text-muted hover:text-primary"
            } rounded-full px-6 py-2 text-sm font-bold transition-all`}
          >
            Salesperson
          </button>
          <button
            onClick={() => onRoleChange("supervisor")}
            className={`${
              role === "supervisor"
                ? "bg-primary text-white shadow-lg shadow-primary/20"
                : "text-muted hover:text-primary"
            } rounded-full px-6 py-2 text-sm font-bold transition-all`}
          >
            Supervisor
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Theme Toggle */}
          <button
            onClick={onThemeToggle}
            className="w-11 h-11 flex items-center justify-center bg-surface shadow-soft border border-line rounded-full hover:bg-ivory transition-all text-muted"
            title={`Switch to ${theme === 'professional' ? 'Fresh' : 'Professional'} theme`}
          >
            <span className="material-symbols-outlined">
              {theme === "professional" ? "palette" : "landscape"}
            </span>
          </button>

          {/* Notifications */}
          <button
            className="w-11 h-11 flex items-center justify-center bg-surface shadow-soft border border-line rounded-full hover:bg-ivory transition-all text-muted relative"
          >
            <span className="material-symbols-outlined">notifications</span>
            {pendingReviewCount > 0 && (
              <span className="absolute top-2.5 right-2.5 block h-2 w-2 rounded-full bg-secondary ring-2 ring-surface" />
            )}
          </button>

          {/* User Profile */}
          <div
            className="h-11 w-11 rounded-full border-2 border-primary/20 p-0.5 shadow-soft overflow-hidden relative"
          >
            <Image
              alt="User profile"
              className="rounded-full object-cover"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDrHzg0Scm2Fo9LRXxAgwUdyNyYXdazEvtmGrsT0GDJkF0T0MznmKjcF6nJdXQS7RrCPjUcbbnbeKqbQVqdml-RG7lW3K2D64a0bc-UzwB85H7Y8kvG9PIUOidmKQRGduWGkl4Os6uj3cTegx77E3RRt-4bVOijO4vw40qYtLTOV3WKq4ILX61RmUWWWCI0Q6ny0VfK0AInegKFvcr42rP9ng5H9nCoukOBZPcPuT0Akf4Unn53aqJtfyQoT62DBYNuecqWOp5pVrA"
              width={44}
              height={44}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
