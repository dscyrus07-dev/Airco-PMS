import React from 'react';

interface FormFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  error?: string;
  required?: boolean;
  textarea?: boolean;
  autoComplete?: string;
}

/**
 * Labelled input/textarea with inline error display.
 * Errors render as text — never color-only — for accessibility.
 */
export const FormField: React.FC<FormFieldProps> = ({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
  required = true,
  textarea = false,
  autoComplete,
}) => {
  const inputCls = `w-full px-3.5 py-2.5 bg-[#FAF8F5] border rounded-[10px] text-sm text-[#24221F] placeholder:text-[#9F998F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641] ${
    error ? 'border-[#D96C6C]' : 'border-[#DDD7CB]'
  }`;

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1.5 font-body"
      >
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {textarea ? (
        <textarea
          id={id}
          rows={3}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={inputCls}
        />
      ) : (
        <input
          id={id}
          type={type}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={inputCls}
        />
      )}
      {error && (
        <p id={`${id}-error`} className="text-[11px] text-[#A32A2A] font-medium mt-1">
          {error}
        </p>
      )}
    </div>
  );
};
