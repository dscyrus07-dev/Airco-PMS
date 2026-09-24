import React, { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  hoverEffect?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className,
  hoverEffect = false,
  ...props
}) => {
  return (
    <div
      className={cn(
        'bg-[#FFFFFF] border border-[#EAE5DC] rounded-[16px] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] transition-all duration-200',
        hoverEffect && 'hover:border-[#D5CFC3] hover:shadow-[0_4px_12px_rgba(36,34,31,0.05)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<{ children: ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div className={cn('flex items-center justify-between gap-3 pb-3 border-b border-[#F4EFEB] mb-4', className)}>
    {children}
  </div>
);

export const CardTitle: React.FC<{ children: ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <h3 className={cn('font-display font-semibold text-[17px] text-[#24221F] tracking-tight leading-snug', className)}>
    {children}
  </h3>
);
