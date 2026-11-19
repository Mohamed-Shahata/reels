'use client';

import { useState, useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { api, type Transcript } from '@/lib/api';
import { formatClock } from '@/lib/trimmer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { FileTextIcon, DownloadIcon, SearchIcon } from '@/components/ui/icons';

interface TranscriptPanelProps {
  videoId: string;
  transcript: Transcript | null;
  currentTimeSec?: number;
  onSeek?: (sec: number) => void;
}

export function TranscriptPanel({
  videoId,
  transcript,
  currentTimeSec = 0,
  onSeek,
}: TranscriptPanelProps) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');

  const segments = useMemo(() => transcript?.segments ?? [], [transcript]);

  const filteredSegments = useMemo(() => {
    if (!searchQuery.trim()) return segments;
    const query = searchQuery.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(query));
  }, [segments, searchQuery]);

  if (!transcript || segments.length === 0) {
    return (
      <EmptyState
        icon={<FileTextIcon className="w-8 h-8" />}
        title={t('workspace.transcriptTab')}
        description={t('workspace.noTranscript')}
        className="py-12 border border-dashed border-border rounded-xl"
      />
    );
  }

  const handleDownload = (format: 'srt' | 'vtt' | 'txt') => {
    const url = api.getTranscriptExportUrl(videoId, format);
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-4">
      {/* Search and Export Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('workspace.searchTranscript')}
            className="ps-9 h-9"
          />
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto">
          {(['srt', 'vtt', 'txt'] as const).map((fmt) => (
            <Button
              key={fmt}
              variant="outline"
              size="sm"
              onClick={() => handleDownload(fmt)}
              className="h-8 text-xs uppercase"
              aria-label={`Download transcript ${fmt.toUpperCase()}`}
            >
              <DownloadIcon className="w-3 h-3 me-1" />
              <span>{fmt}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Segments List */}
      <div className="max-h-[500px] overflow-y-auto space-y-2 rounded-xl border border-border bg-card p-4">
        {filteredSegments.map((segment) => {
          const isCurrent =
            currentTimeSec >= segment.startSec &&
            currentTimeSec <= segment.endSec;

          return (
            <div
              key={segment.id}
              className={`p-2.5 rounded-lg transition-colors flex items-start gap-3 text-sm ${
                isCurrent
                  ? 'bg-primary/10 border border-primary/20'
                  : 'hover:bg-muted/40'
              }`}
            >
              <button
                type="button"
                onClick={() => onSeek?.(segment.startSec)}
                className="font-mono text-xs text-primary hover:underline shrink-0 mt-0.5"
                title={`Seek to ${formatClock(segment.startSec)}`}
              >
                {formatClock(segment.startSec)}
              </button>
              <p className="text-foreground leading-relaxed flex-1 select-text">
                {segment.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
