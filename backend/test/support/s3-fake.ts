import { Readable } from 'node:stream';
import type {
  S3ObjectMeta,
  S3ListedObject,
} from '../../src/storage/s3-storage.service';

export class S3Fake {
  private readonly objects = new Map<
    string,
    { body: Buffer; contentType?: string; lastModified: Date }
  >();
  private readonly multipartUploads = new Map<
    string,
    { key: string; contentType?: string; parts: Map<number, Buffer> }
  >();
  private uploadIdSeq = 0;

  async createMultipartUpload(
    key: string,
    contentType?: string,
  ): Promise<{ uploadId: string }> {
    const uploadId = `upload-${++this.uploadIdSeq}`;
    this.multipartUploads.set(uploadId, { key, contentType, parts: new Map() });
    return { uploadId };
  }

  async getUploadPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    _ttlSec?: number,
  ): Promise<string> {
    return `https://s3.local/upload?key=${encodeURIComponent(key)}&uploadId=${uploadId}&partNumber=${partNumber}`;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    _parts: { partNumber: number; etag: string }[],
  ): Promise<{ location: string; bucket: string; key: string; etag: string }> {
    const session = this.multipartUploads.get(uploadId);
    const combined = session
      ? Buffer.concat(Array.from(session.parts.values()))
      : Buffer.from('mock video data');
    this.objects.set(key, {
      body: combined,
      contentType: session?.contentType || 'video/mp4',
      lastModified: new Date(),
    });
    this.multipartUploads.delete(uploadId);
    return {
      location: `https://s3.local/${key}`,
      bucket: 'reels-media',
      key,
      etag: 'mock-etag',
    };
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    this.multipartUploads.delete(uploadId);
  }

  async getDownloadUrl(key: string, _ttlSec?: number): Promise<string> {
    return `https://s3.local/download/${key}`;
  }

  async getObjectStream(key: string): Promise<Readable> {
    const item = this.objects.get(key);
    const buf = item ? item.body : Buffer.from('dummy video stream');
    return Readable.from(buf);
  }

  async putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
  ): Promise<void> {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    this.objects.set(key, { body: buf, contentType, lastModified: new Date() });
  }

  async headObject(key: string): Promise<S3ObjectMeta | null> {
    const item = this.objects.get(key);
    if (!item) return null;
    return {
      contentLength: item.body.length,
      contentType: item.contentType,
      etag: 'mock-etag',
      lastModified: item.lastModified,
    };
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async deleteObjects(keys: string[]): Promise<string[]> {
    const deleted: string[] = [];
    for (const k of keys) {
      if (this.objects.delete(k)) {
        deleted.push(k);
      }
    }
    return deleted;
  }

  async listObjects(prefix = ''): Promise<S3ListedObject[]> {
    const res: S3ListedObject[] = [];
    for (const [key, val] of this.objects.entries()) {
      if (key.startsWith(prefix)) {
        res.push({
          key,
          size: val.body.length,
          lastModified: val.lastModified,
        });
      }
    }
    return res;
  }

  getBucketObjectCount(): number {
    return this.objects.size;
  }

  clear(): void {
    this.objects.clear();
    this.multipartUploads.clear();
  }
}

export function createS3Fake(): S3Fake {
  return new S3Fake();
}
