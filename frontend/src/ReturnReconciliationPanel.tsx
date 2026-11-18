import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';

type Language = 'en' | 'kn';
type PurityMethod = 'touch' | 'XRF' | 'declared';

interface ReturnLotForm {
  weightGrams: string;
  stoneWeightGrams: string;
  otherNonGoldWeightGrams: string;
  purityPerMille: string;
  method: PurityMethod;
}

interface ScrapLotForm {
  weightGrams: string;
  stoneWeightGrams: string;
  otherNonGoldWeightGrams: string;
  purityPerMille: string;
}

interface ReturnConfiguration {
  issuedLots: Array<{ weightMg: number; purityPerMille: number }>;
  agreement: { basis: string; percentLabel: string; version: number };
  scenario: {
    label: string;
    finishedLots: Array<{
      weightGrams: string;
      purityPerMille: number;
      method: PurityMethod;
      stoneWeightGrams?: string;
      otherNonGoldWeightGrams?: string;
    }>;
    scrapLots: Array<{
      weightGrams: string;
      purityPerMille: number;
      stoneWeightGrams?: string;
      otherNonGoldWeightGrams?: string;
    }>;
  } | null;
  configuration: {
    grossWeightToleranceMg: number;
    idealReturnFactorBp: number;
    bufferBp: number;
    idealReturnPurityPerMille: number;
    simulatedRatePaisePerGram: number;
    targetWeightMg: number;
    targetToleranceMg: number;
    perPiecePayPaise: { buffing: number; cutting: number; polish: number };
    unusedAllowancePolicy: 'karigar_keeps' | 'return_to_jeweller';
    purityReadLabel: string;
    purities: Array<{ perMille: number; label: string }>;
  };
}

interface ReconciliationResult {
  grossIssuedMg: number;
  fineIssuedMg: number;
  grossFinishedMg: number;
  netGoldFinishedMg: number;
  fineFinishedMg: number;
  grossScrapMg: number;
  fineScrapMg: number;
  processLossFineMg: number;
  allowanceFineMg: number;
  owedFineMg: number;
  excessFineMg: number;
  unusedAllowanceFineMg: number;
  unusedAllowancePolicy: 'karigar_keeps' | 'return_to_jeweller';
  idealMg: number | null;
  minAcceptableMg: number | null;
  idealReturnStatus: 'AT_OR_ABOVE_IDEAL' | 'WITHIN_BUFFER' | 'SHORT' | null;
  retainedGoldMg: number;
  retainedGoldValuePaise: number;
  shortFineMg: number;
  targetWeightMg: number | null;
  targetWeightDeviationMg: number | null;
  targetWeightFlagged: boolean;
  targetWeightPriceImpactPaise: number | null;
  perPiecePayPaise: number;
  fairPayPaise: number;
  status: 'WITHIN_ALLOWANCE' | 'KARIGAR_OWES' | 'PURITY_SHORTFALL' | 'EXCESS_REVIEW';
  explanation: { en: string; kn: string };
}

interface ReconciliationResponse {
  result: ReconciliationResult;
  agreementRule: string;
  settlementDraft: { id: string; notes: string; status: string } | null;
  events: Array<{ id: string; type: string }>;
}

interface Props {
  orderId: string;
  userId: string;
  language: Language;
  onSubmitted: () => void;
}

