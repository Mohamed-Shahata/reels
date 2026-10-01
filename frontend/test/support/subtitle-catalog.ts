import type { SubtitleStyleCatalog } from '@/lib/api';

export const subtitleCatalog: SubtitleStyleCatalog = {
  defaultPresetId: 'REEL',
  fonts: ['Cairo', 'Amiri', 'Arial'],
  positions: ['TOP', 'MIDDLE', 'BOTTOM'],
  displayModes: ['PHRASE', 'WORD'],
  fontSize: { min: 20, max: 72 },
  presets: [
    {
      id: 'REEL',
      label: 'Reel',
      description: 'Bold white text on a dark box.',
      style: {
        fontFamily: 'Cairo',
        fontSizePx: 34,
        bold: true,
        textColor: '#ffffff',
        backgroundColor: '#000000',
        backgroundOpacity: 0.63,
        position: 'BOTTOM',
        displayMode: 'PHRASE',
      },
    },
    {
      id: 'HIGHLIGHT',
      label: 'Highlight',
      description: 'Large yellow text on a solid dark box.',
      style: {
        fontFamily: 'Cairo',
        fontSizePx: 40,
        bold: true,
        textColor: '#facc15',
        backgroundColor: '#000000',
        backgroundOpacity: 0.85,
        position: 'MIDDLE',
        displayMode: 'PHRASE',
      },
    },
    {
      id: 'MINIMAL',
      label: 'Minimal',
      description: 'Clean text with no box.',
      style: {
        fontFamily: 'Arial',
        fontSizePx: 30,
        bold: false,
        textColor: '#ffffff',
        backgroundColor: '#000000',
        backgroundOpacity: 0,
        position: 'TOP',
        displayMode: 'PHRASE',
      },
    },
  ],
};
