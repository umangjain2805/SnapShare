# SnapShare progress

## Phase 3 - implemented; infrastructure and scanner integration pending

- [x] Owner-scoped secure share creation, cursor-paginated listing and idempotent revocation.
- [x] Required Argon2id passwords, random public tokens hashed at rest, exact 24-hour expiry, one claim, notifications enabled.
- [x] Generic rate-limited public metadata with no private title, filename, content or owner disclosure.
- [x] Conditional claim transaction commits share consumption, hashed single-use transfer ticket and pending outbox event together.
- [x] Secret random client nonce recovers the same issued ticket after a lost claim response, without renewing the deadline.
- [x] Atomic ticket redemption serialized against revocation; two-minute start window capped by share expiry.
- [x] Private S3-to-API streaming with backpressure, abort/timeout, exact-size verification and safe attachment headers.
- [x] HEAD and Range cannot consume a ticket; failed/redelivered streams stay consumed.
- [x] File creation/claim/redemption requires a trusted clean scan; pending/rejected files remain blocked.
- [x] Owner create/copy/manage UI and public password/claim/download UI, including mobile states.
- [x] Concurrency, rollback, expiry, isolation, scan gate, stream-failure and browser recovery checks.
- [x] README, API/recovery documentation and checklist updated.
- [ ] Integrate a trusted scanner before making production file shares available.
- [ ] Verify Docker services, persistent Redis connectivity, real AWS/durable private storage and remote CI.

### Phase 3 verification evidence

Locally verified on Windows with Node 22.19.0, pnpm 12.11.2, Chrome and Moto 5.2.5:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed; no dependencies added in this phase |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed, including browser/integration tests |
| `pnpm test` | 34 passed: 3 unit, 8 auth, 9 asset, 14 share integration |
| `pnpm build` | Passed; existing third-party Zod/Rollup annotation warnings only |
| `pnpm test:browser` with Chrome | Passed: original auth/session/mobile flow |
| `pnpm test:browser:workspace` with Chrome | Passed: existing multipart/snippet flow plus clean-fixture file share, hidden metadata, wrong password, lost committed claim response, reload recovery, native streamed file/snippet downloads, SHA-256 byte comparison, replay rejection, revocation and mobile overflow |
| `git diff --check` | Passed |
| Docker / real AWS / remote CI | Not executed; no success claimed |

The 20-way claim test produced exactly one committed claim, ticket and outbox event. Five concurrent retries with the same nonce returned the same ticket and deadline. Injecting an outbox write failure left the share unclaimed and created no ticket/event. Two competing redemptions produced one success. Failed/truncated storage streams remained consumed. Screenshot artifacts under ignored `test-results/share-public-{desktop,mobile}.png`, `share-owner-desktop.png` and workspace images were visually reviewed.

### Phase 3 files and decisions

New backend files: `apps/api/src/modules/shares/{model,repository,service,controller,routes}.ts`. API app/startup register the routes and indexes; storage adds private GetObject streaming. The upload model accepts trusted `clean` and `rejected` scan outcomes without adding a client-controlled release route. Shared contracts define strict share/claim inputs and DTOs. Frontend additions are `features/shares/{ShareManager,PublicShare}.tsx` and `lib/resource-api.ts`; dashboard/workspace/styles integrate them. Tests add `tests/integration/shares.test.ts` and extend the existing workspace browser check, which is already in CI. README, development, Phase 2 cross-reference, [phase-3.md](phase-3.md) and this checklist describe actual scope.

Tokens and nonce values remain hashed in MongoDB. Ticket recovery derives the same opaque bearer from the public token and secret random browser nonce; there is no raw/encrypted ticket store or new environment secret. The nonce is a secret, not a predictable request counter. Claim and redemption transactions use snapshot reads, majority writes and a 15-second driver timeout. A transfer must start within two minutes and can run for at most five minutes. A committed claim is never refunded after a lost/failed stream. No reusable S3 GET URL, scheduled cleanup, notification delivery, metadata TTL or worker consumer is added.

