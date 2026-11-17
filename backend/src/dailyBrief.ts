import db from './db';
import { now as clockNow } from './clock';
import {
    addHoursToDate,
    calculateAgeingDays,
    calculateDailyBriefRankingScore,
    calculateDailyBriefUrgency,
    calculateDaysOverdue,
    calculateDaysUntil,
    formatPaiseAsRupees,
    calculateGoldValuePaise,
    calculateHoursUntilNextDailyBrief,
    getDateKeyInTimeZone,
    isDailyBriefScheduleDue,
    toFineGoldPerMilleMg,
    sumFineGoldMg,
} from './calc';
import { getDeadlineAssessments } from './deadlineAgent';
import { DAILY_BRIEF_CONFIG, DailyBriefLanguage, DailyBriefRole } from './dailyBriefConfig';
import { getRate } from './rateService';

type DailyBriefCategory =
    | 'at_risk_order'
    | 'overdue_due'
    | 'pending_approval'
    | 'custody_approval'
    | 'flag'
    | 'escalated_dispute'
    | 'due_today'
    | 'owed_cash';

interface DailyBriefActor {
    id: string;
    name: string;
    role: DailyBriefRole;
}

interface BilingualBriefItem {
    id: string;
    category: DailyBriefCategory;
    title: Record<DailyBriefLanguage, string>;
    detail: Record<DailyBriefLanguage, string>;
    amountPaise: number;
    urgencyScore: number;
    rankingScore: number;
    orderId: string;
    eventId: string | null;
    dueId: string | null;
    ageDays: number | null;
    overdueDays: number | null;
    href: string;
}

export interface DailyBriefItem extends Omit<BilingualBriefItem, 'title' | 'detail'> {
    title: string;
    detail: string;
}

function fill(template: string, values: Record<string, string | number>): string {
    return template.replace(/\{([^}]+)\}/g, (_match, key: string) => String(values[key] ?? ''));
}

function getActor(userId: string): DailyBriefActor {
    const actor = db.prepare('SELECT id, name, role FROM users WHERE id = ?')
        .get(userId) as { id: string; name: string; role: DailyBriefRole | 'staff' } | undefined;
    if (!actor) throw new Error('User not found.');
    if (actor.role !== 'jeweller' && actor.role !== 'karigar') {
        throw new Error('Daily briefs are available to jewellers and karigars.');
    }
    return { id: actor.id, name: actor.name, role: actor.role };
}

function createItem(input: {
    id: string;
    category: DailyBriefCategory;
    values: Record<string, string | number>;
    amountPaise: number;
    urgencyScore: number;
    orderId: string;
    eventId?: string | null;
    dueId?: string | null;
    ageDays?: number | null;
    overdueDays?: number | null;
}): BilingualBriefItem {
    const templates: Record<DailyBriefLanguage, Record<string, string>> = DAILY_BRIEF_CONFIG.templates;
    const labelData = input.values;
    const templateNames: Record<DailyBriefCategory, { title: string; detail: string }> = {
        at_risk_order: { title: 'atRiskTitle', detail: 'atRiskDetail' },
        overdue_due: { title: 'overdueTitle', detail: 'overdueDetail' },
        pending_approval: { title: 'approvalTitle', detail: 'approvalDetail' },
        custody_approval: { title: 'approvalTitle', detail: 'approvalDetail' },
        flag: { title: 'flagTitle', detail: 'flagDetail' },
        escalated_dispute: { title: 'disputeTitle', detail: 'disputeDetail' },
        due_today: { title: 'dueTodayTitle', detail: 'dueTodayDetail' },
        owed_cash: { title: 'owedTitle', detail: 'owedDetail' },
    };
    const templateName = templateNames[input.category];
    const eventId = input.eventId ?? null;
    const orderId = input.orderId;
    return {
        id: input.id,
        category: input.category,
        title: {
            en: fill(templates.en[templateName.title], labelData),
            kn: fill(templates.kn[templateName.title], labelData),
        },
        detail: {
            en: fill(templates.en[templateName.detail], labelData),
            kn: fill(templates.kn[templateName.detail], labelData),
        },
        amountPaise: input.amountPaise,
        urgencyScore: input.urgencyScore,
        rankingScore: calculateDailyBriefRankingScore(
            input.amountPaise,
            input.urgencyScore,
            DAILY_BRIEF_CONFIG.ranking,
        ),
        orderId,
        eventId,
        dueId: input.dueId ?? null,
        ageDays: input.ageDays ?? null,
        overdueDays: input.overdueDays ?? null,
        href: input.category === 'custody_approval'
            ? '#gold-journey'
            : eventId && input.category === 'pending_approval'
                ? `#ledger-event-${encodeURIComponent(eventId)}`
                : eventId && input.category === 'escalated_dispute'
                    ? `#dispute-entry-${encodeURIComponent(eventId)}`
            : `#order-${encodeURIComponent(orderId)}`,
    };
}

