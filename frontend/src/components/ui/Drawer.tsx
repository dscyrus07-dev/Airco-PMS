import React, { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Right-side detail drawer. Full-screen sheet on mobile, fixed panel on desktop.
 */
export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#1D1B18]/40 backdrop-blur-xs animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Panel — full screen on mobile, right drawer on sm+ */}
      <div
        className={cn(
          'absolute inset-y-0 right-0 w-full sm:w-[520px] lg:w-[560px]',
          'bg-[#FAF8F5] border-l border-[#E4DFD5] shadow-[-16px_0_40px_rgba(0,0,0,0.10)]',
          'flex flex-col animate-in slide-in-from-right duration-250'
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-5 border-b border-[#EAE5DC] bg-white">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-lg text-[#24221F] tracking-tight leading-snug">
              {title}
            </h2>
            {description && (
              <p className="text-xs text-[#6C675F] mt-1 font-body">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#736E65] hover:text-[#24221F] hover:bg-[#F3EFE9] rounded-lg transition-colors cursor-pointer shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5">{children}</div>

        {footer && (
          <div className="px-5 sm:px-6 py-4 border-t border-[#EAE5DC] bg-white">{footer}</div>
        )}
      </div>
    </div>
  );
};
