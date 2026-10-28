export async function revokeLoginSessionBestEffort(
  csrfToken: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!csrfToken) {
    return;
  }

  try {
    await fetcher("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "x-csrf-token": csrfToken },
    });
  } catch {
    // Cleanup must not replace the original login initialization error.
  }
}
