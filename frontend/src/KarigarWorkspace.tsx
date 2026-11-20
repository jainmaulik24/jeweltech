import { useEffect, useMemo, useState } from 'react';
import AgreementPanel from './AgreementPanel';
import GoldJourneyPanel from './GoldJourneyPanel';
import KarigarSlipDashboard from './KarigarSlipDashboard';

type Language = 'en' | 'kn';

interface Exposure {
  exposureMg: number;
  exposurePaise: number;
  cleanReturnCount: number;
  trustTier: { label: string; floatLimitMg: number };
  risk: {
    level: 'steady' | 'watch' | 'high';
    reasons: string[];
    recommendedActions: Array<{ code: string; label: string }>;
  };
}

interface Karigar {
  karigarId: string;
  karigarName: string;
  remainingMg: number;
  availableMg: number;
  exposure: Exposure | null;
}

interface Job {
  id: string;
  description: string;
  status: string;
}

interface WorkspaceData {
  karigars: Karigar[];
  jobsByKarigar: Map<string, Job[]>;
}

interface Props {
  userId: string;
  language: Language;
  karigarId?: string;
  onLanguageChange: (language: 'en' | 'hi' | 'kn') => void;
  onSelectKarigar: (karigarId: string) => void;
  onOpenOrder: (orderId: string) => void;
}

const grams = (milligrams: number) => `${(milligrams / 1000).toLocaleString('en-IN', {
  maximumFractionDigits: 3,
})} g`;

const money = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(paise / 100);

