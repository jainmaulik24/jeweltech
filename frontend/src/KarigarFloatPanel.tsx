import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

type Role = 'jeweller' | 'karigar';
type Language = 'en' | 'kn';

interface ExposureData {
  exposureMg: number;
  exposurePaise: number;
  cleanReturnCount: number;
  trustTier: { id: string; label: string; floatLimitMg: number };
  risk: {
    level: 'steady' | 'watch' | 'high';
    reasons: string[];
    recommendedActions: Array<{ code: string; label: string }>;
  };
}

interface SyntheticReplayDay {
  day: number;
  date: string;
  exposureMg: number;
  valuePaise: number;
  riskLevel: 'steady' | 'watch' | 'high';
}

interface OwnerApproval {
  id: string;
  karigarName: string;
  makerName: string;
  description: string | null;
  weightMg: number;
  reason: string;
}

interface FloatSummary {
  id: string;
  floatId?: string;
  jewellerId: string;
  jewellerName?: string;
  karigarId?: string;
  karigarName?: string;
  remainingMg: number;
  availableMg: number;
  pendingDrawdownMg?: number;
  targetMg: number;
  settlementThresholdMg: number;
  pendingSettlementDraft?: {
    id: string;
    remainingMg: number;
    topUpSuggestionMg: number;
  } | null;
}

interface KarigarHomeData {
  floatRemainingMg: number;
  floats: FloatSummary[];
  openJobs: Array<{
    id: string;
    description: string;
    jewellerName: string;
    goldInWorkMg: number;
    dueInDays: number;
  }>;
  amountsOwed: Array<{
    id: string;
    jewellerName: string;
    amountPaise: number;
    daysWaiting: number;
    overdueDays: number;
  }>;
  pendingAcknowledgements: Array<{
    id: string;
    orderId: string;
    description: string;
    type: string;
    notes: string | null;
    amount: number;
    weightMg: number;
  }>;
}

interface JewellerFloatData {
  karigars: Array<{
    karigarId: string;
    karigarName: string;
    floatId: string | null;
    remainingMg: number;
    availableMg: number;
    targetMg: number;
    settlementThresholdMg: number;
    pendingSettlementDraft: {
      id: string;
      remainingMg: number;
      topUpSuggestionMg: number;
    } | null;
    exposure: ExposureData | null;
  }>;
  configuration: {
    defaultPurityPerMille: number;
    trustTiers: Array<{ id: string; label: string; minCleanReturns: number; floatLimitMg: number }>;
    staffLargeIssueMg: number;
  };
  pendingOwnerApprovals: OwnerApproval[];
  syntheticReplay: {
    label: 'SYNTHETIC';
    name: string;
    days: SyntheticReplayDay[];
    firstFlag: SyntheticReplayDay;
    atLoss: SyntheticReplayDay;
  };
}

