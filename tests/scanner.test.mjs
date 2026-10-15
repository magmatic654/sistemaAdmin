import test from "node:test";
import assert from "node:assert/strict";
import { scanValue, isScanTerminator } from "../lib/scanner.ts";
test("HID framing preserves the exact case-sensitive sale identity", () => {
  for (const framing of [
    "LLA1:V:Abc-123",
    "]C0LLA1:V:Abc-123\r\n",
    "LLA1:V:Abc-123\t",
  ])
    assert.equal(scanValue(framing), "LLA1:V:Abc-123");
  assert.equal(scanValue("  F-123  "), "F-123");
  assert.ok(isScanTerminator("Enter"));
  assert.ok(isScanTerminator("Tab"));
  assert.equal(isScanTerminator("a"), false);
  for (const code of [
    "LLA1:V:",
    "LLA1:V:a\rb",
    "LLA1:X:123",
    "\n",
    "x".repeat(101),
  ])
    assert.throws(() => scanValue(code));
});
