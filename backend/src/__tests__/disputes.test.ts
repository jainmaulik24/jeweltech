import crypto from 'crypto';
import db from '../db';
import { setClock } from '../clock';
import app from '../app';
import { agentTools } from '../agent';
import request from 'supertest';
import { appendLedgerEvent, progressEventStatus, replayAndVerifyOrder, verifyLedgerChain } from '../ledger';
import {
    acknowledgeDisputeOutcome,
    createDispute,
    escalateDispute,
    getDisputeDetails,
    getEscalatedDisputes,
    resolveDispute,
} from '../disputes';

const NOW = new Date('2026-11-16T10:00:00.000Z');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU4kAAAAASUVORK5CYII=';

function seedDisputeOrder(includeNextJob = true) {
    db.exec(`
        DELETE FROM dispute_evidence;
        DELETE FROM dispute_actions;
        DELETE FROM dispute_carries;
        DELETE FROM disputes;
        DELETE FROM ledger_events;
        DELETE FROM wastage_agreements;
        DELETE FROM orders;
        DELETE FROM users;

        INSERT INTO users (id, role, name) VALUES
            ('j1', 'jeweller', 'Jeweller One'),
            ('j2', 'jeweller', 'Jeweller Two'),
            ('k1', 'karigar', 'Ramesh');

        INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date, job_type)
        VALUES ('ord-dispute', 'j1', 'k1', 'Disputed bangles', '2026-11-25', 'plain');
    `);
    if (includeNextJob) {
        db.prepare(`
            INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date, job_type)
            VALUES ('ord-next', 'j1', 'k1', 'Next bangles', '2026-12-01', 'plain')
        `).run();
    }

    db.prepare(`
        INSERT INTO wastage_agreements
            (id, order_id, jeweller_id, karigar_id, job_type, basis, percent_bps,
             labour_rate_paise_per_gram, sweep_owner, karigar_sweep_share_bps,
             cash_rate_policy, version, effective_at, status, accepted_at, created_at)
        VALUES ('agr-dispute-v1', 'ord-dispute', 'j1', 'k1', 'plain', 'fine_issued', 200,
            4000, 'karigar', 10000, 'settlement', 1, ?, 'accepted', ?, ?)
    `).run(NOW.toISOString(), NOW.toISOString(), NOW.toISOString());

    appendLedgerEvent({
        id: 'evt-issue',
        orderId: 'ord-dispute',
        type: 'issue',
        weightMg: 10_000,
        purityPerMille: 916,
        status: 'acknowledged',
        createdBy: 'j1',
        idempotencyKey: 'evt-issue',
        agreementId: 'agr-dispute-v1',
        agreementVersion: 1,
    });
    appendLedgerEvent({
        id: 'evt-return',
        orderId: 'ord-dispute',
        type: 'return',
        weightMg: 8_000,
        purityPerMille: 916,
        status: 'acknowledged',
        createdBy: 'k1',
        idempotencyKey: 'evt-return',
        agreementId: 'agr-dispute-v1',
        agreementVersion: 1,
        ratePolicy: 'settlement',
        rateSnapshotPaisePerGram: 750_000,
    });
}

async function openWeightDispute(createdBy = 'k1', eventId = 'evt-return', claimedWeightMg = 8_500) {
    return createDispute(eventId, createdBy, {
        reason: 'Our scale reading differs.',
        claimedWeightMg,
        evidence: [{
            fileName: 'scale-reading.png',
            mimeType: 'image/png',
            base64: PNG,
        }],
    });
}

async function acknowledgeOutcome(disputeId: string, eventId: string, actorId: string) {
    progressEventStatus(eventId, actorId, 'acknowledged');
    acknowledgeDisputeOutcome(eventId, actorId);
    return getDisputeDetails(disputeId, actorId);
}

