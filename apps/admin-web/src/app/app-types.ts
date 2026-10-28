// Shared application types extracted from App.tsx.

export type Role = "super_admin" | "admin" | "database_operator" | "viewer";

export type Membership = {
  tenant_id: string;
  tenant_key: string;
  tenant_name: string;
  tenant_status: "active" | "suspended";
  role: "admin" | "database_operator" | "viewer";
};

export type Session = {
  id: string;
  email: string;
  is_super_admin: boolean;
  memberships: Membership[];
};

export type Tenant = {
  id: string;
  tenant_key: string;
  name: string;
  status: "active";
};

export type ApiProject = {
  id: string;
  tenant_id: string;
  project_key: string;
  name: string;
  status: "active" | "inactive" | "archived";
  created_at: string;
};

export type ApiDatabaseInstance = {
  id: string;
  project_id: string;
  environment: "development" | "staging" | "production";
  database_name: string;
  server_key: string;
  status: "planned" | "provisioning" | "ready" | "failed" | "retired";
  created_at: string;
};

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";
