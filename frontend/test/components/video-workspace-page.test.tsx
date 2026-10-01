import VideoWorkspacePage from '@/app/videos/[id]/page';
import { api, type Clip, type LibraryVideo, type Transcript } from '@/lib/api';
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
  AppHeader: () => null,
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return {
    ...actual,
    api: {
      getVideos: jest.fn(),
      getClips: jest.fn(),
      getVideoPlaybackUrl: jest.fn(),
      getVideoProcessingJobs: jest.fn(),
      getVideoTranscript: jest.fn(),
      getUsage: jest.fn(),
      getVideoRenders: jest.fn(),
      getSubtitleStyleCatalog: jest.fn(),
      createClip: jest.fn(),
      updateClip: jest.fn(),
    },
  };
});

const video: LibraryVideo = {
  id: 'video-1',
  title: 'Episode one',
  cloudinaryId: null,
  durationSec: 600,
  sizeBytes: null,
  status: 'READY',
  createdAt: '2026-09-29T10:00:00.000Z',
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
  window.HTMLMediaElement.prototype.play = jest
    .fn()
    .mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = jest.fn();
  window.Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  mockSearch = '';
  window.history.replaceState(null, '', '/');
  jest.mocked(api.getVideos).mockResolvedValue([video]);
  jest.mocked(api.getClips).mockResolvedValue([aiClip]);
  jest
    .mocked(api.getVideoPlaybackUrl)
    .mockResolvedValue({ url: 'https://cdn.test/episode.mp4' });
  jest.mocked(api.getVideoProcessingJobs).mockResolvedValue([]);
  jest.mocked(api.getVideoTranscript).mockResolvedValue(transcript);
  jest.mocked(api.getUsage).mockRejectedValue(new Error('no usage'));
  jest.mocked(api.getVideoRenders).mockResolvedValue([]);
  jest
    .mocked(api.getSubtitleStyleCatalog)
    .mockRejectedValue(new Error('no catalog'));
});

async function renderWorkspace() {
  render(<VideoWorkspacePage />);
  await screen.findByRole('tab', { name: /Clips & Export/ });
}

describe('video workspace tabs', () => {
  it('opens on Clips & Export with a single stage and no separate trimmer link', async () => {
    await renderWorkspace();

    expect(screen.getByRole('tab', { name: /Clips & Export/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: /Trim/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getAllByLabelText('Video stage')).toHaveLength(1);
    expect(screen.queryByText(/Timeline & Trimmer/)).not.toBeInTheDocument();
    // The Trim panel is hidden until its tab is chosen.
    expect(
      screen.queryByRole('tabpanel', { name: /Trim/ }),
    ).not.toBeInTheDocument();
  });

  it('opens the Trim tab from a deep link', async () => {
    mockSearch = 'tab=trim';
    await renderWorkspace();

    expect(screen.getByRole('tab', { name: /Trim/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel', { name: /Trim/ })).toBeInTheDocument();
  });

  it('opens the subtitle style editor as a popup from Clips & Export', async () => {
    await renderWorkspace();

    expect(screen.queryByRole('tab', { name: /Style Subtitles/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Subtitle style' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Style Subtitles',
    });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has no Transcript tab and offers transcript downloads instead', async () => {
    mockSearch = 'tab=transcript';
    await renderWorkspace();

    expect(screen.queryByRole('tab', { name: /^Transcript/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /Clips & Export/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    for (const format of ['SRT', 'VTT', 'TXT']) {
      expect(
        screen.getByRole('button', { name: `Download transcript ${format}` }),
      ).toBeInTheDocument();
    }
  });

  it('offers Extract Transcript on the clips tab while there is no transcript', async () => {
    jest.mocked(api.getVideoTranscript).mockRejectedValue(new Error('none'));
    await renderWorkspace();

    expect(
      await screen.findByRole('button', { name: 'Extract Transcript' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Clips & Export/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('loads a clip into the trimmer from the clips list', async () => {
    await renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Trim' }));

    expect(screen.getByRole('tab', { name: /Trim/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Start timecode')).toHaveValue('00:10');
    expect(screen.getByLabelText('End timecode')).toHaveValue('00:40');
    expect(screen.getByLabelText(/Clip title/)).toHaveValue('Hook one');
    expect(window.location.search).toBe('?tab=trim');
  });

  it('shares saved clips between both tabs', async () => {
    jest.mocked(api.createClip).mockResolvedValue({
      ...aiClip,
      id: 'clip-2',
      title: 'Fresh cut',
      startSec: 100,
      endSec: 130,
      source: 'MANUAL',
    });
    await renderWorkspace();

    fireEvent.click(screen.getByRole('tab', { name: /Trim/ }));
    fireEvent.change(screen.getByLabelText(/Clip title/), {
      target: { value: 'Fresh cut' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save clip' }));

    await waitFor(() =>
      expect(api.createClip).toHaveBeenCalledWith('video-1', {
        title: 'Fresh cut',
        startSec: 10,
        endSec: 40,
      }),
    );

    fireEvent.click(screen.getByRole('tab', { name: /Clips & Export/ }));
    expect(
      await screen.findByRole('button', { name: 'Fresh cut' }),
    ).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('renames a clip from the clips list', async () => {
    jest.mocked(api.updateClip).mockResolvedValue({
      ...aiClip,
      title: 'Better title',
    });
    await renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByLabelText('Rename Hook one');
    fireEvent.change(input, { target: { value: 'Better title' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(api.updateClip).toHaveBeenCalledWith('clip-1', {
        title: 'Better title',
      }),
    );
    expect(
      await screen.findByRole('button', { name: 'Better title' }),
    ).toBeInTheDocument();
  });
});
