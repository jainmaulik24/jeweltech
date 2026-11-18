PROJECT: Tech4Bharat 2026, problem statement 2.2 (Jeweltech, Agentic AI): "Gold given to karigars for job-work is tracked on trust, and disputes follow." Jewellers give gold to karigars (artisan goldsmiths) by weight and get finished pieces back with agreed wastage. Tracking issue, return, wastage, deadlines and payments is manual (notebooks, slips, verbal agreements), causing losses, disputes and late payment. Boundaries: settlements need approval from BOTH parties; each karigar has full access to his own account; fairness to the karigar matters most.

STACK: Node.js + Express + TypeScript (strict); SQLite (better-sqlite3); Zod; Jest; React + Vite + Tailwind PWA. LLM behind one adapter interface: mock by default, real Gemini only when env says so; tests always use the mock.

PRODUCT PRINCIPLE: A living system, not a chatbot: dashboards plus proactive agent actions that need human approval. Voice, text and photo are only quick input.

DOMAIN RULES
- Gold is tracked as fine gold in integer mg. Purity is integer per-mille from config (999, 958, 916, 833, 750, 585). Money is integer paise with one documented rounding rule. No floats for weight or money. Weight alone never proves gold content, so every return needs a purity reading.
- Accounts: jeweller vault, karigar float/WIP, finished goods, scrap, refiner, process-loss. Every movement balances. Add account tags if missing; do not redesign the ledger.
- All arithmetic is deterministic code in the calc library. The LLM only extracts, explains and drafts, and every LLM output has a templated fallback.
- The agent may draft, propose, nudge and flag. It never finalises anything touching gold or money. Two-party approval is required. A karigar sees only his own account; a jeweller never sees another jeweller's data.
- The ledger is append-only and hash-chained. Corrections are new events; history is never edited.
- Agreements are versioned and acknowledged. Default settlement is gold-in-gold; cash only through a rate policy with the rate snapshot stored.
- Anything simulated (payments, OTP, assay, gold rate, scale, WhatsApp) is labelled SIMULATED in the UI; synthetic data is labelled SYNTHETIC. Seed data may be scripted, but every number on screen is computed by code.
- Use the injectable Clock for all time. Trade conventions are UNCONFIRMED unless marked CONFIRMED in DECISIONS.md.

UX RULES
- KARIGAR VIEW (most important): karigars only understand paper slips. One screen, no menu, no tabs, no charts, no percentages, no jargon. Show his account exactly like the paper slip: Issued, less wastage, less stone, Net, given again, Final. Large numerals (grams, 3 decimals), icons, audio readout on every card, one big green OK button, one small red "something is wrong" button. Languages come from the locale file (English, Hindi, Kannada). Usable after 30 seconds of explanation.
- JEWELLER VIEW: bottom navigation with 4 tabs only: Home, Karigars, Orders, Records. Rare or advanced features go under "More". One primary action per screen. Plain words: "Gold with karigars", "Allowed loss", "Return check", "Approvals". New screens go into the existing structure; never add top-level tabs.

FIELD FACTS (one jeweller in Mysuru; CONFIRMED-by-1 only; keep all of it configurable)
- Trusted karigars get a lump-sum float of 24K gold (e.g. 100 g). The jeweller says "we need a 10 g chain" and the karigar draws from the float. It is settled or topped up when it runs out.
- Gold goes out as 24K and returns as 22K (916). Ideal return: 100 g of 24K comes back as 108.6 g of 22K (factor 1.086). The jeweller accepts about 2% below the ideal (about 106.4 g). The gap between the ideal and what the karigar returns is his earning (UNCONFIRMED).
- Wastage is agreed upfront (about 8-10% quoted) and includes the karigar's wage. Real loss is about 5% (worst about 7%). Cash labour is rare; buffing, cutting and polish are paid per piece.
- Stone-set: stone weight is deducted from gross to get gold weight.
- The main dispute is weight precision (ordered 10 g, delivered 10.5 g); small customers care.
- Delays are rare (about 1%); a backup piece is lent for the occasion.
- Karigars understand paper slips only. Jeweller-assisted acknowledgement is allowed and logged as "assisted".
- Big manufacturers (2-4 kg) supply a systematic format for a margin: an alternative and a possible customer.

CHUNK RULES
Follow context.md and DECISIONS.md. Do not ask me questions: choose the recommended option and log it in DECISIONS.md. Give a short plan and the files you will touch, then code. Extend earlier modules; do not rewrite them or change earlier public interfaces or the API contract (add optional fields or new endpoints). No hardcoded outputs: rules and thresholds come from typed config. Write tests first for logic. Add a named demo scenario to the seed script. When done, run npm test and npx tsc --noEmit (and npm run build in frontend for UI work), fix failures, and stop. Do not start the next step.