import request from 'supertest';
import crypto from 'crypto';
import app from '../app';
import db from '../db';

describe('Chunk 5: API Layer & Agent Tools', () => {
    beforeEach(() => {
        db.exec('DELETE FROM dispute_evidence; DELETE FROM dispute_actions; DELETE FROM dispute_carries; DELETE FROM nudges; DELETE FROM consents; DELETE FROM disputes; DELETE FROM ledger_events; DELETE FROM orders; DELETE FROM users;');
        db.exec(`
      INSERT INTO users (id, role, name, phone, pin) VALUES ('j1', 'jeweller', 'J1', '111', '1234');
      INSERT INTO users (id, role, name, phone, pin) VALUES ('k1', 'karigar', 'K1', '333', '1234');
    `);
    });

    it('runs a full API lifecycle: Create -> Issue -> Acknowledge -> Balance Check', async () => {
        // 1. Create Order (Tool: createOrder)
        const orderRes = await request(app).post('/api/orders').send({
            jewellerId: 'j1',
            karigarId: 'k1',
            description: 'Gold Bangles API Test'
        });
        expect(orderRes.status).toBe(200);
        const orderId = orderRes.body.id;

        // 2. Jeweller issues gold (Tool: recordLedgerEvent)
        const issueRes = await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 'j1')
            .send({
                orderId,
                type: 'issue',
                weightMg: 15000,
                idempotencyKey: crypto.randomUUID()
            });
        expect(issueRes.status).toBe(200);
        const eventId = issueRes.body.id;

        // 3. Karigar acknowledges receipt (Tool: acknowledgeEvent)
        const ackRes = await request(app)
            .post(`/api/ledger/${eventId}/acknowledge`)
            .set('x-user-id', 'k1'); // Dual-party rule applied via header
        expect(ackRes.status).toBe(200);
        expect(ackRes.body.status).toBe('acknowledged');

        // 4. Verify cryptographic replay balance (Tool: getOrderBalance)
        const balRes = await request(app).get(`/api/orders/${orderId}/balance`);
        expect(balRes.status).toBe(200);
        expect(balRes.body.netKarigarHeldMg).toBe(15000);
        expect(balRes.body.isValidChain).toBe(true);
    });
});