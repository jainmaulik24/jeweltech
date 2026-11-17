import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, ImagePlus, ShieldCheck } from 'lucide-react';

type Language = 'en' | 'kn';
type Role = 'jeweller' | 'karigar';

interface LedgerEntry {
  id: string;
  type: string;
  weightMg: number;
  fineWeightMg: number | null;
  purityPerMille: number | null;
  amountPaise: number;
  status: string;
  createdBy: string;
  createdAt: string;
  acknowledgedAt: string | null;
  agreementVersion: number | null;
  ratePolicy: string | null;
  rateSnapshotPaisePerGram: number | null;
  disputeId: string | null;
  disputeStatus: string | null;
  canDispute: boolean;
  hashVerified: boolean;
}

interface DisputeOption {
  value: string;
  label: Record<Language, string>;
  explanation: Record<Language, string>;
}

interface DisputeDetails {
  id: string;
  orderId: string;
  orderDescription: string;
  jobType: string;
  status: string;
  reason: string;
  createdBy: string | null;
  createdAt: string | null;
  original: {
    id: string;
    type: string;
    weightMg: number;
    fineWeightMg: number | null;
    purityPerMille: number | null;
    amountPaise: number;
    status: string;
    createdBy: string;
    createdAt: string;
    acknowledgedAt: string | null;
    agreementId: string | null;
    agreementVersion: number | null;
    ratePolicy: string | null;
    rateSnapshotPaisePerGram: number | null;
    previousHash: string | null;
    hash: string;
  };
  claimed: { weightMg: number; purityPerMille: number | null; amountPaise: number };
  agreement: null | {
    id: string;
    version: number;
    jobType: string;
    basis: string;
    percentBps: number;
    labourRatePaisePerGram: number;
    effectiveAt: string;
  };
  historicalLossVsAllowance: {
    jobType: string;
    lossMg: number;
    allowanceMg: number;
    completedJobs: number;
  };
  evidence: Array<{
    id: string;
    uploadedBy: string;
    fileName: string;
    mimeType: string;
    sha256: string;
    base64: string;
    createdAt: string;
    verified: boolean;
  }>;
  actions: Array<{
    actorId: string;
    action: string;
    details: Record<string, unknown>;
    createdAt: string;
  }>;
  resolutionOption: string | null;
  resolutionEventId: string | null;
  resolutionAt: string | null;
  resolvedAt: string | null;
  escalatedAt: string | null;
  acknowledgements: { jewellerAt: string | null; karigarAt: string | null };
  resolution: null | {
    id: string;
    weightMg: number;
    fineWeightMg: number | null;
    amountPaise: number;
    status: string;
    createdBy: string;
    createdAt: string;
    notes: string | null;
  };
  carry: null | { unit: 'mg' | 'paise'; signedValue: number; status: string; targetOrderId: string | null; ledgerEventId: string };
  options: DisputeOption[];
  hashVerified: boolean;
}

interface Props {
  orderId: string;
  userId: string;
  role: Role;
  language: Language;
  focusEventId?: string | null;
}

