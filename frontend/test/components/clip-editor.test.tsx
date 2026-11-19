import { ClipEditorDrawer } from '@/components/videos/clip-editor-drawer';
import { ClipTrimSlider } from '@/components/videos/clip-trim-slider';
import { ClipSubtitleEditor } from '@/components/videos/clip-subtitle-editor';
import { ClipPreviewPlayer } from '@/components/videos/clip-preview-player';
import type { Clip, ReframePlan, TranscriptSegment } from '@/lib/api';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockClip: Clip = {
  id: 'clip-1',
  videoId: 'video-1',
  title: 'Epic Podcast Hook',
  startSec: 10,
  endSec: 45,
  source: 'AI',
  layout: 'AUTO',
  createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-29T10:00:00.000Z',
};

const mockReframePlan: ReframePlan = {
  id: 'rf-1',
  videoId: 'video-1',
  version: 1,
  contentType: 'PODCAST',
  faces: [{ timeSec: 15, box: { x: 0.25, w: 0.2 } }],
  speakerTurns: [{ startSec: 10, endSec: 30, speaker: 'Speaker 1' }],
  createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-29T10:00:00.000Z',
};

const mockSegments: TranscriptSegment[] = [
  { id: 's1', startSec: 10, endSec: 25, text: 'First line of speech' },
  { id: 's2', startSec: 25, endSec: 45, text: 'Second line of speech' },
];

describe('ClipTrimSlider', () => {
  it('displays start and end timecodes and duration badge', () => {
    const onRangeChange = jest.fn();
    render(
      <ClipTrimSlider
        startSec={10}
        endSec={45}
        onRangeChange={onRangeChange}
      />,
    );

    expect(screen.getByDisplayValue('00:10')).toBeInTheDocument();
    expect(screen.getByDisplayValue('00:45')).toBeInTheDocument();
    expect(screen.getByText('35s')).toBeInTheDocument();
  });
});

describe('ClipSubtitleEditor', () => {
  it('renders subtitle presets and cue text inputs', () => {
    const onToggle = jest.fn();
    const onStyleChange = jest.fn();

    render(
      <ClipSubtitleEditor
        subtitlesEnabled={true}
        onSubtitlesToggle={onToggle}
        subtitleStyle="modern"
        onStyleChange={onStyleChange}
        segments={mockSegments}
        startSec={10}
        endSec={45}
      />,
    );

    expect(screen.getByDisplayValue('First line of speech')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Second line of speech')).toBeInTheDocument();

    const classicBtn = screen.getByRole('button', { name: /Classic/i });
    fireEvent.click(classicBtn);
    expect(onStyleChange).toHaveBeenCalledWith('classic');
  });
});

describe('ClipPreviewPlayer', () => {
  it('renders 9:16 aspect container and live caption overlay', () => {
    render(
      <ClipPreviewPlayer
        videoPlaybackUrl="https://cdn.test/video.mp4"
        startSec={10}
        endSec={45}
        reframePlan={mockReframePlan}
        layout="AUTO"
        subtitlesEnabled={true}
        subtitleStyle="modern"
        activeCaption="Active Subtitle Line"
      />,
    );

    expect(screen.getByText('Active Subtitle Line')).toBeInTheDocument();
    expect(screen.getByLabelText('Toggle preview playback')).toBeInTheDocument();
  });

  it('renders dual stacked streams for STACKED layout', () => {
    const { container } = render(
      <ClipPreviewPlayer
        videoPlaybackUrl="https://cdn.test/video.mp4"
        startSec={10}
        endSec={45}
        reframePlan={mockReframePlan}
        layout="STACKED"
        subtitlesEnabled={false}
        subtitleStyle="classic"
      />,
    );

    const videos = container.querySelectorAll('video');
    expect(videos.length).toBe(2);
  });
});

describe('ClipEditorDrawer', () => {
  it('renders full drawer with title, layout buttons, save and export', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onExport = jest.fn();
    const onClose = jest.fn();

    render(
      <ClipEditorDrawer
        isOpen={true}
        onClose={onClose}
        clip={mockClip}
        videoPlaybackUrl="https://cdn.test/video.mp4"
        reframePlan={mockReframePlan}
        contentType="PODCAST"
        transcriptSegments={mockSegments}
        onSave={onSave}
        onExport={onExport}
      />,
    );

    expect(screen.getByDisplayValue('Epic Podcast Hook')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Auto/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stacked/i })).toBeInTheDocument();

    // Click Save
    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'clip-1',
          title: 'Epic Podcast Hook',
        }),
      );
    });

    // Click Export
    const exportBtn = screen.getByRole('button', { name: /Export/i });
    fireEvent.click(exportBtn);
    expect(onExport).toHaveBeenCalledWith(mockClip);
  });
});
