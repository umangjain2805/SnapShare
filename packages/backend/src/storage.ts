import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand, CompleteMultipartUploadCommand, HeadObjectCommand, AbortMultipartUploadCommand, GetObjectCommand, GetBucketVersioningCommand, ListMultipartUploadsCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from './env.js';
import { AppError } from './errors.js';
export type StoredPart = { partNumber: number; size: number; etag: string };
export interface Storage {
  assertConfigured?(): void;
  begin(key: string, mimeType: string): Promise<string>;
  sign(key: string, uploadId: string, partNumber: number, size: number): Promise<string>;
  parts(key: string, uploadId: string): Promise<StoredPart[]>;
  complete(key: string, uploadId: string, parts: StoredPart[]): Promise<void>;
  head(key: string): Promise<{ size: number; mimeType: string } | null>;
  abort(key: string, uploadId: string): Promise<void>;
  open?(key: string, signal: AbortSignal): Promise<Readable>;
  remove?(key: string, uploadId?: string): Promise<void>;
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
        ...(env.S3_ENDPOINT ? { ACL: 'bucket-owner-full-control' } : { ServerSideEncryption: 'AES256' }) }), { abortSignal: AbortSignal.timeout(30000) });
      if (!result.UploadId) throw new Error('Missing multipart ID');
      return result.UploadId;
    },
    sign: (key, uploadId, partNumber, size) => getSignedUrl(client, new UploadPartCommand({ ...base(key), UploadId: uploadId, PartNumber: partNumber, ContentLength: size }), { expiresIn: 300 }),
    async parts(key, uploadId) {
      const parts: StoredPart[] = []; let marker: string | undefined;
      do {
        const result = await client.send(new ListPartsCommand({ ...base(key), UploadId: uploadId, ...(marker ? { PartNumberMarker: marker } : {}) }), { abortSignal: AbortSignal.timeout(30000) });
        for (const part of result.Parts ?? []) {
          if (part.PartNumber === undefined || part.Size === undefined || !part.ETag) throw new Error('Invalid storage part');
          parts.push({ partNumber: part.PartNumber, size: part.Size, etag: part.ETag });
        }
        marker = result.IsTruncated ? result.NextPartNumberMarker : undefined;
      } while (marker);
      return parts.sort((a, b) => a.partNumber - b.partNumber);
    },
    async complete(key, uploadId, parts) { await client.send(new CompleteMultipartUploadCommand({ ...base(key), UploadId: uploadId, MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.partNumber, ETag: p.etag })) } }), { abortSignal: AbortSignal.timeout(30000) }); },
    async head(key) {
      try { const result = await client.send(new HeadObjectCommand(base(key)), { abortSignal: AbortSignal.timeout(30000) }); return { size: result.ContentLength ?? -1, mimeType: result.ContentType ?? '' }; }
      catch (error) { if (error instanceof Error && ['NotFound', 'NoSuchKey'].includes(error.name)) return null; throw error; }
    },
    async abort(key, uploadId) {
      try { await client.send(new AbortMultipartUploadCommand({ ...base(key), UploadId: uploadId }), { abortSignal: AbortSignal.timeout(30000) }); }
      catch (error) { if (!(error instanceof Error && error.name === 'NoSuchUpload')) throw error; }
    },
    async open(key, signal) {
      const result = await client.send(new GetObjectCommand(base(key)), { abortSignal: signal });
      if (!(result.Body instanceof Readable)) throw new Error('Storage body is not a Node stream');
      return result.Body;
    },
    async remove(key, uploadId) {
      const target = base(key); const signal = AbortSignal.timeout(120000);
      const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: target.Bucket }), { abortSignal: signal });
      if (versioning.Status) throw new Error('Cleanup requires a non-versioned bucket');
      const list = async () => {
        const uploads: string[] = []; let keyMarker: string | undefined; let uploadMarker: string | undefined;
        for (let page = 0; page < 10; page++) {
          const result = await client.send(new ListMultipartUploadsCommand({ Bucket: target.Bucket, Prefix: key, KeyMarker: keyMarker, UploadIdMarker: uploadMarker }), { abortSignal: signal });
          for (const upload of result.Uploads ?? []) if (upload.Key === key && upload.UploadId) uploads.push(upload.UploadId);
          if (!result.IsTruncated) return uploads;
          keyMarker = result.NextKeyMarker; uploadMarker = result.NextUploadIdMarker;
        }
        throw new Error('Multipart listing exceeds cleanup safety limit');
      };
      const uploads = new Set(await list()); if (uploadId) uploads.add(uploadId);
      for (const id of uploads) {
        try { await client.send(new AbortMultipartUploadCommand({ ...target, UploadId: id }), { abortSignal: signal }); }
        catch (error) { if (!(error instanceof Error && error.name === 'NoSuchUpload')) throw error; }
      }
      await client.send(new DeleteObjectCommand(target), { abortSignal: signal });
      try { await client.send(new HeadObjectCommand(target), { abortSignal: signal }); throw new Error('Object still exists after deletion'); }
      catch (error) { if (!(error instanceof Error && ['NotFound', 'NoSuchKey'].includes(error.name))) throw error; }
      if ((await list()).length) throw new Error('Multipart upload remains after deletion');
    },
  };
}
