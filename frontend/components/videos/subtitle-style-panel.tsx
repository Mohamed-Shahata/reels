'use client';

import type { SubtitleStyle, SubtitleStyleCatalog } from '@/lib/api';
import {
  FONT_STACKS,
  getPreviewTextStyle,
  isCustomized,
  type SubtitleSelection,
} from '@/lib/subtitle-style';

const PRESET_SAMPLE = 'أول ٧ ثواني تحدد';
const PRESET_SAMPLE_WORD = 'أول';

const POSITION_LABELS: Record<SubtitleStyle['position'], string> = {
  TOP: 'Top (start)',
  MIDDLE: 'Middle',
  BOTTOM: 'Bottom (end)',
};

// Where the bar sits inside the little phone icon of each position card.
const POSITION_ICON: Record<SubtitleStyle['position'], string> = {
  TOP: 'top-1.5',
  MIDDLE: 'top-1/2 -translate-y-1/2',
  BOTTOM: 'bottom-1.5',
};

const DISPLAY_MODE_OPTIONS: Record<
  SubtitleStyle['displayMode'],
  { label: string; hint: string }
> = {
  PHRASE: { label: 'Phrases', hint: 'A short line of a few words at a time.' },
  WORD: {
    label: 'Word by word',
    hint: 'One word at a time, in step with the speaker.',
  },
};

const FONT_SAMPLES: Record<SubtitleStyle['fontFamily'], string> = {
  Cairo: 'القاهرة',
  Amiri: 'الأميري',
  Arial: 'أريال',
};

const TEXT_SWATCHES = ['#ffffff', '#facc15', '#38bdf8', '#a3e635'];
const BOX_SWATCHES = ['#000000', '#111827', '#0f766e', '#450a0a'];
const SIZE_SHORTCUTS = [
  ['S', 28],
  ['M', 38],
  ['L', 52],
] as const;

const box = 'rounded-xl bg-[#f0f6f3] p-3';
const sectionTitle = 'text-sm font-semibold';

interface SubtitleStylePanelProps {
  catalog: SubtitleStyleCatalog | null;
  selection: SubtitleSelection | null;
  error: string | null;
  onChoosePreset: (presetId: string) => void;
  onChangeStyle: (patch: Partial<SubtitleStyle>) => void;
  onReset: () => void;
  /** Reverts to how the style was when the dialog opened; null hides it. */
  onUndo?: (() => void) | null;
  canUndo?: boolean;
  /** Called by "Save subtitle style"; the style itself is stored on change. */
  onSave?: () => void;
  onPreviewNext?: (() => void) | null;
}

function Swatches({
  colors,
  label,
  value,
  onPick,
}: {
  colors: string[];
  label: string;
  value: string;
  onPick: (color: string) => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      {colors.map((color) => (
        <button
          aria-label={`${label} ${color}`}
          aria-pressed={value.toLowerCase() === color}
          className={`h-6 w-6 rounded-full border-2 ${
            value.toLowerCase() === color
              ? 'border-[#0f766e] ring-2 ring-[#0f766e]/30'
              : 'border-[#d8e1dc]'
          }`}
          key={color}
          onClick={() => onPick(color)}
          style={{ backgroundColor: color }}
          type="button"
        />
      ))}
    </div>
  );
}

