import { SubtitleTextEditor } from '@/components/videos/subtitle-text-editor';
import { ApiError, api, type Clip, type ClipSubtitles } from '@/lib/api';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { ...actual.api, getClipSubtitles: jest.fn() },
  };
});

const getClipSubtitles = api.getClipSubtitles as jest.MockedFunction<
  typeof api.getClipSubtitles
>;

const clip: Clip = {
  id: 'clip-1',
  videoId: 'video-1',
  title: 'Takeaway',
  startSec: 10,
  endSec: 30,
  source: 'MANUAL',
  createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-29T10:00:00.000Z',
};

function subtitles(overrides: Partial<ClipSubtitles> = {}): ClipSubtitles {
  return {
    clipId: 'clip-1',
    language: 'ar',
    displayMode: 'PHRASE',
    startSec: 10,
    endSec: 30,
    durationSec: 20,
    timing: 'WORD',
    cues: [
      { index: 1, startSec: 0.5, endSec: 2, text: 'Hello there' },
      { index: 2, startSec: 2, endSec: 4, text: 'Second line' },
    ],
    ...overrides,
  };
}

function renderEditor(edits: { index: number; text: string }[] = []) {
  const onChange = jest.fn();
  render(<SubtitleTextEditor clip={clip} edits={edits} onChange={onChange} />);
  return onChange;
}

async function openEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit subtitle text' }));
  await screen.findByLabelText('Subtitle 1 text');
}

describe('SubtitleTextEditor', () => {
  beforeEach(() => {
    getClipSubtitles.mockReset();
    getClipSubtitles.mockResolvedValue(subtitles());
  });

  it('does not load the subtitles until the editor is opened', () => {
    renderEditor();

    expect(getClipSubtitles).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Edit subtitle text' }),
    ).toBeInTheDocument();
  });

  it('loads the cues of the clip and shows one field per cue', async () => {
    renderEditor();

    await openEditor();

    expect(getClipSubtitles).toHaveBeenCalledWith('clip-1', 'PHRASE');
    expect(screen.getByLabelText('Subtitle 1 text')).toHaveValue('Hello there');
    expect(screen.getByLabelText('Subtitle 2 text')).toHaveValue('Second line');
    expect(screen.getByText('0:00.5 to 0:02.0')).toBeInTheDocument();
  });

  it('applies only the lines that changed', async () => {
    const onChange = renderEditor();
    await openEditor();

    fireEvent.change(screen.getByLabelText('Subtitle 2 text'), {
      target: { value: 'Fixed line' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply text changes' }));

    expect(onChange).toHaveBeenCalledWith([{ index: 2, text: 'Fixed line' }]);
  });

  it('keeps apply disabled until something changed', async () => {
    renderEditor();
    await openEditor();

    expect(
      screen.getByRole('button', { name: 'Apply text changes' }),
    ).toBeDisabled();
  });

  it('hides a line that is cleared', async () => {
    const onChange = renderEditor();
    await openEditor();

    fireEvent.change(screen.getByLabelText('Subtitle 1 text'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply text changes' }));

    expect(onChange).toHaveBeenCalledWith([{ index: 1, text: '' }]);
  });

  it('starts from the applied edits and shows how many lines are edited', async () => {
    renderEditor([{ index: 2, text: 'Fixed line' }]);

    expect(screen.getByRole('status')).toHaveTextContent('1 edited');
    await openEditor();

    expect(screen.getByLabelText('Subtitle 2 text')).toHaveValue('Fixed line');
    expect(
      screen.getByRole('button', { name: 'Apply text changes' }),
    ).toBeDisabled();
  });

  it('discards unapplied changes', async () => {
    const onChange = renderEditor();
    await openEditor();

    fireEvent.change(screen.getByLabelText('Subtitle 1 text'), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(screen.getByLabelText('Subtitle 1 text')).toHaveValue('Hello there');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('resets every line back to the transcript', async () => {
    const onChange = renderEditor([{ index: 2, text: 'Fixed line' }]);
    await openEditor();

    fireEvent.click(
      screen.getByRole('button', { name: 'Reset to transcript' }),
    );

    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.getByLabelText('Subtitle 2 text')).toHaveValue('Second line');
  });

  it('limits the length of a line', async () => {
    renderEditor();
    await openEditor();

    expect(screen.getByLabelText('Subtitle 1 text')).toHaveAttribute(
      'maxlength',
      '200',
    );
  });

  it('warns when the timing is estimated', async () => {
    getClipSubtitles.mockResolvedValue(subtitles({ timing: 'ESTIMATED' }));
    renderEditor();

    await openEditor();

    expect(screen.getByText(/Timing for this clip is estimated/)).toBeVisible();
  });

  it('explains when the clip has no speech', async () => {
    getClipSubtitles.mockResolvedValue(subtitles({ cues: [], timing: 'NONE' }));
    renderEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Edit subtitle text' }));

    expect(
      await screen.findByText('This clip has no speech to subtitle.'),
    ).toBeInTheDocument();
  });

  it('shows the error with the reference id and lets the user retry', async () => {
    getClipSubtitles.mockRejectedValueOnce(
      new ApiError('Transcript is not ready.', 409, 'req-9'),
    );
    renderEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Edit subtitle text' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Transcript is not ready. Reference ID: req-9',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByLabelText('Subtitle 1 text')).toBeInTheDocument();
    expect(getClipSubtitles).toHaveBeenCalledTimes(2);
  });

  it('reuses the loaded cues when the editor is reopened', async () => {
    renderEditor();
    await openEditor();

    fireEvent.click(
      screen.getByRole('button', { name: 'Hide subtitle editor' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit subtitle text' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Subtitle 1 text')).toBeInTheDocument(),
    );
    expect(getClipSubtitles).toHaveBeenCalledTimes(1);
  });

  it('asks for the cues of the chosen layout', async () => {
    render(
      <SubtitleTextEditor
        clip={clip}
        displayMode="WORD"
        edits={[]}
        onChange={jest.fn()}
      />,
    );
    await openEditor();

    expect(getClipSubtitles).toHaveBeenCalledWith('clip-1', 'WORD');
  });
});
