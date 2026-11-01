import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { PART_SIZE, type UploadInput, type SnippetInput } from '@snapshare/contracts';
import type { Storage } from '../../infrastructure/storage.js';
import { AppError } from '../../middleware/errors.js';
import { assetRepository as repo } from './repository.js';
export function createAssetService(storage: Storage) {
  async function owned(ownerId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new AppError(404, 'Upload not found');
    const upload = await repo.findUpload(ownerId, id);
    if (!upload) throw new AppError(404, 'Upload not found');
    return upload;
  }
  type Upload = Awaited<ReturnType<typeof owned>>;
  function active(upload: Upload) {
    if (upload.status !== 'uploading') throw new AppError(409, 'Upload is not open');
    if (upload.expiresAt.getTime() <= Date.now()) throw new AppError(410, 'Upload expired; abort it and start again');
  }
  const view = (upload: Upload, parts: Awaited<ReturnType<Storage['parts']>> = []) => ({
    id: upload.id as string, filename: upload.filename, size: upload.size, mimeType: upload.mimeType, fingerprint: upload.fingerprint,
    status: upload.status, scanStatus: upload.scanStatus, expiresAt: upload.expiresAt.toISOString(), partSize: PART_SIZE, parts,
  });
  async function abort(ownerId: string, id: string) {
    const upload = await owned(ownerId, id);
    if (upload.status === 'aborted') return;
    if (!['uploading', 'aborting'].includes(upload.status)) throw new AppError(409, 'This upload cannot be aborted');
    if (upload.status === 'uploading') {
      const changed = await repo.transitionUpload(id, ownerId, 'uploading', 'aborting');
      if (!changed) throw new AppError(409, 'Upload changed; refresh and retry');
    }
    await storage.abort(upload.objectKey, upload.storageUploadId!);
    await repo.confirmAbort(id, ownerId, upload.size);
  }
  return {
    async initiate(ownerId: string, input: UploadInput) {
      storage.assertConfigured?.();
      const upload = await repo.reserve(ownerId, input.size, session => repo.createUpload({ ...input, ownerId, objectKey: `quarantine/${ownerId}/${randomUUID()}`, expiresAt: new Date(Date.now() + 86400000) }, session));
      // A crash here retains the initializing record and its key/quota for reconciliation.
      const storageUploadId = await storage.begin(upload.objectKey, input.mimeType);
      return view(await repo.initializeUpload(upload.id as string, ownerId, storageUploadId));
    },
    async list(ownerId: string) {
      return (await repo.listUploads(ownerId)).map(upload => view(upload));
    },
    async get(ownerId: string, id: string) {
      const upload = await owned(ownerId, id);
      const parts = upload.status === 'uploading' && upload.expiresAt.getTime() > Date.now() ? await storage.parts(upload.objectKey, upload.storageUploadId!) : [];
      return view(upload, parts);
    },
    async sign(ownerId: string, id: string, partNumber: number) {
      const upload = await owned(ownerId, id); active(upload);
      const size = Math.min(PART_SIZE, upload.size - (partNumber - 1) * PART_SIZE);
      if (size <= 0) throw new AppError(400, 'Part number exceeds file size');
      return { url: await storage.sign(upload.objectKey, upload.storageUploadId!, partNumber, size), expiresIn: 300 };
    },
    async complete(ownerId: string, id: string) {
      let upload = await owned(ownerId, id);
      if (upload.status === 'quarantined') return view(upload);
      if (!['uploading', 'completing'].includes(upload.status)) throw new AppError(409, 'Upload cannot be completed');
      if (upload.status === 'uploading') {
        active(upload);
        const parts = await storage.parts(upload.objectKey, upload.storageUploadId!);
        const count = Math.ceil(upload.size / PART_SIZE);
        if (parts.length !== count || parts.some((part, i) => part.partNumber !== i + 1 || !part.etag || part.size !== Math.min(PART_SIZE, upload.size - i * PART_SIZE))) throw new AppError(409, 'Parts are missing or have incorrect sizes');
        const changed = await repo.transitionUpload(id, ownerId, 'uploading', 'completing');
        if (!changed) throw new AppError(409, 'Upload changed; retry completion');
        upload = changed;
      }
      // HEAD recovers a completed S3 request whose response or subsequent DB save was lost.
      let object = await storage.head(upload.objectKey);
      if (!object) {
        const parts = await storage.parts(upload.objectKey, upload.storageUploadId!);
        if (parts.length !== Math.ceil(upload.size / PART_SIZE) || parts.some((p, i) => p.partNumber !== i + 1 || p.size !== Math.min(PART_SIZE, upload.size - i * PART_SIZE))) throw new AppError(409, 'Storage parts changed; contact support');
        try { await storage.complete(upload.objectKey, upload.storageUploadId!, parts); }
        catch (error) { if (!await storage.head(upload.objectKey)) throw error; }
        object = await storage.head(upload.objectKey);
      }
      if (!object || object.size !== upload.size || object.mimeType !== upload.mimeType) throw new AppError(409, 'Object verification failed; file remains quarantined');
      await repo.transitionUpload(id, ownerId, 'completing', 'quarantined');
      return view(await owned(ownerId, id));
    },
    abort,
    async createSnippet(ownerId: string, input: SnippetInput) {
      const snippet = await repo.reserve(ownerId, Buffer.byteLength(input.text, 'utf8'), session => repo.createSnippet(ownerId, input, session));
      return { id: snippet.id as string, title: snippet.title, language: snippet.language, text: snippet.text };
    },
    async snippets(ownerId: string) { return (await repo.listSnippets(ownerId)).map(s => ({ id: s.id as string, title: s.title, language: s.language, text: s.text })); },
  };
}
export type AssetService = ReturnType<typeof createAssetService>;
