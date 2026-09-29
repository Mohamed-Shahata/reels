import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';

export interface TranscriptSegmentInput {
  startSec: number;
  endSec: number;
  text: string;
}

export interface TranscriptWindow {
  startSec: number;
  endSec: number;
  characterCount: number;
  estimatedTokens: number;
  segments: TranscriptSegmentInput[];
}

const CHARS_PER_ESTIMATED_TOKEN = 2;

@Injectable()
export class TranscriptWindowingService {
  private readonly maxCharacters: number;
  private readonly overlapSec: number;

  constructor(config: ConfigService<Env, true>) {
    this.maxCharacters = config.get('SEGMENTATION_WINDOW_MAX_CHARS', {
      infer: true,
    });
    this.overlapSec = config.get('SEGMENTATION_WINDOW_OVERLAP_SEC', {
      infer: true,
    });
  }

  createWindows(segments: TranscriptSegmentInput[]): TranscriptWindow[] {
    const normalized = this.normalize(segments);
    const windows: TranscriptWindow[] = [];
    let primaryStartIndex = 0;

    while (primaryStartIndex < normalized.length) {
      const primaryEndIndex = this.findPrimaryEnd(
        normalized,
        primaryStartIndex,
      );
      const primary = normalized.slice(primaryStartIndex, primaryEndIndex);
      const windowSegments = this.withOverlap(
        normalized,
        primaryStartIndex,
        primary,
      );
      const characterCount = this.countCharacters(windowSegments);

      windows.push({
        startSec: windowSegments[0].startSec,
        endSec: windowSegments.at(-1)!.endSec,
        characterCount,
        estimatedTokens: Math.ceil(characterCount / CHARS_PER_ESTIMATED_TOKEN),
        segments: windowSegments,
      });
      primaryStartIndex = primaryEndIndex;
    }

    return windows;
  }

  private normalize(
    segments: TranscriptSegmentInput[],
  ): TranscriptSegmentInput[] {
    const valid: TranscriptSegmentInput[] = [];

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const text = segment.text?.trim() ?? '';
      if (
        !Number.isFinite(segment.startSec) ||
        !Number.isFinite(segment.endSec) ||
        segment.startSec < 0 ||
        segment.endSec <= segment.startSec ||
        text.length === 0
      ) {
        continue;
      }

      const previous = valid.at(-1);
      if (previous && segment.startSec < previous.startSec) {
        throw new Error('Transcript segments must be ordered by startSec');
      }

      if (text.length > this.maxCharacters) {
        throw new Error(
          `Transcript segment at index ${index} exceeds the window character limit`,
        );
      }

      valid.push({ ...segment, text });
    }

    return valid;
  }

  private findPrimaryEnd(
    segments: TranscriptSegmentInput[],
    startIndex: number,
  ): number {
    let characterCount = 0;
    let endIndex = startIndex;

    while (endIndex < segments.length) {
      const nextLength = segments[endIndex].text.length;
      if (
        endIndex > startIndex &&
        characterCount + nextLength > this.maxCharacters
      ) {
        break;
      }
      characterCount += nextLength;
      endIndex += 1;
    }

    return endIndex;
  }

  private withOverlap(
    segments: TranscriptSegmentInput[],
    primaryStartIndex: number,
    primary: TranscriptSegmentInput[],
  ): TranscriptSegmentInput[] {
    const included = [...primary];
    let characterCount = this.countCharacters(included);
    const earliestOverlapStart = primary[0].startSec - this.overlapSec;

    for (let index = primaryStartIndex - 1; index >= 0; index -= 1) {
      const candidate = segments[index];
      if (candidate.endSec <= earliestOverlapStart) break;
      if (characterCount + candidate.text.length > this.maxCharacters) break;

      included.unshift(candidate);
      characterCount += candidate.text.length;
    }

    return included;
  }

  private countCharacters(segments: TranscriptSegmentInput[]): number {
    return segments.reduce((total, segment) => total + segment.text.length, 0);
  }
}
