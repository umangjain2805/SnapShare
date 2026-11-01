# Phase 2: private files and snippets

Phase 2 implements authenticated file creation, resumable multipart uploads and private code snippets. Public shares, transfer tickets, downloads, notifications and scheduled cleanup remain future work. See `prompt.md` for the six-phase scope; the older README roadmap placed streaming and background work in different phases and has now been aligned.

## Run locally

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env # Only for a new installation; preserve existing settings.
pnpm services:up
pnpm storage:setup
pnpm dev
```

For an existing `.env`, add the S3 keys from `.env.example`. Open `http://localhost:5173`, register/sign in, then use Upload a file and Create a snippet on the dashboard. The API can run without storage configuration for auth/snippets; file initiation then returns 503 without reserving quota. Backend processes alone receive storage credentials. No frontend environment secrets are needed.

Compose adds Moto 5.2.5, an **ephemeral local S3 HTTP emulator**, bound to loopback port 9000. It does not provide production IAM/signature enforcement or durable storage. Its data disappears on restart; rerun `pnpm storage:setup` after restarting it. MongoDB metadata persists independently: abort stale open uploads, and treat completed emulator objects as disposable test data. Use a dedicated development database. Never point real users at Moto. Docker Compose and live Redis connectivity still require verification on a Docker-enabled machine.

`storage:setup` accepts only a loopback development endpoint. It creates a private bucket, blocks public access, configures exact-origin PUT CORS and adds a two-day incomplete-multipart lifecycle rule. Moto accepts lifecycle configuration but does not run the real S3 lifecycle engine.

## API and policy

Every route below requires the existing cookie session. Mutations require the exact APP_URL Origin and JSON, including DELETE. Responses use `Cache-Control: no-store`. Owner-scoped workspace requests have a process-local limit of 120/minute.

| Method | Route | Input/result |
|---|---|---|
| POST | `/api/uploads/initiate` | `{filename,size,mimeType,fingerprint}` → `{upload}` |
| GET | `/api/uploads` | `{uploads}` for the signed-in owner |
| GET | `/api/uploads/:id` | `{upload}` including storage-confirmed part numbers, byte sizes and ETags for open sessions |
| POST | `/api/uploads/:id/parts` | `{partNumber}` → `{url,expiresIn:300}` |
| POST | `/api/uploads/:id/complete` | `{}` → verified `{upload}` in quarantine |
| DELETE | `/api/uploads/:id` | `{}` → 204 after multipart abort and quota release |
| POST | `/api/snippets` | `{title,language,text}` → `{snippet}` |
| GET | `/api/snippets` | `{snippets}` for the signed-in owner |

Files must be 1 byte–256 MiB. Allowed declared MIME types: PDF, PNG, JPEG, plain text and ZIP. Filenames cannot contain paths or control characters. Keys are server-generated `quarantine/<owner>/<UUID>` values; filenames never determine paths. Parts are 8 MiB except the final part. Signed PUT URLs are scoped to the object, upload ID, part number and content length and expire after five minutes. Treat these URLs as temporary bearer credentials; they are never logged by the application.

Each workspace reserves at most 1 GiB and 100 items (files plus snippets). Upload declarations and snippet UTF-8 byte sizes reserve quota in a MongoDB transaction with asset creation. Competing reservations serialize through the owner quota document. Confirmed abort transitions and quota release also share a transaction, so retries do not release quota twice. Quarantined files and saved snippets continue to consume quota. Deleting completed assets is future work.

Snippets allow 32 KiB of UTF-8 text, a 120-character title and one of the shared language identifiers. Prism tokenization supplies syntax highlighting; token contents render as React text nodes, without `innerHTML`, HTML execution or script evaluation. Copy returns original text. Lists contain at most the 100 reserved workspace items.

## Resume, completion and abort recovery

Sessions expire 24 hours after initiation. The server denies new part URLs and new completion attempts after expiry. Signed URLs already issued can remain valid for their five-minute lifetime. Expiration does not delete metadata or storage. There is no asset TTL index.

Open sessions appear in the owner's server-side list after reload or sign-in on another browser. Select Resume, reselect the original file and continue. No localStorage or IndexedDB stores file bytes, credentials or signed URLs. The browser computes a full-file SHA-256 identity, rejects a changed file, obtains the current part list and skips parts with correct numbers/sizes. In-progress parts can be lost; completed parts survive recoverable interruptions. Resume obtains fresh signed URLs. Network errors, timeout and Pause leave the session available for manual resume. Hashing currently reads the file into browser memory (bounded to 256 MiB), which may be expensive on memory-constrained devices.

