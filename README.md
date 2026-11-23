# Parchi

**A shared, auditable gold job-work ledger for jewellers and karigars.**

Parchi is a prototype for Tech4Bharat 2026 problem statement 2.2 (Jeweltech, Agentic AI). It addresses a familiar workshop problem: gold is issued to a karigar for job-work, finished pieces and scrap come back later, and the weights, agreed wastage, deadlines, and payments are often tracked in notebooks, slips, or verbal agreements. When the two sides' records differ, it is hard to establish what happened.

Parchi turns that process into a living workflow: a jeweller can track gold from issue through return and settlement, while the karigar can inspect and acknowledge the same entries in a simple paper-slip-style view. Proactive assistance can surface pending approvals, delays, exposure, and disputes—but gold and money are never moved by an AI suggestion alone.

> **Prototype notice:** This repository is a local demo, not production financial software. Seeded people, jobs, measurements, rates, valuations, payments, PIN login, assay readings, and notifications are synthetic or simulated. Trade conventions and thresholds are not validated guidance. See [DECISIONS.md](./DECISIONS.md) for assumptions and field-validation notes.

## At a glance

- **For jewellers:** workshop dashboard, karigar and order views, gold balances, issue/return checks, versioned agreements, deadlines, dues, approvals, and records.
- **For karigars:** a dedicated account view with a readable work slip, acknowledgement and dispute actions, waiting dues, and English, Hindi, or Kannada labels.
- **For both parties:** a shared event history and explicit acknowledgement workflows. Relevant gold or money entries stay pending until the required party responds.
- **For the workshop:** a browser-based React app backed by an Express API and SQLite database.
- **For the agent:** structured, deterministic assessments and draft actions; an optional LLM adapter for language-facing tasks, never for ledger arithmetic or final approval.

## What the demo covers

### Job-work from issue to return

Create and assign work, record gold issues, agree terms, record finished lots and scrap, and reconcile what came back against the job. A return captures purity as well as weight; stone and other non-gold weight can be recorded separately. Target-weight deviations, wastage comparisons, and settlement recommendations are surfaced for review.

### A shared karigar account

The karigar has access to their own jobs and gold account, including pair-scoped float balances, pending entries, and explicit cash dues. Their main view is designed around the paper slip rather than a conventional analytics dashboard: **Issued, less wastage, less stone, Net, given again, Final**. Entries can be read aloud, and the karigar can acknowledge an entry or raise a concern. Jeweller-assisted acknowledgements are supported and recorded as assisted.

### Agreements, approvals, and disputes

Agreement terms are versioned and acknowledged separately. Events can remain pending for the other party's acknowledgement; proposed settlements and float-cycle snapshots do not finalize themselves. A dispute adds a case and action history rather than rewriting the original entry. Resolution or correction is recorded as a new event and follows the acknowledgement workflow.

### Proactive assistance

The backend includes deterministic workflows for deadline risk and rescue planning, daily briefs, dues follow-up, gold-at-large and karigar exposure indicators, and float alerts. These are intended to help people notice and review work—not to silently change balances, reassign work, send messages, or make financial decisions. Draft messages and demo inbox entries are simulated.

### Customer-order demonstration

The frontend also contains a customer-order demo flow in browser local storage. It can connect customer work to a karigar job, track demo activity, and prepare a WhatsApp deep link for human review. It does **not** send a message automatically. This browser-side demo ledger is separate from the backend SQLite ledger.

## Core safeguards and design principles

