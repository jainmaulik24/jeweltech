import request from 'supertest';
import app from '../app';
import db from '../db';
import { replayAndVerifyOrder } from '../ledger';
import { calculateEffectiveRatePaisePerFinishedGram, calculateRatePolicyAmounts, computeAgreementAllowanceMg } from '../calc';
import { setClock } from '../clock';

describe('Wastage agreement calculations and handshake', () => {
    beforeEach(() => {
        setClock({ now: () => new Date('2026-11-16T10:00:00.000Z') });
        db.exec(`
          DELETE FROM ledger_events;
          DELETE FROM wastage_agreements;
          DELETE FROM orders;
          DELETE FROM users;
          INSERT INTO users (id, role, name) VALUES ('j1', 'jeweller', 'Sri Raj Jewellers');
          INSERT INTO users (id, role, name) VALUES ('k1', 'karigar', 'Ramesh');
          INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date)
            VALUES ('ord-agreement-test', 'j1', 'k1', 'Gold bangles', '2026-12-01');
        `);
    });

    afterEach(() => setClock(null));

    it('calculates allowance from fine issued, gross issued, and finished-weight bases', () => {
        const input = {
            issuedGrossMg: 20_000,
            issuedPurityPerMille: 916,
            finishedWeightMg: 18_000,
            percentBps: 300,
        };

        expect(computeAgreementAllowanceMg({ ...input, basis: 'fine_issued' })).toBe(550);
        expect(computeAgreementAllowanceMg({ ...input, basis: 'gross_issued' })).toBe(600);
        expect(computeAgreementAllowanceMg({ ...input, basis: 'finished_weight' })).toBe(540);
    });

    it('calculates effective pay using integer paise and flags a synthetic-range outlier', () => {
        const result = calculateEffectiveRatePaisePerFinishedGram({
            labourRatePaisePerGram: 4_000,
            allowanceMg: 600,
            finishedWeightMg: 18_000,
            sweepShareMg: 100,
            simulatedGoldRatePaisePerGram: 750_000,
            syntheticReferenceRangePaisePerGram: { min: 25_000, max: 32_000 },
        });

        expect(result.effectiveRatePaisePerFinishedGram).toBe(33_167);
        expect(result.outlier).toBe(true);
    });

    it('compares simulated cash rates under all three date policies', () => {
        expect(calculateRatePolicyAmounts({
            fineGoldMg: 10_000,
            ratesPaisePerGram: {
                issue: 700_000,
                return: 720_000,
                settlement: 750_000,
            },
        })).toEqual({
            issue: 7_000_000,
            return: 7_200_000,
            settlement: 7_500_000,
        });
    });

    it('records each version and acknowledgement, and pins past issues to their original version', async () => {
        const makeDraft = (basis: string, cashRatePolicy = 'issue') => request(app)
            .post('/api/orders/ord-agreement-test/agreements')
            .set('x-user-id', 'j1')
            .send({
                jobType: 'plain',
                basis,
                percentBps: 300,
                labourRatePaisePerGram: 4_000,
                sweepOwner: 'karigar',
                karigarSweepShareBps: 10_000,
                cashRatePolicy,
            });

        const firstDraft = await makeDraft('fine_issued');
        expect(firstDraft.status).toBe(200);
        expect(firstDraft.body.agreement.version).toBe(1);
        expect(firstDraft.body.agreement.effectiveAt).toBe('2026-11-16T10:00:00.000Z');

        const accepted = await request(app)
            .post(`/api/orders/ord-agreement-test/agreements/${firstDraft.body.agreement.id}/accept`)
            .set('x-user-id', 'k1');
        expect(accepted.status).toBe(200);
        const acceptedVersionEvent = db.prepare(`
            SELECT status FROM ledger_events
            WHERE agreement_id = ? AND type = 'agreement_version'
        `).get(firstDraft.body.agreement.id) as { status: string };
        expect(acceptedVersionEvent.status).toBe('acknowledged');

        const issue = await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 'j1')
            .send({
                orderId: 'ord-agreement-test',
                type: 'issue',
                weightMg: 20_000,
                idempotencyKey: 'agreement-issue-v1',
            });
        expect(issue.status).toBe(200);
        expect(issue.body.agreementVersion).toBe(1);
        const firstIssueAck = await request(app)
            .post(`/api/ledger/${issue.body.id}/acknowledge`)
            .set('x-user-id', 'k1');
        expect(firstIssueAck.status).toBe(200);

        const secondDraft = await makeDraft('gross_issued', 'return');
        expect(secondDraft.body.agreement.version).toBe(2);
        const issueRowBefore = db.prepare('SELECT agreement_id, agreement_version FROM ledger_events WHERE id = ?')
            .get(issue.body.id) as { agreement_id: string; agreement_version: number };

        await request(app)
            .post(`/api/orders/ord-agreement-test/agreements/${secondDraft.body.agreement.id}/accept`)
            .set('x-user-id', 'k1');

        const secondIssue = await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 'j1')
            .send({
                orderId: 'ord-agreement-test',
                type: 'issue',
                weightMg: 10_000,
                idempotencyKey: 'agreement-issue-v2',
            });
        const secondIssueAck = await request(app)
            .post(`/api/ledger/${secondIssue.body.id}/acknowledge`)
            .set('x-user-id', 'k1');
        expect(secondIssueAck.status).toBe(200);

        const issueRowAfter = db.prepare('SELECT agreement_id, agreement_version FROM ledger_events WHERE id = ?')
            .get(issue.body.id) as { agreement_id: string; agreement_version: number };
        expect(issueRowAfter).toEqual(issueRowBefore);
        expect(secondIssue.body.agreementVersion).toBe(2);

        const settlementProposal = await request(app).get('/api/orders/ord-agreement-test/settlement');
        expect(settlementProposal.status).toBe(200);
        expect(settlementProposal.body.breakdown).toContain('Agreement v2: 3.00% on gross issued.');

        const cashProposal = await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 'j1')
            .send({
                orderId: 'ord-agreement-test',
                type: 'settlement',
                weightMg: 30_000,
                amount: 1,
                idempotencyKey: 'agreement-cash-settlement-v2',
            });
        expect(cashProposal.status).toBe(200);
        expect(cashProposal.body.amount).toBe(19_785_600);
        expect(cashProposal.body.ratePolicy).toBe('return');
        expect(cashProposal.body.rateSnapshotPaisePerGram).toBe(720_000);
        expect(cashProposal.body.agreementVersion).toBe(2);
        expect(replayAndVerifyOrder('ord-agreement-test').isValidChain).toBe(true);

        const eventTypes = db.prepare('SELECT type FROM ledger_events ORDER BY rowid')
            .all() as Array<{ type: string }>;
        expect(eventTypes.map(({ type }) => type)).toEqual([
            'agreement_version',
            'agreement_acknowledgement',
            'issue',
            'agreement_version',
            'agreement_acknowledgement',
            'issue',
            'settlement',
        ]);
        const ledgerTimestamp = db.prepare('SELECT created_at AS createdAt FROM ledger_events ORDER BY rowid LIMIT 1')
            .get() as { createdAt: string };
        expect(ledgerTimestamp.createdAt).toBe('2026-11-16 10:00:00');
    });
});