function eventAmountPaise(
    event: { amountPaise: number; fineWeightMg: number | null; weightMg: number; purityPerMille: number | null },
    ratePaisePerGram: number,
): number {
    if (event.amountPaise > 0) return event.amountPaise;
    const fineGoldMg = event.fineWeightMg ?? (
        event.purityPerMille === null ? 0 : toFineGoldPerMilleMg(event.weightMg, event.purityPerMille)
    );
    return calculateGoldValuePaise(fineGoldMg, ratePaisePerGram);
}

function getPendingLedgerEvents(actor: DailyBriefActor) {
    const ownerColumn = actor.role === 'jeweller' ? 'o.jeweller_id' : 'o.karigar_id';
    const rows = db.prepare(`
        SELECT e.id, e.order_id AS orderId, e.type, e.amount AS amountPaise,
            e.weight_mg AS weightMg, e.fine_weight_mg AS fineWeightMg,
            e.purity_per_mille AS purityPerMille, e.created_by AS createdBy,
            e.created_at AS createdAt, o.description
        FROM ledger_events e
        JOIN orders o ON o.id = e.order_id
        WHERE ${ownerColumn} = ? AND e.status = 'pending_ack'
            AND e.created_by != ? AND e.type NOT IN ('custody_transfer_out', 'custody_transfer_in')
        ORDER BY e.created_at, e.id
    `).all(actor.id, actor.id) as Array<{
        id: string;
        orderId: string;
        type: string;
        amountPaise: number;
        weightMg: number;
        fineWeightMg: number | null;
        purityPerMille: number | null;
        createdBy: string;
        createdAt: string;
        description: string;
    }>;
    return rows;
}

