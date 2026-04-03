import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isLocalNetworkHostname,
  isLoopbackHostname,
  shouldUseCodexLoopbackCallback,
} from "../../src/shared/utils/oauthHosts.ts";

describe("oauth host classification", () => {
  it("treats localhost as loopback and local network", () => {
    assert.equal(isLoopbackHostname("localhost"), true);
    assert.equal(isLocalNetworkHostname("localhost"), true);
    assert.equal(shouldUseCodexLoopbackCallback("localhost"), true);
  });

  it("treats LAN IPs as local network but not Codex loopback", () => {
    assert.equal(isLoopbackHostname("10.10.0.100"), false);
    assert.equal(isLocalNetworkHostname("10.10.0.100"), true);
    assert.equal(shouldUseCodexLoopbackCallback("10.10.0.100"), false);
  });

  it("treats remote hosts as neither local network nor loopback", () => {
    assert.equal(isLoopbackHostname("omniroute.example.com"), false);
    assert.equal(isLocalNetworkHostname("omniroute.example.com"), false);
    assert.equal(shouldUseCodexLoopbackCallback("omniroute.example.com"), false);
  });
});
