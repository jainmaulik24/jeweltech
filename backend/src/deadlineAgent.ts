import crypto from 'crypto';
import db from './db';
import { now as clockNow } from './clock';
import {
    calculateDaysUntil,
    calculateDeadlineRisk,
    calculateElapsedHours,
    calculateProgressBps,
    calculateGoldJourneyLoss,
    rankRescueCandidates,
    toFineGoldPerMilleMg,
} from './calc';
import { DEADLINE_CONFIG, DeadlineLanguage } from './deadlineConfig';
import { appendLedgerEvent, replayAndVerifyOrder } from './ledger';
import { PURITY_TABLE } from './agreementConfig';
import { GOLD_JOURNEY_CONFIG } from './goldJourneyConfig';
import type { AccountTag } from './schema';

interface KarigarProfile {
    userId: string;
    name: string;
    language: DeadlineLanguage;
    capacityOpenJobs: number;
    specializations: string[];
    completedJobs: number;
    onTimeJobs: number;
}

interface DeadlineOrderRow {
    id: string;
    jewellerId: string;
    karigarId: string;
    karigarName: string;
    description: string;
    jobType: string;
    dueDate: string;
    occasionDate: string;
}

interface DeadlineAction {
    id: string;
    order_id: string | null;
    due_id: string | null;
    recipient_id: string;
    created_by: string;
    type: string;
    what: string;
    why: string;
    message: string;
    payload_json: string | null;
    status: string;
    idempotency_key: string;
    created_at: string;
    replied_at: string | null;
}

export interface CustodyTransfer {
    id: string;
    order_id: string;
    from_karigar_id: string;
    to_karigar_id: string;
    weight_mg: number;
    purity_per_mille: number;
    created_by: string;
    out_event_id: string;
    in_event_id: string;
    status: 'pending' | 'completed';
    from_acknowledged_at: string | null;
    to_acknowledged_at: string | null;
    idempotency_key: string;
    created_at: string;
    stage: string;
    received_weight_mg: number;
    received_purity_per_mille: number;
    loss_event_id: string | null;
    rejected_at: string | null;
    rejection_reason: string | null;
}

interface ActionInput {
    orderId?: string | null;
    dueId?: string | null;
    recipientId: string;
    createdBy: string;
    type: string;
    what: string;
    why: string;
    message: string;
    payload?: unknown;
    status?: string;
    idempotencyKey: string;
    createdAt: Date;
}

const formatPaise = (paise: number) => new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
}).format(paise / 100);

function fillTemplate(template: string, values: Record<string, string | number>): string {
    return template.replace(/\{([^}]+)\}/g, (_match, key: string) => String(values[key] ?? ''));
}

function getProfile(userId: string): KarigarProfile {
    const row = db.prepare(`
        SELECT p.user_id AS userId, u.name, p.language,
            p.capacity_open_jobs AS capacityOpenJobs,
            p.specializations_json AS specializationsJson,
            p.completed_jobs AS completedJobs, p.on_time_jobs AS onTimeJobs
        FROM users u
        LEFT JOIN karigar_profiles p ON p.user_id = u.id
        WHERE u.id = ? AND u.role = 'karigar'
    `).get(userId) as {
        userId: string;
        name: string;
        language: string | null;
        capacityOpenJobs: number | null;
        specializationsJson: string | null;
        completedJobs: number | null;
        onTimeJobs: number | null;
    } | undefined;
    if (!row) throw new Error(`Karigar profile not found for ${userId}.`);
    const specializations = row.specializationsJson ? JSON.parse(row.specializationsJson) as string[] : [];
    return {
        userId: row.userId,
        name: row.name,
        language: row.language === 'kn' ? 'kn' : 'en',
        capacityOpenJobs: row.capacityOpenJobs ?? DEADLINE_CONFIG.defaultCapacityOpenJobs,
        specializations,
        completedJobs: row.completedJobs ?? 0,
        onTimeJobs: row.onTimeJobs ?? 0,
    };
}

