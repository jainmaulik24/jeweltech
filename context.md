PRODUCT: A living system, not a chatbot. Main interface is a dashboard plus proactive
agent actions that need human approval. Voice/text is only for quick input.

DOMAIN RULES
- Gold is tracked as fine gold in integer mg. Purity is integer per-mille from a config
  table (999, 958, 916, 833, 750, 585). Money is integer paise with one documented rounding
  rule. Weight alone never proves gold content, so every return needs a purity reading.
- Wastage = allowed loss by basis (fine issued / gross issued / finished weight), percent,
  job type and sweep owner. It lives in a versioned, acknowledged agreement.
- Accounts: jeweller vault, karigar WIP, finished goods, scrap, refiner, process-loss.
  Every movement balances. Add minimal account tags to the ledger if missing; do not redesign.
- Default settlement is gold-in-gold. Cash only via a stored rate policy with the rate
  snapshot saved on the settlement.
- The agent may draft, propose, nudge and flag. It never finalises anything touching gold or
  money. Two-party approval required. A karigar sees only his own account; a jeweller never
  sees another jeweller's data.
- All arithmetic is deterministic code in the calc library. The LLM only extracts, explains
  and drafts, and every LLM output has a templated fallback.
- Corrections are new ledger events. History is never edited.
- Simulated things (payments, OTP, assay, gold rate, scale, delivery) are labelled SIMULATED
  in the UI. Synthetic benchmark data is labelled SYNTHETIC.
- Seed data may be scripted, but every number on screen must be computed by code from it.
- Trade conventions (wastage basis, defaults, rate-date policy, sweep ownership) are
  UNCONFIRMED until marked CONFIRMED in DECISIONS.md after field validation.

CHUNK RULES: First give a short plan and the files you will touch. Extend earlier modules,
do not rewrite them or change earlier interfaces without asking. No hardcoded outputs:
rules and thresholds come from typed config. Arithmetic only in the calc library. Use the
injectable Clock for all time. Add a named demo scenario to the seed script. Write tests
first for logic. Log decisions in DECISIONS.md. Stop when "Done when" passes; do not start
the next chunk.