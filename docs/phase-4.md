# Phase 4: durable notifications and cleanup

Phase 4 adds a separate BullMQ worker, transactional-outbox dispatch, in-app notifications, an optional email webhook adapter, safe storage cleanup and reconciliation. It preserves the Phase 3 claim transaction and one-time transfer semantics.

## Local setup

```powershell
pnpm install --frozen-lockfile
# Preserve your existing .env; add the new example keys if needed.
pnpm services:up
pnpm storage:setup
pnpm dev
```

The worker now connects to MongoDB and Redis. Set REDIS_URL, WORKER_INTERVAL_MS (10000 default), METADATA_RETENTION_DAYS (7 default), and EMAIL_PROVIDER (disabled default). API processes do not connect to Redis or invoke the email provider. Shared database models, environment validation, storage, errors and cleanup transactions live in packages/backend. `pnpm prepare:shared` builds contracts/backend before development and tests; normal workspace builds respect package dependency order. API compatibility exports preserve existing imports.

Use `pnpm --filter worker dev` for the worker alone after compiling shared packages. After `pnpm build`, `pnpm --filter worker start` runs compiled JavaScript. Development storage is the existing ephemeral Moto emulator; do not use it for real users. Keep bucket/endpoint configuration stable for the lifetime of stored objects. Scanner integration remains pending; file shares still require a trusted clean result.

## Durable dispatch and notification semantics

The existing claim transaction commits the consumed share, transfer ticket and pending outbox event together. The worker polls MongoDB, adds jobs with stable IDs, and records enqueue time, dispatch attempts, failures and a next-dispatch deadline. It only marks an event processed after notification handling succeeds. A crash before/after enqueue can repeat dispatch safely. Queue data contains event/asset identifiers, never passwords, share tokens, ticket bearers or object bytes.

Notifications use a unique sourceEventId index. Duplicate jobs therefore produce one in-app record. Messages say that a share **was claimed**, not that its recipient saved a download. The owner-only dashboard shows unread count, paginated notices, email state and Mark read. Routes:

| Method | Route | Behavior |
|---|---|---|
| GET | /api/me/notifications?before=<id> | Owner-scoped 50-record page, nextCursor and unreadCount |
| POST | /api/me/notifications/:id/read | JSON body {}, session and exact Origin required; foreign IDs return 404 |

The dashboard polls every 15 seconds. Notifications are retained independently of the temporary asset metadata; no notification TTL is introduced.

Email is optional and disabled by default. EMAIL_PROVIDER=webhook requires an HTTPS EMAIL_WEBHOOK_URL without embedded credentials and EMAIL_WEBHOOK_TOKEN (at least 32 characters). The adapter POSTs `{idempotencyKey,to,subject,text}` with Authorization and Idempotency-Key headers, a 10-second timeout and no redirects. A one-minute database lease prevents concurrent sends. The provider must honor the event ID idempotency key to deduplicate a crash after acceptance but before database acknowledgement. Exactly-once external email is not claimed. No real email was sent during local tests.

Provider failure preserves the in-app notification, marks email failed and leaves the outbox event pending. Queue retry or reconciliation resumes it with the same event ID. It does not affect the API request that created the claim. Production provider credentials and deliverability remain deployment configuration.

## Queues and recovery

There are separate notification and cleanup queues/consumers, with concurrency four and two. New jobs have five attempts with exponential one-second backoff. Stable job IDs avoid duplicates while jobs remain in Redis; MongoDB idempotency remains authoritative after queue retention or complete Redis loss. Reconciliation retries existing failed/completed jobs if MongoDB still reports work outstanding, resetting the retry batch. Completed/failed queue history is bounded by age/count. A permanent error can therefore retry indefinitely in periodic batches; monitor failed job counts and repair configuration rather than assuming retries imply success.

The producer uses finite retries and fails promptly when offline; consumers use the BullMQ-required blocking-connection retry configuration. Shutdown closes timers, consumers and queues, then MongoDB; the entrypoint bounds shutdown to 20 seconds. A process killed mid-cleanup leaves a reclaimable lease. The worker logs readiness, failed/stalled/completed jobs, enqueue/reconciliation counts, pending-event age, queue counts and failed-asset counts. Logs omit raw errors, credentials, object keys and token-bearing URLs.

Each sweep handles bounded batches ordered by their previous scheduling time, so older batches rotate through the backlog. It finds pending outbox events, terminal/expired shares, expired file sessions, and expired cleanup leases. It also marks unresolved streaming records failed after the persisted stream deadline. No recipient access depends on a sweep: expiry and revocation are still checked at API access time.

