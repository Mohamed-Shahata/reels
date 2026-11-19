'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { SparklesIcon } from '@/components/ui/icons';
import { formatClock } from '@/lib/trimmer';
import type { TranscriptSegment } from '@/lib/api';

interface SubtitleCueItem {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

interface ClipSubtitleEditorProps {
  subtitlesEnabled: boolean;
  onSubtitlesToggle: (enabled: boolean) => void;
  subtitleStyle: string;
  onStyleChange: (style: string) => void;
  segments: TranscriptSegment[];
  startSec: number;
  endSec: number;
  onUpdateCueText?: (segmentId: string, newText: string) => void;
}

export function ClipSubtitleEditor({
  subtitlesEnabled,
  onSubtitlesToggle,
  subtitleStyle,
  onStyleChange,
  segments,
  startSec,
  endSec,
  onUpdateCueText,
}: ClipSubtitleEditorProps) {
  const { t } = useLanguage();

  // Filter segments that fall within this clip's time range
  const clipCues: SubtitleCueItem[] = segments
    .filter((s) => s.endSec > startSec && s.startSec < endSec)
    .map((s) => ({
      id: s.id,
      startSec: Math.max(startSec, s.startSec),
      endSec: Math.min(endSec, s.endSec),
      text: s.text,
    }));

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface/50 p-4">
      {/* Toggle Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SparklesIcon className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-text">
            {t('workspace.subtitlesToggle')}
          </span>
        </div>
        <Switch
          checked={subtitlesEnabled}
          onCheckedChange={onSubtitlesToggle}
          aria-label={t('workspace.subtitlesToggle')}
        />
      </div>

      {subtitlesEnabled && (
        <div className="space-y-4 pt-1">
          {/* Style Presets */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'modern', label: t('workspace.styleModern') },
              { id: 'classic', label: t('workspace.styleClassic') },
              { id: 'karaoke', label: t('workspace.styleKaraoke') },
            ].map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onStyleChange(preset.id)}
                className={`p-2 rounded-lg border text-center text-xs transition-all ${
                  subtitleStyle === preset.id
                    ? 'border-accent bg-accent-soft text-accent font-semibold shadow-xs'
                    : 'border-border bg-surface-2 text-muted hover:bg-surface'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Subtitle Cue Lines List */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-muted uppercase tracking-wider block">
              Subtitle Lines ({clipCues.length})
            </label>

            {clipCues.length === 0 ? (
              <p className="text-xs text-muted py-2 italic text-center">
                {t('clips.noSpeech')}
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-2 pe-1">
                {clipCues.map((cue) => (
                  <div
                    key={cue.id}
                    className="flex items-center gap-2 p-2 rounded-lg border border-border bg-surface-2/60 text-xs"
                  >
                    <span className="font-mono text-[10px] text-muted shrink-0">
                      {formatClock(cue.startSec)}
                    </span>
                    <Input
                      defaultValue={cue.text}
                      key={`${cue.id}-${cue.text}`}
                      onBlur={(e) =>
                        onUpdateCueText?.(cue.id, e.target.value.trim())
                      }
                      className="h-7 text-xs px-2 flex-1 border-border/60 bg-surface"
                      placeholder="Line text"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