const text = {
  en: {
    title: 'Disputes & verified history',
    intro: 'Challenge a ledger entry without changing its original record.',
    loading: 'Loading ledger history…',
    retry: 'Retry',
    noEntries: 'No ledger entries to review yet.',
    dispute: 'Open a dispute',
    openReview: 'Open review',
    contested: 'Disputed',
    noDispute: 'No dispute',
    verified: 'Hash verified',
    invalid: 'Hash or evidence verification failed',
    contestTitle: 'What differs?',
    reason: 'Reason',
    reasonPlaceholder: 'Explain what should be checked',
    weight: 'Claimed weight (mg)',
    purity: 'Claimed purity (‰)',
    amount: 'Claimed amount (paise)',
    evidence: 'Evidence photo (optional)',
    submit: 'Send dispute',
    cancel: 'Cancel',
    detailsTitle: 'Side-by-side review',
    original: 'Original ledger entry',
    claimed: 'Other reading',
    created: 'Created',
    acknowledged: 'Acknowledged',
    partyAcknowledgements: 'Party acknowledgements',
    jeweller: 'Jeweller',
    karigar: 'Karigar',
    version: 'Agreement version',
    rate: 'Rate snapshot',
    history: 'Historical loss vs allowance',
    completedJobs: 'completed jobs',
    evidenceFiles: 'Evidence',
    actions: 'Timeline',
    options: 'Resolution options',
    choose: 'Select an outcome',
    agreedWeight: 'Agreed re-weighed mg',
    agreedPurity: 'Agreed purity (‰)',
    agreedAmount: 'Agreed amount (paise)',
    resolve: 'Propose outcome',
    escalate: 'Escalate to owner',
    acknowledge: 'Acknowledge outcome',
    pending: 'Waiting for the other party to acknowledge.',
    noAction: 'The other party opened this dispute. Review it and select an outcome.',
    resolved: 'Resolved — original entry remains unchanged.',
    status: 'Status',
    error: 'Could not load dispute data.',
    submitError: 'Could not save this action.',
    simulation: 'SIMULATED evidence and readings',
  },
  kn: {
    title: 'ವಿವಾದಗಳು ಮತ್ತು ಪರಿಶೀಲಿಸಿದ ಇತಿಹಾಸ',
    intro: 'ಮೂಲ ದಾಖಲೆಯನ್ನು ಬದಲಾಯಿಸದೆ ಲೆಡ್ಜರ್ ದಾಖಲೆಯನ್ನು ಪ್ರಶ್ನಿಸಿ.',
    loading: 'ಲೆಡ್ಜರ್ ಇತಿಹಾಸ ಲೋಡ್ ಆಗುತ್ತಿದೆ…',
    retry: 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ',
    noEntries: 'ಪರಿಶೀಲಿಸಲು ಇನ್ನೂ ದಾಖಲೆಗಳಿಲ್ಲ.',
    dispute: 'ವಿವಾದ ದಾಖಲಿಸಿ',
    openReview: 'ಪರಿಶೀಲನೆ ತೆರೆಯಿರಿ',
    contested: 'ವಿವಾದಿತ',
    noDispute: 'ವಿವಾದವಿಲ್ಲ',
    verified: 'ಹ್ಯಾಶ್ ಪರಿಶೀಲಿಸಲಾಗಿದೆ',
    invalid: 'ಹ್ಯಾಶ್ ಅಥವಾ ಸಾಕ್ಷಿ ಪರಿಶೀಲನೆ ವಿಫಲವಾಗಿದೆ',
    contestTitle: 'ಏನು ಭಿನ್ನವಾಗಿದೆ?',
    reason: 'ಕಾರಣ',
    reasonPlaceholder: 'ಏನನ್ನು ಪರಿಶೀಲಿಸಬೇಕು ಎಂದು ಬರೆಯಿರಿ',
    weight: 'ನೀವು ಹೇಳುವ ತೂಕ (ಮಿ.ಗ್ರಾಂ)',
    purity: 'ನೀವು ಹೇಳುವ ಶುದ್ಧತೆ (‰)',
    amount: 'ನೀವು ಹೇಳುವ ಮೊತ್ತ (ಪೈಸೆ)',
    evidence: 'ಸಾಕ್ಷಿ ಚಿತ್ರ (ಐಚ್ಛಿಕ)',
    submit: 'ವಿವಾದ ಕಳುಹಿಸಿ',
    cancel: 'ರದ್ದುಮಾಡಿ',
    detailsTitle: 'ಪಕ್ಕಪಕ್ಕದ ಪರಿಶೀಲನೆ',
    original: 'ಮೂಲ ಲೆಡ್ಜರ್ ದಾಖಲೆ',
    claimed: 'ಇನ್ನೊಂದು ಅಳತೆ',
    created: 'ರಚಿಸಿದ ಸಮಯ',
    acknowledged: 'ಒಪ್ಪಿದ ಸಮಯ',
    partyAcknowledgements: 'ಪಕ್ಷಗಳ ಒಪ್ಪಿಗೆ',
    jeweller: 'ಮಾಲೀಕರು',
    karigar: 'ಕಾರಿಗರು',
    version: 'ಒಪ್ಪಂದ ಆವೃತ್ತಿ',
    rate: 'ದರದ ದಾಖಲಾತಿ',
    history: 'ಹಿಂದಿನ ನಷ್ಟ ಮತ್ತು ಅನುಮತಿ',
    completedJobs: 'ಪೂರ್ಣಗೊಂಡ ಕೆಲಸಗಳು',
    evidenceFiles: 'ಸಾಕ್ಷಿ',
    actions: 'ಕಾಲರೇಖೆ',
    options: 'ಪರಿಹಾರ ಆಯ್ಕೆಗಳು',
    choose: 'ಫಲಿತಾಂಶ ಆಯ್ಕೆಮಾಡಿ',
    agreedWeight: 'ಒಪ್ಪಿದ ಮರುತೂಕ (ಮಿ.ಗ್ರಾಂ)',
    agreedPurity: 'ಒಪ್ಪಿದ ಶುದ್ಧತೆ (‰)',
    agreedAmount: 'ಒಪ್ಪಿದ ಮೊತ್ತ (ಪೈಸೆ)',
    resolve: 'ಫಲಿತಾಂಶ ಪ್ರಸ್ತಾಪಿಸಿ',
    escalate: 'ಮಾಲೀಕರಿಗೆ ಕಳುಹಿಸಿ',
    acknowledge: 'ಫಲಿತಾಂಶ ಒಪ್ಪಿಕೊಳ್ಳಿ',
    pending: 'ಇನ್ನೊಂದು ಪಕ್ಷದ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತಿದೆ.',
    noAction: 'ಇನ್ನೊಂದು ಪಕ್ಷ ವಿವಾದ ತೆರೆದಿದೆ. ಪರಿಶೀಲಿಸಿ ಫಲಿತಾಂಶ ಆಯ್ಕೆಮಾಡಿ.',
    resolved: 'ಪರಿಹರಿಸಲಾಗಿದೆ — ಮೂಲ ದಾಖಲೆ ಬದಲಾಗಿಲ್ಲ.',
    status: 'ಸ್ಥಿತಿ',
    error: 'ವಿವಾದದ ಮಾಹಿತಿ ಲೋಡ್ ಆಗಲಿಲ್ಲ.',
    submitError: 'ಈ ಕ್ರಮವನ್ನು ಉಳಿಸಲಾಗಲಿಲ್ಲ.',
    simulation: 'SIMULATED ಸಾಕ್ಷಿ ಮತ್ತು ಅಳತೆಗಳು',
  },
};

