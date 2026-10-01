import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../config/env.schema';
import type {
  ReconciledTopicSegment,
  TopicSegmentCandidate,
} from './boundary-reconciliation.service';
import type { HighlightCandidate } from './clip-planner.service';

const topicSegmentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().positive(),
    summary: z.string().trim().min(1).max(500),
  })
  .strict();

const topicSegmentsResponseSchema = z
  .object({ segments: z.array(topicSegmentSchema) })
  .strict();

const highlightSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().positive(),
    summary: z.string().trim().min(1).max(500),
    score: z.number().finite().min(0).max(10),
  })
  .strict();

const highlightsResponseSchema = z
  .object({ moments: z.array(highlightSchema) })
  .strict();

const TIME_TOLERANCE_SEC = 0.01;

export class SegmentationValidationError extends Error {}

@Injectable()
export class TopicSegmentValidationService {
  private readonly minDurationSec: number;
  private readonly maxDurationSec: number;
  private readonly maxAttempts: number;

  constructor(config: ConfigService<Env, true>) {
    this.minDurationSec = config.get('CLIP_MIN_DURATION_SEC', {
      infer: true,
    });
    this.maxDurationSec = config.get('CLIP_MAX_DURATION_SEC', {
      infer: true,
    });
    this.maxAttempts = config.get('SEGMENTATION_VALIDATION_MAX_ATTEMPTS', {
      infer: true,
    });
  }

  validate(
    response: unknown,
    videoDurationSec: number,
  ): ReconciledTopicSegment[] {
    if (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0) {
      throw new SegmentationValidationError(
        'Video duration must be a positive number',
      );
    }

    const normalized = this.parseCandidates(response);
    if (normalized.length === 0) {
      throw new SegmentationValidationError(
        'AI response did not include any topics',
      );
    }
    this.assertContiguousCoverage(normalized, videoDurationSec);

    const merged = this.mergeTinySegments(normalized);
    const split = merged.flatMap((segment) =>
      this.splitOversizedSegment(segment),
    );
    this.assertDurationLimits(split);
    this.assertContiguousCoverage(split, videoDurationSec);

    return split;
  }

  async requestValidSegments(
    request: (attempt: number) => Promise<unknown>,
    videoDurationSec: number,
  ): Promise<ReconciledTopicSegment[]> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return this.validate(await request(attempt), videoDurationSec);
      } catch (error) {
        lastError = error;
      }
    }

    throw new SegmentationValidationError(
      `AI response remained invalid after ${this.maxAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : 'unknown error'
      }`,
    );
  }

  parseCandidates(response: unknown): TopicSegmentCandidate[] {
    const parsed = topicSegmentsResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new SegmentationValidationError(
        'AI response does not match the topic schema',
      );
    }

    return parsed.data.segments.map((segment) => ({ ...segment }));
  }

  async requestValidCandidates(
    request: (attempt: number) => Promise<unknown>,
  ): Promise<TopicSegmentCandidate[]> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return this.parseCandidates(await request(attempt));
      } catch (error) {
        lastError = error;
      }
    }

    throw new SegmentationValidationError(
      `AI response remained invalid after ${this.maxAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : 'unknown error'
      }`,
    );
  }

  parseHighlights(response: unknown): HighlightCandidate[] {
    const parsed = highlightsResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new SegmentationValidationError(
        'AI response does not match the highlight schema',
      );
    }

    return parsed.data.moments.map((moment) => ({ ...moment }));
  }

  async requestValidHighlights(
    request: (attempt: number) => Promise<unknown>,
  ): Promise<HighlightCandidate[]> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return this.parseHighlights(await request(attempt));
      } catch (error) {
        lastError = error;
      }
    }

    throw new SegmentationValidationError(
      `AI response remained invalid after ${this.maxAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : 'unknown error'
      }`,
    );
  }

  private mergeTinySegments(
    segments: TopicSegmentCandidate[],
  ): TopicSegmentCandidate[] {
    const merged: TopicSegmentCandidate[] = [];
    const pending = segments.map((segment) => ({ ...segment }));

    for (let index = 0; index < pending.length; index += 1) {
      const segment = pending[index];
      if (this.duration(segment) >= this.minDurationSec) {
        merged.push(segment);
        continue;
      }

      const previous = merged.at(-1);
      if (previous) {
        previous.endSec = segment.endSec;
        previous.summary = this.combineSummaries(
          previous.summary,
          segment.summary,
        );
        continue;
      }

      const next = pending[index + 1];
      if (!next) {
        throw new SegmentationValidationError(
          'A single topic cannot be shorter than the configured minimum duration',
        );
      }

      next.startSec = segment.startSec;
      next.summary = this.combineSummaries(segment.summary, next.summary);
    }

    return merged;
  }

  private splitOversizedSegment(
    segment: TopicSegmentCandidate,
  ): TopicSegmentCandidate[] {
    const duration = this.duration(segment);
    if (duration <= this.maxDurationSec) return [segment];

    const count = Math.ceil(duration / this.maxDurationSec);
    const partDuration = duration / count;
    const result: TopicSegmentCandidate[] = [];

    for (let index = 0; index < count; index += 1) {
      const startSec = this.round(segment.startSec + index * partDuration);
      const endSec =
        index === count - 1
          ? segment.endSec
          : this.round(segment.startSec + (index + 1) * partDuration);
      result.push({
        ...segment,
        title: `${segment.title} (Part ${index + 1})`,
        startSec,
        endSec,
      });
    }

    return result;
  }

  private assertDurationLimits(segments: TopicSegmentCandidate[]): void {
    for (const segment of segments) {
      const duration = this.duration(segment);
      if (duration < this.minDurationSec || duration > this.maxDurationSec) {
        throw new SegmentationValidationError(
          'Topic duration is outside the configured clip limits',
        );
      }
    }
  }

  private assertContiguousCoverage(
    segments: TopicSegmentCandidate[],
    videoDurationSec: number,
  ): void {
    if (Math.abs(segments[0].startSec) > TIME_TOLERANCE_SEC) {
      throw new SegmentationValidationError(
        'The first topic must start at zero',
      );
    }

    if (
      Math.abs((segments.at(-1)?.endSec ?? Number.NaN) - videoDurationSec) >
      TIME_TOLERANCE_SEC
    ) {
      throw new SegmentationValidationError(
        'The last topic must end at the video duration',
      );
    }

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment.endSec <= segment.startSec) {
        throw new SegmentationValidationError(
          'Topic endSec must be greater than startSec',
        );
      }
      if (
        index > 0 &&
        Math.abs(segment.startSec - segments[index - 1].endSec) >
          TIME_TOLERANCE_SEC
      ) {
        throw new SegmentationValidationError(
          'Topics must cover the video without gaps or overlaps',
        );
      }
    }
  }

  private combineSummaries(left: string, right: string): string {
    return `${left} ${right}`.slice(0, 500);
  }

  private duration(segment: TopicSegmentCandidate): number {
    return segment.endSec - segment.startSec;
  }

  private round(value: number): number {
    return Math.round(value * 1000) / 1000;
  }
}
