import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  autoComplete?: string;
  /** Optional element rendered at the right edge of the label row (e.g. "Forgot password?") */
  labelAction?: React.ReactNode;
}

/**
 * Password field with an accessible show/hide toggle and inline error display.
 */
export const PasswordInput: React.FC<PasswordInputProps> = ({
  id,
  label,
  value,
  onChange,
  placeholder = '••••••••••••',
  error,
  autoComplete = 'current-password',
  labelAction,
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label
          htmlFor={id}
          className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider font-body"
        >
          {label}
        </label>
        {labelAction}
      </div>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`w-full px-3.5 py-2.5 pr-11 bg-[#FAF8F5] border rounded-[10px] text-sm text-[#24221F] placeholder:text-[#9F998F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641] ${
            error ? 'border-[#D96C6C]' : 'border-[#DDD7CB]'
          }`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8C867C] hover:text-[#24221F] transition-colors cursor-pointer"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-[11px] text-[#A32A2A] font-medium mt-1">
          {error}
        </p>
      )}
    </div>
  );
};