export function SubtitleStylePanel({
  catalog,
  selection,
  error,
  onChoosePreset,
  onChangeStyle,
  onReset,
  onUndo = null,
  canUndo = false,
  onSave,
  onPreviewNext = null,
}: SubtitleStylePanelProps) {
  if (error || !catalog || !selection) {
    return (
      <section className="rounded-2xl border border-[#e2eae6] bg-white p-4 shadow-[var(--shadow-surface)]">
        <h2 className="text-base font-semibold">Subtitle Styling</h2>
        {error ? (
          <p className="mt-2 text-sm text-[#a13d3d]" role="alert">
            {error}
          </p>
        ) : (
          <p className="mt-2 text-sm text-[#5d6d68]">
            Loading subtitle styles...
          </p>
        )}
      </section>
    );
  }

  const { style } = selection;
  const customized = isCustomized(catalog, selection);
  const { min, max } = catalog.fontSize;
  const clampSize = (px: number) => Math.min(max, Math.max(min, px));

  return (
    <section
      aria-label="Subtitle style"
      className="rounded-2xl border border-[#e2eae6] bg-white p-4 shadow-[var(--shadow-surface)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Subtitle Styling</h2>
          <p className="mt-1 text-xs text-[#5d6d68]">
            Typography, colors and position for burned-in Arabic vertical reels.
            The preview on the left updates live.
          </p>
        </div>
        {customized ? (
          <button
            className="h-8 shrink-0 rounded-lg border border-[#b8c7c1] px-2 text-xs font-semibold hover:bg-[#edf3f0]"
            onClick={onReset}
            type="button"
          >
            Reset to preset
          </button>
        ) : null}
      </div>

      <h3 className={`${sectionTitle} mt-5`}>Style Presets</h3>
      <div
        aria-label="Subtitle presets"
        className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"
        role="radiogroup"
      >
        {catalog.presets.map((preset) => {
          const active = preset.id === selection.presetId;
          return (
            <button
              aria-checked={active}
              className={`rounded-xl border p-2 text-left ${
                active
                  ? 'border-[#0f766e] bg-[#e3f2ef]'
                  : 'border-[#d8e1dc] hover:bg-[#edf3f0]'
              }`}
              key={preset.id}
              onClick={() => onChoosePreset(preset.id)}
              role="radio"
              type="button"
            >
              <span
                aria-hidden="true"
                className="flex h-14 items-center justify-center overflow-hidden rounded-lg bg-[#1f2b28]"
                style={{ containerType: 'inline-size' }}
              >
                <span
                  className="px-[4%] py-[1%]"
                  dir="rtl"
                  style={getPreviewTextStyle({
                    ...preset.style,
                    fontSizePx: 34,
                  })}
                >
                  {selection.style.displayMode === 'WORD'
                    ? PRESET_SAMPLE_WORD
                    : PRESET_SAMPLE}
                </span>
              </span>
              <span className="mt-2 block text-sm font-semibold">
                {preset.label}
              </span>
              <span className="block text-[11px] text-[#5d6d68]">
                {preset.description}
              </span>
            </button>
          );
        })}
      </div>
      {customized ? (
        <p className="mt-2 text-xs text-[#5d6d68]">
          Customized from the selected preset.
        </p>
      ) : null}

      <div className={`${box} mt-5`}>
        <h3 className={sectionTitle}>Typography</h3>
        <div
          aria-label="Font"
          className="mt-2 grid grid-cols-3 gap-2"
          role="radiogroup"
        >
          {catalog.fonts.map((font) => {
            const active = font === style.fontFamily;
            return (
              <button
                aria-checked={active}
                className={`rounded-lg px-2 py-2 text-center ${
                  active
                    ? 'bg-[#0f766e] text-white'
                    : 'bg-white/70 hover:bg-white'
                }`}
                key={font}
                onClick={() => onChangeStyle({ fontFamily: font })}
                role="radio"
                type="button"
              >
                <span
                  className="block text-base font-bold"
                  style={{ fontFamily: FONT_STACKS[font] }}
                >
                  {FONT_SAMPLES[font]}
                </span>
                <span className="block text-[10px]">{font}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className="grid gap-1 text-xs font-semibold">
              Size ({style.fontSizePx}px)
              <input
                className="accent-[#0f766e]"
                max={max}
                min={min}
                onChange={(event) =>
                  onChangeStyle({ fontSizePx: Number(event.target.value) })
                }
                step={1}
                type="range"
                value={style.fontSizePx}
              />
            </label>
            <div className="mt-1 flex gap-1">
              {SIZE_SHORTCUTS.map(([label, px]) => (
                <button
                  aria-label={`${label === 'S' ? 'Small' : label === 'M' ? 'Medium' : 'Large'} (${px}px)`}
                  className="rounded-md bg-white/70 px-2 py-0.5 text-[11px] font-semibold hover:bg-white"
                  key={label}
                  onClick={() => onChangeStyle({ fontSizePx: clampSize(px) })}
                  type="button"
                >
                  {label}: {px}
                </button>
              ))}
            </div>
          </div>
          <div
            aria-label="Weight"
            className="flex rounded-lg bg-white/70 p-0.5 text-xs font-semibold"
            role="radiogroup"
          >
            {(
              [
                ['Regular', false],
                ['Bold', true],
              ] as const
            ).map(([label, bold]) => (
              <button
                aria-checked={style.bold === bold}
                className={`rounded-md px-4 py-1.5 ${
                  style.bold === bold
                    ? 'bg-white text-[#0f766e] shadow-sm'
                    : 'text-[#5d6d68]'
                }`}
                key={label}
                onClick={() => onChangeStyle({ bold })}
                role="radio"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className={box}>
          <label className="flex items-center justify-between gap-2 text-xs font-semibold">
            Text color
            <input
              className="h-7 w-10 border border-[#b8c7c1] bg-white p-0.5"
              onChange={(event) =>
                onChangeStyle({ textColor: event.target.value })
              }
              type="color"
              value={style.textColor}
            />
          </label>
          <Swatches
            colors={TEXT_SWATCHES}
            label="Text color"
            onPick={(textColor) => onChangeStyle({ textColor })}
            value={style.textColor}
          />
        </div>
        <div className={box}>
          <label className="flex items-center justify-between gap-2 text-xs font-semibold">
            Background color
            <input
              className="h-7 w-10 border border-[#b8c7c1] bg-white p-0.5"
              onChange={(event) =>
                onChangeStyle({ backgroundColor: event.target.value })
              }
              type="color"
              value={style.backgroundColor}
            />
          </label>
          <Swatches
            colors={BOX_SWATCHES}
            label="Background color"
            onPick={(backgroundColor) => onChangeStyle({ backgroundColor })}
            value={style.backgroundColor}
          />
        </div>
      </div>

      <label className="mt-3 grid gap-1 text-xs font-semibold">
        Background opacity ({Math.round(style.backgroundOpacity * 100)}%)
        <input
          className="accent-[#0f766e]"
          max={100}
          min={0}
          onChange={(event) =>
            onChangeStyle({
              backgroundOpacity: Number(event.target.value) / 100,
            })
          }
          step={1}
          type="range"
          value={Math.round(style.backgroundOpacity * 100)}
        />
        <span className="text-[11px] font-normal text-[#5d6d68]">
          Set to 0% for transparent floating text.
        </span>
      </label>

      <div className="mt-4 grid gap-2">
        <span className={sectionTitle} id="subtitle-display-mode-label">
          Show subtitles as
        </span>
        <div
          aria-labelledby="subtitle-display-mode-label"
          className="grid grid-cols-2 gap-2"
          role="radiogroup"
        >
          {catalog.displayModes.map((mode) => {
            const active = mode === style.displayMode;
            return (
              <button
                aria-checked={active}
                className={`rounded-xl px-3 py-2 text-left text-xs ${
                  active
                    ? 'bg-[#0f766e] text-white'
                    : 'bg-[#f0f6f3] hover:bg-[#e3f2ef]'
                }`}
                key={mode}
                onClick={() => onChangeStyle({ displayMode: mode })}
                role="radio"
                type="button"
              >
                <span className="block text-sm font-semibold">
                  {DISPLAY_MODE_OPTIONS[mode].label}
                </span>
                <span
                  className={`mt-0.5 block font-normal ${
                    active ? 'text-white/85' : 'text-[#5d6d68]'
                  }`}
                >
                  {DISPLAY_MODE_OPTIONS[mode].hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        <span className={sectionTitle} id="subtitle-position-label">
          Position
        </span>
        <div
          aria-labelledby="subtitle-position-label"
          className="grid grid-cols-3 gap-2"
          role="radiogroup"
        >
          {catalog.positions.map((position) => {
            const active = position === style.position;
            return (
              <button
                aria-checked={active}
                className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold ${
                  active
                    ? 'bg-[#0f766e] text-white'
                    : 'bg-[#f0f6f3] hover:bg-[#e3f2ef]'
                }`}
                key={position}
                onClick={() => onChangeStyle({ position })}
                role="radio"
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={`relative h-12 w-7 rounded-md ${
                    active ? 'bg-white/25' : 'bg-[#d8e1dc]'
                  }`}
                >
                  <span
                    className={`absolute inset-x-1 h-1.5 rounded-full ${
                      POSITION_ICON[position]
                    } ${active ? 'bg-white' : 'bg-[#0f766e]'}`}
                  />
                </span>
                {POSITION_LABELS[position]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[#e2eae6] pt-4">
        <div className="flex items-center gap-2">
          {onUndo ? (
            <button
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#d5e2dc] bg-white px-3 text-sm font-semibold text-[#263532] hover:border-[#0f766e] hover:text-[#0f766e] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canUndo}
              onClick={onUndo}
              type="button"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="15"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="15"
              >
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
              </svg>
              Undo changes
            </button>
          ) : null}
          <button
            className="h-10 rounded-lg bg-[#f0f6f3] px-3 text-sm font-semibold hover:bg-[#e3f2ef] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!onPreviewNext}
            onClick={() => onPreviewNext?.()}
            type="button"
          >
            Preview next clip
          </button>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-[11px] text-[#5d6d68]">
            Applies to all clips. Changes are kept on this device.
          </p>
          {onSave ? (
            <button
              className="h-10 rounded-lg bg-[#0f766e] px-4 text-sm font-semibold text-white hover:bg-[#0b615b]"
              onClick={onSave}
              type="button"
            >
              Save subtitle style
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