File browser tests simulate a trusted clean scan result; they do not perform malware scanning. Snippet sharing works immediately, but normal uploads stay gated until a trusted scanner is integrated. Local S3 HTTP tests do not validate real AWS IAM/signatures. Rate limits are process-local, create-share response loss cannot recover the original URL, and closing/clearing the recipient tab can lose nonce-based recovery. Full manual verification, API shapes and failure semantics are in [phase-3.md](phase-3.md). Phase 4 prerequisites are persistent MongoDB/Redis/private storage, scanner release policy, and outbox/transfer-window-aware cleanup design.

## Phase 2 - implemented and locally verified; AWS/Compose verification pending

- [x] Authenticated, owner-scoped multipart initiation, part signing/listing, verified completion and retryable abort.
- [x] Server-owned keys, shared size/MIME/filename validation, five-minute PUT URLs, 24-hour sessions.
- [x] Transactional 1 GiB / 100 item owner quota, including concurrent reservations and once-only abort release.
- [x] Private completed files remain quarantined with pending scan state; no public file access.
- [x] Browser dropzone, progress, pause/manual resume, server-side recovery list and SHA-256 file identity checks.
- [x] Private snippet editor, language metadata, 32 KiB UTF-8 limit, inert highlighted preview and copy.
- [x] Local S3 emulator Compose configuration, loopback-only bucket setup, CORS/public-access/lifecycle configuration.
- [x] Storage abstraction tests, real MongoDB transactions, local HTTP storage/browser happy path and recovery checks.
- [x] README roadmap aligned with prompt.md; setup, API, policies, recovery limits and Phase 3 prerequisites documented.
- [ ] Verify Compose startup, Redis worker and persistent service behavior with Docker.
- [ ] Provision and verify private AWS/durable S3-compatible storage, IAM and real signature/lifecycle enforcement.
- [ ] Run the updated workflow on the remote repository.

### Phase 2 verification evidence

Executed locally on Windows, Node 22.19.0, pnpm 12.11.2, installed Chrome and Moto 5.2.5:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed, including tests |
| `pnpm test` | 20 passed: 3 unit, 8 auth integration, 9 asset integration |
| `pnpm build` | Passed; existing third-party Zod/Rollup annotation warnings |
| `pnpm test:browser` with Chrome | Passed: existing authentication and mobile checks |
| `pnpm test:browser:workspace` with Chrome | Passed: three-part 17 MiB + 7 byte HTTP upload, interruption/reload, changed-file rejection, existing-part reuse, byte-level SHA-256 verification, anonymous object access denial, persisted inert HTML snippet, desktop/mobile layout and no page errors |
| `git diff --check` | Passed |
| Docker / real AWS / remote CI | Not executed; no success claimed |

Screenshots at `test-results/workspace-desktop.png` and `workspace-mobile.png` were visually reviewed. The HTTP storage test uses a local emulator, not a real AWS bucket. It exercises the actual AWS SDK adapter and browser-to-storage PUT path. Full setup, manual checks, storage privacy requirements and recovery policies are in [phase-2.md](phase-2.md).

### Phase 2 files and decisions

New API files are `infrastructure/storage.ts`, `modules/assets/{model,repository,service,controller,routes}.ts`, and `scripts/setup-storage.ts`. Existing API app, startup and env validation register the feature and indexes. Shared contracts define policies and DTOs. `apps/web/src/features/workspace/Workspace.tsx`, App and styles implement the dashboard tools. Manifests/lockfile add AWS SDK and Prism dependencies. `.env.example`, Compose and CI add local storage/testing configuration. `tests/integration/assets.test.ts`, `tests/browser/workspace.smoke.ts`, `tests/helpers/storage.ts` and `tests/requirements-storage.txt` provide the new checks. README, development, progress and Phase 2 docs describe actual scope.

MongoDB reserves quota atomically with metadata creation; storage operations use retained intermediate states because S3 cannot share that transaction. No asset TTL or scheduled cleanup is introduced. Storage-confirmed parts and HEAD metadata gate completion, but MIME declarations are not content detection. No scanner releases files yet. Initializing or permanently completing failures retain keys/quota for operator reconciliation. The local emulator is ephemeral and does not validate production IAM/signatures. Browser hashing reads up to 256 MiB into memory. Public shares, transfer tickets and downloads belong to Phase 3; scanning release policy and private durable storage must be settled before exposing files.

