import crypto from 'crypto';
import db from './db';
import { now } from './clock';
import {
    calculateCappedSplitValue,
    calculateCappedSplitSignedValue,
    calculateDisputeHistoryTotals,
    calculateSignedFineGoldMg,
    toFineGoldPerMilleMg,
} from './calc';
import { DISPUTE_CONFIG, DisputeResolutionOption } from './disputeConfig';
import { AGREEMENT_CONFIG } from './agreementConfig';
import { DisputeContestSchema, DisputeResolutionSchema } from './schema';
import {
    appendLedgerEvent,
    registerLedgerAcknowledgementHook,
    replayAndVerifyOrder,
    verifyLedgerChain,
} from './ledger';

type DisputeStatus = 'unresolved' | 'escalated' | 'pending_ack' | 'resolved';
type CarryUnit = 'mg' | 'paise';

interface OrderRow {
    id: string;
    jeweller_id: string;
    karigar_id: string;
    description: string;
    status: string;
    due_date: string;
    job_type: string;
}

interface EventRow {
    id: string;
    order_id: string;
    type: string;
    weight_mg: number;
    fine_weight_mg: number | null;
    purity_per_mille: number | null;
    amount: number;
    status: string;
    created_by: string;
    notes: string | null;
    agreement_id: string | null;
    agreement_version: number | null;
    rate_policy: string | null;
    rate_snapshot_paise_per_gram: number | null;
    previous_hash: string | null;
    hash: string;
    created_at: string;
    acknowledged_at: string | null;
    debit_account: string | null;
    credit_account: string | null;
}

interface ActorRow {
    id: string;
    role: 'jeweller' | 'staff' | 'karigar';
}

const rowEvent = (id: string): EventRow => {
    const event = db.prepare('SELECT * FROM ledger_events WHERE id = ?').get(id) as EventRow | undefined;
    if (!event) throw new Error('Ledger entry not found.');
    return event;
};

const rowOrder = (id: string): OrderRow => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow | undefined;
    if (!order) throw new Error('Job not found.');
    return order;
};

const rowActor = (id: string): ActorRow => {
    const actor = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as ActorRow | undefined;
    if (!actor) throw new Error('User not found.');
    return actor;
};

function assertOrderAccess(order: OrderRow, actorId: string): ActorRow {
    const actor = rowActor(actorId);
    if (actor.id !== order.jeweller_id && actor.id !== order.karigar_id) {
        if (actor.role !== 'staff') throw new Error('You do not have access to this job.');
        const staff = db.prepare('SELECT owner_jeweller_id FROM staff_profiles WHERE user_id = ?')
            .get(actorId) as { owner_jeweller_id: string } | undefined;
        if (!staff || staff.owner_jeweller_id !== order.jeweller_id) {
            throw new Error('You do not have access to this job.');
        }
    }
    return actor;
}

