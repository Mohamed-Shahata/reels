import { Test, TestingModule } from '@nestjs/testing';
import { TranscriptionService } from '../../../src/transcription/transcription.service';
import { StorageService } from '../../../src/storage/storage.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm, stat } from 'node:fs/promises';
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
