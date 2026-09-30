'use client';

import type { SubtitleStyle, SubtitleStyleCatalog } from '@/lib/api';
import {
  getPreviewPositionStyle,
  getPreviewTextStyle,
  isCustomized,
  type SubtitleSelection,
} from '@/lib/subtitle-style';

const SAMPLE_TEXT = 'Your subtitles will look like this';

const POSITION_LABELS: Record<SubtitleStyle['position'], string> = {
  TOP: 'Top (start)',
  MIDDLE: 'Middle',
  BOTTOM: 'Bottom (end)',
};

interface SubtitleStylePanelProps {
  catalog: SubtitleStyleCatalog | null;
  selection: SubtitleSelection | null;
  error: string | null;
  onChoosePreset: (presetId: string) => void;
  onChangeStyle: (patch: Partial<SubtitleStyle>) => void;
  onReset: () => void;
}

export function SubtitleStylePanel({
  catalog,
  selection,
  error,
  onChoosePreset,
  onChangeStyle,
  onReset,
}: SubtitleStylePanelProps) {
  if (error) {
    return (
      <section className="mt-8 border-t border-[#d8e1dc] pt-5">
        <h2 className="text-base font-semibold">Subtitle style</h2>
        <p className="mt-2 text-sm text-[#a13d3d]" role="alert">
          {error}
        </p>
      </section>
    );
  }

  if (!catalog || !selection) {
    return (
      <section className="mt-8 border-t border-[#d8e1dc] pt-5">
        <h2 className="text-base font-semibold">Subtitle style</h2>
        <p className="mt-2 text-sm text-[#5f6e69]">
          Loading subtitle styles...
        </p>
      </section>
    );
  }

  const { style } = selection;
  const customized = isCustomized(catalog, selection);

  return (
    <section
      aria-label="Subtitle style"
      className="mt-8 border-t border-[#d8e1dc] pt-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Subtitle style</h2>
        {customized ? (
          <button
            className="h-8 border border-[#b8c7c1] px-2 text-xs font-semibold text-[#172321] hover:bg-[#edf3f0]"
            onClick={onReset}
            type="button"
          >
            Reset to preset
          </button>
        ) : null}
      </div>

      <div
        aria-label="Subtitle presets"
        className="mt-3 grid grid-cols-2 gap-2"
        role="radiogroup"
      >
        {catalog.presets.map((preset) => {
          const active = preset.id === selection.presetId;
          return (
            <button
              aria-checked={active}
              className={
                active
                  ? 'border border-[#0f766e] bg-[#e3f2ef] px-3 py-2 text-left'
                  : 'border border-[#b8c7c1] px-3 py-2 text-left hover:bg-[#edf3f0]'
              }
              key={preset.id}
              onClick={() => onChoosePreset(preset.id)}
              role="radio"
              type="button"
            >
              <span className="block text-sm font-semibold">
                {preset.label}
              </span>
              <span className="mt-1 block text-xs text-[#5f6e69]">
                {preset.description}
              </span>
            </button>
          );
        })}
      </div>

      {customized ? (
        <p className="mt-2 text-xs text-[#5f6e69]">
          Customized from the selected preset.
        </p>
      ) : null}

      <div
        aria-label="Subtitle preview"
        className="relative mx-auto mt-4 aspect-[9/16] w-40 overflow-hidden bg-[#172321]"
        style={{ containerType: 'inline-size' }}
      >
        <div
          className="absolute inset-x-0 flex justify-center px-[6%]"
          style={getPreviewPositionStyle(style.position)}
        >
          <p
            className="px-[3%] py-[1%] text-center leading-snug"
            data-testid="subtitle-preview-text"
            style={getPreviewTextStyle(style)}
          >
            {SAMPLE_TEXT}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-xs font-semibold">
          Font
          <select
            className="h-9 border border-[#b8c7c1] bg-white px-2 text-sm font-normal"
            onChange={(event) =>
              onChangeStyle({
                fontFamily: event.target.value as SubtitleStyle['fontFamily'],
              })
            }
            value={style.fontFamily}
          >
            {catalog.fonts.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs font-semibold">
          Size ({style.fontSizePx}px)
          <input
            max={catalog.fontSize.max}
            min={catalog.fontSize.min}
            onChange={(event) =>
              onChangeStyle({ fontSizePx: Number(event.target.value) })
            }
            step={1}
            type="range"
            value={style.fontSizePx}
          />
        </label>

        <label className="flex items-center gap-2 text-xs font-semibold">
          <input
            checked={style.bold}
            onChange={(event) => onChangeStyle({ bold: event.target.checked })}
            type="checkbox"
          />
          Bold
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-xs font-semibold">
            Text color
            <input
              className="h-9 w-full border border-[#b8c7c1] bg-white p-1"
              onChange={(event) =>
                onChangeStyle({ textColor: event.target.value })
              }
              type="color"
              value={style.textColor}
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold">
            Background color
            <input
              className="h-9 w-full border border-[#b8c7c1] bg-white p-1"
              onChange={(event) =>
                onChangeStyle({ backgroundColor: event.target.value })
              }
              type="color"
              value={style.backgroundColor}
            />
          </label>
        </div>

        <label className="grid gap-1 text-xs font-semibold">
          Background opacity ({Math.round(style.backgroundOpacity * 100)}%)
          <input
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
        </label>

        <div className="grid gap-1 text-xs font-semibold">
          <span id="subtitle-position-label">Position</span>
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
                  className={
                    active
                      ? 'h-9 border border-[#0f766e] bg-[#e3f2ef] px-2 text-xs font-semibold'
                      : 'h-9 border border-[#b8c7c1] px-2 text-xs font-normal hover:bg-[#edf3f0]'
                  }
                  key={position}
                  onClick={() => onChangeStyle({ position })}
                  role="radio"
                  type="button"
                >
                  {POSITION_LABELS[position]}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
