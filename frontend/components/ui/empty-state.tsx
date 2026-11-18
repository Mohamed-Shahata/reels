import * as React from 'react';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center p-8 sm:p-12 border border-dashed border-border rounded-2xl bg-surface/40 ${className}`}
      {...props}
    >
      {icon && (
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-surface-2 border border-border text-muted mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-base sm:text-lg font-semibold text-text">{title}</h3>
      {description && (
        <p className="text-sm text-muted max-w-sm mt-1.5 leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
