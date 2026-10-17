import type { VatRate } from "./invoice";
import type { ReviewFilter, ReviewQueueState } from "./invoice-review";
import type { Locale } from "./locale";
import type { ReconciliationStatus } from "./reconcile";

const en = {
  meta: {
    title: "CloseMate — Finance close, with evidence",
    description: "AI-assisted invoice reconciliation with traceable decisions and human review."
  },
  locale: {
    group: "Language",
    en: "English",
    pl: "Polski"
  },
  nav: {
    main: "Main navigation",
    workspace: "WORKSPACE",
    operations: "OPERATIONS",
    intelligence: "INTELLIGENCE",
    overview: "Overview",
    reconciliation: "Reconciliation",
    invoices: "Invoices",
    payments: "Payments",
    ai: "CloseMate AI",
    audit: "Audit trail",
    team: "Finance team",
    demoWorkspace: "Demo workspace",
    purchaseInvoices: "Purchase invoices"
  },
  topbar: {
    financeOps: "Finance operations",
    reconciliation: "Reconciliation",
    readOnly: "Read-only demo",
    help: "Help"
  },
  heading: {
    eyebrow: "MONTH-END CLOSE · OCTOBER 2026",
    titleLead: "Reconciliation,",
    titleEm: "under control.",
    subtitle: "Find the exceptions. Understand the why. Close with evidence."
  },
  actions: {
    run: "Run reconciliation",
    rerunNotice: "Reconciliation re-run on the sample data. No money moved.",
    sample: "Sample data",
    sampleNotice: "Showing the seeded October demo dataset."
  },
  export: {
    button: "Export for accountant",
    menu: "Export for accountant",
    format: "CSV · UTF-8 · SEMICOLON",
    all: "All records",
    allDetail: (count: number) => `${count} ${count === 1 ? "invoice" : "invoices"} · every status`,
    filtered: "Filtered records",
    filteredDetail: (count: number, summary: string) => `${count} ${count === 1 ? "invoice" : "invoices"} · ${summary}`,
    noFilter: "no filter applied",
    search: (query: string) => `search “${query}”`,
    includeTitle: "Include my reviewer decisions & notes",
    includeHelp: "Adds two columns from this browser only. Off by default.",
    emptyFiltered: "No records to export: no invoices match the current search and filter.",
    emptyAll: "No records to export.",
    gross: "gross",
    notesIncluded: "includes your local reviewer decisions and notes",
    notesExcluded: "reviewer notes not included",
    exported: (count: number, filename: string, totals: string, includesReview: boolean) =>
      `Exported ${count} ${count === 1 ? "record" : "records"} to ${filename} · ${totals} · ${includesReview ? "includes your local reviewer decisions and notes" : "reviewer notes not included"}.`
  },
  banner: {
    lead: "Synthetic records only.",
    body: "Every vendor, NIP, invoice and bank payment on this page is fictional. Review decisions and notes are stored only in this browser (localStorage) and are never sent to CloseMate AI, Nicrron or PRISM; they appear in a CSV only if you tick that option when exporting. This prototype has no PDF/OCR import, cloud document storage, bank or KSeF connection, and gives no tax advice or deductibility decisions.",
    clear: "Clear my review decisions",
    confirmClear: "Clear every review decision and note saved in this browser? This cannot be undone.",
    cleared: "All demo review decisions were cleared from this browser."
  },
  storage: {
    unreadable: "Saved review decisions in this browser could not be read (corrupted or from another version), so they were ignored. Your next change will replace them.",
    dropped: (count: number) =>
      `${count} saved review ${count === 1 ? "entry was" : "entries were"} unreadable or for invoices no longer in the demo, and ${count === 1 ? "was" : "were"} skipped.`,
    blocked: "This browser is blocking local storage (private mode or site-data settings). Review decisions will work but are lost when you reload the page.",
    saveFailed: "Could not save to this browser's storage (it may be full or blocked). Your latest change is kept only until you reload."
  },
  kpi: {
    signOff: "Reviewer sign-off",
    reviewedUnit: (total: number) => ` of ${total} reviewed`,
    loadingDecisions: "Loading saved decisions…",
    awaiting: (count: number) => `${count} awaiting review · this browser only`,
    reconciled: "Reconciled",
    ofTotal: (total: number) => ` of ${total}`,
    matchedEvidence: (totals: string) => `${totals} matched with evidence`,
    nothing: "Nothing",
    exceptions: "Exceptions to review",
    needAttention: (count: number): string => (count === 1 ? " needs attention" : " need attention"),
    overdue: (count: number) => `${count} overdue · no automatic payment actions`,
    exposure: "Potential exposure",
    flagged: " flagged",
    exposureFoot: "Mismatch gap + duplicate excess, per currency"
  },
  panel: {
    title: "Invoice reconciliation",
    subtitle: (asOf: string) => `Bank statement evidence matched to purchase invoices on gross amount and currency · as of ${asOf}`,
    open: "Open"
  },
  search: {
    label: "Search invoices",
    placeholder: "Search invoice no., vendor, NIP or category",
    clear: "Clear search"
  },
  filters: {
    group: "Filter invoices",
    countLoading: "count loading",
    all: "All invoices",
    matched: "Matched",
    amount_mismatch: "Amount mismatch",
    missing_payment: "Missing payment",
    possible_duplicate: "Possible duplicate",
    overdue: "Overdue",
    needs_review: "Needs review"
  } satisfies Record<"group" | "countLoading" | ReviewFilter, string>,
  status: {
    matched: "Matched",
    amount_mismatch: "Amount mismatch",
    missing_payment: "Missing payment",
    possible_duplicate: "Possible duplicate",
    needs_review: "Needs review"
  } satisfies Record<ReconciliationStatus, string>,
  queue: {
    reviewed: "Reviewed",
    flagged: "Flagged for review",
    awaiting: "Awaiting review",
    not_required: "No review required"
  } satisfies Record<ReviewQueueState, string>,
  currency: {
    title: "TOTALS IN THIS VIEW · PER CURRENCY, NEVER CONVERTED",
    invoices: (count: number) => `${count} ${count === 1 ? "invoice" : "invoices"}`,
    invoiced: "Invoiced gross",
    evidence: "Bank evidence",
    unpaid: "Unpaid",
    overpaid: "Overpaid"
  },
  table: {
    invoiceVendor: "INVOICE / VENDOR",
    invoiceAmount: "INVOICE AMOUNT",
    payment: "PAYMENT",
    autoStatus: "AUTO STATUS · YOUR REVIEW",
    due: (date: string) => `Due ${date}`,
    transfers: (count: number) => `${count} transfers`,
    noPayment: "No payment found",
    otherCurrency: (currency: string) => `${currency} payment · not matched`,
    overdue: (days: number) => `${days}d overdue`,
    reviewed: "✓ Reviewed",
    flagged: "⚑ Flagged",
    note: "✎ Note",
    decisionTitle: "Your reviewer decision, saved in this browser",
    noteTitle: "Has a reviewer note",
    caption: (filterLabel: string, query: string) => {
      const filter = filterLabel ? `, filtered to ${filterLabel}` : "";
      const search = query ? `, matching “${query}”` : "";
      return `Invoices${filter}${search}. Select an invoice to review it.`;
    },
    showing: (shown: number, total: number) => `Showing ${shown} of ${total} invoices`,
    matched: (count: number) => `${count} matched`,
    exceptions: (count: number) => `${count} exceptions`,
    select: (number: string) => `Review ${number}`
  },
  empty: {
    title: "No invoices match",
    search: (query: string, filterLabel: string) =>
      `Nothing matches “${query}”${filterLabel ? ` in ${filterLabel}` : ""}. Try an invoice number, vendor, NIP or category.`,
    signedOff: "Every exception has been signed off. Nice work.",
    noneInFilter: (label: string) => `No invoices are currently ${label.toLowerCase()}.`,
    clearSearch: "Clear search",
    showAll: "Show all invoices"
  },
  detail: {
    eyebrow: "EXCEPTION REVIEW",
    hidden: "Hidden by current filter",
    position: (index: number, total: number) => `${String(index).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
    foreignVendor: (country: string) => `Foreign vendor (${country})`,
    nip: (nip: string) => `NIP ${nip}`,
    autoCheck: "AUTO CHECK",
    autoTitle: "Deterministic reconciliation result, not a human approval",
    invoiceGross: "INVOICE GROSS",
    paymentTotal: "PAYMENT TOTAL",
    net: "Net",
    vat: (rate: string) => `VAT · ${rate}`,
    issuedDue: "Issued / due",
    category: "Category",
    why: "Why this needs review",
    evidence: "Evidence found",
    noCandidate: "No candidate payment",
    differentCurrency: "different currency, not matched",
    bankFound: (account: string) => `Bank record found · ${account}`,
    otherOnly: "Only other-currency evidence found; not matched",
    noneFound: "No candidate transaction found"
  },
  vat: {
    "23": "23%",
    "8": "8%",
    "5": "5%",
    "0": "0%",
    zw: "Exempt (zw)",
    np: "Not subject to PL VAT (np)"
  } satisfies Record<VatRate, string>,
  ai: {
    title: "CloseMate insight",
    subtitle: "AI-assisted · Human approval required",
    nicrron: "NICRRON AI",
    rules: "RULE-BASED DEMO",
    explain: "Explain with AI",
    analyzing: "Analyzing…",
    listen: "♫ Listen",
    listenTitle: "Reads the rule-based summary aloud",
    preparing: "Preparing voice…",
    failed: "Analysis failed.",
    voiceFailed: "Voice generation failed.",
    generic: "Something went wrong.",
    traceQueued: "PRISM trace queued",
    traceOff: "PRISM not configured",
    nicrronDone: (trace: string) => `Nicrron analysis complete · ${trace}.`,
    rulesShown: (notice: string, trace: string) => `${notice} · ${trace}.`
  },
  fallback: {
    no_api_key: "Rule-based explanation shown. Nicrron is not configured on this deployment.",
    rate_limit_unconfigured: "Rule-based explanation shown. AI explanations are disabled here until rate limiting is configured.",
    rate_limited: "Too many AI requests right now. Rule-based explanation shown; try again shortly.",
    rate_limit_store_error: "Rule-based explanation shown. The rate limiter is unavailable, so the AI call was skipped.",
    provider_error: "Nicrron request failed. Rule-based explanation shown instead.",
    provider_timeout: "Nicrron timed out. Rule-based explanation shown instead.",
    empty_output: "Nicrron returned no text. Rule-based explanation shown instead.",
    guardrail_blocked: "The AI answer made a claim CloseMate cannot support, so the rule-based explanation is shown instead.",
    unknown: "Rule-based explanation shown."
  },
  review: {
    title: "Reviewer decision",
    savedHere: "Saved only in this browser",
    notSaved: "Not saved · storage blocked in this browser",
    loading: "Loading saved review decisions…",
    decision: "Review decision",
    markReviewed: "Mark reviewed",
    needsReview: "Needs review",
    note: "Reviewer note",
    optional: "optional",
    placeholder: "e.g. Asked vendor for a correction invoice",
    unsaved: "Unsaved changes · ⌘/Ctrl + Enter to save",
    lastChange: (when: string) => `Last change ${when}`,
    neverSent: "Never sent to CloseMate AI, Nicrron or PRISM",
    save: "Save note",
    undo: (label: string) => `Undo: ${label}`,
    keptUntilReload: "kept until you reload (storage blocked)",
    savedInBrowser: "saved in this browser only",
    markedReviewed: "marked reviewed",
    flagged: "flagged for review",
    decisionCleared: "decision cleared",
    noteSaved: "note saved",
    savedNotice: (number: string, parts: string, where: string) => `${number} ${parts} · ${where}.`,
    partJoin: " + ",
    undoNotice: (number: string) => `Undid the last review change on ${number}.`
  },
  human: {
    lead: "Human-in-the-loop",
    body: "CloseMate explains and flags. It never initiates a transfer or changes your ledger, and it does not decide tax deductibility or tax liability; confirm those with your accountant."
  },
  bottom: {
    observabilityTitle: "AI observability",
    observability: "Each explanation and voice request emits a privacy-safe trace (invoice ID, outcome, latency, model) when configured. No vendor data, prompts or notes.",
    routingTitle: "Model routing",
    routing: "Use one OpenAI-compatible endpoint for model access; fallback rules keep the demo usable.",
    voiceTitle: "Voice briefing",
    voice: "Listen to the rule-based exception summary when the voice API key is configured."
  },
  footer: {
    copyright: "© 2026 CloseMate · Built for Money Talks 2",
    synthetic: "Synthetic demo data",
    noConnection: "No bank, KSeF or tax-office connection",
    notAdvice: "Not tax advice",
    run: (count: number) => `Run #${count}`
  },
  notice: {
    dismiss: "Dismiss notice"
  },
  api: {
    onlyKnownFields: "Only invoiceId, sessionId and locale are accepted.",
    invoiceId: "invoiceId must look like INV-1234.",
    sessionId: "sessionId may contain only letters, digits and . _ : - (max 120).",
    unknownInvoice: "Unknown invoice. Only the synthetic demo invoices can be analyzed.",
    invalidRequest: "Invalid request.",
    voiceUnconfigured: "Voice summaries are not configured on this deployment.",
    voiceRateLimited: "Too many voice requests. Try again shortly.",
    voiceRateUnconfigured: "Voice summaries are disabled until rate limiting is configured.",
    voiceProvider: "Voice generation failed at the provider.",
    voiceFailed: "Voice generation failed."
  }
};

