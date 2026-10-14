# SnapShare progress

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

- [ ] Phase 2: private multipart storage and safe code snippets. First verify local services, provision private S3/compatible storage, configure backend credentials/roles and choose validation/quota/quarantine policies.
- [ ] Phase 3: secure shares, atomic claims and transfer tickets.
- [ ] Phase 4: durable notifications, cleanup and reconciliation.
- [ ] Phase 5: full product UI, analytics, hardening and measured performance.
- [ ] Phase 6: deployment and operations documentation.

Manual verification steps and exact run commands are in [development.md](development.md).