function insertAction(disputeId: string, actorId: string, action: string, details: unknown = {}): void {
    db.prepare(`
        INSERT INTO dispute_actions (id, dispute_id, actor_id, action, details_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), disputeId, actorId, action, JSON.stringify(details), now().toISOString());
}

function deriveUnit(event: EventRow): CarryUnit {
    if (event.weight_mg !== 0 || event.fine_weight_mg !== null) return 'mg';
    if (event.amount !== 0) return 'paise';
    throw new Error('This ledger entry has no disputed weight or money value.');
}

function normalizeBase64(value: string): Buffer {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
        throw new Error('Evidence must be valid base64.');
    }
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length === 0 || bytes.toString('base64') !== value) {
        throw new Error('Evidence must be valid base64.');
    }
    if (bytes.length > DISPUTE_CONFIG.maxEvidenceBytes) {
        throw new Error(`Evidence must be ${DISPUTE_CONFIG.maxEvidenceBytes} bytes or smaller.`);
    }
    return bytes;
}

function getPinnedAgreement(event: EventRow) {
    if (!event.agreement_id || !event.agreement_version) return undefined;
    return db.prepare(`
        SELECT id, version, job_type AS jobType, basis, percent_bps AS percentBps,
            labour_rate_paise_per_gram AS labourRatePaisePerGram, effective_at AS effectiveAt
        FROM wastage_agreements WHERE id = ? AND version = ?
    `).get(event.agreement_id, event.agreement_version) as {
        id: string;
        version: number;
        jobType: string;
        basis: 'ideal_return_buffer' | 'fine_issued' | 'gross_issued' | 'finished_weight';
        percentBps: number;
        labourRatePaisePerGram: number;
        effectiveAt: string;
    } | undefined;
}

function getHistory(order: OrderRow) {
    const relatedOrders = db.prepare(`
        SELECT * FROM orders WHERE jeweller_id = ? AND karigar_id = ? AND job_type = ?
    `).all(order.jeweller_id, order.karigar_id, order.job_type) as OrderRow[];
    const jobs = relatedOrders.map((relatedOrder) => {
        const events = db.prepare(`
            SELECT type, weight_mg AS grossMg, fine_weight_mg AS fineMg,
                purity_per_mille AS purityPerMille, agreement_id AS agreementId,
                agreement_version AS agreementVersion
            FROM ledger_events
            WHERE order_id = ? AND status = 'acknowledged'
            ORDER BY created_at, rowid
        `).all(relatedOrder.id) as Array<{
            type: string;
            grossMg: number;
            fineMg: number | null;
            purityPerMille: number | null;
            agreementId: string | null;
            agreementVersion: number | null;
        }>;
        const issuedLots = events
            .filter((event) => event.type === 'issue')
            .map((event) => ({
                grossMg: event.grossMg,
                fineMg: event.fineMg ?? (event.purityPerMille === null
                    ? 0
                    : toFineGoldPerMilleMg(event.grossMg, event.purityPerMille)),
            }));
        const finishedLots = events
            .filter((event) => event.type === 'return')
            .map((event) => ({
                grossMg: event.grossMg,
                fineMg: event.fineMg ?? (event.purityPerMille === null
                    ? 0
                    : toFineGoldPerMilleMg(event.grossMg, event.purityPerMille)),
            }));
        const scrapLots = events
            .filter((event) => event.type === 'scrap_entry')
            .map((event) => ({
                grossMg: event.grossMg,
                fineMg: event.fineMg ?? (event.purityPerMille === null
                    ? 0
                    : toFineGoldPerMilleMg(event.grossMg, event.purityPerMille)),
            }));
        const issue = events.find((event) => event.type === 'issue' && event.agreementId && event.agreementVersion);
        const agreement = issue?.agreementId && issue.agreementVersion
            ? db.prepare(`
                SELECT basis, percent_bps AS percentBps
                FROM wastage_agreements WHERE id = ? AND version = ?
            `).get(issue.agreementId, issue.agreementVersion) as {
                basis: 'ideal_return_buffer' | 'fine_issued' | 'gross_issued' | 'finished_weight';
                percentBps: number;
            } | undefined
            : undefined;
        const agreementWithConfig = agreement?.basis === 'ideal_return_buffer'
            ? {
                ...agreement,
                idealReturnConfig: {
                    idealReturnFactorBp: AGREEMENT_CONFIG.idealReturnFactorBp,
                    bufferBp: AGREEMENT_CONFIG.bufferBp,
                },
                idealReturnPurityPerMille: AGREEMENT_CONFIG.idealReturnPurityPerMille,
            }
            : agreement;
        return { issuedLots, finishedLots, scrapLots, agreement: agreementWithConfig ?? null };
    });
    const totals = calculateDisputeHistoryTotals(jobs);
    return {
        jobType: order.job_type,
        lossMg: totals.lossMg,
        allowanceMg: totals.allowanceMg,
        completedJobs: totals.completedJobs,
    };
}

export function createDispute(eventId: string, createdBy: string, input: unknown): string {
    const request = DisputeContestSchema.parse(input);
    const event = rowEvent(eventId);
    const order = rowOrder(event.order_id);
    const actor = assertOrderAccess(order, createdBy);
    if (actor.role === 'staff') throw new Error('Only the jeweller or karigar can open a dispute.');
    if (event.status === 'draft') throw new Error('Only posted ledger entries can be disputed.');
    const hasWeight = event.weight_mg !== 0 || event.fine_weight_mg !== null;
    const hasAmount = event.amount !== 0;
    if (!hasWeight && !hasAmount) throw new Error('This ledger entry has no disputed weight or money value.');
    if (!hasWeight && (request.claimedWeightMg !== undefined || request.claimedPurityPerMille !== undefined)) {
        throw new Error('This entry has no disputed weight or purity value.');
    }
    if (!hasAmount && request.claimedAmountPaise !== undefined) {
        throw new Error('This entry has no disputed money value.');
    }
    const claimedWeightMg = hasWeight ? request.claimedWeightMg ?? event.weight_mg : null;
    const claimedAmountPaise = hasAmount ? request.claimedAmountPaise ?? event.amount : null;
    const claimedPurity = hasWeight
        ? request.claimedPurityPerMille ?? event.purity_per_mille
        : null;
    if (hasWeight && claimedWeightMg === null) throw new Error('A claimed weight is required for this entry.');
    if (hasWeight && event.type !== 'correction' && (claimedWeightMg ?? -1) < 0) {
        throw new Error('A physical reading cannot have negative weight.');
    }
    if (hasAmount && claimedAmountPaise === null) throw new Error('A claimed amount is required for this entry.');

    const disputeId = `dispute-${crypto.randomUUID()}`;
    const createdAt = now().toISOString();
    const insert = db.transaction(() => {
        const active = db.prepare(`
            SELECT id FROM disputes WHERE event_id = ? AND status IN ('unresolved', 'escalated', 'pending_ack')
        `).get(eventId);
        if (active) throw new Error('This entry already has an open dispute.');
        db.prepare(`
            INSERT INTO disputes
                (id, event_id, karigar_id, reason, status, created_by, created_at,
                 claimed_weight_mg, claimed_purity_per_mille, claimed_amount_paise)
            VALUES (?, ?, ?, ?, 'unresolved', ?, ?, ?, ?, ?)
        `).run(
            disputeId,
            eventId,
            order.karigar_id,
            request.reason,
            createdBy,
            createdAt,
            claimedWeightMg,
            claimedPurity,
            claimedAmountPaise,
        );
        insertAction(disputeId, createdBy, 'opened', { eventId, units: [hasWeight ? 'mg' : null, hasAmount ? 'paise' : null].filter(Boolean) });
        for (const evidence of request.evidence) {
            const bytes = normalizeBase64(evidence.base64);
            db.prepare(`
                INSERT INTO dispute_evidence
                    (id, dispute_id, uploaded_by, file_name, mime_type, sha256, content_base64, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                crypto.randomUUID(),
                disputeId,
                createdBy,
                evidence.fileName,
                evidence.mimeType,
                crypto.createHash('sha256').update(bytes).digest('hex'),
                evidence.base64,
                createdAt,
            );
        }
    });
    insert();
    return disputeId;
}

