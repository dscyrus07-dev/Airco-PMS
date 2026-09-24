import React, { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'destructive' | 'ghost' | 'sage';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className,
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-body font-medium rounded-[12px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#3E6B48]/30 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer select-none';

  const sizeStyles = {
    sm: 'text-xs px-3 py-1.5 gap-1.5',
    md: 'text-sm px-4 py-2 gap-2',
    lg: 'text-base px-5 py-2.5 gap-2.5',
  };

  const variantStyles = {
    primary:
      'bg-[#386641] hover:bg-[#2F5736] text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] active:scale-[0.99]',
    sage:
      'bg-[#EBF3EC] hover:bg-[#DDEBDE] text-[#2B5433] border border-[#CFE4D1] active:scale-[0.99]',
    secondary:
      'bg-[#F2EEE7] hover:bg-[#E7E1D7] text-[#2D2A26] border border-[#DDD7CB]',
    outline:
      'bg-transparent hover:bg-[#F6F3ED] text-[#332F2A] border border-[#DDD7CB]',
    destructive:
      'bg-[#C53B3B] hover:bg-[#AF3232] text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]',
    ghost:
      'bg-transparent hover:bg-[#F2EEE7] text-[#4A453E] border-transparent',
  };

  return (
    <button
      className={cn(baseStyles, sizeStyles[size], variantStyles[variant], className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            ></path>
          </svg>
          <span>Loading...</span>
        </>
      ) : (
        children
      )}
    </button>
  );
};
