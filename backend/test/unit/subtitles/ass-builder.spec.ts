import {
  buildAssSubtitles,
  formatAssTime,
  hexToAssColor,
  resolveAssStyleConfig,
  sanitizeAssText,
} from '../../../src/subtitles/ass-builder';
import type { SubtitleCue } from '../../../src/subtitles/subtitle-cue-builder';

describe('ass-builder', () => {
  describe('hexToAssColor', () => {
    it('converts #ffffff with full opacity to &H00FFFFFF', () => {
      expect(hexToAssColor('#ffffff', 1)).toBe('&H00FFFFFF');
    });

    it('converts #000000 with 50% opacity to &H80000000', () => {
      // 1 - 0.5 = 0.5; round(0.5 * 255) = 128 = 0x80
      expect(hexToAssColor('#000000', 0.5)).toBe('&H80000000');
    });

    it('converts #10B981 emerald to ASS BBGGRR order &H0081B910', () => {
      // R=10, G=B9, B=81 -> ASS: &H0081B910
      expect(hexToAssColor('#10B981', 1)).toBe('&H0081B910');
    });

    it('clamps opacity to [0, 1]', () => {
      expect(hexToAssColor('#FFFFFF', 2)).toBe('&H00FFFFFF');
      expect(hexToAssColor('#FFFFFF', -1)).toBe('&HFFFFFFFF');
    });
  });

  describe('formatAssTime', () => {
    it('formats 0s into 0:00:00.00', () => {
      expect(formatAssTime(0)).toBe('0:00:00.00');
    });

    it('formats 1.25s into 0:00:01.25', () => {
      expect(formatAssTime(1.25)).toBe('0:00:01.25');
    });

    it('formats 65.43s into 0:01:05.43', () => {
      expect(formatAssTime(65.43)).toBe('0:01:05.43');
    });

    it('formats 3661.05s into 1:01:01.05', () => {
      expect(formatAssTime(3661.05)).toBe('1:01:01.05');
    });

    it('handles negative or invalid values safely', () => {
      expect(formatAssTime(-5)).toBe('0:00:00.00');
      expect(formatAssTime(NaN)).toBe('0:00:00.00');
    });
  });

  describe('sanitizeAssText', () => {
    it('escapes curly braces to avoid collision with ASS override tags', () => {
      expect(sanitizeAssText('Hello {name}!')).toBe('Hello (name)!');
    });

    it('converts newlines to \\N', () => {
      expect(sanitizeAssText('Line 1\nLine 2\r\nLine 3')).toBe(
        'Line 1\\NLine 2\\NLine 3',
      );
    });

    it('preserves Arabic diacritics and Arabic text', () => {
      const arabicWithTashkeel = 'مَرْحَبًا بِكُمْ فِي البُودْكَاسْت';
      expect(sanitizeAssText(arabicWithTashkeel)).toBe(arabicWithTashkeel);
    });
  });

  describe('resolveAssStyleConfig (3 Presets)', () => {
    it('resolves CLEAN preset with BorderStyle 1 (outline & shadow, no box)', () => {
      const cfg = resolveAssStyleConfig({ preset: 'CLEAN' });
      expect(cfg.borderStyle).toBe(1);
      expect(cfg.primaryColor).toBe('&H00FFFFFF');
      expect(cfg.outline).toBeGreaterThan(0);
      expect(cfg.shadow).toBeGreaterThan(0);
    });

    it('resolves BOX preset with BorderStyle 3 (bounding box)', () => {
      const cfg = resolveAssStyleConfig({ preset: 'BOX' });
      expect(cfg.borderStyle).toBe(3);
      expect(cfg.primaryColor).toBe('&H00FFFFFF');
      expect(cfg.backColor).not.toBe('&H00000000');
    });

    it('resolves HIGHLIGHT preset with accent color', () => {
      const cfg = resolveAssStyleConfig({ preset: 'HIGHLIGHT' });
      expect(cfg.borderStyle).toBe(1);
      // Emerald accent #10B981 -> &H0081B910
      expect(cfg.primaryColor).toBe('&H0081B910');
      expect(cfg.bold).toBe(true);
    });

    it('scales font size proportionally from 720 to 1080', () => {
      const cfg720 = resolveAssStyleConfig({
        playResX: 720,
        style: { fontSizePx: 36 },
      });
      const cfg1080 = resolveAssStyleConfig({
        playResX: 1080,
        style: { fontSizePx: 36 },
      });
      expect(cfg720.fontSize).toBe(36);
      expect(cfg1080.fontSize).toBe(54); // 36 * 1.5
    });

    it('maps TOP, MIDDLE, BOTTOM positions to proper alignments', () => {
      expect(
        resolveAssStyleConfig({ style: { position: 'BOTTOM' } }).alignment,
      ).toBe(2);
      expect(
        resolveAssStyleConfig({ style: { position: 'MIDDLE' } }).alignment,
      ).toBe(5);
      expect(
        resolveAssStyleConfig({ style: { position: 'TOP' } }).alignment,
      ).toBe(8);
    });
  });

  describe('buildAssSubtitles with Arabic and RTL text', () => {
    const arabicCues: SubtitleCue[] = [
      {
        index: 1,
        startSec: 1.5,
        endSec: 4.25,
        text: 'مَرْحَبًا بِكُمْ فِي حَلْقَةِ اليَوْمِ',
      },
      {
        index: 2,
        startSec: 4.5,
        endSec: 7.8,
        text: 'سَنَتَحَدَّثُ عَنْ أَهَمِّ التَّطَوُّرَاتِ فِي ٢٠٢٦',
      },
      {
        index: 3,
        startSec: 8.0,
        endSec: 11.2,
        text: 'بودكاست ReelCast: الحلقة #1 (مباشر)',
      },
    ];

    it('generates a valid ASS script with proper headers and events', () => {
      const ass = buildAssSubtitles(arabicCues, { preset: 'CLEAN' });

      expect(ass).toContain('[Script Info]');
      expect(ass).toContain('ScriptType: v4.00+');
      expect(ass).toContain('PlayResX: 1080');
      expect(ass).toContain('PlayResY: 1920');
      expect(ass).toContain('[V4+ Styles]');
      expect(ass).toContain('Style: Default,Cairo,');
      expect(ass).toContain('[Events]');
      expect(ass).toContain(
        'Dialogue: 0,0:00:01.50,0:00:04.25,Default,,0,0,0,,مَرْحَبًا بِكُمْ فِي حَلْقَةِ اليَوْمِ',
      );
      expect(ass).toContain(
        'Dialogue: 0,0:00:04.50,0:00:07.80,Default,,0,0,0,,سَنَتَحَدَّثُ عَنْ أَهَمِّ التَّطَوُّرَاتِ فِي ٢٠٢٦',
      );
      expect(ass).toContain(
        'Dialogue: 0,0:00:08.00,0:00:11.20,Default,,0,0,0,,بودكاست ReelCast: الحلقة #1 (مباشر)',
      );
    });

    it('embeds explicit position override tags when positionX/positionY are provided', () => {
      const ass = buildAssSubtitles([arabicCues[0]], {
        style: { positionX: 50, positionY: 80 },
      });

      expect(ass).toContain('{\\an5\\pos(540,1536)}');
    });
  });
});
