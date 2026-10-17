/**
 * Reviewer decisions for the synthetic demo. Lives only in the browser's localStorage and is
 * never sent to the server, Nicrron or PRISM. It reaches a file only when the user explicitly
 * ticks "include reviewer decisions and notes" in the accountant export.
 */

import type { Locale } from "./locale";

export const REVIEW_STORAGE_VERSION = 1;
export const REVIEW_STORAGE_KEY = `closemate:demo-review-state:v${REVIEW_STORAGE_VERSION}`;
export const REVIEW_NOTE_MAX_LENGTH = 280;
export const REVIEW_HISTORY_LIMIT = 10;

export type ReviewDecision = "reviewed" | "needs_review";

export type ReviewSnapshot = {
  decision: ReviewDecision | null;
  note: string;
  /** ISO timestamp of the change that produced this snapshot. */
  updatedAt: string | null;
};

export type ReviewEntry = ReviewSnapshot & {
  /** Earlier snapshots, oldest first; the last one is what Undo restores. */
  history: ReviewSnapshot[];
};

export type ReviewStore = Readonly<Record<string, ReviewEntry>>;

export const EMPTY_REVIEW_ENTRY: ReviewEntry = Object.freeze({ decision: null, note: "", updatedAt: null, history: [] as ReviewSnapshot[] });

export function getReviewEntry(store: ReviewStore, invoiceId: string): ReviewEntry {
  return Object.prototype.hasOwnProperty.call(store, invoiceId) ? store[invoiceId] : EMPTY_REVIEW_ENTRY;
}

/** Trims, strips control characters (newlines and tabs become spaces) and caps the length. */
export function normalizeReviewNote(note: string): string {
  return note
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, REVIEW_NOTE_MAX_LENGTH);
}

function snapshotOf(entry: ReviewSnapshot): ReviewSnapshot {
  return { decision: entry.decision, note: entry.note, updatedAt: entry.updatedAt };
}

function isBlank(snapshot: ReviewSnapshot): boolean {
  return snapshot.decision === null && snapshot.note === "";
}

function withEntry(store: ReviewStore, invoiceId: string, entry: ReviewEntry | null): ReviewStore {
  const rest = Object.entries(store).filter(([id]) => id !== invoiceId);
  return Object.fromEntries(entry ? [...rest, [invoiceId, entry]] : rest);
}

export type ReviewPatch = { decision?: ReviewDecision | null; note?: string };

/** Applies a decision and/or note as a single undoable change. Returns the same store when nothing changes. */
export function updateReview(store: ReviewStore, invoiceId: string, patch: ReviewPatch, now: string): ReviewStore {
  const current = getReviewEntry(store, invoiceId);
  const decision = patch.decision === undefined ? current.decision : patch.decision;
  const note = patch.note === undefined ? current.note : normalizeReviewNote(patch.note);
  if (decision === current.decision && note === current.note) return store;
  const history = [...current.history, snapshotOf(current)].slice(-REVIEW_HISTORY_LIMIT);
  return withEntry(store, invoiceId, { decision, note, updatedAt: now, history });
}

/** Restores the previous snapshot for one invoice. Returns the same store when there is nothing to undo. */
export function undoReview(store: ReviewStore, invoiceId: string): ReviewStore {
  const current = getReviewEntry(store, invoiceId);
  const previous = current.history.at(-1);
  if (!previous) return store;
  const history = current.history.slice(0, -1);
  const restored: ReviewEntry = { ...previous, history };
  return withEntry(store, invoiceId, isBlank(restored) && history.length === 0 ? null : restored);
}

const UNDO_COPY: Record<Locale, { reviewed: string; needs_review: string; cleared: string; edited: string; added: string; removed: string }> = {
  en: {
    reviewed: "marked reviewed",
    needs_review: "marked needs review",
    cleared: "decision cleared",
    edited: "note edited",
    added: "note added",
    removed: "note removed"
  },
  pl: {
    reviewed: "oznaczono jako sprawdzone",
    needs_review: "oznaczono do weryfikacji",
    cleared: "wyczyszczono decyzję",
    edited: "zmieniono notatkę",
    added: "dodano notatkę",
    removed: "usunięto notatkę"
  }
};

