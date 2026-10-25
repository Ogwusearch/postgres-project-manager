import { createHash } from "node:crypto";

export interface LoginThrottleOptions {
  windowMs?: number;
  maxFailuresPerIp?: number;
  maxFailuresPerAccount?: number;
  maxEntries?: number;
  now?: () => number;
}

interface FailureWindow {
  count: number;
  resetAt: number;
}

export interface LoginThrottleDecision {
  limited: boolean;
  retryAfterSeconds: number;
}

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_IP_FAILURES = 10;
const DEFAULT_ACCOUNT_FAILURES = 5;
const DEFAULT_MAX_ENTRIES = 10_000;

export function createLoginThrottle(
  options: LoginThrottleOptions = {},
) {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxFailuresPerIp =
    options.maxFailuresPerIp ?? DEFAULT_IP_FAILURES;
  const maxFailuresPerAccount =
    options.maxFailuresPerAccount ?? DEFAULT_ACCOUNT_FAILURES;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? Date.now;

  if (
    !Number.isSafeInteger(windowMs) ||
    windowMs <= 0 ||
    !Number.isSafeInteger(maxFailuresPerIp) ||
    maxFailuresPerIp <= 0 ||
    !Number.isSafeInteger(maxFailuresPerAccount) ||
    maxFailuresPerAccount <= 0 ||
    !Number.isSafeInteger(maxEntries) ||
    maxEntries <= 0
  ) {
    throw new Error("Login throttle options must be positive integers.");
  }

  const ipFailures = new Map<string, FailureWindow>();
  const accountFailures = new Map<string, FailureWindow>();

  function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  function accountKey(email: string): string {
    return createHash("sha256")
      .update(normalizeEmail(email), "utf8")
      .digest("hex");
  }

  function pruneExpired(
    entries: Map<string, FailureWindow>,
    currentTime: number,
  ): void {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= currentTime) {
        entries.delete(key);
      }
    }
  }

  function getActiveWindow(
    entries: Map<string, FailureWindow>,
    key: string,
    currentTime: number,
  ): FailureWindow | undefined {
    const entry = entries.get(key);

    if (entry && entry.resetAt <= currentTime) {
      entries.delete(key);
      return undefined;
    }

    return entry;
  }

  function recordFailure(
    entries: Map<string, FailureWindow>,
    key: string,
    currentTime: number,
  ): void {
    const existing = getActiveWindow(entries, key, currentTime);

    if (existing) {
      existing.count += 1;
      return;
    }

    pruneExpired(entries, currentTime);

    // Bound memory when attackers continually change keys.
    // Evict the oldest entry if no expired entry freed capacity.
    if (entries.size >= maxEntries) {
      const oldestKey = entries.keys().next().value as
        | string
        | undefined;

      if (oldestKey !== undefined) {
        entries.delete(oldestKey);
      }
    }

    entries.set(key, {
      count: 1,
      resetAt: currentTime + windowMs,
    });
  }

  function check(email: string, ip: string): LoginThrottleDecision {
    const currentTime = now();
    const normalizedIp = ip.trim() || "unknown";
    const hashedEmail = accountKey(email);

    const ipEntry = getActiveWindow(
      ipFailures,
      normalizedIp,
      currentTime,
    );
    const accountEntry = getActiveWindow(
      accountFailures,
      hashedEmail,
      currentTime,
    );

    const ipLimited =
      (ipEntry?.count ?? 0) >= maxFailuresPerIp;
    const accountLimited =
      (accountEntry?.count ?? 0) >= maxFailuresPerAccount;

    if (!ipLimited && !accountLimited) {
      return { limited: false, retryAfterSeconds: 0 };
    }

    const resetTimes: number[] = [];

    if (ipLimited && ipEntry) {
      resetTimes.push(ipEntry.resetAt);
    }

    if (accountLimited && accountEntry) {
      resetTimes.push(accountEntry.resetAt);
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((Math.max(...resetTimes) - currentTime) / 1000),
    );

    return { limited: true, retryAfterSeconds };
  }

  function failed(email: string, ip: string): void {
    const currentTime = now();
    const normalizedIp = ip.trim() || "unknown";

    recordFailure(ipFailures, normalizedIp, currentTime);
    recordFailure(
      accountFailures,
      accountKey(email),
      currentTime,
    );
  }

  function succeeded(email: string): void {
    accountFailures.delete(accountKey(email));
  }

  return {
    check,
    failed,
    succeeded,
  };
}
