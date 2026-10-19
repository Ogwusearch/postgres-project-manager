import type { AccessAction } from "../types/permission.js";

export const ACCESS_ACTIONS = [
  "project:create",
  "project:read",
  "project:update",
  "project:delete",
  "database-instance:create",
  "database-instance:read",
  "database-instance:update",
  "database-instance:delete",
] as const satisfies readonly AccessAction[];

export function isAccessAction(value: unknown): value is AccessAction {
  return (
    typeof value === "string" &&
    (ACCESS_ACTIONS as readonly string[]).includes(value)
  );
}
