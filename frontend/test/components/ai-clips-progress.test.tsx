import { render, screen } from '@testing-library/react';
import {
  AiClipsProgress,
  estimateAiProgress,
} from '@/components/videos/ai-clips-progress';

describe('AiClipsProgress', () => {
  it('renders nothing while idle', () => {
    render(<AiClipsProgress active={false} mode="FULL" />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows a progress bar while a run is active', () => {
    render(<AiClipsProgress active mode="HIGHLIGHTS" />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.getByText(/Finding important parts/)).toBeTruthy();
  });

  it('eases towards but never reaches 100%', () => {
    expect(estimateAiProgress(0)).toBe(0);
    expect(estimateAiProgress(25_000)).toBeGreaterThan(40);
    expect(estimateAiProgress(10 * 60_000)).toBeLessThanOrEqual(95);
  });
});
