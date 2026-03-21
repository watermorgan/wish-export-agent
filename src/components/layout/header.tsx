import { BellIcon, SparklesIcon } from '@heroicons/react/24/outline';
import type { AssistantRole } from '@/lib/assistant/types';

export function Header({
  role,
  onRoleChange
}: {
  role: AssistantRole;
  onRoleChange: (role: AssistantRole) => void;
}) {
  return (
    <header className="sticky top-0 z-40 bg-[#f9fafb]/80 backdrop-blur-xl px-8 py-5 flex justify-between items-center">
      <div className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
        <span className="bg-rose-300/20 p-1.5 rounded-lg text-rose-400">
          <SparklesIcon className="w-5 h-5" />
        </span>
        外贸助手 V1
      </div>
      <div className="flex items-center gap-6">
        <div className="hidden lg:flex bg-white shadow-sm rounded-full p-1 border border-slate-100">
          <button
            onClick={() => onRoleChange('sales')}
            className={`rounded-full px-6 py-2 text-sm font-bold transition-colors ${
              role === 'sales'
                ? 'bg-indigo-400 text-white shadow-lg shadow-indigo-400/20'
                : 'text-slate-400 hover:text-indigo-400'
            }`}
          >
            业务员
          </button>
          <button
            onClick={() => onRoleChange('supervisor')}
            className={`rounded-full px-6 py-2 text-sm font-bold transition-colors ${
              role === 'supervisor'
                ? 'bg-indigo-400 text-white shadow-lg shadow-indigo-400/20'
                : 'text-slate-400 hover:text-indigo-400'
            }`}
          >
            主管
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button className="w-11 h-11 flex items-center justify-center bg-white shadow-sm border border-slate-100 rounded-full hover:bg-slate-50 transition-all text-slate-400">
            <BellIcon className="w-5 h-5" />
          </button>
          <div className="h-11 w-11 rounded-full border-2 border-indigo-400/20 p-0.5 shadow-sm">
            <img
              alt="User profile"
              className="w-full h-full rounded-full object-cover"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDrHzg0Scm2Fo9LRXxAgwUdyNyYXdazEvtmGrsT0GDJkF0T0MznmKjcF6nJdXQS7RrCPjUcbbnbeKqbQVqdml-RG7lW3K2D64a0bc-UzwB85H7Y8kvG9PIUOidmKQRGduWGkl4Os6uj3cTegx77E3RRt-4bVOijO4vw40qYtLTOV3WKq4ILX61RmUWWWCI0Q6ny0VfK0AInegKFvcr42rP9ng5H9nCoukOBZPcPuT0Akf4Unn53aqJtfyQoT62DBYNuecqWOp5pVrA"
            />
          </div>
        </div>
      </div>
    </header>
  );
}