function buildResolutionEvent(
    event: EventRow,
    actorId: string,
    disputeId: string,
    weightDeltaMg: number,
    fineDeltaMg: number,
    amountDeltaPaise: number,
    purityPerMille: number | null,
    idempotencyKey: string,
    notes: string,
) {
    const accountTransfers: Partial<Record<string, { debit: string; credit: string }>> = {
        issue: { debit: 'jeweller_vault', credit: 'karigar_wip' },
        return: { debit: 'karigar_wip', credit: 'finished_goods' },
        scrap_entry: { debit: 'karigar_wip', credit: 'scrap' },
        process_loss: { debit: 'karigar_wip', credit: 'process_loss' },
        refiner_transfer: { debit: 'scrap', credit: 'refiner' },
        custody_transfer_out: { debit: 'karigar_wip', credit: 'jeweller_vault' },
        custody_transfer_in: { debit: 'jeweller_vault', credit: 'karigar_wip' },
    };
    const fallbackTransfer = accountTransfers[event.type];
    return appendLedgerEvent({
        id: `evt-${crypto.randomUUID()}`,
        orderId: event.order_id,
        type: 'correction',
        weightMg: weightDeltaMg,
        fineWeightMg: fineDeltaMg,
        purityPerMille,
        amount: amountDeltaPaise,
        debitAccount: event.debit_account ?? fallbackTransfer?.debit,
        creditAccount: event.credit_account ?? fallbackTransfer?.credit,
        status: 'pending_ack',
        createdBy: actorId,
        notes: `DISPUTE_RESOLUTION: ${disputeId}: ${notes}`,
        idempotencyKey,
        agreementId: event.agreement_id,
        agreementVersion: event.agreement_version,
        ratePolicy: event.rate_policy,
        rateSnapshotPaisePerGram: event.rate_snapshot_paise_per_gram,
    }) as { id: string };
}

function createCarryEvent(
    disputeId: string,
    orderId: string,
    actorId: string,
    unit: CarryUnit,
    signedValue: number,
    purityPerMille: number | null,
    idempotencyKey: string,
) {
    const weightMg = unit === 'mg' ? signedValue : 0;
    const amount = unit === 'paise' ? signedValue : 0;
    return appendLedgerEvent({
        id: `evt-${crypto.randomUUID()}`,
        orderId,
        type: 'correction',
        weightMg,
        fineWeightMg: unit === 'mg' && purityPerMille !== null
            ? calculateSignedFineGoldMg(signedValue, purityPerMille)
            : unit === 'mg' ? 0 : null,
        purityPerMille: unit === 'mg' ? purityPerMille : null,
        amount,
        debitAccount: unit === 'mg' ? 'jeweller_vault' : null,
        creditAccount: unit === 'mg' ? 'karigar_wip' : null,
        status: 'pending_ack',
        createdBy: actorId,
        notes: JSON.stringify({ disputeId, carry: { unit, signedValue } }),
        idempotencyKey,
    }) as { id: string };
}

function nextOpenOrder(jewellerId: string, karigarId: string, sourceOrderId: string): OrderRow | undefined {
    return db.prepare(`
        SELECT * FROM orders
        WHERE jeweller_id = ? AND karigar_id = ? AND status = 'open' AND id != ?
        ORDER BY due_date, rowid LIMIT 1
    `).get(jewellerId, karigarId, sourceOrderId) as OrderRow | undefined;
}

