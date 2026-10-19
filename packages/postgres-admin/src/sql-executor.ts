/**
 * Minimal result shape needed by administrative services.
 *
 * Compatible adapters can translate their database driver's result into
 * this contract without exposing driver-specific types to this package.
 */
export interface SqlQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

/**
 * Port for executing parameterized SQL.
 *
 * This interface does not create a connection or execute queries by itself.
 * A future adapter can implement it using the pg package.
 */
export interface SqlExecutor {
  query<Row = Record<string, unknown>>(
    statement: string,
    parameters?: unknown[],
  ): Promise<SqlQueryResult<Row>>;
}
