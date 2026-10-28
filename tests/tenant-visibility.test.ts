import assert from "node:assert/strict";
import test from "node:test";

import { isWorkspaceDataCurrent } from "../apps/admin-web/src/tenant-visibility.ts";

test("allows data for the authenticated tenant that owns it", () => {
  assert.equal(
    isWorkspaceDataCurrent("authenticated", "tenant-a", "tenant-a"),
    true,
  );
});

test("hides data when the selected tenant changes", () => {
  assert.equal(
    isWorkspaceDataCurrent("authenticated", "tenant-b", "tenant-a"),
    false,
  );
});

test("hides data when no tenant is selected", () => {
  assert.equal(
    isWorkspaceDataCurrent("authenticated", "", "tenant-a"),
    false,
  );
});

test("hides data while unauthenticated", () => {
  assert.equal(
    isWorkspaceDataCurrent("unauthenticated", "tenant-a", "tenant-a"),
    false,
  );
});

test("hides data while authentication is loading", () => {
  assert.equal(
    isWorkspaceDataCurrent("loading", "tenant-a", "tenant-a"),
    false,
  );
});

test("hides data when no tenant owns the loaded records", () => {
  assert.equal(
    isWorkspaceDataCurrent("authenticated", "tenant-a", ""),
    false,
  );
});

test("hides workspace data when authentication is in an error state", () => {
  assert.equal(
    isWorkspaceDataCurrent("error", "tenant-a", "tenant-a"),
    false,
  );
});
