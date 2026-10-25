import test from "node:test";
import assert from "node:assert/strict";
import { createLoginThrottle } from "../src/services/login-throttle.js";

test("allows attempts before either failure threshold is reached", () => {
  let now = 1_000;

  const throttle = createLoginThrottle({
    windowMs: 60_000,
    maxFailuresPerIp: 3,
    maxFailuresPerAccount: 2,
    now: () => now,
  });

  throttle.failed("user@example.test", "192.0.2.1");

  assert.deepEqual(throttle.check("user@example.test", "192.0.2.1"), {
    limited: false,
    retryAfterSeconds: 0,
  });

  now += 1;
});

test("limits an account after its configured failure threshold", () => {
  const throttle = createLoginThrottle({
    windowMs: 60_000,
    maxFailuresPerIp: 10,
    maxFailuresPerAccount: 2,
    now: () => 1_000,
  });

  throttle.failed("user@example.test", "192.0.2.1");
  throttle.failed("USER@example.test", "192.0.2.2");

  const decision = throttle.check("user@example.test", "192.0.2.3");

  assert.equal(decision.limited, true);
  assert.equal(decision.retryAfterSeconds, 60);
});

test("limits an IP after its configured failure threshold", () => {
  const throttle = createLoginThrottle({
    windowMs: 60_000,
    maxFailuresPerIp: 2,
    maxFailuresPerAccount: 10,
    now: () => 1_000,
  });

  throttle.failed("first@example.test", "192.0.2.1");
  throttle.failed("second@example.test", "192.0.2.1");

  assert.equal(
    throttle.check("third@example.test", "192.0.2.1").limited,
    true,
  );
});

test("expires failure counters after the window", () => {
  let now = 1_000;

  const throttle = createLoginThrottle({
    windowMs: 5_000,
    maxFailuresPerIp: 1,
    maxFailuresPerAccount: 1,
    now: () => now,
  });

  throttle.failed("user@example.test", "192.0.2.1");

  assert.equal(
    throttle.check("user@example.test", "192.0.2.1").limited,
    true,
  );

  now += 5_000;

  assert.deepEqual(throttle.check("user@example.test", "192.0.2.1"), {
    limited: false,
    retryAfterSeconds: 0,
  });
});

test("successful login clears account failures but preserves IP failures", () => {
  const throttle = createLoginThrottle({
    windowMs: 60_000,
    maxFailuresPerIp: 2,
    maxFailuresPerAccount: 1,
    now: () => 1_000,
  });

  throttle.failed("user@example.test", "192.0.2.1");
  throttle.succeeded("USER@example.test");

  assert.equal(
    throttle.check("user@example.test", "192.0.2.2").limited,
    false,
  );

  throttle.failed("another@example.test", "192.0.2.1");

  assert.equal(
    throttle.check("third@example.test", "192.0.2.1").limited,
    true,
  );
});

test("rejects invalid throttle configuration", () => {
  assert.throws(
    () => createLoginThrottle({ maxFailuresPerIp: 0 }),
    /positive integers/,
  );

  assert.throws(
    () => createLoginThrottle({ windowMs: -1 }),
    /positive integers/,
  );
});
