import db from '../db';
import { appendLedgerEvent, replayAndVerifyOrder } from '../ledger';

describe('Chunk 3: Append-Only Ledger', () => {
    beforeEach(() => {
        // Clean tables before each test
        db.exec('DELETE FROM dispute_evidence; DELETE FROM dispute_actions; DELETE FROM dispute_carries; DELETE FROM nudges; DELETE FROM consents; DELETE FROM disputes; DELETE FROM ledger_events; DELETE FROM orders; DELETE FROM users;');
        db.exec(`
      INSERT INTO users (id, role, name) VALUES ('u1', 'jeweller', 'Test Jeweller');
      INSERT INTO users (id, role, name) VALUES ('k1', 'karigar', 'Test Karigar');
      INSERT INTO orders (id, jeweller_id, karigar_id, due_date) VALUES ('ord-1', 'u1', 'k1', '2026-12-31');
    `);
    });

    it('proves idempotency: retries do not double-post', () => {
        const payload = {
            id: 'evt-1',
            orderId: 'ord-1',
            type: 'issue',
            weightMg: 5000,
            status: 'acknowledged', // Updated to match new state machine
            createdBy: 'u1',        // <-- Added to satisfy new schema
            idempotencyKey: 'idemp-key-123'
        };

        // First post
        appendLedgerEvent(payload);
        // Retry (Double post attempt)
        appendLedgerEvent(payload);

        const count = db.prepare('SELECT count(*) as count FROM ledger_events').get() as { count: number };
        expect(count.count).toBe(1); // Only 1 event exists
    });

    it('derives accurate balance by replaying events (including corrections)', () => {
        appendLedgerEvent({ id: 'e1', orderId: 'ord-1', type: 'issue', weightMg: 10000, status: 'acknowledged', createdBy: 'u1', idempotencyKey: 'k-1' });
        appendLedgerEvent({ id: 'e2', orderId: 'ord-1', type: 'return', weightMg: 6000, status: 'acknowledged', createdBy: 'u1', idempotencyKey: 'k-2' });

        // Draft shouldn't affect balance
        appendLedgerEvent({ id: 'e3', orderId: 'ord-1', type: 'return', weightMg: 1000, status: 'draft', createdBy: 'u1', idempotencyKey: 'k-3' });

        // Correction: Karigar actually returned 500mg more than initially recorded
        appendLedgerEvent({ id: 'e4', orderId: 'ord-1', type: 'correction', weightMg: -500, status: 'acknowledged', createdBy: 'u1', idempotencyKey: 'k-4' });

        const state = replayAndVerifyOrder('ord-1');

        expect(state.isValidChain).toBe(true);
        expect(state.issuedMg).toBe(10000);
        expect(state.returnedMg).toBe(6000);
        // Net held: 10000 (issued) - 6000 (returned) - 500 (correction) = 3500mg
        expect(state.netKarigarHeldMg).toBe(3500);
    });

    it('allows signed paise only on correction events', () => {
        expect(() => appendLedgerEvent({
            id: 'evt-cash-negative',
            orderId: 'ord-1',
            type: 'payment',
            weightMg: 0,
            amount: -500,
            status: 'pending_ack',
            createdBy: 'u1',
            idempotencyKey: 'cash-negative',
        })).toThrow(/Only correction events/);

        const correction = appendLedgerEvent({
            id: 'evt-cash-correction',
            orderId: 'ord-1',
            type: 'correction',
            weightMg: 0,
            amount: -500,
            status: 'pending_ack',
            createdBy: 'u1',
            idempotencyKey: 'cash-correction',
        }) as { amount: number };
        expect(correction.amount).toBe(-500);
        expect(replayAndVerifyOrder('ord-1').isValidChain).toBe(true);
    });

    it('detects tampering when database values are altered directly', () => {
        appendLedgerEvent({ id: 'e1', orderId: 'ord-1', type: 'issue', weightMg: 10000, status: 'acknowledged', createdBy: 'u1', idempotencyKey: 'k-1' });
        appendLedgerEvent({ id: 'e2', orderId: 'ord-1', type: 'return', weightMg: 5000, status: 'acknowledged', createdBy: 'u1', idempotencyKey: 'k-2' });

        // Validate chain is initially good
        expect(replayAndVerifyOrder('ord-1').isValidChain).toBe(true);

        // MALICIOUS TAMPERING: Directly updating SQLite (bypassing append)
        db.prepare("UPDATE ledger_events SET weight_mg = 1000 WHERE id = 'e2'").run();

        // Verify again - Hash mismatch should trigger
        const tamperedState = replayAndVerifyOrder('ord-1');
        expect(tamperedState.isValidChain).toBe(false);
    });
});