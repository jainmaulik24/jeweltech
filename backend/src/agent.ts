import db from './db';
import { replayAndVerifyOrder } from './ledger';
import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import dotenv from 'dotenv';
import { now as clockNow } from './clock';
import { deadlineAgentTools } from './deadlineAgent';

dotenv.config();

// 1. Tool Registry (Unchanged public contract)
export const agentTools = {
    getLateOrders: () => {
        const orders = db.prepare('SELECT id, karigar_id, due_date FROM orders').all() as any[];
        const lateOrders = [];
        const now = clockNow();

        for (const o of orders) {
            const state = replayAndVerifyOrder(o.id, now);
            if (state.isAtRisk) {
                lateOrders.push({ orderId: o.id, karigarId: o.karigar_id, balanceMg: state.netKarigarHeldMg });
            }
        }
        return lateOrders;
    },

    draftSettlement: (orderId: string) => {
        const state = replayAndVerifyOrder(orderId);
        if (state.netKarigarHeldMg <= 0) return { error: "No gold to settle" };

        const ratePerGram = 7500;
        const amountDue = (state.netKarigarHeldMg / 1000) * ratePerGram;

        return {
            status: "DRAFT_ONLY",
            orderId,
            netMg: state.netKarigarHeldMg,
            amountDue,
            notes: `Draft Settlement: ${state.netKarigarHeldMg}mg at ₹${ratePerGram}/g = ₹${amountDue}`
        };
    },
    deadline: deadlineAgentTools,
};

// 2. Memory / Action Log (Unchanged)
export function logAgentAction(orderId: string | null, karigarId: string | null, role: 'user' | 'agent', content: string) {
    const id = `msg-${crypto.randomUUID()}`;
    db.prepare('INSERT INTO agent_logs (id, order_id, karigar_id, role, content) VALUES (?, ?, ?, ?, ?)').run(id, orderId, karigarId, role, content);
}

// 3. Strict Zod Schema for LLM Outputs
const AgentOutputSchema = z.object({
    toolCall: z.enum(['getLateOrders', 'draftSettlement', 'none']),
    args: z.object({
        orderId: z.string().optional(),
        // Block floats and negative weights deterministically
        weightMg: z.number().int().nonnegative().optional()
    }).optional(),
    text: z.string().optional()
});

// 4. Gemini Network Handler (Timeout, Retry, Validation, Logging)
async function fetchFromGemini(prompt: string, attempt = 1): Promise<any> {
    const promptId = crypto.randomUUID();
    const startTime = Date.now();

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
        const model = genAI.getGenerativeModel({
            model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
            generationConfig: { responseMimeType: 'application/json' }
        });

        // 10-second timeout using AbortController
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const systemInstruction = `You are a Jeweltech assistant. Respond in JSON matching this exact structure: { "toolCall": "getLateOrders" | "draftSettlement" | "none", "args": { "orderId": "str", "weightMg": 123 }, "text": "msg" }. Choose a toolCall. Provide 'args' if needed, and a 'text' message. Never attempt to finalize a settlement.`;

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: `${systemInstruction}\n\nUser: ${prompt}` }] }]
        }, { signal: controller.signal });

        clearTimeout(timeoutId);

        const rawText = result.response.text();
        const parsedJson = JSON.parse(rawText);

        // Zod validation throws error on invalid output
        const validatedOutput = AgentOutputSchema.parse(parsedJson);

        console.log(`[LLM] ID: ${promptId} | Latency: ${Date.now() - startTime}ms | Valid: ✅`);
        return validatedOutput;

    } catch (err: any) {
        console.log(`[LLM] ID: ${promptId} | Latency: ${Date.now() - startTime}ms | Valid: ❌ | Err: ${err.message}`);

        if (attempt === 1) {
            // Exponential backoff: Wait 1.5s then retry exactly once
            await new Promise(res => setTimeout(res, 1500));
            return fetchFromGemini(prompt, 2);
        }

        // Fail safely after 1 retry
        return { error: true, message: `LLM Processing Failed: ${err.message}` };
    }
}

// 5. The Orchestrator
export async function runAgentTurn(message: string, mockLlmResponse?: any) {
    logAgentAction(null, null, 'user', message);

    let responseContent = "";
    let llmInstruction = mockLlmResponse;

    // Use Real LLM if mock isn't forced by environment
    if (process.env.USE_MOCK_LLM !== 'true') {
        llmInstruction = await fetchFromGemini(message);
        if (llmInstruction.error) {
            responseContent = `Error: ${llmInstruction.message}`;
            logAgentAction(null, null, 'agent', responseContent);
            return responseContent;
        }
    }

    // Execute safe tools
    if (llmInstruction?.toolCall === 'getLateOrders') {
        const result = agentTools.getLateOrders();
        responseContent = `I found ${result.length} late orders: ` + JSON.stringify(result);
    } else if (llmInstruction?.toolCall === 'draftSettlement') {
        const result = agentTools.draftSettlement(llmInstruction.args?.orderId);
        responseContent = `Drafted settlement proposal: ` + JSON.stringify(result);
    } else {
        responseContent = llmInstruction?.text || "I am your Jeweltech assistant.";
    }

    logAgentAction(null, null, 'agent', responseContent);
    return responseContent;
}