function buildJewellerItems(actor: DailyBriefActor, asOf: Date): BilingualBriefItem[] {
    const ratePaisePerGram = getRate(asOf).ratePaisePerGram;
    const items: BilingualBriefItem[] = [];

    for (const order of getDeadlineAssessments(asOf, actor.id)) {
        if (order.risk.level !== 'at_risk') continue;
        const physicalFineMg = sumFineGoldMg(
            order.accountBalances.karigar_wip.fineMg,
            order.accountBalances.finished_goods.fineMg,
            order.accountBalances.scrap.fineMg,
            order.accountBalances.refiner.fineMg,
        );
        const amountPaise = calculateGoldValuePaise(physicalFineMg, ratePaisePerGram);
        items.push(createItem({
            id: `risk:${order.id}`,
            category: 'at_risk_order',
            values: {
                description: order.description,
                value: formatPaiseAsRupees(amountPaise),
                daysLeft: order.daysLeft,
            },
            amountPaise,
            urgencyScore: DAILY_BRIEF_CONFIG.ranking.atRiskUrgency,
            orderId: order.id,
        }));
    }

    const overdueDues = db.prepare(`
        SELECT id, order_id AS orderId, amount_paise AS amountPaise,
            pay_by_date AS payByDate, created_at AS createdAt
        FROM cash_dues
        WHERE jeweller_id = ? AND status = 'open' AND pay_by_date <= ?
        ORDER BY pay_by_date, id
    `).all(actor.id, asOf.toISOString()) as Array<{
        id: string;
        orderId: string;
        amountPaise: number;
        payByDate: string;
        createdAt: string;
    }>;
    for (const due of overdueDues) {
        const order = db.prepare('SELECT description FROM orders WHERE id = ?')
            .get(due.orderId) as { description: string } | undefined;
        if (!order) throw new Error(`Order ${due.orderId} for due ${due.id} was not found.`);
        const overdueDays = calculateDaysOverdue(due.payByDate, asOf);
        const urgencyScore = calculateDailyBriefUrgency(
            DAILY_BRIEF_CONFIG.ranking.overdueBaseUrgency,
            overdueDays,
            DAILY_BRIEF_CONFIG.ranking.overdueUrgencyPerDay,
        );
        items.push(createItem({
            id: `due:${due.id}`,
            category: 'overdue_due',
            values: {
                description: order.description,
                amount: formatPaiseAsRupees(due.amountPaise),
                overdueDays,
            },
            amountPaise: due.amountPaise,
            urgencyScore,
            orderId: due.orderId,
            dueId: due.id,
            ageDays: calculateAgeingDays(due.createdAt, asOf),
            overdueDays,
        }));
    }

    for (const event of getPendingLedgerEvents(actor)) {
        const amountPaise = eventAmountPaise(event, ratePaisePerGram);
        const ageDays = calculateAgeingDays(event.createdAt, asOf);
        const urgencyScore = calculateDailyBriefUrgency(
            DAILY_BRIEF_CONFIG.ranking.pendingBaseUrgency,
            ageDays,
            DAILY_BRIEF_CONFIG.ranking.pendingUrgencyPerDay,
        );
        const eventType = event.type.replaceAll('_', ' ');
        items.push(createItem({
            id: `approval:${event.id}`,
            category: 'pending_approval',
            values: {
                eventType,
                description: event.description,
                amount: formatPaiseAsRupees(amountPaise),
            },
            amountPaise,
            urgencyScore,
            orderId: event.orderId,
            eventId: event.id,
            ageDays,
        }));
    }

    const flaggedRows = db.prepare(`
        SELECT e.id, e.order_id AS orderId, e.type, e.amount AS amountPaise,
            e.weight_mg AS weightMg, e.fine_weight_mg AS fineWeightMg,
            e.purity_per_mille AS purityPerMille, e.created_at AS createdAt,
            o.description, d.reason, d.id AS disputeId
        FROM ledger_events e
        JOIN orders o ON o.id = e.order_id
        LEFT JOIN disputes d ON d.event_id = e.id AND d.status = 'unresolved'
        WHERE o.jeweller_id = ? AND (e.status = 'contested' OR d.id IS NOT NULL)
        ORDER BY e.created_at, e.id
    `).all(actor.id) as Array<{
        id: string;
        orderId: string;
        type: string;
        amountPaise: number;
        weightMg: number;
        fineWeightMg: number | null;
        purityPerMille: number | null;
        createdAt: string;
        description: string;
        reason: string | null;
        disputeId: string | null;
    }>;
    const seenFlags = new Set<string>();
    for (const flag of flaggedRows) {
        if (seenFlags.has(flag.id)) continue;
        seenFlags.add(flag.id);
        const amountPaise = eventAmountPaise(flag, ratePaisePerGram);
        items.push(createItem({
            id: `flag:${flag.disputeId ?? flag.id}`,
            category: 'flag',
            values: {
                description: flag.description,
                reason: flag.reason ?? `Contested ${flag.type.replaceAll('_', ' ')}`,
                amount: formatPaiseAsRupees(amountPaise),
            },
            amountPaise,
            urgencyScore: DAILY_BRIEF_CONFIG.ranking.flagUrgency,
            orderId: flag.orderId,
            eventId: flag.id,
            ageDays: calculateAgeingDays(flag.createdAt, asOf),
        }));
    }

    const escalated = db.prepare(`
        SELECT d.id, d.event_id AS eventId, d.reason, d.created_at AS createdAt,
            o.id AS orderId, o.description
        FROM disputes d
        JOIN ledger_events e ON e.id = d.event_id
        JOIN orders o ON o.id = e.order_id
        WHERE d.status = 'escalated' AND o.jeweller_id = ?
        ORDER BY d.escalated_at, d.id
    `).all(actor.id) as Array<{
        id: string;
        eventId: string;
        reason: string;
        createdAt: string | null;
        orderId: string;
        description: string;
    }>;
    for (const dispute of escalated) {
        const ageDays = dispute.createdAt ? calculateAgeingDays(dispute.createdAt, asOf) : 0;
        items.push(createItem({
            id: `escalated-dispute:${dispute.id}`,
            category: 'escalated_dispute',
            values: { description: dispute.description, reason: dispute.reason, ageDays },
            amountPaise: 0,
            urgencyScore: DAILY_BRIEF_CONFIG.ranking.escalatedDisputeUrgency,
            orderId: dispute.orderId,
            eventId: dispute.eventId,
            ageDays,
        }));
    }

    return items
        .sort((left, right) => right.rankingScore - left.rankingScore
            || (right.amountPaise > left.amountPaise ? 1 : right.amountPaise < left.amountPaise ? -1 : 0)
            || (right.urgencyScore > left.urgencyScore ? 1 : right.urgencyScore < left.urgencyScore ? -1 : 0)
            || left.id.localeCompare(right.id))
        .slice(0, DAILY_BRIEF_CONFIG.ranking.maxItems);
}

