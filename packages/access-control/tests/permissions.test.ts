import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCESS_ACTIONS,
  isAccessAction,
} from "../src/permissions/permissions.js";

test("declares each supported permission exactly once", () => {
  assert.equal(
    new Set(ACCESS_ACTIONS).size,
    ACCESS_ACTIONS.length,
  );
});

test("includes the expected project and database-instance permissions", () => {
  assert.deepEqual(ACCESS_ACTIONS, [
    "project:create",
    "project:read",
    "project:update",
    "project:delete",
    "database-instance:create",
    "database-instance:read",
    "database-instance:update",
    "database-instance:delete",
  ]);
});

test("recognizes supported permission names", () => {
  assert.equal(isAccessAction("project:read"), true);
  assert.equal(isAccessAction("database-instance:delete"), true);
});

test("rejects unknown permission names", () => {
  assert.equal(isAccessAction("project:execute"), false);
  assert.equal(isAccessAction("administrator"), false);
  assert.equal(isAccessAction(null), false);
});
