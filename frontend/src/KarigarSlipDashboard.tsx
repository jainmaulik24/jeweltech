import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Coins, LogOut, Volume2 } from 'lucide-react';
import { localeOptions, localeText, type LocaleCode } from './locales';

interface Slip {
  orderId: string;
  description: string;
  issuedMg: number;
  wastageMg: number;
  stoneMg: number;
  netMg: number;
  givenAgainMg: number;
  finalMg: number;
  pendingAcknowledgementEventId: string | null;
  disputeEventId: string | null;
  lastAssistedAcknowledgement: {
    assistedByName: string;
  } | null;
}

interface KarigarHome {
  karigar: { id: string; name: string };
  floatRemainingMg: number;
  exposureLevel: 'steady' | 'watch' | 'high';
  exposureSignal: 'draw_rate' | 'gold_age' | 'missed_promises' | 'concentration'
    | 'purity_shortfall' | 'loss_history' | 'peer_comparison' | null;
  exposureSentence: string;
  slips: Slip[];
  amountsOwed: Array<{
    id: string;
    amountPaise: number;
    daysWaiting: number;
    overdueDays: number;
  }>;
  goldAmountsOwed: Array<{
    id: string;
    amountMg: number;
    daysWaiting: number;
  }>;
  pendingAcknowledgements: Array<{
    id: string;
    orderId: string;
    description: string | null;
    type: string;
    amount: number;
    weightMg: number;
  }>;
}

interface AssistedKarigar {
  karigarId: string;
  karigarName: string;
  hasPair?: boolean;
  floatId: string | null;
}

interface Props {
  userId: string;
  userName: string;
  language: LocaleCode;
  onLanguageChange: (language: LocaleCode) => void;
  onLogout?: () => void;
  mode?: 'karigar' | 'assisted';
}

function formatGrams(milligrams: number): string {
  const whole = Math.trunc(Math.abs(milligrams) / 1000);
  const fractional = String(Math.abs(milligrams) % 1000).padStart(3, '0');
  return `${milligrams < 0 ? '-' : ''}${whole}.${fractional}`;
}

