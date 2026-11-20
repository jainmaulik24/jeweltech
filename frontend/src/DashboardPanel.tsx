import { useEffect, useState } from 'react';
import { ArrowUpRight, Volume2 } from 'lucide-react';

type Language = 'en' | 'kn';
type Role = 'jeweller' | 'karigar';

interface DashboardOrder {
  id: string;
  description: string;
  status: string;
  karigarId?: string;
  karigarName?: string;
  dueDate: string;
  dueInDays: number;
  daysToDue: number;
  daysOverdue: number;
  ageDays: number;
  stage: string;
  grossMg: number;
  fineGoldMg: number;
  valuePaise: number;
  cashOwedPaise: number;
  cashAgeDays: number;
  cashPolicyAmountsPaise: { issue: number; return: number; settlement: number };
}

interface DashboardData {
  actor: { id: string; name: string; role: Role };
  asOf: string;
  rate: {
    label: string;
    requestedDate: string;
    sourceDate: string;
    rate24KPaisePerGram: number;
    shockPercent: number;
  };
  rateConfiguration: {
    label: string;
    shock: { minPercent: number; maxPercent: number; stepPercent: number; defaultPercent: number };
  };
  totals: {
    grossMg: number;
    fineGoldMg: number;
    valuePaise: number;
    valueLakh: string;
    karigarHeldFineMg: number;
    karigarHeldValuePaise: number;
    workshopCount: number;
    openJobsCount: number;
    cashOwedPaise: number;
  };
  stages: Array<{
    account: string;
    label: string;
    fineGoldMg: number;
    valuePaise: number;
    sharePercent: number;
  }>;
  ageing: Array<{
    label: string;
    fineGoldMg: number;
    valuePaise: number;
    sharePercent: number;
  }>;
  karigars: Array<{
    id: string;
    name: string;
    fineGoldMg: number;
    valuePaise: number;
    concentrationPercent: number;
    openJobsCount: number;
    oldestAgeDays: number;
    orders: DashboardOrder[];
  }>;
  orders: DashboardOrder[];
  cashPolicyAmountsPaise: { issue: number; return: number; settlement: number };
  karigarCashPolicyAmountsPaise: { issue: number; return: number; settlement: number };
  pendingAcknowledgements: Array<{
    id: string;
    orderId: string;
    description: string;
    type: string;
    amount: number;
    weightMg: number;
    agreementVersion: number | null;
    ageDays: number;
  }>;
}

interface EscalatedDispute {
  id: string;
  orderId: string;
  description: string;
  reason: string;
  ageDays: number;
}

interface Props {
  userId: string;
  role: Role;
  language: Language;
  onSelectOrder: (orderId: string) => void;
  view?: 'full' | 'summary';
}