const labels = {
  en: {
    homeTitle: 'Gold with your jewellers',
    floats: 'Gold float',
    remaining: 'Remaining',
    available: 'Available for work',
    openJobs: 'Open jobs',
    amountOwed: 'Money owed to you',
    daysWaiting: 'days waiting',
    overdue: 'days overdue',
    pending: 'Please check these entries',
    acknowledge: 'OK — I agree',
    noFloats: 'No gold float has been issued yet.',
    noJobs: 'No open jobs.',
    noDues: 'No unpaid amounts.',
    noPending: 'Nothing is waiting for your approval.',
    jewellerTitle: 'Karigar gold floats',
    issueTo: 'Issue 24K gold to',
    weight: 'Weight in grams',
    issue: 'Issue to float',
    createDraft: 'Prepare settlement draft',
    draftCreated: 'Settlement draft is waiting for both sides to review.',
    issueCreated: 'Float issue is waiting for the karigar to acknowledge.',
    selectKarigar: 'Choose a karigar',
    loading: 'Loading…',
    error: 'Could not load float information.',
    threshold: 'Settlement reminder below',
    target: 'Suggested float size',
    validation: 'Enter a positive weight in grams with up to 3 decimal places and choose a karigar.',
    topUp: 'Suggested top-up',
    ownerApprovalNeeded: 'This issue is waiting for owner approval.',
    exposure: 'Gold exposure warning',
    exposureSteady: 'No early warning signals.',
    exposureWatch: 'Please review this exposure soon.',
    exposureHigh: 'Please carefully review this exposure.',
    exposureDisclaimer: 'Recommendations only; these signals never block an issue.',
    goldOutstanding: 'Gold outstanding',
    trustTier: 'Trust tier',
    cleanReturns: 'Clean returns',
    floatLimit: 'Float limit',
    recommendedActions: 'Suggested actions',
    pendingOwnerApprovals: 'Owner approval needed',
    requestedBy: 'Requested by',
    approve: 'Approve issue',
    reject: 'Reject',
    approvalSaved: 'Owner decision saved.',
    syntheticReplay: 'Synthetic 90-day replay',
    replayDay: 'Replay day',
    firstFlag: 'First warning',
    atLoss: 'At synthetic loss',
    day: 'Day',
    date: 'Date',
    value: 'Estimated value',
  },
  kn: {
    homeTitle: 'ಮಾಲೀಕರ ಬಳಿಯ ಚಿನ್ನ',
    floats: 'ಚಿನ್ನದ ಫ್ಲೋಟ್',
    remaining: 'ಉಳಿದಿದೆ',
    available: 'ಕೆಲಸಕ್ಕೆ ಲಭ್ಯ',
    openJobs: 'ತೆರೆದ ಕೆಲಸಗಳು',
    amountOwed: 'ನಿಮಗೆ ಬರಬೇಕಾದ ಹಣ',
    daysWaiting: 'ದಿನಗಳಿಂದ ಕಾಯುತ್ತಿದೆ',
    overdue: 'ದಿನ ಬಾಕಿ',
    pending: 'ಈ ದಾಖಲೆಯನ್ನು ಪರಿಶೀಲಿಸಿ',
    acknowledge: 'ಸರಿ — ಒಪ್ಪುತ್ತೇನೆ',
    noFloats: 'ಇನ್ನೂ ಚಿನ್ನದ ಫ್ಲೋಟ್ ನೀಡಿಲ್ಲ.',
    noJobs: 'ತೆರೆದ ಕೆಲಸಗಳಿಲ್ಲ.',
    noDues: 'ಪಾವತಿಗೆ ಬಾಕಿ ಇಲ್ಲ.',
    noPending: 'ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಏನೂ ಬಾಕಿ ಇಲ್ಲ.',
    jewellerTitle: 'ಕಾರಿಗರರ ಚಿನ್ನದ ಫ್ಲೋಟ್‌ಗಳು',
    issueTo: '24K ಚಿನ್ನ ನೀಡಿ',
    weight: 'ಗ್ರಾಂನಲ್ಲಿ ತೂಕ',
    issue: 'ಫ್ಲೋಟ್‌ಗೆ ನೀಡಿ',
    createDraft: 'ಸೆಟಲ್ಮೆಂಟ್ ಕರಡು ತಯಾರಿಸಿ',
    draftCreated: 'ಎರಡೂ ಪಕ್ಷಗಳ ಪರಿಶೀಲನೆಗೆ ಕರಡು ಕಾಯುತ್ತಿದೆ.',
    issueCreated: 'ಕಾರಿಗರರ ಒಪ್ಪಿಗೆಗೆ ಫ್ಲೋಟ್ ದಾಖಲೆ ಕಾಯುತ್ತಿದೆ.',
    selectKarigar: 'ಕಾರಿಗರನ್ನು ಆಯ್ಕೆಮಾಡಿ',
    loading: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…',
    error: 'ಫ್ಲೋಟ್ ಮಾಹಿತಿ ಲೋಡ್ ಆಗಲಿಲ್ಲ.',
    threshold: 'ಇದಕ್ಕಿಂತ ಕಡಿಮೆ ಇದ್ದರೆ ಸೆಟಲ್ಮೆಂಟ್',
    target: 'ಶಿಫಾರಸು ಮಾಡಿದ ಫ್ಲೋಟ್ ಗಾತ್ರ',
    validation: 'ಮೂರು ದಶಮಾಂಶ ಸ್ಥಾನಗಳವರೆಗೆ ತೂಕ ನಮೂದಿಸಿ ಮತ್ತು ಕಾರಿಗರನ್ನು ಆಯ್ಕೆಮಾಡಿ.',
    topUp: 'ಶಿಫಾರಸು ಮಾಡಿದ ಹೆಚ್ಚುವರಿ ಚಿನ್ನ',
    ownerApprovalNeeded: 'ಈ ನೀಡುವಿಕೆಗೆ ಮಾಲೀಕರ ಅನುಮೋದನೆ ಬೇಕಾಗಿದೆ.',
    exposure: 'ಚಿನ್ನದ ಮುನ್ನೆಚ್ಚರಿಕೆ',
    exposureSteady: 'ಮುನ್ನೆಚ್ಚರಿಕೆ ಸೂಚನೆಗಳಿಲ್ಲ.',
    exposureWatch: 'ಈ ಚಿನ್ನದ ಲೆಕ್ಕವನ್ನು ಶೀಘ್ರ ಪರಿಶೀಲಿಸಿ.',
    exposureHigh: 'ಈ ಚಿನ್ನದ ಲೆಕ್ಕವನ್ನು ಜಾಗರೂಕತೆಯಿಂದ ಪರಿಶೀಲಿಸಿ.',
    exposureDisclaimer: 'ಇವು ಶಿಫಾರಸುಗಳು ಮಾತ್ರ; ಯಾವುದೇ ನೀಡುವಿಕೆಯನ್ನು ತಡೆಯುವುದಿಲ್ಲ.',
    goldOutstanding: 'ಬಾಕಿ ಚಿನ್ನ',
    trustTier: 'ನಂಬಿಕೆಯ ಹಂತ',
    cleanReturns: 'ಸರಿಯಾಗಿ ಹಿಂದಿರುಗಿಸಿದ ಕೆಲಸಗಳು',
    floatLimit: 'ಫ್ಲೋಟ್ ಮಿತಿ',
    recommendedActions: 'ಶಿಫಾರಸು ಮಾಡಿದ ಕ್ರಮಗಳು',
    pendingOwnerApprovals: 'ಮಾಲೀಕರ ಅನುಮೋದನೆ ಬೇಕು',
    requestedBy: 'ಕೋರಿದವರು',
    approve: 'ನೀಡಲು ಅನುಮೋದಿಸಿ',
    reject: 'ತಿರಸ್ಕರಿಸಿ',
    approvalSaved: 'ಮಾಲೀಕರ ನಿರ್ಧಾರ ದಾಖಲಿಸಲಾಗಿದೆ.',
    syntheticReplay: 'ಕಲ್ಪಿತ 90 ದಿನಗಳ ಮರುಚಲಾವಣೆ',
    replayDay: 'ಮರುಚಲಾವಣೆ ದಿನ',
    firstFlag: 'ಮೊದಲ ಎಚ್ಚರಿಕೆ',
    atLoss: 'ಕಲ್ಪಿತ ನಷ್ಟದ ಸಮಯದಲ್ಲಿ',
    day: 'ದಿನ',
    date: 'ದಿನಾಂಕ',
    value: 'ಅಂದಾಜು ಮೌಲ್ಯ',
  },
} as const;

