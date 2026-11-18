import * as React from 'react';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error = false, disabled, ...props }, ref) => {
    return (
      <input
        ref={ref}
        disabled={disabled}
        className={`w-full px-3.5 py-2 text-sm bg-surface-2 text-text placeholder:text-muted rounded-lg border transition-colors duration-150 focus:outline-none focus:ring-1 disabled:opacity-50 disabled:pointer-events-none ${
          error
            ? 'border-danger focus:border-danger focus:ring-danger'
            : 'border-border focus:border-accent focus:ring-accent'
        } ${className}`}
        {...props}
      />
    );
  },
);

Input.displayName = 'Input';
