import request from 'supertest';
import app from '../app';
import db from '../db';
import '../seed';

describe('deadline demo seed', () => {
    it('supports return reconciliation for the synthetic wedding order', async () => {
        const result = await request(app)
            .get('/api/orders/ord-wedding-deadline/returns/config')
            .set('x-user-id', 'j1');

        expect(result.status).toBe(200);
        expect(result.body.agreement.version).toBe(1);
        expect(result.body.issuedLots).toEqual([
            { weightMg: 100_000, purityPerMille: 916 },
        ]);
        expect(db.prepare(`
            SELECT status FROM ledger_events
            WHERE order_id = 'ord-wedding-deadline' AND type = 'agreement_acknowledgement'
        `).get()).toEqual({ status: 'acknowledged' });
    });
});
