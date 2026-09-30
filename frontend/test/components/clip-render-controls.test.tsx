import {
  BulkRenderControls,
  ClipRenderControls,
} from '@/components/videos/clip-render-controls';
import type { Clip, ClipRender } from '@/lib/api';
import { fireEvent, render, screen } from '@testing-library/react';

const clip: Clip = {
  id: 'clip-1',
  videoId: 'video-1',
  title: 'Takeaway',
  startSec: 10,
  endSec: 30,
  source: 'AI',
  createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-29T10:00:00.000Z',
};

function clipRender(overrides: Partial<ClipRender> = {}): ClipRender {
  return {
    id: 'render-1',
    clipId: 'clip-1',
    status: 'PENDING',
    progress: 0,
    attempts: 0,
    error: null,
    startSec: 10,
    endSec: 30,
    outputUrl: null,
    subtitles: false,
    subtitleStyle: null,
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T10:00:00.000Z',
    ...overrides,
  };
}

function renderControls(
  renderRecord: ClipRender | undefined,
  overrides: {
    busy?: boolean;
    burnSubtitles?: boolean;
    subtitlesAvailable?: boolean;
  } = {},
) {
  const handlers = {
    onPreview: jest.fn(),
    onRender: jest.fn(),
    onRetry: jest.fn(),
    onDownload: jest.fn(),
    onToggleSubtitles: jest.fn(),
  };
  render(
    <ClipRenderControls
      burnSubtitles={overrides.burnSubtitles ?? false}
      busy={overrides.busy ?? false}
      clip={clip}
      render={renderRecord}
      subtitlesAvailable={overrides.subtitlesAvailable ?? true}
      {...handlers}
    />,
  );
  return handlers;
}

const bulkToggleProps = {
  burnSubtitles: false,
  hasClipOverrides: false,
  subtitlesAvailable: true,
  onToggleSubtitles: jest.fn(),
};

