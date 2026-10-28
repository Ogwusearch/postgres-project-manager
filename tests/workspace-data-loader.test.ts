import assert from "node:assert/strict";
import test from "node:test";

import { loadWorkspaceData } from "../apps/admin-web/src/workspace-data-loader.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;

  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function startLoad(
  tenantId: string,
  projects: ReturnType<typeof deferred<Response>>,
  instances: ReturnType<typeof deferred<Response>>,
  events: string[],
) {
  let cancelled = false;

  const done = loadWorkspaceData<{ id: string }, { id: string }>(
    tenantId,
    {
      fetcher: (input) => {
        const url = String(input);
        return url.includes("/api/projects")
          ? projects.promise
          : instances.promise;
      },
      isCancelled: () => cancelled,
      readError: async (response) => `Request failed (${response.status}).`,
      onSuccess: (loadedProjects, loadedInstances) => {
        events.push(
          `success:${tenantId}:${loadedProjects[0]?.id}:${loadedInstances[0]?.id}`,
        );
      },
      onError: () => events.push(`error:${tenantId}`),
      onSettled: () => events.push(`settled:${tenantId}`),
    },
  );

  return {
    done,
    cancel: () => {
      cancelled = true;
    },
  };
}

test("cancelled tenant requests cannot overwrite a later tenant selection", async () => {
  const events: string[] = [];

  const oldAProjects = deferred<Response>();
  const oldAInstances = deferred<Response>();
  const oldA = startLoad("tenant-a", oldAProjects, oldAInstances, events);

  // Simulate switching from Tenant A to Tenant B.
  oldA.cancel();

  const tenantBProjects = deferred<Response>();
  const tenantBInstances = deferred<Response>();
  const tenantB = startLoad(
    "tenant-b",
    tenantBProjects,
    tenantBInstances,
    events,
  );

  // Simulate switching back to Tenant A before earlier requests finish.
  tenantB.cancel();

  const currentAProjects = deferred<Response>();
  const currentAInstances = deferred<Response>();
  const currentA = startLoad(
    "tenant-a",
    currentAProjects,
    currentAInstances,
    events,
  );

  // Resolve the obsolete requests after the newest request has started.
  oldAProjects.resolve(jsonResponse([{ id: "stale-project-a" }]));
  oldAInstances.resolve(jsonResponse([{ id: "stale-instance-a" }]));
  tenantBProjects.resolve(jsonResponse([{ id: "stale-project-b" }]));
  tenantBInstances.resolve(jsonResponse([{ id: "stale-instance-b" }]));

  currentAProjects.resolve(jsonResponse([{ id: "current-project-a" }]));
  currentAInstances.resolve(jsonResponse([{ id: "current-instance-a" }]));

  await Promise.all([oldA.done, tenantB.done, currentA.done]);

  assert.deepEqual(events, [
    "success:tenant-a:current-project-a:current-instance-a",
    "settled:tenant-a",
  ]);
});
