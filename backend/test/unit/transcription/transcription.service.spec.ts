import { Test, TestingModule } from '@nestjs/testing';
import { TranscriptionService } from '../../../src/transcription/transcription.service';
import { StorageService } from '../../../src/storage/storage.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';

describe('TranscriptionService', () => {
  let service: TranscriptionService;
  let storageService: jest.Mocked<StorageService>;
  let prismaService: jest.Mocked<PrismaService>;
  const tempDir = join(tmpdir(), 'podcast-reels');

  beforeEach(async () => {
    storageService = {
      getAudioDownloadUrl: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;

    prismaService = {
      $transaction: jest.fn(),
      transcript: { upsert: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscriptionService,
        { provide: StorageService, useValue: storageService },
        { provide: PrismaService, useValue: prismaService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-groq-key'),
          },
        },
      ],
    }).compile();

    service = module.get<TranscriptionService>(TranscriptionService);
    global.fetch = jest.fn();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('extractAudio', () => {
    it('should download audio from Cloudinary', async () => {
      const videoId = 'video-1';
      const cloudinaryId = 'cloud-1';
      const url = 'https://cloudinary.com/audio.mp3';

      storageService.getAudioDownloadUrl.mockReturnValue(url);

      const testBuffer = Buffer.from('test audio content');

      const mockBody = { getReader: jest.fn() };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        body: mockBody,
      });

      jest
        .spyOn(Readable, 'fromWeb')
        .mockReturnValue(Readable.from(testBuffer));

      const result = await service.extractAudio(videoId, cloudinaryId);
      expect(result).toBe(join(tempDir, `${videoId}.mp3`));

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(storageService.getAudioDownloadUrl).toHaveBeenCalledWith(
        cloudinaryId,
      );
      expect(global.fetch).toHaveBeenCalledWith(url);

      const fileStat = await stat(result);
      expect(fileStat.size).toBe(testBuffer.length);
    });
  });

  describe('chunkAudio', () => {
    it('should split audio into chunks with overlap', async () => {
      const audioPath = 'dummy.mp3';
      const videoId = 'video-2';
      const duration = 1250;

      jest
        .spyOn(
          service as unknown as Record<string, jest.Mock>,
          'getAudioDuration',
        )
        .mockResolvedValue(duration);
      jest
        .spyOn(service as unknown as Record<string, jest.Mock>, 'extractChunk')
        .mockResolvedValue(undefined);

      const chunks = await service.chunkAudio(audioPath, videoId);

      expect(chunks.length).toBe(3);
      expect(chunks[0]).toMatchObject({ startSec: 0, endSec: 600 });
      expect(chunks[1]).toMatchObject({ startSec: 590, endSec: 1190 });
      expect(chunks[2]).toMatchObject({ startSec: 1180, endSec: 1250 });
    });

    it('should handle video shorter than one chunk', async () => {
      jest
        .spyOn(
          service as unknown as Record<string, jest.Mock>,
          'getAudioDuration',
        )
        .mockResolvedValue(300);
      jest
        .spyOn(service as unknown as Record<string, jest.Mock>, 'extractChunk')
        .mockResolvedValue(undefined);

      const chunks = await service.chunkAudio('short.mp3', 'video-3');

      expect(chunks.length).toBe(1);
      expect(chunks[0]).toMatchObject({ startSec: 0, endSec: 300 });
    });
  });

  describe('mergeAndStore', () => {
    it('should deduplicate overlap segments and store in order', async () => {
      const chunks = [
        { filePath: 'c0.mp3', startSec: 0, endSec: 600 },
        { filePath: 'c1.mp3', startSec: 590, endSec: 1190 },
      ];

      const chunkSegments = [
        [
          { start: 10, end: 20, text: 'Hello world' },
          { start: 590, end: 600, text: 'overlap segment' },
        ],
        [
          { start: 0, end: 10, text: 'overlap segment' },
          { start: 50, end: 60, text: 'new content' },
        ],
      ];

      const captured: unknown[] = [];
      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: unknown) => Promise<void>) => {
          const fakeTx = {
            transcript: {
              upsert: jest.fn().mockImplementation((args: unknown) => {
                captured.push(args);
                return Promise.resolve({});
              }),
            },
          };
          return fn(fakeTx);
        },
      );

      await service.mergeAndStore('video-4', chunks, chunkSegments, 'ar');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(captured.length).toBe(1);
    });
  });

  describe('word timestamps', () => {
    const chunkPath = join(tmpdir(), 'podcast-reels-word-test.mp3');

    beforeEach(async () => {
      await writeFile(chunkPath, Buffer.from('audio'));
    });

    afterEach(async () => {
      await rm(chunkPath, { force: true });
    });

    function mockGroq(response: unknown) {
      const create = jest.fn().mockResolvedValue(response);
      (service as unknown as { groq: unknown }).groq = {
        audio: { transcriptions: { create } },
      };
      return create;
    }

    it('requests word and segment timestamps', async () => {
      const create = mockGroq({ segments: [], words: [] });

      await (
        service as unknown as {
          transcribeChunk: (
            chunk: unknown,
            language: string,
          ) => Promise<unknown>;
        }
      ).transcribeChunk({ filePath: chunkPath, startSec: 0, endSec: 60 }, 'ar');

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: 'verbose_json',
          timestamp_granularities: ['word', 'segment'],
          language: 'ar',
        }),
      );
    });

    it('attaches each word to the segment that contains it', async () => {
      mockGroq({
        segments: [
          { start: 0, end: 5, text: 'hello world' },
          { start: 5, end: 9, text: 'again' },
        ],
        words: [
          { word: 'hello', start: 0.1, end: 0.5 },
          { word: 'world', start: 0.6, end: 1 },
          { word: 'again', start: 5.2, end: 5.8 },
        ],
      });

      const result = await (
        service as unknown as {
          transcribeChunk: (
            chunk: unknown,
            language: string,
          ) => Promise<{ words: { word: string }[] }[]>;
        }
      ).transcribeChunk({ filePath: chunkPath, startSec: 0, endSec: 60 }, 'ar');

      expect(result[0].words.map((w) => w.word)).toEqual(['hello', 'world']);
      expect(result[1].words.map((w) => w.word)).toEqual(['again']);
    });

    it('attaches a word just outside a segment and drops a distant one', async () => {
      mockGroq({
        segments: [{ start: 0, end: 5, text: 'hello' }],
        words: [
          { word: 'hello', start: 0.1, end: 0.5 },
          { word: 'near', start: 5.3, end: 5.7 },
          { word: 'far', start: 20, end: 20.4 },
        ],
      });

      const result = await (
        service as unknown as {
          transcribeChunk: (
            chunk: unknown,
            language: string,
          ) => Promise<{ words: { word: string }[] }[]>;
        }
      ).transcribeChunk({ filePath: chunkPath, startSec: 0, endSec: 60 }, 'ar');

      expect(result[0].words.map((w) => w.word)).toEqual(['hello', 'near']);
    });

    it('keeps segments unchanged when Groq returns no words', async () => {
      mockGroq({ segments: [{ start: 0, end: 5, text: 'hello' }] });

      const result = await (
        service as unknown as {
          transcribeChunk: (
            chunk: unknown,
            language: string,
          ) => Promise<unknown>;
        }
      ).transcribeChunk({ filePath: chunkPath, startSec: 0, endSec: 60 }, 'ar');

      expect(result).toEqual([{ start: 0, end: 5, text: 'hello' }]);
    });

    it('stores words with absolute video timestamps', async () => {
      const chunks = [
        { filePath: 'c0.mp3', startSec: 0, endSec: 600 },
        { filePath: 'c1.mp3', startSec: 590, endSec: 1190 },
      ];
      const chunkSegments = [
        [
          {
            start: 10,
            end: 20,
            text: 'Hello world',
            words: [
              { word: ' Hello', start: 10.25, end: 10.5 },
              { word: 'world ', start: 10.75, end: 11 },
            ],
          },
        ],
        [
          {
            start: 50,
            end: 60,
            text: 'new content',
            words: [
              { word: 'new', start: 50.0004, end: 50.5 },
              { word: 'content', start: 51, end: 52 },
              { word: '  ', start: 52, end: 53 },
              { word: 'inverted', start: 55, end: 54 },
            ],
          },
          { start: 70, end: 75, text: 'no words' },
        ],
      ];

      const captured: {
        create: { segments: { create: Record<string, unknown>[] } };
      }[] = [];
      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: unknown) => Promise<void>) =>
          fn({
            transcript: {
              upsert: jest.fn().mockImplementation((args: never) => {
                captured.push(args);
                return Promise.resolve({});
              }),
            },
          }),
      );

      await service.mergeAndStore('video-5', chunks, chunkSegments, 'ar');

      const rows = captured[0].create.segments.create;
      expect(rows).toEqual([
        {
          startSec: 10,
          endSec: 20,
          text: 'Hello world',
          words: [
            { word: 'Hello', startSec: 10.25, endSec: 10.5 },
            { word: 'world', startSec: 10.75, endSec: 11 },
          ],
        },
        {
          startSec: 640,
          endSec: 650,
          text: 'new content',
          words: [
            { word: 'new', startSec: 640, endSec: 640.5 },
            { word: 'content', startSec: 641, endSec: 642 },
          ],
        },
        { startSec: 660, endSec: 665, text: 'no words', words: undefined },
      ]);
    });
  });

  describe('transcribeChunks retry', () => {
    beforeEach(() => {
      jest
        .spyOn(service as unknown as Record<string, jest.Mock>, 'sleep')
        .mockResolvedValue(undefined);
    });

    it('should retry on failure and eventually succeed', async () => {
      const chunks = [{ filePath: 'c.mp3', startSec: 0, endSec: 300 }];

      let attempt = 0;
      jest
        .spyOn(
          service as unknown as Record<string, jest.Mock>,
          'transcribeChunk',
        )
        .mockImplementation(() => {
          attempt++;
          if (attempt < 3) return Promise.reject(new Error('Network error'));
          return Promise.resolve([{ start: 0, end: 5, text: 'hello' }]);
        });

      const results = await service.transcribeChunks(chunks, 'ar');

      expect(results[0]).toHaveLength(1);
      expect(attempt).toBe(3);
    });

    it('should throw after max attempts', async () => {
      const chunks = [{ filePath: 'c.mp3', startSec: 0, endSec: 300 }];

      jest
        .spyOn(
          service as unknown as Record<string, jest.Mock>,
          'transcribeChunk',
        )
        .mockRejectedValue(new Error('Persistent error'));

      await expect(service.transcribeChunks(chunks, 'ar')).rejects.toThrow(
        'failed after',
      );
    });
  });
});
