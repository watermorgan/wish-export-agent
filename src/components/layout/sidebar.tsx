"use client";

import React from "react";
import Image from "next/image";

export function Sidebar() {
  return (
    <aside
      className="hidden md:flex flex-col h-screen p-8 overflow-y-auto bg-surface w-80 fixed left-0 top-0 border-r border-outline font-label"
    >
      <div className="flex items-center gap-3 mb-12">
        <div
          className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-soft"
        >
          A
        </div>
        <div className="text-2xl font-black text-on-surface tracking-tight font-headline">
          The Atelier
        </div>
      </div>
      <div
        className="flex items-center gap-4 mb-10 p-4 bg-accent-soft rounded-2xl"
      >
        <div
          className="w-12 h-12 rounded-full border-2 border-white overflow-hidden shadow-sm relative"
        >
          <Image
            alt="User Avatar"
            className="object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuA9JTW85lhwU_fDKOMcZTcO62UFZlPW_8f86Bj392a5Dobvcl-BsHmI5Tv0_gGEkX-n1Oq46wofP2Enfckfjc0TqFldd1IEvU2iW66usxzDyG_sL8HyxHc4VTk-HoSegQUHENxrIdv9-jJVN2Gi2I8CgyO3aTuiAahkp1-ZIDlviqIRXS0-k3lKwBacWoeIdnMhHH_MwGkAR9PoIiC-N-brR7HaTaVdE1yLHUrLSH2zZsXsGsMVpxrs-TgkJvKybCRb0vAEa1uuwD8"
            fill
          />
        </div>
        <div>
          <p className="text-on-surface font-bold leading-none">The Atelier</p>
          <p
            className="text-[10px] text-primary font-bold uppercase tracking-widest mt-1"
          >
            Professional ✨
          </p>
        </div>
      </div>
      <nav className="flex-1 space-y-2">
        <a
          className="bg-primary-soft text-primary rounded-2xl px-5 py-4 flex items-center gap-4 font-bold transition-all"
          href="#"
        >
          <span className="material-symbols-outlined text-xl">grid_view</span>
          <span>Workspace ✨</span>
        </a>
        <a
          className="text-muted px-5 py-4 hover:bg-ivory rounded-2xl flex items-center gap-4 transition-all"
          href="#"
        >
          <span className="material-symbols-outlined text-xl">assignment</span>
          <span>Task Details</span>
        </a>
        <a
          className="text-muted px-5 py-4 hover:bg-ivory rounded-2xl flex items-center gap-4 transition-all"
          href="#"
        >
          <span
            className="material-symbols-outlined text-xl"
          >verified_user</span>
          <span>Audit Queue 📝</span>
        </a>
        <a
          className="text-muted px-5 py-4 hover:bg-ivory rounded-2xl flex items-center gap-4 transition-all"
          href="#"
        >
          <span
            className="material-symbols-outlined text-xl"
          >dashboard_customize</span>
          <span>Templates</span>
        </a>
      </nav>
      <div className="mt-auto pt-6">
        <div className="bg-ivory p-5 rounded-2xl border border-outline">
          <div className="flex justify-between items-center mb-3">
            <p className="text-xs font-bold text-muted uppercase tracking-tight">
              Capacity
            </p>
            <span className="text-xs font-bold text-primary">65%</span>
          </div>
          <div className="w-full bg-outline/20 h-2 rounded-full overflow-hidden">
            <div className="bg-primary h-full w-[65%] rounded-full"></div>
          </div>
        </div>
      </div>
    </aside>
  );
}
