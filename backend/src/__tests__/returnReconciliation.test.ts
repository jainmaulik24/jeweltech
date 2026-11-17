import request from 'supertest';
import app from '../app';
import db from '../db';
import { appendLedgerEvent, replayAndVerifyOrder } from '../ledger';
import { setClock } from '../clock';
import { RETURN_RECONCILIATION_CONFIG } from '../agreementConfig';
import {
    calculateReturnReconciliation,
    formatReturnExplanation,
    ReturnReconciliationInput,
} from '../calc';

const config = {
    grossWeightToleranceMg: 100,
    purityShortfallToleranceFineMg: 0,
    unusedAllowancePolicy: 'karigar_keeps' as const,
    purityLabels: { 833: '20K', 916: '22K', 958: '23K' },
};

function calculate(overrides: Partial<ReturnReconciliationInput> = {}) {
    return calculateReturnReconciliation({
        issuedLots: [{ weightMg: 100_000, purityPerMille: 916 }],
        finishedLots: [{ weightMg: 100_000, purityPerMille: 833, method: 'XRF' }],
        scrapLots: [],
        agreement: { basis: 'fine_issued', percentBps: 200 },
        config,
        ...overrides,
    });
}

describe('return reconciliation calculations', () => {
    it('flags matched gross weight with an 8,300 mg fine-gold purity shortfall', () => {
        const result = calculate();

        expect(result.grossWeightMatched).toBe(true);
        expect(result.fineIssuedMg).toBe(91_600);
        expect(result.fineFinishedMg).toBe(83_300);
        expect(result.processLossFineMg).toBe(8_300);
        expect(result.allowanceFineMg).toBe(1_832);
        expect(result.owedFineMg).toBe(6_468);
        expect(result.status).toBe('PURITY_SHORTFALL');
        expect(result.explanation.en).toContain('20K instead of 22K');
        expect(result.explanation.en).toContain('8.3 g of fine gold is missing');
        expect(result.explanation.kn).toContain('20K');
    });

    it('keeps a return within allowance and reports unused allowance under policy', () => {
        const result = calculate({
            finishedLots: [{ weightMg: 98_000, purityPerMille: 916, method: 'touch' }],
            scrapLots: [{ weightMg: 1_000, purityPerMille: 916 }],
        });

        expect(result.status).toBe('WITHIN_ALLOWANCE');
        expect(result.processLossFineMg).toBe(916);
        expect(result.unusedAllowanceFineMg).toBe(916);
        expect(result.unusedAllowancePolicy).toBe('karigar_keeps');
        expect(result.fineScrapMg).toBe(916);
    });

    it('computes an amount owed beyond allowance and flags excess returns for review', () => {
        const over = calculate({
            finishedLots: [{ weightMg: 96_000, purityPerMille: 916, method: 'declared' }],
        });
        const excess = calculate({
            finishedLots: [{ weightMg: 102_000, purityPerMille: 916, method: 'XRF' }],
        });

        expect(over.status).toBe('KARIGAR_OWES');
        expect(over.owedFineMg).toBe(1_832);
        expect(excess.status).toBe('EXCESS_REVIEW');
        expect(excess.excessFineMg).toBe(1_832);
    });

    it('aggregates multiple issue and finished lots and supports zero scrap', () => {
        const result = calculate({
            issuedLots: [
                { weightMg: 50_000, purityPerMille: 916 },
                { weightMg: 50_000, purityPerMille: 958 },
            ],
            finishedLots: [
                { weightMg: 50_000, purityPerMille: 916, method: 'touch' },
                { weightMg: 50_000, purityPerMille: 958, method: 'XRF' },
            ],
            scrapLots: [],
            agreement: { basis: 'gross_issued', percentBps: 0 },
        });

        expect(result.grossFinishedMg).toBe(100_000);
        expect(result.fineIssuedMg).toBe(93_700);
        expect(result.fineFinishedMg).toBe(93_700);
        expect(result.fineScrapMg).toBe(0);
        expect(result.processLossFineMg).toBe(0);
        expect(result.status).toBe('WITHIN_ALLOWANCE');
    });

    it('uses the finished-weight agreement basis and formats a bilingual purity explanation', () => {
        const result = calculate({
            finishedLots: [{ weightMg: 90_000, purityPerMille: 916, method: 'declared' }],
            agreement: { basis: 'finished_weight', percentBps: 200 },
        });

        expect(result.allowanceFineMg).toBe(1_800);
        expect(formatReturnExplanation(result, 'en')).toBe(result.explanation.en);
        expect(formatReturnExplanation(result, 'kn')).toBe(result.explanation.kn);
    });

    it('matches each seeded return example to its expected outcome', () => {
        const statuses = RETURN_RECONCILIATION_CONFIG.demoScenarios.map((scenario) => (
            calculateReturnReconciliation({
                issuedLots: [{ weightMg: 100_000, purityPerMille: 916 }],
                finishedLots: scenario.finishedLots,
                scrapLots: scenario.scrapLots,
                agreement: { basis: 'fine_issued', percentBps: 200 },
                config,
            }).status
        ));

        expect(statuses).toEqual([
            'PURITY_SHORTFALL',
            'WITHIN_ALLOWANCE',
            'KARIGAR_OWES',
            'EXCESS_REVIEW',
        ]);
    });
});

