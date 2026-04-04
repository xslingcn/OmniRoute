import test from "node:test";
import assert from "node:assert/strict";

import {
  clearDevicePollCache,
  shareDevicePollResult,
} from "../../src/lib/oauth/devicePollCache.ts";

test.afterEach(() => {
  clearDevicePollCache();
});

test("device poll cache shares an in-flight poll for the same provider and device code", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const runner = async () => {
    calls += 1;
    await gate;
    return {
      status: 200,
      body: {
        success: true,
        connection: { id: "conn-1", provider: "codex" },
      },
    };
  };

  const first = shareDevicePollResult("codex", "device-1", runner);
  const second = shareDevicePollResult("codex", "device-1", runner);
  release();

  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.deepEqual(firstResult, secondResult);
});

test("device poll cache does not retain authorization_pending responses", async () => {
  let calls = 0;

  const runner = async () => {
    calls += 1;
    return {
      status: 200,
      body: {
        success: false,
        pending: true,
        error: "authorization_pending",
      },
    };
  };

  await shareDevicePollResult("codex", "device-2", runner);
  await shareDevicePollResult("codex", "device-2", runner);

  assert.equal(calls, 2);
});

test("device poll cache reuses a recent success response to avoid duplicate exchanges", async () => {
  let calls = 0;

  const runner = async () => {
    calls += 1;
    return {
      status: 200,
      body: {
        success: true,
        connection: { id: "conn-2", provider: "codex" },
      },
    };
  };

  const first = await shareDevicePollResult("codex", "device-3", runner);
  const second = await shareDevicePollResult("codex", "device-3", runner);

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
});
