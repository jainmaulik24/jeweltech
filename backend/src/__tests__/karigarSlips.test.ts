import request from 'supertest';
import app from '../app';
import db from '../db';
import { calculateKarigarSlip } from '../calc';
import { appendLedgerEvent } from '../ledger';

describe('Karigar paper slips', () => {
    beforeEach(() => {
        db.exec(`
            DELETE FROM dispute_evidence;
            DELETE FROM dispute_actions;
            DELETE FROM disputes;
            DELETE FROM wastage_agreements;
            DELETE FROM ledger_events;
            DELETE FROM orders;
            DELETE FROM users;
            INSERT INTO users (id, role, name, phone, pin) VALUES
                ('j1', 'jeweller', 'Jeweller One', '111', '1234'),
                ('j2', 'jeweller', 'Jeweller Two', '222', '4321'),
                ('k1', 'karigar', 'Ramesh', '333', '1234'),
                ('k2', 'karigar', 'Karigar Two', '444', '1234');
            INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date)
                VALUES
                    ('ord-k1', 'j1', 'k1', 'Gold chain', '2026-12-31'),
                    ('ord-k2', 'j2', 'k2', 'Gold ring', '2026-12-31');
        `);
    });

    const append = (input: {
        id: string;
        orderId: string;
        type: 'issue' | 'return' | 'process_loss';
        weightMg: number;
        createdBy?: string;
        status?: 'pending_ack' | 'acknowledged';
        grossWeightMg?: number;
        stoneWeightMg?: number;
        agreementId?: string;
        agreementVersion?: number;
    }) => appendLedgerEvent({
        ...input,
        status: input.status ?? 'acknowledged',
        createdBy: input.createdBy ?? 'j1',
        idempotencyKey: input.id,
    });

    it('calculates the 10.000 - 0.600 + 0.500 = 9.900 g slip in integer mg', () => {
        expect(calculateKarigarSlip({
            issuedMg: 10_000,
            wastageMg: 600,
            stoneMg: 0,
            givenAgainMg: 500,
        })).toEqual({
            issuedMg: 10_000,
            wastageMg: 600,
            stoneMg: 0,
            netMg: 9_400,
            givenAgainMg: 500,
            finalMg: 9_900,
        });
    });

    it('calculates the stone-set slip and exposes both slip examples from ledger facts', async () => {
        append({ id: 'evt-slip-issue', orderId: 'ord-k1', type: 'issue', weightMg: 10_000 });
        append({ id: 'evt-slip-loss', orderId: 'ord-k1', type: 'process_loss', weightMg: 600 });
        append({ id: 'evt-slip-refill', orderId: 'ord-k1', type: 'issue', weightMg: 500 });

        db.prepare(`
            INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date)
            VALUES ('ord-stone', 'j1', 'k1', 'Stone-set piece', '2026-12-31')
        `).run();
        append({ id: 'evt-stone-issue', orderId: 'ord-stone', type: 'issue', weightMg: 10_000 });
        append({
            id: 'evt-stone-return',
            orderId: 'ord-stone',
            type: 'return',
            weightMg: 9_400,
            grossWeightMg: 10_000,
            stoneWeightMg: 600,
        });
        append({ id: 'evt-stone-loss', orderId: 'ord-stone', type: 'process_loss', weightMg: 600 });

        expect(calculateKarigarSlip({
            issuedMg: 10_000,
            wastageMg: 0,
            stoneMg: 600,
            givenAgainMg: 0,
        })).toMatchObject({ netMg: 9_400, finalMg: 9_400 });

        const response = await request(app)
            .get('/api/karigar/home')
            .set('x-user-id', 'k1');
        expect(response.status).toBe(200);
        expect(response.body.slips).toEqual(expect.arrayContaining([
            expect.objectContaining({
                orderId: 'ord-k1',
                issuedMg: 10_000,
                wastageMg: 600,
                stoneMg: 0,
                netMg: 9_400,
                givenAgainMg: 500,
                finalMg: 9_900,
            }),
            expect.objectContaining({
                orderId: 'ord-stone',
                issuedMg: 10_000,
                wastageMg: 0,
                stoneMg: 600,
                netMg: 9_400,
                givenAgainMg: 0,
                finalMg: 9_400,
            }),
        ]));
    });

    it('limits karigar slips to that karigar and only lets a jeweller assist their own pair', async () => {
        append({ id: 'evt-k1', orderId: 'ord-k1', type: 'issue', weightMg: 1_000 });
        append({
            id: 'evt-k2',
            orderId: 'ord-k2',
            type: 'issue',
            weightMg: 2_000,
            createdBy: 'j2',
        });
        db.prepare(`
            INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date)
            VALUES ('ord-k1-j2', 'j2', 'k1', 'Second jeweller job', '2026-12-31')
        `).run();
        append({ id: 'evt-k1-j2', orderId: 'ord-k1-j2', type: 'issue', weightMg: 3_000, createdBy: 'j2' });

        const ownHome = await request(app)
            .get('/api/karigar/home')
            .set('x-user-id', 'k1');
        expect(ownHome.status).toBe(200);
        expect(ownHome.body.slips.map((slip: { orderId: string }) => slip.orderId)).toEqual([
            'ord-k1',
            'ord-k1-j2',
        ]);
        expect(ownHome.body.slips[0].wastageMg).toBe(0);

        const jewellerHome = await request(app)
            .get('/api/karigar/home?karigarId=k1')
            .set('x-user-id', 'j1');
        expect(jewellerHome.status).toBe(200);
        expect(jewellerHome.body.slips.map((slip: { orderId: string }) => slip.orderId)).toEqual(['ord-k1']);

        const anotherKarigar = await request(app)
            .get('/api/karigar/home?karigarId=k2')
            .set('x-user-id', 'k1');
        expect(anotherKarigar.status).toBe(400);

        const unrelatedPair = await request(app)
            .get('/api/karigar/home?karigarId=k2')
            .set('x-user-id', 'j1');
        expect(unrelatedPair.status).toBe(400);

        const unauthorizedAssistance = await request(app)
            .post('/api/ledger/evt-k2/assisted-acknowledge')
            .set('x-user-id', 'j1');
        expect(unauthorizedAssistance.status).toBe(400);
    });

    it('shows retained gold wages as an amount owed after an acknowledged within-buffer return', async () => {
        db.prepare(`
            INSERT INTO wastage_agreements
                (id, order_id, jeweller_id, karigar_id, job_type, basis, percent_bps,
                 labour_rate_paise_per_gram, sweep_owner, karigar_sweep_share_bps,
                 cash_rate_policy, version, effective_at, status, accepted_at, created_at)
            VALUES
                ('agr-slip', 'ord-k1', 'j1', 'k1', 'plain', 'ideal_return_buffer', 0,
                 0, 'karigar', 10000, 'settlement', 1, '2026-01-01T00:00:00.000Z',
                 'accepted', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
        `).run();
        append({
            id: 'evt-wage-issue',
            orderId: 'ord-k1',
            type: 'issue',
            weightMg: 100_000,
            agreementId: 'agr-slip',
            agreementVersion: 1,
        });
        append({
            id: 'evt-wage-return',
            orderId: 'ord-k1',
            type: 'return',
            weightMg: 107_500,
            grossWeightMg: 107_500,
            stoneWeightMg: 0,
        });

        const home = await request(app)
            .get('/api/karigar/home')
            .set('x-user-id', 'k1');
        expect(home.status).toBe(200);
        expect(home.body.goldAmountsOwed).toEqual([
            expect.objectContaining({ orderId: 'ord-k1', amountMg: 1_100, daysWaiting: 0 }),
        ]);
    });

    it('records one self acknowledgement on repeated OK and records assisted acknowledgements', async () => {
        append({
            id: 'evt-self-ack',
            orderId: 'ord-k1',
            type: 'issue',
            weightMg: 1_000,
            status: 'pending_ack',
        });

        const firstAck = await request(app)
            .post('/api/ledger/evt-self-ack/acknowledge')
            .set('x-user-id', 'k1');
        const repeatedAck = await request(app)
            .post('/api/ledger/evt-self-ack/acknowledge')
            .set('x-user-id', 'k1');
        expect(firstAck.status).toBe(200);
        expect(repeatedAck.status).toBe(200);
        expect(db.prepare('SELECT COUNT(*) AS count FROM ledger_acknowledgements WHERE event_id = ?')
            .get('evt-self-ack')).toEqual({ count: 1 });
        expect(db.prepare('SELECT mode FROM ledger_acknowledgements WHERE event_id = ?')
            .get('evt-self-ack')).toEqual({ mode: 'self' });

        append({
            id: 'evt-assisted-ack',
            orderId: 'ord-k1',
            type: 'issue',
            weightMg: 2_000,
            status: 'pending_ack',
        });
        const assisted = await request(app)
            .post('/api/ledger/evt-assisted-ack/assisted-acknowledge')
            .set('x-user-id', 'j1');
        expect(assisted.status).toBe(200);
        expect(db.prepare(`
            SELECT mode, acknowledged_by AS acknowledgedBy, assisted_by AS assistedBy
            FROM ledger_acknowledgements WHERE event_id = ?
        `).get('evt-assisted-ack')).toEqual({
            mode: 'assisted',
            acknowledgedBy: 'k1',
            assistedBy: 'j1',
        });
        const assistedHome = await request(app)
            .get('/api/karigar/home?karigarId=k1')
            .set('x-user-id', 'j1');
        expect(assistedHome.body.slips[0].lastAssistedAcknowledgement).toMatchObject({
            assistedBy: 'j1',
            assistedByName: 'Jeweller One',
        });
    });

    it('creates a dispute from the one-tap dispute endpoint and supports PIN login', async () => {
        append({
            id: 'evt-dispute',
            orderId: 'ord-k1',
            type: 'issue',
            weightMg: 1_000,
            status: 'pending_ack',
        });
        const dispute = await request(app)
            .post('/api/ledger/evt-dispute/disputes')
            .set('x-user-id', 'k1')
            .send({ reason: 'Kuch galat hai' });
        expect(dispute.status).toBe(201);
        expect(db.prepare('SELECT reason FROM disputes WHERE event_id = ?').get('evt-dispute'))
            .toEqual({ reason: 'Kuch galat hai' });
        const disputedHome = await request(app)
            .get('/api/karigar/home')
            .set('x-user-id', 'k1');
        expect(disputedHome.body.slips[0].disputeEventId).toBeNull();

        const login = await request(app)
            .post('/api/auth/pin-login')
            .send({ phone: '333', pin: '1234' });
        expect(login.status).toBe(200);
        expect(login.body).toEqual({ id: 'k1', role: 'karigar', name: 'Ramesh' });
        expect(JSON.stringify(login.body)).not.toContain('1234');
    });
});
