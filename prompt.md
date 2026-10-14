# SnapShare — 6-Phase Implementation Prompts

> **Purpose:** Use this file with Codex or another coding assistant to build SnapShare incrementally. Paste the **Global Instructions** with the selected phase prompt, or keep this entire file in the repository and ask the agent to implement one phase at a time.
>
> **Status:** This is an implementation plan, not a statement that the functionality already exists. Complete phases sequentially. Do not mark a phase complete without running its checks.

## Project goal

Build **SnapShare**, a secure temporary file and code-snippet sharing platform with password-protected expiring links, one-time access, large resumable uploads, private object storage, notifications, analytics, and reliable cleanup.

**Stack:** pnpm monorepo, React + Vite + TypeScript, Tailwind + shadcn/ui, React Router, TanStack Query, Node.js + Express + TypeScript, MongoDB + Mongoose (replica set for transactions), AWS S3 (private bucket), Redis + BullMQ, Docker, Vitest/Supertest/Playwright, GitHub Actions.

**Default share policy:** expires **24 hours after creation**, `maxDownloads = 1`, password **required**, notifications **enabled**. Design other policy presets as future extensibility, not as shortcuts around this default.

## Global instructions (apply to all phases)

1. **Read `README.md`, inspect the existing repository, and preserve working code.** If repository reality disagrees with the README, document the discrepancy; don't blindly replace implementation.
2. Work **only on the requested phase**. Do not implement future phases prematurely. Give a concise plan, then make the code changes, run checks, and report results.
3. Use strict TypeScript, modular service/controller/repository boundaries, Zod or equivalent input validation, centralized error handling, structured logs, and environment validation. Do not hardcode secrets.
4. Treat user uploads as untrusted. Use private storage, strong random tokens, token hashes at rest, Argon2id for passwords, least-privilege IAM, quotas, allowed MIME/size policies, and HTTP security headers. Never execute uploaded snippets or expose raw HTML inline.
5. Enforce authentication and ownership on account and upload routes. Public access routes must be rate-limited and avoid revealing sensitive metadata before authorization.
6. Keep S3 files **private**. Upload big files browser-to-S3 with short-lived presigned multipart part URLs. For strict one-time downloads, **do not** redirect to a reusable S3 presigned GET URL; claim access atomically and stream through a controlled API endpoint.
7. A download limit of 1 means **one successful committed claim**, not guaranteed complete delivery. Once claimed, a broken download is not automatically reauthorized. Define transfer-ticket state and a short start window explicitly.
8. Prevent metadata loss during cleanup: expiration is checked at read time; deletion of S3 objects is retried; apply MongoDB TTL to metadata **only after verified cleanup** using a separate `purgeAfter` field.
9. Multi-document operations (share claim + transfer ticket + outbox event) must use MongoDB transactions on a replica set. Ensure idempotency and conditional atomic transitions. Expect transaction conflicts.
10. Jobs must be safe to retry. Use a transactional outbox between MongoDB and BullMQ; run a reconciliation process for failed or missed cleanup/notification work.
11. Add/update tests with each phase. Report tests/typecheck/lint/build results honestly; never claim deployment, performance, security or feature completion without evidence.
12. At the end of each phase, provide: files changed, technical decisions, commands run, test results, known limitations, manual verification steps, and the next phase's prerequisites. Update README status and a project checklist.

## Suggested repository layout

```text
snapshare/
├── apps/
│   ├── web/                    # React + Vite frontend
│   ├── api/                    # Express REST API
│   └── worker/                 # BullMQ consumers and reconcilers
├── packages/
│   ├── contracts/              # Shared DTO / Zod schemas
│   ├── config/                 # TS/lint shared configs
│   └── utilities/              # Pure shared functions
├── tests/
│   ├── integration/
│   ├── concurrency/
│   └── e2e/
├── infra/docker/
├── docs/
├── .github/workflows/
├── docker-compose.yml
├── pnpm-workspace.yaml
├── README.md
└── prompt.md
```

