import { Injectable } from '@nestjs/common';

export interface TopicSegmentCandidate {
  title: string;
  startSec: number;
  endSec: number;
  summary: string;
}

export type ReconciledTopicSegment = TopicSegmentCandidate;

@Injectable()
export class BoundaryReconciliationService {
  reconcile(
    candidates: TopicSegmentCandidate[],
    videoDurationSec: number,
  ): ReconciledTopicSegment[] {
    if (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0) {
      throw new Error('Video duration must be a positive number');
    }

    if (candidates.length === 0) return [];

    const topics = this.deduplicate(candidates, videoDurationSec);
    const centers = topics.map((topic) =>
      this.round((topic.startSec + topic.endSec) / 2),
    );

    for (let index = 1; index < centers.length; index += 1) {
      if (centers[index] <= centers[index - 1]) {
        throw new Error('Topic candidates must have increasing time ranges');
      }
    }

    return topics.map((topic, index) => ({
      title: topic.title,
      startSec:
        index === 0 ? 0 : this.round((centers[index - 1] + centers[index]) / 2),
      endSec:
        index === topics.length - 1
          ? videoDurationSec
          : this.round((centers[index] + centers[index + 1]) / 2),
      summary: topic.summary,
    }));
  }

  private deduplicate(
    candidates: TopicSegmentCandidate[],
    videoDurationSec: number,
  ): TopicSegmentCandidate[] {
    const normalized = candidates
      .map((candidate, index) =>
        this.normalize(candidate, index, videoDurationSec),
      )
      .sort((left, right) => left.startSec - right.startSec);
    const topics: TopicSegmentCandidate[] = [];

    for (const candidate of normalized) {
      const previous = topics.at(-1);
      if (!previous || !this.isDuplicate(previous, candidate)) {
        topics.push(candidate);
        continue;
      }

      previous.startSec = Math.min(previous.startSec, candidate.startSec);
      previous.endSec = Math.max(previous.endSec, candidate.endSec);
    }

    return topics;
  }

  private normalize(
    candidate: TopicSegmentCandidate,
    index: number,
    videoDurationSec: number,
  ): TopicSegmentCandidate {
    const title = candidate.title.trim();
    const summary = candidate.summary.trim();
    if (
      title.length === 0 ||
      summary.length === 0 ||
      !Number.isFinite(candidate.startSec) ||
      !Number.isFinite(candidate.endSec) ||
      candidate.startSec < 0 ||
      candidate.endSec <= candidate.startSec ||
      candidate.endSec > videoDurationSec
    ) {
      throw new Error(`Invalid topic candidate at index ${index}`);
    }

    return {
      title,
      startSec: candidate.startSec,
      endSec: candidate.endSec,
      summary,
    };
  }

  private isDuplicate(
    left: TopicSegmentCandidate,
    right: TopicSegmentCandidate,
  ): boolean {
    return left.title === right.title && left.summary === right.summary;
  }

  private round(value: number): number {
    return Math.round(value * 1000) / 1000;
  }
}
