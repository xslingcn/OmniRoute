import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-token-refresh-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const tokenRefresh = await import("../../src/sse/services/tokenRefresh.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("updateProviderCredentials persists both expiresAt and tokenExpiresAt", async () => {
  await resetStorage();

  const created = await providersDb.createProviderConnection({
    provider: "codex",
    authType: "oauth",
    email: "persist@example.com",
    accessToken: "access-old",
    refreshToken: "refresh-old",
    testStatus: "active",
  });

  const updated = await tokenRefresh.updateProviderCredentials(created.id, {
    accessToken: "access-new",
    refreshToken: "refresh-new",
    expiresIn: 3600,
  });

  assert.equal(updated, true);

  const stored = await providersDb.getProviderConnectionById(created.id);
  assert.equal(stored.accessToken, "access-new");
  assert.equal(stored.refreshToken, "refresh-new");
  assert.ok(stored.expiresAt);
  assert.ok(stored.tokenExpiresAt);
  assert.equal(stored.tokenExpiresAt, stored.expiresAt);
});
