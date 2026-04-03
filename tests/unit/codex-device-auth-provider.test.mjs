import test from "node:test";
import assert from "node:assert/strict";

import { codex } from "../../src/lib/oauth/providers/codex.ts";
import { CODEX_CONFIG } from "../../src/lib/oauth/constants/oauth.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Codex device auth requests a user code from OpenAI's device endpoint", async () => {
  let captured = null;

  globalThis.fetch = async (url, init = {}) => {
    captured = {
      url: String(url),
      method: init.method,
      headers: init.headers,
      body: JSON.parse(String(init.body)),
    };

    return new Response(
      JSON.stringify({
        device_auth_id: "device-auth-123",
        user_code: "ABCD-EFGH",
        interval: "7",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  };

  const result = await codex.requestDeviceCode(CODEX_CONFIG);

  assert.equal(captured.url, CODEX_CONFIG.deviceCodeUrl);
  assert.equal(captured.method, "POST");
  assert.equal(captured.body.client_id, CODEX_CONFIG.clientId);
  assert.equal(result.device_code, "device-auth-123");
  assert.equal(result.user_code, "ABCD-EFGH");
  assert.equal(result.verification_uri, CODEX_CONFIG.deviceVerificationUrl);
  assert.equal(result.interval, 7);
});

test("Codex device auth exchanges the returned authorization code for tokens", async () => {
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method,
      headers: init.headers,
      body:
        typeof init.body === "string"
          ? init.body
          : init.body instanceof URLSearchParams
            ? init.body.toString()
            : String(init.body),
    });

    if (String(url) === CODEX_CONFIG.deviceTokenUrl) {
      return new Response(
        JSON.stringify({
          authorization_code: "auth-code-123",
          code_challenge: "challenge-123",
          code_verifier: "verifier-123",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    assert.equal(String(url), CODEX_CONFIG.tokenUrl);
    return new Response(
      JSON.stringify({
        access_token: "access-123",
        refresh_token: "refresh-123",
        id_token: "header.payload.sig",
        expires_in: 3600,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  };

  const result = await codex.pollToken(CODEX_CONFIG, "device-auth-123", null, {
    userCode: "ABCD-EFGH",
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.access_token, "access-123");
  assert.equal(calls[0].url, CODEX_CONFIG.deviceTokenUrl);
  assert.match(
    calls[0].body,
    /device_auth_id=device-auth-123|^\{"device_auth_id":"device-auth-123"/
  );
  assert.match(calls[0].body, /ABCD-EFGH/);
  assert.equal(calls[1].url, CODEX_CONFIG.tokenUrl);
  assert.match(calls[1].body, /grant_type=authorization_code/);
  assert.match(
    calls[1].body,
    new RegExp(`redirect_uri=${encodeURIComponent(CODEX_CONFIG.deviceRedirectUri)}`)
  );
  assert.match(calls[1].body, /code_verifier=verifier-123/);
});

test("Codex device auth treats 403/404 polling responses as authorization_pending", async () => {
  globalThis.fetch = async () =>
    new Response("pending", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });

  const result = await codex.pollToken(CODEX_CONFIG, "device-auth-123", null, {
    userCode: "ABCD-EFGH",
  });

  assert.equal(result.ok, false);
  assert.equal(result.data.error, "authorization_pending");
});

test("Codex device auth surfaces token exchange failures as terminal errors", async () => {
  const errorBody = {
    error: {
      code: "token_exchange_user_error",
      type: "invalid_request_error",
      message: "Invalid request. Please try again later.",
      param: null,
    },
  };

  globalThis.fetch = async (url) => {
    if (String(url) === CODEX_CONFIG.deviceTokenUrl) {
      return new Response(
        JSON.stringify({
          authorization_code: "auth-code-123",
          code_verifier: "verifier-123",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify(errorBody), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await codex.pollToken(CODEX_CONFIG, "device-auth-123", null, {
    userCode: "ABCD-EFGH",
  });

  assert.equal(result.ok, false);
  assert.equal(result.data.error, "token_exchange_failed");
  assert.match(result.data.error_description, /token_exchange_user_error/);
  assert.match(result.data.error_description, /Invalid request\. Please try again later\./);
});
