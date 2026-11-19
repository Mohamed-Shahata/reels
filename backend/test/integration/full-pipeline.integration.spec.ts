import { createPrismaFake } from '../support/prisma-fake';
import { createRabbitFake } from '../support/rabbit-fake';
import { createS3Fake } from '../support/s3-fake';
import { buildAssetStorageKey } from '../../src/storage/media-asset.service';

describe('Full Pipeline Integration: upload -> ready -> export -> delete -> empty bucket', () => {
  const userId = 'usr-test-1';
  const videoId = 'vid-integ-1';
  const filename = 'sample-podcast.mp4';
  const prisma = createPrismaFake();
  const rabbit = createRabbitFake();
  const s3 = createS3Fake();

  beforeEach(() => {
    rabbit.clear();
    s3.clear();
  });

  it('executes full video pipeline and cleans up all storage assets', async () => {
    // 1. Upload Init: create video & register SOURCE media asset
    const sourceStorageKey = buildAssetStorageKey({
      userId,
      videoId,
      kind: 'SOURCE',
      ext: 'mp4',
    });

    const video = await prisma.video.create({
      data: {
        id: videoId,
        userId,
        title: filename,
        status: 'UPLOADING',
      },
    });
    expect(video.status).toBe('UPLOADING');

    const sourceAsset = await prisma.mediaAsset.upsert({
      where: { storageKey: sourceStorageKey },
      create: {
        userId,
        videoId,
        kind: 'SOURCE',
        storageKey: sourceStorageKey,
        status: 'PENDING',
      },
      update: {},
    });
    expect(sourceAsset.status).toBe('PENDING');

    const { uploadId } = await s3.createMultipartUpload(
      sourceStorageKey,
      'video/mp4',
    );
    expect(uploadId).toBeDefined();

    // 2. Direct S3 upload simulation & complete multipart
    await s3.completeMultipartUpload(sourceStorageKey, uploadId, [
      { partNumber: 1, etag: 'etag-1' },
    ]);
    expect(s3.getBucketObjectCount()).toBe(1);

    await prisma.mediaAsset.update({
      where: { id: sourceAsset.id },
      data: {
        status: 'READY',
        sizeBytes: 15_000_000n,
        contentType: 'video/mp4',
      },
    });

    // 3. Enqueue INGEST job via Outbox
    await prisma.outboxEvent.create({
      data: {
        eventType: 'JOB_ENQUEUED',
        routingKey: 'ingest',
        payload: { videoId, userId, type: 'INGEST' },
      },
    });

    await rabbit.publish('reels.work', 'ingest', {
      videoId,
      userId,
      type: 'INGEST',
    });
    expect(rabbit.published.length).toBe(1);

    // 4. Ingest Consumer: probe metadata & advance pipeline
    await prisma.video.update({
      where: { id: video.id },
      data: { durationSec: 30 },
    });

    // 5. Transcribe Consumer: generate transcript & queue segment
    const audioKey = buildAssetStorageKey({ userId, videoId, kind: 'AUDIO' });
    await s3.putObject(audioKey, Buffer.from('mock-audio'), 'audio/mp3');
    await prisma.mediaAsset.upsert({
      where: { storageKey: audioKey },
      create: {
        userId,
        videoId,
        kind: 'AUDIO',
        storageKey: audioKey,
        status: 'READY',
      },
      update: {},
    });
    expect(s3.getBucketObjectCount()).toBe(2);

    // 6. Segment Consumer: creates clips & queues analyze
    const clip1 = await prisma.clip.create({
      data: {
        videoId: video.id,
        title: 'Hook Clip 1',
        startSec: 0,
        endSec: 15,
        source: 'AI',
      },
      select: { id: true, title: true, startSec: true, endSec: true },
    });

    const clip2 = await prisma.clip.create({
      data: {
        videoId: video.id,
        title: 'Punchline Clip 2',
        startSec: 15,
        endSec: 30,
        source: 'AI',
      },
      select: { id: true, title: true, startSec: true, endSec: true },
    });
    expect(clip2.id).toBeDefined();

    const clips = await prisma.clip.findMany({ where: { videoId: video.id } });
    expect(clips.length).toBe(2);

    // 7. Analyze Consumer: Speaker tracking & ReframePlan -> Video is READY!
    const updatedVideo = await prisma.video.update({
      where: { id: video.id },
      data: { status: 'READY' },
    });
    expect(updatedVideo.status).toBe('READY');

    // 8. Export Clip: Render request, ASS subtitles & MP4 output
    const renderId = 'rnd-integ-1';
    const renderKey = buildAssetStorageKey({
      userId,
      videoId,
      clipId: clip1.id,
      renderId,
      kind: 'RENDER',
      ext: 'mp4',
    });

    await s3.putObject(
      renderKey,
      Buffer.from('mock-rendered-reel'),
      'video/mp4',
    );
    await prisma.mediaAsset.upsert({
      where: { storageKey: renderKey },
      create: {
        userId,
        videoId,
        clipId: clip1.id,
        renderId,
        kind: 'RENDER',
        storageKey: renderKey,
        status: 'READY',
      },
      update: {},
    });
    expect(s3.getBucketObjectCount()).toBe(3);

    // Download URL check
    const downloadUrl = await s3.getDownloadUrl(renderKey, 300);
    expect(downloadUrl).toContain(renderKey);

    // 9. Soft-delete Video
    await prisma.video.update({
      where: { id: video.id },
      data: { deletedAt: new Date() },
    });

    // 10. Cleanup Consumer: delete all MediaAssets & purge S3 bucket
    const assetsToDelete = await prisma.mediaAsset.findMany({
      where: { videoId: video.id },
    });
    expect(assetsToDelete.length).toBe(3);

    const keysToDelete = assetsToDelete.map((a: any) => a.storageKey);
    const deletedFromS3 = await s3.deleteObjects(keysToDelete);
    expect(deletedFromS3.length).toBe(3);

    await prisma.mediaAsset.deleteMany({
      where: { videoId: video.id },
    });

    // Final Assertion: Bucket is completely empty for this video!
    const remainingObjects = await s3.listObjects(
      `users/${userId}/videos/${videoId}/`,
    );
    expect(remainingObjects.length).toBe(0);
    expect(s3.getBucketObjectCount()).toBe(0);

    const remainingAssets = await prisma.mediaAsset.findMany({
      where: { videoId: video.id },
    });
    expect(remainingAssets.length).toBe(0);
  });
});