const text = {
  en: {
    title: 'Return reconciliation',
    intro: 'Record each finished lot and its purity reading. All purity readings are SIMULATED.',
    finished: 'Finished lots',
    scrap: 'Scrap / sweepings (optional)',
    weight: 'Weight (g)',
    purity: 'Purity',
    method: 'Reading method',
    touch: 'Touch',
    xrf: 'XRF',
    declared: 'Declared',
    addFinished: 'Add finished lot',
    addScrap: 'Add scrap lot',
    remove: 'Remove',
    reconcile: 'Calculate and propose',
    agreement: 'Issue is pinned to',
    tolerance: 'Gross-weight tolerance',
    targetFlag: 'Target-weight flag',
    targetImpact: 'SIMULATED price impact',
    idealStatus: 'Ideal-return result',
    retained: 'Karigar keeps',
    fairPay: 'Fair-pay total',
    stone: 'Stone (g)',
    otherNonGold: 'Other non-gold (g)',
    buffing: 'Buffing pieces',
    cutting: 'Cutting pieces',
    polish: 'Polish pieces',
    unused: 'Unused allowance',
    policy: 'Default: karigar keeps (UNCONFIRMED)',
    waterfall: 'Fine-gold waterfall',
    issued: 'Fine gold issued',
    finishedFine: 'Finished',
    scrapFine: 'Scrap',
    loss: 'Process loss',
    allowance: 'Allowance',
    processLoss: 'Process loss is posted to its ledger account once approved.',
    settlement: 'Settlement draft',
    pending: 'Awaiting the other party’s approval; nothing is finalized.',
    loading: 'Loading return details…',
    error: 'Could not load return details',
    submitError: 'Could not calculate return.',
    noAgreement: 'No issue agreement is available.',
  },
  kn: {
    title: 'ಮರಳಿಸಿದ ಚಿನ್ನದ ಹೊಂದಾಣಿಕೆ',
    intro: 'ಪ್ರತಿ ತಯಾರಾದ ಲಾಟ್ ಮತ್ತು ಅದರ ಶುದ್ಧತೆ ದಾಖಲಿಸಿ. ಎಲ್ಲಾ ಶುದ್ಧತೆ ಓದುಗಳು SIMULATED.',
    finished: 'ತಯಾರಾದ ಲಾಟ್‌ಗಳು',
    scrap: 'ಸ್ಕ್ರಾಪ್ / ಸವೆತದ ಪುಡಿ (ಐಚ್ಛಿಕ)',
    weight: 'ತೂಕ (ಗ್ರಾಂ)',
    purity: 'ಶುದ್ಧತೆ',
    method: 'ಓದುವ ವಿಧಾನ',
    touch: 'ಟಚ್',
    xrf: 'XRF',
    declared: 'ಘೋಷಿತ',
    addFinished: 'ತಯಾರಾದ ಲಾಟ್ ಸೇರಿಸಿ',
    addScrap: 'ಸ್ಕ್ರಾಪ್ ಲಾಟ್ ಸೇರಿಸಿ',
    remove: 'ತೆಗೆದುಹಾಕಿ',
    reconcile: 'ಲೆಕ್ಕಿಸಿ ಮತ್ತು ಪ್ರಸ್ತಾಪಿಸಿ',
    agreement: 'ನೀಡಿದ ಚಿನ್ನಕ್ಕೆ ಅನ್ವಯಿಸುವುದು',
    tolerance: 'ಒಟ್ಟು ತೂಕದ ಸಹಿಷ್ಣುತೆ',
    targetFlag: 'ಗುರಿ ತೂಕದ ಸೂಚನೆ',
    targetImpact: 'SIMULATED ಬೆಲೆ ಪರಿಣಾಮ',
    idealStatus: 'ಆದರ್ಶ ಮರಳಿಕೆ ಫಲಿತಾಂಶ',
    retained: 'ಕಾರಿಗರರು ಉಳಿಸಿಕೊಳ್ಳುವುದು',
    fairPay: 'ನ್ಯಾಯಯುತ ಕೂಲಿ ಒಟ್ಟು',
    stone: 'ಕಲ್ಲು (ಗ್ರಾಂ)',
    otherNonGold: 'ಇತರೆ ಚಿನ್ನವಲ್ಲದದ್ದು (ಗ್ರಾಂ)',
    buffing: 'ಬಫಿಂಗ್ ತುಣುಕುಗಳು',
    cutting: 'ಕಟಿಂಗ್ ತುಣುಕುಗಳು',
    polish: 'ಪಾಲಿಶ್ ತುಣುಕುಗಳು',
    unused: 'ಬಳಸದ ಮಿತಿ',
    policy: 'ಪೂರ್ವನಿಯೋಜಿತ: ಕಾರಿಗರರ ಬಳಿ (UNCONFIRMED)',
    waterfall: 'ಶುದ್ಧ ಚಿನ್ನದ ಹಂತಗಳು',
    issued: 'ನೀಡಿದ ಶುದ್ಧ ಚಿನ್ನ',
    finishedFine: 'ತಯಾರಾದದ್ದು',
    scrapFine: 'ಸ್ಕ್ರಾಪ್',
    loss: 'ಪ್ರಕ್ರಿಯೆ ನಷ್ಟ',
    allowance: 'ಮಿತಿ',
    processLoss: 'ಅನುಮೋದನೆಯ ನಂತರ ಪ್ರಕ್ರಿಯೆ ನಷ್ಟವನ್ನು ಲೆಡ್ಜರ್ ಖಾತೆಗೆ ದಾಖಲಿಸಲಾಗುತ್ತದೆ.',
    settlement: 'ಸೆಟಲ್ಮೆಂಟ್ ಕರಡು',
    pending: 'ಇನ್ನೊಂದು ಪಕ್ಷದ ಅನುಮೋದನೆಗೆ ಕಾಯುತ್ತಿದೆ; ಯಾವುದೂ ಅಂತಿಮವಾಗಿಲ್ಲ.',
    loading: 'ಮರಳಿಸುವಿಕೆಯ ವಿವರಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ…',
    error: 'ಮರಳಿಸುವಿಕೆಯ ವಿವರಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ',
    submitError: 'ಮರಳಿಸುವಿಕೆಯನ್ನು ಲೆಕ್ಕಿಸಲು ಆಗಲಿಲ್ಲ.',
    noAgreement: 'ನೀಡಿದ ಚಿನ್ನಕ್ಕೆ ಒಪ್ಪಂದ ಲಭ್ಯವಿಲ್ಲ.',
  },
};

