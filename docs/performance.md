# Local performance measurements

Measured: 2026-11-01T16:26:15.673Z.

## Environment

- win32 10.0.26200; 12th Gen Intel(R) Core(TM) i5-12450H; 12 logical CPUs; 8 GiB RAM.
- Node v22.19.0; k6.exe v2.3.0 (commit/e088784614, go1.26.8, windows/amd64); MongoDB 7.0.24 isolated replica set.
- Storage: Moto 5.2.5 on loopback. Network: same-host loopback. No worker was running during measurement.
- Dataset: 420 owner shares + 1600 foreign shares, 143 tickets, 1 MiB file. Two virtual users; 20 iterations for each analytics/lookup run and 10 for each other operation.

## Results

| Operation/run | Requests | Median (ms) | p95 (ms) | Requests/s | HTTP failure rate |
|---|---:|---:|---:|---:|---:|
| analytics-baseline / round 1 | 20 | 36.08 | 43.09 | 55.06 | 0% |
| analytics-optimized / round 1 | 20 | 4.93 | 8.40 | 323.27 | 0% |
| analytics-baseline / round 2 | 20 | 39.18 | 129.37 | 36.95 | 0% |
| analytics-optimized / round 2 | 20 | 5.25 | 7.64 | 332.63 | 0% |
| initiate | 10 | 40.40 | 79.29 | 40.63 | 0% |
| lookup | 20 | 1.62 | 2.83 | 986.86 | 0% |
| claim | 10 | 219.29 | 326.58 | 8.12 | 0% |
| download | 10 | 51.95 | 112.29 | 30.65 | 0% |

Each row is one k6 run. The percentile values are not pooled across runs. All status checks passed; streamed downloads also passed exact 1 MiB size and SHA-256 checks. The download test moved 10 MiB of payload in total; requests/s includes client processing and test duration. Raw nonsecret metrics are in [performance-results.json](performance-results.json).

## Baseline comparison and limits

The analytics baseline is a real benchmark-only candidate: indexed owner-filtered projections load retained documents and reduce them in JavaScript without a cache. The optimized implementation performs aggregation in MongoDB and caches a result for five seconds per owner/period, with coalesced concurrent reads and bounded cache size. The harness asserts deeply equal outputs before measuring, ignoring only sampledAt. Both paths authenticate the same account; neither bypasses ownership filtering. Only the baseline route is fixture-only and is never shipped in the production app.

Both code paths are warmed, then two pairs run in baseline/optimized/baseline/optimized order on the same isolated database. The optimized endpoint can reuse its five-second cache between requests and reports its original sample timestamp. Thus the measured improvement includes bounded staleness; this is not a pure aggregation-only comparison or a before/after measurement of an earlier release. There is no cache on claim, expiry, revocation, ticket redemption or other access decisions.

These are small local smoke benchmarks, not production capacity, SLA, concurrency-limit or internet-download measurements. Results include same-host API/database/storage contention, local filesystem and emulator behavior. p95 from ten requests is especially noisy. Public lookup measures the deliberately generic metadata prompt, which does not disclose or query private share details. Claim includes real Argon2 verification and MongoDB transactions. Initiation includes an actual multipart initiation through the S3 adapter; it does not transfer the declared file bytes. Downloads use pre-issued fixture tickets and the private 1 MiB object to isolate redemption/streaming; normal claim semantics are independently tested. No load test disables rate limits or security policies. No baseline/optimized comparison is claimed for initiation, lookup, claim or download.

## Reproduce

Install k6 and the Python dependencies in tests/requirements-storage.txt. Set K6_PATH to your executable if it is not in PATH, then run `pnpm benchmark`. The harness starts isolated MongoDB and Moto, seeds disposable fixtures, binds the API to loopback, runs benchmarks/api.k6.js and writes fresh measured metrics. No Redis or real AWS credentials are required for this benchmark. k6 cloud usage reporting is disabled by the harness. Session cookies, public tokens, password and transfer tickets stay in ignored test-results/benchmarks/fixture.json; do not publish that fixture. Benchmark-only baseline code lives in benchmarks/baseline.ts. Keep production and test credentials separate.
