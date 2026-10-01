import NotFound from '@/app/not-found';
import {
  AlertBanner,
  ConfirmDialog,
  ToastProvider,
  useToast,
} from '@/components/feedback';
import { act, fireEvent, render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  usePathname: () => '/videos/missing',
  useRouter: () => ({ replace: jest.fn() }),
}));
jest.mock('@/components/layout/app-header', () => ({
  AppHeader: () => null,
}));

describe('AlertBanner', () => {
  it('announces errors and dismisses', () => {
    const onDismiss = jest.fn();
    render(
      <AlertBanner onDismiss={onDismiss} title="Render failed">
        Frame rate mismatch
      </AlertBanner>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Render failed');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  it('confirms, cancels on Escape, and renders nothing when closed', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { rerender } = render(
      <ConfirmDialog
        confirmLabel="Delete clip"
        onCancel={onCancel}
        onConfirm={onConfirm}
        open
        subject="سر كسب ثقة الجمهور"
        title="Delete this clip?"
      />,
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete clip' }));
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    rerender(
      <ConfirmDialog
        confirmLabel="Delete clip"
        onCancel={onCancel}
        onConfirm={onConfirm}
        open={false}
        title="Delete this clip?"
      />,
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('Toasts', () => {
  it('shows a toast and auto-dismisses it', () => {
    jest.useFakeTimers();
    function Trigger() {
      const toast = useToast();
      return (
        <button onClick={() => toast.show({ title: 'Clip saved' })}>go</button>
      );
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('go'));
    expect(screen.getByText('Clip saved')).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(4100);
    });
    expect(screen.queryByText('Clip saved')).not.toBeInTheDocument();
    jest.useRealTimers();
  });
});

describe('404 page', () => {
  it('explains the problem and links back to the workspace', () => {
    render(<NotFound />);
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.getByText('/videos/missing')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to workspace' }),
    ).toHaveAttribute('href', '/');
  });
});
