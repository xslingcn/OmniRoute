import test from "node:test";
import assert from "node:assert/strict";

process.env.OMNIROUTE_DISABLE_TOKEN_HEALTHCHECK = "1";

const { shouldSeedInitialHealthCheck, stopTokenHealthCheck } =
  await import("../../src/lib/tokenHealthCheck.ts");

test.after(() => {
  stopTokenHealthCheck();
  delete process.env.OMNIROUTE_DISABLE_TOKEN_HEALTHCHECK;
});

test("shouldSeedInitialHealthCheck seeds fresh connections without a baseline check", () => {
  const now = Date.parse("2026-04-03T21:30:00.000Z");

  assert.equal(
    shouldSeedInitialHealthCheck(
      {
        lastHealthCheckAt: null,
        testStatus: "active",
        tokenExpiresAt: null,
      },
      now
    ),
    true
  );
});

test("shouldSeedInitialHealthCheck does not defer tokens already close to expiry", () => {
  const now = Date.parse("2026-04-03T21:30:00.000Z");

  assert.equal(
    shouldSeedInitialHealthCheck(
      {
        lastHealthCheckAt: null,
        testStatus: "active",
        tokenExpiresAt: new Date(now + 4 * 60 * 1000).toISOString(),
      },
      now
    ),
    false
  );
});

test("shouldSeedInitialHealthCheck skips expired or already-checked connections", () => {
  const now = Date.parse("2026-04-03T21:30:00.000Z");

  assert.equal(
    shouldSeedInitialHealthCheck(
      {
        lastHealthCheckAt: new Date(now - 60_000).toISOString(),
        testStatus: "active",
        tokenExpiresAt: null,
      },
      now
    ),
    false
  );

  assert.equal(
    shouldSeedInitialHealthCheck(
      {
        lastHealthCheckAt: null,
        testStatus: "expired",
        tokenExpiresAt: null,
      },
      now
    ),
    false
  );
});
