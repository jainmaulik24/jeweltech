import { useEffect, useState } from 'react';

interface JourneyParty {
  id: string;
  name: string;
  role: string;
}

interface JourneyStage {
  id: string;
  stage: string;
  stageLabel: string;
  fromPartyId: string;
  fromName: string;
  toPartyId: string;
  toName: string;
  sentGrossMg: number;
  sentPurityPerMille: number;
  receivedGrossMg: number;
  receivedPurityPerMille: number;
  sentFineMg: number;
  receivedFineMg: number;
  grossLossMg: number;
  fineLossMg: number;
  status: string;
  rejectedAt: string | null;
  rejectionReason: string | null;
  senderAcknowledgedAt: string | null;
  receiverAcknowledgedAt: string | null;
  sentAt: string;
  receivedAt: string;
}

interface Journey {
  order: { id: string; description: string; jobType: string };
  currentCustodian: JourneyParty;
  canProposeHandoff: boolean;
  stages: JourneyStage[];
  totals: { fineLossMg: number; grossLossMg: number; completedStages: number };
  initialLots: Array<{ grossMg: number; fineMg: number; purityPerMille: number; createdAt: string }>;
  accountBalances: Record<string, { grossMg: number; fineMg: number }>;
  ledgerVerified: boolean;
  stagesConfiguration: Array<{ id: string; label: string }>;
  participants: JourneyParty[];
}

interface Props {
  orderId: string;
  userId: string;
}

const grams = (mg: number) => `${(mg / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} g`;

