import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle, Volume2 } from 'lucide-react';

type Language = 'en' | 'kn';
type Role = 'jeweller' | 'karigar';

interface Agreement {
  id: string;
  jobType: string;
  basis: string;
  percentBps: number;
  labourRatePaisePerGram: number;
  sweepOwner: string;
  karigarSweepShareBps: number;
  cashRatePolicy: string;
  version: number;
  status: 'draft' | 'accepted';
  summary?: string;
}

interface AgreementData {
  agreements: Agreement[];
  activeAgreement: Agreement | null;
  latestIssue?: { agreementId: string | null; agreementVersion: number | null };
  configuration: {
    jobTypes: Array<{ value: string; label: string }>;
    bases: Array<{ value: string; label: string }>;
  };
}

interface AnalysisData {
  allowanceComparison: Array<{ basis: string; label: string; allowanceMg: number }>;
  fairPay: {
    labourPaisePerFinishedGram: number;
    allowanceValuePaisePerFinishedGram: number;
    sweepValuePaisePerFinishedGram: number;
    effectiveRatePaisePerFinishedGram: number;
    outlier: boolean;
    version: number;
    syntheticReferenceRangePaisePerGram: { min: number; max: number };
  } | null;
  ratePolicyAmountsPaise: { issue: number; return: number; settlement: number };
  simulatedRatesPaisePerGram: { issue: number; return: number; settlement: number };
  benchmarkLabel: string;
  rateLabel: string;
  sample: {
    issuedGrossMg: number;
    issuedPurityPerMille: number;
    finishedWeightMg: number;
  };
}

interface Props {
  orderId: string;
  userId: string;
  role: Role;
  language: Language;
}

const text = {
  en: {
    title: 'Wastage agreement',
    draft: 'Draft a new version',
    basis: 'Wastage basis',
    percent: 'Wastage %',
    labour: 'Labour (Rs/g)',
    job: 'Job type',
    sweepOwner: 'Sweepings owner',
    karigar: 'Karigar',
    jeweller: 'Jeweller',
    split: 'Split',
    share: 'Karigar sweep share %',
    ratePolicy: 'Cash rate date',
    save: 'Send version for handshake',
    pending: 'Awaiting your handshake',
    accept: 'I heard and accept this version',
    history: 'Version history',
    active: 'In force',
    fairPay: 'Fair-pay card',
    perFinishedGram: 'Effective per finished gram',
    synthetic: 'SYNTHETIC reference range',
    outlier: 'Outside reference range',
    within: 'Within reference range',
    allowance: 'Allowance by basis',
    policies: 'Cash amount by rate policy',
    simulated: 'SIMULATED rates',
    read: 'Read agreement aloud',
    loading: 'Loading agreement details…',
    error: 'Could not load agreement data',
    saved: 'Agreement version sent for karigar acknowledgement.',
    accepted: 'Agreement accepted and recorded.',
  },
  kn: {
    title: 'ವ್ಯರ್ಥದ ಒಪ್ಪಂದ',
    draft: 'ಹೊಸ ಆವೃತ್ತಿ ರಚಿಸಿ',
    basis: 'ವ್ಯರ್ಥದ ಆಧಾರ',
    percent: 'ವ್ಯರ್ಥ %',
    labour: 'ಕೆಲಸದ ಕೂಲಿ (ರೂ/ಗ್ರಾಂ)',
    job: 'ಕೆಲಸದ ವಿಧ',
    sweepOwner: 'ಸವೆತದ ಪುಡಿಯ ಮಾಲೀಕ',
    karigar: 'ಕಾರಿಗರ',
    jeweller: 'ಅಂಗಡಿ ಮಾಲೀಕ',
    split: 'ಹಂಚಿಕೆ',
    share: 'ಕಾರಿಗರನ ಸವೆತದ ಪುಡಿ ಪಾಲು %',
    ratePolicy: 'ನಗದು ದರದ ದಿನ',
    save: 'ಒಪ್ಪಿಗೆಗಾಗಿ ಕಳುಹಿಸಿ',
    pending: 'ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತಿದೆ',
    accept: 'ಕೇಳಿದೆ ಮತ್ತು ಒಪ್ಪುತ್ತೇನೆ',
    history: 'ಆವೃತ್ತಿ ಇತಿಹಾಸ',
    active: 'ಜಾರಿಯಲ್ಲಿದೆ',
    fairPay: 'ನ್ಯಾಯಯುತ ಕೂಲಿ',
    perFinishedGram: 'ತಯಾರಾದ ಪ್ರತಿ ಗ್ರಾಂಗೆ',
    synthetic: 'SYNTHETIC ಉಲ್ಲೇಖ ಮಿತಿ',
    outlier: 'ಉಲ್ಲೇಖ ಮಿತಿಯ ಹೊರಗೆ',
    within: 'ಉಲ್ಲೇಖ ಮಿತಿಯೊಳಗೆ',
    allowance: 'ಆಧಾರದ ಪ್ರಕಾರದ ವ್ಯರ್ಥ',
    policies: 'ದರ ನೀತಿಯ ಪ್ರಕಾರ ನಗದು ಮೊತ್ತ',
    simulated: 'SIMULATED ದರಗಳು',
    read: 'ಒಪ್ಪಂದವನ್ನು ಓದಿ ಕೇಳಿಸಿ',
    loading: 'ಒಪ್ಪಂದದ ವಿವರಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ…',
    error: 'ಒಪ್ಪಂದದ ವಿವರಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ',
    saved: 'ಒಪ್ಪಂದದ ಆವೃತ್ತಿಯನ್ನು ಕಾರಿಗರರ ಒಪ್ಪಿಗೆಗೆ ಕಳುಹಿಸಲಾಗಿದೆ.',
    accepted: 'ಒಪ್ಪಂದವನ್ನು ಒಪ್ಪಿ ದಾಖಲಿಸಲಾಗಿದೆ.',
  },
};

