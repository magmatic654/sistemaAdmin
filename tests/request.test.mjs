import { test } from "node:test";
import assert from "node:assert/strict";
import { sameOrigin } from "../lib/request.ts";
test("local writes accept the browser host and reject other or missing origins", () => {
  const request = (origin) =>
    new Request("http://localhost:3002/api/admin", {
      headers: { host: "127.0.0.1:3002", ...(origin ? { origin } : {}) },
    });
  assert.equal(sameOrigin(request("http://127.0.0.1:3002")), true);
  for (const origin of [
    null,
    "null",
    "https://external.example",
    "http://127.0.0.1:3003",
    "http://127.0.0.1:3002/path",
  ])
    assert.equal(sameOrigin(request(origin)), false);
});
