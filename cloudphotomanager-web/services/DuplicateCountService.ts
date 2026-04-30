import axios from "axios";
import { debounce } from "lodash";
import Config from "./Config";
import { AuthService } from "./AuthService";

const DEBOUNCE_MS = 300;
const MAX_BATCH_IDS = 150;

type PendingResolver = (counts: Record<string, number>) => void;

interface AccountState {
  cache: Map<string, number>;
  pending: Set<string>;
  resolvers: PendingResolver[];
  flush: () => void;
}

const accountStates = new Map<string, AccountState>();

function getState(accountId: string): AccountState {
  let state = accountStates.get(accountId);
  if (state) {
    return state;
  }
  state = {
    cache: new Map<string, number>(),
    pending: new Set<string>(),
    resolvers: [],
    flush: () => {
      /* replaced below */
    },
  };
  state.flush = debounce(() => {
    void flushQueue(accountId);
  }, DEBOUNCE_MS);
  accountStates.set(accountId, state);
  return state;
}

async function flushQueue(accountId: string): Promise<void> {
  const state = accountStates.get(accountId);
  if (!state) {
    return;
  }
  const ids = Array.from(state.pending);
  state.pending.clear();
  const resolvers = state.resolvers.splice(0);
  if (ids.length === 0) {
    for (const resolve of resolvers) {
      resolve({});
    }
    return;
  }

  const merged: Record<string, number> = {};
  try {
    const serverUrl = (await Config.get()).SERVER_URL;
    const authHeader = await AuthService.getAuthHeader();
    for (let i = 0; i < ids.length; i += MAX_BATCH_IDS) {
      const chunk = ids.slice(i, i + MAX_BATCH_IDS);
      const res = await axios.post(
        `${serverUrl}/accounts/${accountId}/analysis/duplicates/counts`,
        { fileIds: chunk },
        authHeader,
      );
      const counts: Record<string, number> = res.data?.counts || {};
      for (const id of chunk) {
        const count = counts[id];
        if (typeof count === "number" && count >= 2) {
          state.cache.set(id, count);
          merged[id] = count;
        } else {
          // Mark as known-not-duplicated (count of 1) to avoid refetching.
          state.cache.set(id, 1);
        }
      }
    }
  } catch (err) {
    // On failure, resolve with whatever we gathered so UI does not hang.
    // Do not cache failures, so a future call can retry.
    // eslint-disable-next-line no-console
    console.warn("DuplicateCountService flush failed", err);
  }

  for (const resolve of resolvers) {
    resolve(merged);
  }
}

export const DuplicateCountService = {
  getCached(accountId: string, fileId: string): number | undefined {
    return accountStates.get(accountId)?.cache.get(fileId);
  },

  /**
   * Queues fileIds for a debounced, batched fetch of duplicate counts.
   * Resolves with the new counts (>= 2) discovered in this flush. Ids that
   * are already cached are skipped — callers should read cached values via
   * getCached for an immediate answer.
   */
  request(
    accountId: string,
    fileIds: string[],
  ): Promise<Record<string, number>> {
    if (!accountId || !fileIds || fileIds.length === 0) {
      return Promise.resolve({});
    }
    const state = getState(accountId);
    let queued = 0;
    for (const id of fileIds) {
      if (!id) continue;
      if (state.cache.has(id)) continue;
      if (state.pending.has(id)) continue;
      state.pending.add(id);
      queued++;
    }
    if (queued === 0 && state.pending.size === 0) {
      return Promise.resolve({});
    }
    return new Promise<Record<string, number>>((resolve) => {
      state.resolvers.push(resolve);
      state.flush();
    });
  },

  invalidate(accountId?: string, fileIds?: string[]): void {
    if (!accountId) {
      accountStates.clear();
      return;
    }
    const state = accountStates.get(accountId);
    if (!state) {
      return;
    }
    if (!fileIds || fileIds.length === 0) {
      state.cache.clear();
      state.pending.clear();
      return;
    }
    for (const id of fileIds) {
      state.cache.delete(id);
      state.pending.delete(id);
    }
  },
};