export default function KarigarWorkspace({
  userId,
  language,
  karigarId,
  onLanguageChange,
  onSelectKarigar,
  onOpenOrder,
}: Props) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const isKannada = language === 'kn';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const headers = { 'x-user-id': userId };
        const [floatResponse, orderResponse] = await Promise.all([
          fetch('/api/karigar-floats', { headers }),
          fetch('/api/gold-at-large', { headers }),
        ]);
        const [floatResult, orderResult] = await Promise.all([
          floatResponse.json(),
          orderResponse.json(),
        ]);
        if (!floatResponse.ok) throw new Error(floatResult.error ?? 'Could not load karigar balances.');
        if (!orderResponse.ok) throw new Error(orderResult.error ?? 'Could not load karigar jobs.');

        const jobsByKarigar = new Map<string, Job[]>();
        for (const boardKarigar of orderResult.karigars ?? []) {
          jobsByKarigar.set(
            boardKarigar.id,
            (boardKarigar.orders ?? []).map((order: Job) => order),
          );
        }
        if (!cancelled) {
          setData({ karigars: floatResult.karigars, jobsByKarigar });
          setError('');
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load karigar details.');
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [userId]);

  const selectedKarigar = useMemo(
    () => data?.karigars.find((karigar) => karigar.karigarId === karigarId),
    [data, karigarId],
  );
  const jobs = karigarId ? data?.jobsByKarigar.get(karigarId) ?? [] : [];
  const openJobs = jobs.filter((job) => job.status === 'open');
  const selectedOrder = openJobs.find((job) => job.id === selectedOrderId) ?? openJobs[0];
  const labels = isKannada
    ? {
      listTitle: 'ಕಾರಿಗರು',
      listEmpty: 'ಕಾರಿಗರರ ವಿವರಗಳು ಲಭ್ಯವಿಲ್ಲ.',
      detail: 'ಕಾರಿಗರರ ವಿವರ',
      back: 'ಕಾರಿಗರರಿಗೆ ಹಿಂತಿರುಗಿ',
      balance: 'ಬಾಕಿ ಚಿನ್ನ',
      float: 'ಫ್ಲೋಟ್‌ನಲ್ಲಿ ಉಳಿದಿದೆ',
      tier: 'ನಂಬಿಕೆಯ ಹಂತ',
      risk: 'ಮುನ್ನೆಚ್ಚರಿಕೆ',
      steady: 'ಮುನ್ನೆಚ್ಚರಿಕೆ ಸೂಚನೆಗಳಿಲ್ಲ.',
      jobs: 'ತೆರೆದ ಕೆಲಸಗಳು',
      noJobs: 'ತೆರೆದ ಕೆಲಸಗಳಿಲ್ಲ.',
      workDetails: 'ಒಪ್ಪಂದ, ಕೂಲಿ ಮತ್ತು ಚಿನ್ನದ ಹಾದಿ',
      chooseJob: 'ಕೆಲಸ ಆಯ್ಕೆಮಾಡಿ',
      agreement: 'ಒಪ್ಪಂದ ಮತ್ತು ನ್ಯಾಯಯುತ ಕೂಲಿ',
      journey: 'ಚಿನ್ನದ ಹಾದಿ',
      slip: 'ಸಹಾಯದಿಂದ ಕಾಗದದ ಚೀಟಿ ತೆರೆಯಿರಿ',
      simulated: 'SIMULATED',
    }
    : {
      listTitle: 'Karigars',
      listEmpty: 'No karigar details are available.',
      detail: 'Karigar details',
      back: 'Back to karigars',
      balance: 'Gold outstanding',
      float: 'Float remaining',
      tier: 'Trust tier',
      risk: 'Early warning',
      steady: 'No early warning signals.',
      jobs: 'Open jobs',
      noJobs: 'No open jobs.',
      workDetails: 'Agreement, pay and gold journey',
      chooseJob: 'Choose a job',
      agreement: 'Agreement and Fair Pay',
      journey: 'Gold journey',
      slip: 'Open paper slip with assistance',
      simulated: 'SIMULATED',
    };

  if (!data && !error) {
    return <p className="rounded-2xl bg-white p-4 text-sm text-gray-600">Loading karigar details…</p>;
  }
  if (error) {
    return <p role="alert" className="rounded-2xl bg-red-50 p-4 font-semibold text-red-800">{error}</p>;
  }
  if (!data) return null;

  if (!karigarId) {
    return (
      <section aria-label={labels.listTitle} className="space-y-3">
        <h1 className="text-xl font-black">{labels.listTitle}</h1>
        {data.karigars.length === 0 && (
          <p className="rounded-2xl bg-white p-4 text-sm text-gray-600">{labels.listEmpty}</p>
        )}
        {data.karigars.map((karigar) => (
          <button
            key={karigar.karigarId}
            type="button"
            onClick={() => onSelectKarigar(karigar.karigarId)}
            className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm"
          >
            <span className="min-w-0">
              <strong className="block truncate">{karigar.karigarName}</strong>
              <span className="text-sm text-gray-600">
                {karigar.exposure ? `${grams(karigar.exposure.exposureMg)} · ${money(karigar.exposure.exposurePaise)} · ` : ''}
                {data.jobsByKarigar.get(karigar.karigarId)?.filter((job) => job.status === 'open').length ?? 0} open jobs
              </span>
            </span>
            <span aria-hidden="true" className="text-xl font-bold text-amber-700">›</span>
          </button>
        ))}
      </section>
    );
  }

  if (!selectedKarigar) {
    return (
      <section className="space-y-3">
        <button type="button" onClick={() => onSelectKarigar('')} className="font-bold text-indigo-800">
          ← {labels.back}
        </button>
        <p className="rounded-2xl bg-white p-4 text-sm text-gray-600">{labels.listEmpty}</p>
      </section>
    );
  }

  const exposure = selectedKarigar.exposure;
  return (
    <section aria-label={labels.detail} className="space-y-3">
      <button type="button" onClick={() => onSelectKarigar('')} className="min-h-11 font-bold text-indigo-800">
        ← {labels.back}
      </button>
      <h1 className="text-xl font-black">{selectedKarigar.karigarName}</h1>

      <article className="space-y-2 rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
        <h2 className="font-black">{labels.risk}</h2>
        <p className="text-2xl font-black">
          {labels.float}: {grams(selectedKarigar.remainingMg)}
        </p>
        {exposure ? (
          <>
            <p>{labels.balance}: {grams(exposure.exposureMg)} · {money(exposure.exposurePaise)} ({labels.simulated})</p>
            <p>{labels.tier}: {exposure.trustTier.label} · {grams(exposure.trustTier.floatLimitMg)}</p>
            <p className="font-semibold">
              {exposure.risk.level === 'steady' ? labels.steady : exposure.risk.reasons[0]}
            </p>
            {exposure.risk.recommendedActions[0] && (
              <p className="text-sm text-indigo-900">{exposure.risk.recommendedActions[0].label}</p>
            )}
          </>
        ) : <p className="text-sm text-gray-600">{labels.steady}</p>}
      </article>

      <details className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-black">{labels.jobs} · {openJobs.length}</summary>
        {openJobs.length === 0 ? (
          <p className="mt-3 text-sm text-gray-600">{labels.noJobs}</p>
        ) : (
          <div className="mt-3 space-y-2">
            {openJobs.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => onOpenOrder(job.id)}
                className="min-h-11 w-full rounded-xl bg-gray-50 p-3 text-left font-semibold"
              >
                {job.description} · Open job
              </button>
            ))}
          </div>
        )}
      </details>

      <details className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-black">{labels.workDetails}</summary>
        {openJobs.length > 0 ? (
          <>
            <label className="mt-3 block text-sm font-bold">
              {labels.chooseJob}
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3"
                value={selectedOrder?.id ?? ''}
                onChange={(event) => setSelectedOrderId(event.target.value)}
              >
                {openJobs.map((job) => <option key={job.id} value={job.id}>{job.description}</option>)}
              </select>
            </label>
            {selectedOrder && (
              <>
                <details className="mt-3 rounded-xl bg-gray-50 p-3">
                  <summary className="cursor-pointer font-bold">{labels.agreement}</summary>
                  <AgreementPanel
                    orderId={selectedOrder.id}
                    userId={userId}
                    role="jeweller"
                    language={language}
                  />
                </details>
                <details className="mt-3 rounded-xl bg-gray-50 p-3">
                  <summary className="cursor-pointer font-bold">{labels.journey}</summary>
                  <GoldJourneyPanel orderId={selectedOrder.id} userId={userId} />
                </details>
              </>
            )}
          </>
        ) : <p className="mt-3 text-sm text-gray-600">{labels.noJobs}</p>}
        <details className="mt-3 rounded-xl bg-gray-50 p-3">
          <summary className="cursor-pointer font-bold">{labels.slip}</summary>
          <KarigarSlipDashboard
            userId={userId}
            userName={selectedKarigar.karigarName}
            language={language}
            onLanguageChange={onLanguageChange}
            mode="assisted"
          />
        </details>
      </details>
    </section>
  );
}
