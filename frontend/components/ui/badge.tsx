import * as React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'accent' | 'warning' | 'danger' | 'info' | 'muted';
  size?: 'sm' | 'md';
}

export function Badge({
  className = '',
  variant = 'default',
  size = 'md',
  children,
  ...props
}: BadgeProps) {
  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-full select-none';

  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
  };

  const variantStyles = {
    default: 'bg-surface-2 text-text border border-border',
    accent: 'bg-accent-soft text-accent border border-accent/20',
    warning: 'bg-warning-soft text-warning border border-warning/20',
    danger: 'bg-danger-soft text-danger border border-danger/20',
    info: 'bg-info-soft text-info border border-info/20',
    muted: 'bg-surface text-muted border border-border',
  };

  return (
    <span
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