describe('ClipRenderControls', () => {
  it('offers to render and preview a clip that was never rendered', () => {
    const handlers = renderControls(undefined);

    expect(screen.getByRole('status')).toHaveTextContent('Not rendered');
    fireEvent.click(screen.getByRole('button', { name: 'Render 9:16' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview 9:16' }));

    expect(handlers.onRender).toHaveBeenCalledTimes(1);
    expect(handlers.onPreview).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: 'Download 9:16' }),
    ).not.toBeInTheDocument();
  });

  it('shows progress and blocks a second render while one is running', () => {
    renderControls(clipRender({ status: 'RUNNING', progress: 30 }));

    expect(screen.getByRole('status')).toHaveTextContent('Rendering 30%');
    expect(screen.getByRole('button', { name: 'Rendering' })).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Render 9:16' }),
    ).not.toBeInTheDocument();
  });

  it('shows a queued render as queued', () => {
    renderControls(clipRender());

    expect(screen.getByRole('status')).toHaveTextContent('Queued');
  });

  it('offers the download once the render is complete', () => {
    const handlers = renderControls(
      clipRender({ status: 'COMPLETED', progress: 100 }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('Ready');
    fireEvent.click(screen.getByRole('button', { name: 'Download 9:16' }));

    expect(handlers.onDownload).toHaveBeenCalledTimes(1);
  });

  it('shows the failure and retries the failed render', () => {
    const handlers = renderControls(
      clipRender({ status: 'FAILED', error: 'Timed out waiting for the reel' }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('Failed');
    expect(
      screen.getByText('Timed out waiting for the reel'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry render' }));

    expect(handlers.onRetry).toHaveBeenCalledWith('render-1');
  });

  it('treats a render for an old range as not rendered', () => {
    renderControls(
      clipRender({ status: 'COMPLETED', startSec: 5, endSec: 30 }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('Not rendered');
    expect(
      screen.queryByRole('button', { name: 'Download 9:16' }),
    ).not.toBeInTheDocument();
  });

  it('disables actions while a request for the clip is in flight', () => {
    renderControls(undefined, { busy: true });

    expect(
      screen.getByRole('button', { name: 'Starting render' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview 9:16' })).toBeDisabled();
  });
});

describe('ClipRenderControls subtitle toggle', () => {
  it('lets the user turn subtitles on for one clip', () => {
    const handlers = renderControls(undefined);
    const toggle = screen.getByRole('checkbox', { name: 'Burn in subtitles' });

    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    expect(handlers.onToggleSubtitles).toHaveBeenCalledWith(true);
  });

  it('shows the toggle as on and lets the user turn it off', () => {
    const handlers = renderControls(undefined, { burnSubtitles: true });
    const toggle = screen.getByRole('checkbox', { name: 'Burn in subtitles' });

    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    expect(handlers.onToggleSubtitles).toHaveBeenCalledWith(false);
  });

  it('disables the toggle and explains why before the video is transcribed', () => {
    renderControls(undefined, { subtitlesAvailable: false });

    expect(
      screen.getByRole('checkbox', { name: 'Burn in subtitles' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Transcribe the video to burn in subtitles.'),
    ).toBeInTheDocument();
  });

  it('keeps the toggle usable while a render is running', () => {
    renderControls(clipRender({ status: 'RUNNING', progress: 30 }));

    expect(
      screen.getByRole('checkbox', { name: 'Burn in subtitles' }),
    ).toBeEnabled();
  });
});

describe('BulkRenderControls', () => {
  const summary = { total: 4, ready: 1, active: 1, failed: 1, pending: 1 };

  it('renders every clip on request and summarises progress', () => {
    const onRenderAll = jest.fn();
    render(
      <BulkRenderControls
        {...bulkToggleProps}
        busy={false}
        onRenderAll={onRenderAll}
        summary={summary}
      />,
    );

    expect(
      screen.getByText('1 of 4 ready · 1 rendering · 1 failed'),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Render all clips (9:16)' }),
    );

    expect(onRenderAll).toHaveBeenCalledTimes(1);
  });

  it('is disabled while the request is being sent', () => {
    render(
      <BulkRenderControls
        {...bulkToggleProps}
        busy
        onRenderAll={jest.fn()}
        summary={summary}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Starting renders' }),
    ).toBeDisabled();
  });

  it('is disabled when every clip is already rendered or rendering', () => {
    render(
      <BulkRenderControls
        {...bulkToggleProps}
        busy={false}
        onRenderAll={jest.fn()}
        summary={{ total: 2, ready: 1, active: 1, failed: 0, pending: 0 }}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Render all clips (9:16)' }),
    ).toBeDisabled();
  });

  it('renders nothing when there are no clips', () => {
    const { container } = render(
      <BulkRenderControls
        {...bulkToggleProps}
        busy={false}
        onRenderAll={jest.fn()}
        summary={{ total: 0, ready: 0, active: 0, failed: 0, pending: 0 }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('toggles subtitles for every clip', () => {
    const onToggleSubtitles = jest.fn();
    render(
      <BulkRenderControls
        {...bulkToggleProps}
        busy={false}
        onRenderAll={jest.fn()}
        onToggleSubtitles={onToggleSubtitles}
        summary={summary}
      />,
    );

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Burn in subtitles for all clips' }),
    );

    expect(onToggleSubtitles).toHaveBeenCalledWith(true);
  });

  it('says when some clips use edited subtitle text', () => {
    render(
      <BulkRenderControls
        {...bulkToggleProps}
        busy={false}
        hasClipOverrides={false}
        hasEditedClips
        onRenderAll={jest.fn()}
        summary={summary}
      />,
    );

    expect(
      screen.getByText('Some clips use edited subtitle text.'),
    ).toBeInTheDocument();
  });

  it('says when some clips use their own subtitle setting', () => {
    render(
      <BulkRenderControls
        {...bulkToggleProps}
        busy={false}
        hasClipOverrides
        onRenderAll={jest.fn()}
        summary={summary}
      />,
    );

    expect(
      screen.getByText('Some clips use their own subtitle setting.'),
    ).toBeInTheDocument();
  });

  it('disables the global toggle without a transcript', () => {
    render(
      <BulkRenderControls
        {...bulkToggleProps}
        busy={false}
        onRenderAll={jest.fn()}
        subtitlesAvailable={false}
        summary={summary}
      />,
    );

    expect(
      screen.getByRole('checkbox', { name: 'Burn in subtitles for all clips' }),
    ).toBeDisabled();
  });
});
