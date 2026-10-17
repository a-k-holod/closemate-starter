import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseReviewStore,
  REVIEW_STORAGE_KEY,
  serializeReviewStore,
  undoReview,
  updateReview,
  type ReviewPatch,
  type ReviewStore
} from "./review-state";

/** "loading" until the first client effect runs, so server and first client render always agree. */
export type ReviewStorageStatus = "loading" | "ready" | "unavailable";

export type ReviewStorageProblem = { tone: "warning" | "error"; text: string };

function openStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    const probe = `${REVIEW_STORAGE_KEY}:probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function describeLoad(raw: string | null, knownInvoiceIds: ReadonlySet<string>): { store: ReviewStore; problem: ReviewStorageProblem | null } {
  const parsed = parseReviewStore(raw, knownInvoiceIds);
  if (parsed.status === "invalid") {
    return {
      store: parsed.store,
      problem: { tone: "warning", text: "Saved review decisions in this browser could not be read (corrupted or from another version), so they were ignored. Your next change will replace them." }
    };
  }
  if (parsed.droppedEntries > 0) {
    return {
      store: parsed.store,
      problem: { tone: "warning", text: `${parsed.droppedEntries} saved review ${parsed.droppedEntries === 1 ? "entry was" : "entries were"} unreadable or for invoices no longer in the demo, and ${parsed.droppedEntries === 1 ? "was" : "were"} skipped.` }
    };
  }
  return { store: parsed.store, problem: null };
}

export function useReviewStore(knownInvoiceIds: ReadonlySet<string>) {
  const [store, setStore] = useState<ReviewStore>({});
  const [status, setStatus] = useState<ReviewStorageStatus>("loading");
  const [problem, setProblem] = useState<ReviewStorageProblem | null>(null);
  const storeRef = useRef<ReviewStore>(store);
  const storageRef = useRef<Storage | null>(null);

  useEffect(() => {
    const storage = openStorage();
    storageRef.current = storage;
    if (!storage) {
      setStatus("unavailable");
      setProblem({ tone: "error", text: "This browser is blocking local storage (private mode or site-data settings). Review decisions will work but are lost when you reload the page." });
      return;
    }
    const load = () => {
      let raw: string | null = null;
      try {
        raw = storage.getItem(REVIEW_STORAGE_KEY);
      } catch {
        raw = null;
      }
      const loaded = describeLoad(raw, knownInvoiceIds);
      storeRef.current = loaded.store;
      setStore(loaded.store);
      setProblem(loaded.problem);
    };
    load();
    setStatus("ready");
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === storage && (event.key === REVIEW_STORAGE_KEY || event.key === null)) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [knownInvoiceIds]);

  const commit = useCallback((next: ReviewStore): boolean => {
    if (next === storeRef.current) return false;
    storeRef.current = next;
    setStore(next);
    const storage = storageRef.current;
    if (!storage) return true;
    try {
      if (Object.keys(next).length === 0) storage.removeItem(REVIEW_STORAGE_KEY);
      else storage.setItem(REVIEW_STORAGE_KEY, serializeReviewStore(next));
      setProblem(null);
    } catch {
      setProblem({ tone: "error", text: "Could not save to this browser's storage (it may be full or blocked). Your latest change is kept only until you reload." });
    }
    return true;
  }, []);

  const update = useCallback((invoiceId: string, patch: ReviewPatch) => commit(updateReview(storeRef.current, invoiceId, patch, new Date().toISOString())), [commit]);
  const undo = useCallback((invoiceId: string) => commit(undoReview(storeRef.current, invoiceId)), [commit]);
  const resetAll = useCallback(() => commit({}), [commit]);

  return { store, status, problem, update, undo, resetAll };
}
