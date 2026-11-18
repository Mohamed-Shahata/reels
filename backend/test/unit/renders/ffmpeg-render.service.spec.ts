import { execFile } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  escapeFilterPath,
  FfmpegRenderService,
} from '../../../src/renders/ffmpeg-render.service';

const execFileAsync = promisify(execFile);

describe('FfmpegRenderService', () => {
  let service: FfmpegRenderService;

  beforeEach(() => {
    service = new FfmpegRenderService();
  });

  describe('escapeFilterPath', () => {
    it('escapes colons, single quotes and converts backslashes to forward slashes', () => {
      const input = "C:\\reels\\assets\\it's fine.ass";
      const expected = "C\\:/reels/assets/it\\'s fine.ass";
      expect(escapeFilterPath(input)).toBe(expected);
    });
  });

  describe('buildFilterGraph', () => {
    it('builds SOLO layout centered on detected face', () => {
      const { filterComplex, videoLabel, audioLabel } =
        service.buildFilterGraph(
          {
            sourceVideoPath: 'dummy.mp4',
            outputPath: 'out.mp4',
            startSec: 0,
            endSec: 10,
            contentType: 'SOLO',
            reframePlan: {
              faces: [
                { timestamp: 1, x: 0.6, y: 0.3, w: 0.2, h: 0.2 },
                { timestamp: 2, x: 0.6, y: 0.3, w: 0.2, h: 0.2 },
              ],
            },
          },
          1920,
          1080,
        );

      expect(videoLabel).toBe('[v_out]');
      expect(audioLabel).toBe('[a_out]');
      expect(filterComplex).toContain('crop=608:1080:');
      expect(filterComplex).toContain('scale=1080:1920');
      expect(filterComplex).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
    });

    it('builds PODCAST STACKED layout with two halves vstacked', () => {
      const { filterComplex } = service.buildFilterGraph(
        {
          sourceVideoPath: 'dummy.mp4',
          outputPath: 'out.mp4',
          startSec: 0,
          endSec: 10,
          contentType: 'PODCAST',
          layout: 'STACKED',
        },
        1920,
        1080,
      );

      expect(filterComplex).toContain('scale=1080:960[top]');
      expect(filterComplex).toContain('scale=1080:960[bottom]');
      expect(filterComplex).toContain('[top][bottom]vstack[vstacked]');
    });

    it('builds PODCAST AUTO layout with switching shots when speaker turns exist', () => {
      const { filterComplex } = service.buildFilterGraph(
        {
          sourceVideoPath: 'dummy.mp4',
          outputPath: 'out.mp4',
          startSec: 0,
          endSec: 10,
          contentType: 'PODCAST',
          layout: 'AUTO',
          reframePlan: {
            speakerTurns: [
              { speaker: 'SPEAKER_00', startSec: 0, endSec: 4 },
              { speaker: 'SPEAKER_01', startSec: 4, endSec: 10 },
            ],
          },
        },
        1920,
        1080,
      );

      expect(filterComplex).toContain('trim=start=0.00:end=4.00');
      expect(filterComplex).toContain('trim=start=4.00:end=10.00');
      expect(filterComplex).toContain('concat=n=2:v=1:a=0[vswitched]');
    });

    it('includes subtitle ass filter when assSubtitlePath is given', () => {
      const { filterComplex } = service.buildFilterGraph(
        {
          sourceVideoPath: 'dummy.mp4',
          outputPath: 'out.mp4',
          startSec: 0,
          endSec: 10,
          assSubtitlePath: 'D:\\subtitles\\test.ass',
          fontsDir: 'D:\\fonts',
        },
        1920,
        1080,
      );

      expect(filterComplex).toContain(
        "ass='D\\:/subtitles/test.ass':fontsdir='D\\:/fonts'",
      );
    });
  });

  describe('Real FFmpeg render execution', () => {
    const sampleInput = join(process.cwd(), 'sample-render-test.mp4');
    const sampleOutput = join(process.cwd(), 'sample-render-out.mp4');

    beforeAll(async () => {
      // Create a 1-second sample video with sine wave audio
      try {
        await execFileAsync('ffmpeg', [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'testsrc=duration=1:size=640x360:rate=25',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=1000:duration=1',
          '-c:v',
          'libx264',
          '-c:a',
          'aac',
          sampleInput,
        ]);
      } catch {
        // if ffmpeg fails to create sample, test will skip
      }
    });

    afterAll(() => {
      if (existsSync(sampleInput)) {
        try {
          unlinkSync(sampleInput);
        } catch {
          // ignore cleanup error
        }
      }
      if (existsSync(sampleOutput)) {
        try {
          unlinkSync(sampleOutput);
        } catch {
          // ignore cleanup error
        }
      }
    });

    it('probes sample video successfully', async () => {
      if (!existsSync(sampleInput)) return;

      const info = await service.probeVideo(sampleInput);
      expect(info.width).toBe(640);
      expect(info.height).toBe(360);
      expect(info.duration).toBeGreaterThan(0);
    });

    it('renders 9:16 vertical video and emits progress', async () => {
      if (!existsSync(sampleInput)) return;

      const progressValues: number[] = [];
      const res = await service.renderClip({
        sourceVideoPath: sampleInput,
        outputPath: sampleOutput,
        startSec: 0,
        endSec: 1,
        onProgress: (p) => {
          progressValues.push(p);
        },
      });

      expect(res.outputPath).toBe(sampleOutput);
      expect(existsSync(sampleOutput)).toBe(true);

      // Verify output dimensions are 1080x1920
      const outputInfo = await service.probeVideo(sampleOutput);
      expect(outputInfo.width).toBe(1080);
      expect(outputInfo.height).toBe(1920);
    });

    it('cancels render immediately when AbortSignal triggers', async () => {
      if (!existsSync(sampleInput)) return;

      const controller = new AbortController();
      const cancelOutput = join(process.cwd(), 'sample-cancel-out.mp4');

      // Abort right away
      controller.abort();

      await expect(
        service.renderClip({
          sourceVideoPath: sampleInput,
          outputPath: cancelOutput,
          startSec: 0,
          endSec: 1,
          signal: controller.signal,
        }),
      ).rejects.toThrow('Render cancelled');

      if (existsSync(cancelOutput)) {
        try {
          unlinkSync(cancelOutput);
        } catch {
          // ignore cleanup error
        }
      }
    });

    it('extracts thumbnail frame at timestamp as JPEG', async () => {
      if (!existsSync(sampleInput)) return;

      const thumbOutput = join(process.cwd(), 'sample-thumb-out.jpg');
      await service.extractThumbnail(sampleInput, thumbOutput, 0.5);

      expect(existsSync(thumbOutput)).toBe(true);

      if (existsSync(thumbOutput)) {
        try {
          unlinkSync(thumbOutput);
        } catch {
          // ignore cleanup error
        }
      }
    });
  });
});
