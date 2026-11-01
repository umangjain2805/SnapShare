# Phase 6: deployment configuration and operational reliability

Implemented locally on November 2, 2026. No live deployment is claimed.

## Delivered

- Root multi-stage Dockerfile targets for compiled API/worker and unprivileged Nginx static web. Build context excludes secrets, dependencies and test artifacts. Node runtime uses the non-root node user; it currently retains build dependencies, so image size optimization remains possible.
- Separate production Compose configuration for external managed MongoDB/Redis/S3; restart/grace periods, private API/worker network access, container probes, no-new-privileges, API/worker capability drops. Existing developer Compose preserves host-accessible Mongo replica set and Redis; setup now documents provisioning the local S3 bucket explicitly.
- Production validation requires HTTPS origin, private bucket configuration and TLS Redis, rejects emulator endpoints/debug logging, and validates explicit trusted proxy IPv4/CIDR settings. Default trusts no proxy. Existing secure session cookies, exact-origin mutations, private DTOs and no-store remain enforced.
- API readiness pings Mongo with a bounded timeout and checks configured storage; generic health output is uncached. Worker exposes private health/readiness; readiness requires recent successful reconciliation and goes false during close. Listen failures follow startup cleanup. API JSON logs now include durationMs alongside request ID/method/status, without path or bearer values.
- CI adds container image builds, Compose schema validation and static web/proxy smoke. Manual release publishes immutable commit tags; deployment remains disabled until a configured authenticated HTTPS adapter and protected environments exist. The adapter's required rollout/verification contract is documented.
- Scoped AWS runtime IAM/TLS bucket policy templates, exact-origin S3 CORS/private-bucket instructions, alert thresholds and delivery setup, storage budget guidance, backup/restore, incident/reconciliation and rollback procedures.
- Updated README status, real feature checkboxes and ERD; API examples, reproducible demo checklist, interview explanation and evidence-based resume bullets. Existing architecture/claim sequence diagrams, measured performance and genuine application screenshots are linked.
- Browser tests accept BROWSER_TEST_PORT, including emulator CORS, so checks can run while a development frontend occupies 5173. ESLint excludes generated test-results helpers.

See [operations](operations.md), [API examples](api.md), [portfolio guide](portfolio.md) and [measured benchmarks](performance.md).

## Local verification

- `pnpm lint`, `pnpm typecheck`, `pnpm build` passed. Existing third-party Zod/Rollup annotation warnings remain nonfatal.
- `pnpm test`: all 48 unit/integration tests passed, including production configuration rejection cases, generic readiness failure and the existing 20-way atomic claim race.
- `pnpm test:browser`: passed with local Chrome and BROWSER_TEST_PORT=5183.
- `pnpm test:browser:workspace`: passed with local Chrome, Redis and Moto on BROWSER_TEST_PORT=5184; covers multipart/resume, scan gate, secure stream, notices/cleanup and responsive analytics/workspace.
- `pnpm test:worker`: real Redis/BullMQ smoke passed; covers worker restart, transient cleanup failure/retry, lost queues, retained metadata, quota release and a compiled worker process. Additional health assertions check actual HTTP readiness, no-store and generic 404 responses.
- Workflow/Compose YAML and AWS policy JSON parse successfully; `git diff --check` passed.

The first browser attempt encountered the user's occupied development port. Tests were rerun using the configurable alternate port without stopping the development server. No production credentials were read or published.

## Remaining target acceptance checks

Docker is not installed in this local environment, so image builds, Nginx runtime and Compose fresh-clone startup require the authored CI/container job or a Docker-capable machine. Remote GitHub Actions has not been run here. YAML parsing is not a container execution test.

No target hosting, deployment adapter, certificate, cloud identity, live alerts/budget destination or managed backups have been configured or verified. Before enabling deployment, follow operations.md: verify private S3 IAM/CORS/nonversioned deletion, TLS/reverse proxy/cookies, image provenance, external health probes, restore drill and alert delivery. The current topology is one API/web process with local rate limits; shared rate-limit storage and real-IP topology verification are required before scaling out.

Malware scanning remains a trusted external integration prerequisite: ordinary file uploads stay quarantined. No scanner bypass or fictitious clean result is added to production. Optional email provider delivery is still target-dependent. Snippet sharing is available for local demonstration without scanner integration. Performance figures remain the original small local emulator measurements; this phase makes no new capacity or availability claim.
