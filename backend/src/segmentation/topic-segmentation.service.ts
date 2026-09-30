import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { BoundaryReconciliationService } from './boundary-reconciliation.service';
import { BoundarySnappingService } from './boundary-snapping.service';
import { TopicSegmentValidationService } from './topic-segment-validation.service';
import { TranscriptWindowingService } from './transcript-windowing.service';

const SYSTEM_PROMPT = `You are an editor who identifies useful, self-contained podcast topics from a timestamped transcript. Return only JSON matching the supplied schema. Use only information present in the transcript. Keep each topic inside the supplied window and use nearby transcript timestamps. Write titles and summaries in the transcript language. Return chronological, non-overlapping topic candidates. Avoid filler-only topics.`;

const TOPIC_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['segments'],
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'startSec', 'endSec', 'summary'],
        properties: {
          title: { type: 'string' },
          startSec: { type: 'number' },
          endSec: { type: 'number' },
          summary: { type: 'string' },
        },
      },
    },
  },
} as const;

const MAX_RATE_LIMIT_WAITS = 8;
const DEFAULT_RATE_LIMIT_WAIT_MS = 15_000;
const MAX_RATE_LIMIT_WAIT_MS = 65_000;

const JSON_OBJECT_FALLBACK_PROMPT = `${SYSTEM_PROMPT} Respond with a single JSON object of the form {"segments":[{"title":string,"startSec":number,"endSec":number,"summary":string}]} and nothing else.`;

@Injectable()
export class TopicSegmentationService {
  private readonly logger = new Logger(TopicSegmentationService.name);
  private readonly groq: Groq;
  private readonly model: string;
  private readonly maxCompletionTokens: number;
  private readonly concurrency: number;

  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly windows: TranscriptWindowingService,
    private readonly reconciliation: BoundaryReconciliationService,
    private readonly validation: TopicSegmentValidationService,
    private readonly snapping: BoundarySnappingService,
  ) {
    this.groq = new Groq({
      apiKey: config.get('GROQ_API_KEY', { infer: true }),
    });
    this.model = config.get('GROQ_SEGMENTATION_MODEL', { infer: true });
    this.maxCompletionTokens = config.get(
      'SEGMENTATION_MAX_COMPLETION_TOKENS',
      {
        infer: true,
      },
    );
    this.concurrency = config.get('SEGMENTATION_CONCURRENCY', { infer: true });
  }

  async assertReady(userId: string, videoId: string): Promise<void> {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId, status: 'READY' },
      select: { id: true, durationSec: true },
    });
    if (!video?.durationSec) {
      throw new NotFoundException('Video was not found or is not ready');
    }

    const segmentCount = await this.prisma.transcriptSegment.count({
      where: { transcript: { is: { videoId: video.id } } },
    });
    if (segmentCount === 0) {
      throw new ConflictException(
        'Transcript must be ready before generating AI clips',
      );
    }
  }

  async suggest(userId: string, videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId, status: 'READY' },
      select: { id: true, durationSec: true },
    });
    if (!video?.durationSec) {
      throw new NotFoundException('Video was not found or is not ready');
    }

    const transcript = await this.prisma.transcript.findUnique({
      where: { videoId: video.id },
      include: {
        segments: {
          orderBy: { startSec: 'asc' },
          select: { startSec: true, endSec: true, text: true },
        },
      },
    });
    if (!transcript?.segments.length) {
      throw new ConflictException(
        'Transcript must be ready before generating AI clips',
      );
    }

    const windows = this.windows.createWindows(transcript.segments);
    const candidates = (
      await this.mapWithConcurrency(windows, (window, index) =>
        this.validation.requestValidCandidates((attempt) =>
          this.requestWindow(
            attempt,
            index,
            transcript.language,
            video.durationSec!,
            window,
          ),
        ),
      )
    ).flat();

    if (candidates.length === 0) {
      throw new ConflictException('AI did not identify any clip topics');
    }

    const reconciled = this.reconciliation.reconcile(
      candidates,
      video.durationSec,
    );
    const validated = this.validation.validate(
      { segments: reconciled },
      video.durationSec,
    );

    const snapped = this.snapping.snap(
      validated,
      transcript.segments,
      video.durationSec,
    );

    return this.validation.validate({ segments: snapped }, video.durationSec);
  }

  private async requestWindow(
    attempt: number,
    windowIndex: number,
    language: string,
    videoDurationSec: number,
    window: { startSec: number; endSec: number; segments: unknown[] },
  ): Promise<unknown> {
    const useStrictSchema = attempt === 1;

    try {
      const completion = await this.createCompletion(windowIndex, {
        model: this.model,
        temperature: useStrictSchema ? 0 : 0.2,
        max_completion_tokens: this.maxCompletionTokens,
        reasoning_effort: 'low',
        include_reasoning: false,
        messages: [
          {
            role: 'system',
            content: useStrictSchema
              ? SYSTEM_PROMPT
              : JSON_OBJECT_FALLBACK_PROMPT,
          },
          {
            role: 'user',
            content: JSON.stringify({
              language,
              videoDurationSec,
              windowStartSec: window.startSec,
              windowEndSec: window.endSec,
              segments: window.segments,
            }),
          },
        ],
        response_format: useStrictSchema
          ? {
              type: 'json_schema',
              json_schema: {
                name: 'topic_segments',
                strict: true,
                schema: TOPIC_RESPONSE_SCHEMA,
              },
            }
          : { type: 'json_object' },
      });

      const choice = completion.choices[0];
      const content = choice?.message.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error(
          `Groq returned an empty topic response (finish_reason: ${choice?.finish_reason ?? 'unknown'})`,
        );
      }
      return JSON.parse(content) as unknown;
    } catch (error) {
      this.logger.warn(
        `Window ${windowIndex} attempt ${attempt} failed (${
          useStrictSchema ? 'json_schema' : 'json_object'
        }): ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw error;
    }
  }

  private async createCompletion(
    windowIndex: number,
    params: ChatCompletionCreateParamsNonStreaming,
  ) {
    for (let waits = 0; ; waits += 1) {
      try {
        return await this.groq.chat.completions.create(params);
      } catch (error) {
        if (
          !(error instanceof Groq.RateLimitError) ||
          waits >= MAX_RATE_LIMIT_WAITS
        ) {
          throw error;
        }
        const waitMs = this.getRetryDelayMs(error);
        this.logger.warn(
          `Window ${windowIndex} hit the Groq rate limit, waiting ${Math.ceil(waitMs / 1000)}s`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  private getRetryDelayMs(error: InstanceType<typeof Groq.RateLimitError>) {
    const seconds = Number(error.headers?.get('retry-after'));
    const fromHeader =
      Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
    const fromMessage = /try again in ([\d.]+)s/i.exec(error.message)?.[1];
    const parsed = fromMessage ? Number(fromMessage) * 1000 : 0;
    const delay = Math.max(fromHeader, parsed) || DEFAULT_RATE_LIMIT_WAIT_MS;

    return Math.min(delay + 1000, MAX_RATE_LIMIT_WAIT_MS);
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    worker: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;

    const runners = Array.from(
      { length: Math.min(this.concurrency, items.length) },
      async () => {
        while (cursor < items.length) {
          const index = cursor;
          cursor += 1;
          results[index] = await worker(items[index], index);
        }
      },
    );
    await Promise.all(runners);

    return results;
  }
}
