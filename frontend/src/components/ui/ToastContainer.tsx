import React from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        let icon = <Info className="w-4 h-4 text-[#554388]" />;
        let borderColor = 'border-[#DDD5F0]';
        let bgColor = 'bg-[#FFFFFF]';

        if (toast.type === 'success') {
          icon = <CheckCircle2 className="w-4 h-4 text-[#2E6038]" />;
          borderColor = 'border-[#CFE4D1]';
        } else if (toast.type === 'warning') {
          icon = <AlertTriangle className="w-4 h-4 text-[#A85808]" />;
          borderColor = 'border-[#FCD9BD]';
        } else if (toast.type === 'error') {
          icon = <AlertCircle className="w-4 h-4 text-[#A82828]" />;
          borderColor = 'border-[#F9C3C3]';
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-[14px] border ${borderColor} ${bgColor} shadow-[0_8px_20px_rgba(0,0,0,0.08)] animate-in slide-in-from-bottom-2 fade-in duration-200`}
          >
            <div className="mt-0.5 shrink-0">{icon}</div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-semibold text-[#24221F] font-body leading-tight">
                {toast.title}
              </h4>
              {toast.description && (
                <p className="text-xs text-[#6C675F] font-body mt-0.5 leading-snug">
                  {toast.description}
                </p>
              )}
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="p-1 text-[#8C867C] hover:text-[#24221F] rounded transition-colors cursor-pointer shrink-0"
              aria-label="Dismiss toast"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