Completion validates the full contiguous part list and exact per-part sizes from storage, moves conditionally to `completing`, completes S3, then HEAD-checks total size and MIME metadata before setting `quarantined` / `scanStatus=pending`. Retrying a lost completion response first HEAD-checks the same server-owned key. It recovers a completed S3 operation even if the database save or HTTP response was lost. A completing operation may be retried after its original session expiry to reconcile its result. A conflicting abort cannot take over completion.

Abort is allowed for open/expired sessions or an earlier `aborting` attempt. Failed storage aborts retain the upload ID, key and quota. Retry Abort to finish. Successful aborts retain metadata in `aborted` state and release quota once. On real S3, an already in-flight part may finish after abort; stop the client first and use the bucket incomplete-upload lifecycle as a backstop. A presigned upload cannot be revoked independently of its multipart session.

MongoDB and S3 cannot commit atomically. If initiation succeeds at S3 but its response or database save is lost, the `initializing` record retains its key and quota. It is intentionally not auto-released: operators must find/abort orphan multipart uploads by the recorded key and reconcile the quota. Similarly, permanent `completing` failures retain quota and metadata for investigation. Do not delete records or reset quota while cloud bytes may still exist. Automatic reconciliation belongs to Phase 4; there is no reconciliation worker yet. An initiation request whose API response was lost can normally be found in Your files rather than initiated again.

## AWS deployment requirements

Provision a private, non-versioned dedicated S3 bucket with all four Block Public Access settings, bucket-owner-enforced ownership, encryption at rest, no public read policy, exact APP_URL PUT-only CORS, and exposed ETag. Configure an AbortIncompleteMultipartUpload lifecycle rule after two days. Keep account/bucket public access blocks enabled. Use TLS and a backend IAM role; omit S3_ENDPOINT and static credential fields when using the AWS default credential chain. The AWS adapter requests SSE-S3 AES256; a custom local endpoint uses its own encryption configuration.

The runtime role needs `s3:PutObject`, `s3:AbortMultipartUpload` and `s3:ListMultipartUploadParts` on `arn:aws:s3:::<bucket>/quarantine/*`, plus `s3:GetObject` for HEAD verification. Missing objects can require `s3:ListBucket` to return 404 rather than 403; scope that bucket permission with a quarantine prefix condition. Operators need separate bucket-list/lifecycle/configuration permissions. The runtime never presigns GET URLs or returns object keys/upload IDs in metadata. S3 part URLs necessarily identify their signed target.

Declared MIME validation and HEAD metadata checks **do not identify actual file contents or scan malware**. All completed files remain quarantined; there is no clean-state transition, scanning integration, public share or download endpoint in this phase. Before production sharing, add a trusted scanner, content detection and a fail-closed release policy. Quotas bound reserved logical assets, not every possible replay/in-flight S3 byte; signed URLs and incomplete-part storage need operational monitoring and bucket lifecycle enforcement. No AWS deployment, production security validation, or real AWS signature enforcement is claimed by emulator tests.

## Verification and manual checks

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
$env:CHROMIUM_CHANNEL='chrome' # Or install Playwright Chromium.
pnpm test:browser
python -m pip install -r tests/requirements-storage.txt
pnpm test:browser:workspace
```

The workspace browser test starts its own real MongoDB replica set, API, Vite and Moto HTTP server. It uploads a 17 MiB + 7 byte file, interrupts part two, reloads, rejects a changed file, resumes without reuploading part one, verifies final bytes with SHA-256, checks anonymous GET denial, saves malicious HTML as inert highlighted text and checks mobile overflow/runtime errors. Moto is an emulator; these are local HTTP protocol checks, not AWS infrastructure checks. Set `PYTHON` to your Python executable if needed. Screenshots go to ignored `test-results/`. Remote CI includes this test but its execution is not claimed locally.

Manually upload a file larger than 8 MiB, pause or disconnect while uploading, reload, select Resume and reselect that file. Confirm Awaiting scan. Try another account: files/snippets must be absent. Abort an unfinished upload and confirm it disappears. Create a markup snippet containing `<script>alert(1)</script>` and confirm literal highlighted text, then copy it. Check the dashboard at a mobile width. To test limits, send an oversized declaration or unsupported MIME: expect 400; missing sessions expect 401 and another owner's upload ID expects 404.

Phase 3 prerequisites: verify the persistent MongoDB/Redis developer services, provision/test a real private S3 bucket or durable compatible service, and define how scanning safely releases uploads before public file shares. Phase 3 adds secure shares, atomic claims, transfer tickets, controlled streaming and outbox records; Phase 4 adds asynchronous processing/reconciliation.
