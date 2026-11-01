# Demo and interview guide

## Reproducible demo checklist

1. Follow docs/operations.md local setup, then register two disposable accounts.
2. Create a private snippet containing HTML/code and show inert text rendering. Share with required password and 24-hour/one-claim defaults. Open public link in a separate browser session, reject wrong password, claim with correct password and show subsequent access unavailable.
3. Show owner notification, share details and 7/30-day analytics; second owner must not see the first owner's assets.
4. Show multipart upload/resume. Explain quarantine: ordinary files cannot be shared until a trusted scanner releases them. Browser fixtures simulate this trusted result only in isolated tests.
5. Run `pnpm test:integration` to reproduce the 20-request race with one winner, transactional rollback, ticket replay prevention and cleanup failure/retry. Run `pnpm test:worker` for a real Redis/BullMQ lost-job/reconciliation and transient deletion failure demo. Tests create isolated data; do not inject faults into a real account.
6. Run both browser commands to demonstrate the full UI with simulated scan and elapsed transfer deadlines. Compare captured screenshots in docs/screenshots. Run `pnpm benchmark` only with prerequisites, and explain local emulator/sample-size limits.
7. Show health endpoints and structured reconciliation logs. Explain pending target configuration and do not present the local app as a verified production service.

## Concise interview explanation

?I built a modular TypeScript API with a separate worker. Upload bytes go straight to private S3 using scoped multipart URLs, so retries only resend missing parts. The API verifies storage state rather than trusting browser ETags. Uploads remain quarantined until a trusted clean scan.

For one-time sharing, a conditional Mongo update and transaction commit the claim, opaque transfer ticket and outbox event together. Twenty simultaneous valid claims produce one winner in the integration test. The ticket is redeemed once and the API streams the object; a reusable S3 download URL would outlive the claim. One claim cannot guarantee that the recipient saves the file if the network fails.

The outbox stores durable intent before Redis delivery. Workers deduplicate notifications and make cleanup safe to retry, while reconciliation repairs missing jobs and stale leases. Expiry rejects access immediately, but deletion is asynchronous. Mongo TTL cannot delete S3 objects, so metadata gets a purge timestamp only after verified cleanup. Shared references and transfer windows protect live data.?

## Evidence-based resume examples

- Built a React/TypeScript temporary-sharing workspace with password-protected claims, scoped multipart uploads, private API streaming and owner analytics; verified one winner under a 20-request concurrent claim test.
- Implemented transactional outbox processing with BullMQ retries, idempotent notifications and reconciliation for lost jobs, failed deletions and abandoned multipart sessions.
- Measured cached owner analytics at 4.93/5.25 ms median and 8.40/7.64 ms p95 across two 20-request local runs, versus 36.08/39.18 ms median for an uncached reduction baseline; results include five-second cache reuse on local Mongo/Moto, not production scale.
- Authored container, CI/release configuration and recovery runbooks; production deployment and target AWS validation remain pending.

Only use numbers from docs/performance.md with their scope. Do not claim production users, savings, uptime, throughput capacity, live alert delivery or a cloud deployment without separate evidence.
