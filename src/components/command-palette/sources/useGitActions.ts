import { useCallback } from 'react';

import { authenticatedFetch } from '../../../utils/api';

async function postGit(path: string, body: Record<string, unknown>) {
  try {
    const res = await authenticatedFetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return res.json();
  } catch (err) {
    // Command-palette callers invoke these with `void` and discard the
    // promise, so the error must be surfaced here rather than re-thrown.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Git action] ${path} failed:`, message);
    alert(message);
    return { success: false, error: message };
  }
}

export function useGitActions(projectId: string | undefined) {
  const fetch = useCallback(() => {
    if (!projectId) return Promise.resolve();
    return postGit('/api/git/fetch', { project: projectId });
  }, [projectId]);

  const pull = useCallback(() => {
    if (!projectId) return Promise.resolve();
    return postGit('/api/git/pull', { project: projectId });
  }, [projectId]);

  const push = useCallback(() => {
    if (!projectId) return Promise.resolve();
    return postGit('/api/git/push', { project: projectId });
  }, [projectId]);

  const checkout = useCallback(
    (branch: string) => {
      if (!projectId) return Promise.resolve();
      return postGit('/api/git/checkout', { project: projectId, branch });
    },
    [projectId],
  );

  return { fetch, pull, push, checkout };
}
