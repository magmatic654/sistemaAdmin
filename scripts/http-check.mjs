import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Only for the disposable QA server launched with .local/test.env.
assert.equal(
  new URL(process.env.DATABASE_URL).pathname,
  "/llantas_admin_tests",
);
const base = "http://127.0.0.1:3002";
const json = { "Content-Type": "application/json" };
assert.equal((await fetch(base + "/")).status, 200);
assert.equal((await fetch(base + "/api/auth", { method: "POST" })).status, 404);
const endpoint = base + "/api/admin?from=2026-01-01&to=2026-12-31";
const state = await fetch(endpoint);
assert.equal(state.status, 200);
assert.match(state.headers.get("cache-control"), /no-store/);
for (const origin of ["https://untrusted.example", "null", ""]) {
  const response = await fetch(base + "/api/admin", {
    method: "POST",
    headers: { ...json, ...(origin ? { Origin: origin } : {}) },
    body: "{}",
  });
  assert.equal(response.status, 403);
}
const invalid = await fetch(base + "/api/admin", {
  method: "POST",
  headers: { ...json, Origin: base },
  body: JSON.stringify({
    action: "invalid",
    payload: {},
    requestId: randomUUID(),
  }),
});
assert.equal(invalid.status, 400);
console.log(
  "PASS main app without login, private uncached responses and same-origin write validation.",
);
