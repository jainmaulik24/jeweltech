import { parseAgentOutput } from '../agent';

describe('Chunk 9b: Agent Validation & Safety Boundaries', () => {
    it('rejects malformed JSON from an adapter response', () => {
        expect(() => parseAgentOutput('This is just plain text, not JSON!')).toThrow();
    });

    it('rejects unknown tool names (e.g. attempting to finalize settlement)', () => {
        expect(() => parseAgentOutput(JSON.stringify({
            toolCall: "finalizeSettlement",
            args: { orderId: "ord-1" }
        }))).toThrow();
    });

    it('rejects negative weights in arguments', () => {
        expect(() => parseAgentOutput(JSON.stringify({
            toolCall: "none",
            args: { weightMg: -5000 } // Attempting a malicious negative deduction
        }))).toThrow();
    });

    it('rejects floating point weights in arguments', () => {
        expect(() => parseAgentOutput(JSON.stringify({
            toolCall: "none",
            args: { weightMg: 45.5 } // Attempting precision injection
        }))).toThrow();
    });
});