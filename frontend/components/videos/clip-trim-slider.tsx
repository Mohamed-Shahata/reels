'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import { formatClock, parseClock } from '@/lib/trimmer';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface ClipTrimSliderProps {
  startSec: number;
  endSec: number;
  maxDurationSec?: number;
  onRangeChange: (start: number, end: number) => void;
}

export function ClipTrimSlider({
  startSec,
  endSec,
  maxDurationSec = 600,
  onRangeChange,
}: ClipTrimSliderProps) {
  const { t } = useLanguage();

  const duration = Math.max(0, endSec - startSec);
  const startPercent = Math.max(0, Math.min(100, (startSec / maxDurationSec) * 100));
  const endPercent = Math.max(0, Math.min(100, (endSec / maxDurationSec) * 100));

  const handleStartChange = (val: string) => {
    const parsed = parseClock(val);
    if (parsed !== null && parsed < endSec) {
      onRangeChange(parsed, endSec);
    }
  };

  const handleEndChange = (val: string) => {
    const parsed = parseClock(val);
    if (parsed !== null && parsed > startSec) {
      onRangeChange(startSec, parsed);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-muted uppercase tracking-wider">
          Trim Range
        </label>
        <Badge variant="muted" className="text-xs">
          {Math.round(duration)}s
        </Badge>
      </div>

      {/* Visual Timeline Bar */}
      <div className="relative h-6 w-full rounded-lg bg-surface border border-border p-1 flex items-center select-none">
        {/* Active Range Highlight */}
        <div
          className="absolute h-4 rounded bg-accent/30 border border-accent/60"
          style={{
            left: `${startPercent}%`,
            width: `${Math.max(2, endPercent - startPercent)}%`,
          }}
        />

        {/* Start Handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-5 rounded-xs bg-accent shadow-sm cursor-ew-resize -translate-x-1/2"
          style={{ left: `${startPercent}%` }}
          title={`Start: ${formatClock(startSec)}`}
        />

        {/* End Handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-5 rounded-xs bg-accent shadow-sm cursor-ew-resize -translate-x-1/2"
          style={{ left: `${endPercent}%` }}
          title={`End: ${formatClock(endSec)}`}
        />
      </div>

      {/* Timecode Inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="text-[11px] text-muted block mb-1">
            {t('trimmer.startTimecode')}
          </span>
          <Input
            defaultValue={formatClock(startSec)}
            key={`start-${startSec}`}
            onBlur={(e) => handleStartChange(e.target.value)}
            placeholder="00:00"
            className="font-mono text-center h-8 text-xs"
            aria-label="Start timecode"
          />
        </div>
        <div>
          <span className="text-[11px] text-muted block mb-1">
            {t('trimmer.endTimecode')}
          </span>
          <Input
            defaultValue={formatClock(endSec)}
            key={`end-${endSec}`}
            onBlur={(e) => handleEndChange(e.target.value)}
            placeholder="00:00"
            className="font-mono text-center h-8 text-xs"
            aria-label="End timecode"
          />
        </div>
      </div>
    </div>
  );
}
