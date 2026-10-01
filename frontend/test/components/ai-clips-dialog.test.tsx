import { AiClipsDialog } from '@/components/videos/ai-clips-dialog';
import { fireEvent, render, screen } from '@testing-library/react';

function renderDialog(
  overrides: Partial<Parameters<typeof AiClipsDialog>[0]> = {},
) {
  const handlers = {
    onModeChange: jest.fn(),
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
  };
  render(
    <AiClipsDialog
      existingAiClips={0}
      mode="FULL"
      open
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('AiClipsDialog', () => {
  it('renders nothing while closed', () => {
    renderDialog({ open: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers the whole podcast or only the important parts', () => {
    renderDialog();

    expect(
      screen.getByRole('radio', { name: /The whole podcast/ }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('radio', { name: /Important parts only/ }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('reports the chosen mode and confirms', () => {
    const handlers = renderDialog();

    fireEvent.click(
      screen.getByRole('radio', { name: /Important parts only/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate clips' }));

    expect(handlers.onModeChange).toHaveBeenCalledWith('HIGHLIGHTS');
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('warns that existing AI clips are replaced', () => {
    renderDialog({ existingAiClips: 4 });

    expect(
      screen.getByText(/replaces your 4 current AI clips/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Replace and generate' }),
    ).toBeInTheDocument();
  });

  it('cancels with the button and with Escape', () => {
    const handlers = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(handlers.onCancel).toHaveBeenCalledTimes(2);
  });

  it('locks the controls while generating', () => {
    renderDialog({ busy: true });

    expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(
      screen.getByRole('radio', { name: /The whole podcast/ }),
    ).toBeDisabled();
  });
});
