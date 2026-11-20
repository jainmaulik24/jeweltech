import { useEffect, useState } from 'react';

type Role = 'jeweller' | 'karigar' | 'staff';

interface DeadlineOrder {
  id: string;
  description: string;
  jobType: string;
  karigarId: string;
  karigarName: string;
  occasionDate: string;
  daysLeft: number;
  stageProgressBps: number;
  openJobs: number;
  capacityOpenJobs: number;
  risk: { level: 'ok' | 'watch' | 'at_risk'; score: number; reasons: string[] };
}

interface DeadlineAction {
  id: string;
  order_id: string | null;
  due_id: string | null;
  recipient_id: string;
  type: string;
  what: string;
  why: string;
  message: string;
  payload_json: string | null;
  status: string;
  created_at: string;
  replied_at: string | null;
}

interface DeadlineBoard {
  actor: { id: string; name: string; role: Role };
  orders: DeadlineOrder[];
  dues: Array<{
    id: string;
    orderId: string;
    amountPaise: number;
    payByDate: string;
    overdueDays: number;
    status: string;
    label: string;
  }>;
  inbox: DeadlineAction[];
  actionLog: DeadlineAction[];
  custodyTransfers: Array<{
    id: string;
    order_id: string;
    from_karigar_id: string;
    to_karigar_id: string;
    weight_mg: number;
    purity_per_mille: number;
    status: string;
    from_acknowledged_at: string | null;
    to_acknowledged_at: string | null;
    description: string;
  }>;
  fastForward: { maxHours: number; stepHours: number; silenceHours: number };
}

interface RescueCandidate {
  karigarId: string;
  name: string;
  score: number;
  openJobs: number;
  capacityOpenJobs: number;
  onTimeRateBps: number;
  reasons: string[];
}

interface RescueOption {
  value: string;
  label: string;
  draftOnly: boolean;
}

const money = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(paise / 100);

const riskLabels: Record<string, string> = {
  occasion_soon: 'Customer occasion is close',
  occasion_approaching: 'Customer occasion is approaching',
  stage_behind: 'Stage progress is behind the rule-based target',
  open_load_high: 'Karigar open load is over capacity',
  open_load_elevated: 'Karigar open load is elevated',
  on_time_history_low: 'On-time history is below the configured threshold',
  on_time_history_mixed: 'On-time history needs attention',
};

const candidateLabels: Record<string, string> = {
  capacity_available: 'Capacity available',
  specialization_match: 'Specialization matches this job',
  reliable_history: 'On-time history meets the configured threshold',
};

function parseCandidates(action: DeadlineAction | undefined): RescueCandidate[] {
  if (!action?.payload_json) return [];
  const payload = JSON.parse(action.payload_json) as { candidates?: RescueCandidate[] };
  return payload.candidates ?? [];
}

function parseRescueOptions(action: DeadlineAction | undefined): RescueOption[] {
  if (!action?.payload_json) return [];
  const payload = JSON.parse(action.payload_json) as { options?: RescueOption[] };
  return payload.options ?? [];
}

interface Props {
  userId: string;
  role: Role;
  view?: 'all' | 'rescue' | 'more' | 'controls';
  showDemoControls?: boolean;
}

