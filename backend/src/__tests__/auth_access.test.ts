import db from '../db';
import { getOrdersForUser, requestOtp, logConsent } from '../auth';
import { appendLedgerEvent, progressEventStatus, replayAndVerifyOrder } from '../ledger';

describe('Chunk 4: Roles, Access & Acknowledgements', () => {
    beforeEach(() => {
        db.exec('DELETE FROM consents; DELETE FROM ledger_events; DELETE FROM orders; DELETE FROM users;');
        // Set up 2 separate jewellers and 2 separate karigars
        db.exec(`
      INSERT INTO users (id, role, name, phone, pin) VALUES ('j1', 'jeweller', 'J1', '111', '1234');
      INSERT INTO users (id, role, name, phone, pin) VALUES ('j2', 'jeweller', 'J2', '222', '1234');
      INSERT INTO users (id, role, name, phone, pin) VALUES ('k1', 'karigar', 'K1', '333', '1234');
      INSERT INTO users (id, role, name, phone, pin) VALUES ('k2', 'karigar', 'K2', '444', '1234');
      
      INSERT INTO orders (id, jeweller_id, karigar_id, due_date) VALUES ('ord-1', 'j1', 'k1', '2026-12-31');
      INSERT INTO orders (id, jeweller_id, karigar_id, due_date) VALUES ('ord-2', 'j2', 'k2', '2026-12-31');
    `);
    });

    it('proves data isolation: users only see their own accounts', () => {
        // Karigar 1 should see order 1, but NOT order 2
        const k1Orders = getOrdersForUser('k1', 'karigar');
        expect(k1Orders.length).toBe(1);
        expect(k1Orders[0].id).toBe('ord-1');

        // Jeweller 1 should never see Jeweller 2's data
        const j1Orders = getOrdersForUser('j1', 'jeweller');
        expect(j1Orders.length).toBe(1);
        expect(j1Orders[0].id).toBe('ord-1');
    });

    it('proves dual-party state machine: an entry is not final without both sides', () => {
        // 1. Jeweller (j1) creates an issue event (starts as pending_ack)
        appendLedgerEvent({
            id: 'evt-1',
            orderId: 'ord-1',
            type: 'issue',
            weightMg: 5000,
            status: 'pending_ack',
            createdBy: 'j1', // J1 created it
            idempotencyKey: 'idemp-1'
        });

        // 2. Since it is pending, replay should show 0 balance (not final)
        expect(replayAndVerifyOrder('ord-1').netKarigarHeldMg).toBe(0);

        // 3. Jeweller tries to acknowledge their own event -> MUST FAIL
        expect(() => progressEventStatus('evt-1', 'j1', 'acknowledged'))
            .toThrow(/The other party must acknowledge/);

        // 4. Karigar (k1) acknowledges it -> SUCCESS
        progressEventStatus('evt-1', 'k1', 'acknowledged');

        // 5. Now the replay should reflect the 5000mg balance!
        expect(replayAndVerifyOrder('ord-1').netKarigarHeldMg).toBe(5000);
    });

    it('simulates OTP and logs explicit consent', () => {
        const otp = requestOtp('9999999999');
        expect(otp).toBe('123456');

        logConsent('k1', 'Terms of Service');
        const consent = db.prepare('SELECT * FROM consents WHERE user_id = ?').get('k1') as any;
        expect(consent.purpose).toBe('Terms of Service');
    });
});