---

## Phase 1 — Foundation, architecture, and authentication

**Goal:** Establish a healthy monorepo and a secure foundation with local services, account sessions, database connectivity, and a usable frontend shell.

### Copy-ready prompt

> Implement **Phase 1 only** of SnapShare according to `README.md` and `prompt.md`. Inspect the repository first. Set up pnpm workspaces for `apps/web`, `apps/api`, `apps/worker`, and shared contracts/config. Initialize Vite React TypeScript with Tailwind/shadcn/ui and React Router; create a modular Express TypeScript API with Zod validation, error handling, health route, CORS allowlist, Helmet, structured logging and environment validation. Configure MongoDB in replica-set mode locally, Redis, and a Docker Compose developer setup. Implement user registration, login, logout and secure session cookies with appropriately hashed secrets; session ownership protection and rate limiting; responsive frontend shell with Sign In, Sign Up and Dashboard pages. Add unit/integration tests, lint, typecheck and a simple CI workflow. Provide `.env.example` but never commit credentials. Do not implement uploads or sharing in this phase. Document run commands and limitations.

### Deliverables

- Monorepo, shared configs, baseline API and app shell.
- Docker Compose local MongoDB replica set + Redis; worker process scaffold.
- User/session models, secure authentication routes and UI.
- Reproducible setup instructions, `.env.example`, baseline CI.

### Acceptance checks

- [ ] `pnpm install`, lint, typecheck and build pass.
- [ ] Local services start with documented commands.
- [ ] Registration/login/logout tested, including invalid credentials.
- [ ] Protected dashboard rejects unauthenticated users.
- [ ] No secrets committed; README status accurate.

---

## Phase 2 — Private storage, resumable uploads, and code snippets

**Goal:** Make file and snippet creation work end-to-end, without yet enabling advanced one-time claims.

### Copy-ready prompt

> Implement **Phase 2 only**. Build the upload-session model and authenticated REST endpoints to initiate S3 multipart uploads, request signed part URLs, list/check uploaded parts, complete verified uploads and abort abandoned uploads. Generate server-owned object keys; validate size/type/ownership and limits; do not proxy large file bytes through Express. Use private AWS S3 (or a local S3-compatible development service), and prepare a malware-scan/quarantine state before shares become available. Support browser upload progress and resume after recoverable network interruptions, with a documented storage/session recovery policy. Add an authenticated code-snippet editor with language metadata and safe syntax highlighting, storing text with size limits and escaped rendering. Write integration tests using storage abstractions/mocks plus one local end-to-end happy path. Do not implement public one-time downloads, notifications or worker cleanup beyond upload abort behavior in this phase.

### Deliverables

- UploadSession model, S3 storage adapter, multipart upload API.
- Upload dropzone with progress/resume and clear error states.
- Code snippet editor and safe preview.
- Upload completion verification, ownership checks and limits.

### Acceptance checks

- [ ] A valid large file uploads in parts and can be resumed.
- [ ] Unauthorized users cannot control another user's upload.
- [ ] File-size/type violations and interrupted uploads handled.
- [ ] Uploads remain private; snippets cannot execute code/HTML.
- [ ] Tests, typecheck, lint and build pass.

---

## Phase 3 — Secure share policies and atomic one-time access

**Goal:** Implement the core differentiator correctly: 24-hour, password-protected, single-claim links under concurrency.

### Copy-ready prompt