BullMQ connection, retry and identifier rules follow its [connection documentation](https://docs.bullmq.io/guide/connections), [retry documentation](https://docs.bullmq.io/guide/retrying-failing-jobs) and [job-ID rules](https://docs.bullmq.io/guide/jobs/job-ids).

## Safe cleanup and retention

Cleanup checks **all** shares referencing an asset, including older mixed-case source IDs. It waits while any reference is active/unexpired or has an outstanding conservative transferUntil window. Revocation does not terminate an already committed download. Private snippets with no share are retained. Unshared/stranded file sessions get a ten-minute grace after their upload-session expiry; this covers ordinary in-flight API calls and signed part URL windows.

Share creation and new claims write the same asset version used by the cleanup transaction. Once cleanup atomically changes an asset to deleting, new creation/claims and upload mutations fail. This serializes new-reference races against deletion. A five-minute database lease identifies the cleanup attempt; failures release the lease for retry, and a crashed worker can be replaced after expiry.

For files, the storage adapter requires a non-versioned bucket, discovers all multipart uploads for the exact server-owned key (including lost initiation responses), aborts them, deletes the object, HEAD-verifies absence and verifies that no multipart upload remains listed. Metadata calls have 30-second cancellation and cleanup has a two-minute cloud-operation budget. A versioned/suspended bucket is rejected conservatively; deletion of historical versions is not implemented. Failed or ambiguous storage operations retain keys, quota, state and metadata without purgeAfter. Keep S3's incomplete-multipart lifecycle rule as a backstop for parts that finish after an abort; emulator behavior does not establish real AWS lifecycle enforcement.

Only after observable deletion succeeds does a transaction mark the asset deleted, release quota once and assign purgeAfter = deletedAt + retention. Already-aborted sessions do not release quota again. Snippet cleanup clears its text before retaining metadata. Share/ticket metadata receives the same purge deadline after asset cleanup; processed outbox events can then be purged. Pending events remain durable until handled. Reference updates are restartable in batches; their completion flag is written last. TTL indexes exist only on purgeAfter, never on share or upload expiry. Failed deletion therefore cannot silently discard the storage key.

The owner UI shows pending/completed share cleanup and retry state for files being removed. Deleted assets disappear from source selection; retained share history lasts until its purge deadline. Each distinct share has its own claim limit, but deletion of a shared asset waits for every reference.

Use a dedicated non-versioned private bucket. In addition to existing upload/HEAD/GetObject permissions, the worker needs s3:GetBucketVersioning and s3:ListBucketMultipartUploads on the bucket, plus s3:AbortMultipartUpload and s3:DeleteObject on its quarantine prefix. HEAD absence must be distinguishable from AccessDenied; retain appropriate scoped ListBucket permission. Never change buckets/regions/endpoints without migrating the corresponding metadata and bytes together.

## Verification and manual checks

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# Redis 6.2+ executable is required by the isolated worker/browser harnesses.
$env:REDIS_SERVER_PATH='C:/path/to/redis-server.exe'
pnpm test:worker
$env:CHROMIUM_CHANNEL='chrome'
pnpm test:browser
python -m pip install -r tests/requirements-storage.txt
pnpm test:browser:workspace
git diff --check
```

Linux can use redis-server from PATH. Windows can use a locally installed compatible executable; no database service installation is required by the test harness. Tests bind temporary Redis ports to loopback, disable persistence and stop their own processes. The runtime smoke uses a real MongoDB replica set and Redis/BullMQ, injects a storage failure, checks retry/metadata retention, restarts the worker, discards/restarts Redis to exercise queue-loss recovery, and starts the compiled separate worker process. It does not use a Redis mock.

The browser harness uses real Redis/BullMQ and the existing Moto S3 HTTP emulator. It preserves multipart/share coverage, observes worker-created notifications, marks one read, advances fixture transfer deadlines and verifies real adapter deletion/HEAD absence and the owner cleanup state. File scanning remains a fixture assertion, not a real scan. Screenshots are written to ignored test-results. CI installs Redis and runs both added worker and expanded browser checks; remote CI success is not claimed by local results.

Manually create and claim a snippet share in a separate browser profile; confirm the uploader receives a claimed notice. Mark it read. Stop the worker, claim another share and restart the worker: the pending notice should arrive once. Simulate an unavailable email provider with a development adapter and confirm claims still return promptly. For file cleanup use disposable test data with a trusted clean fixture, revoke all its shares and wait for transferUntil; confirm cleanup complete and storage absence. A second active share must keep the object protected. Remove storage delete permission and confirm retry state and absent purgeAfter; restore permission and verify eventual cleanup.

## Phase 5 prerequisites

Verify persistent Docker services and the target private S3 IAM/lifecycle configuration, integrate a trusted malware scanner before production file sharing, and configure a real email provider only if wanted. Phase 5 should add the remaining product/analytics UI, distributed abuse controls and measured performance checks. No AWS deployment, production email delivery, production scanner, benchmark or remote CI success is implied by local worker tests.

## Recorded local results

All 41 unit/integration tests passed, along with frozen install, lint, typecheck and build. `pnpm test:worker` passed against real Redis 7.4.8 and MongoDB, including a compiled separate worker process and Redis restart with lost queue state. Both browser commands passed with Chrome; the expanded workspace flow verified actual Moto object absence after cleanup and notification read state. Screenshots were visually reviewed. The Windows Redis archive was verified against the SHA-256 published on the [7.4.8 community Windows release](https://github.com/redis-windows/redis-windows/releases/tag/7.4.8). Persistent Docker, real AWS, production email/scanning and remote CI remain separately unverified. No deployment or benchmark claim is made.
