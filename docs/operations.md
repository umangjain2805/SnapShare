# Deployment and operations

## Reproducible local setup

Install Node 22.12+, pnpm 12.11.2 and Docker Desktop with Compose. From a fresh clone:

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm services:up
pnpm storage:setup
pnpm dev
```

Open http://localhost:5173 (exact APP_URL origin). Mongo is a persistent single-node replica set advertised as localhost for host processes. Redis persists AOF; Moto storage is ephemeral. Restarting Moto loses objects: recreate its bucket with storage:setup. Never use this stack for durable production data. `pnpm services:down` preserves database volumes; do not delete volumes to fix application failures. Application processes run on the host deliberately so browser-visible signed S3 URLs use the same loopback endpoint. Production containers use managed services instead of this localhost replica set.

Health checks: GET http://localhost:4000/api/health and /api/ready, worker http://localhost:4001/health and /ready. Set BROWSER_TEST_PORT to a free port (for example 5183) when running browser tests alongside a development frontend; the test S3 CORS origin follows this setting. Readiness returns 503 until dependencies work; worker readiness requires a successful reconciliation within max(60 seconds, three intervals). API readiness pings Mongo with a two-second timeout and verifies storage configuration; it does **not** prove S3 credentials, Redis, email or scanner health. Worker reconciliation reads Mongo and both queues; it does not probe every S3 object. Keep worker health port private. Health responses never include connection strings or queue data.

## Production target configuration

No production target or credentials have been verified. The checked-in files are deployment configuration, not evidence of a live deployment. The current release supports one API process and one web proxy. Before multiple replicas, implement shared account/IP rate-limit storage and verify client-IP attribution under the real ingress. Nginx adds a process-local coarse IP limit, not cluster-wide abuse protection. With proxy trust unset the API conservatively limits the proxy address; set TRUSTED_PROXIES only to actual ingress IPv4 addresses/subnets. API ports must be inaccessible to clients. Nginx overwrites forwarded headers. If another load balancer precedes Nginx, its address is the Nginx rate-limit key until an explicitly trusted real-IP configuration is added; do not trust client-supplied forwarding headers globally.

1. Provision a managed Mongo replica set with authentication, TLS and backups, TLS Redis with persistence/no eviction, and a dedicated private **never-versioned** S3 bucket. Current deletion rejects both enabled and suspended versioning. Use a workload IAM role with `infra/aws/runtime-policy.json` after replacing REPLACE_BUCKET. Separate provisioning privileges from runtime roles.
2. Block all four forms of S3 public access, enable bucket-owner-enforced ownership and default AES256 encryption. Apply `infra/aws/bucket-policy.json` to deny non-TLS requests. Set CORS to the exact HTTPS APP_URL, PUT only, content-type header, exposed ETag, max age 300. Set lifecycle only to abort incomplete quarantine/ multipart uploads after two days. Never add blanket object expiration that races live transfer windows. The runtime must list multipart uploads to clean abandoned objects. Test denied anonymous GET, signed PUT, multipart completion and physical deletion using the real role.
3. Copy infra/production.env.example to ignored `.env.production` on the target. Populate it through the target secret manager with permissions limited to the service user. No secret is a build argument, Vite variable, image layer or workflow artifact. Production env validation rejects HTTP APP_URL, custom S3 endpoints, missing buckets, plaintext Redis and debug logging. Mongo TLS/auth must be enforced by the managed target; URI syntax validation is not a TLS audit. Prefer role credentials to static S3 keys. Rotate database/Redis/email credentials in the secret manager, restart services and verify readiness. Rotate sessions by invalidating affected database sessions after compromise.
4. Put a TLS load balancer on the same host/network in front of loopback port 8080. Configure certificate renewal, HTTPS redirect, HSTS (including subdomains only when owned), request/time limits and health routing. Do not expose 4000/4001 or backend services. Remote container ingress needs an explicitly private binding/network instead of loopback. Verify Secure/HttpOnly/SameSite cookies, exact-Origin mutation rejection, SPA fallback, CSP, CORS and all HTTPS asset/upload/download requests. Nginx CSP allows AWS endpoints for direct PUT; custom domains require an explicit policy edit. Disable/redact load-balancer access logs because share/ticket URLs are bearers. Nginx access logging is disabled; API logs omit paths, IPs, bodies and credentials.
5. Build/pull immutable images, then run the following on the target with IMAGE_PREFIX/IMAGE_TAG configured. Fixed API/worker health ports must match their env values.

```sh
docker compose -f compose.production.yml pull
docker compose -f compose.production.yml up -d --wait
docker compose -f compose.production.yml ps
```

Record image digests, configuration revision, backup ID, public health probe and snippet claim/download result. Roll back IMAGE_TAG to the last verified SHA and repeat up --wait; never reset Mongo or Redis. There are no destructive schema migrations in this phase. A target operator must check compatibility before future rollback.

## CI and release adapter

CI runs lint, TypeScript, unit/integration, both browser flows, real Redis worker smoke, infrastructure checks and container builds/static proxy checks. It is authored here; remote CI results must be checked in GitHub. Manually dispatched Release images publishes SHA tags to GHCR using GITHUB_TOKEN. Configure the protected `release` environment and require passing CI on the exact commit. Restrict production environment reviewers/branches.

Deploy configured target is disabled unless repository variable DEPLOY_ENABLED equals true. Set production environment secrets DEPLOY_WEBHOOK_URL (HTTPS) and DEPLOY_WEBHOOK_TOKEN only after a deployment adapter exists. Its POST body is `{ "imageTag": "<40-character commit SHA>" }`. The adapter must authenticate, allowlist the registry/repository, verify CI and image provenance, pull the three immutable images, inject secrets on target, execute Compose, wait for readiness and run an external snippet probe before returning success. A webhook HTTP success alone is not proof of deployment health. No SSH host, cloud account or adapter is fabricated. Do not enable this gate until those checks are implemented on the target.

## Monitoring and alert delivery

API emits JSON requestId/method/status/durationMs, with no URL or payload. Worker emits reconciliation_cycle with pendingEvents, oldestPendingMs, failedAssets and notificationJobs/cleanupJobs counts; job_failed, job_stalled, queue_connection_error and reconciliation_failed signal failures. Send stdout to a restricted log collector with 14-day retention; avoid storing provider response bodies. Configure the following in the target's log/metric alerting service and send test alerts to the actual on-call destination before launch. These are initial thresholds, not measured SLAs; no alert integration is active locally.

| Signal | Initial alert | Response |
|---|---|---|
| External ready probe | 3 failed probes, every 15s | Check API/Mongo and recent rollout; roll back if regression |
| Worker heartbeat | No successful cycle for 60s or three intervals | Check worker readiness, Mongo, Redis; restart after fixing dependency |
| Outbox lag | oldestPendingMs > 60000 for 5 minutes | Check dispatcher/queues and delivery provider |
| Cleanup failure | failedAssets > 0 for 5 minutes, or cleanupJobs.failed > 0 | Check S3 permissions/versioning, live transfer grace and worker retries |
| API errors | 5xx > 2% with at least 100 requests over 5 minutes | Correlate request IDs; inspect dependency metrics |
| Latency | p95 durationMs > 1000 for 10 minutes | Compare route-free aggregate to local benchmark; investigate saturation |
| Redis | memory > 75%, eviction count > 0 | Increase capacity; use noeviction; reconcile durable intents |
| Storage cost | budget forecast > 80%, actual > 100% monthly budget | Alert billing owner; inspect bytes/incomplete multipart counts and cleanup lag |

Enable AWS Budgets with a chosen monthly amount and verified notification destination, S3 daily storage metrics and request metrics if cost justified. Reconciliation logs count only upload cleanup failures; inspect snippet cleanup failures separately in Mongo during incidents. No paid infrastructure or destination has been provisioned by this change.

## Retention, backups and restore

Access expires at policy time even if cleanup lags. Worker removes bytes after all reference/transfer deadlines, confirms absence, releases quota and only then schedules metadata purgeAfter using METADATA_RETENTION_DAYS (default seven). Mongo TTL is asynchronous, not an access control or S3 delete mechanism. Review owner-account/session retention separately before launch. Do not put recipient IPs or user agents into logs or new analytics.

Use managed encrypted Mongo point-in-time backup, daily snapshots with seven-day retention, and a monthly isolated restore drill. Proposed targets: RPO 24h, RTO 4h; these remain unverified until a drill. Protect backup access and record restore timing. Redis persistence is operational recovery, not the source of durable outbox intent. Expired file bytes are deliberately not backed up in the dedicated nonversioned bucket; explain this irreversible temporary-storage policy to users. Database backups may contain historical snippet text and metadata until backup retention ends; restrict and expire them accordingly.

Restore procedure: stop API writes and workers, restore Mongo to an isolated authenticated replica set, configure a fresh Redis namespace/instance, verify indexes and transaction support, compare live metadata with S3 head checks, then start one worker to reconcile. Never restore S3 objects automatically or reactivate expired/claimed shares. Missing objects cannot be recovered by metadata restore. Validate quotas and one-time claims using fixture accounts before reopening traffic. Record discrepancies and the backup cutoff.

## Incident and reconciliation runbook

1. Identify symptom via health probes and timestamped structured logs. For credential compromise, restrict ingress, rotate secrets and revoke affected sessions. Preserve redacted evidence; do not paste bearers into tickets.
2. For S3 deletion failures check role DeleteObject, GetBucketVersioning, ListBucketMultipartUploads and AbortMultipartUpload, bucket nonversioned status, network/TLS and retention windows. Do not mark deleted or release quotas by hand when bytes still exist.
3. For lost Redis jobs restore connectivity and start one worker. Each cycle dispatches pending durable outbox events and reconciles expired/unreferenced assets, stale leases and abandoned uploads. Existing handlers retry failed/completed jobs idempotently; reconciliation intentionally repeats. Watch pending count/age trend down and cleanup converge. Do not delete outbox rows, reset claim counters or remove live transfer tickets to force progress.
4. If reconciliation_failed repeats, fix Mongo/Redis/storage config first, restart worker and wait at least two cycles. Verify notification sourceEventId uniqueness, object absence and one quota release using owner analytics and controlled database inspection. Escalate persistent records with IDs only. Some assets remain correctly protected by other active shares or transfer windows.
5. Record incident times, affected record counts, restoration evidence and follow-up. Run the cleanup-failure smoke and simultaneous-claim tests on isolated data before release; never run fault injection on production users.

Sources used for infrastructure configuration: [Docker dependency health checks](https://docs.docker.com/compose/how-tos/startup-order/) and [AWS S3 security guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html).
