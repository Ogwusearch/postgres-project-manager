import assert from "node:assert/strict";
import test from "node:test";

import { quoteIdentifier } from "../src/index.js";

test("quotes a simple identifier", () => {
  assert.equal(quoteIdentifier("customer_data"), '"customer_data"');
});

test("escapes embedded double quotes", () => {
  assert.equal(quoteIdentifier('customer"data'), '"customer""data"');
});

test("quotes SQL-looking input as one identifier", () => {
  const input = 'db; DROP DATABASE production; --';

  assert.equal(
    quoteIdentifier(input),
    '"db; DROP DATABASE production; --"',
  );
});

test("rejects an empty identifier", () => {
  assert.throws(
    () => quoteIdentifier(""),
    {
      name: "TypeError",
      message: "PostgreSQL identifiers must be non-empty strings.",
    },
  );
});

test("rejects identifiers containing NUL characters", () => {
  assert.throws(
    () => quoteIdentifier("database\0name"),
    {
      name: "TypeError",
      message: "PostgreSQL identifiers cannot contain NUL characters.",
    },
  );
});
