import assert from "node:assert/strict";
import test from "node:test";

import type { Pool, QueryResultRow } from "pg";

import { PgSqlExecutor } from "../src/pg-sql-executor.js";

test("forwards SQL and parameters to the existing pool", async () => {
  let receivedStatement = "";
  let receivedParameters: unknown[] = [];

  const fakePool = {
    async query<Row extends QueryResultRow>(
      statement: string,
      parameters?: unknown[],
    ) {
      receivedStatement = statement;
      receivedParameters = parameters ?? [];

      return {
        rows: [{ id: 7 }] as Row[],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    },
  } as unknown as Pick<Pool, "query">;

  const executor = new PgSqlExecutor(fakePool);

  const result = await executor.query<{ id: number }>(
    "SELECT $1::integer AS id",
    [7],
  );

  assert.equal(receivedStatement, "SELECT $1::integer AS id");
  assert.deepEqual(receivedParameters, [7]);
  assert.deepEqual(result.rows, [{ id: 7 }]);
  assert.equal(result.rowCount, 1);
});

test("returns a null rowCount when the driver reports one", async () => {
  const fakePool = {
    async query() {
      return {
        rows: [],
        rowCount: null,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    },
  } as unknown as Pick<Pool, "query">;

  const executor = new PgSqlExecutor(fakePool);
  const result = await executor.query("SELECT 1");

  assert.deepEqual(result.rows, []);
  assert.equal(result.rowCount, null);
});

test("propagates the original database error", async () => {
  const databaseError = Object.assign(
    new Error("Simulated PostgreSQL query failure"),
    { code: "08006" },
  );

  const fakePool = {
    async query() {
      throw databaseError;
    },
  } as unknown as Pick<Pool, "query">;

  const executor = new PgSqlExecutor(fakePool);

  await assert.rejects(
    executor.query("SELECT 1"),
    (error: unknown) => {
      assert.equal(error, databaseError);
      assert.equal(
        (error as { code?: string }).code,
        "08006",
      );
      return true;
    },
  );
});