export default function DeadlinePanel({
  userId,
  role,
  view = 'all',
  showDemoControls = false,
}: Props) {
  const [board, setBoard] = useState<DeadlineBoard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/deadline/board', { headers: { 'x-user-id': userId } });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Could not load deadline inbox.');
        if (!cancelled) {
          setBoard(result as DeadlineBoard);
          setError('');
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load deadline inbox.');
      }
    };
    void load();
    const intervalId = window.setInterval(() => { void load(); }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [userId, refreshKey]);

  const post = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify(body ?? {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Action could not be completed.');
      setRefreshKey((current) => current + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  if (!board) {
    return (
      <section className="space-y-3 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm" aria-live="polite">
        {error ? <p role="alert" className="break-words font-semibold text-red-700">{error}</p> : <p>Loading deadline inbox…</p>}
      </section>
    );
  }

  const rescueActionFor = (orderId: string) => board.actionLog.find(
    (action) => action.order_id === orderId && action.type === 'rescue_plan',
  );
  const riskClass = (level: DeadlineOrder['risk']['level']) => {
    if (level === 'at_risk') return 'bg-red-100 text-red-900';
    if (level === 'watch') return 'bg-amber-100 text-amber-900';
    return 'bg-emerald-100 text-emerald-900';
  };
  const showRescue = view === 'all' || view === 'rescue';
  const showActivity = view === 'all' || view === 'more';
  const showControls = showDemoControls && (view === 'all' || view === 'controls');

  return (
    <section className="min-w-0 space-y-4" aria-label="Deadline and dues">
      {error && <p role="alert" className="break-words rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}

      {showControls && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-black text-gray-900">Deadline demo controls · SIMULATED</h2>
            <p className="text-sm text-gray-600">Fast-forward changes evaluation time only; no messages are sent.</p>
          </div>
          {role === 'jeweller' && (
            <div className="flex flex-wrap gap-2">
              <button
                disabled={busy}
                onClick={() => void post('/api/deadline/tick', { fastForwardHours: 0 })}
                className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                Run agent tick
              </button>
              <button
                disabled={busy}
                onClick={() => void post('/api/deadline/tick', {
                  fastForwardHours: Math.min(board.fastForward.stepHours, board.fastForward.maxHours),
                })}
                className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                Fast-forward {Math.min(board.fastForward.stepHours, board.fastForward.maxHours)}h
              </button>
            </div>
          )}
        </div>
      )}

      {showRescue && (
        <>
        <section className="min-w-0 space-y-4 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-black text-gray-900">Wedding countdown & rescue</h2>
              <p className="text-sm text-gray-600">SIMULATED inbox · drafts and proposals only · no messages are sent</p>
            </div>
            {showControls && role === 'jeweller' && (
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={busy}
                  onClick={() => void post('/api/deadline/tick', { fastForwardHours: 0 })}
                  className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  Run agent tick
                </button>
                <button
                  disabled={busy}
                  onClick={() => void post('/api/deadline/tick', {
                    fastForwardHours: Math.min(board.fastForward.stepHours, board.fastForward.maxHours),
                  })}
                  className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  Fast-forward {Math.min(board.fastForward.stepHours, board.fastForward.maxHours)}h
                </button>
              </div>
            )}
          </div>

        {board.orders.length === 0 ? (
          <p className="text-sm text-gray-600">No customer-occasion jobs need deadline tracking.</p>
        ) : board.orders.map((order) => {
          const rescueAction = rescueActionFor(order.id);
          const candidates = parseCandidates(rescueAction);
          const rescueOptions = parseRescueOptions(rescueAction);
          const transferExists = board.custodyTransfers.some((transfer) => transfer.order_id === order.id);
          const progressPercent = Math.min(100, Math.floor(order.stageProgressBps / 100));
          return (
            <article key={order.id} className="min-w-0 space-y-3 rounded-2xl border border-gray-200 p-4">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="break-words font-black text-gray-900">{order.description}</h3>
                  <p className="text-sm text-gray-600">
                    {order.daysLeft >= 0 ? `${order.daysLeft} days to occasion` : `${Math.abs(order.daysLeft)} days past occasion`}
                    {' · '}Assigned to {order.karigarName}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black uppercase ${riskClass(order.risk.level)}`}>
                  {order.risk.level.replace('_', ' ')}
                </span>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs font-semibold text-gray-600">
                  <span>Stage progress</span><span>{progressPercent}%</span>
                </div>
                <div
                  className="h-3 overflow-hidden rounded-full bg-gray-100"
                  role="progressbar"
                  aria-label="Wedding job stage progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent}
                >
                  <div
                    className={`h-full rounded-full ${order.risk.level === 'at_risk' ? 'bg-red-500' : 'bg-amber-500'}`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
              <p className="text-sm font-semibold text-gray-700">
                {order.openJobs} open jobs · capacity {order.capacityOpenJobs} · risk score {order.risk.score}
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                {order.risk.reasons.map((reason) => <li key={reason}>{riskLabels[reason] ?? reason}</li>)}
              </ul>

              {role === 'jeweller' && candidates.length > 0 && !transferExists && (
                <div className="space-y-2 border-t border-gray-100 pt-3">
                  <h4 className="font-bold text-gray-900">Ranked rescue plan</h4>
                  {candidates.map((candidate) => (
                    <div key={candidate.karigarId} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-3">
                      <div className="min-w-0">
                        <p className="font-bold">{candidate.name}</p>
                        <p className="text-xs text-gray-600">
                          {candidate.openJobs}/{candidate.capacityOpenJobs} jobs · {candidate.onTimeRateBps / 100}% on time
                        </p>
                        <p className="break-words text-xs text-gray-700">
                          {candidate.reasons.map((reason) => candidateLabels[reason] ?? reason).join(' · ')}
                        </p>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() => void post(`/api/deadline/orders/${order.id}/rescue`, { karigarId: candidate.karigarId })}
                        className="shrink-0 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                      >
                        Choose alternate
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {role === 'jeweller' && rescueOptions.map((option) => (
                <div key={option.value} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="font-bold text-amber-950">{option.label}</p>
                  {option.draftOnly && <p className="text-xs text-amber-900">Draft option only · no piece is lent automatically.</p>}
                </div>
              ))}
            </article>
          );
        })}
        </section>

      <section className="min-w-0 space-y-3 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="font-black text-gray-900">Dues chase · SIMULATED</h2>
        {board.dues.length === 0 ? <p className="text-sm text-gray-600">No payment dues are assigned to this account.</p> : (
          board.dues.map((due) => (
            <div key={due.id} className="flex min-w-0 flex-wrap justify-between gap-2 rounded-xl bg-amber-50 p-3">
              <span className="min-w-0 break-words font-semibold">
                Pay by {due.payByDate.slice(0, 10)} · {due.overdueDays > 0 ? `${due.overdueDays} days overdue` : 'Not overdue'}
              </span>
              <strong>{money(due.amountPaise)}</strong>
            </div>
          ))
        )}
      </section>

      {board.custodyTransfers.map((transfer) => {
        const canAcknowledge = transfer.status === 'pending'
          && ((userId === transfer.from_karigar_id && !transfer.from_acknowledged_at)
            || (userId === transfer.to_karigar_id && !transfer.to_acknowledged_at));
        return (
          <section key={transfer.id} className="rounded-3xl border border-indigo-200 bg-indigo-50 p-4">
            <h2 className="font-black text-indigo-950">Custody transfer · {transfer.description}</h2>
            <p className="mt-1 text-sm text-indigo-900">
              {transfer.weight_mg.toLocaleString()} mg at {transfer.purity_per_mille}‰ · {transfer.from_karigar_id} → {transfer.to_karigar_id}
            </p>
            <p className="mt-1 text-xs text-indigo-800">
              Outgoing acknowledgement: {transfer.from_acknowledged_at ? 'done' : 'pending'} · Incoming acknowledgement: {transfer.to_acknowledged_at ? 'done' : 'pending'}
            </p>
            {canAcknowledge && (
              <button
                disabled={busy}
                onClick={() => void post(`/api/deadline/custody-transfers/${transfer.id}/acknowledge`)}
                className="mt-3 rounded-lg bg-indigo-700 px-4 py-2 font-bold text-white disabled:opacity-50"
              >
                Acknowledge my handover / receipt
              </button>
            )}
          </section>
        );
      })}
        </>
      )}

      {showActivity && <section className="min-w-0 space-y-3 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="font-black text-gray-900">Simulated inbox & action log</h2>
        {board.inbox.length === 0 && <p className="text-sm text-gray-600">Inbox is clear.</p>}
        {board.inbox.map((action) => (
          <article key={action.id} className="min-w-0 rounded-xl bg-gray-50 p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <strong className="break-words">{action.what}</strong>
              <span className="text-xs text-gray-500">{new Date(action.created_at).toLocaleString()}</span>
            </div>
            <p className="mt-1 break-words text-sm">{action.message}</p>
            {action.type === 'karigar_nudge' && action.status !== 'replied' && (
              <button
                disabled={busy}
                onClick={() => void post(`/api/deadline/actions/${action.id}/reply`)}
                className="mt-2 rounded-lg bg-gray-200 px-3 py-2 text-sm font-bold disabled:opacity-50"
              >
                Reply to nudge
              </button>
            )}
          </article>
        ))}
        <details>
          <summary className="cursor-pointer font-bold text-indigo-800">View full action log ({board.actionLog.length})</summary>
          <div className="mt-3 space-y-2">
            {board.actionLog.map((action) => (
              <article key={action.id} className="min-w-0 rounded-xl border border-gray-100 p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong className="break-words">{action.what}</strong>
                  <span className="text-xs text-gray-500">{new Date(action.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 break-words text-sm">{action.why}</p>
                <p className="mt-1 break-words text-xs text-gray-600">{action.message}</p>
              </article>
            ))}
          </div>
        </details>
      </section>}
    </section>
  );
}
