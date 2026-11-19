import VideoWorkspacePage from '@/app/videos/[id]/page';
import { api, type Clip, type VideoDetails, type Transcript } from '@/lib/api';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

let mockSearch = '';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'video-1' }),
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

jest.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'authenticated' }),
}));

jest.mock('@/components/layout/app-header', () => ({
  AppHeader: () => <div data-testid="app-header" />,
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return {
    ...actual,
    api: {
      getVideo: jest.fn(),
      getVideos: jest.fn(),
      getClips: jest.fn(),
      getVideoPlaybackUrl: jest.fn(),
      getVideoProcessingJobs: jest.fn(),
      getVideoTranscript: jest.fn(),
      getVideoReframePlan: jest.fn(),
      getUsage: jest.fn(),
      getVideoRenders: jest.fn(),
      updateClip: jest.fn(),
      deleteClip: jest.fn(),
      retryJob: jest.fn(),
      getTranscriptExportUrl: jest.fn(
        (id: string, format: string) => `/api/v1/videos/${id}/transcript.${format}`,
      ),
    },
  };
});

const video: VideoDetails = {
  id: 'video-1',
  title: 'Episode one',
  cloudinaryId: null,
  durationSec: 600,
  sizeBytes: null,
  status: 'READY',
  createdAt: '2026-09-29T10:00:00.000Z',
  pipeline: [
    { stage: 'INGEST', status: 'COMPLETED', progress: 100, errorCode: null, jobId: 'j1' },
    { stage: 'TRANSCRIBE', status: 'COMPLETED', progress: 100, errorCode: null, jobId: 'j2' },
    { stage: 'SEGMENT', status: 'COMPLETED', progress: 100, errorCode: null, jobId: 'j3' },
    { stage: 'ANALYZE', status: 'COMPLETED', progress: 100, errorCode: null, jobId: 'j4' },
  ],
  mediaAssets: [],
};

const aiClip: Clip = {
  id: 'clip-1',
  videoId: 'video-1',
  title: 'Hook one',
  startSec: 10,
  endSec: 40,
  source: 'AI',
  createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-29T10:00:00.000Z',
};

const transcript: Transcript = {
  id: 'transcript-1',
  videoId: 'video-1',
  language: 'ar',
  segments: [{ id: 's1', startSec: 100, endSec: 112.2, text: 'A sentence' }],
};

beforeAll(() => {
  window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = jest.fn();
  window.Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  mockSearch = '';
  window.history.replaceState(null, '', '/');
  jest.mocked(api.getVideo).mockResolvedValue(video);
  jest.mocked(api.getVideos).mockResolvedValue([video]);
  jest.mocked(api.getClips).mockResolvedValue([aiClip]);
  jest
    .mocked(api.getVideoPlaybackUrl)
    .mockResolvedValue({ url: 'https://cdn.test/episode.mp4' });
  jest.mocked(api.getVideoTranscript).mockResolvedValue(transcript);
  jest.mocked(api.getVideoReframePlan).mockResolvedValue({
    id: 'rf-1',
    videoId: 'video-1',
    version: 1,
    contentType: 'SOLO',
    faces: [],
    speakerTurns: [],
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T10:00:00.000Z',
  });
  jest.mocked(api.getVideoRenders).mockResolvedValue([]);
  window.open = jest.fn();
});

async function renderWorkspace() {
  render(<VideoWorkspacePage />);
  await screen.findByText('Episode one');
}

describe('VideoWorkspacePage', () => {
  it('renders header, video title, pipeline stepper, and default clips tab', async () => {
    await renderWorkspace();

    expect(screen.getByTestId('app-header')).toBeInTheDocument();
    expect(screen.getByText('Episode one')).toBeInTheDocument();

    // Tabs
    expect(screen.getByRole('tab', { name: /Clips/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: /Transcript/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    // Clips list
    expect(await screen.findByText('Hook one')).toBeInTheDocument();
  });

  it('switches between Clips and Transcript tabs', async () => {
    await renderWorkspace();

    const transcriptTab = screen.getByRole('tab', { name: /Transcript/i });
    fireEvent.click(transcriptTab);

    expect(transcriptTab).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('A sentence')).toBeInTheDocument();
  });

  it('opens Transcript tab directly from search params deep link', async () => {
    mockSearch = 'tab=transcript';
    await renderWorkspace();

    expect(screen.getByRole('tab', { name: /Transcript/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByText('A sentence')).toBeInTheDocument();
  });

  it('offers transcript downloads in SRT, VTT, and TXT formats', async () => {
    mockSearch = 'tab=transcript';
    await renderWorkspace();

    for (const format of ['SRT', 'VTT', 'TXT']) {
      const button = screen.getByRole('button', {
        name: `Download transcript ${format}`,
      });
      expect(button).toBeInTheDocument();
      fireEvent.click(button);
      expect(window.open).toHaveBeenCalledWith(
        `/api/v1/videos/video-1/transcript.${format.toLowerCase()}`,
        '_blank',
      );
    }
  });

  it('renames a clip from the clip card', async () => {
    jest.mocked(api.updateClip).mockResolvedValue({
      ...aiClip,
      title: 'Renamed hook',
    });

    await renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByLabelText('Rename Hook one');
    fireEvent.change(input, { target: { value: 'Renamed hook' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(api.updateClip).toHaveBeenCalledWith('clip-1', {
        title: 'Renamed hook',
      }),
    );
  });

  it('opens clip editor drawer when Trim button is clicked', async () => {
    await renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Trim' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hook one')).toBeInTheDocument();
  });

  it('opens export dialog when Download button is clicked', async () => {
    await renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Render/i })).toBeInTheDocument();
  });
});