function createAction(input: ActionInput): { action: DeadlineAction; created: boolean } {
    const id = `action-${crypto.randomUUID()}`;
    const result = db.prepare(`
        INSERT OR IGNORE INTO deadline_actions
            (id, order_id, due_id, recipient_id, created_by, type, what, why, message,
             payload_json, status, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        input.orderId ?? null,
        input.dueId ?? null,
        input.recipientId,
        input.createdBy,
        input.type,
        input.what,
        input.why,
        input.message,
        input.payload === undefined ? null : JSON.stringify(input.payload),
        input.status ?? 'inbox',
        input.idempotencyKey,
        input.createdAt.toISOString(),
    );
    const action = db.prepare('SELECT * FROM deadline_actions WHERE idempotency_key = ?')
        .get(input.idempotencyKey) as DeadlineAction;
    return { action, created: result.changes > 0 };
}

function getOrderAssessment(order: DeadlineOrderRow, asOf: Date) {
    const profile = getProfile(order.karigarId);
    const replay = replayAndVerifyOrder(order.id, asOf);
    if (!replay.isValidChain) throw new Error(`Ledger replay failed verification for ${order.id}.`);
    const openJobs = (db.prepare(`
        SELECT COUNT(*) AS count FROM orders WHERE karigar_id = ? AND status = 'open'
    `).get(order.karigarId) as { count: number }).count;
    const stageProgressBps = calculateProgressBps(
        replay.issuedMg,
        replay.accountBalances.finished_goods.grossMg + replay.accountBalances.refiner.grossMg,
        replay.accountBalances.scrap.grossMg,
    );
    const daysLeft = calculateDaysUntil(order.occasionDate, asOf);
    const risk = calculateDeadlineRisk({
        daysLeft,
        progressBps: stageProgressBps,
        openJobs,
        capacityOpenJobs: profile.capacityOpenJobs,
        completedJobs: profile.completedJobs,
        onTimeJobs: profile.onTimeJobs,
    }, DEADLINE_CONFIG.risk);
    return {
        ...order,
        daysLeft,
        stageProgressBps,
        openJobs,
        capacityOpenJobs: profile.capacityOpenJobs,
        onTimeJobs: profile.onTimeJobs,
        completedJobs: profile.completedJobs,
        risk,
        heldGrossMg: replay.accountBalances.karigar_wip.grossMg,
        accountBalances: replay.accountBalances,
    };
}

function getOrdersForJeweller(jewellerId?: string, karigarId?: string): DeadlineOrderRow[] {
    const filters = ["o.status = 'open'", 'o.occasion_date IS NOT NULL'];
    const params: string[] = [];
    if (jewellerId) {
        filters.push('o.jeweller_id = ?');
        params.push(jewellerId);
    }
    if (karigarId) {
        filters.push('o.karigar_id = ?');
        params.push(karigarId);
    }
    const query = `
        SELECT o.id, o.jeweller_id AS jewellerId, o.karigar_id AS karigarId,
            k.name AS karigarName, o.description, o.job_type AS jobType,
            o.due_date AS dueDate, o.occasion_date AS occasionDate
        FROM orders o
        JOIN users k ON k.id = o.karigar_id
        WHERE ${filters.join(' AND ')}
        ORDER BY o.due_date, o.id
    `;
    return db.prepare(query).all(...params) as DeadlineOrderRow[];
}

function getRescueCandidates(order: DeadlineOrderRow) {
    const profiles = db.prepare(`
        SELECT p.user_id AS id, u.name,
            p.capacity_open_jobs AS capacityOpenJobs,
            p.specializations_json AS specializationsJson,
            p.completed_jobs AS completedJobs, p.on_time_jobs AS onTimeJobs
        FROM karigar_profiles p
        JOIN users u ON u.id = p.user_id
        WHERE u.role = 'karigar' AND p.user_id != ?
        ORDER BY p.user_id
    `).all(order.karigarId) as Array<{
        id: string;
        name: string;
        capacityOpenJobs: number;
        specializationsJson: string;
        completedJobs: number;
        onTimeJobs: number;
    }>;
    const candidates = profiles.map((profile) => {
        const openJobs = (db.prepare(`
            SELECT COUNT(*) AS count FROM orders WHERE karigar_id = ? AND status = 'open'
        `).get(profile.id) as { count: number }).count;
        return {
            id: profile.id,
            name: profile.name,
            openJobs,
            capacityOpenJobs: profile.capacityOpenJobs,
            specializations: JSON.parse(profile.specializationsJson) as string[],
            completedJobs: profile.completedJobs,
            onTimeJobs: profile.onTimeJobs,
        };
    });
    return rankRescueCandidates({
        jobType: order.jobType,
        candidates,
        config: DEADLINE_CONFIG.rescue,
    });
}

function createRescuePlan(order: DeadlineOrderRow, at: Date): { candidates: ReturnType<typeof getRescueCandidates>; created: boolean } {
    const candidates = getRescueCandidates(order);
    const profile = getProfile(order.karigarId);
    const message = fillTemplate(DEADLINE_CONFIG.templates[profile.language].etaDraft, {
        occasionDate: order.occasionDate.slice(0, 10),
    });
    const created = createAction({
        orderId: order.id,
        recipientId: order.jewellerId,
        createdBy: order.jewellerId,
        type: 'rescue_plan',
        what: 'Drafted ranked rescue plan',
        why: `The deadline nudge received no reply within ${DEADLINE_CONFIG.silenceHours} hours.`,
        message: candidates.length > 0 ? 'Review and choose an alternate karigar.' : 'No eligible alternate karigar is available.',
        payload: { candidates },
        idempotencyKey: `deadline:${order.id}:rescue-plan`,
        createdAt: at,
    });
    const eta = createAction({
        orderId: order.id,
        recipientId: order.jewellerId,
        createdBy: order.jewellerId,
        type: 'customer_eta_draft',
        what: 'Drafted customer ETA message',
        why: 'The ETA is a draft for jeweller review and is never sent automatically.',
        message,
        payload: { occasionDate: order.occasionDate, sent: false },
        status: 'draft',
        idempotencyKey: `deadline:${order.id}:customer-eta`,
        createdAt: at,
    });
    return { candidates, created: created.created || eta.created };
}

function processOverdueDues(at: Date, jewellerId?: string): DeadlineAction[] {
    const dues = db.prepare(`
        SELECT d.id, d.order_id AS orderId, d.jeweller_id AS jewellerId,
            d.karigar_id AS karigarId, d.amount_paise AS amountPaise,
            d.pay_by_date AS payByDate, d.created_by AS createdBy,
            d.owner_jeweller_id AS ownerJewellerId
        FROM cash_dues d
        WHERE d.status = 'open' AND d.pay_by_date <= ?
            ${jewellerId ? 'AND d.jeweller_id = ?' : ''}
        ORDER BY d.pay_by_date, d.id
    `).all(...(jewellerId ? [at.toISOString(), jewellerId] : [at.toISOString()])) as Array<{
        id: string;
        orderId: string;
        jewellerId: string;
        karigarId: string;
        amountPaise: number;
        payByDate: string;
        createdBy: string;
        ownerJewellerId: string;
    }>;
    const actions: DeadlineAction[] = [];

    for (const due of dues) {
        const overdueDays = Math.floor(calculateElapsedHours(due.payByDate, at) / 24);
        const amount = formatPaise(due.amountPaise);
        const karigar = getProfile(due.karigarId);
        const templates = DEADLINE_CONFIG.templates[karigar.language];
        const baseValues = { amount, daysOverdue: overdueDays };
        const nudge = createAction({
            orderId: due.orderId,
            dueId: due.id,
            recipientId: due.jewellerId,
            createdBy: due.jewellerId,
            type: 'dues_nudge',
            what: 'Drafted overdue-payment reminder for jeweller',
            why: `The pay-by date ${due.payByDate} has passed by ${overdueDays} days.`,
            message: fillTemplate(templates.duesNudge, baseValues),
            payload: { amountPaise: due.amountPaise, payByDate: due.payByDate, overdueDays },
            idempotencyKey: `dues:${due.id}:jeweller-nudge`,
            createdAt: at,
        });
        actions.push(nudge.action);

        const ageing = createAction({
            orderId: due.orderId,
            dueId: due.id,
            recipientId: due.karigarId,
            createdBy: due.jewellerId,
            type: 'dues_ageing',
            what: 'Displayed payment ageing to karigar',
            why: `The payment is ${overdueDays} days past its pay-by date.`,
            message: fillTemplate(templates.duesAgeing, baseValues),
            payload: { amountPaise: due.amountPaise, payByDate: due.payByDate, overdueDays },
            idempotencyKey: `dues:${due.id}:karigar-ageing`,
            createdAt: at,
        });
        actions.push(ageing.action);

        const createdByRole = db.prepare('SELECT role FROM users WHERE id = ?').get(due.createdBy) as { role: string } | undefined;
        if (createdByRole?.role === 'staff') {
            const escalation = createAction({
                orderId: due.orderId,
                dueId: due.id,
                recipientId: due.ownerJewellerId,
                createdBy: due.jewellerId,
                type: 'owner_escalation',
                what: 'Escalated staff-created overdue payment to owner',
                why: 'The overdue due was created by staff, so owner review is required.',
                message: fillTemplate(templates.ownerEscalation, baseValues),
                payload: { amountPaise: due.amountPaise, payByDate: due.payByDate, overdueDays },
                idempotencyKey: `dues:${due.id}:owner-escalation`,
                createdAt: at,
            });
            actions.push(escalation.action);
        }
    }

    return actions;
}

export const deadlineAgentTools = {
    draftNudge(language: DeadlineLanguage, name: string, daysLeft: number): string {
        return fillTemplate(DEADLINE_CONFIG.templates[language].nudge, { name, daysLeft });
    },
    draftRescuePlan(input: Parameters<typeof rankRescueCandidates>[0]) {
        return rankRescueCandidates(input);
    },
    draftCustomerEta(language: DeadlineLanguage, occasionDate: string): string {
        return fillTemplate(DEADLINE_CONFIG.templates[language].etaDraft, { occasionDate: occasionDate.slice(0, 10) });
    },
};

export function getDeadlineAssessments(asOf: Date = clockNow(), jewellerId?: string, karigarId?: string) {
    return getOrdersForJeweller(jewellerId, karigarId).map((order) => getOrderAssessment(order, asOf));
}

export function runAgentTick(at: Date = clockNow(), jewellerId?: string): { evaluatedAt: string; actions: DeadlineAction[] } {
    const actions: DeadlineAction[] = [];
    const assessments = getDeadlineAssessments(at, jewellerId);
    for (const assessment of assessments) {
        if (assessment.risk.level !== 'at_risk') continue;
        const profile = getProfile(assessment.karigarId);
        const nudge = createAction({
            orderId: assessment.id,
            recipientId: assessment.karigarId,
            createdBy: assessment.jewellerId,
            type: 'karigar_nudge',
            what: 'Drafted simulated deadline nudge for karigar',
            why: `Rule-based risk score ${assessment.risk.score}: ${assessment.risk.reasons.join(', ')}.`,
            message: deadlineAgentTools.draftNudge(profile.language, assessment.karigarName, assessment.daysLeft),
            payload: { risk: assessment.risk, daysLeft: assessment.daysLeft },
            idempotencyKey: `deadline:${assessment.id}:karigar-nudge`,
            createdAt: at,
        });
        if (nudge.created) actions.push(nudge.action);

        const elapsedHours = calculateElapsedHours(nudge.action.created_at, at);
        if (nudge.action.status === 'replied' || elapsedHours < DEADLINE_CONFIG.silenceHours) continue;

        const escalation = createAction({
            orderId: assessment.id,
            recipientId: assessment.jewellerId,
            createdBy: assessment.jewellerId,
            type: 'silence_escalation',
            what: 'Escalated unanswered karigar nudge',
            why: `No reply was recorded within ${DEADLINE_CONFIG.silenceHours} hours.`,
            message: fillTemplate(DEADLINE_CONFIG.templates[profile.language].escalation, {
                hours: DEADLINE_CONFIG.silenceHours,
            }),
            idempotencyKey: `deadline:${assessment.id}:silence-escalation`,
            createdAt: at,
        });
        if (escalation.created) actions.push(escalation.action);

        const plan = createRescuePlan(assessment, at);
        if (plan.created) {
            const rescueAction = db.prepare(`
                SELECT * FROM deadline_actions WHERE idempotency_key = ?
            `).get(`deadline:${assessment.id}:rescue-plan`) as DeadlineAction;
            actions.push(rescueAction);
            const etaAction = db.prepare(`
                SELECT * FROM deadline_actions WHERE idempotency_key = ?
            `).get(`deadline:${assessment.id}:customer-eta`) as DeadlineAction;
            actions.push(etaAction);
        }
    }

    actions.push(...processOverdueDues(at, jewellerId));
    return { evaluatedAt: at.toISOString(), actions };
}

export function markNudgeReplied(actionId: string, actorId: string, at: Date = clockNow()): void {
    const action = db.prepare('SELECT * FROM deadline_actions WHERE id = ?').get(actionId) as DeadlineAction | undefined;
    if (!action) throw new Error('Inbox action not found.');
    if (action.type !== 'karigar_nudge' || action.recipient_id !== actorId) {
        throw new Error('Only the addressed karigar can reply to this nudge.');
    }
    if (action.status === 'replied') return;
    db.prepare('UPDATE deadline_actions SET status = ?, replied_at = ? WHERE id = ?')
        .run('replied', at.toISOString(), actionId);
}

export function getDeadlineBoard(actorId: string, asOf: Date = clockNow()) {
    const actor = db.prepare('SELECT id, name, role FROM users WHERE id = ?')
        .get(actorId) as { id: string; name: string; role: string } | undefined;
    if (!actor) throw new Error('User not found.');
    if (actor.role !== 'jeweller' && actor.role !== 'karigar' && actor.role !== 'staff') {
        throw new Error('Unauthorized role.');
    }
    let jewellerId: string | undefined;
    if (actor.role === 'jeweller') jewellerId = actor.id;
    if (actor.role === 'staff') {
        const staff = db.prepare('SELECT owner_jeweller_id AS ownerJewellerId FROM staff_profiles WHERE user_id = ?')
            .get(actor.id) as { ownerJewellerId: string } | undefined;
        if (!staff) throw new Error('Staff owner is not configured.');
        jewellerId = staff.ownerJewellerId;
    }
    const orders = actor.role === 'karigar'
        ? getDeadlineAssessments(asOf, undefined, actor.id)
        : getDeadlineAssessments(asOf, jewellerId);

    const dues = db.prepare(`
        SELECT id, order_id AS orderId, jeweller_id AS jewellerId, karigar_id AS karigarId,
            amount_paise AS amountPaise, pay_by_date AS payByDate, status
        FROM cash_dues
        WHERE ${actor.role === 'karigar' ? 'karigar_id = ?' : actor.role === 'staff' ? 'created_by = ?' : 'jeweller_id = ?'}
        ORDER BY pay_by_date
    `).all(actor.id) as Array<{
        id: string;
        orderId: string;
        jewellerId: string;
        karigarId: string;
        amountPaise: number;
        payByDate: string;
        status: string;
    }>;
    const agedDues = dues.map((due) => ({
        ...due,
        overdueDays: due.status === 'open'
            ? Math.floor(calculateElapsedHours(due.payByDate, asOf) / 24)
            : 0,
        label: 'SIMULATED',
    }));

    const actions = actor.role === 'karigar'
        ? db.prepare(`
            SELECT * FROM deadline_actions
            WHERE recipient_id = ? ORDER BY created_at DESC, rowid DESC
        `).all(actor.id)
        : actor.role === 'staff'
            ? db.prepare(`
                SELECT a.* FROM deadline_actions a
                WHERE a.recipient_id = ? OR a.created_by = ?
                ORDER BY a.created_at DESC, a.rowid DESC
            `).all(actor.id, actor.id)
            : db.prepare(`
            SELECT a.* FROM deadline_actions a
            WHERE a.recipient_id = ?
                OR a.order_id IN (SELECT id FROM orders WHERE jeweller_id = ?)
            ORDER BY a.created_at DESC, a.rowid DESC
        `).all(actor.id, jewellerId ?? actor.id);
    const transfers = actor.role === 'karigar'
        ? db.prepare(`
            SELECT t.*, o.description FROM custody_transfers t
            JOIN orders o ON o.id = t.order_id
            WHERE t.from_karigar_id = ? OR t.to_karigar_id = ?
            ORDER BY t.created_at DESC
        `).all(actor.id, actor.id)
        : actor.role === 'staff'
            ? db.prepare(`
            SELECT t.*, o.description FROM custody_transfers t
            JOIN orders o ON o.id = t.order_id
            WHERE (t.from_karigar_id = ? OR t.to_karigar_id = ?)
                AND o.jeweller_id = ?
            ORDER BY t.created_at DESC
        `).all(actor.id, actor.id, jewellerId)
        : db.prepare(`
            SELECT t.*, o.description FROM custody_transfers t
            JOIN orders o ON o.id = t.order_id
            WHERE o.jeweller_id = ? ORDER BY t.created_at DESC
        `).all(jewellerId ?? actor.id);

    return {
        actor,
        asOf: asOf.toISOString(),
        orders,
        dues: agedDues,
        inbox: (actions as DeadlineAction[]).filter((action) => action.recipient_id === actor.id),
        actionLog: actions,
        custodyTransfers: transfers,
        fastForward: {
            maxHours: DEADLINE_CONFIG.maxFastForwardHours,
            stepHours: DEADLINE_CONFIG.fastForwardStepHours,
            silenceHours: DEADLINE_CONFIG.silenceHours,
        },
    };
}

export function transferCustody(input: {
    orderId: string;
    fromKarigarId: string;
    toKarigarId: string;
    weightMg: number;
    purityPerMille: number;
    receivedWeightMg?: number;
    receivedPurityPerMille?: number;
    stage?: string;
    createdBy: string;
    idempotencyKey: string;
}): CustodyTransfer {
    if (input.fromKarigarId === input.toKarigarId) throw new Error('Custody transfer requires two different karigars.');
    if (!Number.isInteger(input.weightMg) || input.weightMg <= 0) throw new Error('Transfer weight must be positive integer mg.');
    if (!PURITY_TABLE.some((purity) => purity.perMille === input.purityPerMille)) {
        throw new Error('Transfer purity must use a configured per-mille reading.');
    }
    const receivedWeightMg = input.receivedWeightMg ?? input.weightMg;
    const receivedPurityPerMille = input.receivedPurityPerMille ?? input.purityPerMille;
    if (!Number.isInteger(receivedWeightMg) || receivedWeightMg <= 0) {
        throw new Error('Received weight must be positive integer mg.');
    }
    if (!PURITY_TABLE.some((purity) => purity.perMille === receivedPurityPerMille)) {
        throw new Error('Received purity must use a configured per-mille reading.');
    }
    const stage = input.stage ?? 'reassignment';
    if (!GOLD_JOURNEY_CONFIG.stages.some((configuredStage) => configuredStage.id === stage)) {
        throw new Error(`Unsupported gold journey stage: ${stage}.`);
    }
    const loss = calculateGoldJourneyLoss({
        sentGrossMg: input.weightMg,
        sentPurityPerMille: input.purityPerMille,
        receivedGrossMg: receivedWeightMg,
        receivedPurityPerMille,
    });
    const existing = db.prepare('SELECT * FROM custody_transfers WHERE idempotency_key = ?')
        .get(input.idempotencyKey) as CustodyTransfer | undefined;
    if (existing) {
        const sameRequest = existing.order_id === input.orderId
            && existing.from_karigar_id === input.fromKarigarId
            && existing.to_karigar_id === input.toKarigarId
            && existing.weight_mg === input.weightMg
            && existing.purity_per_mille === input.purityPerMille
            && existing.received_weight_mg === receivedWeightMg
            && existing.received_purity_per_mille === receivedPurityPerMille
            && existing.stage === stage
            && existing.created_by === input.createdBy;
        if (!sameRequest) throw new Error('Custody idempotency key was already used for a different transfer.');
        return existing;
    }
    const order = db.prepare('SELECT jeweller_id AS jewellerId, karigar_id AS karigarId FROM orders WHERE id = ?')
        .get(input.orderId) as { jewellerId: string; karigarId: string } | undefined;
    if (!order) throw new Error('Order not found.');
    const currentCustodian = getCurrentCustodian(input.orderId, order.karigarId);
    if (currentCustodian.id !== input.fromKarigarId) {
        throw new Error('Transfer must start with the current custodian.');
    }
    if (input.createdBy !== order.jewellerId && input.createdBy !== input.fromKarigarId) {
        throw new Error('Only the order jeweller or current custodian may propose this handoff.');
    }
    const incomingParty = db.prepare("SELECT id, role FROM users WHERE id = ? AND role IN ('karigar', 'staff', 'jeweller')")
        .get(input.toKarigarId) as { id: string; role: string } | undefined;
    if (!incomingParty) throw new Error('Incoming custodian must be a configured karigar, helper, or jeweller.');

    const replay = replayAndVerifyOrder(input.orderId);
    if (!replay.isValidChain) throw new Error('Cannot transfer custody while ledger verification fails.');
    const outgoingAccount: AccountTag = currentCustodian.role === 'jeweller' ? 'finished_goods' : 'karigar_wip';
    const heldGold = replay.accountBalances[outgoingAccount];
    if (input.weightMg !== heldGold.grossMg) {
        throw new Error('Handoff weight must match all acknowledged gold held by the current custodian.');
    }
    if (toFineGoldPerMilleMg(input.weightMg, input.purityPerMille) !== heldGold.fineMg) {
        throw new Error('Sender purity does not match the acknowledged fine gold held by the current custodian.');
    }
    const pendingTransfer = db.prepare(`
        SELECT id FROM custody_transfers WHERE order_id = ? AND status = 'pending' AND rejected_at IS NULL
    `).get(input.orderId);
    if (pendingTransfer) throw new Error('A custody transfer is already awaiting acknowledgements.');

    return db.transaction(() => {
        const transferId = `custody-${crypto.randomUUID()}`;
        const outEventId = `evt-${crypto.randomUUID()}`;
        const inEventId = `evt-${crypto.randomUUID()}`;
        const lossEventId = loss.grossLossMg > 0 || loss.fineLossMg > 0
            ? `evt-${crypto.randomUUID()}`
            : null;
        const incomingAccount: AccountTag = incomingParty.role === 'jeweller' ? 'finished_goods' : 'karigar_wip';
        appendLedgerEvent({
            id: outEventId,
            orderId: input.orderId,
            type: 'custody_transfer_out',
            weightMg: input.weightMg,
            purityPerMille: input.purityPerMille,
            debitAccount: outgoingAccount,
            creditAccount: 'jeweller_vault',
            status: 'pending_ack',
            createdBy: input.createdBy,
            notes: `Gold journey ${stage}: ${transferId}; sender ${input.fromKarigarId} weighed ${input.weightMg} mg at ${input.purityPerMille}‰.`,
            stage,
            idempotencyKey: `${input.idempotencyKey}-out`,
        });
        appendLedgerEvent({
            id: inEventId,
            orderId: input.orderId,
            type: 'custody_transfer_in',
            weightMg: receivedWeightMg,
            purityPerMille: receivedPurityPerMille,
            debitAccount: 'jeweller_vault',
            creditAccount: incomingAccount,
            status: 'pending_ack',
            createdBy: input.createdBy,
            notes: `Gold journey ${stage}: ${transferId}; receiver ${input.toKarigarId} weighed ${receivedWeightMg} mg at ${receivedPurityPerMille}‰.`,
            stage,
            idempotencyKey: `${input.idempotencyKey}-in`,
        });
        if (lossEventId) {
            appendLedgerEvent({
                id: lossEventId,
                orderId: input.orderId,
                type: 'custody_loss',
                weightMg: loss.grossLossMg,
                fineWeightMg: loss.fineLossMg,
                debitAccount: 'jeweller_vault',
                creditAccount: 'process_loss',
                status: 'pending_ack',
                createdBy: input.createdBy,
                notes: `Gold journey ${stage}: loss attributed to ${input.fromKarigarId}.`,
                stage,
                idempotencyKey: `${input.idempotencyKey}-loss`,
            });
        }
        const createdAt = clockNow().toISOString();
        db.prepare(`
            INSERT INTO custody_transfers
                (id, order_id, from_karigar_id, to_karigar_id, weight_mg, purity_per_mille,
                 created_by, out_event_id, in_event_id, idempotency_key, created_at,
                 stage, received_weight_mg, received_purity_per_mille, loss_event_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            transferId,
            input.orderId,
            input.fromKarigarId,
            input.toKarigarId,
            input.weightMg,
            input.purityPerMille,
            input.createdBy,
            outEventId,
            inEventId,
            input.idempotencyKey,
            createdAt,
            stage,
            receivedWeightMg,
            receivedPurityPerMille,
            lossEventId,
        );
        createAction({
            orderId: input.orderId,
            recipientId: input.fromKarigarId,
            createdBy: input.createdBy,
            type: 'custody_approval',
            what: 'Requested outgoing custody acknowledgement',
            why: `The ${stage} handoff was proposed to ${input.toKarigarId}.`,
            message: `SIMULATED: confirm handover of ${input.weightMg} mg at ${input.purityPerMille}‰ for ${stage}.`,
            payload: { transferId, eventId: outEventId },
            idempotencyKey: `${input.idempotencyKey}:from-approval`,
            createdAt: clockNow(),
        });
        createAction({
            orderId: input.orderId,
            recipientId: input.toKarigarId,
            createdBy: input.createdBy,
            type: 'custody_approval',
            what: 'Requested incoming custody acknowledgement',
            why: `The ${stage} handoff is waiting for receiver weigh-in confirmation.`,
            message: `SIMULATED: confirm receipt of ${receivedWeightMg} mg at ${receivedPurityPerMille}‰ for ${stage}.`,
            payload: { transferId, eventId: inEventId },
            idempotencyKey: `${input.idempotencyKey}:to-approval`,
            createdAt: clockNow(),
        });
        return db.prepare('SELECT * FROM custody_transfers WHERE id = ?').get(transferId) as CustodyTransfer;
    })();
}

