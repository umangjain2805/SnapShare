/* global __ENV, open */
import http from 'k6/http';
import { check } from 'k6';
import execution from 'k6/execution';
import crypto from 'k6/crypto';
const fixture = JSON.parse(open(__ENV.BENCH_FIXTURE));
const operation = __ENV.BENCH_OPERATION;
export const options = { scenarios: { measure: { executor: 'shared-iterations', vus: 2, iterations: operation.startsWith('analytics') || operation === 'lookup' ? 20 : 10, maxDuration: '2m' } }, summaryTrendStats: ['avg', 'med', 'p(95)', 'min', 'max'], thresholds: { checks: ['rate==1'], http_req_failed: ['rate==0'] } };
export default function () {
  const index = execution.scenario.iterationInTest;
  const params = { headers: { Cookie: fixture.cookie, Origin: fixture.origin, 'Content-Type': 'application/json' }, tags: { name: operation } };
  let response;
  if (operation === 'initiate') response = http.post(`${fixture.url}/api/uploads/initiate`, JSON.stringify({ filename: 'benchmark.txt', size: 8388615, mimeType: 'text/plain', fingerprint: 'a'.repeat(64) }), params);
  else if (operation === 'lookup') response = http.get(`${fixture.url}/api/shares/${fixture.lookup}`, params);
  else if (operation === 'claim') response = http.post(`${fixture.url}/api/shares/${fixture.claims[index].token}/claim`, JSON.stringify({ password: fixture.password, idempotencyKey: fixture.claims[index].key }), params);
  else if (operation === 'download') response = http.get(`${fixture.url}/api/transfers/${fixture.tickets[index]}`, { ...params, responseType: 'binary' });
  else response = http.get(`${fixture.url}${operation === 'analytics-baseline' ? '/bench/analytics-baseline' : '/api/me/analytics'}`, params);
  check(response, { 'expected status': r => r.status === (operation === 'initiate' ? 201 : 200) });
  if (operation === 'download') check(response, { 'exact streamed bytes': r => r.body.byteLength === fixture.size && crypto.sha256(r.body, 'hex') === fixture.sha256 });
}
export function handleSummary(data) { return { [__ENV.BENCH_OUTPUT]: JSON.stringify(data, null, 2) }; }
