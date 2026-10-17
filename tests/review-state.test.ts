import { describe, expect, it } from "vitest";
import {
  describeUndo,
  EMPTY_REVIEW_ENTRY,
  getReviewEntry,
  normalizeReviewNote,
  parseReviewStore,
  REVIEW_HISTORY_LIMIT,
  REVIEW_NOTE_MAX_LENGTH,
  REVIEW_STORAGE_KEY,
  reviewDecisions,
  serializeReviewStore,
  undoReview,
  updateReview,
  type ReviewStore
} from "../lib/review-state";

const T1 = "2026-10-17T10:00:00.000Z";
const T2 = "2026-10-17T11:00:00.000Z";
const T3 = "2026-10-17T12:00:00.000Z";
const known = new Set(["INV-1", "INV-2"]);

describe("storage key", () => {
  it("is versioned", () => {
    expect(REVIEW_STORAGE_KEY).toBe("closemate:demo-review-state:v1");
  });
});

describe("updateReview", () => {
  it("records a decision with a timestamp", () => {
    const store = updateReview({}, "INV-1", { decision: "reviewed" }, T1);
    expect(getReviewEntry(store, "INV-1")).toMatchObject({ decision: "reviewed", note: "", updatedAt: T1 });
    expect(reviewDecisions(store)).toEqual({ "INV-1": "reviewed" });
  });

  it("does not mutate the previous store", () => {
    const before: ReviewStore = {};
    updateReview(before, "INV-1", { decision: "reviewed" }, T1);
    expect(before).toEqual({});
  });

  it("returns the same store when nothing changes", () => {
    const store = updateReview({}, "INV-1", { decision: "reviewed", note: "ok" }, T1);
    expect(updateReview(store, "INV-1", { decision: "reviewed" }, T2)).toBe(store);
    expect(updateReview(store, "INV-1", { note: "  ok  " }, T2)).toBe(store);
    expect(updateReview({}, "INV-1", { decision: null, note: "" }, T1)).toEqual({});
  });

  it("applies a decision and a note as one undoable change", () => {
    const store = updateReview({}, "INV-1", { decision: "needs_review", note: "Ask vendor" }, T1);
    expect(describeUndo(getReviewEntry(store, "INV-1"))).toBe("marked needs review + note added");
    expect(undoReview(store, "INV-1")).toEqual({});
  });

  it("caps history so storage cannot grow without bound", () => {
    let store: ReviewStore = {};
    for (let i = 0; i < REVIEW_HISTORY_LIMIT + 5; i++) store = updateReview(store, "INV-1", { note: `note ${i}` }, T1);
    expect(getReviewEntry(store, "INV-1").history).toHaveLength(REVIEW_HISTORY_LIMIT);
  });
});

describe("undoReview", () => {
  it("restores the previous decision, note and timestamp step by step", () => {
    let store = updateReview({}, "INV-1", { decision: "reviewed" }, T1);
    store = updateReview(store, "INV-1", { note: "Checked bank statement" }, T2);
    store = updateReview(store, "INV-1", { decision: "needs_review" }, T3);

    store = undoReview(store, "INV-1");
    expect(getReviewEntry(store, "INV-1")).toMatchObject({ decision: "reviewed", note: "Checked bank statement", updatedAt: T2 });
    store = undoReview(store, "INV-1");
    expect(getReviewEntry(store, "INV-1")).toMatchObject({ decision: "reviewed", note: "", updatedAt: T1 });
    store = undoReview(store, "INV-1");
    expect(store).toEqual({});
    expect(getReviewEntry(store, "INV-1")).toBe(EMPTY_REVIEW_ENTRY);
  });

  it("is a no-op when there is nothing to undo", () => {
    const store = updateReview({}, "INV-2", { decision: "reviewed" }, T1);
    expect(undoReview(store, "INV-1")).toBe(store);
  });

  it("only touches the selected invoice", () => {
    let store = updateReview({}, "INV-1", { decision: "reviewed" }, T1);
    store = updateReview(store, "INV-2", { decision: "needs_review" }, T2);
    store = undoReview(store, "INV-1");
    expect(reviewDecisions(store)).toEqual({ "INV-2": "needs_review" });
  });
});