export function acknowledgeCustodyTransfer(
    transferId: string,
    actorId: string,
    at: Date = clockNow(),
): CustodyTransfer {
    const transfer = db.prepare('SELECT * FROM custody_transfers WHERE id = ?')
        .get(transferId) as CustodyTransfer | undefined;
    if (!transfer) throw new Error('Custody transfer not found.');
    if (transfer.status === 'completed') return transfer;
    if (transfer.rejected_at) throw new Error('This custody handoff was rejected.');
    const isFrom = actorId === transfer.from_karigar_id;
    const isTo = actorId === transfer.to_karigar_id;
    if (!isFrom && !isTo) throw new Error('Only the sender or receiver may acknowledge custody.');
    if (isTo && !transfer.from_acknowledged_at) {
        throw new Error('The sender must acknowledge handover before receipt can be approved.');
    }

    return db.transaction(() => {
        const alreadyAcknowledged = isFrom ? transfer.from_acknowledged_at : transfer.to_acknowledged_at;
        if (!alreadyAcknowledged) {
            db.prepare(isFrom
                ? 'UPDATE custody_transfers SET from_acknowledged_at = ? WHERE id = ?'
                : 'UPDATE custody_transfers SET to_acknowledged_at = ? WHERE id = ?')
                .run(at.toISOString(), transferId);
            createAction({
                orderId: transfer.order_id,
                recipientId: actorId,
                createdBy: actorId,
                type: 'custody_acknowledged',
                what: 'Acknowledged custody transfer leg',
                why: isFrom ? 'The sender confirmed handover.' : 'The receiver confirmed receipt.',
                message: 'Custody acknowledgement recorded.',
                payload: { transferId, stage: transfer.stage },
                status: 'completed',
                idempotencyKey: `custody:${transferId}:ack:${actorId}`,
                createdAt: at,
            });
        }

        const updated = db.prepare('SELECT * FROM custody_transfers WHERE id = ?').get(transferId) as CustodyTransfer;
        if (updated.from_acknowledged_at && updated.to_acknowledged_at) {
            const eventIds = [updated.out_event_id, updated.in_event_id, updated.loss_event_id]
                .filter((eventId): eventId is string => eventId !== null);
            const acknowledgeEvents = db.prepare(`
                UPDATE ledger_events SET status = 'acknowledged', acknowledged_at = ?
                WHERE id = ? AND status = 'pending_ack'
            `);
            for (const eventId of eventIds) {
                if (acknowledgeEvents.run(at.toISOString(), eventId).changes !== 1) {
                    throw new Error('A custody ledger event is not awaiting acknowledgement.');
                }
            }
            db.prepare("UPDATE custody_transfers SET status = 'completed' WHERE id = ?").run(transferId);
            const receiver = db.prepare('SELECT role FROM users WHERE id = ?').get(updated.to_karigar_id) as { role: string };
            if (receiver.role === 'karigar') {
                db.prepare('UPDATE orders SET karigar_id = ? WHERE id = ?')
                    .run(updated.to_karigar_id, updated.order_id);
            }
            createAction({
                orderId: transfer.order_id,
                recipientId: transfer.created_by,
                createdBy: transfer.created_by,
                type: 'custody_completed',
                what: 'Completed acknowledged custody transfer',
                why: 'Both sender and receiver acknowledged the balanced ledger legs.',
                message: `The ${transfer.stage} handoff is complete.`,
                payload: { transferId, stage: transfer.stage },
                status: 'completed',
                idempotencyKey: `custody:${transferId}:completed`,
                createdAt: at,
            });
        }
        return db.prepare('SELECT * FROM custody_transfers WHERE id = ?').get(transferId) as CustodyTransfer;
    })();
}