const text = {
  en: {
    jewellerTitle: 'Gold at large',
    karigarTitle: 'Mera hisaab',
    headline: 'of your gold is sitting in',
    workshops: 'workshops',
    outsideGold: 'Gold outside the vault',
    heldGold: 'Fine gold in your account',
    currentRate: "Today's 24K rate",
    rateShock: 'Rate shock',
    rateNote: 'SIMULATED rate. Gold values and cash-policy estimates update with this shock; agreed labour earnings do not.',
    stages: 'Gold by stage',
    ageing: 'Ageing',
    concentration: 'Karigar concentration',
    openJobs: 'Open jobs',
    jobsDue: 'Jobs due',
    cashOwed: 'Cash owed for returned work',
    cashAge: 'oldest unpaid',
    policy: 'Cash settlement estimate by rate policy',
    issueDate: 'Issue date',
    returnDate: 'Return date',
    settlementDate: 'Settlement date',
    openJob: 'open job',
    pending: 'Pending acknowledgements',
    noPending: 'No pending acknowledgements.',
    noJobs: 'No open jobs.',
    viewJob: 'Open job',
    drilldown: 'Review karigar jobs',
    readAloud: 'Read my account aloud',
    updating: 'Updating rate values…',
    loading: 'Loading your account…',
    rateError: 'Could not load your account',
    reset: 'Reset',
    dueToday: 'Due today',
    dueIn: 'days to due',
    overdue: 'days overdue',
    cashFixed: 'Agreed labour amount',
    pendingReview: 'Review',
    agreementPending: 'agreement update awaiting acknowledgement',
    retry: 'Retry',
    escalations: 'Open escalations',
    escalationAge: 'days open',
    escalationEmpty: 'No open escalations.',
    escalationError: 'Could not load open escalations.',
  },
  kn: {
    jewellerTitle: 'ವಾಲ್ಟ್ ಹೊರಗಿನ ಚಿನ್ನ',
    karigarTitle: 'ನನ್ನ ಲೆಕ್ಕ',
    headline: 'ಚಿನ್ನ',
    workshops: 'ಕಾರ್ಯಾಗಾರಗಳಲ್ಲಿ',
    outsideGold: 'ವಾಲ್ಟ್ ಹೊರಗಿನ ಚಿನ್ನ',
    heldGold: 'ನಿಮ್ಮ ಬಳಿಯ ಶುದ್ಧ ಚಿನ್ನ',
    currentRate: 'ಇಂದಿನ 24K ದರ',
    rateShock: 'ದರ ಬದಲಾವಣೆ',
    rateNote: 'SIMULATED ದರ. ಈ ಬದಲಾವಣೆಯಿಂದ ಚಿನ್ನದ ಮೌಲ್ಯ ಮತ್ತು ನಗದು ಅಂದಾಜು ಬದಲಾಗುತ್ತದೆ; ಒಪ್ಪಿದ ಕೂಲಿ ಬದಲಾಗುವುದಿಲ್ಲ.',
    stages: 'ಹಂತದ ಪ್ರಕಾರ ಚಿನ್ನ',
    ageing: 'ವಯಸ್ಸು',
    concentration: 'ಕಾರಿಗರರ ಹಂಚಿಕೆ',
    openJobs: 'ತೆರೆದ ಕೆಲಸಗಳು',
    jobsDue: 'ಗಡುವಿನ ಕೆಲಸಗಳು',
    cashOwed: 'ಮರಳಿಸಿದ ಕೆಲಸದ ನಗದು ಬಾಕಿ',
    cashAge: 'ಅತ್ಯಂತ ಹಳೆಯ ಬಾಕಿ',
    policy: 'ದರ ನೀತಿಯ ಪ್ರಕಾರ ನಗದು ಅಂದಾಜು',
    issueDate: 'ನೀಡಿದ ದಿನ',
    returnDate: 'ಮರಳಿಸಿದ ದಿನ',
    settlementDate: 'ಸೆಟಲ್ಮೆಂಟ್ ದಿನ',
    openJob: 'ತೆರೆದ ಕೆಲಸ',
    pending: 'ಬಾಕಿ ಒಪ್ಪಿಗೆಗಳು',
    noPending: 'ಒಪ್ಪಿಗೆಗೆ ಏನೂ ಬಾಕಿ ಇಲ್ಲ.',
    noJobs: 'ತೆರೆದ ಕೆಲಸಗಳಿಲ್ಲ.',
    viewJob: 'ಕೆಲಸ ತೆರೆಯಿರಿ',
    drilldown: 'ಕಾರಿಗರರ ಕೆಲಸಗಳನ್ನು ನೋಡಿ',
    readAloud: 'ನನ್ನ ಲೆಕ್ಕವನ್ನು ಓದಿ ಕೇಳಿಸಿ',
    updating: 'ದರ ಮೌಲ್ಯಗಳನ್ನು ನವೀಕರಿಸಲಾಗುತ್ತಿದೆ…',
    loading: 'ನಿಮ್ಮ ಲೆಕ್ಕವನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ…',
    rateError: 'ನಿಮ್ಮ ಲೆಕ್ಕವನ್ನು ಲೋಡ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ',
    reset: 'ಮರುಹೊಂದಿಸಿ',
    dueToday: 'ಇಂದು ಗಡುವು',
    dueIn: 'ದಿನಗಳಲ್ಲಿ ಗಡುವು',
    overdue: 'ದಿನಗಳ ವಿಳಂಬ',
    cashFixed: 'ಒಪ್ಪಿದ ಕೂಲಿ ಮೊತ್ತ',
    pendingReview: 'ಪರಿಶೀಲಿಸಿ',
    agreementPending: 'ಒಪ್ಪಿಗೆಗಾಗಿ ಒಪ್ಪಂದ ನವೀಕರಣ ಕಾಯುತ್ತಿದೆ',
    retry: 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ',
    escalations: 'ತೆರೆದ ವಿವಾದಗಳು',
    escalationAge: 'ದಿನಗಳಿಂದ ತೆರೆದಿದೆ',
    escalationEmpty: 'ತೆರೆದ ವಿವಾದಗಳಿಲ್ಲ.',
    escalationError: 'ತೆರೆದ ವಿವಾದಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ.',
  },
};