function buildKarigarItems(actor: DailyBriefActor, asOf: Date): BilingualBriefItem[] {
    const ratePaisePerGram = getRate(asOf).ratePaisePerGram;
    const items: BilingualBriefItem[] = [];
    const dueOrders = db.prepare(`
        SELECT id, description, due_date AS dueDate
        FROM orders
        WHERE karigar_id = ? AND status = 'open'
        ORDER BY due_date, id
    `).all(actor.id) as Array<{ id: string; description: string; dueDate: string }>;
    for (const order of dueOrders) {
        if (calculateDaysUntil(order.dueDate, asOf) !== 0) continue;
        items.push(createItem({
            id: `due-today:${order.id}`,
            category: 'due_today',
            values: { description: order.description },
            amountPaise: 0,
            urgencyScore: DAILY_BRIEF_CONFIG.ranking.dueTodayUrgency,
            orderId: order.id,
        }));
    }

    const owedDues = db.prepare(`
        SELECT id, order_id AS orderId, amount_paise AS amountPaise,
            pay_by_date AS payByDate, created_at AS createdAt
        FROM cash_dues
        WHERE karigar_id = ? AND status = 'open'
        ORDER BY pay_by_date, created_at, id
    `).all(actor.id) as Array<{
        id: string;
        orderId: string;
        amountPaise: number;
        payByDate: string;
        createdAt: string;
    }>;
    for (const due of owedDues) {
        const order = db.prepare('SELECT description FROM orders WHERE id = ?')
            .get(due.orderId) as { description: string } | undefined;
        if (!order) throw new Error(`Order ${due.orderId} for due ${due.id} was not found.`);
        const ageDays = calculateAgeingDays(due.createdAt, asOf);
        const overdueDays = calculateDaysOverdue(due.payByDate, asOf);
        items.push(createItem({
            id: `owed:${due.id}`,
            category: 'owed_cash',
            values: {
                description: order.description,
                amount: formatPaiseAsRupees(due.amountPaise),
                ageDays,
                overdueDays,
            },
            amountPaise: due.amountPaise,
            urgencyScore: calculateDailyBriefUrgency(
                DAILY_BRIEF_CONFIG.ranking.overdueBaseUrgency,
                overdueDays,
                DAILY_BRIEF_CONFIG.ranking.overdueUrgencyPerDay,
            ),
            orderId: due.orderId,
            dueId: due.id,
            ageDays,
            overdueDays,
        }));
    }

    const approvals = getPendingLedgerEvents(actor);
    for (const event of approvals) {
        const amountPaise = eventAmountPaise(event, ratePaisePerGram);
        const ageDays = calculateAgeingDays(event.createdAt, asOf);
        items.push(createItem({
            id: `approval:${event.id}`,
            category: 'pending_approval',
            values: {
                eventType: event.type.replaceAll('_', ' '),
                description: event.description,
                amount: formatPaiseAsRupees(amountPaise),
            },
            amountPaise,
            urgencyScore: calculateDailyBriefUrgency(
                DAILY_BRIEF_CONFIG.ranking.pendingBaseUrgency,
                ageDays,
                DAILY_BRIEF_CONFIG.ranking.pendingUrgencyPerDay,
            ),
            orderId: event.orderId,
            eventId: event.id,
            ageDays,
        }));
    }

    const transfers = db.prepare(`
        SELECT t.id, t.order_id AS orderId, t.from_karigar_id AS fromKarigarId,
            t.to_karigar_id AS toKarigarId, t.weight_mg AS weightMg,
            t.purity_per_mille AS purityPerMille, t.out_event_id AS outEventId,
            t.in_event_id AS inEventId, t.from_acknowledged_at AS fromAcknowledgedAt,
            t.to_acknowledged_at AS toAcknowledgedAt, o.description
        FROM custody_transfers t
        JOIN orders o ON o.id = t.order_id
        WHERE t.status = 'pending' AND (t.from_karigar_id = ? OR t.to_karigar_id = ?)
        ORDER BY t.created_at, t.id
    `).all(actor.id, actor.id) as Array<{
        id: string;
        orderId: string;
        fromKarigarId: string;
        toKarigarId: string;
        weightMg: number;
        purityPerMille: number;
        outEventId: string;
        inEventId: string;
        fromAcknowledgedAt: string | null;
        toAcknowledgedAt: string | null;
        description: string;
    }>;
    for (const transfer of transfers) {
        const isOutgoing = transfer.fromKarigarId === actor.id;
        if ((isOutgoing && transfer.fromAcknowledgedAt) || (!isOutgoing && transfer.toAcknowledgedAt)) continue;
        const eventId = isOutgoing ? transfer.outEventId : transfer.inEventId;
        const fineGoldMg = toFineGoldPerMilleMg(transfer.weightMg, transfer.purityPerMille);
        const amountPaise = calculateGoldValuePaise(fineGoldMg, ratePaisePerGram);
        items.push(createItem({
            id: `approval:${eventId}`,
            category: 'custody_approval',
            values: {
                eventType: isOutgoing ? 'custody handover' : 'custody receipt',
                description: transfer.description,
                amount: formatPaiseAsRupees(amountPaise),
            },
            amountPaise,
            urgencyScore: DAILY_BRIEF_CONFIG.ranking.pendingBaseUrgency,
            orderId: transfer.orderId,
            eventId,
        }));
    }

    const escalated = db.prepare(`
        SELECT d.id, d.event_id AS eventId, d.reason, d.created_at AS createdAt,
            o.id AS orderId, o.description
        FROM disputes d
        JOIN ledger_events e ON e.id = d.event_id
        JOIN orders o ON o.id = e.order_id
        WHERE d.status = 'escalated' AND d.karigar_id = ?
        ORDER BY d.escalated_at, d.id
    `).all(actor.id) as Array<{
        id: string;
        eventId: string;
        reason: string;
        createdAt: string | null;
        orderId: string;
        description: string;
    }>;
    for (const dispute of escalated) {
        const ageDays = dispute.createdAt ? calculateAgeingDays(dispute.createdAt, asOf) : 0;
        items.push(createItem({
            id: `escalated-dispute:${dispute.id}`,
            category: 'escalated_dispute',
            values: { description: dispute.description, reason: dispute.reason, ageDays },
            amountPaise: 0,
            urgencyScore: DAILY_BRIEF_CONFIG.ranking.escalatedDisputeUrgency,
            orderId: dispute.orderId,
            eventId: dispute.eventId,
            ageDays,
        }));
    }

    return items.sort((left, right) => right.rankingScore - left.rankingScore
        || (right.amountPaise > left.amountPaise ? 1 : right.amountPaise < left.amountPaise ? -1 : 0)
        || left.id.localeCompare(right.id));
}

