type DevicePollResponse = {
  status: number;
  body: {
    success?: boolean;
    pending?: boolean;
    [key: string]: unknown;
  };
};

interface DevicePollCacheEntry {
  expiresAt: number;
  promise?: Promise<DevicePollResponse>;
  response?: DevicePollResponse;
}

const IN_FLIGHT_TTL_MS = 60 * 1000;
const SUCCESS_TTL_MS = 30 * 1000;
const ERROR_TTL_MS = 5 * 1000;

function getGlobalCache() {
  const state = globalThis as typeof globalThis & {
    __oauthDevicePollCache?: Map<string, DevicePollCacheEntry>;
  };

  if (!state.__oauthDevicePollCache) {
    state.__oauthDevicePollCache = new Map<string, DevicePollCacheEntry>();
  }

  return state.__oauthDevicePollCache;
}

function getCacheKey(provider: string, deviceCode: string) {
  return `${provider}:${deviceCode}`;
}

function cleanupExpiredEntries(cache: Map<string, DevicePollCacheEntry>) {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

function getResponseTtl(response: DevicePollResponse) {
  if (response.body.pending) {
    return 0;
  }
  return response.body.success ? SUCCESS_TTL_MS : ERROR_TTL_MS;
}

export async function shareDevicePollResult(
  provider: string,
  deviceCode: string,
  runner: () => Promise<DevicePollResponse>
) {
  const cache = getGlobalCache();
  cleanupExpiredEntries(cache);

  const key = getCacheKey(provider, deviceCode);
  const existing = cache.get(key);
  if (existing) {
    if (existing.response && existing.expiresAt > Date.now()) {
      return existing.response;
    }
    if (existing.promise && existing.expiresAt > Date.now()) {
      return existing.promise;
    }
    cache.delete(key);
  }

  const promise = runner()
    .then((response) => {
      const ttl = getResponseTtl(response);
      if (ttl > 0) {
        cache.set(key, {
          response,
          expiresAt: Date.now() + ttl,
        });
      } else {
        cache.delete(key);
      }
      return response;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });

  cache.set(key, {
    promise,
    expiresAt: Date.now() + IN_FLIGHT_TTL_MS,
  });

  return promise;
}

export function clearDevicePollCache() {
  getGlobalCache().clear();
}