// Strict Schema for Voice Parsing
const UtteranceSchema = z.object({
    type: z.enum(['issue', 'return', 'scrap_entry', 'payment', 'unknown']),
    weightMg: z.number().int().nonnegative(),
    amount: z.number().int().nonnegative(),
    confidence: z.enum(['high', 'low']),
    readBackText: z.string(),
    reasonForLowConfidence: z.string().optional()
});

export async function parseUtterance(text: string): Promise<any> {
    try {
        const raw = text.trim();
        const lower = raw.toLowerCase();

        // 1. Reject negative numbers, infinity, or uncertain filler immediately
        if (/-\d/.test(lower) || lower.includes('infinity') || lower.includes('maybe') || lower.includes('?')) {
            return UtteranceSchema.parse({
                type: 'unknown',
                weightMg: 0,
                amount: 0,
                confidence: 'low',
                readBackText: "I didn't quite catch a valid amount. Please repeat.",
                reasonForLowConfidence: 'Ambiguous or negative value detected'
            });
        }

        // 2. Normalize English & Kannada spoken number phrases into digits
        let norm = lower
            .replace(/five thousand/g, '5000')
            .replace(/ಮೂರು ಸಾವಿರ/g, '3000')
            .replace(/ಹತ್ತು ಸಾವಿರ/g, '10000')
            .replace(/ಐನೂರು/g, '500')
            .replace(/ಎರಡುವರೆ/g, '2.5')
            .replace(/ಅರ್ಧ/g, '0.5')
            .replace(/quarter of a|quarter/g, '0.25')
            .replace(/half a|half/g, '0.5')
            .replace(/\bone\b|ಒಂದು/g, '1')
            .replace(/\btwo\b|ಎರಡು/g, '2')
            .replace(/\bthree\b|ಮೂರು/g, '3')
            .replace(/\bfour\b|ನಾಲ್ಕು/g, '4')
            .replace(/\bfive\b|ಐದು/g, '5')
            .replace(/\bsix\b|ಆರು/g, '6')
            .replace(/\bseven\b|ಏಳು/g, '7')
            .replace(/\beight\b|ಎಂಟು/g, '8')
            .replace(/\bnine\b|ಒಂಬತ್ತು/g, '9')
            .replace(/\bten\b|ಹತ್ತು/g, '10')
            .replace(/(\d+)\s+point\s+(\d+)/g, '$1.$2')
            .replace(/\bpoint\s+(\d+)/g, '0.$1');

        // 3. Extract numeric value
        const numMatch = norm.match(/\d+(\.\d+)?/);
        if (!numMatch) {
            return UtteranceSchema.parse({
                type: 'unknown',
                weightMg: 0,
                amount: 0,
                confidence: 'low',
                readBackText: "I didn't catch the numbers. Please try again.",
                reasonForLowConfidence: 'No numeric value found'
            });
        }

        const value = parseFloat(numMatch[0]);

        // 4. Classify Intent (Scrap -> Payment -> Return -> Issue)
        let type: 'issue' | 'return' | 'scrap_entry' | 'payment' | 'unknown' = 'unknown';

        if (/scrap|wastage|dust|ಸ್ಕ್ರಾಪ್|ತ್ಯಾಜ್ಯ/.test(norm)) {
            type = 'scrap_entry';
        } else if (/paid|payment|rupees|inr|cash|settled|ರೂಪಾಯಿ|ಪಾವತಿ/.test(norm)) {
            type = 'payment';
        } else if (/return|returned|received|back|ವಾಪಸ್/.test(norm)) {
            type = 'return';
        } else if (/issue|issued|give|gave|sent|hand over|transfer|ನೀಡಿದ್ದೇನೆ|ಕೊಟ್ಟೆ|ನೀಡಿ|ಇಶ್ಯೂ/.test(norm)) {
            type = 'issue';
        }

        if (type === 'unknown') {
            return UtteranceSchema.parse({
                type: 'unknown',
                weightMg: 0,
                amount: 0,
                confidence: 'low',
                readBackText: "I didn't understand the transaction type.",
                reasonForLowConfidence: 'Unknown transaction intent'
            });
        }

        // 5. Compute strict integer milligrams or INR amount
        let weightMg = 0;
        let amount = 0;

        if (type === 'payment') {
            amount = Math.round(value);
        } else {
            if (/milligram|milligrams|\bmg\b|ಮಿಲಿಗ್ರಾಂ/.test(norm)) {
                weightMg = Math.round(value);
            } else if (/\bkg\b|kilogram/.test(norm)) {
                weightMg = Math.round(value * 1000000);
            } else {
                // Default weight unit is grams -> convert to milligrams
                weightMg = Math.round(value * 1000);
            }
        }

        const readBackText = type === 'payment'
            ? `I heard: Payment of ${amount} rupees. Is this correct?`
            : `I heard: ${type} of ${weightMg} milligrams. Is this correct?`;

        return UtteranceSchema.parse({
            type,
            weightMg,
            amount,
            confidence: 'high',
            readBackText
        });

    } catch (err: any) {
        return {
            type: 'unknown',
            weightMg: 0,
            amount: 0,
            confidence: 'low',
            readBackText: "I didn't quite catch the numbers.",
            reasonForLowConfidence: err.message
        };
    }
}