function buildBilingualItems(actor: DailyBriefActor, asOf: Date): BilingualBriefItem[] {
    return actor.role === 'jeweller'
        ? buildJewellerItems(actor, asOf)
        : buildKarigarItems(actor, asOf);
}

export function getDailyBrief(
    userId: string,
    language: DailyBriefLanguage,
    asOf: Date = clockNow(),
) {
    const actor = getActor(userId);
    const briefDate = getDateKeyInTimeZone(asOf, DAILY_BRIEF_CONFIG.schedule.timeZone);
    const stored = db.prepare(`
        SELECT generated_at AS generatedAt, items_json AS itemsJson
        FROM daily_briefs WHERE user_id = ? AND brief_date = ?
    `).get(userId, briefDate) as { generatedAt: string; itemsJson: string } | undefined;
    const bilingualItems = stored
        ? JSON.parse(stored.itemsJson) as BilingualBriefItem[]
        : buildBilingualItems(actor, asOf);
    const items: DailyBriefItem[] = bilingualItems.map((item) => ({
        ...item,
        title: item.title[language],
        detail: item.detail[language],
    }));
    const templates = DAILY_BRIEF_CONFIG.templates[language];
    const spokenText = items.length === 0
        ? fill(templates.noItems, {})
        : [
            fill(templates.title, { name: actor.name }),
            ...items.flatMap((item) => [item.title, item.detail]),
        ].map((part) => part.replace(/[.!?]+$/, '')).join('. ') + '.';
    return {
        actor,
        language,
        briefDate,
        generatedAt: stored?.generatedAt ?? null,
        preview: !stored,
        schedule: {
            timeZone: DAILY_BRIEF_CONFIG.schedule.timeZone,
            scheduledTime: `${String(DAILY_BRIEF_CONFIG.schedule.hour).padStart(2, '0')}:${String(DAILY_BRIEF_CONFIG.schedule.minute).padStart(2, '0')}`,
            hoursUntilNextRun: calculateHoursUntilNextDailyBrief(asOf, DAILY_BRIEF_CONFIG.schedule),
        },
        items,
        spokenText,
    };
}

