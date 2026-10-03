import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * Shared back affordance — text-link style used across the workspace
 * (matches the day-analysis views). Goes to the previous history entry
 * when one exists (covers drill-in paths like Zone Workspace → Tasks,
 * /admin/employees → property Employees, room → maintenance ticket);
 * falls back to `to` on a direct/deep-link entry so it never exits the app.
 */
export const BackButton: React.FC<{
  to: string;
  label?: string;
}> = ({ to, label = 'Back' }) => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => {
        const idx =
          (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (idx > 0) navigate(-1);
        else navigate(to);
      }}
      className="flex items-center gap-1.5 text-[13px] font-semibold text-[#6C675F] hover:text-[#24221F] transition-colors cursor-pointer"
    >
      <ArrowLeft className="w-4 h-4" /> {label}
    </button>
  );
};

export default BackButton;
