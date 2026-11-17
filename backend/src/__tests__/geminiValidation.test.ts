import db from '../db';
import { runAgentTurn } from '../agent';

// Force mock mode off so it attempts the network flow (which we intercept below)
process.env.USE_MOCK_LLM = 'false';

// Intercept network calls to inject toxic payloads
jest.mock('@google/generative-ai', () => {
    return {
        GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
            getGenerativeModel: () => ({
                generateContent: jest.fn().mockResolvedValue({
                    response: { text: () => (global as any).mockGeminiPayload }
                })
            })
        }))
    };
});

describe('Chunk 9b: Agent Validation & Safety Boundaries', () => {
    beforeEach(() => {
        db.exec('DELETE FROM agent_logs; DELETE FROM ledger_events; DELETE FROM orders;');
    });

    it('rejects malformed JSON and fails safely', async () => {
        (global as any).mockGeminiPayload = "This is just plain text, not JSON!";
        const res = await runAgentTurn("Hello");
        expect(res).toContain('Error: LLM Processing Failed');
    });

    it('rejects unknown tool names (e.g. attempting to finalize settlement)', async () => {
        // AI Hallucinates a tool to force a transaction
        (global as any).mockGeminiPayload = JSON.stringify({
            toolCall: "finalizeSettlement",
            args: { orderId: "ord-1" }
        });
        const res = await runAgentTurn("Finalize this order");
        expect(res).toContain('Error: LLM Processing Failed');

        // Verify ledger is completely untouched
        const events = db.prepare('SELECT * FROM ledger_events').all();
        expect(events.length).toBe(0);
    });

    it('rejects negative weights in arguments', async () => {
        (global as any).mockGeminiPayload = JSON.stringify({
            toolCall: "none",
            args: { weightMg: -5000 } // Attempting a malicious negative deduction
        });
        const res = await runAgentTurn("Deduct 5000");
        expect(res).toContain('Error: LLM Processing Failed');
    });

    it('rejects floating point weights in arguments', async () => {
        (global as any).mockGeminiPayload = JSON.stringify({
            toolCall: "none",
            args: { weightMg: 45.5 } // Attempting precision injection
        });
        const res = await runAgentTurn("Issue 45.5");
        expect(res).toContain('Error: LLM Processing Failed');
    });
});