'use client';

import * as React from 'react';

interface DrawerContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DrawerContext = React.createContext<DrawerContextValue | null>(null);

export interface DrawerProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Drawer({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
}: DrawerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  return (
    <DrawerContext.Provider
      value={{ open, onOpenChange: handleOpenChange }}
    >
      {children}
    </DrawerContext.Provider>
  );
}

export function DrawerTrigger({
  asChild = false,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const context = React.useContext(DrawerContext);
  if (!context) throw new Error('DrawerTrigger must be used within Drawer');

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      onClick?: React.MouseEventHandler;
    }>;
    return React.cloneElement(child, {
      onClick: (e: React.MouseEvent) => {
        child.props.onClick?.(e);
        context.onOpenChange(true);
      },
    });
  }

  return (
    <button
      type="button"
      onClick={() => context.onOpenChange(true)}
      {...props}
    >
      {children}
    </button>
  );
}

export interface DrawerContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  side?: 'end' | 'start' | 'bottom';
}

export function DrawerContent({
  className = '',
  side = 'end',
  children,
  ...props
}: DrawerContentProps) {
  const context = React.useContext(DrawerContext);
  if (!context) throw new Error('DrawerContent must be used within Drawer');

  React.useEffect(() => {
    if (!context.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        context.onOpenChange(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [context]);

  if (!context.open) return null;

  const positionStyles = {
    end: 'inset-y-0 end-0 h-full w-full max-w-md sm:max-w-lg border-s border-border',
    start: 'inset-y-0 start-0 h-full w-full max-w-md sm:max-w-lg border-e border-border',
    bottom: 'inset-x-0 bottom-0 max-h-[85vh] w-full border-t border-border rounded-t-2xl',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-bg/80 backdrop-blur-sm transition-opacity duration-200"
        onClick={() => context.onOpenChange(false)}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div
        className={`fixed z-10 bg-surface text-text shadow-2xl flex flex-col transition-transform duration-200 overflow-y-auto ${positionStyles[side]} ${className}`}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

export function DrawerHeader({
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`p-5 border-b border-border flex items-center justify-between gap-3 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function DrawerTitle({
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={`text-lg font-semibold text-text ${className}`} {...props}>
      {children}
    </h2>
  );
}

export function DrawerClose({
  asChild = false,
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const context = React.useContext(DrawerContext);
  if (!context) throw new Error('DrawerClose must be used within Drawer');

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      onClick?: React.MouseEventHandler;
    }>;
    return React.cloneElement(child, {
      onClick: (e: React.MouseEvent) => {
        child.props.onClick?.(e);
        context.onOpenChange(false);
      },
    });
  }

  return (
    <button
      type="button"
      onClick={() => context.onOpenChange(false)}
      className={className}
      {...props}
    >
      {children}
    </button>
  );
}