export function runDailyBriefTick(asOf: Date = clockNow()): {
    generated: boolean;
    briefDate: string;
    userIds: string[];
    generatedAt: string;
} {
    const briefDate = getDateKeyInTimeZone(asOf, DAILY_BRIEF_CONFIG.schedule.timeZone);
    if (!isDailyBriefScheduleDue(asOf, DAILY_BRIEF_CONFIG.schedule)) {
        return { generated: false, briefDate, userIds: [], generatedAt: asOf.toISOString() };
    }
    const actors = db.prepare(`
        SELECT id, name, role FROM users WHERE role IN ('jeweller', 'karigar') ORDER BY id
    `).all() as DailyBriefActor[];
    const generatedAt = asOf.toISOString();
    const userIds = db.transaction(() => {
        const generated: string[] = [];
        for (const actor of actors) {
            const existing = db.prepare('SELECT 1 FROM daily_briefs WHERE user_id = ? AND brief_date = ?')
                .get(actor.id, briefDate);
            if (existing) continue;
            const items = buildBilingualItems(actor, asOf);
            db.prepare(`
                INSERT INTO daily_briefs (user_id, brief_date, generated_at, items_json)
                VALUES (?, ?, ?, ?)
            `).run(actor.id, briefDate, generatedAt, JSON.stringify(items));
            generated.push(actor.id);
        }
        return generated;
    })();
    return { generated: userIds.length > 0, briefDate, userIds, generatedAt };
}

export function getDailyBriefFastForwardTime(hours: number, asOf: Date = clockNow()): Date {
    return addHoursToDate(asOf, hours);
}
