import crypto from 'crypto';
import db from './db';
import { now } from './clock';
import { KARIGAR_FLOAT_CONFIG } from './karigarFloatConfig';
import { appendLedgerEvent, replayAndVerifyOrder } from './ledger';

export interface KarigarFloatAccount {
    id: string;
    jewellerId: string;
    karigarId: string;
    ledgerOrderId: string;
    createdAt: string;
}

interface FloatRow {
    id: string;
    jewellerId: string;
    karigarId: string;
    ledgerOrderId: string;
    createdAt: string;
}

function getFloatRow(floatId: string): FloatRow {
    const row = db.prepare(`
        SELECT id, jeweller_id AS jewellerId, karigar_id AS karigarId,
            ledger_order_id AS ledgerOrderId, created_at AS createdAt
        FROM karigar_floats WHERE id = ?
    `).get(floatId) as FloatRow | undefined;
    if (!row) throw new Error('Karigar float not found.');
    return row;
}

export function getKarigarFloatForPair(jewellerId: string, karigarId: string): FloatRow | null {
    return db.prepare(`
        SELECT id, jeweller_id AS jewellerId, karigar_id AS karigarId,
            ledger_order_id AS ledgerOrderId, created_at AS createdAt
        FROM karigar_floats WHERE jeweller_id = ? AND karigar_id = ?
    `).get(jewellerId, karigarId) as FloatRow | undefined ?? null;
}