const grams = (milligrams: number) => `${new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
}).format(milligrams / 1000)} g`;

const money = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(paise / 100);

function parseGramsToMg(input: string): number | null {
  const match = input.trim().match(/^(\d+)(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const wholeMg = Number(match[1]) * 1000;
  const fractionMg = Number((match[2] ?? '').padEnd(3, '0'));
  const result = wholeMg + fractionMg;
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

interface Props {
  userId: string;
  role: Role;
  language: Language;
  onSelectOrder?: (orderId: string) => void;
}

export default function KarigarFloatPanel({ userId, role, language, onSelectOrder }: Props) {
  const text = labels[language];
  const [karigarHome, setKarigarHome] = useState<KarigarHomeData | null>(null);
  const [jewellerData, setJewellerData] = useState<JewellerFloatData | null>(null);
  const [selectedKarigarId, setSelectedKarigarId] = useState('');
  const [weightGrams, setWeightGrams] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [replayDay, setReplayDay] = useState(0);

  const load = useCallback(async () => {
    const path = role === 'karigar' ? '/api/karigar/home' : '/api/karigar-floats';
    const response = await fetch(path, { headers: { 'x-user-id': userId } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? text.error);
    if (role === 'karigar') {
      setKarigarHome(result as KarigarHomeData);
    } else {
      const data = result as JewellerFloatData;
      setJewellerData(data);
      setSelectedKarigarId((current) => current || data.karigars[0]?.karigarId || '');
    }
    setError('');
  }, [role, text.error, userId]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        await load();
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : text.error);
      }
    };
    void refresh();
    const intervalId = window.setInterval(() => { void refresh(); }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [load, refreshKey, text.error]);

  const post = async (path: string, body: unknown, successMessage: string): Promise<boolean> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? text.error);
      if (result.approvalRequired) {
        setNotice(`${text.ownerApprovalNeeded} ${result.reason ?? ''}`.trim());
        setRefreshKey((current) => current + 1);
        return true;
      }
      const topUpSuggestionMg = result.topUpSuggestionMg
        ?? result.floatSettlementDraft?.topUpSuggestionMg;
      setNotice(typeof topUpSuggestionMg === 'number'
        ? `${successMessage} ${text.topUp}: ${grams(topUpSuggestionMg)}.`
        : successMessage);
      setRefreshKey((current) => current + 1);
      return true;
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : text.error);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const issueFloat = async (event: FormEvent) => {
    event.preventDefault();
    const weightMg = parseGramsToMg(weightGrams);
    if (!selectedKarigarId || !weightMg || !jewellerData) {
      setError(text.validation);
      return;
    }
    const posted = await post('/api/ledger/event', {
      type: 'issue',
      karigarId: selectedKarigarId,
      weightMg,
      purityPerMille: jewellerData.configuration.defaultPurityPerMille,
      idempotencyKey: crypto.randomUUID(),
    }, text.issueCreated);
    if (posted) setWeightGrams('');
  };

  const acknowledge = (eventId: string) => post(
    `/api/ledger/${eventId}/acknowledge`,
    {},
    'Acknowledged.',
  );

  const reviewOwnerApproval = async (approvalId: string, action: 'approve' | 'reject') => {
    const successMessage = action === 'approve' ? text.approvalSaved : text.approvalSaved;
    await post(
      `/api/owner-issue-approvals/${approvalId}/${action}`,
      {},
      successMessage,
    );
  };

  if (role === 'karigar') {
    if (!karigarHome && !error) {
      return <section className="rounded-3xl bg-white p-4 shadow-sm">{text.loading}</section>;
    }
    return (
      <section className="space-y-4 rounded-3xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Karigar home">
        <h2 className="text-xl font-black text-gray-900">{text.homeTitle}</h2>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>}
        {karigarHome && (
          <>
            <section className="space-y-3 rounded-2xl bg-amber-50 p-4">
              <h3 className="font-black text-amber-950">{text.floats}</h3>
              <p className="text-3xl font-black text-amber-700">{grams(karigarHome.floatRemainingMg)}</p>
              {karigarHome.floats.length === 0 ? <p className="text-sm">{text.noFloats}</p> : (
                karigarHome.floats.map((float) => (
                  <div key={float.id} className="rounded-xl bg-white p-3">
                    <p className="font-bold">{float.jewellerName}</p>
                    <p>{text.remaining}: {grams(float.remainingMg)}</p>
                    <p className="text-sm text-gray-600">{text.available}: {grams(float.availableMg)}</p>
                  </div>
                ))
              )}
            </section>

            <section className="space-y-2">
              <h3 className="font-black text-gray-900">{text.openJobs}</h3>
              {karigarHome.openJobs.length === 0 ? <p className="text-sm text-gray-600">{text.noJobs}</p> : (
                karigarHome.openJobs.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => onSelectOrder?.(job.id)}
                    className="w-full rounded-xl border border-gray-200 p-3 text-left"
                  >
                    <strong className="block">{job.description}</strong>
                    <span className="text-sm text-gray-600">
                      {job.jewellerName} · {grams(job.goldInWorkMg)} · {job.dueInDays < 0 ? `${Math.abs(job.dueInDays)} days overdue` : `${job.dueInDays} days to due`}
                    </span>
                  </button>
                ))
              )}
            </section>

            <section className="space-y-2">
              <h3 className="font-black text-gray-900">{text.amountOwed}</h3>
              {karigarHome.amountsOwed.length === 0 ? <p className="text-sm text-gray-600">{text.noDues}</p> : (
                karigarHome.amountsOwed.map((due) => (
                  <div key={due.id} className="flex flex-wrap justify-between gap-2 rounded-xl bg-emerald-50 p-3">
                    <span>{due.jewellerName} · {due.daysWaiting} {text.daysWaiting}{due.overdueDays > 0 ? ` · ${due.overdueDays} ${text.overdue}` : ''}</span>
                    <strong>{money(due.amountPaise)}</strong>
                  </div>
                ))
              )}
            </section>

            <section className="space-y-2">
              <h3 className="font-black text-gray-900">{text.pending}</h3>
              {karigarHome.pendingAcknowledgements.length === 0 ? <p className="text-sm text-gray-600">{text.noPending}</p> : (
                karigarHome.pendingAcknowledgements.map((item) => (
                  <article key={item.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <strong>{item.description || item.type.replaceAll('_', ' ')}</strong>
                    {item.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{item.notes}</p>}
                    <p className="text-sm">{item.weightMg > 0 ? grams(item.weightMg) : money(item.amount)}</p>
                    <button
                      disabled={busy}
                      onClick={() => void acknowledge(item.id)}
                      className="mt-2 w-full rounded-xl bg-green-600 py-3 font-black text-white disabled:opacity-50"
                    >
                      {text.acknowledge}
                    </button>
                  </article>
                ))
              )}
            </section>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Karigar floats">
      <div>
        <h2 className="text-lg font-black text-gray-900">{text.jewellerTitle}</h2>
        <p className="text-sm text-gray-600">Integer milligrams · balances from acknowledged ledger events</p>
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-900">{notice}</p>}
      {jewellerData && (
        <section className="space-y-3 rounded-2xl border-2 border-indigo-300 bg-indigo-50 p-3">
          <div>
            <h3 className="font-black text-indigo-950">{text.exposure}</h3>
            <p className="text-xs font-semibold text-indigo-900">{text.exposureDisclaimer}</p>
          </div>
          {jewellerData.karigars.filter((karigar) => karigar.exposure).map((karigar) => {
            const exposure = karigar.exposure!;
            return (
              <article key={karigar.karigarId} className="rounded-xl bg-white p-3">
                <h4 className="font-black">{karigar.karigarName} · {text[`exposure${exposure.risk.level[0].toUpperCase()}${exposure.risk.level.slice(1)}` as 'exposureSteady' | 'exposureWatch' | 'exposureHigh']}</h4>
                <p className="mt-1 text-sm font-semibold">
                  {text.goldOutstanding}: {grams(exposure.exposureMg)} · {money(exposure.exposurePaise)} (SIMULATED)
                </p>
                <p className="text-sm">
                  {text.trustTier}: {exposure.trustTier.label} · {text.cleanReturns}: {exposure.cleanReturnCount} · {text.floatLimit}: {grams(exposure.trustTier.floatLimitMg)}
                </p>
                {exposure.risk.reasons.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                    {exposure.risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                )}
                {exposure.risk.recommendedActions.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm font-bold text-indigo-900">
                    {exposure.risk.recommendedActions.map((action) => <li key={action.code}>{action.label}</li>)}
                  </ul>
                )}
              </article>
            );
          })}
        </section>
      )}
      {jewellerData && (
        <>
          <form onSubmit={issueFloat} className="space-y-3 rounded-2xl bg-gray-50 p-3">
            <label className="block text-sm font-bold">
              {text.issueTo}
              <select
                value={selectedKarigarId}
                onChange={(event) => setSelectedKarigarId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-3"
                required
              >
                {jewellerData.karigars.map((karigar) => (
                  <option key={karigar.karigarId} value={karigar.karigarId}>{karigar.karigarName}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold">
              {text.weight}
              <input
                value={weightGrams}
                onChange={(event) => setWeightGrams(event.target.value)}
                inputMode="decimal"
                pattern="[0-9]+([.][0-9]{1,3})?"
                placeholder="100.000"
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-3"
                required
              />
            </label>
            <button disabled={busy || jewellerData.karigars.length === 0} className="w-full rounded-xl bg-amber-600 py-3 font-black text-white disabled:opacity-50">
              {text.issue}
            </button>
          </form>

          <div className="space-y-2">
            {jewellerData.karigars.map((karigar) => (
              <article key={karigar.karigarId} className="rounded-xl border border-gray-200 p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{karigar.karigarName}</strong>
                  <strong>{grams(karigar.remainingMg)}</strong>
                </div>
                <p className="text-sm text-gray-600">
                  {text.available}: {grams(karigar.availableMg)} · {text.target}: {grams(karigar.targetMg)} · {text.threshold}: {grams(karigar.settlementThresholdMg)}
                </p>
                {karigar.pendingSettlementDraft && (
                  <p className="mt-2 rounded-lg bg-indigo-50 p-2 text-sm font-semibold text-indigo-900">
                    Settlement draft awaiting approval · {text.topUp}: {grams(karigar.pendingSettlementDraft.topUpSuggestionMg)}
                  </p>
                )}
                {karigar.floatId && (
                  <button
                    disabled={busy}
                    onClick={() => void post(
                      `/api/karigar-floats/${karigar.floatId}/settlement-drafts`,
                      {},
                      text.draftCreated,
                    )}
                    className="mt-2 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {text.createDraft}
                  </button>
                )}
              </article>
            ))}
          </div>
          {jewellerData.pendingOwnerApprovals.length > 0 && (
            <section className="space-y-2 rounded-2xl border-2 border-amber-500 bg-amber-50 p-3">
              <h3 className="font-black text-amber-950">{text.pendingOwnerApprovals}</h3>
              {jewellerData.pendingOwnerApprovals.map((approval) => (
                <article key={approval.id} className="rounded-xl bg-white p-3">
                  <p className="font-bold">{approval.karigarName} · {approval.description ?? text.issue}</p>
                  <p className="text-sm">{grams(approval.weightMg)} · {text.requestedBy} {approval.makerName}</p>
                  <p className="mt-1 text-sm">{approval.reason}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void reviewOwnerApproval(approval.id, 'approve')}
                      className="min-h-11 flex-1 rounded-lg bg-green-700 px-3 font-bold text-white disabled:opacity-50"
                    >
                      {text.approve}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void reviewOwnerApproval(approval.id, 'reject')}
                      className="min-h-11 rounded-lg border border-red-700 px-3 font-bold text-red-800 disabled:opacity-50"
                    >
                      {text.reject}
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}
          {jewellerData.syntheticReplay && (
            <SyntheticExposureReplay
              replay={jewellerData.syntheticReplay}
              day={Math.min(replayDay, jewellerData.syntheticReplay.days.length - 1)}
              onDayChange={setReplayDay}
              text={text}
            />
          )}
        </>
      )}
    </section>
  );
}

function SyntheticExposureReplay({
  replay,
  day,
  onDayChange,
  text,
}: {
  replay: JewellerFloatData['syntheticReplay'];
  day: number;
  onDayChange: (day: number) => void;
  text: (typeof labels)[Language];
}) {
  const current = replay.days[day];
  if (!current) return null;
  return (
    <section className="space-y-2 rounded-2xl border-2 border-gray-800 bg-white p-3">
      <h3 className="font-black">{text.syntheticReplay}</h3>
      <p className="text-sm font-bold uppercase text-red-800">{replay.label} · {replay.name}</p>
      <label className="block text-sm font-bold">
        {text.replayDay}: {text.day} {current.day}
        <input
          type="range"
          min={0}
          max={replay.days.length - 1}
          value={day}
          onChange={(event) => onDayChange(Number(event.target.value))}
          className="mt-2 min-h-11 w-full accent-indigo-700"
          aria-label={text.replayDay}
        />
      </label>
      <p className="text-sm">{text.date}: {current.date.slice(0, 10)}</p>
      <p className="text-lg font-black">
        {text.goldOutstanding}: {grams(current.exposureMg)} · {money(current.valuePaise)} (SIMULATED)
      </p>
      <div className="rounded-lg bg-amber-50 p-2 text-sm">
        <p><strong>{text.firstFlag}:</strong> {text.day} {replay.firstFlag.day} · {money(replay.firstFlag.valuePaise)}</p>
        <p><strong>{text.atLoss}:</strong> {text.day} {replay.atLoss.day} · {money(replay.atLoss.valuePaise)}</p>
      </div>
    </section>
  );
}
