import request from 'supertest';
import app from '../app';
import db from '../db';
import { setClock } from '../clock';
import { appendLedgerEvent, replayAndVerifyOrder } from '../ledger';
import { getRate } from '../rateService';

const NOW = '2026-11-16T12:00:00.000Z';

function appendAt(date: string, event: Record<string, unknown>) {
    setClock({ now: () => new Date(date) });
    appendLedgerEvent(event);
}

function insertAgreement(orderId: string, agreementId: string, karigarId: string, labourRate = 4000) {
    db.prepare(`
        INSERT INTO wastage_agreements
        (id, order_id, jeweller_id, karigar_id, job_type, basis, percent_bps,
         labour_rate_paise_per_gram, sweep_owner, karigar_sweep_share_bps,
         cash_rate_policy, version, effective_at, status, accepted_at, created_at)
        VALUES (?, ?, ?, ?, 'plain', 'fine_issued', 200, ?, 'karigar', 10000,
         'settlement', 1, ?, 'accepted', ?, ?)
    `).run(
        agreementId,
        orderId,
        orderId === 'ord-board-j2' ? 'j2' : 'j1',
        karigarId,
        labourRate,
        NOW,
        NOW,
        NOW,
    );
}

describe('gold-at-large rates and dashboard', () => {
    beforeEach(() => {
        setClock({ now: () => new Date(NOW) });
        db.exec(`
          DELETE FROM ledger_events;
          DELETE FROM wastage_agreements;
          DELETE FROM orders;
          DELETE FROM users;
          INSERT INTO users (id, role, name) VALUES ('j1', 'jeweller', 'Jeweller One');
          INSERT INTO users (id, role, name) VALUES ('j2', 'jeweller', 'Jeweller Two');
          INSERT INTO users (id, role, name) VALUES ('k1', 'karigar', 'Ramesh');
          INSERT INTO users (id, role, name) VALUES ('k2', 'karigar', 'Sita');
          INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date)
            VALUES ('ord-board-k1', 'j1', 'k1', 'Bangle order', '2026-11-20');
          INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date)
            VALUES ('ord-board-k2', 'j1', 'k2', 'Chain order', '2026-11-18');
          INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date)
            VALUES ('ord-board-j2', 'j2', 'k2', 'Private jeweller order', '2026-11-18');
        `);

        insertAgreement('ord-board-k1', 'agr-board-k1', 'k1');
        insertAgreement('ord-board-k2', 'agr-board-k2', 'k2');
        insertAgreement('ord-board-j2', 'agr-board-j2', 'k2');

        appendAt('2026-10-12T09:00:00.000Z', {
            id: 'evt-board-k1-issue',
            orderId: 'ord-board-k1',
            type: 'issue',
            weightMg: 100_000,
            purityPerMille: 916,
            status: 'acknowledged',
            createdBy: 'j1',
            idempotencyKey: 'board-k1-issue',
            agreementId: 'agr-board-k1',
            agreementVersion: 1,
        });
        appendAt('2026-11-15T09:00:00.000Z', {
            id: 'evt-board-k1-return',
            orderId: 'ord-board-k1',
            type: 'return',
            weightMg: 40_000,
            purityPerMille: 916,
            status: 'acknowledged',
            createdBy: 'k1',
            idempotencyKey: 'board-k1-return',
            agreementId: 'agr-board-k1',
            agreementVersion: 1,
        });
        appendAt('2026-11-15T10:00:00.000Z', {
            id: 'evt-board-k2-issue',
            orderId: 'ord-board-k2',
            type: 'issue',
            weightMg: 20_000,
            purityPerMille: 958,
            status: 'acknowledged',
            createdBy: 'j1',
            idempotencyKey: 'board-k2-issue',
            agreementId: 'agr-board-k2',
            agreementVersion: 1,
        });
        appendAt(NOW, {
            id: 'evt-board-k2-pending-payment',
            orderId: 'ord-board-k2',
            type: 'payment',
            weightMg: 0,
            amount: 10_000,
            status: 'pending_ack',
            createdBy: 'j1',
            idempotencyKey: 'board-k2-pending-payment',
        });
        appendAt(NOW, {
            id: 'evt-board-j2-issue',
            orderId: 'ord-board-j2',
            type: 'issue',
            weightMg: 500_000,
            purityPerMille: 999,
            status: 'acknowledged',
            createdBy: 'j2',
            idempotencyKey: 'board-j2-issue',
            agreementId: 'agr-board-j2',
            agreementVersion: 1,
        });
    });

    afterEach(() => setClock(null));

    it('gets simulated rates by date and purity, applying configured rate shocks', () => {
        const quote = getRate(new Date('2026-11-16T12:00:00.000Z'), 916, 10);
        const historicalQuote = getRate(new Date('2026-10-23T12:00:00.000Z'));

        expect(quote.label).toBe('SIMULATED');
        expect(quote.baseRatePaisePerGram).toBe(750_000);
        expect(quote.rate24KPaisePerGram).toBe(825_000);
        expect(quote.ratePaisePerGram).toBe(756_456);
        expect(quote.shockPercent).toBe(10);
        expect(historicalQuote.sourceDate).toBe('2026-10-23');
        expect(historicalQuote.rate24KPaisePerGram).toBe(690_000);
    });

    it('shows ledger-derived stages, ageing, policy values, and live shock recalculation', async () => {
        const baseResponse = await request(app)
            .get('/api/gold-at-large')
            .set('x-user-id', 'j1');
        expect(baseResponse.status).toBe(200);
        expect(baseResponse.body.totals.fineGoldMg).toBe(110_760);
        expect(baseResponse.body.totals.workshopCount).toBe(2);
        expect(baseResponse.body.totals.valuePaise).toBe(83_070_000);
        expect(baseResponse.body.totals.valueLakh).toBe('8.3');
        expect(baseResponse.body.stages).toEqual(expect.arrayContaining([
            expect.objectContaining({ account: 'karigar_wip', fineGoldMg: 74_120 }),
            expect.objectContaining({ account: 'finished_goods', fineGoldMg: 36_640 }),
        ]));
        expect(baseResponse.body.ageing.reduce(
            (total: number, bucket: { fineGoldMg: number }) => total + bucket.fineGoldMg,
            0,
        )).toBe(baseResponse.body.totals.fineGoldMg);
        expect(baseResponse.body.ageing.find((bucket: { label: string }) => bucket.label === '31+ days').fineGoldMg)
            .toBe(91_600);
        expect(baseResponse.body.totals.cashOwedPaise).toBe(160_000);
        expect(baseResponse.body.orders.find((order: { id: string }) => order.id === 'ord-board-k1').cashAgeDays)
            .toBe(1);
        expect(baseResponse.body.cashPolicyAmountsPaise.issue)
            .toBeLessThan(baseResponse.body.cashPolicyAmountsPaise.settlement);
        expect(baseResponse.body.replayTotals.fineGoldMg).toBe(baseResponse.body.totals.fineGoldMg);
        expect(baseResponse.body.replayTotals.accountNetFineMg).toBe(0);
        expect(baseResponse.body.replayTotals.accountNetGrossMg).toBe(0);

        const shockedResponse = await request(app)
            .get('/api/gold-at-large?shockPercent=10')
            .set('x-user-id', 'j1');
        expect(shockedResponse.status).toBe(200);
        expect(shockedResponse.body.totals.valuePaise).toBe(91_377_000);
        expect(shockedResponse.body.cashPolicyAmountsPaise.settlement).toBeGreaterThan(
            baseResponse.body.cashPolicyAmountsPaise.settlement,
        );
    });

    it('limits jewellers to their own orders and karigars to their own jobs and acknowledgements', async () => {
        const jewellerOne = await request(app)
            .get('/api/gold-at-large')
            .set('x-user-id', 'j1');
        expect(jewellerOne.status).toBe(200);
        expect(jewellerOne.body.orders.map((order: { id: string }) => order.id))
            .toEqual(['ord-board-k1', 'ord-board-k2']);
        expect(jewellerOne.body.orders.some((order: { id: string }) => order.id === 'ord-board-j2')).toBe(false);

        const jewellerTwo = await request(app)
            .get('/api/gold-at-large')
            .set('x-user-id', 'j2');
        expect(jewellerTwo.status).toBe(200);
        expect(jewellerTwo.body.orders.map((order: { id: string }) => order.id))
            .toEqual(['ord-board-j2']);

        const karigarTwo = await request(app)
            .get('/api/gold-at-large')
            .set('x-user-id', 'k2');
        expect(karigarTwo.status).toBe(200);
        expect(karigarTwo.body.orders.map((order: { id: string }) => order.id))
            .toEqual(['ord-board-k2', 'ord-board-j2']);
        expect(karigarTwo.body.karigars.map((karigar: { id: string }) => karigar.id))
            .toEqual(['k2']);
        expect(karigarTwo.body.pendingAcknowledgements.map((event: { id: string }) => event.id))
            .toContain('evt-board-k2-pending-payment');

        const unknownUser = await request(app)
            .get('/api/gold-at-large')
            .set('x-user-id', 'unknown');
        expect(unknownUser.status).toBe(400);
    });

    it('rejects rate shocks outside the configured bounds', async () => {
        const response = await request(app)
            .get('/api/gold-at-large?shockPercent=25')
            .set('x-user-id', 'j1');

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/shock/i);
    });

    it('replays scrap-to-refiner movements without changing karigar-held gold', () => {
        appendAt('2026-11-15T11:00:00.000Z', {
            id: 'evt-board-k1-scrap',
            orderId: 'ord-board-k1',
            type: 'scrap_entry',
            weightMg: 1_000,
            purityPerMille: 916,
            status: 'acknowledged',
            createdBy: 'k1',
            idempotencyKey: 'board-k1-scrap',
        });
        appendAt('2026-11-15T11:01:00.000Z', {
            id: 'evt-board-k1-refiner',
            orderId: 'ord-board-k1',
            type: 'refiner_transfer',
            weightMg: 500,
            purityPerMille: 916,
            status: 'acknowledged',
            createdBy: 'j1',
            idempotencyKey: 'board-k1-refiner',
        });

        const replay = replayAndVerifyOrder('ord-board-k1');
        expect(replay.isValidChain).toBe(true);
        expect(replay.netKarigarHeldMg).toBe(59_000);
        expect(replay.accountBalances.scrap.fineMg).toBe(458);
        expect(replay.accountBalances.refiner.fineMg).toBe(458);
        expect(Object.values(replay.accountBalances).reduce((total, balance) => total + balance.fineMg, 0)).toBe(0);
    });
});