- **Integer accounting:** weight is represented in integer milligrams; money is represented in integer paise. Purity is recorded as integer parts per thousand. Deterministic calculations and rounding are handled in backend code, not delegated to an LLM.
- **Purity-aware returns:** gross weight alone does not establish fine-gold content. Return entries include a purity reading, and stone/other non-gold deductions are recorded separately.
- **Append-only history:** ledger facts are hash-chained. Corrections are additional events; past financial entries are not edited. Replay verifies the history before calculating balances.
- **Two-party acknowledgement:** proposals, drafts, and agent actions do not substitute for the required human approval. Pending entries are not treated as acknowledged balances.
- **Scoped access:** API queries are scoped to the logged-in demo identity. A karigar's view is limited to that karigar; a jeweller's data is limited to that jeweller.
- **Human review for integrations:** OTP, cash payments, rates, purity readings, messages, assay, and other external-world operations are simulated in this demo. No real payment or outbound message is triggered.
- **Configurable assumptions:** thresholds and trade conventions live in typed configuration. Many conventions remain explicitly UNCONFIRMED; do not treat demo defaults as industry standards.

## Repository layout

```text
.
├── backend/
│   ├── src/
│   │   ├── app.ts                 Express API and request validation
│   │   ├── auth.ts                Demo sign-in and user-scoped access
│   │   ├── calc.ts                Deterministic gold and settlement calculations
│   │   ├── ledger.ts              Append-only, hash-chained ledger and replay
│   │   ├── agent.ts               Agent orchestration and optional LLM adapter
│   │   ├── deadlineAgent.ts       Deadline, rescue, and custody workflows
│   │   ├── dailyBrief.ts          Scheduled, structured daily briefs
│   │   ├── disputes.ts            Dispute and correction workflows
│   │   ├── schema.ts              Zod request and domain validation
│   │   ├── *Config.ts             Typed workflow and domain configuration
│   │   ├── seed.ts                Synthetic demo data (resets the DB)
│   │   └── __tests__/             Jest tests
│   ├── openapi.yaml               Core API contract
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx                Main jeweller navigation and screens
│   │   ├── KarigarWorkspace.tsx   Karigar paper-slip workspace
│   │   ├── *Panel.tsx             Workflow-specific UI panels
│   │   ├── locales.ts             English, Hindi, Kannada strings
│   │   └── routeManifest.json     Screen and feature map
│   ├── scripts/                   Route-manifest checks
│   └── package.json
├── context.md                     Product brief, UX rules, and domain constraints
└── DECISIONS.md                   Recorded assumptions and validation status
```

## Run the demo locally

### Requirements

- Node.js and npm compatible with the versions required by the dependencies in `backend/package.json` and `frontend/package.json`.
- Windows PowerShell, macOS Terminal, or Linux shell.

### 1. Install and start the backend

In a terminal from the repository root:

```powershell
cd backend
npm install
npm run dev
```

The API listens at **http://localhost:3000**. By default, SQLite uses `backend/ledger.db`. To use another database file, set `JEWELTECH_DB_PATH` before starting the backend.

### 2. Seed the synthetic demo data

In a second terminal:

```powershell
cd backend
npm run seed
```

Seeding clears and recreates the backend demo data in the configured SQLite database. **Do not run this against a database whose contents you need to keep.** The seed includes multiple demo jewellers and karigars and named scenarios for paper slips, floats, returns, disputes, deadline rescue, and daily briefs.

### 3. Install and start the frontend

In a third terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally **http://localhost:5173**). The Vite development server proxies `/api` requests to `http://localhost:3000`, so keep the backend running.

### Demo sign-in

On the login screen, choose a demo identity or enter its phone and the demo PIN **1234**:

| Role | Phone | Example |
|---|---:|---|
| Jeweller | `111` | Sri Raj Jewellers |
| Jeweller | `222` | Laxmi Gold Palace |
| Karigar | `333`–`338` | Includes Ramesh on `333` |
| Staff | `777` | Sample staff |

PIN sign-in is a **simulated demo mechanism**, not production authentication. It does not provide production-grade session security.

### Try these paths