describe("describeUndo", () => {
  it("describes the change Undo would revert", () => {
    let store = updateReview({}, "INV-1", { decision: "reviewed" }, T1);
    expect(describeUndo(getReviewEntry(store, "INV-1"))).toBe("marked reviewed");
    store = updateReview(store, "INV-1", { decision: null }, T2);
    expect(describeUndo(getReviewEntry(store, "INV-1"))).toBe("decision cleared");
    store = updateReview(store, "INV-1", { note: "a" }, T2);
    store = updateReview(store, "INV-1", { note: "b" }, T3);
    expect(describeUndo(getReviewEntry(store, "INV-1"))).toBe("note edited");
    store = updateReview(store, "INV-1", { note: "" }, T3);
    expect(describeUndo(getReviewEntry(store, "INV-1"))).toBe("note removed");
    expect(describeUndo(EMPTY_REVIEW_ENTRY)).toBeNull();
  });
});

describe("normalizeReviewNote", () => {
  it("trims, flattens control characters and caps the length", () => {
    expect(normalizeReviewNote("  Called vendor \n\n re: VAT\t ")).toBe("Called vendor re: VAT");
    expect(normalizeReviewNote("x".repeat(REVIEW_NOTE_MAX_LENGTH + 50))).toHaveLength(REVIEW_NOTE_MAX_LENGTH);
  });
});

describe("parseReviewStore", () => {
  it("round-trips a serialized store", () => {
    let store = updateReview({}, "INV-1", { decision: "reviewed", note: "Bank OK" }, T1);
    store = updateReview(store, "INV-2", { decision: "needs_review" }, T2);
    expect(parseReviewStore(serializeReviewStore(store), known)).toEqual({ status: "ok", store, droppedEntries: 0 });
  });

  it("treats a missing value as empty", () => {
    expect(parseReviewStore(null)).toEqual({ status: "empty", store: {}, droppedEntries: 0 });
    expect(parseReviewStore("")).toEqual({ status: "empty", store: {}, droppedEntries: 0 });
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["a JSON array", "[]"],
    ["a JSON string", '"hello"'],
    ["null", "null"],
    ["a missing version", JSON.stringify({ entries: {} })],
    ["a future version", JSON.stringify({ version: 2, entries: {} })],
    ["entries that are not an object", JSON.stringify({ version: 1, entries: [] })]
  ])("rejects %s as invalid without throwing", (_label, raw) => {
    expect(parseReviewStore(raw, known)).toEqual({ status: "invalid", store: {}, droppedEntries: 0 });
  });

  it("drops individual malformed entries and keeps the valid ones", () => {
    const raw = JSON.stringify({
      version: 1,
      entries: {
        "INV-1": { decision: "reviewed", note: "fine", updatedAt: T1, history: [] },
        "INV-2": { decision: "approved", note: "bad decision", updatedAt: T1, history: [] }
      }
    });
    const parsed = parseReviewStore(raw, known);
    expect(parsed.status).toBe("ok");
    expect(Object.keys(parsed.store)).toEqual(["INV-1"]);
    expect(parsed.droppedEntries).toBe(1);
  });

  it.each([
    ["a non-string note", { decision: "reviewed", note: 5, updatedAt: T1, history: [] }],
    ["an unparseable timestamp", { decision: "reviewed", note: "", updatedAt: "yesterday-ish", history: [] }],
    ["missing history", { decision: "reviewed", note: "", updatedAt: T1 }],
    ["a malformed history item", { decision: "reviewed", note: "", updatedAt: T1, history: [{ decision: "maybe", note: "", updatedAt: null }] }],
    ["a non-object entry", "reviewed"]
  ])("drops an entry with %s", (_label, entry) => {
    const parsed = parseReviewStore(JSON.stringify({ version: 1, entries: { "INV-1": entry } }), known);
    expect(parsed).toEqual({ status: "ok", store: {}, droppedEntries: 1 });
  });

  it("drops entries for invoices that are not in the dataset", () => {
    const raw = JSON.stringify({ version: 1, entries: { "INV-999": { decision: "reviewed", note: "", updatedAt: T1, history: [] } } });
    expect(parseReviewStore(raw, known)).toEqual({ status: "ok", store: {}, droppedEntries: 1 });
  });

  it("re-normalizes notes that were edited by hand in storage", () => {
    const raw = JSON.stringify({ version: 1, entries: { "INV-1": { decision: null, note: `  ${"y".repeat(400)}\n`, updatedAt: T1, history: [] } } });
    expect(parseReviewStore(raw, known).store["INV-1"].note).toHaveLength(REVIEW_NOTE_MAX_LENGTH);
  });

  it("cannot pollute Object.prototype through a crafted key", () => {
    const raw = `{"version":1,"entries":{"__proto__":{"decision":"reviewed","note":"x","updatedAt":null,"history":[]}}}`;
    const parsed = parseReviewStore(raw);
    expect(({} as Record<string, unknown>).decision).toBeUndefined();
    expect(getReviewEntry(parsed.store, "toString")).toBe(EMPTY_REVIEW_ENTRY);
  });
});
