import request from 'supertest';
import app from '../app';
import db from '../db';
import { setClock } from '../clock';
import { replayAndVerifyOrder } from '../ledger';
import { KARIGAR_FLOAT_CONFIG } from '../karigarFloatConfig';

const BASE_TIME = new Date('2026-11-18T12:00:00.000Z');

describe('karigar float and draw-down', () => {
    beforeEach(() => {
        setClock({ now: () => BASE_TIME });
        db.exec(`
            DELETE FROM karigar_floats;
            DELETE FROM deadline_actions;
            DELETE FROM cash_dues;
            DELETE FROM ledger_events;
            DELETE FROM orders;
            DELETE FROM users;

            INSERT INTO users (id, role, name) VALUES
                ('j1', 'jeweller', 'Jeweller One'),
                ('j2', 'jeweller', 'Jeweller Two'),
                ('k1', 'karigar', 'Ramesh'),
                ('k2', 'karigar', 'Asha');
            INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date)
            VALUES
                ('ord-1', 'j1', 'k1', 'Bangle order one', '2026-11-30'),
                ('ord-2', 'j1', 'k1', 'Bangle order two', '2026-11-30'),
                ('ord-private', 'j2', 'k2', 'Private jeweller order', '2026-11-30');
        `);
    });

    afterEach(() => setClock(null));

    it('issues a float without an order, draws orders from it, and replays balanced balances', async () => {
        await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 'j1')
            .send({
                type: 'issue',
                karigarId: 'k1',
                weightMg: 100_000,
                purityPerMille: 916,
                idempotencyKey: 'invalid-non-24k-float',
            })
            .expect(400);

        const floatIssue = await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 'j1')
            .send({
                type: 'issue',
                karigarId: 'k1',
                weightMg: 100_000,
                purityPerMille: 999,
                idempotencyKey: 'float-issue-100g',
            })
            .expect(200);
        expect(floatIssue.body.floatId).toBeTruthy();
        expect(floatIssue.body.creditAccount).toBe('karigar_float');
        expect(floatIssue.body.orderId).not.toBe('ord-1');

        await request(app)
            .post(`/api/ledger/${floatIssue.body.id}/acknowledge`)
            .set('x-user-id', 'k1')
            .expect(200);

        for (const [orderId, idempotencyKey] of [
            ['ord-1', 'drawdown-one'],
            ['ord-2', 'drawdown-two'],
        ]) {
            const drawdown = await request(app)
                .post('/api/ledger/event')
                .set('x-user-id', 'j1')
                .send({
                    orderId,
                    type: 'issue',
                    weightMg: 40_000,
                    purityPerMille: 999,
                    idempotencyKey,
                })
                .expect(200);
            expect(drawdown.body.floatId).toBe(floatIssue.body.floatId);
            expect(drawdown.body.debitAccount).toBe('karigar_float');
            if (orderId === 'ord-1') {
                await request(app)
                    .post('/api/ledger/event')
                    .set('x-user-id', 'j1')
                    .send({
                        orderId: 'ord-2',
                        type: 'issue',
                        weightMg: 60_001,
                        purityPerMille: 999,
                        idempotencyKey: 'drawdown-over-reserved-balance',
                    })
                    .expect(400);
            }
            await request(app)
                .post(`/api/ledger/${drawdown.body.id}/acknowledge`)
                .set('x-user-id', 'k1')
                .expect(200);
        }

        const home = await request(app)
            .get('/api/karigar/home')
            .set('x-user-id', 'k1')
            .expect(200);
        expect(home.body.floatRemainingMg).toBe(20_000);
        expect(home.body.floats).toEqual([
            expect.objectContaining({ id: floatIssue.body.floatId, remainingMg: 20_000 }),
        ]);

        const orderBalances = ['ord-1', 'ord-2', floatIssue.body.orderId].map((orderId) => {
            const replay = replayAndVerifyOrder(orderId);
            expect(replay.isValidChain).toBe(true);
            return replay.accountBalances;
        });
        const totalGrossMg = orderBalances.reduce(
            (total, balances) => total + Object.values(balances).reduce((sum, account) => sum + account.grossMg, 0),
            0,
        );
        const totalFineMg = orderBalances.reduce(
            (total, balances) => total + Object.values(balances).reduce((sum, account) => sum + account.fineMg, 0),
            0,
        );
        expect(totalGrossMg).toBe(0);
        expect(totalFineMg).toBe(0);
    });

    it('creates an on-demand settlement snapshot without moving float balances', async () => {
        const floatIssue = await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 'j1')
            .send({
                type: 'issue',
                karigarId: 'k1',
                weightMg: 50_000,
                purityPerMille: 999,
                idempotencyKey: 'on-demand-float-issue',
            })
            .expect(200);
        await request(app)
            .post(`/api/ledger/${floatIssue.body.id}/acknowledge`)
            .set('x-user-id', 'k1')
            .expect(200);

        const draft = await request(app)
            .post(`/api/karigar-floats/${floatIssue.body.floatId}/settlement-drafts`)
            .set('x-user-id', 'j1')
            .send({})
            .expect(200);
        expect(draft.body).toEqual(expect.objectContaining({
            status: 'pending_ack',
            remainingMg: 50_000,
            topUpSuggestionMg: 50_000,
        }));
        const home = await request(app)
            .get('/api/karigar/home')
            .set('x-user-id', 'k1')
            .expect(200);
        expect(home.body.floatRemainingMg).toBe(50_000);
        await request(app)
            .post(`/api/ledger/${draft.body.id}/acknowledge`)
            .set('x-user-id', 'k1')
            .expect(200);
        expect((db.prepare('SELECT status FROM ledger_events WHERE id = ?').get(draft.body.id) as { status: string }).status)
            .toBe('acknowledged');
    });

    it('creates a two-party settlement draft at the configured threshold and suggests a top-up', async () => {
        const floatIssue = await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 'j1')
            .send({
                type: 'issue',
                karigarId: 'k1',
                weightMg: 100_000,
                purityPerMille: 999,
                idempotencyKey: 'threshold-float-issue',
            })
            .expect(200);
        await request(app)
            .post(`/api/ledger/${floatIssue.body.id}/acknowledge`)
            .set('x-user-id', 'k1')
            .expect(200);

        const firstDraw = await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 'j1')
            .send({
                orderId: 'ord-1',
                type: 'issue',
                weightMg: 40_000,
                purityPerMille: 999,
                idempotencyKey: 'threshold-draw-one',
            })
            .expect(200);
        await request(app)
            .post(`/api/ledger/${firstDraw.body.id}/acknowledge`)
            .set('x-user-id', 'k1')
            .expect(200);
        expect(db.prepare("SELECT COUNT(*) AS count FROM ledger_events WHERE type = 'settlement' AND float_id IS NOT NULL")
            .get()).toEqual({ count: 0 });

        const secondDraw = await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 'j1')
            .send({
                orderId: 'ord-2',
                type: 'issue',
                weightMg: 40_000,
                purityPerMille: 999,
                idempotencyKey: 'threshold-draw-two',
            })
            .expect(200);
        const acknowledgement = await request(app)
            .post(`/api/ledger/${secondDraw.body.id}/acknowledge`)
            .set('x-user-id', 'k1')
            .expect(200);

        expect(acknowledgement.body.floatSettlementDraft).toEqual(expect.objectContaining({
            status: 'pending_ack',
            remainingMg: 20_000,
            topUpSuggestionMg: KARIGAR_FLOAT_CONFIG.targetFloatMg - 20_000,
        }));
        const settlement = db.prepare(`
            SELECT status, notes FROM ledger_events WHERE id = ?
        `).get(acknowledgement.body.floatSettlementDraft.id) as { status: string; notes: string };
        expect(settlement.status).toBe('pending_ack');
        expect(settlement.notes).toContain('DRAFT');
        expect(settlement.notes).toContain('80000');
        const jewellerFloats = await request(app)
            .get('/api/karigar-floats')
            .set('x-user-id', 'j1')
            .expect(200);
        expect(jewellerFloats.body.karigars).toEqual(expect.arrayContaining([
            expect.objectContaining({
                karigarId: 'k1',
                pendingSettlementDraft: expect.objectContaining({
                    id: acknowledgement.body.floatSettlementDraft.id,
                    topUpSuggestionMg: 80_000,
                }),
            }),
        ]));

        const requestedDraft = await request(app)
            .post(`/api/karigar-floats/${floatIssue.body.floatId}/settlement-drafts`)
            .set('x-user-id', 'j1')
            .send({})
            .expect(200);
        expect(requestedDraft.body.id).toBe(acknowledgement.body.floatSettlementDraft.id);
    });

    it('returns only the karigar’s open jobs, waiting dues, floats, and pending approvals', async () => {
        await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 'j1')
            .send({
                type: 'issue',
                karigarId: 'k1',
                weightMg: 100_000,
                purityPerMille: 999,
                idempotencyKey: 'home-float-issue',
            })
            .expect(200);

        db.prepare(`
            INSERT INTO cash_dues
                (id, order_id, jeweller_id, karigar_id, amount_paise, pay_by_date, created_by, owner_jeweller_id, created_at)
            VALUES ('due-waiting', 'ord-1', 'j1', 'k1', 25_000, '2026-11-20T00:00:00.000Z', 'j1', 'j1', '2026-11-15T12:00:00.000Z')
        `).run();

        const home = await request(app)
            .get('/api/karigar/home')
            .set('x-user-id', 'k1')
            .expect(200);
        expect(home.body.openJobs.map((job: { id: string }) => job.id)).toEqual(['ord-1', 'ord-2']);
        expect(home.body.amountsOwed).toEqual([
            expect.objectContaining({ id: 'due-waiting', amountPaise: 25_000, daysWaiting: 3 }),
        ]);
        expect(home.body.pendingAcknowledgements).toEqual([
            expect.objectContaining({ type: 'issue', weightMg: 100_000 }),
        ]);

        await request(app)
            .get('/api/karigar/home')
            .set('x-user-id', 'j2')
            .expect(400);
        const otherKarigar = await request(app)
            .get('/api/karigar/home')
            .set('x-user-id', 'k2')
            .expect(200);
        expect(otherKarigar.body.floatRemainingMg).toBe(0);
        expect(otherKarigar.body.openJobs.map((job: { id: string }) => job.id)).toEqual(['ord-private']);
    });
});