> Implement **Phase 3 only**. Add a Share domain model with owner, verified upload/snippet reference, SHA-256-hashed high-entropy public token, Argon2id password hash, `expiresAt = createdAt + 24h`, `maxDownloads = 1`, `downloadCount = 0`, status, and `notificationsEnabled = true`. Add authenticated share creation/management and rate-limited public metadata/password flows. Require authorization before revealing private file details. Implement a conditional atomic claim (`status=active`, future expiry, count below limit), with a MongoDB replica-set transaction that **together** changes share state, creates a hashed short-lived single-use transfer ticket and writes an outbox event. Add the ticket-redemption endpoint with an atomic issued→redeemed transition and stream private S3 objects from the API with backpressure and safe headers; never return a reusable signed S3 download URL. Specify what happens on failed streams and lost API responses; a broken transfer remains consumed. Add idempotency handling for retried claim requests without granting a second transfer. Write concurrency tests (20 simultaneous claims → exactly one committed claim/ticket) and expiration, incorrect-password and double-redemption tests. No email worker yet.

### Deliverables

- Share/transfer ticket/outbox models and secure share routes.
- React share creation form and public password + download UI.
- Atomic claim transaction and controlled streaming route.
- Concurrent request and expiration tests.

### Acceptance checks

- [ ] Exactly one of 20 concurrent valid claims succeeds.
- [ ] Password guessing is rate-limited and unauthorized metadata is hidden.
- [ ] Expired or consumed shares cannot be newly claimed.
- [ ] Tickets cannot be reused and object keys remain private.
- [ ] Failure behavior is documented and tested.

---

## Phase 4 — Durable notifications and automatic cloud cleanup

**Goal:** Make asynchronous side effects reliable without slowing or corrupting the API path.

### Copy-ready prompt

> Implement **Phase 4 only**. Configure BullMQ queues and separate worker process for outbox dispatch, uploader notifications, S3 deletion and reconciliation. Claims must produce durable outbox events in the same transaction as the claim; a dispatcher enqueues events with stable identifiers, retries failed enqueue, and records processing state. Worker creates idempotent in-app notifications and optionally email via a provider adapter, labeling notification semantics as "share claimed" rather than "download definitely saved". Implement expiry/revocation checks at API access time and cleanup jobs that wait for active transfer windows, remove underlying S3 objects, retry with backoff, and record cleanup completion. Add a periodic reconciliation job to find expired shares, stranded upload sessions and missed jobs. Only set metadata `purgeAfter` after S3 cleanup success, then use a TTL index on `purgeAfter`. Build a notifications UI and status indicators. Test S3 deletion failures, queue retries, duplicate events and recovery after worker outages.

### Deliverables

- Outbox dispatcher, notification/cleanup workers, reconciliation jobs.
- Notification store, UI and optional email adapter.
- Safe cloud cleanup and metadata retention/TTL rules.
- Worker observability and failure recovery tests.

### Acceptance checks

- [ ] Expired links become inaccessible even before cleanup runs.
- [ ] Failed S3 deletions retry without losing object keys.
- [ ] Duplicate jobs do not create duplicate in-app notifications.
- [ ] Metadata persists until deletion confirmed.
- [ ] API stays responsive when notification provider is unavailable.

---

## Phase 5 — Full product UI, analytics, hardening, and performance

**Goal:** Make SnapShare a polished, usable product and validate the system under realistic conditions.

### Copy-ready prompt

> Implement **Phase 5 only**. Complete the responsive Upload Dashboard, Snippet Editor, My Shares listing/details, link revocation UI, secure public share page, Notifications, and Analytics Dashboard. Add accessible loading/empty/error states, file progress, copy-link UX and mobile layouts. Add owner-scoped analytics for uploads, claims, expiration, transfer failures, storage consumption and cleanup state; collect only minimal necessary access data. Implement pagination and database indexes, safe rate limiting, upload quotas, secure headers, error sanitization, logging, and basic malware quarantine integration or an explicitly documented nonproduction limitation. Add unit, integration, Playwright E2E tests for critical user journeys and k6 benchmarks for API initiation, lookup, claim and streamed downloads. Compare baseline vs optimized latency using actual measurements; do not invent metrics. Keep default policy 24h/one claim/password/notifications intact.

### Deliverables

