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
import {
  BoundaryReconciliationService,
  type ReconciledTopicSegment,
} from './boundary-reconciliation.service';
import type { AiClipMode } from './ai-clip-mode';
import { ClipPlannerService, type CutPoint } from './clip-planner.service';
import { TopicSegmentValidationService } from './topic-segment-validation.service';
import {
  TranscriptWindowingService,
  type TranscriptWindow,
} from './transcript-windowing.service';

const SYSTEM_PROMPT = `You are an editor who identifies useful, self-contained podcast topics from a timestamped transcript. Return only JSON matching the supplied schema. Use only information present in the transcript. Keep each topic inside the supplied window and use nearby transcript timestamps. Write titles and summaries in the transcript language. Return chronological, non-overlapping topic candidates. Avoid filler-only topics. A topic starts where the speaker begins the subject and ends where the subject is finished: never split a topic in the middle of an idea, a story or a sentence, and never end it while someone is still speaking. Topics usually last between one and four minutes.`;

const HIGHLIGHT_SYSTEM_PROMPT = `You are a short-form video editor who picks the best reels from a timestamped podcast transcript. Return only JSON matching the supplied schema. Use only information present in the transcript and timestamps taken from it. Pick the moments most likely to get reach as standalone reels: a strong hook, a surprising or emotional story, a valuable insight or piece of practical advice, a bold or quotable opinion, a funny exchange. Skip intros, outros, ads, small talk and filler. Every moment must be a complete, self-contained idea that lasts between 60 and 240 seconds: start where the speaker begins the subject (or the question that introduces it) and end when the speaker finishes the point, never in the middle of a sentence and never while someone is still speaking. If one topic runs longer than 240 seconds return it as a single moment; it will be split into parts afterwards. Do not return overlapping moments. Score each moment from 1 to 10 for its potential reach (hook strength, value, emotion, shareability). Write titles as catchy hooks of at most 80 characters and summaries in the transcript language. Return an empty list when the window has nothing strong.`;

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

const HIGHLIGHT_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['moments'],
  properties: {
    moments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'startSec', 'endSec', 'summary', 'score'],
        properties: {
          title: { type: 'string' },
          startSec: { type: 'number' },
          endSec: { type: 'number' },
          summary: { type: 'string' },
          score: { type: 'number' },
        },
      },
    },
  },
} as const;

const MAX_RATE_LIMIT_WAITS = 8;
const DEFAULT_RATE_LIMIT_WAIT_MS = 15_000;
const MAX_RATE_LIMIT_WAIT_MS = 65_000;

const JSON_OBJECT_FALLBACK_PROMPT = `${SYSTEM_PROMPT} Respond with a single JSON object of the form {"segments":[{"title":string,"startSec":number,"endSec":number,"summary":string}]} and nothing else.`;

const HIGHLIGHT_JSON_OBJECT_FALLBACK_PROMPT = `${HIGHLIGHT_SYSTEM_PROMPT} Respond with a single JSON object of the form {"moments":[{"title":string,"startSec":number,"endSec":number,"summary":string,"score":number}]} and nothing else.`;

interface SuggestContext {
  language: string;
  durationSec: number;
  windows: TranscriptWindow[];
  cuts: CutPoint[];
}

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
    private readonly planner: ClipPlannerService,
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

  async suggest(
    userId: string,
    videoId: string,
    mode: AiClipMode = 'FULL',
  ): Promise<ReconciledTopicSegment[]> {
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
          select: { startSec: true, endSec: true, text: true, words: true },
        },
      },
    });
    if (!transcript?.segments.length) {
      throw new ConflictException(
        'Transcript must be ready before generating AI clips',
      );
    }

    // Word timings are only used to find pauses; the model reads plain text.
    const windows = this.windows.createWindows(
      transcript.segments.map(({ startSec, endSec, text }) => ({
        startSec,
        endSec,
        text,
      })),
    );
    const cuts = this.planner.buildCutPoints(
      transcript.segments,
      video.durationSec,
    );
    const context = {
      language: transcript.language,
      durationSec: video.durationSec,
      windows,
      cuts,
    };

    return mode === 'HIGHLIGHTS'
      ? this.suggestHighlights(context)
      : this.suggestFull(context);
  }

  private async suggestFull(context: SuggestContext) {
    const { language, durationSec, windows, cuts } = context;
    const candidates = (
      await this.mapWithConcurrency(windows, (window, index) =>
        this.validation.requestValidCandidates((attempt) =>
          this.requestWindow(
            'FULL',
            attempt,
            index,
            language,
            durationSec,
            window,
          ),
        ),
      )
    ).flat();

    if (candidates.length === 0) {
      throw new ConflictException('AI did not identify any clip topics');
    }

    const topics = this.reconciliation.reconcile(candidates, durationSec);
    const planned = this.planner.planFull(topics, cuts, durationSec, language);
    if (planned.length === 0) {
      throw new ConflictException('AI did not identify any clip topics');
    }
    return planned;
  }

  private async suggestHighlights(context: SuggestContext) {
    const { language, durationSec, windows, cuts } = context;
    const candidates = (
      await this.mapWithConcurrency(windows, (window, index) =>
        this.validation.requestValidHighlights((attempt) =>
          this.requestWindow(
            'HIGHLIGHTS',
            attempt,
            index,
            language,
            durationSec,
            window,
          ),
        ),
      )
    ).flat();

    const planned = this.planner.planHighlights(
      candidates,
      cuts,
      durationSec,
      language,
    );
    if (planned.length === 0) {
      throw new ConflictException(
        'AI did not find any standout moments in this episode',
      );
    }
    return planned;
  }

  private async requestWindow(
    mode: AiClipMode,
    attempt: number,
    windowIndex: number,
    language: string,
    videoDurationSec: number,
    window: { startSec: number; endSec: number; segments: unknown[] },
  ): Promise<unknown> {
    const useStrictSchema = attempt === 1;
    const highlights = mode === 'HIGHLIGHTS';
    const strictPrompt = highlights ? HIGHLIGHT_SYSTEM_PROMPT : SYSTEM_PROMPT;
    const fallbackPrompt = highlights
      ? HIGHLIGHT_JSON_OBJECT_FALLBACK_PROMPT
      : JSON_OBJECT_FALLBACK_PROMPT;

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
            content: useStrictSchema ? strictPrompt : fallbackPrompt,
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
                name: highlights ? 'highlight_moments' : 'topic_segments',
                strict: true,
                schema: highlights
                  ? HIGHLIGHT_RESPONSE_SCHEMA
                  : TOPIC_RESPONSE_SCHEMA,
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
