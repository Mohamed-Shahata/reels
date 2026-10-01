import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { VideoStage } from '@/components/videos/video-stage';

function setup(overrides: Partial<Parameters<typeof VideoStage>[0]> = {}) {
  return render(
    <VideoStage
      caption={null}
      currentTime={0}
      durationSec={60}
      frame="vertical"
      isEpisode
      liveHook={0}
      onBackToEpisode={() => undefined}
      onFrameChange={() => undefined}
      onLoadedMetadata={() => undefined}
      onSeek={() => undefined}
      onTimeUpdate={() => undefined}
      playerRef={createRef()}
      sourceUrl="/video.mp4"
      {...overrides}
    />,
  );
}

describe('VideoStage guides', () => {
  it('starts with no guide active and keeps only one active at a time', () => {
    setup();
    const names = ['TikTok guides', 'Instagram guides', 'Facebook guides'];
    for (const name of names) {
      expect(screen.getByRole('button', { name })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }

    fireEvent.click(screen.getByRole('button', { name: 'TikTok guides' }));
    fireEvent.click(screen.getByRole('button', { name: 'Instagram guides' }));
    expect(
      screen.getByRole('button', { name: 'TikTok guides' }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByRole('button', { name: 'Instagram guides' }),
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Instagram guides' }));
    expect(
      screen.getByRole('button', { name: 'Instagram guides' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the subtitle toggle state', () => {
    const onToggle = jest.fn();
    setup({ onSubtitlesToggle: onToggle, subtitlesOn: false });
    const toggle = screen.getByRole('button', {
      name: 'Show subtitles on stage',
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
