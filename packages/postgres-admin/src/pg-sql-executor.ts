import type { Pool, QueryResultRow } from "pg";

import type {
  SqlExecutor,
  SqlQueryResult,
} from "./sql-executor.js";

/**
 * Executes parameterized SQL using an existing pg Pool.
 *
 * This adapter does not create, connect, or close the pool.
 * Pool lifecycle remains the responsibility of its owner.
 */
export class PgSqlExecutor implements SqlExecutor {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async query<Row = Record<string, unknown>>(
    statement: string,
    parameters: unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.pool.query<QueryResultRow>(
      statement,
      parameters,
    );

    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount,
    };
  }
}
