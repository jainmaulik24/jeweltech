import { parseUtterance } from '../agent';

// The 50-Utterance Test Set (English + Kannada + Tricky Math + Garbage)
const utterances = [
    // --- Direct Issues (English) ---
    { text: "I issued five grams", type: "issue", mg: 5000, amt: 0, conf: "high" },
    { text: "give him 10.5 grams", type: "issue", mg: 10500, amt: 0, conf: "high" },
    { text: "sent two point two grams of gold", type: "issue", mg: 2200, amt: 0, conf: "high" },
    { text: "issue 500 milligrams", type: "issue", mg: 500, amt: 0, conf: "high" },
    { text: "hand over 12 grams", type: "issue", mg: 12000, amt: 0, conf: "high" },
    { text: "issued quarter of a gram", type: "issue", mg: 250, amt: 0, conf: "high" },
    { text: "gave him one kg", type: "issue", mg: 1000000, amt: 0, conf: "high" },
    { text: "transfer 3g", type: "issue", mg: 3000, amt: 0, conf: "high" },
    { text: "new order issue 8 grams", type: "issue", mg: 8000, amt: 0, conf: "high" },
    { text: "i just gave karigar 1.25 grams", type: "issue", mg: 1250, amt: 0, conf: "high" },
    // --- Returns (English) ---
    { text: "received 4 grams back", type: "return", mg: 4000, amt: 0, conf: "high" },
    { text: "he returned 8 point 5 grams", type: "return", mg: 8500, amt: 0, conf: "high" },
    { text: "got back half a gram", type: "return", mg: 500, amt: 0, conf: "high" },
    { text: "karigar returned 20 grams", type: "return", mg: 20000, amt: 0, conf: "high" },
    { text: "return 3.33 grams", type: "return", mg: 3330, amt: 0, conf: "high" },
    { text: "take back 6 grams", type: "return", mg: 6000, amt: 0, conf: "high" },
    { text: "finished work returned 15g", type: "return", mg: 15000, amt: 0, conf: "high" },
    { text: "he brought back 900 milligrams", type: "return", mg: 900, amt: 0, conf: "high" },
    { text: "return one point five grams", type: "return", mg: 1500, amt: 0, conf: "high" },
    { text: "received exactly 2 grams", type: "return", mg: 2000, amt: 0, conf: "high" },
    // --- Scrap (English) ---
    { text: "logged 1 gram of scrap", type: "scrap_entry", mg: 1000, amt: 0, conf: "high" },
    { text: "scrap is 250 milligrams", type: "scrap_entry", mg: 250, amt: 0, conf: "high" },
    { text: "dust and scrap 1.1 grams", type: "scrap_entry", mg: 1100, amt: 0, conf: "high" },
    { text: "add scrap 4 grams", type: "scrap_entry", mg: 4000, amt: 0, conf: "high" },
    { text: "wastage scrap point 5 grams", type: "scrap_entry", mg: 500, amt: 0, conf: "high" },
    // --- Payments (English) ---
    { text: "paid him five thousand rupees", type: "payment", mg: 0, amt: 5000, conf: "high" },
    { text: "payment of 10000", type: "payment", mg: 0, amt: 10000, conf: "high" },
    { text: "transferred 2500 rupees", type: "payment", mg: 0, amt: 2500, conf: "high" },
    { text: "gave cash 500", type: "payment", mg: 0, amt: 500, conf: "high" },
    { text: "settled with 12000 inr", type: "payment", mg: 0, amt: 12000, conf: "high" },
    // --- Kannada (Mix) ---
    { text: "ನಾನು ಐದು ಗ್ರಾಂ ಚಿನ್ನ ನೀಡಿದ್ದೇನೆ", type: "issue", mg: 5000, amt: 0, conf: "high" }, // I gave 5g
    { text: "ಹತ್ತು ಗ್ರಾಂ ವಾಪಸ್", type: "return", mg: 10000, amt: 0, conf: "high" }, // 10g return
    { text: "ಎರಡುವರೆ ಗ್ರಾಂ ಕೊಟ್ಟೆ", type: "issue", mg: 2500, amt: 0, conf: "high" }, // Gave 2.5g
    { text: "ಸ್ಕ್ರಾಪ್ ಒಂದು ಗ್ರಾಂ", type: "scrap_entry", mg: 1000, amt: 0, conf: "high" }, // Scrap 1g
    { text: "ಮೂರು ಸಾವಿರ ರೂಪಾಯಿ ಕೊಟ್ಟೆ", type: "payment", mg: 0, amt: 3000, conf: "high" }, // Gave 3000 rupees
    { text: "ಅರ್ಧ ಗ್ರಾಂ ಚಿನ್ನ ನೀಡಿ", type: "issue", mg: 500, amt: 0, conf: "high" }, // Give half gram
    { text: "ನಾಲ್ಕು ಗ್ರಾಂ ವಾಪಸ್ ಬಂದಿದೆ", type: "return", mg: 4000, amt: 0, conf: "high" }, // 4g returned
    { text: "ಐನೂರು ಮಿಲಿಗ್ರಾಂ ತ್ಯಾಜ್ಯ", type: "scrap_entry", mg: 500, amt: 0, conf: "high" }, // 500mg scrap
    { text: "ಎಂಟು ಗ್ರಾಂ ಇಶ್ಯೂ ಮಾಡಿ", type: "issue", mg: 8000, amt: 0, conf: "high" }, // Issue 8g
    { text: "ಹತ್ತು ಸಾವಿರ ರೂಪಾಯಿ ಪಾವತಿ", type: "payment", mg: 0, amt: 10000, conf: "high" }, // 10000 payment
    // --- Edge Cases & Garbage (Expecting LOW confidence) ---
    { text: "issue some gold", type: "unknown", mg: 0, amt: 0, conf: "low" }, // Missing amount
    { text: "returned everything", type: "unknown", mg: 0, amt: 0, conf: "low" }, // Unquantified
    { text: "i want a pizza", type: "unknown", mg: 0, amt: 0, conf: "low" }, // Garbage
    { text: "pay him lots of money", type: "unknown", mg: 0, amt: 0, conf: "low" },
    { text: "um yeah so give him like uh gram maybe?", type: "unknown", mg: 0, amt: 0, conf: "low" }, // Ambiguous
    { text: "issue -5 grams", type: "unknown", mg: 0, amt: 0, conf: "low" }, // Negative logic error
    { text: "ಸ್ಕ್ರಾಪ್ ತ್ಯಾಜ್ಯ", type: "unknown", mg: 0, amt: 0, conf: "low" }, // "Scrap waste" missing number
    { text: "ಚಿನ್ನ ವಾಪಸ್", type: "unknown", mg: 0, amt: 0, conf: "low" }, // "Gold return" missing number
    { text: "give him infinity grams", type: "unknown", mg: 0, amt: 0, conf: "low" },
    { text: "asdfghjkl", type: "unknown", mg: 0, amt: 0, conf: "low" }
];

describe('Chunk 10: NLP Numeric Accuracy Benchmark', () => {
    it('achieves > 90% parsing accuracy across 50 complex utterances', async () => {
        let correct = 0;

        for (const u of utterances) {
            const res = await parseUtterance(u.text);

            const isAccurate = (res.type === u.type || (u.conf === 'low' && res.confidence === 'low')) &&
                res.weightMg === u.mg &&
                res.amount === u.amt;

            if (isAccurate) correct++;
            else console.log(`❌ Failed: "${u.text}" -> Got Mg: ${res.weightMg}, Expected Mg: ${u.mg}, Conf: ${res.confidence}`);
        }

        const accuracy = (correct / utterances.length) * 100;
        console.log(`\n🧠 NLP Numeric Accuracy: ${accuracy}% (${correct}/${utterances.length})\n`);

        expect(accuracy).toBeGreaterThanOrEqual(90);
    });
});