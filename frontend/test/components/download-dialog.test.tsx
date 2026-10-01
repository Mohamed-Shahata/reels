import { fireEvent, render, screen } from '@testing-library/react';
import {
  DownloadDialog,
  type DownloadDialogProps,
} from '@/components/videos/download-dialog';

const items = [
  { id: 'a', number: 1, title: 'Intro', length: '0:30', note: null },
  { id: 'b', number: 2, title: 'Second', length: '0:45', note: 'Will render' },
];

function setup(overrides: Partial<DownloadDialogProps> = {}) {
  const props: DownloadDialogProps = {
    open: true,
    phase: 'confirm',
    items,
    aspect: '9:16',
    onAspectChange: jest.fn(),
    subtitles: true,
    onSubtitlesChange: jest.fn(),
    subtitlesAvailable: true,
    fileName: 'My video - clips.zip',
    renderCount: 1,
    progressLabel: null,
    progress: null,
    skippedCount: 0,
    errorMessage: null,
    onConfirm: jest.fn(),
    onRetry: jest.fn(),
    onCancel: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
  render(<DownloadDialog {...props} />);
  return props;
}

describe('DownloadDialog', () => {
  it('summarises what will be downloaded', () => {
    setup();
    expect(screen.getByText('Download 2 clips')).toBeInTheDocument();
    expect(screen.getByText('ZIP file')).toBeInTheDocument();
    expect(screen.getByText('With subtitles')).toBeInTheDocument();
    expect(screen.getByText('Will render')).toBeInTheDocument();
    expect(
      screen.getByText(/1 clip has no subtitled reel yet/),
    ).toBeInTheDocument();
    expect(screen.getByText('My video - clips.zip')).toBeInTheDocument();
  });

  it('has the subtitles switch on by default and lets the user turn it off', () => {
    const props = setup();
    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(props.onSubtitlesChange).toHaveBeenCalledWith(false);
  });

  it('locks the switch for 16:9 and when subtitles are unavailable', () => {
    setup({ aspect: '16:9', renderCount: 0 });
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText('No subtitles')).toBeInTheDocument();
  });

  it('confirms the download', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows the loader and can be cancelled while working', () => {
    const props = setup({
      phase: 'working',
      progressLabel: 'Downloading 1 of 2',
      progress: { done: 1, total: 2 },
    });
    expect(screen.getByText('Downloading 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalled();
  });

  it('shows a big success state', () => {
    const props = setup({ phase: 'success', skippedCount: 1 });
    expect(screen.getByText('Download started')).toBeInTheDocument();
    expect(screen.getByText(/1 clip was skipped/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('shows the failure with a retry', () => {
    const props = setup({ phase: 'error', errorMessage: 'Network down' });
    expect(screen.getByRole('alert')).toHaveTextContent('Download failed');
    expect(screen.getByText('Network down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it('closes on Escape unless it is working', () => {
    const props = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
