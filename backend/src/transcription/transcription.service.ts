import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import ffmpeg from 'fluent-ffmpeg';
import Groq from 'groq-sdk';
import type { Env } from '../config/env.schema';

export interface AudioChunk {
  filePath: string;
  startSec: number;
  endSec: number;
}

interface GroqWord {
  word: string;
  start: number;
  end: number;
}

interface GroqSegment {
  start: number;
  end: number;
  text: string;
  words?: GroqWord[];
}

// A type alias (not an interface) so it is assignable to Prisma's JSON input.
export type TranscriptWord = {
  word: string;
  startSec: number;
  endSec: number;
};

interface MergedSegment {
  startSec: number;
  endSec: number;
  text: string;
  words?: TranscriptWord[];
}

const CHUNK_DURATION_SEC = 600;
const OVERLAP_SEC = 10;
const MAX_GROQ_ATTEMPTS = 4;
const GROQ_INITIAL_DELAY_MS = 1000;
// A word whose midpoint falls outside every segment is attached to the nearest
// segment only when it is at most this far away.
const WORD_ATTACH_TOLERANCE_SEC = 1;

function roundToMillis(value: number): number {
  return Math.round(value * 1000) / 1000;
}

@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly groq: Groq;

  constructor(
    config: ConfigService<Env, true>,
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
  ) {
    this.groq = new Groq({
      apiKey: config.get('GROQ_API_KEY', { infer: true }),
    });
  }

  // ─── 5.2 Audio Extraction ──────────────────────────────────────────────────

  async extractAudio(videoId: string, cloudinaryId: string): Promise<string> {
    const url = this.storageService.getAudioDownloadUrl(cloudinaryId);
    this.logger.debug(`Downloading audio for video ${videoId}`);

    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new Error(
        `Failed to fetch audio from Cloudinary: ${res.status} ${res.statusText}`,
      );
    }

    const tempDir = join(tmpdir(), 'podcast-reels');
    await mkdir(tempDir, { recursive: true });

    const outputPath = join(tempDir, `${videoId}.mp3`);

    // @ts-expect-error Node.js Readable.fromWeb types might not perfectly match fetch body
    const readable = Readable.fromWeb(res.body);
    const writable = createWriteStream(outputPath);

    await pipeline(readable, writable);

    this.logger.debug(`Audio saved to ${outputPath}`);
    return outputPath;
  }

  // ─── 5.3 Audio Chunking ────────────────────────────────────────────────────

  async chunkAudio(audioPath: string, videoId: string): Promise<AudioChunk[]> {
    const duration = await this.getAudioDuration(audioPath);
    const chunks: AudioChunk[] = [];

    let currentStart = 0;
    let chunkIndex = 0;

    const tempDir = join(tmpdir(), 'podcast-reels', videoId);
    await mkdir(tempDir, { recursive: true });

    this.logger.debug(`Chunking ${audioPath} (${duration}s)`);

    while (currentStart < duration) {
      const currentEnd = Math.min(currentStart + CHUNK_DURATION_SEC, duration);
      const outPath = join(tempDir, `chunk-${chunkIndex}.mp3`);

      await this.extractChunk(
        audioPath,
        outPath,
        currentStart,
        currentEnd - currentStart,
      );

      chunks.push({
        filePath: outPath,
        startSec: currentStart,
        endSec: currentEnd,
      });

      if (currentEnd >= duration) break;

      currentStart = currentEnd - OVERLAP_SEC;
      chunkIndex++;
    }

    this.logger.debug(`Created ${chunks.length} chunks for video ${videoId}`);
    return chunks;
  }

  // ─── 5.4 + 5.5 Groq Transcription with retry ──────────────────────────────

  async transcribeChunks(
    chunks: AudioChunk[],
    language: string,
    onProgress?: (progress: number) => Promise<void>,
  ): Promise<GroqSegment[][]> {
    const results: GroqSegment[][] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const segments = await this.transcribeChunkWithRetry(chunk, language);
      results.push(segments);

      if (onProgress) {
        const fraction = (i + 1) / chunks.length;
        // Transcription phase is between 10% and 90%
        const progress = 10 + fraction * 80;
        await onProgress(progress).catch((err) =>
          this.logger.warn(`Failed to report progress: ${err}`),
        );
      }
    }

    return results;
  }

  private async transcribeChunkWithRetry(
    chunk: AudioChunk,
    language: string,
  ): Promise<GroqSegment[]> {
    let attempt = 0;
    let delayMs = GROQ_INITIAL_DELAY_MS;

    while (attempt < MAX_GROQ_ATTEMPTS) {
      try {
        return await this.transcribeChunk(chunk, language);
      } catch (error) {
        attempt++;
        const isRateLimit =
          error instanceof Error &&
          (error.message.includes('429') ||
            error.message.toLowerCase().includes('rate'));

        if (attempt >= MAX_GROQ_ATTEMPTS) {
          throw new Error(
            `Chunk ${chunk.filePath} failed after ${MAX_GROQ_ATTEMPTS} attempts: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        const wait = isRateLimit ? delayMs * 4 : delayMs;
        this.logger.warn(
          `Chunk ${chunk.filePath} attempt ${attempt} failed, retrying in ${wait}ms`,
        );
        await this.sleep(wait);
        delayMs = Math.min(delayMs * 2, 30000);
      }
    }

    return [];
  }

  private async transcribeChunk(
    chunk: AudioChunk,
    language: string,
  ): Promise<GroqSegment[]> {
    const fileBuffer = await readFile(chunk.filePath);
    const file = new File([fileBuffer], 'audio.mp3', { type: 'audio/mpeg' });

    const response = await this.groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3',
      language,
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });

    const body = response as unknown as {
      segments?: GroqSegment[];
      words?: GroqWord[];
    };
    return this.attachWordsToSegments(body.segments ?? [], body.words ?? []);
  }

  // Groq returns words as one flat list for the whole chunk. Each word is
  // attached to the segment that contains its midpoint so the existing
  // segment-level overlap handling also decides which words are kept.
  private attachWordsToSegments(
    segments: GroqSegment[],
    words: GroqWord[],
  ): GroqSegment[] {
    if (words.length === 0) {
      return segments;
    }

    const result = segments.map((segment) => ({
      ...segment,
      words: [] as GroqWord[],
    }));

    for (const word of words) {
      if (
        typeof word.word !== 'string' ||
        !Number.isFinite(word.start) ||
        !Number.isFinite(word.end)
      ) {
        continue;
      }

      const midpoint = (word.start + word.end) / 2;
      let target = result.find(
        (segment) => midpoint >= segment.start && midpoint <= segment.end,
      );

      if (!target) {
        let bestDistance = WORD_ATTACH_TOLERANCE_SEC;
        for (const segment of result) {
          const distance =
            midpoint < segment.start
              ? segment.start - midpoint
              : midpoint - segment.end;
          if (distance <= bestDistance) {
            bestDistance = distance;
            target = segment;
          }
        }
      }

      target?.words.push(word);
    }

    return result;
  }

  // ─── 5.6 Merge & Storage ───────────────────────────────────────────────────

  async mergeAndStore(
    videoId: string,
    chunks: AudioChunk[],
    chunkSegments: GroqSegment[][],
    language: string,
  ): Promise<void> {
    const merged = this.mergeChunkSegments(chunks, chunkSegments);

    const rows = merged.map((s) => ({
      startSec: s.startSec,
      endSec: s.endSec,
      text: s.text,
      // Segments without word timestamps keep the column empty so subtitles can
      // tell exact timing from estimated timing.
      words: s.words && s.words.length > 0 ? s.words : undefined,
    }));

    await this.prisma.$transaction(async (tx) => {
      await tx.transcript.upsert({
        where: { videoId },
        create: {
          videoId,
          language,
          segments: { create: rows },
        },
        update: {
          language,
          segments: {
            deleteMany: {},
            create: rows,
          },
        },
      });
    });

    this.logger.debug(`Stored ${merged.length} segments for video ${videoId}`);
  }

  private mergeChunkSegments(
    chunks: AudioChunk[],
    chunkSegments: GroqSegment[][],
  ): MergedSegment[] {
    const merged: MergedSegment[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const segments = chunkSegments[i];
      const isLast = i === chunks.length - 1;

      for (const seg of segments) {
        const absoluteStart = chunk.startSec + seg.start;
        const absoluteEnd = chunk.startSec + seg.end;

        // Skip overlap: only keep segments that start before the overlap boundary
        // (except for the last chunk which keeps everything)
        if (!isLast && absoluteStart >= chunk.endSec - OVERLAP_SEC) {
          continue;
        }

        const text = seg.text?.trim() ?? '';
        if (text.length === 0 || absoluteEnd <= absoluteStart) {
          continue;
        }

        // Deduplicate: skip if this segment already exists in merged (overlap region)
        const isDuplicate = merged.some(
          (m) =>
            Math.abs(m.startSec - absoluteStart) < 0.5 &&
            m.text.trim() === text,
        );

        if (!isDuplicate) {
          merged.push({
            startSec: absoluteStart,
            endSec: absoluteEnd,
            text,
            words: this.toAbsoluteWords(seg.words, chunk.startSec),
          });
        }
      }
    }

    return merged.sort((a, b) => a.startSec - b.startSec);
  }

  // Chunk-relative Groq words become absolute video timestamps rounded to the
  // millisecond, dropping empty or inverted entries.
  private toAbsoluteWords(
    words: GroqWord[] | undefined,
    chunkStartSec: number,
  ): TranscriptWord[] | undefined {
    if (!words || words.length === 0) {
      return undefined;
    }

    const absolute: TranscriptWord[] = [];
    for (const raw of words) {
      const word = typeof raw.word === 'string' ? raw.word.trim() : '';
      const startSec = roundToMillis(chunkStartSec + raw.start);
      const endSec = roundToMillis(chunkStartSec + raw.end);

      if (
        word.length === 0 ||
        !Number.isFinite(startSec) ||
        !Number.isFinite(endSec) ||
        endSec < startSec
      ) {
        continue;
      }

      absolute.push({ word, startSec, endSec });
    }

    return absolute.length > 0
      ? absolute.sort((a, b) => a.startSec - b.startSec)
      : undefined;
  }

  async cleanupTempFiles(videoId: string, audioPath: string): Promise<void> {
    try {
      await rm(audioPath, { force: true });
      await rm(join(tmpdir(), 'podcast-reels', videoId), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      this.logger.warn(
        `Cleanup failed for video ${videoId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err)
          return reject(err instanceof Error ? err : new Error(String(err)));
        const duration = metadata.format.duration;
        if (!duration)
          return reject(new Error('Could not determine audio duration'));
        resolve(duration);
      });
    });
  }

  private extractChunk(
    input: string,
    output: string,
    start: number,
    duration: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(input)
        .setStartTime(start)
        .setDuration(duration)
        .output(output)
        .on('end', () => resolve())
        .on('error', (err) =>
          reject(err instanceof Error ? err : new Error(String(err))),
        )
        .run();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
