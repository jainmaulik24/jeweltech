import db from '../db';
import { runAgentTurn, agentTools } from '../agent';
import { appendLedgerEvent } from '../ledger';

describe('Chunk 9: Agent Layer & Tool Constraints', () => {
    it('selects the mock adapter in Jest', () => {
        expect(process.env.LLM_ADAPTER).toBe('mock');
    });

    beforeEach(() => {
        db.exec('DELETE FROM agent_logs; DELETE FROM ledger_events; DELETE FROM orders; DELETE FROM users;');
        db.exec(`
          INSERT INTO users (id, role, name) VALUES ('j1', 'jeweller', 'J1');
          INSERT INTO users (id, role, name) VALUES ('k1', 'karigar', 'K1');
        `);
    });

    it('Agent answers "Who is late?" using the getLateOrders tool', async () => {
        // Create an overdue order
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        db.prepare('INSERT INTO orders (id, jeweller_id, karigar_id, due_date) VALUES (?, ?, ?, ?)').run('ord-late', 'j1', 'k1', yesterday);
        appendLedgerEvent({ id: 'evt-1', orderId: 'ord-late', type: 'issue', weightMg: 5000, status: 'acknowledged', createdBy: 'j1', idempotencyKey: 'k-1' });

        // Simulate LLM deciding to call the tool based on the user's question
        const response = await runAgentTurn("Which karigars are late?", { toolCall: 'getLateOrders' });

        expect(response).toContain('ord-late');
        expect(response).toContain('5000');

        // Verify action log memory recorded the turn
        const logs = db.prepare('SELECT * FROM agent_logs ORDER BY created_at ASC').all() as any[];
        expect(logs[0].content).toBe('Which karigars are late?');
        expect(logs[1].content).toContain('ord-late');
    });

    it('Agent drafts a settlement proposal without modifying the ledger', async () => {
        // Create a normal order
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        db.prepare('INSERT INTO orders (id, jeweller_id, karigar_id, due_date) VALUES (?, ?, ?, ?)').run('ord-draft', 'j1', 'k1', tomorrow);
        appendLedgerEvent({ id: 'evt-2', orderId: 'ord-draft', type: 'issue', weightMg: 2000, status: 'acknowledged', createdBy: 'j1', idempotencyKey: 'k-2' });

        // Simulate LLM deciding to draft a settlement
        const response = await runAgentTurn("Propose a settlement for ord-draft", { toolCall: 'draftSettlement', args: { orderId: 'ord-draft' } });

        // Verify it returned a draft
        expect(response).toContain('DRAFT_ONLY');
        expect(response).toContain('15000'); // 2000mg at 7500/g = 15000

        // CRITICAL CONSTRAINT: Verify it did NOT add a settlement event to the ledger
        const events = db.prepare('SELECT * FROM ledger_events WHERE order_id = ?').all('ord-draft');
        expect(events.length).toBe(1); // Only the initial issue event exists
    });
});