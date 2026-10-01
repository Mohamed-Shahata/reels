import { ClipCard } from '@/components/videos/clip-card';
import type { Clip } from '@/lib/api';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const clip: Clip = {
  id: 'clip-1',
  videoId: 'video-1',
  title: 'Hook one',
  startSec: 10,
  endSec: 40,
  source: 'AI',
  createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-29T10:00:00.000Z',
};

function renderCard(overrides: Partial<Parameters<typeof ClipCard>[0]> = {}) {
  const handlers = {
    onToggleSelect: jest.fn(),
    onPreview: jest.fn(),
    onSeek: jest.fn(),
    onTrim: jest.fn(),
    onDownload: jest.fn(),
    onDelete: jest.fn(),
    onRename: jest.fn().mockResolvedValue(true),
  };
  render(
    <ul>
      <ClipCard
        active={false}
        busy={false}
        clip={clip}
        hook
        score={94}
        selected={false}
        {...handlers}
        {...overrides}
      />
    </ul>,
  );
  return handlers;
}

describe('ClipCard', () => {
  it('shows the source badge, time range and duration', () => {
    renderCard();

    expect(screen.getByText('AI Hook 94%')).toBeInTheDocument();
    expect(screen.getByText('00:10 - 00:40')).toBeInTheDocument();
    expect(screen.getByText('30s')).toBeInTheDocument();
  });

  it('labels manual clips as manual segments', () => {
    renderCard({ clip: { ...clip, source: 'MANUAL' } });

    expect(screen.getByText('Manual Segment')).toBeInTheDocument();
  });

  it('renames the clip on Enter', async () => {
    const handlers = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByLabelText('Rename Hook one');
    fireEvent.change(input, { target: { value: '  New title ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(handlers.onRename).toHaveBeenCalledWith('New title'),
    );
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Rename Hook one'),
      ).not.toBeInTheDocument(),
    );
  });

  it('cancels a rename on Escape and keeps editing when saving fails', async () => {
    const handlers = renderCard({
      onRename: jest.fn().mockResolvedValue(false),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.keyDown(screen.getByLabelText('Rename Hook one'), {
      key: 'Escape',
    });
    expect(screen.queryByLabelText('Rename Hook one')).not.toBeInTheDocument();
    expect(handlers.onRename).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByLabelText('Rename Hook one');
    fireEvent.change(input, { target: { value: 'Other' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(input).toBeEnabled());
    expect(screen.getByLabelText('Rename Hook one')).toBeInTheDocument();
  });

  it('renders icon action buttons for Trim, Download and Delete', () => {
    renderCard();

    expect(screen.getByRole('button', { name: 'Trim' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Download' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});

describe('ClipCard number', () => {
  it('shows the place of the clip in the episode', () => {
    renderCard({ number: 3 });
    expect(screen.getByLabelText('Clip number 3')).toHaveTextContent('3');
  });
});
