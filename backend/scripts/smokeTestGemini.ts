import { runAgentTurn } from '../src/agent';
import dotenv from 'dotenv';

dotenv.config();

// Ensure we hit the real network
process.env.USE_MOCK_LLM = 'false';

async function run() {
    console.log(`\n🔥 Starting Gemini Live Smoke Test...`);
    console.log(`Using Key: ${process.env.GEMINI_API_KEY ? 'PROVIDED (Hidden)' : 'MISSING'}`);
    console.log(`Using Model: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}`);

    if (!process.env.GEMINI_API_KEY) {
        console.error('\n❌ ERROR: Add GEMINI_API_KEY to your .env file first!');
        process.exit(1);
    }

    console.log('\n💬 Sending prompt: "Which karigars are late?"...');
    const res1 = await runAgentTurn("Which karigars are late?");
    console.log('\n🤖 Agent Response:');
    console.log(res1);

    console.log('\n💬 Sending prompt: "Hello, what can you do?"...');
    const res2 = await runAgentTurn("Hello, what can you do?");
    console.log('\n🤖 Agent Response:');
    console.log(res2);

    console.log('\n✅ Smoke Test Complete.\n');
}

run();