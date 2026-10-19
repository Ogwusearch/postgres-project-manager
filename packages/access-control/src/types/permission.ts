export type AccessAction =
  | "project:create"
  | "project:read"
  | "project:update"
  | "project:delete"
  | "database-instance:create"
  | "database-instance:read"
  | "database-instance:update"
  | "database-instance:delete";

export type AccessPermission = AccessAction;