const money = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(paise / 100);

async function fetchAgreementData(orderId: string, userId: string, language: Language, errorLabel: string) {
  const headers = { 'x-user-id': userId };
  const [agreementResponse, analysisResponse] = await Promise.all([
    fetch(`/api/orders/${orderId}/agreements?lang=${language}`, { headers }),
    fetch(`/api/orders/${orderId}/agreement-analysis`, { headers }),
  ]);
  if (!agreementResponse.ok || !analysisResponse.ok) {
    const failedResponse = !agreementResponse.ok ? agreementResponse : analysisResponse;
    const body = await failedResponse.json();
    throw new Error(body.error ?? errorLabel);
  }
  const [agreementData, analysisData] = await Promise.all([
    agreementResponse.json() as Promise<AgreementData>,
    analysisResponse.json() as Promise<AnalysisData>,
  ]);
  return { agreementData, analysisData };
}

export default function AgreementPanel({ orderId, userId, role, language }: Props) {
  const labels = text[language];
  const [agreements, setAgreements] = useState<AgreementData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [jobType, setJobType] = useState('plain');
  const [basis, setBasis] = useState('fine_issued');
  const [wastagePercent, setWastagePercent] = useState('2.50');
  const [labourRateRupees, setLabourRateRupees] = useState('40.00');
  const [sweepOwner, setSweepOwner] = useState('karigar');
  const [karigarSweepPercent, setKarigarSweepPercent] = useState('50');
  const [cashRatePolicy, setCashRatePolicy] = useState('settlement');

  const applyData = useCallback((agreementData: AgreementData, analysisData: AnalysisData) => {
    setAgreements(agreementData);
    setAnalysis(analysisData);
    const active = agreementData.activeAgreement;
    if (active) {
      setJobType(active.jobType);
      setBasis(active.basis);
      setWastagePercent((active.percentBps / 100).toFixed(2));
      setLabourRateRupees((active.labourRatePaisePerGram / 100).toFixed(2));
      setSweepOwner(active.sweepOwner);
      setKarigarSweepPercent((active.karigarSweepShareBps / 100).toFixed(0));
      setCashRatePolicy(active.cashRatePolicy);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAgreementData(orderId, userId, language, labels.error)
      .then(({ agreementData, analysisData }) => {
        if (!cancelled) applyData(agreementData, analysisData);
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message);
      });
    return () => { cancelled = true; };
  }, [applyData, labels.error, language, orderId, userId]);

  const load = useCallback(async () => {
    setError('');
    const { agreementData, analysisData } = await fetchAgreementData(orderId, userId, language, labels.error);
    applyData(agreementData, analysisData);
  }, [applyData, labels.error, language, orderId, userId]);

  const activeId = agreements?.activeAgreement?.id;
  const pendingAgreement = useMemo(
    () => agreements?.agreements.find((agreement) => agreement.status === 'draft'),
    [agreements],
  );

  const speakSummary = (summary: string) => {
    if (!('speechSynthesis' in window)) {
      setError('Speech synthesis is not available in this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(summary);
    utterance.lang = language === 'kn' ? 'kn-IN' : 'en-IN';
    window.speechSynthesis.speak(utterance);
  };

  const submitDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/orders/${orderId}/agreements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({
          jobType,
          basis,
          wastagePercent,
          labourRateRupees,
          sweepOwner,
          karigarSweepPercent: sweepOwner === 'karigar' ? '100' : sweepOwner === 'jeweller' ? '0' : karigarSweepPercent,
          cashRatePolicy,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Could not create agreement version.');
        return;
      }
      setNotice(labels.saved);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not create agreement version.');
    }
  };

  const acceptAgreement = async (agreement: Agreement) => {
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/orders/${orderId}/agreements/${agreement.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Could not accept agreement.');
        return;
      }
      setNotice(labels.accepted);
      await load();
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : 'Could not accept agreement.');
    }
  };

  if (!agreements || !analysis) {
    return (
      <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm" aria-live="polite">
        {error ? <p className="font-semibold text-red-700">{labels.error}: {error}</p> : <p>{labels.loading}</p>}
      </section>
    );
  }

  const basisLabel = (value: string) => agreements.configuration.bases.find((item) => item.value === value)?.label ?? value;
  const jobLabel = (value: string) => agreements.configuration.jobTypes.find((item) => item.value === value)?.label ?? value;

  return (
    <section className="min-w-0 space-y-4 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="min-w-0">
        <h2 className="text-xl font-black text-gray-900">{labels.title}</h2>
        <p className="mt-1 break-words text-sm text-gray-500">
          Plain bangles · {analysis.sample.issuedGrossMg / 1000} g issued · {analysis.sample.issuedPurityPerMille}‰ purity · {analysis.sample.finishedWeightMg / 1000} g finished · sample values
        </p>
      </div>

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 font-semibold text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-green-50 p-3 font-semibold text-green-800">{notice}</p>}

      {pendingAgreement && role === 'karigar' && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4">
          <p className="mb-2 text-sm font-bold uppercase tracking-wide text-amber-900">{labels.pending} · v{pendingAgreement.version}</p>
          <p className="break-words text-lg font-semibold text-gray-900">{pendingAgreement.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => speakSummary(pendingAgreement.summary ?? '')} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 font-bold text-gray-900 ring-1 ring-gray-300">
              <Volume2 size={18} /> {labels.read}
            </button>
            <button onClick={() => acceptAgreement(pendingAgreement)} className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-4 py-3 font-bold text-white">
              <CheckCircle size={18} /> {labels.accept}
            </button>
          </div>
        </div>
      )}

      {role === 'jeweller' && (
        <form onSubmit={submitDraft} className="grid gap-3 rounded-2xl bg-gray-50 p-4 sm:grid-cols-2">
          <h3 className="sm:col-span-2 font-black text-gray-900">{labels.draft}</h3>
          <label className="text-sm font-semibold">{labels.job}
            <select value={jobType} onChange={(event) => setJobType(event.target.value)} className="mt-1 w-full rounded-lg border p-2">
              {agreements.configuration.jobTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">{labels.basis}
            <select value={basis} onChange={(event) => setBasis(event.target.value)} className="mt-1 w-full rounded-lg border p-2">
              {agreements.configuration.bases.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">{labels.percent}
            <input value={wastagePercent} onChange={(event) => setWastagePercent(event.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border p-2" required />
          </label>
          <label className="text-sm font-semibold">{labels.labour}
            <input value={labourRateRupees} onChange={(event) => setLabourRateRupees(event.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border p-2" required />
          </label>
          <label className="text-sm font-semibold">{labels.sweepOwner}
            <select value={sweepOwner} onChange={(event) => setSweepOwner(event.target.value)} className="mt-1 w-full rounded-lg border p-2">
              <option value="karigar">{labels.karigar}</option>
              <option value="jeweller">{labels.jeweller}</option>
              <option value="split">{labels.split}</option>
            </select>
          </label>
          {sweepOwner === 'split' && (
            <label className="text-sm font-semibold">{labels.share}
              <input value={karigarSweepPercent} onChange={(event) => setKarigarSweepPercent(event.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border p-2" required />
            </label>
          )}
          <label className="text-sm font-semibold">{labels.ratePolicy}
            <select value={cashRatePolicy} onChange={(event) => setCashRatePolicy(event.target.value)} className="mt-1 w-full rounded-lg border p-2">
              <option value="issue">Issue date</option>
              <option value="return">Return date</option>
              <option value="settlement">Settlement date</option>
            </select>
          </label>
          <button type="submit" className="rounded-xl bg-gray-900 px-4 py-3 font-bold text-white sm:col-span-2">{labels.save}</button>
        </form>
      )}

      <div>
        <h3 className="mb-2 font-black text-gray-900">{labels.history}</h3>
        {agreements.latestIssue?.agreementVersion && (
          <p className="mb-2 rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-900">
            Past issue remains pinned to agreement v{agreements.latestIssue.agreementVersion}; later versions do not change it.
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {agreements.agreements.map((agreement) => (
            <article key={agreement.id} className={`rounded-xl border p-3 ${agreement.id === activeId ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
              <div className="mb-1 flex min-w-0 flex-wrap justify-between gap-2">
                <strong className="min-w-0 break-words">v{agreement.version} · {jobLabel(agreement.jobType)}</strong>
                <span className="shrink-0 text-xs font-bold uppercase">{agreement.id === activeId ? labels.active : agreement.status}</span>
              </div>
              <p className="break-words text-sm">{agreement.summary}</p>
              <p className="mt-1 break-words text-xs text-gray-600">{basisLabel(agreement.basis)} · {agreement.cashRatePolicy} date</p>
            </article>
          ))}
        </div>
      </div>

      {analysis.fairPay && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-black text-indigo-950">{labels.fairPay} · v{analysis.fairPay.version}</h3>
              <p className="text-sm text-indigo-800">{labels.perFinishedGram}</p>
            </div>
            <p className="text-2xl font-black text-indigo-950">{money(analysis.fairPay.effectiveRatePaisePerFinishedGram)}/g</p>
          </div>
          <div className="mt-3 grid gap-2 text-center text-xs sm:grid-cols-3">
            <p className="rounded-lg bg-white p-2">Labour<br /><strong>{money(analysis.fairPay.labourPaisePerFinishedGram)}</strong></p>
            <p className="rounded-lg bg-white p-2">Allowance<br /><strong>{money(analysis.fairPay.allowanceValuePaisePerFinishedGram)}</strong></p>
            <p className="break-words rounded-lg bg-white p-2">Estimated sweep share<br /><strong>{money(analysis.fairPay.sweepValuePaisePerFinishedGram)}</strong></p>
          </div>
          <p className="mt-3 text-sm font-bold text-indigo-900">
            {labels.synthetic}: {money(analysis.fairPay.syntheticReferenceRangePaisePerGram.min)}–{money(analysis.fairPay.syntheticReferenceRangePaisePerGram.max)}/g · {analysis.fairPay.outlier ? labels.outlier : labels.within}
          </p>
        </div>
      )}

      <div className="grid gap-3">
        <div className="rounded-xl border p-3">
          <h3 className="mb-2 font-black">{labels.allowance}</h3>
          {analysis.allowanceComparison.map((item) => (
            <p key={item.basis} className="flex min-w-0 flex-wrap justify-between gap-2 border-t py-2 text-sm">
              <span className="min-w-0 break-words">{item.label}</span><strong className="shrink-0">{item.allowanceMg.toLocaleString()} mg</strong>
            </p>
          ))}
        </div>
        <div className="rounded-xl border p-3">
          <h3 className="mb-2 font-black">{labels.policies}</h3>
          <div className="grid gap-2 text-center sm:grid-cols-3">
            {(['issue', 'return', 'settlement'] as const).map((policy) => (
              <div key={policy} className="rounded-lg border bg-gray-50 p-2">
                <p className="text-xs font-semibold capitalize">{policy} date</p>
                <strong className="block whitespace-nowrap text-sm">{money(analysis.ratePolicyAmountsPaise[policy])}</strong>
                <span className="text-[10px] text-gray-600">{money(analysis.simulatedRatesPaisePerGram[policy])}/g</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs font-bold text-amber-800">{labels.simulated}: {money(analysis.simulatedRatesPaisePerGram.issue)}/g issue · {money(analysis.simulatedRatesPaisePerGram.return)}/g return · {money(analysis.simulatedRatesPaisePerGram.settlement)}/g settlement</p>
        </div>
      </div>
    </section>
  );
}