/** Short description of what Undo would revert, or null when there is nothing to undo. */
export function describeUndo(entry: ReviewEntry, locale: Locale = "en"): string | null {
  const previous = entry.history.at(-1);
  if (!previous) return null;
  const copy = UNDO_COPY[locale] ?? UNDO_COPY.en;
  const parts: string[] = [];
  if (previous.decision !== entry.decision) parts.push(entry.decision ? copy[entry.decision] : copy.cleared);
  if (previous.note !== entry.note) parts.push(entry.note ? (previous.note ? copy.edited : copy.added) : copy.removed);
  return parts.join(" + ") || null;
}

export function reviewDecisions(store: ReviewStore): Record<string, ReviewDecision | undefined> {
  return Object.fromEntries(Object.entries(store).flatMap(([id, entry]) => (entry.decision ? [[id, entry.decision]] : [])));
}

/* ---------- persistence ---------- */

type StoredPayload = { version: typeof REVIEW_STORAGE_VERSION; entries: Record<string, ReviewEntry> };

export type ParsedReviewStore =
  | { status: "empty"; store: ReviewStore; droppedEntries: 0 }
  | { status: "ok"; store: ReviewStore; droppedEntries: number }
  | { status: "invalid"; store: ReviewStore; droppedEntries: 0 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDecision(value: unknown): ReviewDecision | null | undefined {
  if (value === null) return null;
  return value === "reviewed" || value === "needs_review" ? value : undefined;
}

function parseTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function parseSnapshot(value: unknown): ReviewSnapshot | null {
  if (!isRecord(value)) return null;
  const decision = parseDecision(value.decision);
  const updatedAt = parseTimestamp(value.updatedAt);
  if (decision === undefined || updatedAt === undefined || typeof value.note !== "string") return null;
  return { decision, note: normalizeReviewNote(value.note), updatedAt };
}

function parseEntry(value: unknown): ReviewEntry | null {
  const snapshot = parseSnapshot(value);
  if (!snapshot || !isRecord(value) || !Array.isArray(value.history)) return null;
  const history = value.history.map(parseSnapshot);
  if (history.some((h) => h === null)) return null;
  return { ...snapshot, history: (history as ReviewSnapshot[]).slice(-REVIEW_HISTORY_LIMIT) };
}

/**
 * Reads the raw localStorage value. Malformed JSON, a different version or a wrong shape is
 * reported as "invalid" (and ignored); individual bad or unknown entries are dropped and counted.
 */
export function parseReviewStore(raw: string | null, knownInvoiceIds?: ReadonlySet<string>): ParsedReviewStore {
  if (raw === null || raw === "") return { status: "empty", store: {}, droppedEntries: 0 };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: "invalid", store: {}, droppedEntries: 0 };
  }
  if (!isRecord(data) || data.version !== REVIEW_STORAGE_VERSION || !isRecord(data.entries)) {
    return { status: "invalid", store: {}, droppedEntries: 0 };
  }
  let droppedEntries = 0;
  const entries: [string, ReviewEntry][] = [];
  for (const [id, value] of Object.entries(data.entries)) {
    const entry = parseEntry(value);
    if (!entry || (knownInvoiceIds && !knownInvoiceIds.has(id))) {
      droppedEntries += 1;
      continue;
    }
    if (!isBlank(entry) || entry.history.length > 0) entries.push([id, entry]);
  }
  return { status: "ok", store: Object.fromEntries(entries), droppedEntries };
}

export function serializeReviewStore(store: ReviewStore): string {
  const payload: StoredPayload = { version: REVIEW_STORAGE_VERSION, entries: { ...store } };
  return JSON.stringify(payload);
}