const grams = (mg: number) => `${(mg / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} g`;
const money = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(paise / 100);
const stamp = (value: string | null, language: Language) =>
  value ? new Date(value).toLocaleString(language === 'kn' ? 'kn-IN' : 'en-IN') : '—';

export default function DisputePanel({ orderId, userId, role, language, focusEventId = null }: Props) {
  const labels = text[language];
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [details, setDetails] = useState<DisputeDetails | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null);
  const [reason, setReason] = useState('');
  const [claimedWeightMg, setClaimedWeightMg] = useState('');
  const [claimedPurityPerMille, setClaimedPurityPerMille] = useState('');
  const [claimedAmountPaise, setClaimedAmountPaise] = useState('');
  const [evidence, setEvidence] = useState<Array<{ fileName: string; mimeType: string; base64: string }>>([]);
  const [resolutionOption, setResolutionOption] = useState('apply_agreement');
  const [agreedWeightMg, setAgreedWeightMg] = useState('');
  const [agreedPurityPerMille, setAgreedPurityPerMille] = useState('');
  const [agreedAmountPaise, setAgreedAmountPaise] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const reloadEntries = async () => {
    const response = await fetch(`/api/orders/${orderId}/disputes`, {
      headers: { 'x-user-id': userId },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? labels.error);
    setEntries(result.entries as LedgerEntry[]);
  };

  const loadDetails = useCallback(async (disputeId: string) => {
    const response = await fetch(`/api/disputes/${disputeId}`, {
      headers: { 'x-user-id': userId },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? labels.error);
    setDetails(result as DisputeDetails);
    setSelectedEntry(null);
  }, [labels.error, userId]);

  useEffect(() => {
    if (!focusEventId) return;
    const entry = entries.find((item) => item.id === focusEventId);
    if (!entry) return;
    document.getElementById(`dispute-entry-${entry.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const disputeId = entry.disputeId;
    if (disputeId && details?.id !== disputeId) {
      const timer = window.setTimeout(() => {
        void loadDetails(disputeId).catch((loadError: Error) => setError(loadError.message));
      }, 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [details?.id, entries, focusEventId, loadDetails]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orders/${orderId}/disputes`, { headers: { 'x-user-id': userId } })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? labels.error);
        return result.entries as LedgerEntry[];
      })
      .then((result) => {
        if (!cancelled) {
          setEntries(result);
          setLoaded(true);
          setError('');
        }
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message);
      });
    return () => { cancelled = true; };
  }, [labels.error, orderId, reloadToken, userId]);

  const perform = async (path: string, method: 'POST', body?: unknown) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? labels.submitError);
      if (result.original) {
        setDetails(result as DisputeDetails);
      } else if (result.dispute) {
        setDetails(result.dispute as DisputeDetails);
      } else if (details) {
        await loadDetails(details.id);
      }
      await reloadEntries();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : labels.submitError);
    } finally {
      setBusy(false);
    }
  };

  const chooseEntry = (entry: LedgerEntry) => {
    setSelectedEntry(entry);
    setDetails(null);
    setReason('');
    setEvidence([]);
    setClaimedWeightMg(String(entry.weightMg));
    setClaimedPurityPerMille(entry.purityPerMille === null ? '' : String(entry.purityPerMille));
    setClaimedAmountPaise(String(entry.amountPaise));
  };

  const addEvidence = async (file: File | undefined) => {
    if (!file) return;
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the selected evidence file.'));
      reader.onload = () => {
        const value = String(reader.result);
        resolve(value.substring(value.indexOf(',') + 1));
      };
      reader.readAsDataURL(file);
    });
    setEvidence((current) => [...current, {
      fileName: file.name,
      mimeType: file.type,
      base64,
    }]);
  };

  const submitDispute = async () => {
    if (!selectedEntry) return;
    const body: Record<string, unknown> = {
      reason,
      evidence,
    };
    if (selectedEntry.weightMg !== 0 || selectedEntry.fineWeightMg !== null) {
      body.claimedWeightMg = Number(claimedWeightMg);
      if (claimedPurityPerMille) body.claimedPurityPerMille = Number(claimedPurityPerMille);
    }
    if (selectedEntry.amountPaise !== 0) {
      body.claimedAmountPaise = Number(claimedAmountPaise);
    }
    await perform(`/api/ledger/${selectedEntry.id}/disputes`, 'POST', body);
  };

  const submitResolution = async () => {
    if (!details) return;
    const body: Record<string, unknown> = { option: resolutionOption };
    if (resolutionOption === 'reweigh_together') {
      if (details.original.weightMg !== 0 || details.original.fineWeightMg !== null) {
        body.agreedWeightMg = Number(agreedWeightMg);
        if (agreedPurityPerMille) body.agreedPurityPerMille = Number(agreedPurityPerMille);
      }
      if (details.original.amountPaise !== 0) {
        body.agreedAmountPaise = Number(agreedAmountPaise);
      }
    }
    await perform(`/api/disputes/${details.id}/resolve`, 'POST', body);
  };

  const disputedEntry = (entry: LedgerEntry) => (
    <article
      id={`dispute-entry-${entry.id}`}
      key={entry.id}
      className="min-w-0 rounded-2xl border border-gray-200 bg-white p-3 sm:p-4"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <strong className="break-words text-sm capitalize text-gray-900">{entry.type.replaceAll('_', ' ')}</strong>
          <p className="mt-1 break-words text-sm text-gray-700">
            {entry.weightMg !== 0 || entry.fineWeightMg !== null
              ? `${entry.weightMg.toLocaleString()} mg${entry.purityPerMille === null ? '' : ` · ${entry.purityPerMille}‰`}`
              : money(entry.amountPaise)}
            {entry.agreementVersion ? ` · v${entry.agreementVersion}` : ''}
          </p>
          <p className="mt-1 break-words text-xs text-gray-500">{stamp(entry.createdAt, language)}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-bold ${entry.disputeId ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'}`}>
          {entry.disputeStatus ?? labels.noDispute}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {entry.disputeId ? (
          <button
            onClick={() => void loadDetails(entry.disputeId!).catch((loadError: Error) => setError(loadError.message))}
            className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-bold text-white"
          >
            {labels.openReview}
          </button>
        ) : entry.canDispute ? (
          <button onClick={() => chooseEntry(entry)} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white">
            {labels.dispute}
          </button>
        ) : null}
        {entry.hashVerified && <span className="inline-flex items-center gap-1 self-center text-xs font-bold text-emerald-700"><ShieldCheck size={16} />{labels.verified}</span>}
      </div>
    </article>
  );

  return (
    <section className="min-w-0 space-y-3 rounded-3xl border border-violet-200 bg-violet-50 p-4 shadow-sm sm:p-5" aria-label={labels.title}>
      <div className="min-w-0">
        <h2 className="break-words text-lg font-black text-gray-900">{labels.title}</h2>
        <p className="mt-1 break-words text-sm text-gray-600">{labels.intro}</p>
      </div>
      {error && <p role="alert" className="break-words rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
      {entries.length === 0 && !loaded && !error ? <p className="text-sm text-gray-600">{labels.loading}</p> : null}
      {entries.length === 0 && loaded && !error ? <p className="text-sm text-gray-600">{labels.noEntries}</p> : null}
      {entries.length === 0 && error && (
        <button onClick={() => setReloadToken((current) => current + 1)} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-bold text-white">{labels.retry}</button>
      )}
      {entries.length > 0 && <div className="space-y-2">{entries.map(disputedEntry)}</div>}

      {selectedEntry && (
        <form
          onSubmit={(event) => { event.preventDefault(); void submitDispute(); }}
          className="min-w-0 space-y-3 rounded-2xl border border-amber-200 bg-white p-4"
        >
          <h3 className="break-words font-black text-gray-900">{labels.contestTitle}</h3>
          <label className="block space-y-1 text-sm font-semibold">
            <span>{labels.reason}</span>
            <textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={labels.reasonPlaceholder} className="w-full rounded-lg border border-gray-300 p-2" />
          </label>
          {(selectedEntry.weightMg !== 0 || selectedEntry.fineWeightMg !== null) ? (
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-semibold">
                <span>{labels.weight}</span>
                <input required type="number" min={selectedEntry.type === 'correction' ? undefined : 0} step="1" value={claimedWeightMg} onChange={(event) => setClaimedWeightMg(event.target.value)} className="w-full min-w-0 rounded-lg border border-gray-300 p-2" />
              </label>
              <label className="space-y-1 text-sm font-semibold">
                <span>{labels.purity}</span>
                <input type="number" min="1" max="1000" step="1" value={claimedPurityPerMille} onChange={(event) => setClaimedPurityPerMille(event.target.value)} className="w-full min-w-0 rounded-lg border border-gray-300 p-2" />
              </label>
            </div>
          ) : null}
          {selectedEntry.amountPaise !== 0 && (
            <label className="block space-y-1 text-sm font-semibold">
              <span>{labels.amount}</span>
              <input required type="number" step="1" value={claimedAmountPaise} onChange={(event) => setClaimedAmountPaise(event.target.value)} className="w-full min-w-0 rounded-lg border border-gray-300 p-2" />
            </label>
          )}
          <label className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <ImagePlus size={18} />
            <span>{labels.evidence}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={evidence.length >= 3}
              onChange={(event) => {
                void addEvidence(event.target.files?.[0]).catch((fileError: Error) => setError(fileError.message));
                event.currentTarget.value = '';
              }}
              className="min-w-0 max-w-full text-xs"
            />
          </label>
          {evidence.map((image, index) => <p key={`${image.fileName}-${index}`} className="break-words text-xs text-gray-600">{image.fileName} · SIMULATED</p>)}
          <p className="break-words text-xs text-gray-500">{labels.simulation}</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{labels.submit}</button>
            <button type="button" onClick={() => setSelectedEntry(null)} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-bold">{labels.cancel}</button>
          </div>
        </form>
      )}

      {details && (
        <article id={`dispute-${details.id}`} className="min-w-0 space-y-4 rounded-2xl border border-violet-200 bg-white p-4">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="break-words font-black text-gray-900">{labels.detailsTitle}</h3>
              <p className="mt-1 break-words text-sm text-gray-700">{details.reason}</p>
            </div>
            <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-bold text-violet-900">{labels.status}: {details.status}</span>
          </div>
          <div className={`flex items-start gap-2 rounded-xl p-3 text-sm font-bold ${details.hashVerified ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
            {details.hashVerified ? <ShieldCheck size={18} className="shrink-0" /> : <AlertTriangle size={18} className="shrink-0" />}
            <span className="break-words">{details.hashVerified ? labels.verified : labels.invalid}</span>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <section className="min-w-0 rounded-xl bg-gray-50 p-3">
              <h4 className="break-words text-sm font-black">{labels.original}</h4>
              <p className="mt-2 break-words text-sm">{details.original.weightMg.toLocaleString()} mg · {details.original.purityPerMille ?? '—'}‰</p>
              <p className="break-words text-sm">{money(details.original.amountPaise)}</p>
              <p className="mt-2 break-words text-xs text-gray-600">{labels.created}: {stamp(details.original.createdAt, language)}</p>
              <p className="break-words text-xs text-gray-600">{labels.acknowledged}: {stamp(details.original.acknowledgedAt, language)}</p>
              <p className="break-words text-xs text-gray-600">{labels.version}: {details.original.agreementVersion ?? '—'}</p>
              <p className="break-words text-xs text-gray-600">{labels.rate}: {details.original.ratePolicy ?? '—'} · {details.original.rateSnapshotPaisePerGram ?? '—'} paise/g</p>
            </section>
            <section className="min-w-0 rounded-xl bg-amber-50 p-3">
              <h4 className="break-words text-sm font-black">{labels.claimed}</h4>
              <p className="mt-2 break-words text-sm">{details.claimed.weightMg.toLocaleString()} mg · {details.claimed.purityPerMille ?? '—'}‰</p>
              <p className="break-words text-sm">{money(details.claimed.amountPaise)}</p>
              <p className="mt-2 break-words text-xs text-gray-600">{labels.created}: {stamp(details.createdAt, language)}</p>
              <p className="break-words text-xs text-gray-600">{labels.version}: {details.agreement ? `v${details.agreement.version} · ${details.agreement.basis}` : '—'}</p>
            </section>
          </div>

          <section className="rounded-xl border border-gray-100 p-3">
            <h4 className="break-words text-sm font-black">{labels.history} · {details.historicalLossVsAllowance.jobType}</h4>
            <p className="mt-1 break-words text-sm">{grams(details.historicalLossVsAllowance.lossMg)} loss · {grams(details.historicalLossVsAllowance.allowanceMg)} allowance · {details.historicalLossVsAllowance.completedJobs} {labels.completedJobs}</p>
          </section>

          <section className="rounded-xl border border-gray-100 p-3">
            <h4 className="break-words text-sm font-black">{labels.partyAcknowledgements}</h4>
            <p className="mt-1 break-words text-xs text-gray-600">{labels.jeweller}: {stamp(details.acknowledgements.jewellerAt, language)}</p>
            <p className="break-words text-xs text-gray-600">{labels.karigar}: {stamp(details.acknowledgements.karigarAt, language)}</p>
          </section>

          {details.evidence.length > 0 && (
            <section className="space-y-2 rounded-xl border border-gray-100 p-3">
              <h4 className="break-words text-sm font-black">{labels.evidenceFiles}</h4>
              {details.evidence.map((image) => (
                <div key={image.id} className="flex min-w-0 flex-wrap items-center gap-2">
                  <img src={`data:${image.mimeType};base64,${image.base64}`} alt={image.fileName} className="h-16 w-16 shrink-0 rounded-lg border border-gray-200 object-cover" />
                  <div className="min-w-0">
                    <p className="break-all text-xs font-semibold">{image.fileName}</p>
                    <p className={`break-all text-[10px] ${image.verified ? 'text-emerald-700' : 'text-red-700'}`}>SHA-256 {image.sha256}</p>
                  </div>
                </div>
              ))}
            </section>
          )}

          {details.resolution && (
            <section className="rounded-xl bg-indigo-50 p-3">
              <h4 className="break-words text-sm font-black">{details.resolutionOption?.replaceAll('_', ' ')}</h4>
              <p className="mt-1 break-words text-sm">{details.resolution.weightMg.toLocaleString()} mg · {money(details.resolution.amountPaise)} · {details.resolution.status}</p>
              {details.resolution.notes && <p className="mt-1 break-words text-xs text-gray-700">{details.resolution.notes}</p>}
              {details.resolution.status === 'pending_ack' && details.resolution.createdBy !== userId && (
                <button
                  disabled={busy}
                  onClick={() => void perform(`/api/ledger/${details.resolution!.id}/acknowledge`, 'POST')}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  <CheckCircle size={16} />{labels.acknowledge}
                </button>
              )}
              {details.resolution.status === 'pending_ack' && details.resolution.createdBy === userId && (
                <p className="mt-2 break-words text-xs font-semibold text-gray-700">{labels.pending}</p>
              )}
            </section>
          )}

          {details.carry && (
            <section className="rounded-xl bg-amber-50 p-3">
              <h4 className="break-words text-sm font-black">{details.carry.signedValue} {details.carry.unit} · {details.carry.status}</h4>
              {details.carry.status === 'pending_ack' && (
                <button
                  disabled={busy}
                  onClick={() => void perform(`/api/ledger/${details.carry!.ledgerEventId}/acknowledge`, 'POST')}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  <CheckCircle size={16} />{labels.acknowledge}
                </button>
              )}
            </section>
          )}

          {(details.status === 'unresolved' || details.status === 'escalated') && (
            <section className="space-y-3 rounded-xl border border-gray-100 p-3">
              <h4 className="break-words text-sm font-black">{labels.options}</h4>
              {((details.createdBy !== userId && details.status === 'unresolved') || (role === 'jeweller' && details.status === 'escalated')) ? (
                <>
                  <label className="block space-y-1 text-sm font-semibold">
                    <span>{labels.choose}</span>
                    <select value={resolutionOption} onChange={(event) => setResolutionOption(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2">
                      {details.options.map((option) => <option key={option.value} value={option.value}>{option.label[language]}</option>)}
                    </select>
                  </label>
                  <p className="break-words text-xs text-gray-600">{details.options.find((option) => option.value === resolutionOption)?.explanation[language]}</p>
                  {resolutionOption === 'reweigh_together' && (details.original.weightMg !== 0 || details.original.fineWeightMg !== null) && (
                    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-sm font-semibold"><span>{labels.agreedWeight}</span><input type="number" min={details.original.type === 'correction' ? undefined : 0} step="1" value={agreedWeightMg} onChange={(event) => setAgreedWeightMg(event.target.value)} className="w-full min-w-0 rounded-lg border border-gray-300 p-2" /></label>
                      <label className="space-y-1 text-sm font-semibold"><span>{labels.agreedPurity}</span><input type="number" min="1" max="1000" step="1" value={agreedPurityPerMille} onChange={(event) => setAgreedPurityPerMille(event.target.value)} className="w-full min-w-0 rounded-lg border border-gray-300 p-2" /></label>
                    </div>
                  )}
                  {resolutionOption === 'reweigh_together' && details.original.weightMg === 0 && details.original.fineWeightMg === null && (
                    <label className="block space-y-1 text-sm font-semibold"><span>{labels.agreedAmount}</span><input type="number" step="1" value={agreedAmountPaise} onChange={(event) => setAgreedAmountPaise(event.target.value)} className="w-full min-w-0 rounded-lg border border-gray-300 p-2" /></label>
                  )}
                  {resolutionOption === 'reweigh_together' && details.original.amountPaise !== 0 && (details.original.weightMg !== 0 || details.original.fineWeightMg !== null) && (
                    <label className="block space-y-1 text-sm font-semibold"><span>{labels.agreedAmount}</span><input type="number" step="1" value={agreedAmountPaise} onChange={(event) => setAgreedAmountPaise(event.target.value)} className="w-full min-w-0 rounded-lg border border-gray-300 p-2" /></label>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {resolutionOption === 'escalate_to_human' ? (
                      <button disabled={busy} onClick={() => void submitResolution()} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{labels.escalate}</button>
                    ) : (
                      <button disabled={busy} onClick={() => void submitResolution()} className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{labels.resolve}</button>
                    )}
                    {details.status === 'unresolved' && resolutionOption !== 'escalate_to_human' && (
                      <button disabled={busy} onClick={() => void perform(`/api/disputes/${details.id}/escalate`, 'POST')} className="rounded-lg bg-red-100 px-3 py-2 text-sm font-bold text-red-800 disabled:opacity-50">{labels.escalate}</button>
                    )}
                  </div>
                </>
              ) : (
                <p className="break-words text-sm text-gray-700">{labels.noAction}</p>
              )}
            </section>
          )}
          {details.status === 'resolved' && <p className="break-words rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{labels.resolved}</p>}

          <section className="space-y-2 border-t border-gray-100 pt-3">
            <h4 className="break-words text-sm font-black">{labels.actions}</h4>
            {details.actions.map((action, index) => (
              <p key={`${action.action}-${action.createdAt}-${index}`} className="break-words text-xs text-gray-600">
                {stamp(action.createdAt, language)} · {action.actorId} · {action.action.replaceAll('_', ' ')}
              </p>
            ))}
          </section>
        </article>
      )}
    </section>
  );
}
