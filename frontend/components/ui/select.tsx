import * as React from 'react';

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', error = false, disabled, children, ...props }, ref) => {
    return (
      <div className="relative w-full">
        <select
          ref={ref}
          disabled={disabled}
          className={`w-full appearance-none px-3.5 py-2 pe-9 text-sm bg-surface-2 text-text rounded-lg border transition-colors duration-150 focus:outline-none focus:ring-1 disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${
            error
              ? 'border-danger focus:border-danger focus:ring-danger'
              : 'border-border focus:border-accent focus:ring-accent'
          } ${className}`}
          {...props}
        >
          {children}
        </select>
        <div className="pointer-events-none absolute inset-y-0 end-0 flex items-center pe-3 text-muted">
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>
    );
  },
);

Select.displayName = 'Select';