interface ResolutionInput {
    option: DisputeResolutionOption;
    agreedWeightMg?: number;
    agreedPurityPerMille?: number;
    agreedAmountPaise?: number;
}

interface PendingResolution {
    disputeId: string;
    status: 'pending_ack';
    resolutionEventId: string;
}

interface EscalatedResolution {
    disputeId: string;
    status: 'escalated';
    resolutionEventId: null;
}

export function resolveDispute(
    disputeId: string,
    actorId: string,
    input: ResolutionInput & { option: Exclude<DisputeResolutionOption, 'escalate_to_human'> },
): PendingResolution;
export function resolveDispute(
    disputeId: string,
    actorId: string,
    input: ResolutionInput & { option: 'escalate_to_human' },
): EscalatedResolution;
export function resolveDispute(
    disputeId: string,
    actorId: string,
    input: ResolutionInput,
): PendingResolution | EscalatedResolution;
export function resolveDispute(disputeId: string, actorId: string, input: unknown): PendingResolution | EscalatedResolution {
    const request = DisputeResolutionSchema.parse(input);
    const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as {
        id: string;
        event_id: string;
        status: DisputeStatus;
        claimed_weight_mg: number | null;
        claimed_purity_per_mille: number | null;
        claimed_amount_paise: number | null;
        created_by: string | null;
    } | undefined;
    if (!dispute) throw new Error('Dispute not found.');
    if (dispute.status !== 'unresolved' && dispute.status !== 'escalated') {
        throw new Error('This dispute is not awaiting an outcome.');
    }
    const event = rowEvent(dispute.event_id);
    const order = rowOrder(event.order_id);
    const actor = assertOrderAccess(order, actorId);
    if (actor.role === 'staff') throw new Error('Only the jeweller or karigar can select a dispute outcome.');
    if (dispute.status === 'escalated' && actor.role !== 'jeweller') {
        throw new Error('An escalated dispute can only be resolved by the jeweller.');
    }
    if (actorId === dispute.created_by && dispute.status !== 'escalated') {
        throw new Error('The party that opened the dispute cannot select its outcome.');
    }

    const hasWeight = event.weight_mg !== 0 || event.fine_weight_mg !== null;
    const hasAmount = event.amount !== 0;
    const originalWeightMg = event.weight_mg;
    const originalAmountPaise = event.amount;
    const originalPurity = event.purity_per_mille;
    const claimedWeightMg = dispute.claimed_weight_mg ?? originalWeightMg;
    const claimedAmountPaise = dispute.claimed_amount_paise ?? originalAmountPaise;
    const claimedPurity = dispute.claimed_purity_per_mille ?? originalPurity;
    const pinnedAgreement = getPinnedAgreement(event);
    let finalWeightMg = originalWeightMg;
    let finalAmountPaise = originalAmountPaise;
    let finalPurity = originalPurity;
    let carryValue = 0;

    if (request.option === 'escalate_to_human') {
        escalateDispute(disputeId, actorId);
        return { disputeId, status: 'escalated', resolutionEventId: null };
    }
    if (request.option === 'apply_agreement' && !pinnedAgreement) {
        throw new Error('This entry has no pinned agreement version to apply.');
    }
    if (request.option === 'reweigh_together') {
        if (hasWeight) {
            if (request.agreedWeightMg === undefined) throw new Error('Enter the agreed weight after re-weighing.');
            if (event.type !== 'correction' && request.agreedWeightMg < 0) {
                throw new Error('A physical reading cannot have negative weight.');
            }
            finalWeightMg = request.agreedWeightMg;
            finalPurity = request.agreedPurityPerMille ?? originalPurity;
        }
        if (hasAmount) {
            if (request.agreedAmountPaise === undefined) throw new Error('Enter the agreed amount after review.');
            finalAmountPaise = request.agreedAmountPaise;
        }
    } else if (request.option === 'split_capped_difference') {
        if (hasWeight) {
            finalWeightMg = calculateCappedSplitSignedValue(
                originalWeightMg,
                claimedWeightMg,
                DISPUTE_CONFIG.splitDifferenceCapMg,
            );
            finalPurity = originalPurity !== null && claimedPurity !== null
                ? calculateCappedSplitValue(originalPurity, claimedPurity, DISPUTE_CONFIG.splitDifferenceCapPurityPerMille)
                : originalPurity;
        }
        if (hasAmount) {
            finalAmountPaise = calculateCappedSplitSignedValue(
                originalAmountPaise,
                claimedAmountPaise,
                DISPUTE_CONFIG.splitDifferenceCapPaise,
            );
        }
    } else if (request.option === 'carry_to_next_job') {
        const weightDifference = hasWeight ? claimedWeightMg - originalWeightMg : 0;
        const amountDifference = hasAmount ? claimedAmountPaise - originalAmountPaise : 0;
        if (weightDifference !== 0 && amountDifference !== 0) {
            throw new Error('Carry-forward supports one disputed unit at a time; choose a different outcome for this entry.');
        }
        carryValue = weightDifference !== 0 || hasWeight && !hasAmount ? weightDifference : amountDifference;
    }

    const finalFineMg = hasWeight && finalPurity !== null
        ? calculateSignedFineGoldMg(finalWeightMg, finalPurity)
        : event.fine_weight_mg ?? 0;
    const originalFineMg = event.fine_weight_mg ?? (originalPurity === null
        ? 0
        : calculateSignedFineGoldMg(originalWeightMg, originalPurity));
    const weightDeltaMg = hasWeight ? finalWeightMg - originalWeightMg : 0;
    const fineDeltaMg = hasWeight ? finalFineMg - originalFineMg : 0;
    const amountDeltaPaise = hasAmount ? finalAmountPaise - originalAmountPaise : 0;
    const carryUnit: CarryUnit = hasWeight && (claimedWeightMg !== originalWeightMg || !hasAmount) ? 'mg' : 'paise';
    const createdAt = now().toISOString();

    const resolution = db.transaction(() => {
        const correction = buildResolutionEvent(
            event,
            actorId,
            disputeId,
            weightDeltaMg,
            fineDeltaMg,
            amountDeltaPaise,
            finalPurity,
            `dispute-resolution-${disputeId}`,
            request.option === 'carry_to_next_job'
                ? `Agreed carry of ${carryValue} ${carryUnit}.`
                : request.option === 'apply_agreement'
                    ? `Applied agreement v${pinnedAgreement?.version} as written: ${pinnedAgreement?.percentBps} bps on ${pinnedAgreement?.basis}.`
                    : `Resolution: ${request.option}.`,
        );
        db.prepare(`
            UPDATE disputes
            SET status = 'pending_ack', resolution_option = ?, resolution_event_id = ?,
                resolution_selected_by = ?, resolution_at = ?, ${actorId === order.jeweller_id ? 'jeweller_ack_at' : 'karigar_ack_at'} = ?
            WHERE id = ?
        `).run(request.option, correction.id, actorId, createdAt, createdAt, disputeId);
        insertAction(disputeId, actorId, 'outcome_selected', {
            option: request.option,
            finalWeightMg,
            finalPurityPerMille: finalPurity,
            finalAmountPaise,
            carryValue: request.option === 'carry_to_next_job' ? carryValue : null,
            unit: request.option === 'carry_to_next_job' ? carryUnit : null,
            agreementVersion: request.option === 'apply_agreement' ? pinnedAgreement?.version : null,
            agreementBasis: request.option === 'apply_agreement' ? pinnedAgreement?.basis : null,
        });

        if (request.option === 'carry_to_next_job') {
            const target = nextOpenOrder(order.jeweller_id, order.karigar_id, order.id);
            const purity = carryUnit === 'mg' ? (event.purity_per_mille ?? DISPUTE_CONFIG.carryDefaultPurityPerMille) : null;
            if (target) {
                const carryEvent = createCarryEvent(
                    disputeId,
                    target.id,
                    actorId,
                    carryUnit,
                    carryValue,
                    purity,
                    `dispute-carry-${disputeId}-${target.id}`,
                );
                db.prepare(`
                    INSERT INTO dispute_carries
                        (id, dispute_id, jeweller_id, karigar_id, source_order_id, target_order_id,
                         unit, signed_value, purity_per_mille, status, ledger_event_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_ack', ?, ?)
                `).run(
                    crypto.randomUUID(), disputeId, order.jeweller_id, order.karigar_id, order.id,
                    target.id, carryUnit, carryValue, purity, carryEvent.id, createdAt,
                );
            } else {
                db.prepare(`
                    INSERT INTO dispute_carries
                        (id, dispute_id, jeweller_id, karigar_id, source_order_id, target_order_id,
                         unit, signed_value, purity_per_mille, status, ledger_event_id, created_at)
                    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'pending_ack', ?, ?)
                `).run(
                    crypto.randomUUID(), disputeId, order.jeweller_id, order.karigar_id, order.id,
                    carryUnit, carryValue, purity, correction.id, createdAt,
                );
            }
        }
        return correction;
    });
    const result = resolution();
    return { disputeId, status: 'pending_ack', resolutionEventId: result.id };
}