## Phase 1 — implemented, local Docker verification pending

- [x] Workspaces: `apps/web`, `apps/api`, `apps/worker`, `packages/contracts`, `packages/config`.
- [x] Strict TypeScript, shared Zod inputs/public-user contract, compiled package exports.
- [x] Express routes → controllers → services → repositories → MongoDB models.
- [x] Environment validation, health/readiness, Helmet, allowlisted CORS, mutation Origin/JSON checks.
- [x] Safe errors and structured logs without credential or cookie values.
- [x] Argon2id registration/login, unique normalized email, hashed opaque sessions and logout revocation.
- [x] HTTP-only cookies, production Secure/Host prefix, session expiry checked at lookup, TTL cleanup.
- [x] Protected current-account endpoint, account isolation and auth rate limits.
- [x] React/Vite, Tailwind, shadcn-style Button, React Router and TanStack Query shell.
- [x] Sign In, Sign Up and Dashboard; accessible form labels, errors, pending/empty states, mobile layout.
- [x] MongoDB replica-set + Redis Compose configuration and Redis-connected worker scaffold.
- [x] Lockfile, lint/typecheck/build scripts, unit/integration tests, browser smoke and CI configuration.
- [x] Development instructions, manual verification, limitations and Phase 2 prerequisites.
- [ ] Start Compose and verify Redis worker connectivity on a Docker-enabled machine.
- [ ] Observe the authored GitHub Actions workflow on the remote repository.

## Verification evidence

Executed locally on Windows with Node 22.19.0 and pnpm 12.11.2:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed, including test code |
| `pnpm build` | Passed for contracts, API, worker and web |
| `pnpm test` | 11 passed: 3 unit, 8 integration |
| `pnpm test:browser` with `CHROMIUM_CHANNEL=chrome` | Passed: unauthenticated redirect, registration, reload/session persistence, logout, invalid login, valid login, mobile overflow and runtime error checks |
| `git diff --check` | Passed |
| Docker/Compose runtime | Not run: Docker executable unavailable |

Integration tests ran against an isolated real MongoDB 7.0.24 replica set. Browser checks used installed Chrome at 1440×960 and 390×844. Screenshots are generated under ignored `test-results/` and visually inspected. No deployment, Redis runtime validation or remote CI success is claimed. Build emits harmless third-party Zod/Rollup annotation warnings.

## Files and decisions

Root manifests/configuration and the lockfile establish the workspace. `apps/api/src` implements authentication and infrastructure; `apps/web/src` contains the shell, forms, query state and reusable Button; `apps/worker/src` holds the scaffold. `packages/` provides shared contracts/config. `tests/` contains unit, MongoDB integration and browser checks. `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`, `.gitignore`, README and development docs define reproducible setup.

Sessions are server-side bearer tokens with SHA-256 hashes at rest; cookie signing is unnecessary. Password hashing uses Argon2id. Exact Origin plus JSON enforcement protects mutations independently of CORS. Production cookie flags are tested; local cookies support HTTP development. Contracts compile before dependent builds, tests and development starts. Native Node starts run compiled API/worker outputs.

Rate limiting is process-local, proxy trust stays disabled, and the Compose network addresses target host-run applications. These are deliberate local-foundation choices that require deployment configuration later.

## Next phases

- [x] Phase 2: private multipart storage and safe code snippets, locally verified with an S3 HTTP emulator. Real AWS and Compose checks remain pending.
- [x] Phase 3: secure shares, atomic claims, transfer tickets, controlled streaming and pending outbox intent; scanner/infrastructure integration remains pending.
- [ ] Phase 4: durable notifications, cleanup and reconciliation.
- [ ] Phase 5: full product UI, analytics, hardening and measured performance.
- [ ] Phase 6: deployment and operations documentation.

Manual verification steps and exact run commands are in [development.md](development.md).
