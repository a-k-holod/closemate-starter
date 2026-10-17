"use client";

import { useId, useState } from "react";
import type { ReviewQueueState } from "@/lib/invoice-review";
import { describeUndo, REVIEW_NOTE_MAX_LENGTH, normalizeReviewNote, type ReviewDecision, type ReviewEntry, type ReviewPatch } from "@/lib/review-state";
import type { ReviewStorageStatus } from "@/lib/use-review-store";

export const REVIEW_QUEUE_LABEL: Record<ReviewQueueState, string> = {
  reviewed: "Reviewed",
  flagged: "Flagged for review",
  awaiting: "Awaiting review",
  not_required: "No review required"
};

function formatSavedAt(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

type ReviewPanelProps = {
  entry: ReviewEntry;
  queueState: ReviewQueueState;
  storageStatus: ReviewStorageStatus;
  onUpdate: (patch: ReviewPatch) => void;
  onUndo: () => void;
};

/** Render with key={invoiceId} so the note draft resets when the reviewer switches invoices. */
export function ReviewPanel({ entry, queueState, storageStatus, onUpdate, onUndo }: ReviewPanelProps) {
  const id = useId();
  const [draft, setDraft] = useState(entry.note);
  const [syncedNote, setSyncedNote] = useState(entry.note);
  if (entry.note !== syncedNote) {
    setSyncedNote(entry.note);
    setDraft(entry.note);
  }

  const loading = storageStatus === "loading";
  const dirty = normalizeReviewNote(draft) !== entry.note;
  const undoLabel = describeUndo(entry);

  function decide(decision: ReviewDecision) {
    onUpdate({ decision: entry.decision === decision ? null : decision, ...(dirty ? { note: draft } : {}) });
  }

  return (
    <section className="review-card" aria-labelledby={`${id}-title`} aria-busy={loading}>
      <div className="review-card-head">
        <div>
          <strong id={`${id}-title`}>Reviewer decision</strong>
          <small>{storageStatus === "unavailable" ? "Not saved · storage blocked in this browser" : "Saved only in this browser"}</small>
        </div>
        {!loading && <span className={`review-state review-state-${queueState}`}>{REVIEW_QUEUE_LABEL[queueState]}</span>}
      </div>

      {loading ? (
        <p className="review-loading" role="status"><span className="spinner spinner-dark" aria-hidden="true" /> Loading saved review decisions…</p>
      ) : (
        <>
          <div className="review-decisions" role="group" aria-label="Review decision">
            <button type="button" className="review-toggle review-toggle-reviewed" aria-pressed={entry.decision === "reviewed"} onClick={() => decide("reviewed")}>
              <span aria-hidden="true">✓</span> Mark reviewed
            </button>
            <button type="button" className="review-toggle review-toggle-flagged" aria-pressed={entry.decision === "needs_review"} onClick={() => decide("needs_review")}>
              <span aria-hidden="true">⚑</span> Needs review
            </button>
          </div>

          <label className="review-note-label" htmlFor={`${id}-note`}>Reviewer note <span>optional</span></label>
          <textarea
            id={`${id}-note`}
            className="review-note"
            rows={2}
            maxLength={REVIEW_NOTE_MAX_LENGTH}
            value={draft}
            placeholder="e.g. Asked vendor for a correction invoice"
            aria-describedby={`${id}-note-help`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && dirty) {
                e.preventDefault();
                onUpdate({ note: draft });
              }
            }}
          />
          <div className="review-note-foot">
            <span id={`${id}-note-help`}>
              {dirty ? "Unsaved changes · ⌘/Ctrl + Enter to save" : entry.updatedAt ? `Last change ${formatSavedAt(entry.updatedAt)}` : "Never sent to CloseMate AI, Nicrron or PRISM"}
            </span>
            <span aria-hidden="true">{draft.length}/{REVIEW_NOTE_MAX_LENGTH}</span>
          </div>

          <div className="review-card-actions">
            <button type="button" className="button button-secondary" disabled={!dirty} onClick={() => onUpdate({ note: draft })}>Save note</button>
            {undoLabel && <button type="button" className="ghost-button review-undo" onClick={onUndo}>↶ Undo: {undoLabel}</button>}
          </div>
        </>
      )}
    </section>
  );
}