export function escalateDispute(disputeId: string, actorId: string): void {
    const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as {
        id: string;
        event_id: string;
        status: DisputeStatus;
    } | undefined;
    if (!dispute) throw new Error('Dispute not found.');
    if (dispute.status !== 'unresolved') throw new Error('Only an unresolved dispute can be escalated.');
    const event = rowEvent(dispute.event_id);
    const order = rowOrder(event.order_id);
    assertOrderAccess(order, actorId);
    const escalatedAt = now().toISOString();
    db.transaction(() => {
        db.prepare("UPDATE disputes SET status = 'escalated', escalated_at = ? WHERE id = ?")
            .run(escalatedAt, disputeId);
        insertAction(disputeId, actorId, 'escalated');
    })();
}

export function acknowledgeDisputeOutcome(eventId: string, actorId: string): void {
    const event = rowEvent(eventId);
    const order = rowOrder(event.order_id);
    assertOrderAccess(order, actorId);
    const resolution = db.prepare(`
        SELECT id, resolution_selected_by AS selectedBy, status
        FROM disputes WHERE resolution_event_id = ?
    `).get(eventId) as { id: string; selectedBy: string; status: DisputeStatus } | undefined;
    const carry = db.prepare(`
        SELECT c.dispute_id AS disputeId, c.status, d.resolution_selected_by AS selectedBy
        FROM dispute_carries c JOIN disputes d ON d.id = c.dispute_id
        WHERE c.ledger_event_id = ?
    `).get(eventId) as { disputeId: string; status: string; selectedBy: string | null } | undefined;
    if (!resolution && !carry) return;
    if (resolution?.status === 'resolved' || (carry && carry.status === 'applied')) return;
    const disputeId = resolution?.id ?? carry?.disputeId;
    if (!disputeId) return;
    if (resolution && resolution.status !== 'pending_ack') throw new Error('Dispute outcome is not awaiting acknowledgement.');
    if (carry && carry.status !== 'pending_ack') throw new Error('Carry is not awaiting acknowledgement.');

    db.transaction(() => {
        const partyColumn = actorId === order.jeweller_id ? 'jeweller_ack_at' : 'karigar_ack_at';
        if (resolution) {
            db.prepare(`UPDATE disputes SET ${partyColumn} = ? WHERE id = ?`)
                .run(now().toISOString(), resolution.id);
            const latest = db.prepare('SELECT jeweller_ack_at, karigar_ack_at FROM disputes WHERE id = ?')
                .get(resolution.id) as { jeweller_ack_at: string | null; karigar_ack_at: string | null };
            const otherPartyAcked = actorId === order.jeweller_id
                ? latest.karigar_ack_at !== null
                : latest.jeweller_ack_at !== null;
            if (otherPartyAcked) {
                db.prepare("UPDATE disputes SET status = 'resolved', resolved_at = ? WHERE id = ?")
                    .run(now().toISOString(), resolution.id);
                db.prepare("UPDATE dispute_carries SET status = 'pending_job' WHERE dispute_id = ? AND target_order_id IS NULL AND status = 'pending_ack'")
                    .run(resolution.id);
            }
            insertAction(resolution.id, actorId, 'outcome_acknowledged', { eventId });
        }
        if (carry && !resolution) {
            db.prepare("UPDATE dispute_carries SET status = 'applied' WHERE dispute_id = ? AND status = 'pending_ack'")
                .run(carry.disputeId);
            insertAction(carry.disputeId, actorId, 'carry_acknowledged', { eventId, orderId: order.id });
        }
    })();
}

