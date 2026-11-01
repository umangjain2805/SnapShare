# API examples

All private routes require the opaque HttpOnly session cookie. JSON mutations require exact Origin and Content-Type: application/json. Production uses HTTPS. Responses omit secrets and set no-store on private data. Never put bearer links in logs, public screenshots or shell history. The following uses disposable local examples; use an interactive secret prompt for real credentials.

```sh
curl -i -c cookies.txt http://localhost:4000/api/auth/register -H 'Origin: http://localhost:5173' -H 'Content-Type: application/json' --data '{"name":"Demo","email":"demo@example.com","password":"disposable-demo-passphrase"}'
curl -b cookies.txt http://localhost:4000/api/auth/me
curl -b cookies.txt http://localhost:4000/api/me/analytics?days=7
curl -b cookies.txt 'http://localhost:4000/api/me/shares?state=active'
```

Remove the local cookie jar after use. Use UI to create snippets/files and obtain request IDs from browser devtools; contracts in packages/contracts/src/index.ts are the authoritative request shapes. Multipart bytes go to scoped S3 PUT URLs rather than JSON API bodies. A completed upload remains quarantined until a trusted clean scan. No scanner or unscanned-file bypass is supplied.

| Method | Route | Purpose |
|---|---|---|
| GET | /api/health, /api/ready | Liveness and dependency readiness |
| POST | /api/auth/register, /api/auth/login, /api/auth/logout | Session lifecycle |
| GET | /api/auth/me | Current account |
| POST | /api/uploads/initiate | Reserve quota and begin multipart upload |
| GET | /api/uploads/:id | Owner upload state/storage-confirmed parts |
| POST | /api/uploads/:id/parts, /api/uploads/:id/complete | Scoped part URL and verified completion |
| DELETE | /api/uploads/:id | Abort owner upload |
| POST | /api/snippets | Create inert private snippet |
| POST | /api/shares | Create fixed-policy share |
| GET | /api/shares/:token | Generic public password prompt |
| POST | /api/shares/:token/claim | Password-verified atomic claim |
| GET | /api/transfers/:ticket | Single-use API stream |
| GET | /api/me/shares, /api/me/shares/:id | Owner list/detail |
| GET | /api/me/analytics?days=7 | Owner retained-record summary (7 or 30 days) |

For exact additional asset/notification/revoke routes consult apps/api/src/modules/*/routes.ts. Validation failures return safe 400 responses; unauthenticated access 401; foreign IDs 404; abuse limits 429; unavailable shares/tickets normalize access failures. Claim success spends one claim even if a network interruption prevents recipient saving bytes. Do not retry redeemed tickets as if they were resumable downloads.