function formatMoney(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

function gramsSpoken(milligrams: number): string {
  return `${formatGrams(milligrams)} grams`;
}

export default function KarigarSlipDashboard({
  userId,
  userName,
  language,
  onLanguageChange,
  onLogout,
  mode = 'karigar',
}: Props) {
  const text = localeText[language].slip;
  const assisted = mode === 'assisted';
  const [karigars, setKarigars] = useState<AssistedKarigar[]>([]);
  const [selectedKarigarId, setSelectedKarigarId] = useState('');
  const [home, setHome] = useState<KarigarHome | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyEventId, setBusyEventId] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!assisted) return;
    let cancelled = false;
    fetch('/api/karigar-floats', { headers: { 'x-user-id': userId } })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? text.error);
        return data.karigars as AssistedKarigar[];
      })
      .then((items) => {
        if (cancelled) return;
        const available = items.filter((item) => item.hasPair || item.floatId);
        setKarigars(available);
        setSelectedKarigarId((current) => available.some((item) => item.karigarId === current)
          ? current
          : available[0]?.karigarId ?? '');
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : text.error);
      });
    return () => { cancelled = true; };
  }, [assisted, refreshKey, text.error, userId]);

  const load = useCallback(async () => {
    if (assisted && !selectedKarigarId) {
      setHome(null);
      return;
    }
    const query = assisted ? `?karigarId=${encodeURIComponent(selectedKarigarId)}` : '';
    const response = await fetch(`/api/karigar/home${query}`, {
      headers: { 'x-user-id': userId },
    });
    const data = await response.json() as KarigarHome & { error?: string };
    if (!response.ok) throw new Error(data.error ?? text.error);
    setHome(data);
    setError('');
  }, [assisted, selectedKarigarId, text.error, userId]);

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

  const spokenScreen = useMemo(() => {
    if (!home) return '';
    const slipLines = home.slips.map((slip) => [
      slip.description,
      `${text.issued}: ${gramsSpoken(slip.issuedMg)}`,
      `${text.wastage}: ${gramsSpoken(slip.wastageMg)}`,
      `${text.stone}: ${gramsSpoken(slip.stoneMg)}`,
      `${text.net}: ${gramsSpoken(slip.netMg)}`,
      `${text.givenAgain}: ${gramsSpoken(slip.givenAgainMg)}`,
      `${text.final}: ${gramsSpoken(slip.finalMg)}`,
    ].join('. '));
    const dues = home.amountsOwed.map((due) =>
      `${text.cash} ${formatMoney(due.amountPaise)}, ${due.daysWaiting} ${text.daysWaiting}`);
    const goldDues = home.goldAmountsOwed.map((due) =>
      `${text.gold} ${gramsSpoken(due.amountMg)}, ${due.daysWaiting} ${text.daysWaiting}`);
    const pending = home.pendingAcknowledgements.map((event) => {
      const amount = event.amount > 0
        ? formatMoney(event.amount)
        : event.weightMg > 0
          ? gramsSpoken(event.weightMg)
          : '';
      return `${text.pendingEntry}: ${event.description ?? ''} ${amount}`;
    });
    return [
      home.karigar.name,
      `${text.myGold}: ${gramsSpoken(home.floatRemainingMg)}`,
      ...slipLines,
      `${text.owed}. ${[...dues, ...goldDues].length ? [...dues, ...goldDues].join('. ') : text.noOwed}`,
      ...pending,
      exposureSentence(),
    ].join('. ');
  }, [home, text]);

  const speak = (value: string) => {
    if (!('speechSynthesis' in window)) {
      setError('Audio reading is not available on this device.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(value);
    utterance.lang = language === 'hi' ? 'hi-IN' : language === 'kn' ? 'kn-IN' : 'en-IN';
    window.speechSynthesis.speak(utterance);
  };

  const postAction = async (eventId: string, action: 'acknowledge' | 'dispute') => {
    setBusyEventId(eventId);
    setError('');
    setNotice('');
    try {
      const path = action === 'acknowledge'
        ? `/api/ledger/${eventId}/${assisted ? 'assisted-acknowledge' : 'acknowledge'}`
        : `/api/ledger/${eventId}/disputes`;
      const response = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        ...(action === 'dispute'
          ? { body: JSON.stringify({ reason: text.dispute }) }
          : {}),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? text.error);
      setNotice(action === 'acknowledge' ? text.acknowledgementSaved : text.disputeSaved);
      setRefreshKey((current) => current + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : text.error);
    } finally {
      setBusyEventId('');
    }
  };

  const pendingEventLabel = (type: string) => {
    if (type === 'issue') return text.givenGold;
    if (type === 'return' || type === 'scrap_entry') return text.returnedGold;
    if (type === 'payment') return text.cashEntry;
    if (type === 'settlement') return text.goldAccount;
    return text.pendingEntry;
  };
  const exposureSentence = () => {
    if (!home?.exposureSignal) return text.exposureSteady;
    const messages = {
      draw_rate: text.exposureDrawRate,
      gold_age: text.exposureGoldAge,
      missed_promises: text.exposureMissedPromises,
      concentration: text.exposureConcentration,
      purity_shortfall: text.exposurePurity,
      loss_history: text.exposureLoss,
      peer_comparison: text.exposurePeer,
    };
    return messages[home.exposureSignal];
  };
  const standalonePending = home
    ? home.pendingAcknowledgements.filter((event) =>
      !home.slips.some((slip) => slip.orderId === event.orderId))
    : [];

  const screen = (
    <>
      {assisted && (
        <label className="mb-4 block text-sm font-bold">
          {text.chooseKarigar}
          <select
            value={selectedKarigarId}
            onChange={(event) => {
              setSelectedKarigarId(event.target.value);
              setHome(null);
              setNotice('');
            }}
            className="mt-2 min-h-12 w-full rounded-xl border-2 border-gray-300 bg-white px-3 text-base"
          >
            {karigars.map((item) => (
              <option key={item.karigarId} value={item.karigarId}>{item.karigarName}</option>
            ))}
          </select>
        </label>
      )}
      {!home && !error && <p className="rounded-xl bg-white p-4 text-center font-semibold">{text.loading}</p>}
      {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 font-semibold text-red-900">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-green-900">{notice}</p>}
      {home && (
        <>
          <section className="mb-4 rounded-2xl border-2 border-amber-500 bg-amber-50 p-4">
            <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-amber-950">
              <Coins aria-hidden="true" size={22} /> {text.myGold}
            </h2>
            <p className="mt-1 text-right text-4xl font-black tabular-nums text-gray-950">
              {formatGrams(home.floatRemainingMg)} <span className="text-xl">g</span>
            </p>
          </section>

          <section aria-label={text.title} className="space-y-4">
            {home.slips.length === 0 && (
              <p className="rounded-xl bg-white p-4 text-center font-semibold">{text.noJobs}</p>
            )}
            {home.slips.map((slip) => {
              const isBusy = busyEventId !== '';
              const line = (label: string, sign: string, milligrams: number, strong = false) => (
                <div className={`flex items-baseline justify-between gap-3 border-b border-gray-300 py-2 ${strong ? 'font-black' : 'font-semibold'}`}>
                  <span className="min-w-0">{sign && <span className="mr-1">{sign}</span>}{label}</span>
                  <span className="shrink-0 text-right font-mono tabular-nums">{formatGrams(milligrams)} g</span>
                </div>
              );
              return (
                <article key={slip.orderId} className="rounded-2xl border-2 border-gray-800 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h3 className="break-words text-lg font-black">{slip.description}</h3>
                    <button
                      type="button"
                      onClick={() => speak([
                        slip.description,
                        `${text.issued}: ${gramsSpoken(slip.issuedMg)}`,
                        `${text.wastage}: ${gramsSpoken(slip.wastageMg)}`,
                        `${text.stone}: ${gramsSpoken(slip.stoneMg)}`,
                        `${text.net}: ${gramsSpoken(slip.netMg)}`,
                        `${text.givenAgain}: ${gramsSpoken(slip.givenAgainMg)}`,
                        `${text.final}: ${gramsSpoken(slip.finalMg)}`,
                      ].join('. '))}
                      aria-label={text.readSlip}
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-blue-100 text-blue-950"
                    >
                      <Volume2 aria-hidden="true" size={22} />
                    </button>
                  </div>
                  <div className="space-y-0">
                    {line(text.issued, '', slip.issuedMg)}
                    {line(text.wastage, '−', slip.wastageMg)}
                    {line(text.stone, '−', slip.stoneMg)}
                    {line(text.net, '=', slip.netMg, true)}
                    {line(text.givenAgain, '+', slip.givenAgainMg)}
                    <div className="border-b-4 border-gray-900">
                      {line(text.final, '=', slip.finalMg, true)}
                    </div>
                  </div>
                  {slip.lastAssistedAcknowledgement && (
                    <p className="mt-2 text-sm font-semibold text-gray-700">
                      {text.assistedBy} {slip.lastAssistedAcknowledgement.assistedByName}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={!slip.pendingAcknowledgementEventId || isBusy}
                    onClick={() => slip.pendingAcknowledgementEventId
                      && void postAction(slip.pendingAcknowledgementEventId, 'acknowledge')}
                    className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-green-700 px-4 text-xl font-black text-white disabled:bg-green-900/40"
                  >
                    <CheckCircle aria-hidden="true" size={24} />
                    {slip.pendingAcknowledgementEventId && busyEventId === slip.pendingAcknowledgementEventId
                      ? text.busy
                      : text.ok}
                  </button>
                  {!assisted && (
                    <button
                      type="button"
                      disabled={!slip.disputeEventId || isBusy}
                      onClick={() => slip.disputeEventId && void postAction(slip.disputeEventId, 'dispute')}
                      className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-red-700 bg-white px-3 font-bold text-red-800 disabled:opacity-40"
                    >
                      <AlertCircle aria-hidden="true" size={18} /> {text.dispute}
                    </button>
                  )}
                </article>
              );
            })}
          </section>

          {standalonePending.length > 0 && (
            <section className="mt-5 space-y-3" aria-label={text.pendingEntry}>
              {standalonePending.map((event) => (
                <article key={event.id} className="rounded-2xl border-2 border-amber-600 bg-amber-50 p-4">
                  <h2 className="text-lg font-black">{event.description || text.pendingEntry}</h2>
                  <p className="mt-1 font-semibold">{pendingEventLabel(event.type)}</p>
                  {event.weightMg > 0 && (
                    <p className="mt-1 text-right text-2xl font-black tabular-nums">
                      {formatGrams(event.weightMg)} g
                    </p>
                  )}
                  {event.amount > 0 && (
                    <p className="mt-1 text-right text-xl font-black tabular-nums">{formatMoney(event.amount)}</p>
                  )}
                  <button
                    type="button"
                    disabled={busyEventId !== ''}
                    onClick={() => void postAction(event.id, 'acknowledge')}
                    className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-green-700 px-4 text-xl font-black text-white disabled:opacity-50"
                  >
                    <CheckCircle aria-hidden="true" size={24} /> {busyEventId === event.id ? text.busy : text.ok}
                  </button>
                  {!assisted && (
                    <button
                      type="button"
                      disabled={busyEventId !== ''}
                      onClick={() => void postAction(event.id, 'dispute')}
                      className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-red-700 bg-white px-3 font-bold text-red-800 disabled:opacity-40"
                    >
                      <AlertCircle aria-hidden="true" size={18} /> {text.dispute}
                    </button>
                  )}
                </article>
              ))}
            </section>
          )}

          <section className="mt-5 rounded-2xl border-2 border-gray-800 bg-white p-4">
            <h2 className="mb-2 text-lg font-black">{text.owed}</h2>
            {home.amountsOwed.length === 0 && home.goldAmountsOwed.length === 0 && (
              <p className="font-semibold text-gray-700">{text.noOwed}</p>
            )}
            <ul className="space-y-2">
              {home.amountsOwed.map((due) => (
                <li key={due.id} className="flex items-center justify-between gap-3 border-b border-gray-300 py-2">
                  <span className="font-semibold">{text.cash} · {due.daysWaiting} {text.daysWaiting}</span>
                  <span className="text-right font-black tabular-nums">{formatMoney(due.amountPaise)}</span>
                </li>
              ))}
              {home.goldAmountsOwed.map((due) => (
                <li key={due.id} className="flex items-center justify-between gap-3 border-b border-gray-300 py-2">
                  <span className="font-semibold">{text.gold} · {due.daysWaiting} {text.daysWaiting}</span>
                  <span className="text-right font-black tabular-nums">{formatGrams(due.amountMg)} g</span>
                </li>
              ))}
            </ul>
          </section>
          <p className="mt-4 rounded-2xl border border-amber-500 bg-amber-50 p-4 text-sm font-bold text-amber-950">
            {exposureSentence()}
          </p>
        </>
      )}
    </>
  );

  if (assisted) {
    return (
      <section className="rounded-2xl border-2 border-indigo-300 bg-indigo-50 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-indigo-950">{text.assistedTitle}</h2>
            <p className="text-sm font-semibold text-indigo-900">{userName}</p>
          </div>
          <button
            type="button"
            onClick={() => home && speak(spokenScreen)}
            aria-label={text.readWhole}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-indigo-900 text-white"
          >
            <Volume2 aria-hidden="true" size={22} />
          </button>
        </div>
        {screen}
      </section>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-stone-50 px-4 pb-8 pt-4 text-gray-950">
      <header className="mb-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-600">{text.title}</p>
            <h1 className="break-words text-2xl font-black">{home?.karigar.name ?? userName}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label>
              <span className="sr-only">{text.language}</span>
              <select
                aria-label={text.language}
                value={language}
                onChange={(event) => onLanguageChange(event.target.value as LocaleCode)}
                className="min-h-11 max-w-28 rounded-lg border border-gray-400 bg-white px-2 font-bold"
              >
                {localeOptions.map((option) => (
                  <option key={option.code} value={option.code}>{option.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => speak(spokenScreen)}
              aria-label={text.readWhole}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-blue-900 text-white"
            >
              <Volume2 aria-hidden="true" size={22} />
            </button>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                aria-label={localeText[language].app.logout}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-gray-200 text-gray-950"
              >
                <LogOut aria-hidden="true" size={20} />
              </button>
            )}
          </div>
        </div>
      </header>
      {screen}
    </main>
  );
}
