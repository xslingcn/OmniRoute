const PRIVATE_172_RANGE = /^172\.(1[6-9]|2\d|3[01])\./;

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function isLocalNetworkHostname(hostname: string): boolean {
  return (
    isLoopbackHostname(hostname) ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    PRIVATE_172_RANGE.test(hostname)
  );
}

export function shouldUseCodexLoopbackCallback(hostname: string): boolean {
  return isLoopbackHostname(hostname);
}