export function applyPendingDisputeCarries(orderId: string, actorId: string): string[] {
    const order = rowOrder(orderId);
    assertOrderAccess(order, actorId);
    const pending = db.prepare(`
        SELECT * FROM dispute_carries
        WHERE jeweller_id = ? AND karigar_id = ? AND status = 'pending_job'
        ORDER BY created_at, id
    `).all(order.jeweller_id, order.karigar_id) as Array<{
        dispute_id: string;
        unit: CarryUnit;
        signed_value: number;
        purity_per_mille: number | null;
    }>;
    const issue = db.prepare(`
        SELECT id FROM ledger_events WHERE order_id = ? AND type = 'issue' AND status = 'acknowledged'
        ORDER BY created_at, rowid LIMIT 1
    `).get(orderId);
    if (!issue) return [];
    return db.transaction(() => pending.map((item) => {
        const carryEvent = createCarryEvent(
            item.dispute_id,
            orderId,
            actorId,
            item.unit,
            item.signed_value,
            item.purity_per_mille,
            `dispute-carry-apply-${item.dispute_id}-${orderId}`,
        );
        db.prepare(`
            UPDATE dispute_carries
            SET target_order_id = ?, status = 'pending_ack', ledger_event_id = ?
            WHERE dispute_id = ? AND status = 'pending_job'
        `).run(orderId, carryEvent.id, item.dispute_id);
        insertAction(item.dispute_id, actorId, 'carry_posted_to_job', { orderId, eventId: carryEvent.id });
        return carryEvent.id;
    }))();
}