export type Messages = typeof en;

const pl: Messages = {
  meta: {
    title: "CloseMate — Zamknięcie miesiąca, z dowodami",
    description: "Uzgodnienie faktur ze śledzalnymi decyzjami i przeglądem człowieka."
  },
  locale: {
    group: "Język",
    en: "English",
    pl: "Polski"
  },
  nav: {
    main: "Nawigacja główna",
    workspace: "OBSZAR ROBOCZY",
    operations: "OPERACJE",
    intelligence: "ANALIZA",
    overview: "Przegląd",
    reconciliation: "Uzgodnienia",
    invoices: "Faktury",
    payments: "Płatności",
    ai: "CloseMate AI",
    audit: "Ślad audytu",
    team: "Zespół finansów",
    demoWorkspace: "Obszar roboczy demo",
    purchaseInvoices: "Faktury zakupowe"
  },
  topbar: {
    financeOps: "Operacje finansowe",
    reconciliation: "Uzgodnienia",
    readOnly: "Demo tylko do odczytu",
    help: "Pomoc"
  },
  heading: {
    eyebrow: "ZAMKNIĘCIE MIESIĄCA · PAŹDZIERNIK 2026",
    titleLead: "Uzgodnienia,",
    titleEm: "pod kontrolą.",
    subtitle: "Znajdź wyjątki. Zrozum przyczynę. Zamknij miesiąc z dowodami."
  },
  actions: {
    run: "Uruchom uzgodnienie",
    rerunNotice: "Ponowne uzgodnienie na danych przykładowych. Żadne pieniądze nie zostały ruszone.",
    sample: "Dane przykładowe",
    sampleNotice: "Wyświetlony jest przykładowy zbiór danych za październik."
  },
  export: {
    button: "Eksport dla księgowego",
    menu: "Eksport dla księgowego",
    format: "CSV · UTF-8 · ŚREDNIK",
    all: "Wszystkie rekordy",
    allDetail: (count: number) => `${count} ${invoiceWord(count)} · każdy status`,
    filtered: "Rekordy z filtra",
    filteredDetail: (count: number, summary: string) => `${count} ${invoiceWord(count)} · ${summary}`,
    noFilter: "bez filtra",
    search: (query: string) => `szukaj „${query}”`,
    includeTitle: "Dołącz moje decyzje i notatki recenzenta",
    includeHelp: "Dodaje dwie kolumny tylko z tej przeglądarki. Domyślnie wyłączone.",
    emptyFiltered: "Brak rekordów do eksportu: żadna faktura nie pasuje do bieżącego wyszukiwania i filtra.",
    emptyAll: "Brak rekordów do eksportu.",
    gross: "brutto",
    notesIncluded: "zawiera lokalne decyzje i notatki recenzenta",
    notesExcluded: "bez notatek recenzenta",
    exported: (count: number, filename: string, totals: string, includesReview: boolean) =>
      `Wyeksportowano ${count} ${recordWord(count)} do ${filename} · ${totals} · ${includesReview ? "zawiera lokalne decyzje i notatki recenzenta" : "bez notatek recenzenta"}.`
  },
  banner: {
    lead: "Wyłącznie dane syntetyczne.",
    body: "Każdy dostawca, NIP, faktura i płatność bankowa na tej stronie są fikcyjne. Decyzje i notatki recenzenta są zapisywane tylko w tej przeglądarce (localStorage) i nigdy nie są wysyłane do CloseMate AI, Nicrron ani PRISM; trafiają do CSV tylko wtedy, gdy zaznaczysz tę opcję przy eksporcie. Ten prototyp nie ma importu PDF/OCR, chmury dokumentów, połączenia z bankiem ani KSeF i nie udziela porad podatkowych ani decyzji o odliczalności.",
    clear: "Wyczyść moje decyzje przeglądu",
    confirmClear: "Wyczyścić wszystkie decyzje i notatki przeglądu zapisane w tej przeglądarce? Tej operacji nie można cofnąć.",
    cleared: "Wszystkie demonstracyjne decyzje przeglądu zostały usunięte z tej przeglądarki."
  },
  storage: {
    unreadable: "Zapisanych decyzji przeglądu w tej przeglądarce nie udało się odczytać (uszkodzone lub z innej wersji), więc zostały pominięte. Następna zmiana je zastąpi.",
    dropped: (count: number) => {
      if (count === 1) return "1 zapisany wpis przeglądu był nieczytelny albo dotyczył faktury, której nie ma już w demo, i został pominięty.";
      const few = count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14);
      return few
        ? `${count} zapisane wpisy przeglądu były nieczytelne albo dotyczyły faktur, których nie ma już w demo, i zostały pominięte.`
        : `${count} zapisanych wpisów przeglądu było nieczytelnych albo dotyczyło faktur, których nie ma już w demo, i zostały pominięte.`;
    },
    blocked: "Ta przeglądarka blokuje pamięć lokalną (tryb prywatny albo ustawienia danych witryny). Decyzje przeglądu będą działać, ale znikną po odświeżeniu strony.",
    saveFailed: "Nie udało się zapisać w pamięci tej przeglądarki (może być pełna albo zablokowana). Ostatnia zmiana zostanie tylko do odświeżenia."
  },
  kpi: {
    signOff: "Akceptacja recenzenta",
    reviewedUnit: (total: number) => ` z ${total} sprawdzonych`,
    loadingDecisions: "Wczytywanie zapisanych decyzji…",
    awaiting: (count: number) => `${count} czeka na przegląd · tylko ta przeglądarka`,
    reconciled: "Uzgodnione",
    ofTotal: (total: number) => ` z ${total}`,
    matchedEvidence: (totals: string) => `${totals} uzgodnione z dowodem`,
    nothing: "Nic",
    exceptions: "Wyjątki do przeglądu",
    needAttention: (count: number) => (count === 1 ? " wymaga uwagi" : " wymagają uwagi"),
    overdue: (count: number) => `${count} po terminie · bez automatycznych płatności`,
    exposure: "Potencjalna ekspozycja",
    flagged: " oznaczone",
    exposureFoot: "Luka niezgodności + nadwyżka duplikatu, osobno dla waluty"
  },
  panel: {
    title: "Uzgodnienie faktur",
    subtitle: (asOf: string) => `Dowody z wyciągu bankowego dopasowane do faktur zakupowych po kwocie brutto i walucie · stan na ${asOf}`,
    open: "Otwórz"
  },
  search: {
    label: "Szukaj faktur",
    placeholder: "Szukaj numeru faktury, dostawcy, NIP lub kategorii",
    clear: "Wyczyść wyszukiwanie"
  },
  filters: {
    group: "Filtruj faktury",
    countLoading: "licznik się wczytuje",
    all: "Wszystkie faktury",
    matched: "Uzgodnione",
    amount_mismatch: "Niezgodność kwoty",
    missing_payment: "Brak płatności",
    possible_duplicate: "Możliwy duplikat",
    overdue: "Po terminie",
    needs_review: "Do przeglądu"
  },
  status: {
    matched: "Uzgodniona",
    amount_mismatch: "Niezgodność kwoty",
    missing_payment: "Brak płatności",
    possible_duplicate: "Możliwy duplikat",
    needs_review: "Do weryfikacji"
  },
  queue: {
    reviewed: "Sprawdzona",
    flagged: "Oznaczona do przeglądu",
    awaiting: "Czeka na przegląd",
    not_required: "Przegląd nie jest wymagany"
  },
  currency: {
    title: "SUMY W TYM WIDOKU · OSOBNO DLA KAŻDEJ WALUTY, BEZ PRZELICZANIA",
    invoices: (count: number) => `${count} ${invoiceWord(count)}`,
    invoiced: "Brutto zafakturowane",
    evidence: "Dowód bankowy",
    unpaid: "Nieopłacone",
    overpaid: "Nadpłacone"
  },
  table: {
    invoiceVendor: "FAKTURA / DOSTAWCA",
    invoiceAmount: "KWOTA FAKTURY",
    payment: "PŁATNOŚĆ",
    autoStatus: "STATUS AUTOMATYCZNY · TWÓJ PRZEGLĄD",
    due: (date: string) => `Termin ${date}`,
    transfers: (count: number) => `${count} ${transferWord(count)}`,
    noPayment: "Nie znaleziono płatności",
    otherCurrency: (currency: string) => `Płatność ${currency} · bez uzgodnienia`,
    overdue: (days: number) => `${days} d po terminie`,
    reviewed: "✓ Sprawdzona",
    flagged: "⚑ Do przeglądu",
    note: "✎ Notatka",
    decisionTitle: "Twoja decyzja recenzenta, zapisana w tej przeglądarce",
    noteTitle: "Ma notatkę recenzenta",
    caption: (filterLabel: string, query: string) => {
      const filter = filterLabel ? `, filtr: ${filterLabel}` : "";
      const search = query ? `, pasujące do „${query}”` : "";
      return `Faktury${filter}${search}. Wybierz fakturę, aby ją przejrzeć.`;
    },
    showing: (shown: number, total: number) => `Widoczne ${shown} z ${total} faktur`,
    matched: (count: number) => `${count} uzgodnionych`,
    exceptions: (count: number) => `${count} wyjątków`,
    select: (number: string) => `Przejrzyj ${number}`
  },
  empty: {
    title: "Brak pasujących faktur",
    search: (query: string, filterLabel: string) =>
      `Nic nie pasuje do „${query}”${filterLabel ? ` w filtrze ${filterLabel}` : ""}. Spróbuj numeru faktury, dostawcy, NIP albo kategorii.`,
    signedOff: "Każdy wyjątek został zaakceptowany. Dobra robota.",
    noneInFilter: (label: string) => `Żadna faktura nie jest teraz w filtrze „${label}”.`,
    clearSearch: "Wyczyść wyszukiwanie",
    showAll: "Pokaż wszystkie faktury"
  },
  detail: {
    eyebrow: "PRZEGLĄD WYJĄTKU",
    hidden: "Ukryta przez bieżący filtr",
    position: (index: number, total: number) => `${String(index).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
    foreignVendor: (country: string) => `Dostawca zagraniczny (${country})`,
    nip: (nip: string) => `NIP ${nip}`,
    autoCheck: "KONTROLA AUTOMATYCZNA",
    autoTitle: "Wynik deterministycznego uzgodnienia, nie akceptacja człowieka",
    invoiceGross: "BRUTTO FAKTURY",
    paymentTotal: "SUMA PŁATNOŚCI",
    net: "Netto",
    vat: (rate: string) => `VAT · ${rate}`,
    issuedDue: "Wystawiono / termin",
    category: "Kategoria",
    why: "Dlaczego wymaga przeglądu",
    evidence: "Znalezione dowody",
    noCandidate: "Brak płatności kandydackiej",
    differentCurrency: "inna waluta, bez uzgodnienia",
    bankFound: (account: string) => `Znaleziono zapis bankowy · ${account}`,
    otherOnly: "Znaleziono tylko dowód w innej walucie; bez uzgodnienia",
    noneFound: "Nie znaleziono transakcji kandydackiej"
  },
  vat: {
    "23": "23%",
    "8": "8%",
    "5": "5%",
    "0": "0%",
    zw: "Zwolniony (zw)",
    np: "Nie podlega VAT PL (np)"
  },
  ai: {
    title: "Wniosek CloseMate",
    subtitle: "Ze wsparciem AI · Wymagana akceptacja człowieka",
    nicrron: "NICRRON AI",
    rules: "WYJAŚNIENIE REGUŁOWE",
    explain: "Wyjaśnij z AI",
    analyzing: "Analizowanie…",
    listen: "♫ Odsłuchaj",
    listenTitle: "Odczytuje na głos podsumowanie oparte na regułach",
    preparing: "Przygotowywanie głosu…",
    failed: "Analiza nie powiodła się.",
    voiceFailed: "Generowanie głosu nie powiodło się.",
    generic: "Coś poszło nie tak.",
    traceQueued: "ślad PRISM w kolejce",
    traceOff: "PRISM nieskonfigurowany",
    nicrronDone: (trace: string) => `Analiza Nicrron zakończona · ${trace}.`,
    rulesShown: (notice: string, trace: string) => `${notice} · ${trace}.`
  },
  fallback: {
    no_api_key: "Pokazano wyjaśnienie regułowe. Nicrron nie jest skonfigurowany w tym wdrożeniu.",
    rate_limit_unconfigured: "Pokazano wyjaśnienie regułowe. Wyjaśnienia AI są tu wyłączone, dopóki nie zostanie skonfigurowany limit żądań.",
    rate_limited: "Za dużo żądań AI w tej chwili. Pokazano wyjaśnienie regułowe; spróbuj ponownie za chwilę.",
    rate_limit_store_error: "Pokazano wyjaśnienie regułowe. Limiter jest niedostępny, więc wywołanie AI zostało pominięte.",
    provider_error: "Żądanie do Nicrron nie powiodło się. Zamiast tego pokazano wyjaśnienie regułowe.",
    provider_timeout: "Nicrron przekroczył czas oczekiwania. Zamiast tego pokazano wyjaśnienie regułowe.",
    empty_output: "Nicrron nie zwrócił tekstu. Zamiast tego pokazano wyjaśnienie regułowe.",
    guardrail_blocked: "Odpowiedź AI zawierała tezę, której CloseMate nie może potwierdzić, więc pokazano wyjaśnienie regułowe.",
    unknown: "Pokazano wyjaśnienie regułowe."
  },
  review: {
    title: "Decyzja recenzenta",
    savedHere: "Zapisane tylko w tej przeglądarce",
    notSaved: "Niezapisane · pamięć przeglądarki zablokowana",
    loading: "Wczytywanie zapisanych decyzji przeglądu…",
    decision: "Decyzja przeglądu",
    markReviewed: "Oznacz jako sprawdzone",
    needsReview: "Do przeglądu",
    note: "Notatka recenzenta",
    optional: "opcjonalnie",
    placeholder: "np. Poproszono dostawcę o fakturę korygującą",
    unsaved: "Niezapisane zmiany · ⌘/Ctrl + Enter, aby zapisać",
    lastChange: (when: string) => `Ostatnia zmiana ${when}`,
    neverSent: "Nigdy nie jest wysyłane do CloseMate AI, Nicrron ani PRISM",
    save: "Zapisz notatkę",
    undo: (label: string) => `Cofnij: ${label}`,
    keptUntilReload: "zostanie do odświeżenia (pamięć zablokowana)",
    savedInBrowser: "zapisane tylko w tej przeglądarce",
    markedReviewed: "oznaczono jako sprawdzone",
    flagged: "oznaczono do przeglądu",
    decisionCleared: "wyczyszczono decyzję",
    noteSaved: "zapisano notatkę",
    savedNotice: (number: string, parts: string, where: string) => `${number}: ${parts} · ${where}.`,
    partJoin: " + ",
    undoNotice: (number: string) => `Cofnięto ostatnią zmianę przeglądu dla ${number}.`
  },
  human: {
    lead: "Człowiek w pętli",
    body: "CloseMate wyjaśnia i oznacza wyjątki. Nigdy nie inicjuje przelewu ani nie zmienia ksiąg i nie rozstrzyga odliczalności ani zobowiązania podatkowego; potwierdź to u księgowego."
  },
  bottom: {
    observabilityTitle: "Obserwowalność AI",
    observability: "Każde wyjaśnienie i żądanie głosu wysyła ślad bez danych osobowych (identyfikator faktury, wynik, opóźnienie, model), gdy jest skonfigurowany. Bez danych dostawcy, promptów i notatek.",
    routingTitle: "Kierowanie modelu",
    routing: "Jeden endpoint zgodny z OpenAI do dostępu do modelu; reguły zapasowe utrzymują działanie demo.",
    voiceTitle: "Odprawa głosowa",
    voice: "Odsłuchaj regułowe podsumowanie wyjątku, gdy klucz API głosu jest skonfigurowany."
  },
  footer: {
    copyright: "© 2026 CloseMate · Zbudowane na Money Talks 2",
    synthetic: "Syntetyczne dane demo",
    noConnection: "Bez połączenia z bankiem, KSeF ani urzędem skarbowym",
    notAdvice: "To nie jest porada podatkowa",
    run: (count: number) => `Przebieg #${count}`
  },
  notice: {
    dismiss: "Zamknij komunikat"
  },
  api: {
    onlyKnownFields: "Akceptowane są tylko invoiceId, sessionId i locale.",
    invoiceId: "invoiceId musi mieć postać INV-1234.",
    sessionId: "sessionId może zawierać tylko litery, cyfry oraz . _ : - (maks. 120).",
    unknownInvoice: "Nieznana faktura. Analizować można tylko syntetyczne faktury demo.",
    invalidRequest: "Nieprawidłowe żądanie.",
    voiceUnconfigured: "Podsumowania głosowe nie są skonfigurowane w tym wdrożeniu.",
    voiceRateLimited: "Za dużo żądań głosowych. Spróbuj ponownie za chwilę.",
    voiceRateUnconfigured: "Podsumowania głosowe są wyłączone, dopóki nie zostanie skonfigurowany limit żądań.",
    voiceProvider: "Generowanie głosu nie powiodło się u dostawcy.",
    voiceFailed: "Generowanie głosu nie powiodło się."
  }
};

function invoiceWord(count: number): string {
  return polishNoun(count, "faktura", "faktury", "faktur");
}

function recordWord(count: number): string {
  return polishNoun(count, "rekord", "rekordy", "rekordów");
}

function transferWord(count: number): string {
  return polishNoun(count, "przelew", "przelewy", "przelewów");
}

function polishNoun(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(count);
  if (abs === 1) return one;
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function messagesFor(locale: Locale): Messages {
  return locale === "pl" ? pl : en;
}

/** Dot-paths of every string and function leaf, used to prove the dictionaries match. */
export function messagePaths(messages: Messages): string[] {
  const paths: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === "string" || typeof value === "function") {
      paths.push(path);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(messages, "");
  return paths;
}

export function messageAt(messages: Messages, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, messages);
}