export function ensureKarigarFloat(jewellerId: string, karigarId: string): FloatRow {
    const existing = getKarigarFloatForPair(jewellerId, karigarId);
    if (existing) return existing;

    const parties = db.prepare(`
        SELECT
            (SELECT role FROM users WHERE id = ?) AS jewellerRole,
            (SELECT role FROM users WHERE id = ?) AS karigarRole,
            (SELECT name FROM users WHERE id = ?) AS karigarName
    `).get(jewellerId, karigarId, karigarId) as {
        jewellerRole: string | null;
        karigarRole: string | null;
        karigarName: string | null;
    };
    if (parties.jewellerRole !== 'jeweller') throw new Error('Jeweller not found.');
    if (parties.karigarRole !== 'karigar') throw new Error('Karigar not found.');

    const float = {
        id: `float-${crypto.randomUUID()}`,
        ledgerOrderId: `ord-float-${crypto.randomUUID()}`,
        createdAt: now().toISOString(),
    };
    db.transaction(() => {
        db.prepare(`
            INSERT INTO orders
                (id, jeweller_id, karigar_id, description, status, due_date, occasion_date,
                 job_type, target_weight_mg, tolerance_mg)
            VALUES (?, ?, ?, ?, 'closed', ?, NULL, 'plain', 0, 0)
        `).run(
            float.ledgerOrderId,
            jewellerId,
            karigarId,
            `Gold float account · ${parties.karigarName}`,
            float.createdAt,
        );
        db.prepare(`
            INSERT INTO karigar_floats (id, jeweller_id, karigar_id, ledger_order_id, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(float.id, jewellerId, karigarId, float.ledgerOrderId, float.createdAt);
    })();

    return {
        ...float,
        jewellerId,
        karigarId,
    };
}

export function replayKarigarFloat(floatId: string) {
    const float = getFloatRow(floatId);
    const orderIds = db.prepare(`
        SELECT DISTINCT order_id AS orderId FROM ledger_events
        WHERE float_id = ? ORDER BY order_id
    `).all(floatId) as Array<{ orderId: string }>;
    let remainingMg = 0;
    let fineMg = 0;
    for (const { orderId } of orderIds) {
        const replay = replayAndVerifyOrder(orderId);
        if (!replay.isValidChain) throw new Error(`Ledger replay failed verification for float ${floatId}.`);
        remainingMg += replay.accountBalances.karigar_float.grossMg;
        fineMg += replay.accountBalances.karigar_float.fineMg;
    }

    const pendingLedgerDrawdowns = db.prepare(`
        SELECT COALESCE(SUM(weight_mg), 0) AS weightMg
        FROM ledger_events
        WHERE float_id = ? AND debit_account = 'karigar_float' AND status = 'pending_ack'
    `).get(floatId) as { weightMg: number };
    const pendingApprovalDrawdowns = (db.prepare(`
        SELECT COALESCE(SUM(weight_mg), 0) AS weightMg
        FROM owner_issue_approvals
        WHERE float_id = ? AND debit_account = 'karigar_float' AND status = 'pending'
    `).get(floatId) as { weightMg: number }).weightMg;
    const pendingDrawdowns = pendingLedgerDrawdowns.weightMg + pendingApprovalDrawdowns;
    return {
        ...float,
        remainingMg,
        fineMg,
        pendingDrawdownMg: pendingDrawdowns,
        availableMg: remainingMg - pendingDrawdowns,
        targetMg: KARIGAR_FLOAT_CONFIG.targetFloatMg,
        settlementThresholdMg: KARIGAR_FLOAT_CONFIG.settlementThresholdMg,
        replayOrderCount: orderIds.length,
    };
}

export function listKarigarFloats(karigarId: string, jewellerId?: string) {
    const rows = jewellerId
        ? db.prepare(`
            SELECT id FROM karigar_floats
            WHERE karigar_id = ? AND jeweller_id = ?
            ORDER BY created_at, id
        `).all(karigarId, jewellerId) as Array<{ id: string }>
        : db.prepare(`
            SELECT id FROM karigar_floats
            WHERE karigar_id = ?
            ORDER BY created_at, id
        `).all(karigarId) as Array<{ id: string }>;
    return rows.map(({ id }) => replayKarigarFloat(id));
}

export function getPendingFloatSettlementDraft(floatId: string) {
    const event = db.prepare(`
        SELECT id, status, notes FROM ledger_events
        WHERE float_id = ? AND type = 'settlement' AND status = 'pending_ack'
        ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(floatId) as { id: string; status: string; notes: string } | undefined;
    if (!event) return null;
    const balance = replayKarigarFloat(floatId);
    return {
        ...event,
        remainingMg: balance.remainingMg,
        topUpSuggestionMg: Math.max(0, balance.targetMg - balance.remainingMg),
    };
}

export function createFloatSettlementDraft(floatId: string, actorId: string) {
    const float = getFloatRow(floatId);
    if (actorId !== float.jewellerId && actorId !== float.karigarId) {
        throw new Error('You do not have access to this karigar float.');
    }
    const existing = getPendingFloatSettlementDraft(floatId);
    if (existing) {
        return existing;
    }

    const balance = replayKarigarFloat(floatId);
    const cycle = (db.prepare(`
        SELECT COUNT(*) AS count FROM ledger_events WHERE float_id = ? AND type = 'settlement'
    `).get(floatId) as { count: number }).count + 1;
    const topUpSuggestionMg = Math.max(0, balance.targetMg - balance.remainingMg);
    const notes = [
        `KARIGAR FLOAT SETTLEMENT DRAFT · cycle ${cycle}.`,
        `Acknowledged remaining float: ${balance.remainingMg} mg (${balance.fineMg} fine mg).`,
        `Suggested top-up: ${topUpSuggestionMg} mg to reach the configured ${balance.targetMg} mg float.`,
        'Snapshot only; this draft does not move or finalize gold and requires the other party’s approval.',
    ].join(' ');
    const event = appendLedgerEvent({
        id: `evt-${crypto.randomUUID()}`,
        orderId: float.ledgerOrderId,
        type: 'settlement',
        weightMg: 0,
        amount: 0,
        floatId,
        status: 'pending_ack',
        createdBy: actorId,
        notes,
        idempotencyKey: `karigar-float-settlement:${floatId}:${cycle}`,
    }) as { id: string; status: string; notes: string };
    return { ...event, remainingMg: balance.remainingMg, topUpSuggestionMg };
}

export function createThresholdSettlementDraft(floatId: string, createdBy: string) {
    const balance = replayKarigarFloat(floatId);
    if (balance.remainingMg > balance.settlementThresholdMg) return null;
    return createFloatSettlementDraft(floatId, createdBy);
}