describe('dispute workflow', () => {
    beforeEach(() => {
        setClock({ now: () => NOW });
        seedDisputeOrder();
    });

    afterEach(() => setClock(null));

    it('does not expose dispute resolution as an autonomous agent tool', () => {
        expect(agentTools).not.toHaveProperty('createDispute');
        expect(agentTools).not.toHaveProperty('resolveDispute');
        expect(agentTools).not.toHaveProperty('acknowledgeDisputeOutcome');
    });

    it('lets either party contest, hashes evidence, and keeps the original event intact', async () => {
        const before = db.prepare('SELECT * FROM ledger_events WHERE id = ?').get('evt-return');
        const disputeId = await openWeightDispute('k1');
        const dispute = getDisputeDetails(disputeId, 'j1');
        const evidence = dispute.evidence[0];

        expect(dispute.status).toBe('unresolved');
        expect(dispute.createdBy).toBe('k1');
        expect(dispute.original).toEqual(expect.objectContaining({
            id: 'evt-return',
            weightMg: 8_000,
            purityPerMille: 916,
            agreementVersion: 1,
            rateSnapshotPaisePerGram: 750_000,
        }));
        expect(dispute.claimed).toEqual(expect.objectContaining({ weightMg: 8_500, purityPerMille: 916 }));
        expect(evidence.sha256).toBe(crypto.createHash('sha256').update(Buffer.from(PNG, 'base64')).digest('hex'));
        expect(evidence.verified).toBe(true);
        expect(db.prepare('SELECT * FROM ledger_events WHERE id = ?').get('evt-return')).toEqual(before);
        expect(dispute.historicalLossVsAllowance).toEqual(expect.objectContaining({
            jobType: 'plain',
            lossMg: 1_832,
            allowanceMg: 183,
        }));
        expect(verifyLedgerChain('ord-dispute')).toBe(true);
    });

    it.each([
        ['reweigh_together', 'k1', 'j1'],
        ['apply_agreement', 'j1', 'k1'],
        ['split_capped_difference', 'k1', 'j1'],
        ['carry_to_next_job', 'j1', 'k1'],
    ] as const)('resolves %s with a new acknowledged correction and a valid replay', async (option, opener, resolver) => {
        const disputeId = await openWeightDispute(opener);
        const resolution = await resolveDispute(disputeId, resolver, {
            option,
            agreedWeightMg: option === 'reweigh_together' ? 8_250 : undefined,
            agreedPurityPerMille: 916,
        });
        const original = db.prepare('SELECT * FROM ledger_events WHERE id = ?').get('evt-return');

        expect(resolution.status).toBe('pending_ack');
        expect(resolution.resolutionEventId).toBeTruthy();
        expect(db.prepare('SELECT * FROM ledger_events WHERE id = ?').get('evt-return')).toEqual(original);
        expect(getDisputeDetails(disputeId, resolver).resolutionOption).toBe(option);

        const completed = await acknowledgeOutcome(disputeId, resolution.resolutionEventId, opener);
        const state = replayAndVerifyOrder('ord-dispute');
        expect(completed.status).toBe('resolved');
        expect(state.isValidChain).toBe(true);
        expect(Object.values(state.accountBalances).reduce((sum, account) => sum + account.grossMg, 0)).toBe(0);
        expect(Object.values(state.accountBalances).reduce((sum, account) => sum + account.fineMg, 0)).toBe(0);
    });

    it('holds escalations open for owner review and resolves only after the karigar acknowledges the outcome', async () => {
        const disputeId = await openWeightDispute('k1');
        escalateDispute(disputeId, 'k1');

        expect(getDisputeDetails(disputeId, 'j1').status).toBe('escalated');
        expect(getEscalatedDisputes('j1')).toEqual([
            expect.objectContaining({ id: disputeId, ageDays: 0, orderId: 'ord-dispute' }),
        ]);
        expect(db.prepare('SELECT COUNT(*) AS count FROM ledger_events').get()).toEqual({ count: 2 });

        const resolution = await resolveDispute(disputeId, 'j1', { option: 'apply_agreement' });
        expect(resolution.status).toBe('pending_ack');
        const completed = await acknowledgeOutcome(disputeId, resolution.resolutionEventId, 'k1');
        expect(completed.status).toBe('resolved');
        expect(verifyLedgerChain('ord-dispute')).toBe(true);
    });

    it('carries signed differences as an open pair balance when no next job exists, then posts it on the next issued job', async () => {
        seedDisputeOrder(false);
        const disputeId = await openWeightDispute('k1', 'evt-return', 8_500);
        const resolution = await resolveDispute(disputeId, 'j1', { option: 'carry_to_next_job' });
        await acknowledgeOutcome(disputeId, resolution.resolutionEventId, 'k1');

        expect(db.prepare('SELECT status, target_order_id AS targetOrderId, signed_value AS signedValue FROM dispute_carries WHERE dispute_id = ?')
            .get(disputeId)).toEqual({ status: 'pending_job', targetOrderId: null, signedValue: 500 });

        db.prepare(`
            INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date, job_type)
            VALUES ('ord-following', 'j1', 'k1', 'Following bangles', '2026-12-05', 'plain')
        `).run();
        appendLedgerEvent({
            id: 'evt-following-issue',
            orderId: 'ord-following',
            type: 'issue',
            weightMg: 10_000,
            purityPerMille: 916,
            status: 'pending_ack',
            createdBy: 'j1',
            idempotencyKey: 'evt-following-issue',
        });
        progressEventStatus('evt-following-issue', 'k1', 'acknowledged');
        const carry = db.prepare(`
            SELECT e.id FROM ledger_events e
            JOIN dispute_carries c ON c.ledger_event_id = e.id
            WHERE c.dispute_id = ?
        `).get(disputeId) as { id: string };

        expect(db.prepare('SELECT target_order_id AS targetOrderId, status FROM dispute_carries WHERE dispute_id = ?')
            .get(disputeId)).toEqual({ targetOrderId: 'ord-following', status: 'pending_ack' });
        expect(replayAndVerifyOrder('ord-following').netKarigarHeldMg).toBe(10_000);
        progressEventStatus(carry.id, 'j1', 'acknowledged');
        acknowledgeDisputeOutcome(carry.id, 'j1');
        expect(db.prepare('SELECT status FROM dispute_carries WHERE dispute_id = ?').get(disputeId)).toEqual({ status: 'applied' });
        expect(replayAndVerifyOrder('ord-following').netKarigarHeldMg).toBe(10_500);
        expect(verifyLedgerChain('ord-following')).toBe(true);
    });

    it('reconciles weight and cash together on a disputed settlement without changing gold held', async () => {
        appendLedgerEvent({
            id: 'evt-settlement',
            orderId: 'ord-dispute',
            type: 'settlement',
            weightMg: 1_000,
            purityPerMille: 916,
            amount: 10_000,
            status: 'acknowledged',
            createdBy: 'j1',
            idempotencyKey: 'evt-settlement',
            agreementId: 'agr-dispute-v1',
            agreementVersion: 1,
            ratePolicy: 'settlement',
            rateSnapshotPaisePerGram: 750_000,
        });
        const disputeId = createDispute('evt-settlement', 'k1', {
            reason: 'Settlement weight and amount differ.',
            claimedWeightMg: 1_100,
            claimedPurityPerMille: 916,
            claimedAmountPaise: 12_000,
        });
        const resolution = resolveDispute(disputeId, 'j1', {
            option: 'reweigh_together',
            agreedWeightMg: 1_050,
            agreedPurityPerMille: 916,
            agreedAmountPaise: 11_000,
        });
        const correction = db.prepare(`
            SELECT weight_mg AS weightMg, amount FROM ledger_events WHERE id = ?
        `).get(resolution.resolutionEventId);

        expect(correction).toEqual({ weightMg: 50, amount: 1_000 });
        expect(replayAndVerifyOrder('ord-dispute').netKarigarHeldMg).toBe(2_000);
        progressEventStatus(resolution.resolutionEventId, 'k1', 'acknowledged');
        expect(getDisputeDetails(disputeId, 'k1').status).toBe('resolved');
        expect(verifyLedgerChain('ord-dispute')).toBe(true);
    });

    it('detects changes to the original event or stored evidence', async () => {
        const disputeId = await openWeightDispute();
        db.prepare("UPDATE dispute_evidence SET content_base64 = 'tampered' WHERE dispute_id = ?").run(disputeId);

        expect(getDisputeDetails(disputeId, 'j1').evidence[0].verified).toBe(false);
        expect(verifyLedgerChain('ord-dispute')).toBe(true);

        db.prepare("UPDATE ledger_events SET weight_mg = 7_999 WHERE id = 'evt-return'").run();
        expect(verifyLedgerChain('ord-dispute')).toBe(false);
    });

    it('serves dispute history only to the job parties and blocks unrelated parties from opening cases', async () => {
        const disputeId = await openWeightDispute();
        await request(app)
            .get('/api/orders/ord-dispute/disputes')
            .set('x-user-id', 'k1')
            .expect(200);
        await request(app)
            .get(`/api/disputes/${disputeId}`)
            .set('x-user-id', 'k1')
            .expect(200);
        await request(app)
            .get('/api/orders/ord-dispute/disputes')
            .set('x-user-id', 'j2')
            .expect(400);
        await request(app)
            .get(`/api/disputes/${disputeId}`)
            .set('x-user-id', 'j2')
            .expect(400);
        await request(app)
            .post('/api/ledger/evt-return/disputes')
            .set('x-user-id', 'j2')
            .send({ reason: 'Different reading', claimedWeightMg: 8_500 })
            .expect(400);
    });
});
