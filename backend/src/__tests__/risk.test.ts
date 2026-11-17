import db from '../db';
import { appendLedgerEvent, replayAndVerifyOrder } from '../ledger';

describe('Chunk 8: Deadlines and Risk', () => {
    beforeEach(() => {
        db.exec('DELETE FROM dispute_evidence; DELETE FROM dispute_actions; DELETE FROM dispute_carries; DELETE FROM nudges; DELETE FROM consents; DELETE FROM disputes; DELETE FROM ledger_events; DELETE FROM orders; DELETE FROM users;');
        db.exec(`
      INSERT INTO users (id, role, name, phone, pin) VALUES ('j1', 'jeweller', 'J1', '111', '1234');
      INSERT INTO users (id, role, name, phone, pin) VALUES ('k1', 'karigar', 'K1', '333', '1234');
    `);
    });

    it('flags order as at-risk when overdue AND holding gold', () => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        db.prepare('INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date) VALUES (?, ?, ?, ?, ?)').run('ord-risk', 'j1', 'k1', 'Test', yesterday);

        appendLedgerEvent({ id: 'evt-1', orderId: 'ord-risk', type: 'issue', weightMg: 5000, status: 'acknowledged', createdBy: 'j1', idempotencyKey: 'k-1' });

        const state = replayAndVerifyOrder('ord-risk');
        expect(state.isAtRisk).toBe(true);
    });

    it('does NOT flag order as at-risk if overdue but gold is settled (0 balance)', () => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        db.prepare('INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date) VALUES (?, ?, ?, ?, ?)').run('ord-safe', 'j1', 'k1', 'Test', yesterday);

        const state = replayAndVerifyOrder('ord-safe');
        expect(state.netKarigarHeldMg).toBe(0);
        expect(state.isAtRisk).toBe(false);
    });

    it('does NOT flag order as at-risk if holding gold but not yet due', () => {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        db.prepare('INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date) VALUES (?, ?, ?, ?, ?)').run('ord-future', 'j1', 'k1', 'Test', tomorrow);

        appendLedgerEvent({ id: 'evt-2', orderId: 'ord-future', type: 'issue', weightMg: 5000, status: 'acknowledged', createdBy: 'j1', idempotencyKey: 'k-2' });

        const state = replayAndVerifyOrder('ord-future');
        expect(state.isAtRisk).toBe(false);
    });
});