- Complete accessible frontend flows and owner analytics.
- Hardening: authorization, quotas, validation and abuse controls.
- E2E tests, load testing scripts and measured performance report.
- Updated diagrams and UX screenshots captured from running app.

### Acceptance checks

- [ ] Complete upload → share → password → claim → download flow works.
- [ ] Private data is tenant/owner isolated; malicious inputs tested.
- [ ] E2E checks pass on desktop and a mobile viewport.
- [ ] Real measured latency/throughput documented, with environment.
- [ ] Outstanding security limitations disclosed.

---

## Phase 6 — Deployment, operational reliability, and interview-ready portfolio

**Goal:** Deliver a well-documented, monitored, testable application ready for a GitHub portfolio and demos.

### Copy-ready prompt

> Implement **Phase 6 only**. Containerize web/API/worker as appropriate, finish Docker Compose developer workflows, add separate runtime configs and production-safe health/readiness checks. Create GitHub Actions workflows for lint, typecheck, unit/integration and E2E tests, build and deployment (where credentials and deployment targets are configured). Set up production environment validation, HTTPS, private S3 IAM policies, CORS, secure cookies, secret handling, structured logs, monitoring and alerts for queue lag, failed cleanup, API errors and storage costs. Add data retention/backup and incident runbooks, plus a reconciliation procedure. Deploy only if valid credentials and infrastructure are available; never claim a deployment happened otherwise. Finish README with accurate implemented-feature checkboxes, architecture/ERD/sequence diagrams, API examples, local setup, test commands, screenshots, known limitations, measured benchmarks and a demo checklist. Prepare a concise interview explanation of atomic claims, streaming, multipart uploads, TTL limitations and outbox reliability.

### Deliverables

- Docker and CI/CD configuration, monitored deployment when possible.
- Complete developer and operational documentation.
- Demonstrable live app or reproducible local demo.
- Honest resume bullet examples based on verified features and numbers.

### Acceptance checks

- [ ] Fresh clone can follow documented setup successfully.
- [ ] CI checks pass; configured service health endpoints work.
- [ ] Secrets are excluded from source control and security settings verified.
- [ ] Cleanup failure and simultaneous-claim demos are reproducible.
- [ ] README describes *actual* state, with evidence for any benchmark claims.

---

## Cross-phase API reference (target design)

| Method | Route | Introduced |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Phase 1 |
| POST | `/api/uploads/initiate` | Phase 2 |
| POST | `/api/uploads/:id/parts` | Phase 2 |
| GET | `/api/uploads/:id` | Phase 2 |
| POST | `/api/uploads/:id/complete` | Phase 2 |
| DELETE | `/api/uploads/:id` | Phase 2 |
| POST | `/api/shares` | Phase 3 |
| GET | `/api/shares/:token` | Phase 3 |
| POST | `/api/shares/:token/claim` | Phase 3 |
| GET | `/api/transfers/:ticket` | Phase 3 |
| GET | `/api/me/shares` | Phase 3 |
| DELETE | `/api/me/shares/:id` | Phase 3 |
| GET | `/api/me/notifications` | Phase 4 |
| GET | `/api/me/analytics` | Phase 5 |

## Definition of done for every phase

- [ ] Code is implemented in the repository, not merely described.
- [ ] Phase acceptance tests have been executed; failures clearly reported.
- [ ] Lint, typecheck, and applicable builds pass.
- [ ] Changes are documented and security issues are not hidden.
- [ ] No unrequested future phase is silently implemented.
- [ ] README and progress checklist reflect real state.

## How to use with Codex CLI

From the repository root, use a prompt like:

```text
Read README.md and prompt.md in full. Implement Phase 1 only from prompt.md.
Inspect existing files before changing anything. Follow all Global Instructions.
Run relevant tests, lint, typecheck, and build. Update project documentation.
Finish with files changed, checks run, failures, limitations, and Phase 2 prerequisites.
```

For subsequent phases, replace `Phase 1` with `Phase 2`, etc. Review the changes and checks after each phase before continuing.
