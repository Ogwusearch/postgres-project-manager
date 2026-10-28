export type WorkspaceAuthStatus =
  | "authenticated"
  | "unauthenticated"
  | "loading"
  | "error";

export function isWorkspaceDataCurrent(
  authStatus: WorkspaceAuthStatus,
  selectedTenantId: string,
  workspaceDataTenantId: string,
): boolean {
  return (
    authStatus === "authenticated" &&
    selectedTenantId.length > 0 &&
    workspaceDataTenantId === selectedTenantId
  );
}