const money = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(paise / 100);

const grams = (milligrams: number) => `${new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
}).format(milligrams / 1000)} g`;

const dueLabel = (order: DashboardOrder, labels: typeof text.en) => {
  if (order.daysOverdue > 0) return `${order.daysOverdue} ${labels.overdue}`;
  if (order.daysToDue === 0) return labels.dueToday;
  return `${order.daysToDue} ${labels.dueIn}`;
};

export default function DashboardPanel({
  userId,
  role,
  language,
  onSelectOrder,
  view = 'full',
}: Props) {
  const labels = text[language];
  const [data, setData] = useState<DashboardData | null>(null);
  const [shockPercent, setShockPercent] = useState<number | null>(null);
  const [selectedKarigarId, setSelectedKarigarId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [escalatedDisputes, setEscalatedDisputes] = useState<EscalatedDispute[]>([]);
  const [escalationError, setEscalationError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const query = shockPercent === null ? '' : `?shockPercent=${shockPercent}`;
    fetch(`/api/gold-at-large${query}`, { headers: { 'x-user-id': userId } })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? labels.rateError);
        return result as DashboardData;
      })
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError('');
        }
      })
      .catch((loadError: Error) => {
        if (!cancelled) {
          setData(null);
          setError(loadError.message);
        }
      });
    return () => { cancelled = true; };
  }, [labels.rateError, reloadToken, shockPercent, userId]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/disputes/escalated', { headers: { 'x-user-id': userId } })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? labels.escalationError);
        return result.disputes as EscalatedDispute[];
      })
      .then((result) => {
        if (!cancelled) {
          setEscalatedDisputes(result);
          setEscalationError('');
        }
      })
      .catch((loadError: Error) => {
        if (!cancelled) setEscalationError(loadError.message);
      });
    return () => { cancelled = true; };
  }, [labels.escalationError, reloadToken, userId]);

  const speakSummary = () => {
    if (!data || !('speechSynthesis' in window)) {
      setError('Speech synthesis is not available in this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    const speech = role === 'karigar'
      ? `${labels.heldGold}: ${grams(data.totals.karigarHeldFineMg)}. ${labels.cashOwed}: ${money(data.totals.cashOwedPaise)}. ${labels.openJobs}: ${data.totals.openJobsCount}.`
      : `${money(data.totals.valuePaise)} ${labels.headline} ${data.totals.workshopCount} ${labels.workshops}.`;
    const utterance = new SpeechSynthesisUtterance(speech);
    utterance.lang = language === 'kn' ? 'kn-IN' : 'en-IN';
    window.speechSynthesis.speak(utterance);
  };

  if (!data) {
    return (
      <section className="space-y-3 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm" aria-live="polite">
        {error ? <p role="alert" className="break-words font-semibold text-red-700">{error}</p> : <p>{labels.loading}</p>}
        {error && <button onClick={() => setReloadToken((current) => current + 1)} className="rounded-lg bg-gray-900 px-4 py-2 font-bold text-white">{labels.retry}</button>}
      </section>
    );
  }

  const incrementShock = (amount: number) => {
    const current = shockPercent ?? data.rate.shockPercent;
    const next = Math.max(
      data.rateConfiguration.shock.minPercent,
      Math.min(data.rateConfiguration.shock.maxPercent, current + amount),
    );
    setShockPercent(next);
  };

  const openJobButton = (order: DashboardOrder) => (
    <button
      key={order.id}
      onClick={() => onSelectOrder(order.id)}
      className="flex min-w-0 w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-3 text-left hover:border-amber-400"
    >
      <span className="min-w-0 break-words font-bold text-gray-800">{order.description}</span>
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-indigo-700">
        {labels.viewJob} <ArrowUpRight size={16} />
      </span>
    </button>
  );

  if (view === 'summary') {
    return (
      <section aria-label="Gold with karigars" className="rounded-2xl bg-gray-900 p-4 text-white shadow-sm">
        <h1 className="text-lg font-black">Gold with karigars</h1>
        <p className="mt-2 text-3xl font-black">{grams(data.totals.karigarHeldFineMg)}</p>
        <p className="font-bold text-amber-300">{money(data.totals.karigarHeldValuePaise)}</p>
        <p className="mt-2 text-sm text-gray-200">
          Today's 24K rate · {money(data.rate.rate24KPaisePerGram)}/g · {data.rate.label} · {data.rate.sourceDate}
        </p>
      </section>
    );
  }

  return (
    <section className="min-w-0 space-y-4" aria-live="polite">
      {error && <p role="alert" className="break-words rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}

      <article className="min-w-0 space-y-4 rounded-3xl bg-gray-900 p-5 text-white shadow-sm sm:p-6">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-black sm:text-2xl">
              {role === 'jeweller' ? labels.jewellerTitle : labels.karigarTitle}
            </h2>
            <p className="mt-1 break-words text-sm text-gray-300">
              {role === 'jeweller'
                ? `₹${data.totals.valueLakh} lakh ${labels.headline} ${data.totals.workshopCount} ${labels.workshops}`
                : `${labels.heldGold}: ${grams(data.totals.karigarHeldFineMg)}`}
            </p>
          </div>
          {role === 'karigar' && (
            <button onClick={speakSummary} aria-label={labels.readAloud} className="shrink-0 rounded-full bg-white/10 p-3 hover:bg-white/20">
              <Volume2 size={22} />
            </button>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-2xl bg-white/10 p-4">
            <p className="break-words text-sm text-gray-300">
              {role === 'jeweller' ? labels.outsideGold : labels.heldGold}
            </p>
            <p className="break-words text-3xl font-black tracking-tight">
              {grams(role === 'karigar' ? data.totals.karigarHeldFineMg : data.totals.fineGoldMg)}
            </p>
            <p className="mt-1 break-words text-lg font-bold text-amber-300">
              {money(role === 'karigar' ? data.totals.karigarHeldValuePaise : data.totals.valuePaise)}
            </p>
          </div>
          <div className="min-w-0 rounded-2xl bg-white/10 p-4">
            <p className="break-words text-sm text-gray-300">{labels.currentRate} · 24K · {data.rate.label}</p>
            <p className="break-words text-2xl font-black">{money(data.rate.rate24KPaisePerGram)}/g</p>
            <p className="mt-1 break-words text-xs text-gray-300">Rate series date: {data.rate.sourceDate}</p>
          </div>
        </div>

        <div className="min-w-0 rounded-2xl bg-white p-4 text-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="rate-shock" className="font-bold">{labels.rateShock}</label>
            <strong className="rounded-lg bg-amber-100 px-3 py-1 text-amber-900">
              {(shockPercent ?? data.rate.shockPercent) > 0 ? '+' : ''}{shockPercent ?? data.rate.shockPercent}%
            </strong>
          </div>
          <input
            id="rate-shock"
            type="range"
            min={data.rateConfiguration.shock.minPercent}
            max={data.rateConfiguration.shock.maxPercent}
            step={data.rateConfiguration.shock.stepPercent}
            value={shockPercent ?? data.rate.shockPercent}
            onChange={(event) => setShockPercent(Number(event.target.value))}
            className="mt-3 w-full accent-amber-600"
          />
          <div className="flex flex-wrap items-start justify-between gap-2 text-xs text-gray-600">
            <span>{data.rateConfiguration.shock.minPercent}%</span>
            <span className="max-w-[72%] text-right">{labels.rateNote}</span>
            <span>+{data.rateConfiguration.shock.maxPercent}%</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => incrementShock(-data.rateConfiguration.shock.stepPercent)} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-bold">−{data.rateConfiguration.shock.stepPercent}%</button>
            <button onClick={() => setShockPercent(data.rateConfiguration.shock.defaultPercent)} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-bold">{labels.reset}</button>
            <button onClick={() => incrementShock(data.rateConfiguration.shock.stepPercent)} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-bold">+{data.rateConfiguration.shock.stepPercent}%</button>
            {(shockPercent ?? data.rate.shockPercent) !== data.rate.shockPercent
              && <span className="self-center text-xs text-gray-600">{labels.updating}</span>}
          </div>
        </div>
      </article>

      <details className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-black">{labels.stages}, ageing and cash policy</summary>
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <section className="min-w-0 space-y-3 rounded-xl bg-gray-50 p-3">
            <h3 className="font-black text-gray-900">{labels.stages}</h3>
            {data.stages.map((stage) => (
              <div key={stage.account} className="min-w-0">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="break-words font-semibold">{stage.label} · {grams(stage.fineGoldMg)}</span>
                  <strong className="break-words">{money(stage.valuePaise)}</strong>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-amber-500" style={{ width: `${stage.sharePercent}%` }} />
                </div>
              </div>
            ))}
          </section>
          <section className="min-w-0 space-y-3 rounded-xl bg-gray-50 p-3">
            <h3 className="font-black text-gray-900">{labels.ageing}</h3>
            {data.ageing.map((bucket) => (
              <div key={bucket.label} className="min-w-0">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-semibold">{bucket.label} · {grams(bucket.fineGoldMg)}</span>
                  <strong>{money(bucket.valuePaise)}</strong>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${bucket.sharePercent}%` }} />
                </div>
              </div>
            ))}
          </section>
          <section className="min-w-0 space-y-3 rounded-xl bg-gray-50 p-3">
            <h3 className="font-black text-gray-900">{labels.policy} · {data.rate.label}</h3>
            {([
              ['issue', labels.issueDate],
              ['return', labels.returnDate],
              ['settlement', labels.settlementDate],
            ] as const).map(([policy, label]) => (
              <div key={policy} className="flex min-w-0 flex-wrap justify-between gap-2 rounded-xl bg-white p-3">
                <span className="break-words font-semibold">{label}</span>
                <strong>{money((role === 'karigar' ? data.karigarCashPolicyAmountsPaise : data.cashPolicyAmountsPaise)[policy])}</strong>
              </div>
            ))}
          </section>
        </div>
      </details>

      <details className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-black">{labels.concentration} and jobs</summary>
        {role === 'jeweller' ? (
          <div className="mt-3 space-y-2">
            {data.karigars.map((karigar) => (
              <div key={karigar.id} className="min-w-0 rounded-xl bg-gray-50 p-3">
                <button onClick={() => setSelectedKarigarId(selectedKarigarId === karigar.id ? null : karigar.id)} className="w-full min-w-0 text-left">
                  <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <strong className="break-words">{karigar.name}</strong>
                    <span className="break-words text-sm">{grams(karigar.fineGoldMg)} · {money(karigar.valuePaise)}</span>
                  </span>
                  <span className="mt-1 block text-xs text-gray-600">
                    {karigar.concentrationPercent}% · {karigar.openJobsCount} {karigar.openJobsCount === 1 ? labels.openJob : labels.openJobs} · {karigar.oldestAgeDays} days
                  </span>
                </button>
                {selectedKarigarId === karigar.id && (
                  <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                    <p className="text-sm font-bold text-gray-700">{labels.drilldown}</p>
                    {karigar.orders.filter((order) => order.status === 'open').map(openJobButton)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <section className="min-w-0 space-y-3 rounded-xl bg-gray-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-black text-gray-900">{labels.cashOwed}</h3>
                <strong className="text-lg text-emerald-700">{money(data.totals.cashOwedPaise)}</strong>
              </div>
              <p className="text-xs text-gray-500">{labels.cashFixed}</p>
              {data.orders.filter((order) => order.cashOwedPaise > 0).map((order) => (
                <div key={order.id} className="flex min-w-0 flex-wrap justify-between gap-2 rounded-xl bg-white p-3 text-sm">
                  <span className="min-w-0 break-words">{order.description} · {order.cashAgeDays} {labels.cashAge}</span>
                  <strong>{money(order.cashOwedPaise)}</strong>
                </div>
              ))}
            </section>
            <section className="min-w-0 space-y-3 rounded-xl bg-gray-50 p-3">
              <h3 className="font-black text-gray-900">{labels.jobsDue}</h3>
              {data.orders.filter((order) => order.status === 'open').map((order) => (
                <div key={order.id} className="space-y-2">
                  <p className="break-words text-sm font-semibold text-gray-700">
                    {order.description} · {dueLabel(order, labels)}
                  </p>
                  {openJobButton(order)}
                </div>
              ))}
              {data.orders.every((order) => order.status !== 'open') && <p className="text-sm text-gray-600">{labels.noJobs}</p>}
            </section>
          </div>
        )}
      </details>

      <details className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-black">{labels.pending} and {labels.escalations}</summary>
        <section className="mt-3 space-y-3">
          {escalationError && <p role="alert" className="break-words text-sm font-semibold text-red-700">{escalationError}</p>}
          {escalatedDisputes.map((dispute) => (
            <button
              key={dispute.id}
              onClick={() => onSelectOrder(dispute.orderId)}
              className="flex min-w-0 w-full flex-wrap items-start justify-between gap-2 rounded-xl bg-red-50 p-3 text-left"
            >
              <span className="min-w-0">
                <strong className="block break-words text-sm text-gray-900">{dispute.description}</strong>
                <span className="mt-1 block break-words text-sm text-gray-700">{dispute.reason}</span>
              </span>
              <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-xs font-bold text-red-800">
                {dispute.ageDays} {labels.escalationAge}
              </span>
            </button>
          ))}
          {!escalationError && escalatedDisputes.length === 0 && <p className="text-sm text-gray-600">{labels.escalationEmpty}</p>}
          {data.pendingAcknowledgements.map((event) => (
            <div key={event.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3">
              <span className="min-w-0 break-words text-sm font-semibold">
                {event.description} · {event.type === 'agreement_version'
                  ? `v${event.agreementVersion} ${labels.agreementPending}`
                  : `${event.type.replaceAll('_', ' ')} · ${event.amount > 0 ? money(event.amount) : grams(event.weightMg)}`}
              </span>
              <button onClick={() => onSelectOrder(event.orderId)} className="shrink-0 rounded-lg bg-amber-700 px-3 py-2 text-sm font-bold text-white">
                {labels.pendingReview}
              </button>
            </div>
          ))}
          {data.pendingAcknowledgements.length === 0 && <p className="text-sm text-gray-600">{labels.noPending}</p>}
        </section>
      </details>

      <details className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-black">{labels.jobsDue} · {data.totals.openJobsCount}</summary>
        <section className="mt-3 space-y-2">
          {data.orders.filter((order) => order.status === 'open').map(openJobButton)}
          {data.orders.every((order) => order.status !== 'open') && <p className="text-sm text-gray-600">{labels.noJobs}</p>}
        </section>
      </details>
    </section>
  );
}
