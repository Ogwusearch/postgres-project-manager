export type WorkspaceDataLoaderOptions<TProject, TInstance> = {
  fetcher: typeof fetch;
  isCancelled: () => boolean;
  readError: (response: Response) => Promise<string>;
  onSuccess: (projects: TProject[], instances: TInstance[]) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
};

export async function loadWorkspaceData<TProject, TInstance>(
  tenantId: string,
  options: WorkspaceDataLoaderOptions<TProject, TInstance>,
): Promise<void> {
  try {
    const headers = { "X-Tenant-Id": tenantId };

    const [projectsResponse, instancesResponse] = await Promise.all([
      options.fetcher("/api/projects?limit=100&offset=0", {
        credentials: "include",
        headers,
      }),
      options.fetcher("/api/database-instances", {
        credentials: "include",
        headers,
      }),
    ]);

    if (options.isCancelled()) return;

    if (!projectsResponse.ok) {
      throw new Error(await options.readError(projectsResponse));
    }

    if (!instancesResponse.ok) {
      throw new Error(await options.readError(instancesResponse));
    }

    const projectsBody =
      await projectsResponse.json() as { data: TProject[] };
    const instancesBody =
      await instancesResponse.json() as { data: TInstance[] };

    if (options.isCancelled()) return;

    options.onSuccess(projectsBody.data, instancesBody.data);
  } catch (error) {
    if (!options.isCancelled()) {
      options.onError(error);
    }
  } finally {
    if (!options.isCancelled()) {
      options.onSettled();
    }
  }
}
