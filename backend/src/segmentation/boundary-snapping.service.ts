import { Injectable } from '@nestjs/common';
import type { ReconciledTopicSegment } from './boundary-reconciliation.service';

export interface TranscriptSentenceSegment {
  startSec: number;
  endSec: number;
  text: string;
}

const SENTENCE_ENDING = /[.!?؟۔]\s*$/u;

@Injectable()
export class BoundarySnappingService {
  snap(
    topics: ReconciledTopicSegment[],
    transcript: TranscriptSentenceSegment[],
    videoDurationSec: number,
  ): ReconciledTopicSegment[] {
    this.assertTopics(topics, videoDurationSec);
    if (topics.length === 0) return [];

    const sentenceEnds = this.getSentenceEnds(transcript, videoDurationSec);
    const boundaries = [0];

    for (let index = 0; index < topics.length - 1; index += 1) {
      const current = topics[index];
      const next = topics[index + 1];
      const minimum = boundaries.at(-1)!;
      const maximum = next.endSec;
      boundaries.push(
        this.findNearestEnd(current.endSec, sentenceEnds, minimum, maximum),
      );
    }
    boundaries.push(videoDurationSec);

    return topics.map((topic, index) => ({
      ...topic,
      startSec: boundaries[index],
      endSec: boundaries[index + 1],
    }));
  }

  private getSentenceEnds(
    transcript: TranscriptSentenceSegment[],
    videoDurationSec: number,
  ): number[] {
    const valid = transcript.filter(
      (segment) =>
        Number.isFinite(segment.startSec) &&
        Number.isFinite(segment.endSec) &&
        segment.startSec >= 0 &&
        segment.endSec > segment.startSec &&
        segment.endSec < videoDurationSec &&
        segment.text.trim().length > 0,
    );
    const sentenceEnds = valid
      .filter((segment) => SENTENCE_ENDING.test(segment.text))
      .map((segment) => segment.endSec);

    return sentenceEnds.length > 0
      ? sentenceEnds
      : valid.map((segment) => segment.endSec);
  }

  private findNearestEnd(
    boundary: number,
    sentenceEnds: number[],
    minimum: number,
    maximum: number,
  ): number {
    const candidates = sentenceEnds.filter(
      (endSec) => endSec > minimum && endSec < maximum,
    );
    if (candidates.length === 0) return boundary;

    return candidates.reduce((nearest, candidate) =>
      Math.abs(candidate - boundary) < Math.abs(nearest - boundary)
        ? candidate
        : nearest,
    );
  }

  private assertTopics(
    topics: ReconciledTopicSegment[],
    videoDurationSec: number,
  ): void {
    if (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0) {
      throw new Error('Video duration must be a positive number');
    }
    if (topics.length === 0) return;
    if (
      topics[0].startSec !== 0 ||
      topics.at(-1)?.endSec !== videoDurationSec
    ) {
      throw new Error(
        'Topics must cover the full video before boundary snapping',
      );
    }

    for (let index = 1; index < topics.length; index += 1) {
      if (topics[index].startSec !== topics[index - 1].endSec) {
        throw new Error('Topics must be contiguous before boundary snapping');
      }
    }
  }
}
