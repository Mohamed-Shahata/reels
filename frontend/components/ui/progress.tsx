import * as React from 'react';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0 to 100
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'accent' | 'info' | 'warning' | 'danger';
}

export function Progress({
  value,
  max = 100,
  size = 'md',
  variant = 'accent',
  className = '',
  ...props
}: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const sizeStyles = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-4',
  };

  const variantStyles = {
    accent: 'bg-accent',
    info: 'bg-info',
    warning: 'bg-warning',
    danger: 'bg-danger',
  };

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={`w-full bg-surface-2 rounded-full overflow-hidden border border-border/50 ${sizeStyles[size]} ${className}`}
      {...props}
    >
      <div
        className={`h-full transition-all duration-300 ease-out rounded-full ${variantStyles[variant]}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