export function getDisputeDetails(disputeId: string, actorId: string) {
    const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as {
        id: string;
        event_id: string;
        karigar_id: string;
        reason: string;
        status: DisputeStatus;
        created_by: string | null;
        created_at: string | null;
        claimed_weight_mg: number | null;
        claimed_purity_per_mille: number | null;
        claimed_amount_paise: number | null;
        resolution_option: DisputeResolutionOption | null;
        resolution_event_id: string | null;
        resolution_selected_by: string | null;
        resolution_at: string | null;
        resolved_at: string | null;
        escalated_at: string | null;
        jeweller_ack_at: string | null;
        karigar_ack_at: string | null;
    } | undefined;
    if (!dispute) throw new Error('Dispute not found.');
    const original = rowEvent(dispute.event_id);
    const order = rowOrder(original.order_id);
    assertOrderAccess(order, actorId);
    const evidenceRows = db.prepare(`
        SELECT id, uploaded_by AS uploadedBy, file_name AS fileName, mime_type AS mimeType,
            sha256, content_base64 AS base64, created_at AS createdAt
        FROM dispute_evidence WHERE dispute_id = ? ORDER BY created_at, rowid
    `).all(disputeId) as Array<{
        id: string;
        uploadedBy: string;
        fileName: string;
        mimeType: string;
        sha256: string;
        base64: string;
        createdAt: string;
    }>;
    const evidence = evidenceRows.map((item) => ({
        ...item,
        verified: crypto.createHash('sha256').update(Buffer.from(item.base64, 'base64')).digest('hex') === item.sha256,
    }));
    const agreement = getPinnedAgreement(original);
    const history = getHistory(order);
    const actions = db.prepare(`
        SELECT actor_id AS actorId, action, details_json AS detailsJson, created_at AS createdAt
        FROM dispute_actions WHERE dispute_id = ? ORDER BY created_at, rowid
    `).all(disputeId) as Array<{ actorId: string; action: string; detailsJson: string; createdAt: string }>;
    const resolutionEvent = dispute.resolution_event_id
        ? rowEvent(dispute.resolution_event_id)
        : undefined;
    const carry = db.prepare(`
        SELECT unit, signed_value AS signedValue, status, target_order_id AS targetOrderId,
            ledger_event_id AS ledgerEventId
        FROM dispute_carries WHERE dispute_id = ?
    `).get(disputeId) as {
        unit: CarryUnit;
        signedValue: number;
        status: string;
        targetOrderId: string | null;
        ledgerEventId: string;
    } | undefined;
    const chainVerified = verifyLedgerChain(original.order_id)
        && (!resolutionEvent || verifyLedgerChain(resolutionEvent.order_id))
        && (!carry?.targetOrderId || verifyLedgerChain(carry.targetOrderId));
    const optionRows = DISPUTE_CONFIG.resolutionOptions
        .filter((option) => (option.value !== 'escalate_to_human' || dispute.status === 'unresolved')
            && (option.value !== 'apply_agreement' || agreement))
        .map((option) => ({ ...option }));
    return {
        id: dispute.id,
        orderId: order.id,
        orderDescription: order.description,
        jobType: order.job_type,
        status: dispute.status,
        reason: dispute.reason,
        createdBy: dispute.created_by,
        createdAt: dispute.created_at,
        original: {
            id: original.id,
            type: original.type,
            weightMg: original.weight_mg,
            fineWeightMg: original.fine_weight_mg,
            purityPerMille: original.purity_per_mille,
            amountPaise: original.amount,
            status: original.status,
            createdBy: original.created_by,
            createdAt: original.created_at,
            acknowledgedAt: original.acknowledged_at,
            agreementId: original.agreement_id,
            agreementVersion: original.agreement_version,
            ratePolicy: original.rate_policy,
            rateSnapshotPaisePerGram: original.rate_snapshot_paise_per_gram,
            previousHash: original.previous_hash,
            hash: original.hash,
        },
        claimed: {
            weightMg: dispute.claimed_weight_mg ?? original.weight_mg,
            purityPerMille: dispute.claimed_purity_per_mille ?? original.purity_per_mille,
            amountPaise: dispute.claimed_amount_paise ?? original.amount,
        },
        agreement: agreement ?? null,
        historicalLossVsAllowance: history,
        evidence,
        actions: actions.map((action) => ({
            actorId: action.actorId,
            action: action.action,
            details: JSON.parse(action.detailsJson),
            createdAt: action.createdAt,
        })),
        resolutionOption: dispute.resolution_option,
        resolutionEventId: dispute.resolution_event_id,
        resolutionAt: dispute.resolution_at,
        resolvedAt: dispute.resolved_at,
        escalatedAt: dispute.escalated_at,
        acknowledgements: {
            jewellerAt: dispute.jeweller_ack_at,
            karigarAt: dispute.karigar_ack_at,
        },
        resolution: resolutionEvent ? {
            id: resolutionEvent.id,
            weightMg: resolutionEvent.weight_mg,
            fineWeightMg: resolutionEvent.fine_weight_mg,
            amountPaise: resolutionEvent.amount,
            status: resolutionEvent.status,
            createdBy: resolutionEvent.created_by,
            createdAt: resolutionEvent.created_at,
            notes: resolutionEvent.notes,
        } : null,
        carry: carry ?? null,
        options: optionRows,
        hashVerified: chainVerified && evidence.every((item) => item.verified),
    };
}