export function rejectCustodyTransfer(
    transferId: string,
    actorId: string,
    reason: string,
    at: Date = clockNow(),
): CustodyTransfer {
    const transfer = db.prepare('SELECT * FROM custody_transfers WHERE id = ?')
        .get(transferId) as CustodyTransfer | undefined;
    if (!transfer) throw new Error('Custody transfer not found.');
    if (transfer.status === 'completed') throw new Error('A completed custody handoff cannot be rejected.');
    if (transfer.rejected_at) return transfer;
    if (actorId !== transfer.from_karigar_id && actorId !== transfer.to_karigar_id) {
        throw new Error('Only the sender or receiver may reject custody.');
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason || trimmedReason.length > 300) throw new Error('A rejection reason of 1-300 characters is required.');

    return db.transaction(() => {
        const rejectedAt = at.toISOString();
        db.prepare(`
            UPDATE custody_transfers SET rejected_at = ?, rejection_reason = ?
            WHERE id = ? AND status = 'pending' AND rejected_at IS NULL
        `).run(rejectedAt, trimmedReason, transferId);
        const eventIds = [transfer.out_event_id, transfer.in_event_id, transfer.loss_event_id]
            .filter((eventId): eventId is string => eventId !== null);
        for (const eventId of eventIds) {
            db.prepare("UPDATE ledger_events SET status = 'contested' WHERE id = ? AND status = 'pending_ack'")
                .run(eventId);
        }
        createAction({
            orderId: transfer.order_id,
            recipientId: transfer.created_by,
            createdBy: actorId,
            type: 'custody_rejected',
            what: 'Rejected gold custody handoff',
            why: trimmedReason,
            message: 'The handoff was rejected; the gold remains with the sender.',
            payload: { transferId, stage: transfer.stage, reason: trimmedReason },
            status: 'completed',
            idempotencyKey: `custody:${transferId}:rejected`,
            createdAt: at,
        });
        return db.prepare('SELECT * FROM custody_transfers WHERE id = ?').get(transferId) as CustodyTransfer;
    })();
}