function blankFinishedLot(purityPerMille = '916'): ReturnLotForm {
  return { weightGrams: '', stoneWeightGrams: '0', otherNonGoldWeightGrams: '0', purityPerMille, method: 'touch' };
}

function blankScrapLot(purityPerMille = '916'): ScrapLotForm {
  return { weightGrams: '', stoneWeightGrams: '0', otherNonGoldWeightGrams: '0', purityPerMille };
}

const money = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(paise / 100);

export default function ReturnReconciliationPanel({ orderId, userId, language, onSubmitted }: Props) {
  const labels = text[language];
  const [configuration, setConfiguration] = useState<ReturnConfiguration | null>(null);
  const [finishedLots, setFinishedLots] = useState<ReturnLotForm[]>([blankFinishedLot()]);
  const [scrapLots, setScrapLots] = useState<ScrapLotForm[]>([blankScrapLot()]);
  const [result, setResult] = useState<ReconciliationResponse | null>(null);
  const [error, setError] = useState('');
  const [loadedOrderId, setLoadedOrderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pieceCounts, setPieceCounts] = useState({ buffing: 0, cutting: 0, polish: 0 });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orders/${orderId}/returns/config`, { headers: { 'x-user-id': userId } })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? labels.error);
        return data as ReturnConfiguration;
      })
      .then((data) => {
        if (cancelled) return;
        setConfiguration(data);
        setLoadedOrderId(orderId);
        setError('');
        setResult(null);
        setPieceCounts({ buffing: 0, cutting: 0, polish: 0 });
        const sampleFinished = data.scenario?.finishedLots;
        const sampleScrap = data.scenario?.scrapLots;
        setFinishedLots(sampleFinished?.length
          ? sampleFinished.map((lot) => ({
            weightGrams: lot.weightGrams,
            stoneWeightGrams: lot.stoneWeightGrams ?? '0',
            otherNonGoldWeightGrams: lot.otherNonGoldWeightGrams ?? '0',
            purityPerMille: String(lot.purityPerMille),
            method: lot.method,
          }))
          : [blankFinishedLot(String(data.issuedLots[0]?.purityPerMille ?? 916))]);
        setScrapLots(sampleScrap?.length
          ? sampleScrap.map((lot) => ({
            weightGrams: lot.weightGrams,
            stoneWeightGrams: lot.stoneWeightGrams ?? '0',
            otherNonGoldWeightGrams: lot.otherNonGoldWeightGrams ?? '0',
            purityPerMille: String(lot.purityPerMille),
          }))
          : [blankScrapLot(String(data.issuedLots[0]?.purityPerMille ?? 916))]);
      })
      .catch((loadError: Error) => {
        if (!cancelled) {
          setConfiguration(null);
          setLoadedOrderId(orderId);
          setError(loadError.message);
        }
      });
    return () => { cancelled = true; };
  }, [labels.error, orderId, userId]);

  const updateFinishedLot = (index: number, patch: Partial<ReturnLotForm>) => {
    setFinishedLots((current) => current.map((lot, lotIndex) => (
      lotIndex === index ? { ...lot, ...patch } : lot
    )));
  };

  const updateScrapLot = (index: number, patch: Partial<ScrapLotForm>) => {
    setScrapLots((current) => current.map((lot, lotIndex) => (
      lotIndex === index ? { ...lot, ...patch } : lot
    )));
  };

  const updatePieceCount = (kind: keyof typeof pieceCounts, value: string) => {
    const count = Number(value);
    setPieceCounts((current) => ({ ...current, [kind]: Number.isInteger(count) && count >= 0 ? count : 0 }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/orders/${orderId}/returns/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          finishedLots: finishedLots.map((lot) => ({
            weightGrams: lot.weightGrams,
            stoneWeightGrams: lot.stoneWeightGrams,
            otherNonGoldWeightGrams: lot.otherNonGoldWeightGrams,
            purityPerMille: Number(lot.purityPerMille),
            method: lot.method,
          })),
          scrapLots: scrapLots
            .filter((lot) => lot.weightGrams.trim() !== '')
            .map((lot) => ({
              weightGrams: lot.weightGrams,
              stoneWeightGrams: lot.stoneWeightGrams,
              otherNonGoldWeightGrams: lot.otherNonGoldWeightGrams,
              purityPerMille: Number(lot.purityPerMille),
            })),
          pieceCounts,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? labels.submitError);
      setResult(data as ReconciliationResponse);
      onSubmitted();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : labels.submitError);
    } finally {
      setSaving(false);
    }
  };

  if (loadedOrderId !== orderId) {
    return <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm" aria-live="polite">{labels.loading}</section>;
  }
  if (!configuration) {
    return <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm"><p role="alert" className="font-semibold text-red-700">{error || labels.noAgreement}</p></section>;
  }

  const statusLabels: Record<ReconciliationResult['status'], string> = {
    WITHIN_ALLOWANCE: language === 'en' ? 'Within allowance' : 'ಮಿತಿಯೊಳಗೆ',
    KARIGAR_OWES: language === 'en' ? 'Karigar owes fine gold' : 'ಕಾರಿಗರರು ಶುದ್ಧ ಚಿನ್ನ ನೀಡಬೇಕು',
    PURITY_SHORTFALL: language === 'en' ? 'Purity shortfall detected' : 'ಶುದ್ಧತೆ ಕೊರತೆ ಪತ್ತೆಯಾಗಿದೆ',
    EXCESS_REVIEW: language === 'en' ? 'Excess return · review' : 'ಹೆಚ್ಚುವರಿ ಮರಳಿಕೆ · ಪರಿಶೀಲಿಸಿ',
  };
  const statusStyle = result?.result.status === 'PURITY_SHORTFALL' || result?.result.status === 'KARIGAR_OWES'
    ? 'border-red-300 bg-red-50 text-red-900'
    : result?.result.status === 'EXCESS_REVIEW'
      ? 'border-amber-300 bg-amber-50 text-amber-900'
      : 'border-green-300 bg-green-50 text-green-900';
  const idealStatusLabel = result?.result.idealReturnStatus === 'SHORT'
    ? 'SHORT'
    : result?.result.idealReturnStatus === 'WITHIN_BUFFER'
      ? 'WITHIN_BUFFER'
      : result?.result.idealReturnStatus === 'AT_OR_ABOVE_IDEAL'
        ? 'AT_OR_ABOVE_IDEAL'
        : null;

  return (
    <section className="min-w-0 space-y-4 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="min-w-0">
        <h2 className="break-words text-xl font-black text-gray-900">{labels.title}</h2>
        <p className="mt-1 break-words text-sm text-gray-600">{labels.intro}</p>
        <p className="mt-2 break-words rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
          {labels.agreement} v{configuration.agreement.version}: {configuration.agreement.basis === 'ideal_return_buffer'
            ? `${configuration.configuration.idealReturnFactorBp} bp ideal · ${configuration.configuration.bufferBp} bp buffer`
            : `${configuration.agreement.percentLabel} ${configuration.agreement.basis.replaceAll('_', ' ')}`} · {labels.tolerance}: {configuration.configuration.grossWeightToleranceMg.toLocaleString()} mg · Target {configuration.configuration.targetWeightMg.toLocaleString()} ± {configuration.configuration.targetToleranceMg.toLocaleString()} mg
        </p>
        <p className="mt-1 break-words text-xs font-semibold text-amber-800">{labels.unused}: {labels.policy}</p>
      </div>

      {error && <p role="alert" className="break-words rounded-xl bg-red-50 p-3 font-semibold text-red-800">{error}</p>}

      <form onSubmit={submit} className="min-w-0 space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-black text-gray-900">{labels.finished}</h3>
            <button type="button" onClick={() => setFinishedLots((current) => [...current, blankFinishedLot()])} className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-sm font-bold text-gray-800">
              <Plus size={16} /> {labels.addFinished}
            </button>
          </div>
          {finishedLots.map((lot, index) => (
            <div key={`finished-${index}`} className="grid min-w-0 grid-cols-2 gap-2 rounded-xl border bg-gray-50 p-3 sm:grid-cols-6">
              <label className="min-w-0 text-xs font-semibold">{labels.weight}
                <input required min="0" step="0.001" inputMode="decimal" value={lot.weightGrams} onChange={(event) => updateFinishedLot(index, { weightGrams: event.target.value })} className="mt-1 w-full min-w-0 rounded-lg border p-2 text-sm" />
              </label>
              <label className="min-w-0 text-xs font-semibold">{labels.stone}
                <input required min="0" step="0.001" inputMode="decimal" value={lot.stoneWeightGrams} onChange={(event) => updateFinishedLot(index, { stoneWeightGrams: event.target.value })} className="mt-1 w-full min-w-0 rounded-lg border p-2 text-sm" />
              </label>
              <label className="min-w-0 text-xs font-semibold">{labels.otherNonGold}
                <input required min="0" step="0.001" inputMode="decimal" value={lot.otherNonGoldWeightGrams} onChange={(event) => updateFinishedLot(index, { otherNonGoldWeightGrams: event.target.value })} className="mt-1 w-full min-w-0 rounded-lg border p-2 text-sm" />
              </label>
              <label className="min-w-0 text-xs font-semibold">{labels.purity}
                <select required value={lot.purityPerMille} onChange={(event) => updateFinishedLot(index, { purityPerMille: event.target.value })} className="mt-1 w-full min-w-0 rounded-lg border p-2 text-sm">
                  {configuration.configuration.purities.map((purity) => <option key={purity.perMille} value={purity.perMille}>{purity.label} · {purity.perMille}‰</option>)}
                </select>
              </label>
              <label className="min-w-0 text-xs font-semibold">{labels.method}
                <select value={lot.method} onChange={(event) => updateFinishedLot(index, { method: event.target.value as PurityMethod })} className="mt-1 w-full min-w-0 rounded-lg border p-2 text-sm">
                  <option value="touch">{labels.touch}</option>
                  <option value="XRF">{labels.xrf}</option>
                  <option value="declared">{labels.declared}</option>
                </select>
              </label>
              <button type="button" disabled={finishedLots.length === 1} onClick={() => setFinishedLots((current) => current.filter((_, lotIndex) => lotIndex !== index))} className="self-end rounded-lg px-2 py-2 text-xs font-bold text-red-700 disabled:opacity-40">
                <Trash2 className="mr-1 inline" size={14} />{labels.remove}
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-black text-gray-900">{labels.scrap}</h3>
            <button type="button" onClick={() => setScrapLots((current) => [...current, blankScrapLot()])} className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-sm font-bold text-gray-800">
              <Plus size={16} /> {labels.addScrap}
            </button>
          </div>
          {scrapLots.map((lot, index) => (
            <div key={`scrap-${index}`} className="grid min-w-0 grid-cols-2 gap-2 rounded-xl border bg-gray-50 p-3 sm:grid-cols-4">
              <label className="min-w-0 text-xs font-semibold">{labels.weight}
                <input min="0" step="0.001" inputMode="decimal" value={lot.weightGrams} onChange={(event) => updateScrapLot(index, { weightGrams: event.target.value })} className="mt-1 w-full min-w-0 rounded-lg border p-2 text-sm" />
              </label>
              <label className="min-w-0 text-xs font-semibold">{labels.stone}
                <input required min="0" step="0.001" inputMode="decimal" value={lot.stoneWeightGrams} onChange={(event) => updateScrapLot(index, { stoneWeightGrams: event.target.value })} className="mt-1 w-full min-w-0 rounded-lg border p-2 text-sm" />
              </label>
              <label className="min-w-0 text-xs font-semibold">{labels.otherNonGold}
                <input required min="0" step="0.001" inputMode="decimal" value={lot.otherNonGoldWeightGrams} onChange={(event) => updateScrapLot(index, { otherNonGoldWeightGrams: event.target.value })} className="mt-1 w-full min-w-0 rounded-lg border p-2 text-sm" />
              </label>
              <label className="min-w-0 text-xs font-semibold">{labels.purity}
                <select value={lot.purityPerMille} onChange={(event) => updateScrapLot(index, { purityPerMille: event.target.value })} className="mt-1 w-full min-w-0 rounded-lg border p-2 text-sm">
                  {configuration.configuration.purities.map((purity) => <option key={purity.perMille} value={purity.perMille}>{purity.label} · {purity.perMille}‰</option>)}
                </select>
              </label>
              <button type="button" disabled={scrapLots.length === 1} onClick={() => setScrapLots((current) => current.filter((_, lotIndex) => lotIndex !== index))} className="col-span-2 justify-self-start rounded-lg px-2 py-1 text-xs font-bold text-red-700 disabled:opacity-40">
                <Trash2 className="mr-1 inline" size={14} />{labels.remove}
              </button>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-xl bg-gray-50 p-3">
          {([
            ['buffing', labels.buffing],
            ['cutting', labels.cutting],
            ['polish', labels.polish],
          ] as const).map(([kind, label]) => (
            <label key={kind} className="min-w-0 text-xs font-semibold">{label}
              <input type="number" min="0" step="1" value={pieceCounts[kind]} onChange={(event) => updatePieceCount(kind, event.target.value)} className="mt-1 w-full min-w-0 rounded-lg border p-2 text-sm" />
            </label>
          ))}
        </div>

        <button type="submit" disabled={saving} className="w-full rounded-xl bg-indigo-700 px-4 py-3 font-bold text-white disabled:opacity-60">
          {saving ? '…' : labels.reconcile}
        </button>
      </form>

      {result && (
        <div aria-live="polite" className="min-w-0 space-y-3">
          <div className={`min-w-0 rounded-2xl border p-4 ${statusStyle}`}>
            <h3 className="break-words font-black">{statusLabels[result.result.status]}</h3>
            {idealStatusLabel && <p className="mt-1 font-black">{labels.idealStatus}: {idealStatusLabel}</p>}
            <p className="mt-2 break-words font-semibold">{result.result.explanation[language]}</p>
          </div>

          {result.result.targetWeightFlagged && (
            <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-red-950">
              <h3 className="font-black">{labels.targetFlag}</h3>
              <p>{result.result.targetWeightDeviationMg! < 0 ? 'Under' : 'Over'} target by {Math.abs(result.result.targetWeightDeviationMg!).toLocaleString()} mg · {labels.targetImpact}: {money(Math.abs(result.result.targetWeightPriceImpactPaise!))} {result.result.targetWeightPriceImpactPaise! < 0 ? 'below' : 'above'} target · SIMULATED</p>
            </div>
          )}

          {result.result.idealReturnStatus === 'WITHIN_BUFFER' && (
            <div className="rounded-2xl border border-green-300 bg-green-50 p-4 text-green-950">
              <p className="font-semibold">{labels.retained}: {result.result.retainedGoldMg.toLocaleString()} mg · SIMULATED value {money(result.result.retainedGoldValuePaise)}</p>
            </div>
          )}
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-950">
            <p className="font-black">{labels.fairPay}: {money(result.result.fairPayPaise)}</p>
            <p className="text-sm">Per-piece pay: {money(result.result.perPiecePayPaise)} · SIMULATED gold rate: {money(configuration.configuration.simulatedRatePaisePerGram)}/g</p>
          </div>

          <div className="min-w-0 rounded-2xl border p-4">
            <h3 className="mb-3 font-black text-gray-900">{labels.waterfall} · mg</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                [labels.issued, result.result.fineIssuedMg],
                [labels.finishedFine, result.result.fineFinishedMg],
                [labels.scrapFine, result.result.fineScrapMg],
                [labels.loss, result.result.processLossFineMg],
              ].map(([label, amount]) => (
                <div key={label} className="min-w-0 rounded-xl bg-gray-50 p-3">
                  <p className="break-words text-xs text-gray-600">{label}</p>
                  <strong className="block break-words text-sm">{Number(amount).toLocaleString()} mg</strong>
                </div>
              ))}
            </div>
            <p className="mt-2 break-words rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              {labels.allowance}: {result.result.allowanceFineMg.toLocaleString()} mg · {labels.unused}: {result.result.unusedAllowanceFineMg.toLocaleString()} mg
            </p>
            <p className="mt-2 break-words text-xs text-gray-600">{labels.processLoss}</p>
          </div>

          {result.settlementDraft && (
            <div className="min-w-0 rounded-2xl border border-amber-300 bg-amber-50 p-4">
              <h3 className="font-black text-amber-950">{labels.settlement}</h3>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-amber-900">{result.settlementDraft.notes}</p>
              <p className="mt-2 break-words text-xs font-bold text-amber-900">{labels.pending}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