export function getOrderDisputeEntries(orderId: string, actorId: string) {
    const order = rowOrder(orderId);
    assertOrderAccess(order, actorId);
    const rows = db.prepare(`
        SELECT e.id, e.type, e.weight_mg AS weightMg, e.fine_weight_mg AS fineWeightMg,
            e.purity_per_mille AS purityPerMille, e.amount AS amountPaise, e.status,
            e.created_by AS createdBy, e.created_at AS createdAt,
            e.acknowledged_at AS acknowledgedAt, e.agreement_version AS agreementVersion,
            e.rate_policy AS ratePolicy, e.rate_snapshot_paise_per_gram AS rateSnapshotPaisePerGram,
            e.previous_hash AS previousHash, e.hash,
            d.id AS disputeId, d.status AS disputeStatus
        FROM ledger_events e
        LEFT JOIN disputes d ON d.id = (
            SELECT d2.id FROM disputes d2 WHERE d2.event_id = e.id ORDER BY d2.created_at DESC, d2.rowid DESC LIMIT 1
        )
        WHERE e.order_id = ?
        ORDER BY e.created_at DESC, e.rowid DESC
    `).all(orderId) as Array<{
        id: string;
        type: string;
        weightMg: number;
        fineWeightMg: number | null;
        purityPerMille: number | null;
        amountPaise: number;
        status: string;
        createdBy: string;
        createdAt: string;
        acknowledgedAt: string | null;
        agreementVersion: number | null;
        ratePolicy: string | null;
        rateSnapshotPaisePerGram: number | null;
        previousHash: string | null;
        hash: string;
        disputeId: string | null;
        disputeStatus: string | null;
    }>;
    const chainVerified = verifyLedgerChain(orderId);
    return {
        order: { id: order.id, description: order.description, jobType: order.job_type },
        chainVerified,
        entries: rows.map((event) => ({
            ...event,
            hashVerified: chainVerified,
            canDispute: event.weightMg !== 0 || event.amountPaise !== 0 || event.fineWeightMg !== null,
        })),
    };
}

export function getEscalatedDisputes(actorId: string) {
    const actor = rowActor(actorId);
    const orders = actor.role === 'karigar'
        ? db.prepare(`
            SELECT d.id, d.event_id AS eventId, d.reason, d.status, d.created_at AS createdAt,
                o.id AS orderId, o.description
            FROM disputes d JOIN ledger_events e ON e.id = d.event_id JOIN orders o ON o.id = e.order_id
            WHERE d.status = 'escalated' AND d.karigar_id = ?
            ORDER BY d.escalated_at, d.id
        `).all(actorId)
        : actor.role === 'jeweller'
            ? db.prepare(`
                SELECT d.id, d.event_id AS eventId, d.reason, d.status, d.created_at AS createdAt,
                    o.id AS orderId, o.description
                FROM disputes d JOIN ledger_events e ON e.id = d.event_id JOIN orders o ON o.id = e.order_id
                WHERE d.status = 'escalated' AND o.jeweller_id = ?
                ORDER BY d.escalated_at, d.id
            `).all(actorId)
            : db.prepare(`
                SELECT d.id, d.event_id AS eventId, d.reason, d.status, d.created_at AS createdAt,
                    o.id AS orderId, o.description
                FROM disputes d JOIN ledger_events e ON e.id = d.event_id JOIN orders o ON o.id = e.order_id
                JOIN staff_profiles p ON p.owner_jeweller_id = o.jeweller_id
                WHERE d.status = 'escalated' AND p.user_id = ?
                ORDER BY d.escalated_at, d.id
            `).all(actorId);
    return (orders as Array<{
        id: string;
        eventId: string;
        reason: string;
        status: string;
        createdAt: string | null;
        orderId: string;
        description: string;
    }>).map((item) => ({
        ...item,
        ageDays: item.createdAt
            ? Math.max(0, Math.floor((now().getTime() - new Date(item.createdAt).getTime()) / 86_400_000))
            : 0,
        href: `/disputes/${item.id}`,
    }));
}

registerLedgerAcknowledgementHook((eventId, actorId, type, orderId) => {
    acknowledgeDisputeOutcome(eventId, actorId);
    if (type === 'issue') applyPendingDisputeCarries(orderId, actorId);
});
