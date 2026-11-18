import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export interface FaceTrackPoint {
  timestamp?: number;
  box?: { x: number; y: number; w: number; h: number };
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface SpeakerTurn {
  speaker: string;
  startSec?: number;
  endSec?: number;
  start?: number;
  end?: number;
}

export interface ReframePlanInput {
  contentType?: string;
  faces?: FaceTrackPoint[];
  speakerTurns?: SpeakerTurn[];
}

export interface RenderPipelineOptions {
  sourceVideoPath: string;
  outputPath: string;
  startSec: number;
  endSec: number;
  layout?: 'AUTO' | 'STACKED';
  contentType?: 'SOLO' | 'PODCAST';
  reframePlan?: ReframePlanInput | null;
  assSubtitlePath?: string;
  fontsDir?: string;
  targetWidth?: number;
  targetHeight?: number;
  onProgress?: (progress: number) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface VideoProbeInfo {
  width: number;
  height: number;
  duration: number;
}

/**
 * Escapes file paths for FFmpeg filtergraph arguments on Windows/POSIX.
 * Replaces backslashes with forward slashes and escapes colons and single quotes.
 */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

interface FFprobeResult {
  streams?: Array<{
    width?: number;
    height?: number;
    duration?: string;
  }>;
}

@Injectable()
export class FfmpegRenderService {
  private readonly logger = new Logger(FfmpegRenderService.name);

  /**
   * Probes video file dimensions and duration via ffprobe.
   */
  async probeVideo(filePath: string): Promise<VideoProbeInfo> {
    return new Promise((resolve) => {
      const args = [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height,duration',
        '-of',
        'json',
        filePath,
      ];

      const proc = spawn('ffprobe', args);
      let stdout = '';

      proc.stdout.on('data', (data: Buffer | string) => {
        stdout += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && stdout) {
          try {
            const parsed = JSON.parse(stdout) as FFprobeResult;
            const stream = parsed.streams?.[0];
            if (stream?.width && stream?.height) {
              return resolve({
                width: Number(stream.width),
                height: Number(stream.height),
                duration: stream.duration ? Number(stream.duration) : 0,
              });
            }
          } catch {
            // fallback below
          }
        }
        // Safe default 16:9 standard resolution
        resolve({ width: 1920, height: 1080, duration: 0 });
      });

      proc.on('error', () => {
        resolve({ width: 1920, height: 1080, duration: 0 });
      });
    });
  }

  /**
   * Builds the FFmpeg filtergraph based on layout (SOLO, PODCAST STACKED, PODCAST AUTO).
   */
  buildFilterGraph(
    options: RenderPipelineOptions,
    srcWidth: number,
    srcHeight: number,
  ): { filterComplex: string; videoLabel: string; audioLabel: string } {
    const targetW = options.targetWidth ?? 1080;
    const targetH = options.targetHeight ?? 1920;
    const isPodcast = options.contentType === 'PODCAST';
    const isStacked = options.layout === 'STACKED';

    const defaultFontsDir = join(process.cwd(), 'assets', 'fonts');
    const fontsDir = options.fontsDir ?? defaultFontsDir;

    let subFilter = '';
    if (options.assSubtitlePath) {
      const escapedAss = escapeFilterPath(options.assSubtitlePath);
      const escapedFonts = escapeFilterPath(fontsDir);
      subFilter = `,ass='${escapedAss}':fontsdir='${escapedFonts}'`;
    }

    // 1. PODCAST STACKED LAYOUT
    if (
      isPodcast &&
      (isStacked || !options.reframePlan?.speakerTurns?.length)
    ) {
      const halfH = Math.round(targetH / 2); // 960
      const cropW = Math.min(
        srcWidth,
        Math.round((srcHeight * targetW) / targetH),
      );
      const leftX = 0;
      const rightX = Math.max(0, srcWidth - cropW);

      const filterComplex = [
        `[0:v]crop=${cropW}:${srcHeight}:${leftX}:0,scale=${targetW}:${halfH}[top]`,
        `[0:v]crop=${cropW}:${srcHeight}:${rightX}:0,scale=${targetW}:${halfH}[bottom]`,
        `[top][bottom]vstack[vstacked]`,
        `[vstacked]null${subFilter}[v_out]`,
        `[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[a_out]`,
      ].join(';');

      return { filterComplex, videoLabel: '[v_out]', audioLabel: '[a_out]' };
    }

    // 2. PODCAST AUTO (SPEAKER SWITCHING)
    if (
      isPodcast &&
      options.reframePlan?.speakerTurns &&
      options.reframePlan.speakerTurns.length > 0
    ) {
      const clipDuration = options.endSec - options.startSec;
      const cropW = Math.min(srcWidth, Math.round((srcHeight * 9) / 16));
      const leftX = 0;
      const rightX = Math.max(0, srcWidth - cropW);

      // Filter and map speaker turns relative to clip [0, clipDuration]
      const rawTurns = options.reframePlan.speakerTurns
        .map((t) => {
          const tStart = t.startSec ?? t.start ?? 0;
          const tEnd = t.endSec ?? t.end ?? 0;
          return {
            speaker: t.speaker,
            start: Math.max(
              0,
              Math.min(clipDuration, tStart - options.startSec),
            ),
            end: Math.max(0, Math.min(clipDuration, tEnd - options.startSec)),
          };
        })
        .filter((t) => t.end - t.start >= 0.5)
        .sort((a, b) => a.start - b.start);

      // Merge short turns < 1.0s or enforce minimum 1.5s shot duration
      const shots: Array<{ speaker: string; start: number; end: number }> = [];
      for (const turn of rawTurns) {
        if (shots.length === 0) {
          shots.push({ ...turn });
        } else {
          const prev = shots[shots.length - 1];
          if (turn.start < prev.end) {
            prev.end = Math.max(prev.end, turn.end);
          } else if (
            turn.end - turn.start < 1.0 ||
            (prev.end - prev.start < 1.5 && prev.speaker === turn.speaker)
          ) {
            prev.end = turn.end;
          } else {
            shots.push({ ...turn });
          }
        }
      }

      // If we have at least 2 shots, build switching concat filter
      if (shots.length >= 2) {
        const filters: string[] = [];
        const segmentLabels: string[] = [];

        shots.forEach((shot, idx) => {
          const isSecondSpeaker =
            shot.speaker === 'SPEAKER_01' ||
            shot.speaker === 'SPEAKER_1' ||
            shot.speaker === '2';
          const cropX = isSecondSpeaker ? rightX : leftX;
          const label = `vseg${idx}`;

          filters.push(
            `[0:v]trim=start=${shot.start.toFixed(2)}:end=${shot.end.toFixed(
              2,
            )},setpts=PTS-STARTPTS,crop=${cropW}:${srcHeight}:${cropX}:0,scale=${targetW}:${targetH}[${label}]`,
          );
          segmentLabels.push(`[${label}]`);
        });

        filters.push(
          `${segmentLabels.join('')}concat=n=${shots.length}:v=1:a=0[vswitched]`,
        );
        filters.push(`[vswitched]null${subFilter}[v_out]`);
        filters.push(`[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[a_out]`);

        return {
          filterComplex: filters.join(';'),
          videoLabel: '[v_out]',
          audioLabel: '[a_out]',
        };
      }
    }

    // 3. SOLO LAYOUT (Fixed Crop)
    const cropW = Math.min(
      srcWidth,
      Math.round((srcHeight * targetW) / targetH),
    );
    let cropX = Math.round((srcWidth - cropW) / 2); // default center

    // If faces detected, center on median X
    const faces = options.reframePlan?.faces;
    if (faces && faces.length > 0) {
      const xs: number[] = [];
      for (const f of faces) {
        const box = f.box;
        if (box && typeof box.x === 'number' && typeof box.w === 'number') {
          xs.push(box.x + box.w / 2);
        } else if (typeof f.x === 'number') {
          const w = typeof f.w === 'number' ? f.w : 0.2;
          xs.push(f.x + w / 2);
        }
      }

      if (xs.length > 0) {
        xs.sort((a, b) => a - b);
        const medianNormX = xs[Math.floor(xs.length / 2)];
        const facePixelX =
          medianNormX <= 1.0 ? medianNormX * srcWidth : medianNormX;
        cropX = Math.round(facePixelX - cropW / 2);
      }
    }

    // Clamp cropX
    cropX = Math.max(0, Math.min(srcWidth - cropW, cropX));

    const filterComplex = [
      `[0:v]crop=${cropW}:${srcHeight}:${cropX}:0,scale=${targetW}:${targetH}${subFilter}[v_out]`,
      `[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[a_out]`,
    ].join(';');

    return { filterComplex, videoLabel: '[v_out]', audioLabel: '[a_out]' };
  }

  /**
   * Executes the render pipeline with real-time progress parsing and abort signal handling.
   */
  async renderClip(
    options: RenderPipelineOptions,
  ): Promise<{ outputPath: string }> {
    const probe = await this.probeVideo(options.sourceVideoPath);
    const { filterComplex, videoLabel, audioLabel } = this.buildFilterGraph(
      options,
      probe.width,
      probe.height,
    );

    const totalDuration = Math.max(1, options.endSec - options.startSec);

    const ffmpegArgs = [
      '-y',
      '-ss',
      options.startSec.toString(),
      '-to',
      options.endSec.toString(),
      '-i',
      options.sourceVideoPath,
      '-filter_complex',
      filterComplex,
      '-map',
      videoLabel,
      '-map',
      audioLabel,
      '-c:v',
      'libx264',
      '-crf',
      '20',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      options.outputPath,
    ];

    return new Promise<{ outputPath: string }>((resolve, reject) => {
      let isSettled = false;
      let lastProgressCall = 0;

      const proc = spawn('ffmpeg', ffmpegArgs);

      let stderrOutput = '';

      // Handle cancellation via AbortSignal
      if (options.signal) {
        if (options.signal.aborted) {
          isSettled = true;
          try {
            proc.kill('SIGKILL');
          } catch {
            // ignore
          }
          return reject(new Error('Render cancelled by user'));
        }

        options.signal.addEventListener('abort', () => {
          if (!isSettled) {
            isSettled = true;
            try {
              proc.kill('SIGKILL');
            } catch {
              // ignore
            }
            reject(new Error('Render cancelled by user'));
          }
        });
      }

      // Parse progress from stdout
      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        const parts = line.split('=');
        if (parts.length === 2 && parts[0] === 'out_time_us') {
          const us = Number(parts[1]);
          if (!Number.isNaN(us) && us > 0) {
            const currentSec = us / 1_000_000;
            const percent = Math.min(
              99,
              Math.max(1, Math.round((currentSec / totalDuration) * 100)),
            );

            const now = Date.now();
            if (options.onProgress && now - lastProgressCall >= 800) {
              lastProgressCall = now;
              try {
                void options.onProgress(percent);
              } catch {
                // ignore progress errors
              }
            }
          }
        }
      });

      proc.stderr.on('data', (chunk: Buffer | string) => {
        stderrOutput += chunk.toString();
        if (stderrOutput.length > 5000) {
          stderrOutput = stderrOutput.slice(-5000);
        }
      });

      proc.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
        }
      });

      proc.on('close', (code) => {
        if (isSettled) return;
        isSettled = true;

        if (code === 0) {
          if (options.onProgress) {
            try {
              void options.onProgress(100);
            } catch {
              // ignore
            }
          }
          resolve({ outputPath: options.outputPath });
        } else {
          this.logger.error(
            `FFmpeg exited with code ${code}. Stderr: ${stderrOutput}`,
          );
          reject(
            new Error(
              `FFmpeg render process failed with exit code ${code}: ${stderrOutput.slice(
                -400,
              )}`,
            ),
          );
        }
      });
    });
  }

  /**
   * Extracts a single video frame as a JPEG image at the given timestamp.
   */
  async extractThumbnail(
    inputPathOrUrl: string,
    outputPath: string,
    timestampSec: number,
  ): Promise<void> {
    const sec = Math.max(0, Number(timestampSec) || 0).toFixed(3);
    const args = [
      '-y',
      '-ss',
      sec,
      '-i',
      inputPathOrUrl,
      '-frames:v',
      '1',
      '-update',
      '1',
      '-q:v',
      '2',
      outputPath,
    ];

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      let stderr = '';

      proc.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        reject(
          new Error(`Failed to spawn ffmpeg for thumbnail: ${err.message}`),
        );
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          this.logger.error(
            `FFmpeg thumbnail extraction failed (${code}): ${stderr}`,
          );
          reject(
            new Error(
              `FFmpeg thumbnail extraction failed with exit code ${code}: ${stderr.slice(
                -300,
              )}`,
            ),
          );
        }
      });
    });
  }
}
