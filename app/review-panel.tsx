"use client";

import { useId, useState } from "react";
import type { ReviewQueueState } from "@/lib/invoice-review";
import type { Locale } from "@/lib/locale";
import type { Messages } from "@/lib/messages";
import { describeUndo, REVIEW_NOTE_MAX_LENGTH, normalizeReviewNote, type ReviewDecision, type ReviewEntry, type ReviewPatch } from "@/lib/review-state";
import type { ReviewStorageStatus } from "@/lib/use-review-store";

function formatSavedAt(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

type ReviewPanelProps = {
  entry: ReviewEntry;
  queueState: ReviewQueueState;
  storageStatus: ReviewStorageStatus;
  locale: Locale;
  t: Messages;
  onUpdate: (patch: ReviewPatch) => void;
  onUndo: () => void;
};

/** Render with key={invoiceId} so the note draft resets when the reviewer switches invoices. */
export function ReviewPanel({ entry, queueState, storageStatus, locale, t, onUpdate, onUndo }: ReviewPanelProps) {
  const id = useId();
  const [draft, setDraft] = useState(entry.note);
  const [syncedNote, setSyncedNote] = useState(entry.note);
  if (entry.note !== syncedNote) {
    setSyncedNote(entry.note);
    setDraft(entry.note);
  }

  const loading = storageStatus === "loading";
  const dirty = normalizeReviewNote(draft) !== entry.note;
  const undoLabel = describeUndo(entry, locale);

  function decide(decision: ReviewDecision) {
    onUpdate({ decision: entry.decision === decision ? null : decision, ...(dirty ? { note: draft } : {}) });
  }

  return (
    <section className="review-card" aria-labelledby={`${id}-title`} aria-busy={loading}>
      <div className="review-card-head">
        <div>
          <strong id={`${id}-title`}>{t.review.title}</strong>
          <small>{storageStatus === "unavailable" ? t.review.notSaved : t.review.savedHere}</small>
        </div>
        {!loading && <span className={`review-state review-state-${queueState}`}>{t.queue[queueState]}</span>}
      </div>

      {loading ? (
        <p className="review-loading" role="status"><span className="spinner spinner-dark" aria-hidden="true" /> {t.review.loading}</p>
      ) : (
        <>
          <div className="review-decisions" role="group" aria-label={t.review.decision}>
            <button type="button" className="review-toggle review-toggle-reviewed" aria-pressed={entry.decision === "reviewed"} onClick={() => decide("reviewed")}>
              <span aria-hidden="true">✓</span> {t.review.markReviewed}
            </button>
            <button type="button" className="review-toggle review-toggle-flagged" aria-pressed={entry.decision === "needs_review"} onClick={() => decide("needs_review")}>
              <span aria-hidden="true">⚑</span> {t.review.needsReview}
            </button>
          </div>

          <label className="review-note-label" htmlFor={`${id}-note`}>{t.review.note} <span>{t.review.optional}</span></label>
          <textarea
            id={`${id}-note`}
            className="review-note"
            rows={2}
            maxLength={REVIEW_NOTE_MAX_LENGTH}
            value={draft}
            placeholder={t.review.placeholder}
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
              {dirty ? t.review.unsaved : entry.updatedAt ? t.review.lastChange(formatSavedAt(entry.updatedAt, locale)) : t.review.neverSent}
            </span>
            <span aria-hidden="true">{draft.length}/{REVIEW_NOTE_MAX_LENGTH}</span>
          </div>

          <div className="review-card-actions">
            <button type="button" className="button button-secondary" disabled={!dirty} onClick={() => onUpdate({ note: draft })}>{t.review.save}</button>
            {undoLabel && <button type="button" className="ghost-button review-undo" onClick={onUndo}>↶ {t.review.undo(undoLabel)}</button>}
          </div>
        </>
      )}
    </section>
  );
}
