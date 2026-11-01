import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand, CompleteMultipartUploadCommand, HeadObjectCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
export type StoredPart = { partNumber: number; size: number; etag: string };
export interface Storage {
  assertConfigured?(): void;
  begin(key: string, mimeType: string): Promise<string>;
  sign(key: string, uploadId: string, partNumber: number, size: number): Promise<string>;
  parts(key: string, uploadId: string): Promise<StoredPart[]>;
  complete(key: string, uploadId: string, parts: StoredPart[]): Promise<void>;
  head(key: string): Promise<{ size: number; mimeType: string } | null>;
  abort(key: string, uploadId: string): Promise<void>;
}
export function createStorage(env: Env): Storage {
  const client = new S3Client({ region: env.S3_REGION, ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } } : {}),
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  const base = (key: string) => {
    if (!env.S3_BUCKET) throw new AppError(503, 'File storage is not configured');
    return { Bucket: env.S3_BUCKET, Key: key };
  };
  return {
    assertConfigured() { base('configuration-check'); },
    async begin(key, mimeType) {
      const result = await client.send(new CreateMultipartUploadCommand({ ...base(key), ContentType: mimeType,
        // AWS uses bucket-owner-enforced ownership. Compatible dev servers need an explicit private owner grant.
        ...(env.S3_ENDPOINT ? { ACL: 'bucket-owner-full-control' } : { ServerSideEncryption: 'AES256' }) }));
      if (!result.UploadId) throw new Error('Missing multipart ID');
      return result.UploadId;
    },
    sign: (key, uploadId, partNumber, size) => getSignedUrl(client, new UploadPartCommand({ ...base(key), UploadId: uploadId, PartNumber: partNumber, ContentLength: size }), { expiresIn: 300 }),
    async parts(key, uploadId) {
      const parts: StoredPart[] = []; let marker: string | undefined;
      do {
        const result = await client.send(new ListPartsCommand({ ...base(key), UploadId: uploadId, ...(marker ? { PartNumberMarker: marker } : {}) }));
        for (const part of result.Parts ?? []) {
          if (part.PartNumber === undefined || part.Size === undefined || !part.ETag) throw new Error('Invalid storage part');
          parts.push({ partNumber: part.PartNumber, size: part.Size, etag: part.ETag });
        }
        marker = result.IsTruncated ? result.NextPartNumberMarker : undefined;
      } while (marker);
      return parts.sort((a, b) => a.partNumber - b.partNumber);
    },
    async complete(key, uploadId, parts) { await client.send(new CompleteMultipartUploadCommand({ ...base(key), UploadId: uploadId, MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.partNumber, ETag: p.etag })) } })); },
    async head(key) {
      try { const result = await client.send(new HeadObjectCommand(base(key))); return { size: result.ContentLength ?? -1, mimeType: result.ContentType ?? '' }; }
      catch (error) { if (error instanceof Error && ['NotFound', 'NoSuchKey'].includes(error.name)) return null; throw error; }
    },
    async abort(key, uploadId) {
      try { await client.send(new AbortMultipartUploadCommand({ ...base(key), UploadId: uploadId })); }
      catch (error) { if (!(error instanceof Error && error.name === 'NoSuchUpload')) throw error; }
    },
  };
}
