import {
  Squares2X2Icon,
  DocumentTextIcon,
  ShieldCheckIcon,
  SquaresPlusIcon
} from '@heroicons/react/24/outline';

export function Sidebar() {
  return (
    <aside className="hidden md:flex flex-col h-screen p-8 overflow-y-auto bg-white w-80 fixed left-0 top-0 border-r border-slate-100 font-['Plus_Jakarta_Sans']">
      <div className="flex items-center gap-3 mb-12">
        <div className="w-10 h-10 bg-indigo-400 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-indigo-400/20">
          A
        </div>
        <div className="text-2xl font-black text-slate-800 tracking-tight">The Atelier</div>
      </div>
      
      <div className="flex items-center gap-4 mb-10 p-4 bg-indigo-50/50 rounded-2xl">
        <div className="w-12 h-12 rounded-full border-2 border-white overflow-hidden shadow-sm">
          <img
            alt="User Avatar"
            className="w-full h-full object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuA9JTW85lhwU_fDKOMcZTcO62UFZlPW_8f86Bj392a5Dobvcl-BsHmI5Tv0_gGEkX-n1Oq46wofP2Enfckfjc0TqFldd1IEvU2iW66usxzDyG_sL8HyxHc4VTk-HoSegQUHENxrIdv9-jJVN2Gi2I8CgyO3aTuiAahkp1-ZIDlviqIRXS0-k3lKwBacWoeIdnMhHH_MwGkAR9PoIiC-N-brR7HaTaVdE1yLHUrLSH2zZsXsGsMVpxrs-TgkJvKybCRb0vAEa1uuwD8"
          />
        </div>
        <div>
          <p className="text-slate-900 font-bold leading-none">Cici</p>
          <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest mt-1">
            Professional ✨
          </p>
        </div>
      </div>
      
      <nav className="flex-1 space-y-2">
        <a
          className="bg-indigo-400/10 text-indigo-400 rounded-2xl px-5 py-4 flex items-center gap-4 font-bold transition-all"
          href="#"
        >
          <Squares2X2Icon className="w-6 h-6" />
          <span>工作台 ✨</span>
        </a>
        <a
          className="text-slate-500 px-5 py-4 hover:bg-slate-50 rounded-2xl flex items-center gap-4 transition-all"
          href="#"
        >
          <DocumentTextIcon className="w-6 h-6" />
          <span>任务详情</span>
        </a>
        <a
          className="text-slate-500 px-5 py-4 hover:bg-slate-50 rounded-2xl flex items-center gap-4 transition-all"
          href="#"
        >
          <ShieldCheckIcon className="w-6 h-6" />
          <span>审核队列 📝</span>
        </a>
        <a
          className="text-slate-500 px-5 py-4 hover:bg-slate-50 rounded-2xl flex items-center gap-4 transition-all"
          href="#"
        >
          <SquaresPlusIcon className="w-6 h-6" />
          <span>模板库</span>
        </a>
      </nav>
      
      <div className="mt-auto pt-6">
        <div className="bg-[#f9fafb] p-5 rounded-2xl border border-slate-100">
          <div className="flex justify-between items-center mb-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-tight">
              Quota
            </p>
            <span className="text-xs font-bold text-indigo-400">65%</span>
          </div>
          <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
            <div className="bg-indigo-400 h-full w-[65%] rounded-full"></div>
          </div>
        </div>
      </div>
    </aside>
  );
}