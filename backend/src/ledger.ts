/**
 * @fileoverview Immutable append-only ledger operations.
 * Handles hash-chaining, idempotency, and state derivation via replay.
 */
import crypto from 'crypto';
import db from './db';
import { AccountTag, LedgerEventSchema } from './schema';
import { now } from './clock';
import { toFineGoldPerMilleMg } from './calc';

type LedgerAcknowledgementHook = (eventId: string, actorId: string, type: string, orderId: string) => void;
let ledgerAcknowledgementHook: LedgerAcknowledgementHook | null = null;

export function registerLedgerAcknowledgementHook(hook: LedgerAcknowledgementHook): void {
    ledgerAcknowledgementHook = hook;
}

export interface AccountBalance {
    grossMg: number;
    fineMg: number;
}

export interface ReplayState {
    orderId: string;
    isValidChain: boolean;
    issuedMg: number;
    returnedMg: number;
    scrapMg: number;
    netKarigarHeldMg: number;
    accountBalances: Record<AccountTag, AccountBalance>;
    dueDate: string | null;
    isAtRisk: boolean;
}

/**
 * Generates a SHA-256 hash for a ledger event.
 */
export function generateEventHash(event: any): string {
    // We omit 'status' from the hash so it can transition through the state machine.
    // The financial facts (weight, amount, type, createdBy) are cryptographically locked.
    const agreementFields = event.agreementId || event.agreementVersion
        ? `|${event.agreementId || ''}|${event.agreementVersion || ''}`
        : '';
    const rateFields = event.ratePolicy != null || event.rateSnapshotPaisePerGram != null
        ? `|${event.ratePolicy || ''}|${event.rateSnapshotPaisePerGram ?? ''}`
        : '';
    const stageFields = event.stage != null ? `|${event.stage}` : '';
    const fineWeightMg = event.fineWeightMg ?? event.fine_weight_mg;
    const purityPerMille = event.purityPerMille ?? event.purity_per_mille;
    const debitAccount = event.debitAccount ?? event.debit_account;
    const creditAccount = event.creditAccount ?? event.credit_account;
    const accountingFields = fineWeightMg != null || purityPerMille != null || debitAccount != null || creditAccount != null
        ? `|${fineWeightMg ?? ''}|${purityPerMille ?? ''}|${debitAccount ?? ''}|${creditAccount ?? ''}`
        : '';
    const payload = `${event.id}|${event.orderId}|${event.type}|${event.weightMg || 0}|${event.amount || 0}|${event.createdBy}|${event.previousHash || 'GENESIS'}${agreementFields}${rateFields}${stageFields}${accountingFields}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Appends a new event to the ledger safely.
 * Returns early if the idempotency key already exists (prevents double-posting).
 */
export function appendLedgerEvent(eventPayload: any) {
    // 1. Check Idempotency (Retry protection)
    const existing = db.prepare('SELECT * FROM ledger_events WHERE idempotency_key = ?').get(eventPayload.idempotencyKey);
    if (existing) return existing;

    const accountTransfers: Partial<Record<string, { debitAccount: AccountTag; creditAccount: AccountTag }>> = {
        issue: { debitAccount: 'jeweller_vault', creditAccount: 'karigar_wip' },
        return: { debitAccount: 'karigar_wip', creditAccount: 'finished_goods' },
        scrap_entry: { debitAccount: 'karigar_wip', creditAccount: 'scrap' },
        process_loss: { debitAccount: 'karigar_wip', creditAccount: 'process_loss' },
        refiner_transfer: { debitAccount: 'scrap', creditAccount: 'refiner' },
        custody_transfer_out: { debitAccount: 'karigar_wip', creditAccount: 'jeweller_vault' },
        custody_transfer_in: { debitAccount: 'jeweller_vault', creditAccount: 'karigar_wip' },
    };
    const transfer = accountTransfers[eventPayload.type];
    const normalizedPayload = {
        ...eventPayload,
        stage: eventPayload.stage ?? null,
        purityPerMille: eventPayload.purityPerMille ?? null,
        fineWeightMg: eventPayload.fineWeightMg
            ?? (eventPayload.purityPerMille == null
                ? null
                : toFineGoldPerMilleMg(eventPayload.weightMg ?? 0, eventPayload.purityPerMille)),
        debitAccount: eventPayload.debitAccount ?? transfer?.debitAccount ?? null,
        creditAccount: eventPayload.creditAccount ?? transfer?.creditAccount ?? null,
    };

    return db.transaction(() => {
        const createdAt = now().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

        // 2. Fetch previous hash for this order to maintain the chain
        const lastEvent = db.prepare('SELECT hash FROM ledger_events WHERE order_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(normalizedPayload.orderId) as any;
        const previousHash = lastEvent ? lastEvent.hash : null;

        // 3. Generate current hash
        const hash = generateEventHash({ ...normalizedPayload, previousHash });

        // 4. Validate and Insert
        const parsed = LedgerEventSchema.parse({ ...normalizedPayload, previousHash, hash });

        db.prepare(`
      INSERT INTO ledger_events 
      (id, order_id, type, weight_mg, fine_weight_mg, purity_per_mille, debit_account, credit_account,
       amount, status, created_by, notes, idempotency_key, previous_hash, hash, agreement_id,
       agreement_version, rate_policy, rate_snapshot_paise_per_gram, stage, created_at, acknowledged_at)
      VALUES (@id, @orderId, @type, @weightMg, @fineWeightMg, @purityPerMille, @debitAccount,
       @creditAccount, @amount, @status, @createdBy, @notes, @idempotencyKey, @previousHash,
       @hash, @agreementId, @agreementVersion, @ratePolicy, @rateSnapshotPaisePerGram, @stage, @createdAt, @acknowledgedAt)
    `).run({
            ...parsed,
            createdAt,
            acknowledgedAt: parsed.status === 'acknowledged' ? createdAt : null,
        });

        return parsed;
    })();
}

/**
 * Replays all events for an order to calculate current balances 
 * AND verifies the hash chain simultaneously to detect DB tampering.
 */
export function replayAndVerifyOrder(orderId: string, evaluateAsOf: Date = now()): ReplayState {
    const events = db.prepare('SELECT * FROM ledger_events WHERE order_id = ? ORDER BY created_at ASC, rowid ASC').all(orderId) as any[];

    // Fetch the order to get the due date
    const order = db.prepare('SELECT due_date FROM orders WHERE id = ?').get(orderId) as any;

    const state: ReplayState = {
        orderId,
        isValidChain: true,
        issuedMg: 0,
        returnedMg: 0,
        scrapMg: 0,
        netKarigarHeldMg: 0,
        accountBalances: {
            jeweller_vault: { grossMg: 0, fineMg: 0 },
            karigar_wip: { grossMg: 0, fineMg: 0 },
            finished_goods: { grossMg: 0, fineMg: 0 },
            scrap: { grossMg: 0, fineMg: 0 },
            refiner: { grossMg: 0, fineMg: 0 },
            process_loss: { grossMg: 0, fineMg: 0 },
        },
        dueDate: order ? order.due_date : null,
        isAtRisk: false
    };

    let expectedPreviousHash = null;

    for (const ev of events) {
        // 1. Verify Hash Chain
        const expectedHash = generateEventHash({
            id: ev.id,
            orderId: ev.order_id,
            type: ev.type,
            weightMg: ev.weight_mg,
            amount: ev.amount,
            createdBy: ev.created_by, // <-- Fixed: Pass created_by instead of status
            previousHash: ev.previous_hash,
            agreementId: ev.agreement_id,
            agreementVersion: ev.agreement_version,
            ratePolicy: ev.rate_policy,
            rateSnapshotPaisePerGram: ev.rate_snapshot_paise_per_gram,
            stage: ev.stage,
            fineWeightMg: ev.fine_weight_mg,
            purityPerMille: ev.purity_per_mille,
            debitAccount: ev.debit_account,
            creditAccount: ev.credit_account,
        });

        if (ev.hash !== expectedHash || ev.previous_hash !== expectedPreviousHash) {
            state.isValidChain = false;
            break; // Tampering detected!
        }
        expectedPreviousHash = ev.hash;

        // 2. Derive Balance (Only apply ACKNOWLEDGED events, Rule 4)
        if (ev.status === 'acknowledged') {
            if (ev.debit_account && ev.credit_account) {
                const debit = state.accountBalances[ev.debit_account as AccountTag];
                const credit = state.accountBalances[ev.credit_account as AccountTag];
                debit.grossMg -= ev.weight_mg;
                debit.fineMg -= ev.fine_weight_mg ?? 0;
                credit.grossMg += ev.weight_mg;
                credit.fineMg += ev.fine_weight_mg ?? 0;
            }
            if (ev.type === 'issue') {
                state.issuedMg += ev.weight_mg;
                state.netKarigarHeldMg += ev.weight_mg;
            }
            if (ev.type === 'return') {
                state.returnedMg += ev.weight_mg;
                state.netKarigarHeldMg -= ev.weight_mg;
            }
            if (ev.type === 'scrap_entry') {
                state.scrapMg += ev.weight_mg;
                state.netKarigarHeldMg -= ev.weight_mg;
            }
            if (ev.type === 'process_loss') {
                if (ev.debit_account === 'karigar_wip') state.netKarigarHeldMg -= ev.weight_mg;
            }
            if (ev.type === 'custody_transfer_out' || ev.type === 'custody_transfer_in') {
                if (ev.debit_account === 'karigar_wip') state.netKarigarHeldMg -= ev.weight_mg;
                if (ev.credit_account === 'karigar_wip') state.netKarigarHeldMg += ev.weight_mg;
            }
            if (ev.type === 'correction') {
                if (ev.debit_account === 'karigar_wip') {
                    state.netKarigarHeldMg -= ev.weight_mg;
                } else if (ev.credit_account === 'karigar_wip') {
                    state.netKarigarHeldMg += ev.weight_mg;
                } else if (!String(ev.notes ?? '').startsWith('DISPUTE_RESOLUTION:')) {
                    state.netKarigarHeldMg += ev.weight_mg;
                }
            }
        }
    }

    // Deterministic Risk Rule: At risk if holding gold AND past the due date
    if (state.dueDate && state.netKarigarHeldMg > 0) {
        const isOverdue = evaluateAsOf > new Date(state.dueDate);
        state.isAtRisk = isOverdue;
    }

    return state;
}

export function verifyLedgerChain(orderId: string): boolean {
    return replayAndVerifyOrder(orderId).isValidChain;
}

/**
 * State Machine Progression: An entry isn't final without BOTH sides.
 */
export function progressEventStatus(eventId: string, actingUserId: string, newStatus: 'acknowledged' | 'contested') {
    const event = db.prepare('SELECT * FROM ledger_events WHERE id = ?').get(eventId) as any;
    if (!event) throw new Error('Event not found');

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(event.order_id) as any;

    // 1. Data Isolation: Actor must be part of this specific order
    if (order.jeweller_id !== actingUserId && order.karigar_id !== actingUserId) {
        throw new Error('Unauthorized: You do not have access to this order');
    }

    // 2. Dual-Party Rule: You cannot approve your own entry
    if (event.created_by === actingUserId && newStatus === 'acknowledged') {
        throw new Error('Rule Violation: The other party must acknowledge this entry');
    }

    if (newStatus === 'acknowledged') {
        const activeDispute = db.prepare(`
            SELECT id FROM disputes
            WHERE event_id = ? AND status IN ('unresolved', 'escalated', 'pending_ack')
        `).get(eventId);
        if (activeDispute) throw new Error('This entry is under an open dispute; acknowledge its resolution instead.');
        db.prepare('UPDATE ledger_events SET status = ?, acknowledged_at = ? WHERE id = ?')
            .run(newStatus, now().toISOString(), eventId);
        ledgerAcknowledgementHook?.(eventId, actingUserId, event.type, event.order_id);
    } else {
        db.prepare('UPDATE ledger_events SET status = ? WHERE id = ?').run(newStatus, eventId);
    }
}