export default function GoldJourneyPanel({ orderId, userId }: Props) {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [stage, setStage] = useState('casting');
  const [toPartyId, setToPartyId] = useState('');
  const [sentWeightMg, setSentWeightMg] = useState('');
  const [sentPurityPerMille, setSentPurityPerMille] = useState('916');
  const [receivedWeightMg, setReceivedWeightMg] = useState('');
  const [receivedPurityPerMille, setReceivedPurityPerMille] = useState('916');
  const [rejectionReason, setRejectionReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orders/${orderId}/gold-journey`, { headers: { 'x-user-id': userId } })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Could not load gold journey.');
        return result as Journey;
      })
      .then((result) => {
        if (cancelled) return;
        setJourney(result);
        setError('');
        const account = result.currentCustodian.role === 'jeweller'
          ? result.accountBalances.finished_goods
          : result.accountBalances.karigar_wip;
        setSentWeightMg(String(account?.grossMg ?? 0));
        setReceivedWeightMg(String(account?.grossMg ?? 0));
        const nextParty = result.participants.find((party) => party.id !== result.currentCustodian.id);
        setToPartyId(nextParty?.id ?? '');
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load gold journey.');
      });
    return () => { cancelled = true; };
  }, [orderId, userId, refresh]);

  const post = async (url: string, body?: unknown) => {
    setBusy(true);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify(body ?? {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'The handoff action failed.');
      setError('');
      setRefresh((current) => current + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The handoff action failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!journey) {
    return (
      <section className="space-y-2 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm" aria-label="Gold Journey">
        <h2 className="font-black text-gray-900">Gold Journey</h2>
        <p role={error ? 'alert' : undefined} className={error ? 'text-sm font-semibold text-red-700' : 'text-sm text-gray-600'}>
          {error || 'Loading gold journey…'}
        </p>
      </section>
    );
  }

  const totalFineIssuedMg = journey.initialLots.reduce((sum, lot) => sum + lot.fineMg, 0);
  const currentFineMg = journey.stages.reduce(
    (current, transfer) => transfer.status === 'completed' ? transfer.receivedFineMg : current,
    totalFineIssuedMg,
  );
  const availableRecipients = journey.participants.filter((party) => party.id !== journey.currentCustodian.id);

  return (
    <section id="gold-journey" className="min-w-0 space-y-4 rounded-3xl border border-sky-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Gold Journey">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-gray-900">Gold Journey</h2>
          <p className="text-sm text-gray-600">Where did the grams go? · SIMULATED weigh-ins</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${journey.ledgerVerified ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'}`}>
          {journey.ledgerVerified ? 'Ledger verified' : 'Ledger verification failed'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-sky-50 p-3">
          <p className="text-xs font-semibold text-gray-600">Fine gold issued</p>
          <strong>{grams(totalFineIssuedMg)}</strong>
        </div>
        <div className="rounded-xl bg-amber-50 p-3">
          <p className="text-xs font-semibold text-gray-600">Fine gold lost across completed stages</p>
          <strong>{grams(journey.totals.fineLossMg)}</strong>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-gray-600">Fine gold after completed handoffs</p>
          <strong>{grams(currentFineMg)}</strong>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-bold text-gray-900">Stage-by-stage waterfall</h3>
        <div className="rounded-xl border border-gray-100 p-3">
          <p className="font-semibold">Issued → {grams(totalFineIssuedMg)} fine gold</p>
        </div>
        {journey.stages.length === 0 && <p className="text-sm text-gray-600">No custody handoffs recorded yet.</p>}
        {journey.stages.map((handoff, index) => (
          <article key={handoff.id} className="min-w-0 space-y-2 rounded-xl border border-gray-200 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="font-bold text-gray-900">{index + 1}. {handoff.stageLabel}: {handoff.fromName} → {handoff.toName}</h4>
                <p className="text-xs text-gray-600">
                  Sent {grams(handoff.sentGrossMg)} at {handoff.sentPurityPerMille}‰ · Received {grams(handoff.receivedGrossMg)} at {handoff.receivedPurityPerMille}‰
                </p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${handoff.status === 'completed' ? 'bg-emerald-100 text-emerald-900' : handoff.status === 'rejected' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'}`}>
                {handoff.status}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <p>Fine sent: <strong>{grams(handoff.sentFineMg)}</strong></p>
              <p>Stage loss: <strong>{grams(handoff.fineLossMg)}</strong></p>
              <p>Fine received: <strong>{grams(handoff.receivedFineMg)}</strong></p>
            </div>
            <p className="text-xs text-gray-600">
              Sender: {handoff.senderAcknowledgedAt ? 'acknowledged' : 'waiting'} · Receiver: {handoff.receiverAcknowledgedAt ? 'acknowledged' : 'waiting'}
            </p>
            {handoff.rejectionReason && <p className="break-words text-sm font-semibold text-red-800">Rejected: {handoff.rejectionReason}</p>}
            {handoff.status === 'pending' && !handoff.rejectedAt && (
              <div className="flex flex-wrap gap-2">
                {((userId === handoff.fromPartyId && !handoff.senderAcknowledgedAt)
                  || (userId === handoff.toPartyId && Boolean(handoff.senderAcknowledgedAt) && !handoff.receiverAcknowledgedAt)) && (
                  <button
                    disabled={busy}
                    onClick={() => void post(`/api/deadline/custody-transfers/${handoff.id}/acknowledge`)}
                    className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {userId === handoff.fromPartyId ? 'Acknowledge handover' : 'Acknowledge receipt'}
                  </button>
                )}
                {(userId === handoff.fromPartyId || userId === handoff.toPartyId) && (
                  <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                    <input
                      value={rejectionReason}
                      onChange={(event) => setRejectionReason(event.target.value)}
                      aria-label="Handoff rejection reason"
                      placeholder="Reason to reject"
                      className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <button
                      disabled={busy || !rejectionReason.trim()}
                      onClick={() => void post(`/api/deadline/custody-transfers/${handoff.id}/reject`, { reason: rejectionReason })}
                      className="rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-800 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="rounded-2xl bg-gray-50 p-4">
        <h3 className="font-bold text-gray-900">Record a stage handoff</h3>
        <p className="mb-3 text-xs text-gray-600">
          Current custodian: {journey.currentCustodian.name}. The sender keeps custody until both parties acknowledge.
        </p>
        {journey.canProposeHandoff ? (
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void post(`/api/orders/${orderId}/gold-journey/handoffs`, {
                toPartyId,
                stage,
                sentWeightMg: Number(sentWeightMg),
                sentPurityPerMille: Number(sentPurityPerMille),
                receivedWeightMg: Number(receivedWeightMg),
                receivedPurityPerMille: Number(receivedPurityPerMille),
                idempotencyKey: `journey:${orderId}:${Date.now()}`,
              });
            }}
          >
            <label className="space-y-1 text-sm font-semibold">
              Stage
              <select value={stage} onChange={(event) => setStage(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white p-2">
                {journey.stagesConfiguration.filter((item) => item.id !== 'reassignment').map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-semibold">
              Receiver
              <select value={toPartyId} onChange={(event) => setToPartyId(event.target.value)} required className="w-full rounded-lg border border-gray-300 bg-white p-2">
                {availableRecipients.map((party) => <option key={party.id} value={party.id}>{party.name} · {party.role}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-semibold">
              Sender weight (mg)
              <input type="number" min="1" step="1" value={sentWeightMg} onChange={(event) => setSentWeightMg(event.target.value)} required className="w-full rounded-lg border border-gray-300 p-2" />
            </label>
            <label className="space-y-1 text-sm font-semibold">
              Sender purity (‰)
              <select value={sentPurityPerMille} onChange={(event) => setSentPurityPerMille(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white p-2">
                {[999, 958, 916, 833, 750, 585].map((purity) => <option key={purity} value={purity}>{purity}‰</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-semibold">
              Receiver weight (mg)
              <input type="number" min="1" step="1" value={receivedWeightMg} onChange={(event) => setReceivedWeightMg(event.target.value)} required className="w-full rounded-lg border border-gray-300 p-2" />
            </label>
            <label className="space-y-1 text-sm font-semibold">
              Receiver purity (‰)
              <select value={receivedPurityPerMille} onChange={(event) => setReceivedPurityPerMille(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white p-2">
                {[999, 958, 916, 833, 750, 585].map((purity) => <option key={purity} value={purity}>{purity}‰</option>)}
              </select>
            </label>
            <button disabled={busy || availableRecipients.length === 0} className="rounded-lg bg-sky-800 px-4 py-3 font-bold text-white disabled:opacity-50 sm:col-span-2">
              Propose handoff
            </button>
          </form>
        ) : (
          <p className="text-sm text-gray-600">Only the current custodian or jeweller can propose the next handoff.</p>
        )}
        {error && <p role="alert" className="mt-3 break-words text-sm font-semibold text-red-700">{error}</p>}
      </div>
    </section>
  );
}
