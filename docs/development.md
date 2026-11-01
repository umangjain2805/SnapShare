# Phase 1 development

Current worker/notification/cleanup setup is in [Phase 4](phase-4.md).

For the current upload/snippet setup, use [Phase 2 development](phase-2.md). For secure sharing, see [Phase 3 usage](phase-3.md). This document records the original authentication foundation.

## Setup

Install Node.js 22.12+ (tested with 22.19.0), pnpm 12.11.2, and Docker Desktop with Compose. From the repository root:

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm services:up
pnpm dev
```

Open `http://localhost:5173`. Vite proxies `/api` to port 4000. Use this exact browser origin: `APP_URL` must match, without a trailing slash. API and worker read the root `.env` independently of their working directories. No frontend secrets are needed. Production requires an HTTPS origin.

Compose persists MongoDB and Redis in named volumes and binds ports to loopback. The MongoDB health check initializes a single-node `rs0` and waits for a writable primary. The member advertises `localhost:27017` for host applications. Containerizing applications later requires changing the advertised address and URI together. Local databases have no authentication; this setup is for development only.

Verify local services:

```powershell
docker compose ps
docker compose exec -T mongo mongosh --quiet --eval 'db.hello().isWritablePrimary'
docker compose exec -T redis redis-cli ping
```

Expected: both services healthy, `true`, and `PONG`. `pnpm services:down` preserves data. The worker is an idle Redis-connected scaffold; queue consumers arrive in Phase 4.

To run separately, first run `pnpm --filter @snapshare/contracts build`, then use separate terminals:

```powershell
pnpm --filter api dev
pnpm --filter web dev
pnpm --filter worker dev
```

`pnpm dev` builds contracts first and starts all three processes. Rebuild shared contracts and restart affected processes after changing them. Contracts export compiled JavaScript for native Node compatibility.

## Build and checks

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
```

Integration tests start a real isolated MongoDB replica set using `mongodb-memory-server`. The first run downloads and caches a MongoDB binary; Windows downloads can be large. Its installation script is disabled, so downloading occurs only when tests request it. Tests never use `.env` or the development database. Avoid simultaneous first-time downloads.

Browser smoke starts its own database, API on a dynamic port, and Vite on 5173; stop an existing frontend first. Services close afterward. If Chrome is installed, Windows users can skip downloading Chromium:

```powershell
$env:CHROMIUM_CHANNEL='chrome'
pnpm test:browser
```

Screenshots are saved in ignored `test-results/`. CI installs Chromium and runs lint, typecheck (including tests), tests, build, browser smoke and Compose checks. The workflow is authored; remote execution is not claimed.

After `pnpm build`, `pnpm --filter api start` and `pnpm --filter worker start` run compiled JavaScript. The frontend output is `apps/web/dist`. Production hosting must serve this directory, fall back to `index.html` for browser routes and proxy `/api`. Vite's development proxy does not carry into static hosting.

## Authentication design

Passwords are 12–128 characters on registration and hashed with Argon2id (64 MiB, 3 passes, parallelism 1). Emails are normalized to lowercase with a unique index. Only ID, name and email are returned. Wrong-password and unknown-account logins return the same response; missing accounts still perform dummy hash verification.

Sessions use 32 random bytes, base64url encoded. Only SHA-256 token hashes and owner IDs are stored. They expire after seven days by default (configurable 1–30 days). Lookups check expiry immediately; TTL removes stale session records later. Logout revokes only the calling session. Independent device sessions are supported. No cookie-signing secret is needed for this server-side lookup design.

Cookies are HTTP-only, SameSite=Lax, Path=/, and Secure in production. Production uses `__Host-snapshare_session` without a Domain; local HTTP uses `snapshare_session`. Mutations require JSON and the exact allowed Origin, including registration/login/logout. Non-browser clients must supply the same Origin. Auth responses are `no-store`.

Authentication routes share a 20-attempt-per-15-minute IP limit. Proxy trust is disabled. Before deploying behind a proxy, configure trusted proxy hops and a shared rate-limit store. Logs contain generated request IDs, methods and status codes, without request URLs, credentials, cookies or raw database errors.

Available API routes:

| Method | Route | Behavior |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/ready` | Database connectivity |
| POST | `/api/auth/register` | `{name, email, password}`; create account and session |
| POST | `/api/auth/login` | `{email, password}`; issue session |
| POST | `/api/auth/logout` | `{}`; revoke caller's session |
| GET | `/api/auth/me` | Current user or 401 |

## Manual verification

1. Start services/apps and request `/api/health` and `/api/ready`; expect 200.
2. Visit `/dashboard` incognito; expect `/signin`.
3. Register a unique email with a password of at least 12 characters; expect your dashboard.
4. Reload; the session persists. Inspect cookie flags. Secure is intentionally off for local HTTP.
5. Sign out and revisit `/dashboard`. Try an incorrect password, then the correct one.
6. Register another account in a separate profile; dashboards show their own emails.
7. Resize to mobile. Forms and sign-out remain usable; toolkit cards say coming soon.
8. Verify Redis worker startup and the MongoDB primary checks above.

## Foundation limits and historical Phase 2 prerequisites

Docker is unavailable in this implementation environment. Compose startup and live Redis worker connectivity require verification on a Docker-enabled machine. Isolated MongoDB tests do not replace verification of persistent local services.

Phase 2 now implements private uploads and snippets; see [phase-2.md](phase-2.md). Shares, notifications, analytics, cleanup, deployment and password recovery remain planned. Rate limits are process-local. Deployment-specific proxy configuration and distributed abuse controls are deferred. No deployment or production security certification is claimed.

Phase 2 selected upload limits, quotas and quarantine policies; see [phase-2.md](phase-2.md). Persistent local service verification and durable private storage provisioning remain outstanding before public sharing.
