/**
 * Quote a PostgreSQL identifier such as a database, schema, table, or role.
 *
 * This function escapes SQL identifier syntax. It does not validate whether
 * the identifier exists or whether the caller has permission to use it.
 *
 * Do not use this function for SQL data values. Use query parameters for
 * values instead.
 */
export function quoteIdentifier(identifier: string): string {
  if (typeof identifier !== "string" || identifier.length === 0) {
    throw new TypeError("PostgreSQL identifiers must be non-empty strings.");
  }

  if (identifier.includes("\0")) {
    throw new TypeError("PostgreSQL identifiers cannot contain NUL characters.");
  }

  return `"${identifier.replaceAll('"', '""')}"`;
}
