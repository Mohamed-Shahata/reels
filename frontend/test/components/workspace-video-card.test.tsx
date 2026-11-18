import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoCard } from '@/components/workspace/video-card';
import type { LibrarySummary } from '@/lib/api';

const mockVideo: LibrarySummary = {
  id: 'video-123',
  title: 'My Podcast Episode #1',
  cloudinaryId: null,
  status: 'READY',
  durationSec: 125,
  sizeBytes: '10485760',
  reelCount: 4,
  thumbnailUrl: '/thumb.jpg',
  createdAt: '2026-11-18T10:00:00.000Z',
  clipCount: 4,
  transcriptReady: true,
  transcriptionState: 'COMPLETED',
  transcriptionProgress: 100,
  failureReason: null,
};

describe('VideoCard (Workspace)', () => {
  it('renders video details, duration, reel count, and status badge', () => {
    render(
      <VideoCard
        video={mockVideo}
        mode="view"
        draftTitle=""
        busy={false}
        onDraftChange={jest.fn()}
        onBeginRename={jest.fn()}
        onCancel={jest.fn()}
        onSaveRename={jest.fn()}
        onBeginDelete={jest.fn()}
        onConfirmDelete={jest.fn()}
      />,
    );

    expect(screen.getByText('My Podcast Episode #1')).toBeInTheDocument();
    expect(screen.getByText('2:05')).toBeInTheDocument();
    expect(screen.getByText(/4\s+reels/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open editor/i })).toBeInTheDocument();
  });

  it('renders renaming form when mode is renaming', () => {
    const handleDraftChange = jest.fn();
    const handleSaveRename = jest.fn();
    render(
      <VideoCard
        video={mockVideo}
        mode="renaming"
        draftTitle="New Title"
        busy={false}
        onDraftChange={handleDraftChange}
        onBeginRename={jest.fn()}
        onCancel={jest.fn()}
        onSaveRename={handleSaveRename}
        onBeginDelete={jest.fn()}
        onConfirmDelete={jest.fn()}
      />,
    );

    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('New Title');
    fireEvent.change(input, { target: { value: 'Updated Title' } });
    expect(handleDraftChange).toHaveBeenCalledWith('Updated Title');

    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);
    expect(handleSaveRename).toHaveBeenCalled();
  });

  it('renders delete confirmation alert when mode is confirming-delete', () => {
    const handleConfirmDelete = jest.fn();
    render(
      <VideoCard
        video={mockVideo}
        mode="confirming-delete"
        draftTitle=""
        busy={false}
        onDraftChange={jest.fn()}
        onBeginRename={jest.fn()}
        onCancel={jest.fn()}
        onSaveRename={jest.fn()}
        onBeginDelete={jest.fn()}
        onConfirmDelete={handleConfirmDelete}
      />,
    );

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    const deleteBtn = screen.getByRole('button', { name: /delete/i });
    fireEvent.click(deleteBtn);
    expect(handleConfirmDelete).toHaveBeenCalled();
  });

  it('renders failure message and retry button when video has failed', () => {
    const failedVideo: LibrarySummary = {
      ...mockVideo,
      status: 'FAILED',
      failureReason: 'Audio stream corrupted',
    };

    render(
      <VideoCard
        video={failedVideo}
        mode="view"
        draftTitle=""
        busy={false}
        onDraftChange={jest.fn()}
        onBeginRename={jest.fn()}
        onCancel={jest.fn()}
        onSaveRename={jest.fn()}
        onBeginDelete={jest.fn()}
        onConfirmDelete={jest.fn()}
      />,
    );

    expect(screen.getByText('Audio stream corrupted')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /retry/i })).toBeInTheDocument();
  });
});
