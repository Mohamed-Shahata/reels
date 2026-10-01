import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildSubtitleCues,
  estimateWordTimings,
  type SubtitleCue,
  type SubtitleWord,
} from './subtitle-cue-builder';
import {
  DEFAULT_SUBTITLE_DISPLAY_MODE,
  type SubtitleDisplayMode,
} from './subtitle-style';

// Segments are loaded slightly beyond the clip so a word whose segment ends
// just outside the clip edge is still considered.
const SEGMENT_QUERY_PADDING_SEC = 1;

export type SubtitleTiming = 'WORD' | 'ESTIMATED' | 'MIXED' | 'NONE';

export interface ClipSubtitles {
  clipId: string;
  language: string;
  /** Whether each cue is a short phrase or a single word. */
  displayMode: SubtitleDisplayMode;
  /** Clip range in the source video. */
  startSec: number;
  endSec: number;
  durationSec: number;
  /**
   * `WORD` means every cue comes from measured word timestamps. `ESTIMATED`
   * means the transcript predates word timing and cues are approximate; run
   * the transcription again to get exact timing. `NONE` means the clip has no
   * speech.
   */
  timing: SubtitleTiming;
  cues: SubtitleCue[];
}

interface StoredWord {
  word: string;
  startSec: number;
  endSec: number;
}

@Injectable()
export class SubtitlesService {
  constructor(private readonly prisma: PrismaService) {}

  async getClipSubtitles(
    userId: string,
    clipId: string,
    displayMode: SubtitleDisplayMode = DEFAULT_SUBTITLE_DISPLAY_MODE,
  ): Promise<ClipSubtitles> {
    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, video: { is: { userId } } },
      select: {
        id: true,
        startSec: true,
        endSec: true,
        video: {
          select: { transcript: { select: { id: true, language: true } } },
        },
      },
    });
    if (!clip) {
      throw new NotFoundException('Clip was not found');
    }

    const transcript = clip.video.transcript;
    if (!transcript) {
      throw new ConflictException(
        'Transcript must be ready before generating subtitles',
      );
    }

    const { cues, timing } = await this.buildCues(
      transcript.id,
      clip.startSec,
      clip.endSec,
      displayMode,
    );

    return {
      clipId: clip.id,
      language: transcript.language,
      displayMode,
      startSec: clip.startSec,
      endSec: clip.endSec,
      durationSec: clip.endSec - clip.startSec,
      timing,
      cues,
    };
  }

  async buildCues(
    transcriptId: string,
    startSec: number,
    endSec: number,
    displayMode: SubtitleDisplayMode = DEFAULT_SUBTITLE_DISPLAY_MODE,
  ): Promise<{ cues: SubtitleCue[]; timing: SubtitleTiming }> {
    const segments = await this.prisma.transcriptSegment.findMany({
      where: {
        transcriptId,
        startSec: { lt: endSec + SEGMENT_QUERY_PADDING_SEC },
        endSec: { gt: startSec - SEGMENT_QUERY_PADDING_SEC },
      },
      orderBy: { startSec: 'asc' },
      select: { startSec: true, endSec: true, text: true, words: true },
    });

    const words: SubtitleWord[] = [];
    for (const segment of segments) {
      words.push(...this.wordsForSegment(segment));
    }

    return {
      cues: buildSubtitleCues(words, startSec, endSec, {}, displayMode),
      timing: this.describeTiming(words),
    };
  }

  private wordsForSegment(segment: {
    startSec: number;
    endSec: number;
    text: string;
    words: unknown;
  }): SubtitleWord[] {
    const measured = parseStoredWords(segment.words);
    if (measured.length > 0) {
      return measured.map((word) => ({
        text: word.word,
        startSec: word.startSec,
        endSec: word.endSec,
        estimated: false,
      }));
    }
    return estimateWordTimings(segment);
  }

  private describeTiming(words: readonly SubtitleWord[]): SubtitleTiming {
    if (words.length === 0) {
      return 'NONE';
    }
    const estimated = words.filter((word) => word.estimated).length;
    if (estimated === 0) {
      return 'WORD';
    }
    return estimated === words.length ? 'ESTIMATED' : 'MIXED';
  }
}

function parseStoredWords(value: unknown): StoredWord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const words: StoredWord[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const { word, startSec, endSec } = item as Record<string, unknown>;
    if (
      typeof word === 'string' &&
      typeof startSec === 'number' &&
      typeof endSec === 'number' &&
      Number.isFinite(startSec) &&
      Number.isFinite(endSec)
    ) {
      words.push({ word, startSec, endSec });
    }
  }
  return words;
}