function getCurrentCustodian(orderId: string, initialKarigarId: string): { id: string; role: string; name: string } {
    const lastHandoff = db.prepare(`
        SELECT to_karigar_id AS id FROM custody_transfers
        WHERE order_id = ? AND status = 'completed'
        ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(orderId) as { id: string } | undefined;
    const custodianId = lastHandoff?.id ?? initialKarigarId;
    const custodian = db.prepare('SELECT id, role, name FROM users WHERE id = ?')
        .get(custodianId) as { id: string; role: string; name: string } | undefined;
    if (!custodian) throw new Error('Current gold custodian was not found.');
    return custodian;
}

export function getGoldJourney(orderId: string, actorId: string) {
    const order = db.prepare(`
        SELECT o.id, o.jeweller_id AS jewellerId, o.karigar_id AS karigarId,
            o.description, o.job_type AS jobType
        FROM orders o WHERE o.id = ?
    `).get(orderId) as {
        id: string;
        jewellerId: string;
        karigarId: string;
        description: string;
        jobType: string;
    } | undefined;
    if (!order) throw new Error('Order not found.');
    const isParticipant = Boolean(db.prepare(`
        SELECT id FROM custody_transfers
        WHERE order_id = ? AND (from_karigar_id = ? OR to_karigar_id = ?)
        LIMIT 1
    `).get(orderId, actorId, actorId));
    const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId) as { role: string } | undefined;
    if (!actor || (actorId !== order.jewellerId && actorId !== order.karigarId && !isParticipant)) {
        throw new Error('Unauthorized: You do not have access to this gold journey.');
    }
    if (actor.role === 'staff') {
        const staff = db.prepare('SELECT owner_jeweller_id AS ownerJewellerId FROM staff_profiles WHERE user_id = ?')
            .get(actorId) as { ownerJewellerId: string } | undefined;
        if (!staff || staff.ownerJewellerId !== order.jewellerId) {
            throw new Error('Unauthorized: Helper belongs to another jeweller.');
        }
    }

    const rows = db.prepare(`
        SELECT t.*, sender.name AS fromName, receiver.name AS toName,
            out_event.created_at AS sentAt, in_event.created_at AS receivedAt
        FROM custody_transfers t
        JOIN users sender ON sender.id = t.from_karigar_id
        JOIN users receiver ON receiver.id = t.to_karigar_id
        JOIN ledger_events out_event ON out_event.id = t.out_event_id
        JOIN ledger_events in_event ON in_event.id = t.in_event_id
        WHERE t.order_id = ?
        ORDER BY t.created_at, t.rowid
    `).all(orderId) as Array<CustodyTransfer & {
        fromName: string;
        toName: string;
        sentAt: string;
        receivedAt: string;
    }>;
    const stages = rows.map((row) => {
        const loss = calculateGoldJourneyLoss({
            sentGrossMg: row.weight_mg,
            sentPurityPerMille: row.purity_per_mille,
            receivedGrossMg: row.received_weight_mg,
            receivedPurityPerMille: row.received_purity_per_mille,
        });
        const configuredStage = GOLD_JOURNEY_CONFIG.stages.find(({ id }) => id === row.stage);
        return {
            id: row.id,
            stage: row.stage,
            stageLabel: configuredStage?.label ?? row.stage,
            fromPartyId: row.from_karigar_id,
            fromName: row.fromName,
            toPartyId: row.to_karigar_id,
            toName: row.toName,
            sentGrossMg: row.weight_mg,
            sentPurityPerMille: row.purity_per_mille,
            receivedGrossMg: row.received_weight_mg,
            receivedPurityPerMille: row.received_purity_per_mille,
            ...loss,
            status: row.rejected_at ? 'rejected' : row.status,
            rejectedAt: row.rejected_at,
            rejectionReason: row.rejection_reason,
            senderAcknowledgedAt: row.from_acknowledged_at,
            receiverAcknowledgedAt: row.to_acknowledged_at,
            sentAt: row.sentAt,
            receivedAt: row.receivedAt,
        };
    });
    const completedStages = stages.filter((stage) => stage.status === 'completed');
    const currentCustodian = getCurrentCustodian(orderId, order.karigarId);
    const replay = replayAndVerifyOrder(orderId);
    if (!replay.isValidChain) throw new Error('Gold journey ledger verification failed.');
    const initialLots = db.prepare(`
        SELECT weight_mg AS grossMg, fine_weight_mg AS fineMg, purity_per_mille AS purityPerMille,
            created_at AS createdAt
        FROM ledger_events
        WHERE order_id = ? AND type = 'issue' AND status = 'acknowledged'
        ORDER BY created_at, rowid
    `).all(orderId) as Array<{
        grossMg: number;
        fineMg: number;
        purityPerMille: number;
        createdAt: string;
    }>;
    const participants = db.prepare(`
        SELECT id, name, role FROM users
        WHERE id = ? OR id = ? OR id IN (
            SELECT from_karigar_id FROM custody_transfers WHERE order_id = ?
            UNION
            SELECT to_karigar_id FROM custody_transfers WHERE order_id = ?
        )
        ORDER BY id
    `).all(order.jewellerId, order.karigarId, orderId, orderId) as Array<{
        id: string;
        name: string;
        role: string;
    }>;
    return {
        order: { id: order.id, description: order.description ?? 'Gold work', jobType: order.jobType },
        currentCustodian,
        canProposeHandoff: (actorId === currentCustodian.id || actorId === order.jewellerId)
            && replay.accountBalances[currentCustodian.role === 'jeweller' ? 'finished_goods' : 'karigar_wip'].grossMg > 0,
        stages,
        totals: {
            fineLossMg: completedStages.reduce((sum, stage) => sum + stage.fineLossMg, 0),
            grossLossMg: completedStages.reduce((sum, stage) => sum + stage.grossLossMg, 0),
            completedStages: completedStages.length,
        },
        initialLots,
        accountBalances: replay.accountBalances,
        ledgerVerified: replay.isValidChain,
        stagesConfiguration: GOLD_JOURNEY_CONFIG.stages,
        participants,
    };
}

export function chooseRescueKarigar(orderId: string, karigarId: string, jewellerId: string) {
    const order = db.prepare(`
        SELECT o.id, o.jeweller_id AS jewellerId, o.karigar_id AS karigarId,
            k.name AS karigarName, o.description, o.job_type AS jobType,
            o.due_date AS dueDate, o.occasion_date AS occasionDate
        FROM orders o JOIN users k ON k.id = o.karigar_id WHERE o.id = ?
    `).get(orderId) as DeadlineOrderRow | undefined;
    if (!order || order.jewellerId !== jewellerId) throw new Error('Order not found for this jeweller.');
    const latestPlan = db.prepare(`
        SELECT payload_json AS payloadJson FROM deadline_actions
        WHERE order_id = ? AND type = 'rescue_plan'
        ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(orderId) as { payloadJson: string | null } | undefined;
    if (!latestPlan?.payloadJson) throw new Error('A rescue plan must be available before selecting an alternate.');
    const payload = JSON.parse(latestPlan.payloadJson) as { candidates: Array<{ karigarId: string }> };
    if (!payload.candidates.some((candidate) => candidate.karigarId === karigarId)) {
        throw new Error('The selected karigar is not an eligible candidate in the current rescue plan.');
    }
    if (!getRescueCandidates(order).some((candidate) => candidate.karigarId === karigarId)) {
        throw new Error('The rescue plan is stale; the selected karigar is no longer eligible.');
    }
    const replay = replayAndVerifyOrder(orderId);
    if (!replay.isValidChain) throw new Error('Cannot transfer custody while ledger verification fails.');
    const currentCustodian = getCurrentCustodian(orderId, order.karigarId);
    if (currentCustodian.role === 'jeweller') throw new Error('Gold is already in jeweller custody.');
    const sourceAccount = replay.accountBalances.karigar_wip;
    const weightMg = sourceAccount.grossMg;
    if (weightMg <= 0) throw new Error('There is no acknowledged gold in karigar custody to transfer.');
    const lastReceivedPurity = db.prepare(`
        SELECT received_purity_per_mille AS purityPerMille FROM custody_transfers
        WHERE order_id = ? AND status = 'completed'
        ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(orderId) as { purityPerMille: number | null } | undefined;
    const issuePurities = db.prepare(`
        SELECT DISTINCT purity_per_mille AS purityPerMille FROM ledger_events
        WHERE order_id = ? AND type = 'issue' AND status = 'acknowledged'
    `).all(orderId) as Array<{ purityPerMille: number | null }>;
    const purityPerMille = lastReceivedPurity?.purityPerMille
        ?? (issuePurities.length === 1 ? issuePurities[0].purityPerMille : null);
    if (purityPerMille === null || purityPerMille === undefined
        || toFineGoldPerMilleMg(weightMg, purityPerMille) !== sourceAccount.fineMg) {
        throw new Error('The rescue requires one configured purity matching the current custodian balance.');
    }
    const transfer = transferCustody({
        orderId,
        fromKarigarId: currentCustodian.id,
        toKarigarId: karigarId,
        weightMg,
        purityPerMille,
        receivedWeightMg: weightMg,
        receivedPurityPerMille: purityPerMille,
        stage: 'reassignment',
        createdBy: jewellerId,
        idempotencyKey: `rescue:${orderId}:${currentCustodian.id}:${karigarId}`,
    });
    createAction({
        orderId,
        recipientId: jewellerId,
        createdBy: jewellerId,
        type: 'rescue_selected',
        what: 'Selected alternate karigar',
        why: 'Selection was made by the jeweller from the ranked rescue plan.',
        message: 'The custody transfer is pending acknowledgement from both karigars.',
        payload: { transferId: (transfer as { id: string }).id, karigarId },
        idempotencyKey: `rescue:${orderId}:selected:${karigarId}`,
        createdAt: clockNow(),
    });
    return transfer;
}