1. Sign in as jeweller `111` and explore **Home**, **Karigars**, **Orders**, and **Records**. Less-frequent tools and demo controls are under **More**.
2. Open a job to review its agreement, issue/return details, pending approvals, or activity. Use the seeded records to explore workflow states.
3. Sign out and sign in as karigar `333` to see Ramesh's own paper-slip view. Try the localized labels, read-aloud controls, acknowledgement, or concern action.
4. Open the customer-order demo from the app to see the browser-local demonstration. This data is stored separately from SQLite.

Rates, measurements, test payments, messages, and sample transactions are labelled **SIMULATED** or **SYNTHETIC** in the UI where applicable.

## Configuration and integrations

### LLM adapter

The backend defaults to the `mock` adapter, which keeps local use predictable and avoids requiring an API key:

```powershell
$env:LLM_ADAPTER = "mock"
npm run dev
```

To opt into the Gemini adapter, set `LLM_ADAPTER=gemini` and provide `GEMINI_API_KEY`. `GEMINI_MODEL` is optional and defaults to `gemini-2.5-flash`. For example, in PowerShell:

```powershell
$env:LLM_ADAPTER = "gemini"
$env:GEMINI_API_KEY = "your-key"
$env:GEMINI_MODEL = "gemini-2.5-flash"
npm run dev
```

Do not commit API keys. The LLM is limited to validated, language-facing instructions; deterministic code performs calculations and the agent cannot finalize a settlement. The frontend may use local deterministic parsing as a voice-entry fallback. Speech recognition and speech synthesis availability depend on the browser.

### Data and reset behavior

- Backend job-work data lives in SQLite (`backend/ledger.db` by default).
- The customer-order demo uses this browser's local storage and is independent of the SQLite ledger.
- Signing out or restarting the frontend does not clear browser-local demo data.
- Backend `npm run seed` resets the backend demo database; it does not represent a production migration or backup process.
- Use a separate database path for experiments if you want to preserve an existing seeded database.

## Development and checks

Run the backend tests and type-check from `backend/`:

```powershell
npm test
npx tsc --noEmit
```

Run frontend route checks, lint, and production build from `frontend/`:

```powershell
npm run test:routes
npm run lint
npm run build
```

The backend Jest suite covers domain calculations, API behavior, access scoping, ledger replay, approvals, disputes, returns, deadlines, and agent validation. Frontend route checks validate the route/feature manifest.

## API

The backend exposes a JSON API under `/api`. The core contract is documented in [backend/openapi.yaml](./backend/openapi.yaml). Representative workflows include:

- `POST /api/auth/pin-login` — simulated demo sign-in.
- `POST /api/orders` — create a job-work order.
- `GET /api/orders/:id/balance` — replay and verify an order's ledger balance.
- `POST /api/ledger/event` — append a ledger event, initially pending acknowledgement where required.
- `POST /api/ledger/:eventId/acknowledge` — record the other party's acknowledgement.
- Order-scoped agreement, return reconciliation, dispute, settlement, gold-journey, and pending-event endpoints.
- Karigar-scoped home, float, and exposure data; jeweller-scoped dashboard, deadline, and daily-brief workflows.

The OpenAPI file describes core endpoints and is not a complete listing of every route currently implemented. Check `backend/src/app.ts` for the current route handlers.

## Current limitations

- Demo PIN login is not production authentication; there is no production deployment or security-hardening claim.
- Seed values, demo rates, account examples, purity readings, and workflow scenarios are synthetic or simulated.
- Several operational conventions—such as wastage basis, acceptable tolerances, ownership of unused allowance, and some custody/dispute policies—need validation with real jewellers and karigars. They are called out in [DECISIONS.md](./DECISIONS.md).
- No payment processor, real assay device, SMS/WhatsApp delivery, or external scale integration is wired up.
- The customer-order demo's browser-local data is not the same persistence path as the backend ledger.

## Project brief and decisions

- [context.md](./context.md) — problem statement, product principles, domain rules, and UX constraints.
- [DECISIONS.md](./DECISIONS.md) — implementation decisions, synthetic/demo assumptions, and items awaiting field validation.
