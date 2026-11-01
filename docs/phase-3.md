# Phase 3: secure one-time shares

This is the Phase 3 implementation record. Worker processing, notifications, cleanup and retention now follow [Phase 4](phase-4.md).

Phase 3 implements password-protected, 24-hour shares, one committed claim, recoverable claim responses, single-use transfer tickets, controlled API streaming, owner listing/revocation and durable pending outbox records. Notification delivery, cleanup workers and reconciliation remain Phase 4 work.

## Run and try it

Use the [Phase 2 setup](phase-2.md#run-locally), then `pnpm dev`. There are no new secrets or environment variables in this phase. MongoDB must be a replica set. API startup initializes the share, ticket and outbox indexes before accepting traffic.

1. Register/sign in and save a snippet on the dashboard.
2. Under Create a secure share, select that snippet and enter a password of 12-128 characters.
3. Create the share and save/copy its URL immediately. Send the password separately. The URL is returned once and is not recoverable from the owner listing.
4. Open the URL in a separate browser profile. The title, filename, content and owner remain hidden before password authorization. Try a wrong password, then the correct one.
5. Claim the share, then select Download once before the displayed deadline. The original snippet is delivered as an attachment, including literal HTML/code characters.
6. Try the same link in another profile: no second claim is granted. An already redeemed transfer URL returns 410. The owner listing shows one claim; Revoke blocks subsequent access.
7. Check a 390px mobile viewport. File/source names wrap; code bytes are never executed.

Files need a trusted scan before sharing. `UploadSession.status=quarantined` and `scanStatus=clean` are both required at creation, claim and redemption. The asset status continues to describe private storage; scanStatus determines release eligibility. Pending and rejected uploads remain unavailable. There is no public or owner-accessible route to mark a file clean, and this phase does not install a scanner or provide an unscanned-file bypass. Production file sharing therefore remains gated until trusted scanning is integrated. Snippet sharing works immediately. The browser test explicitly writes a clean fixture result to exercise file delivery; it does not claim to scan the file.

## API

Owner routes require the existing account cookie. All mutations require the exact APP_URL Origin and JSON, including DELETE. Public recipients do not need accounts. Responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

| Method | Route | Behavior |
|---|---|---|
| POST | `/api/shares` | `{sourceType,sourceId,password}` -> 201 `{share:{id,url,expiresAt}}` |
| GET | `/api/me/shares?before=<id>` | Owner-only `{shares,nextCursor}`, 50 records/page, newest first |
| DELETE | `/api/me/shares/:id` | `{}` -> 204; revocation is idempotent and owner-scoped |
| GET | `/api/shares/:token` | Identical generic password/policy prompt for existing, missing, expired or consumed links; no private metadata |
| POST | `/api/shares/:token/claim` | `{password,idempotencyKey}` -> `{ticket,startBefore,filename,size,sourceType}` after authorization and commit |
| GET | `/api/transfers/:ticket` | Atomically redeem and stream an attachment; never redirect to S3 |
| HEAD | `/api/transfers/:ticket` | 405; never consumes a ticket |

Creation always uses `expiresAt = creation + 24h`, `maxDownloads=1`, `downloadCount=0`, `status=active`, and `notificationsEnabled=true`. These settings are not client-overridable. Alternate expiry presets and configurable claim limits remain unimplemented. Owners may create separate shares for the same asset; each share has an independent claim limit. A future cleanup worker must account for every reference to an asset before deleting its bytes.

Both public share metadata and claim attempts share a process-local IP limit of 40 requests per 15 minutes. Transfers have a separate 60/minute IP limit; owner management allows 30/minute per account. Unknown-share and wrong-password attempts use the same 403 message and perform Argon2 verification. Valid-password attempts against expired, claimed with a different key, revoked or timed-out shares return 410. Infrastructure errors are sanitized. Proxy trust remains disabled; configure a trusted proxy and shared limits before deployment.

## Claim transaction and idempotency

Public tokens contain 32 cryptographically random bytes, encoded as 43 base64url characters. Only SHA-256 token hashes are stored. Share passwords use Argon2id with 64 MiB memory, three passes and parallelism one.

The browser creates a **secret random 32-byte** idempotency key per share/tab using Web Crypto. It retains that nonce in sessionStorage to survive reloads. Treat the nonce as a bearer secret; custom clients must generate it randomly and must not use predictable counters or constant keys. The password and transfer ticket are not persisted in browser storage. If sessionStorage is blocked, an in-memory nonce still permits retries until the page is reloaded; response recovery across reload is then unavailable. Closing the tab or clearing sessionStorage can lose claim-response recovery.

A domain-separated SHA-256 of the raw public token and secret nonce derives the raw transfer ticket deterministically. MongoDB stores only a hash of that ticket and a separate hash of the nonce. Because both inputs are high-entropy and neither is stored raw, the server can reproduce a ticket for an authorized retry without storing raw/encrypted bearer tokens or requiring a master recovery key. Knowing only the public link does not produce the ticket. Keep both credentials out of logs and telemetry.

After password verification and source eligibility checks, one MongoDB transaction:

1. Finds a previous ticket, if any. The same nonce can recover the original **issued**, unexpired ticket for a still-valid claimed share. It cannot change the deadline or recover a redeemed ticket.
2. Otherwise conditionally changes `active -> claimed`, requiring future expiry, `maxDownloads=1`, and `downloadCount < 1`, and increments the count once.
3. Creates the single ticket for that share with its hashed bearer and nonce, `status=issued`, and a start deadline of `min(now + 2 minutes, share expiry)`.
4. Records the conservative transfer window on the share and writes exactly one pending `share.claimed` outbox event.

Unique indexes enforce one ticket and one claim event per share. Failure of any write rolls back all changes. The Mongoose/driver transaction helper retries transient conflicts with snapshot reads and majority writes, with a 15-second overall transaction budget. Time is recalculated on transaction callback retries. There are no parallel MongoDB operations inside a transaction.

Twenty concurrent valid requests with different nonces produce one committed claim/ticket/event. Repeated requests using the winning nonce return the same unredeemed ticket, not another transfer. The server rechecks the password on recovery. If the first API response is lost, reload the same tab and enter the same password before the original start deadline. A different tab/nonce cannot recover it. A lost create-share response is different: its URL cannot be reconstructed from the hash; revoke the unused entry in My shares and create a replacement.

The transaction behavior follows [Mongoose 8 transactions](https://mongoosejs.com/docs/8.x/docs/transactions.html) and the [MongoDB Node driver transaction API](https://www.mongodb.com/docs/drivers/node/v6.x/crud/transactions/). The implementation uses the installed driver timeout support rather than inventing an application retry loop.

## Redemption and streaming semantics

Redemption atomically changes `issued -> redeemed` and writes the share document in the same transaction. Writing the share serializes redemption against revocation. Expiry and revocation are checked again. If revocation wins, redemption rolls back and no bytes are served. A revocation after committed redemption blocks future operations but does not terminate an already authorized stream.

Redemption is consumed **before** storage is opened. The API calls private S3 GetObject and pipelines its Node stream through an exact-size verifier to the HTTP response with backpressure. Snippets use the same attachment path from their bounded UTF-8 text. The browser uses its native downloader; it does not fetch the file into a JavaScript Blob or receive a presigned GET URL. The S3 request is server-side only.

All responses use attachment Content-Disposition with a sanitized ASCII fallback and encoded UTF-8 filename, `application/octet-stream`, `nosniff`, no-store, a sandbox CSP and no range support. Range requests return 416 before consuming a ticket. The transfer lasts at most five minutes from the start of the request; disconnects abort the storage pipeline. A transfer started before share expiry may finish within that window after expiry. `transferUntil` on the share conservatively covers the two-minute start window plus five minutes of streaming for future cleanup scheduling.

Semantics are **one committed claim**, not guaranteed file delivery:

| Failure | Result |
|---|---|
| Claim transaction aborts | No claim/ticket/event commits; retry is possible |
| Claim commits, response is lost | Same secret nonce + password recovers the same issued ticket within its original window |
| Start window expires without redemption | Share stays consumed; no new ticket |
| Redemption commits, storage lookup fails | Ticket remains redeemed; claim stays consumed |
| Stream disconnects, truncates or times out | Ticket remains redeemed; no restart or range retry |
| API crashes after redemption | No second transfer; metadata may remain `delivery=streaming` until later reconciliation |
| API finishes streaming | `delivery=finished` means bytes left the API, not that the recipient saved them |
| Post-stream status persistence fails | No reauthorization; stored delivery state can remain uncertain |

The UI makes consumption explicit before claiming. Once a download has been requested, the browser owns save/error handling. Reload/password recovery only helps if redemption never committed. Claims are not reset after broken streams or lost redemption responses.

## Verification

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
$env:CHROMIUM_CHANNEL='chrome' # Or install Playwright Chromium.
pnpm test:browser
python -m pip install -r tests/requirements-storage.txt
pnpm test:browser:workspace
git diff --check
```

Integration tests use a real isolated MongoDB replica set, with mocked storage for failure injection. They cover the 20-way claim race, same-key retries, atomic rollback on outbox failure, immediate expiry checks, owner isolation, revocation, double redemption, HEAD/Range behavior, scan gating, failed/truncated streams and public rate limits.

The workspace browser test adds a complete share journey to the Phase 2 multipart tests. It injects a trusted clean fixture, creates a file share through the UI, verifies hidden metadata/wrong-password handling, drops a committed claim response, reloads to recover the original ticket, downloads 17 MiB + 7 bytes through the API and compares SHA-256. It rejects replay, checks that the recipient never requests S3 directly, revokes the share, and downloads an HTML snippet as literal attachment bytes. Desktop/mobile screenshots are generated under ignored `test-results/` and reviewed. The storage backend is Moto, an emulator; this does not verify real AWS IAM/signatures or durable storage.

## Remaining work and Phase 4 prerequisites

No notifications are sent yet. The notification flag and outbox record express durable intent; there is no dispatcher, BullMQ consumer, email provider or cleanup job. There are no TTL indexes on shares/tickets/outbox, and no code in this phase deletes objects or metadata. Outbox records and transfer windows are retained for Phase 4.

Before production use, integrate trusted malware scanning and content detection, verify a durable private S3 bucket with backend GetObject permissions, configure HTTPS/reverse-proxy secret-free access logging for token-bearing routes, distributed rate limiting and persistent MongoDB/Redis. Application logs omit URLs, cookies, request bodies and bearer values; external proxy logs need equivalent treatment. Docker service runtime, real AWS behavior and remote CI are not claimed as locally verified.

Phase 4 should consume pending outbox events idempotently, notify that a share was **claimed**, respect all active transfer windows and shared-asset references, retry failed cloud deletion, reconcile interrupted operations and set metadata purge deadlines only after confirmed cleanup.