describe('return reconciliation ledger workflow', () => {
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
            VALUES ('ord-return-test', 'j1', 'k1', 'Plain bangles', '2026-12-01');
          INSERT INTO wastage_agreements
            (id, order_id, jeweller_id, karigar_id, job_type, basis, percent_bps,
             labour_rate_paise_per_gram, sweep_owner, karigar_sweep_share_bps,
             cash_rate_policy, version, effective_at, status, accepted_at, created_at)
          VALUES
            ('agr-return-test-v1', 'ord-return-test', 'j1', 'k1', 'plain', 'fine_issued', 200,
             4000, 'karigar', 10000, 'issue', 1, '2026-11-16T10:00:00.000Z',
             'accepted', '2026-11-16T10:00:00.000Z', '2026-11-16T10:00:00.000Z');
        `);
        appendLedgerEvent({
            id: 'evt-return-test-issue',
            orderId: 'ord-return-test',
            type: 'issue',
            weightMg: 100_000,
            fineWeightMg: 91_600,
            purityPerMille: 916,
            status: 'acknowledged',
            createdBy: 'j1',
            notes: null,
            idempotencyKey: 'return-test-issue',
            agreementId: 'agr-return-test-v1',
            agreementVersion: 1,
        });
    });

    afterEach(() => setClock(null));

    it('requires a purity reading and posts a balanced purity-shortfall draft through dual approval', async () => {
        const missingPurity = await request(app)
            .post('/api/orders/ord-return-test/returns/reconcile')
            .set('x-user-id', 'k1')
            .send({
                idempotencyKey: 'return-missing-purity',
                finishedLots: [{ weightGrams: '100', method: 'XRF' }],
                scrapLots: [],
            });
        expect(missingPurity.status).toBe(400);

        const response = await request(app)
            .post('/api/orders/ord-return-test/returns/reconcile')
            .set('x-user-id', 'k1')
            .send({
                idempotencyKey: 'return-purity-trap',
                finishedLots: [{ weightGrams: '100', purityPerMille: 833, method: 'XRF' }],
                scrapLots: [],
            });

        expect(response.status).toBe(200);
        expect(response.body.result.status).toBe('PURITY_SHORTFALL');
        expect(response.body.result.processLossFineMg).toBe(8_300);
        expect(response.body.settlementDraft.status).toBe('pending_ack');
        expect(response.body.settlementDraft.agreementVersion).toBe(1);
        expect(response.body.settlementDraft.notes).toContain('Agreement v1');

        for (const event of response.body.events) {
            const acknowledged = await request(app)
                .post(`/api/ledger/${event.id}/acknowledge`)
                .set('x-user-id', 'j1');
            expect(acknowledged.status).toBe(200);
        }

        const replay = replayAndVerifyOrder('ord-return-test');
        expect(replay.isValidChain).toBe(true);
        expect(replay.netKarigarHeldMg).toBe(0);
        expect(replay.accountBalances.finished_goods.fineMg).toBe(83_300);
        expect(replay.accountBalances.process_loss.fineMg).toBe(1_832);
        expect(replay.accountBalances.jeweller_vault.fineMg).toBe(-85_132);
        expect(Object.values(replay.accountBalances).reduce((sum, account) => sum + account.fineMg, 0)).toBe(0);
        expect(Object.values(replay.accountBalances).reduce((sum, account) => sum + account.grossMg, 0)).toBe(0);
    });
});
