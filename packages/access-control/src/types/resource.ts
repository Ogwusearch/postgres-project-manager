export interface TenantResource {
  readonly type: "tenant";
  /** For tenant resources, id and tenantId must be identical. */
  readonly id: string;
  readonly tenantId: string;
}

export interface ProjectResource {
  readonly type: "project";
  readonly id: string;
  readonly tenantId: string;
}

export interface DatabaseInstanceResource {
  readonly type: "database-instance";
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
}

export type AccessResource =
  | TenantResource
  | ProjectResource
  | DatabaseInstanceResource;
