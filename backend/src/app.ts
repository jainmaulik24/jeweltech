/**
 * @fileoverview Core REST API. Endpoints double as AI Agent Tools.
 */
import { parseUtterance } from './agent';
import express from 'express';
import crypto from 'crypto';
import db from './db';
import { appendLedgerEvent, replayAndVerifyOrder, progressEventStatus } from './ledger';
import { now } from './clock';
import {
    CreateOrderSchema,
    CustodyTransferRequestSchema,
    DeadlineTickRequestSchema,
    DailyBriefAsOfSchema,
    DailyBriefLanguageSchema,
    DailyBriefTickRequestSchema,
    ReturnReconciliationRequestSchema,
    WastageAgreementDraftSchema,
    GoldHandoffRequestSchema,
    GoldHandoffRejectionSchema,
} from './schema';
import { formatAgreementSummary, getActiveAgreement, getAgreementVersions } from './agreements';
import { AGREEMENT_CONFIG, PURITY_TABLE, RETURN_RECONCILIATION_CONFIG } from './agreementConfig';
import { GOLD_AT_LARGE_CONFIG, GOLD_RATE_CONFIG } from './goldAtLargeConfig';
import { DEADLINE_CONFIG } from './deadlineConfig';
import { DAILY_BRIEF_CONFIG } from './dailyBriefConfig';
import { GOLD_JOURNEY_CONFIG } from './goldJourneyConfig';
import { getRate } from './rateService';
import {
    calculateReturnReconciliation,
    calculateEffectiveRatePaisePerFinishedGram,
    calculateRatePolicyAmounts,
    calculateWeightShareMg,
    computeAgreementAllowanceMg,
    formatWeightMgAsGrams,
    parseUnitToMg,
    parsePercentToBps,
    parseRupeesToPaise,
    toFineGoldPerMilleMg,
    calculateGoldAtLargeSummary,
    calculateAgeingDays,
    addHoursToDate,
} from './calc';
import {
    acknowledgeCustodyTransfer,
    chooseRescueKarigar,
    getDeadlineBoard,
    getGoldJourney,
    markNudgeReplied,
    rejectCustodyTransfer,
    runAgentTick,
    transferCustody,
} from './deadlineAgent';
import { getDailyBrief, runDailyBriefTick } from './dailyBrief';
import {
    createDispute,
    escalateDispute,
    getDisputeDetails,
    getEscalatedDisputes,
    getOrderDisputeEntries,
    resolveDispute,
} from './disputes';
import { DISPUTE_CONFIG } from './disputeConfig';

const app = express();
const disputeBodyLimit = Math.ceil(
    DISPUTE_CONFIG.maxEvidenceBytes * 4 / 3 * DISPUTE_CONFIG.maxEvidenceAttachments + 32_768,
);
app.use('/api/ledger/:eventId/disputes', express.json({ limit: `${disputeBodyLimit}b` }));
app.use(express.json());

// Simulated Auth Middleware: Extracts user ID from headers for data isolation
const getUserId = (req: express.Request) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) throw new Error('Missing x-user-id header');
    return userId;
};

const sampleOrderIds = [
    'ord-handshake-demo',
    DAILY_BRIEF_CONFIG.demo.dueTodayOrderId,
    DAILY_BRIEF_CONFIG.demo.jewellerApprovalOrderId,
    DISPUTE_CONFIG.demo.orderId,
    GOLD_JOURNEY_CONFIG.demo.orderId,
    ...RETURN_RECONCILIATION_CONFIG.demoScenarios.map((scenario) => scenario.orderId),
    ...GOLD_AT_LARGE_CONFIG.demoJobs.map((scenario) => scenario.orderId),
];

const parseLedgerDate = (value: string): Date => {
    const normalized = value.includes(' ')
        ? value.replace(' ', 'T')
        : value.length === 10
            ? `${value}T00:00:00Z`
            : value;
    return new Date(/(Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`);
};

const validatePurityPerMille = (value: unknown) => {
    if (typeof value !== 'number' || !PURITY_TABLE.some((purity) => purity.perMille === value)) {
        throw new Error('Purity must be selected from the configured per-mille readings.');
    }
    return value;
};

// Agent Tool: createOrder
app.post('/api/orders', (req, res) => {
    try {
        const request = CreateOrderSchema.parse(req.body);
        const actorId = req.headers['x-user-id'] as string | undefined;
        if (actorId && actorId !== request.jewellerId) throw new Error('Only the order jeweller can create it.');
        const jeweller = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'jeweller'")
            .get(request.jewellerId);
        if (!jeweller) throw new Error('Jeweller not found.');
        const karigar = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'karigar'")
            .get(request.karigarId);
        if (!karigar) throw new Error('Karigar not found.');
        const id = `ord-${crypto.randomUUID()}`;
        // Default to 7 days from now
        const dueDate = new Date(
            now().getTime() + DEADLINE_CONFIG.defaultOccasionLeadDays * 86_400_000,
        ).toISOString();
        const occasionDate = request.occasionDate ?? dueDate;

        db.prepare(`
            INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date, occasion_date, job_type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, request.jewellerId, request.karigarId, request.description, dueDate, occasionDate, request.jobType);
        res.json({
            id,
            jewellerId: request.jewellerId,
            karigarId: request.karigarId,
            description: request.description,
            status: 'open',
            dueDate,
            occasionDate,
            jobType: request.jobType,
        });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/demo/orders', (req, res) => {
    try {
        const actorId = getUserId(req);
        const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId) as { role: string } | undefined;
        if (!actor) throw new Error('User not found.');
        const placeholders = sampleOrderIds.map(() => '?').join(', ');
        let scope = '(jeweller_id = ? OR karigar_id = ?)';
        const scopeParams: string[] = [actorId, actorId];
        if (actor.role === 'staff') {
            const staff = db.prepare('SELECT owner_jeweller_id AS ownerJewellerId FROM staff_profiles WHERE user_id = ?')
                .get(actorId) as { ownerJewellerId: string } | undefined;
            if (!staff) throw new Error('Staff owner is not configured.');
            scope = `jeweller_id = ? AND EXISTS (
                SELECT 1 FROM custody_transfers t
                WHERE t.order_id = orders.id AND (t.from_karigar_id = ? OR t.to_karigar_id = ?)
            )`;
            scopeParams.length = 0;
            scopeParams.push(staff.ownerJewellerId, actorId, actorId);
        } else if (actor.role === 'karigar') {
            scope = `(karigar_id = ? OR EXISTS (
                SELECT 1 FROM custody_transfers t
                WHERE t.order_id = orders.id AND (t.from_karigar_id = ? OR t.to_karigar_id = ?)
            ))`;
            scopeParams.length = 0;
            scopeParams.push(actorId, actorId, actorId);
        } else if (actor.role !== 'jeweller') {
            throw new Error('Unauthorized role.');
        }
        const orders = db.prepare(`
            SELECT id, description, karigar_id AS karigarId FROM orders
            WHERE id IN (${placeholders}) AND ${scope}
            ORDER BY rowid
        `).all(...sampleOrderIds, ...scopeParams);
        res.json({ orders });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/gold-at-large', (req, res) => {
    try {
        const actorId = getUserId(req);
        const actor = db.prepare('SELECT id, name, role FROM users WHERE id = ?')
            .get(actorId) as { id: string; name: string; role: string } | undefined;
        if (!actor) throw new Error('User not found.');
        if (actor.role !== 'jeweller' && actor.role !== 'karigar') {
            throw new Error('Unauthorized role.');
        }

        const shockPercent = req.query.shockPercent === undefined
            ? GOLD_RATE_CONFIG.shock.defaultPercent
            : Number(req.query.shockPercent);
        if (!Number.isInteger(shockPercent)
            || shockPercent < GOLD_RATE_CONFIG.shock.minPercent
            || shockPercent > GOLD_RATE_CONFIG.shock.maxPercent) {
            throw new Error(
                `Rate shock must be an integer between ${GOLD_RATE_CONFIG.shock.minPercent}% and ${GOLD_RATE_CONFIG.shock.maxPercent}%.`,
            );
        }

        const asOf = now();
        const orderFilterColumn = actor.role === 'jeweller' ? 'jeweller_id' : 'karigar_id';
        const orderRows = db.prepare(`
            SELECT o.id, o.description, o.status, o.due_date AS dueDate,
                o.karigar_id AS karigarId, k.name AS karigarName
            FROM orders o
            JOIN users k ON k.id = o.karigar_id
            WHERE o.${orderFilterColumn} = ?
                AND EXISTS (
                    SELECT 1 FROM ledger_events i
                    WHERE i.order_id = o.id AND i.type = 'issue' AND i.status = 'acknowledged'
                )
            ORDER BY o.rowid
        `).all(actorId) as Array<{
            id: string;
            description: string | null;
            status: string;
            dueDate: string;
            karigarId: string;
            karigarName: string;
        }>;

        const dashboardOrders = orderRows.map((order) => {
            const replay = replayAndVerifyOrder(order.id, asOf);
            if (!replay.isValidChain) {
                throw new Error(`Ledger replay failed verification for ${order.id}.`);
            }
            const events = db.prepare(`
                SELECT type, weight_mg AS weightMg, amount, status,
                    agreement_id AS agreementId, agreement_version AS agreementVersion,
                    created_at AS createdAt
                FROM ledger_events WHERE order_id = ?
                ORDER BY created_at, rowid
            `).all(order.id) as Array<{
                type: string;
                weightMg: number;
                amount: number;
                status: string;
                agreementId: string | null;
                agreementVersion: number | null;
                createdAt: string;
            }>;
            const acknowledgedIssues = events.filter((event) => event.type === 'issue' && event.status === 'acknowledged');
            const acknowledgedReturns = events.filter((event) => event.type === 'return' && event.status === 'acknowledged');
            const acknowledgedPhysicalReturns = events.filter(
                (event) => (event.type === 'return' || event.type === 'scrap_entry') && event.status === 'acknowledged',
            );
            const firstIssue = acknowledgedIssues[0];
            const latestIssue = acknowledgedIssues[acknowledgedIssues.length - 1];
            const latestPhysicalReturn = acknowledgedPhysicalReturns[acknowledgedPhysicalReturns.length - 1];
            const fallbackAgreement = latestIssue?.agreementId && latestIssue.agreementVersion
                ? db.prepare(`
                    SELECT labour_rate_paise_per_gram AS labourRatePaisePerGram
                    FROM wastage_agreements WHERE id = ? AND version = ?
                `).get(latestIssue.agreementId, latestIssue.agreementVersion) as {
                    labourRatePaisePerGram: number;
                } | undefined
                : undefined;
            const cashLedgerEntries = events.map((event) => {
                const agreementId = event.agreementId ?? latestIssue?.agreementId;
                const agreementVersion = event.agreementVersion ?? latestIssue?.agreementVersion;
                const agreement = event.type === 'return' && agreementId && agreementVersion
                    ? db.prepare(`
                        SELECT labour_rate_paise_per_gram AS labourRatePaisePerGram
                        FROM wastage_agreements WHERE id = ? AND version = ?
                    `).get(agreementId, agreementVersion) as { labourRatePaisePerGram: number } | undefined
                    : undefined;
                return {
                    type: event.type,
                    status: event.status,
                    weightMg: event.weightMg,
                    amountPaise: event.amount,
                    createdAt: event.createdAt,
                    labourRatePaisePerGram: agreement?.labourRatePaisePerGram
                        ?? (event.type === 'return' ? fallbackAgreement?.labourRatePaisePerGram ?? null : null),
                };
            });
            const issueDate = firstIssue ? parseLedgerDate(firstIssue.createdAt) : asOf;
            const returnDate = latestPhysicalReturn ? parseLedgerDate(latestPhysicalReturn.createdAt) : asOf;
            const settlementRate = getRate(asOf, 999, shockPercent);

            return {
                id: order.id,
                description: order.description ?? 'Gold work',
                status: order.status,
                karigarId: order.karigarId,
                karigarName: order.karigarName,
                dueDate: order.dueDate,
                issueDate: firstIssue?.createdAt ?? null,
                returnDate: latestPhysicalReturn?.createdAt ?? null,
                cashLedgerEntries,
                accountBalances: replay.accountBalances,
                ratesPaisePerGram: {
                    issue: getRate(issueDate, 999, shockPercent).rate24KPaisePerGram,
                    return: getRate(returnDate, 999, shockPercent).rate24KPaisePerGram,
                    settlement: settlementRate.rate24KPaisePerGram,
                },
            };
        });

        const currentRate = getRate(asOf, 999, shockPercent);
        const summary = calculateGoldAtLargeSummary({
            asOf,
            currentRatePaisePerGram: currentRate.rate24KPaisePerGram,
            stageLabels: GOLD_AT_LARGE_CONFIG.physicalAccounts,
            ageingBuckets: GOLD_AT_LARGE_CONFIG.ageingBuckets,
            orders: dashboardOrders,
        });
        const pendingAcknowledgements = db.prepare(`
            SELECT e.id, e.order_id AS orderId, o.description, e.type,
                e.amount, e.weight_mg AS weightMg, e.created_by AS createdBy,
                e.agreement_version AS agreementVersion, e.created_at AS createdAt
            FROM ledger_events e
            JOIN orders o ON o.id = e.order_id
            WHERE (o.jeweller_id = ? OR o.karigar_id = ?)
                AND e.status = 'pending_ack'
                AND e.created_by != ?
            ORDER BY e.created_at, e.rowid
        `).all(actorId, actorId, actorId) as Array<{
            id: string;
            orderId: string;
            description: string | null;
            type: string;
            amount: number;
            weightMg: number;
            createdBy: string;
            agreementVersion: number | null;
            createdAt: string;
        }>;

        res.json({
            actor: { id: actor.id, name: actor.name, role: actor.role },
            asOf: asOf.toISOString(),
            rate: currentRate,
            rateConfiguration: {
                shock: GOLD_RATE_CONFIG.shock,
                label: GOLD_RATE_CONFIG.label,
            },
            ...summary,
            pendingAcknowledgements: pendingAcknowledgements.map((event) => ({
                ...event,
                description: event.description ?? 'Gold work',
                ageDays: calculateAgeingDays(event.createdAt, asOf),
            })),
        });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/orders/:id/agreements', (req, res) => {
    try {
        const actorId = getUserId(req);
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
        if (!order) throw new Error('Order not found');
        if (order.jeweller_id !== actorId && order.karigar_id !== actorId) {
            throw new Error('Unauthorized: You do not have access to this order');
        }

        const language = req.query.lang === 'kn' ? 'kn' : 'en';
        const karigar = db.prepare('SELECT name FROM users WHERE id = ?').get(order.karigar_id) as { name: string };
        const agreements = getAgreementVersions(req.params.id).map((agreement) => ({
            ...agreement,
            summary: formatAgreementSummary(agreement, karigar.name, language),
        }));
        const latestIssue = db.prepare(`
            SELECT agreement_id AS agreementId, agreement_version AS agreementVersion
            FROM ledger_events WHERE order_id = ? AND type = 'issue'
            ORDER BY created_at DESC, rowid DESC LIMIT 1
        `).get(req.params.id) as { agreementId: string | null; agreementVersion: number | null } | undefined;
        res.json({
            agreements,
            activeAgreement: getActiveAgreement(req.params.id),
            latestIssue,
            karigarName: karigar.name,
            configuration: {
                jobTypes: AGREEMENT_CONFIG.jobTypes,
                bases: AGREEMENT_CONFIG.bases,
            },
        });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.post('/api/orders/:id/agreements', (req, res) => {
    try {
        const actorId = getUserId(req);
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
        if (!order) throw new Error('Order not found');
        if (order.jeweller_id !== actorId) throw new Error('Only this order’s jeweller can draft an agreement');

        const draftInput = {
            ...req.body,
            percentBps: req.body.percentBps ?? parsePercentToBps(String(req.body.wastagePercent)),
            labourRatePaisePerGram: req.body.labourRatePaisePerGram ?? parseRupeesToPaise(String(req.body.labourRateRupees)),
            karigarSweepShareBps: req.body.karigarSweepShareBps
                ?? (req.body.sweepOwner === 'karigar'
                    ? 10000
                    : req.body.sweepOwner === 'jeweller'
                        ? 0
                        : parsePercentToBps(String(req.body.karigarSweepPercent))),
        };
        const draft = WastageAgreementDraftSchema.parse(draftInput);
        const previous = db.prepare('SELECT MAX(version) AS version FROM wastage_agreements WHERE order_id = ?')
            .get(req.params.id) as { version: number | null };
        const version = (previous.version ?? 0) + 1;
        const agreementId = `agr-${crypto.randomUUID()}`;
        const createdAt = now().toISOString();
        const effectiveAt = draft.effectiveAt ?? createdAt;
        const insert = db.prepare(`
            INSERT INTO wastage_agreements
            (id, order_id, jeweller_id, karigar_id, job_type, basis, percent_bps,
             labour_rate_paise_per_gram, sweep_owner, karigar_sweep_share_bps,
             cash_rate_policy, version, effective_at, status, accepted_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?)
        `);

        const result = db.transaction(() => {
            insert.run(
                agreementId, req.params.id, order.jeweller_id, order.karigar_id, draft.jobType,
                draft.basis, draft.percentBps, draft.labourRatePaisePerGram, draft.sweepOwner,
                draft.karigarSweepShareBps, draft.cashRatePolicy, version, effectiveAt, createdAt
            );
            const agreement = getAgreementVersions(req.params.id).find((item) => item.id === agreementId)!;
            const karigar = db.prepare('SELECT name FROM users WHERE id = ?').get(order.karigar_id) as { name: string };
            const summary = formatAgreementSummary(agreement, karigar.name);
            appendLedgerEvent({
                id: `evt-${crypto.randomUUID()}`,
                orderId: req.params.id,
                type: 'agreement_version',
                weightMg: 0,
                amount: 0,
                status: 'pending_ack',
                createdBy: actorId,
                notes: JSON.stringify({ agreement, summary }),
                idempotencyKey: `agreement-version-${agreementId}`,
                agreementId,
                agreementVersion: version,
            });
            return { agreement, summary };
        })();
        res.json(result);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.post('/api/orders/:id/agreements/:agreementId/accept', (req, res) => {
    try {
        const actorId = getUserId(req);
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
        if (!order) throw new Error('Order not found');
        if (order.karigar_id !== actorId) throw new Error('Only this order’s karigar can accept the agreement');
        const agreement = db.prepare('SELECT * FROM wastage_agreements WHERE id = ? AND order_id = ?')
            .get(req.params.agreementId, req.params.id) as any;
        if (!agreement) throw new Error('Agreement not found');
        if (agreement.status !== 'draft') throw new Error('Agreement is not awaiting acknowledgement');

        const acceptedAt = now().toISOString();
        db.transaction(() => {
            const versionEvent = db.prepare(`
                SELECT id FROM ledger_events
                WHERE order_id = ? AND agreement_id = ? AND type = 'agreement_version'
            `).get(req.params.id, agreement.id) as { id: string } | undefined;
            if (!versionEvent) throw new Error('Agreement version ledger event not found.');
            progressEventStatus(versionEvent.id, actorId, 'acknowledged');
            db.prepare('UPDATE wastage_agreements SET status = ?, accepted_at = ? WHERE id = ?')
                .run('accepted', acceptedAt, agreement.id);
            appendLedgerEvent({
                id: `evt-${crypto.randomUUID()}`,
                orderId: req.params.id,
                type: 'agreement_acknowledgement',
                weightMg: 0,
                amount: 0,
                status: 'acknowledged',
                createdBy: actorId,
                notes: JSON.stringify({ agreementId: agreement.id, version: agreement.version, acceptedAt }),
                idempotencyKey: `agreement-ack-${agreement.id}`,
                agreementId: agreement.id,
                agreementVersion: agreement.version,
            });
        })();

        res.json({ success: true, agreementId: agreement.id, version: agreement.version, acceptedAt });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/orders/:id/agreement-analysis', (req, res) => {
    try {
        const actorId = getUserId(req);
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
        if (!order) throw new Error('Order not found');
        if (order.jeweller_id !== actorId && order.karigar_id !== actorId) {
            throw new Error('Unauthorized: You do not have access to this order');
        }
        const activeAgreement = getActiveAgreement(req.params.id);
        const sample = AGREEMENT_CONFIG.demo;
        const allowanceInput = {
            issuedGrossMg: sample.issuedGrossMg,
            issuedPurityPerMille: sample.issuedPurityPerMille,
            finishedWeightMg: sample.finishedWeightMg,
            percentBps: activeAgreement?.percentBps ?? 300,
        };
        const allowanceComparison = AGREEMENT_CONFIG.bases.map(({ value, label }) => ({
            basis: value,
            label,
            allowanceMg: computeAgreementAllowanceMg({ ...allowanceInput, basis: value }),
        }));
        const fineGoldMg = toFineGoldPerMilleMg(sample.issuedGrossMg, sample.issuedPurityPerMille);
        const ratePolicyAmountsPaise = calculateRatePolicyAmounts({
            fineGoldMg,
            ratesPaisePerGram: sample.simulatedRatesPaisePerGram,
        });
        let fairPay = null;
        if (activeAgreement) {
            const allowanceMg = computeAgreementAllowanceMg({
                ...allowanceInput,
                percentBps: activeAgreement.percentBps,
                basis: activeAgreement.basis,
            });
            const karigarSweepShareMg = calculateWeightShareMg(sample.estimatedSweepMg, activeAgreement.karigarSweepShareBps);
            const result = calculateEffectiveRatePaisePerFinishedGram({
                labourRatePaisePerGram: activeAgreement.labourRatePaisePerGram,
                allowanceMg,
                finishedWeightMg: sample.finishedWeightMg,
                sweepShareMg: karigarSweepShareMg,
                simulatedGoldRatePaisePerGram: sample.simulatedRatesPaisePerGram.settlement,
                syntheticReferenceRangePaisePerGram: AGREEMENT_CONFIG.syntheticReferenceRangePaisePerGram,
            });
            fairPay = {
                ...result,
                version: activeAgreement.version,
                syntheticReferenceRangePaisePerGram: AGREEMENT_CONFIG.syntheticReferenceRangePaisePerGram,
            };
        }

        res.json({
            activeAgreement,
            allowanceComparison,
            fairPay,
            ratePolicyAmountsPaise,
            simulatedRatesPaisePerGram: sample.simulatedRatesPaisePerGram,
            benchmarkLabel: 'SYNTHETIC',
            rateLabel: 'SIMULATED',
            syntheticReferenceRangePaisePerGram: AGREEMENT_CONFIG.syntheticReferenceRangePaisePerGram,
            configuration: {
                jobTypes: AGREEMENT_CONFIG.jobTypes,
                bases: AGREEMENT_CONFIG.bases,
            },
            sample: {
                issuedGrossMg: sample.issuedGrossMg,
                issuedPurityPerMille: sample.issuedPurityPerMille,
                finishedWeightMg: sample.finishedWeightMg,
            },
        });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/orders/:id/returns/config', (req, res) => {
    try {
        const actorId = getUserId(req);
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
        if (!order) throw new Error('Order not found');
        if (order.jeweller_id !== actorId && order.karigar_id !== actorId) {
            throw new Error('Unauthorized: You do not have access to this order');
        }

        const issueRows = db.prepare(`
            SELECT weight_mg AS weightMg, purity_per_mille AS purityPerMille,
                agreement_id AS agreementId, agreement_version AS agreementVersion
            FROM ledger_events
            WHERE order_id = ? AND type = 'issue' AND status = 'acknowledged'
            ORDER BY created_at, rowid
        `).all(req.params.id) as Array<{
            weightMg: number;
            purityPerMille: number | null;
            agreementId: string | null;
            agreementVersion: number | null;
        }>;
        if (issueRows.length === 0) throw new Error('An acknowledged gold issue is required before return reconciliation.');
        if (issueRows.some((issue) => issue.purityPerMille === null)) {
            throw new Error('An issued-lot purity reading is missing; record it before return reconciliation.');
        }
        const latestIssue = issueRows[issueRows.length - 1];
        if (!latestIssue.agreementId || !latestIssue.agreementVersion) {
            throw new Error('The issued gold has no stored wastage agreement version.');
        }
        const agreement = db.prepare(`
            SELECT basis, percent_bps AS percentBps, version
            FROM wastage_agreements WHERE id = ? AND version = ?
        `).get(latestIssue.agreementId, latestIssue.agreementVersion) as {
            basis: 'fine_issued' | 'gross_issued' | 'finished_weight';
            percentBps: number;
            version: number;
        } | undefined;
        if (!agreement) throw new Error('The issue agreement version is unavailable.');

        const scenario = RETURN_RECONCILIATION_CONFIG.demoScenarios
            .find((item) => item.orderId === req.params.id) ?? null;
        res.json({
            issuedLots: issueRows.map((issue) => ({
                weightMg: issue.weightMg,
                purityPerMille: issue.purityPerMille,
            })),
            agreement: { ...agreement, percentLabel: `${(agreement.percentBps / 100).toFixed(2)}%` },
            scenario: scenario ? {
                label: scenario.label,
                finishedLots: scenario.finishedLots.map((lot) => ({
                    weightGrams: formatWeightMgAsGrams(lot.weightMg),
                    purityPerMille: lot.purityPerMille,
                    method: lot.method,
                })),
                scrapLots: scenario.scrapLots.map((lot) => ({
                    weightGrams: formatWeightMgAsGrams(lot.weightMg),
                    purityPerMille: lot.purityPerMille,
                })),
            } : null,
            configuration: {
                grossWeightToleranceMg: RETURN_RECONCILIATION_CONFIG.grossWeightToleranceMg,
                purityShortfallToleranceFineMg: RETURN_RECONCILIATION_CONFIG.purityShortfallToleranceFineMg,
                unusedAllowancePolicy: RETURN_RECONCILIATION_CONFIG.unusedAllowancePolicy,
                purityReadLabel: RETURN_RECONCILIATION_CONFIG.purityReadLabel,
                purities: PURITY_TABLE,
            },
        });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.post('/api/orders/:id/returns/reconcile', (req, res) => {
    try {
        const actorId = getUserId(req);
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
        if (!order) throw new Error('Order not found');
        if (order.jeweller_id !== actorId && order.karigar_id !== actorId) {
            throw new Error('Unauthorized: You do not have access to this order');
        }
        const requestInput = ReturnReconciliationRequestSchema.parse(req.body);
        const issueRows = db.prepare(`
            SELECT weight_mg AS weightMg, purity_per_mille AS purityPerMille,
                agreement_id AS agreementId, agreement_version AS agreementVersion
            FROM ledger_events
            WHERE order_id = ? AND type = 'issue' AND status = 'acknowledged'
            ORDER BY created_at, rowid
        `).all(req.params.id) as Array<{
            weightMg: number;
            purityPerMille: number | null;
            agreementId: string | null;
            agreementVersion: number | null;
        }>;
        if (issueRows.length === 0) throw new Error('An acknowledged gold issue is required before return reconciliation.');
        if (issueRows.some((issue) => issue.purityPerMille === null)) {
            throw new Error('An issued-lot purity reading is missing; record it before return reconciliation.');
        }
        const latestIssue = issueRows[issueRows.length - 1];
        if (!latestIssue.agreementId || !latestIssue.agreementVersion) {
            throw new Error('The issued gold has no stored wastage agreement version.');
        }
        if (issueRows.some((issue) => issue.agreementId !== latestIssue.agreementId
            || issue.agreementVersion !== latestIssue.agreementVersion)) {
            throw new Error('Issue lots tied to different agreement versions must be reconciled separately.');
        }
        const existingReturns = db.prepare(`
            SELECT COUNT(*) AS count FROM ledger_events
            WHERE order_id = ? AND type IN ('return', 'scrap_entry', 'process_loss')
        `).get(req.params.id) as { count: number };
        if (existingReturns.count > 0) {
            throw new Error('This order already has return entries; use the correction flow to amend its history.');
        }
        const agreement = db.prepare(`
            SELECT basis, percent_bps AS percentBps, version
            FROM wastage_agreements WHERE id = ? AND version = ?
        `).get(latestIssue.agreementId, latestIssue.agreementVersion) as {
            basis: 'fine_issued' | 'gross_issued' | 'finished_weight';
            percentBps: number;
            version: number;
        } | undefined;
        if (!agreement) throw new Error('The issue agreement version is unavailable.');

        const toPurityPerMille = (value: number) => {
            if (!PURITY_TABLE.some((purity) => purity.perMille === value)) {
                throw new Error(`Unsupported purity reading: ${value}‰.`);
            }
            return value;
        };
        const finishedLots = requestInput.finishedLots.map((lot) => ({
            weightMg: parseUnitToMg(lot.weightGrams, 'g'),
            purityPerMille: toPurityPerMille(lot.purityPerMille),
            method: lot.method,
        }));
        const scrapLots = requestInput.scrapLots.map((lot) => ({
            weightMg: parseUnitToMg(lot.weightGrams, 'g'),
            purityPerMille: toPurityPerMille(lot.purityPerMille),
        }));
        const result = calculateReturnReconciliation({
            issuedLots: issueRows.map((issue) => ({
                weightMg: issue.weightMg,
                purityPerMille: issue.purityPerMille!,
            })),
            finishedLots,
            scrapLots,
            agreement: { basis: agreement.basis, percentBps: agreement.percentBps },
            config: {
                grossWeightToleranceMg: RETURN_RECONCILIATION_CONFIG.grossWeightToleranceMg,
                purityShortfallToleranceFineMg: RETURN_RECONCILIATION_CONFIG.purityShortfallToleranceFineMg,
                unusedAllowancePolicy: RETURN_RECONCILIATION_CONFIG.unusedAllowancePolicy,
                purityLabels: Object.fromEntries(PURITY_TABLE.map((purity) => [purity.perMille, purity.label])),
            },
        });

        const agreementRule = `Agreement v${agreement.version}: ${(agreement.percentBps / 100).toFixed(2)}% on ${agreement.basis.replaceAll('_', ' ')}.`;
        const eventPrefix = `return-reconcile-${requestInput.idempotencyKey}`;
        const events = db.transaction(() => {
            const postedEvents: any[] = [];
            finishedLots.forEach((lot, index) => {
                postedEvents.push(appendLedgerEvent({
                    id: `evt-${crypto.randomUUID()}`,
                    orderId: req.params.id,
                    type: 'return',
                    weightMg: lot.weightMg,
                    fineWeightMg: toFineGoldPerMilleMg(lot.weightMg, lot.purityPerMille),
                    purityPerMille: lot.purityPerMille,
                    status: 'pending_ack',
                    createdBy: actorId,
                    notes: JSON.stringify({
                        method: lot.method,
                        purityPerMille: lot.purityPerMille,
                        purityReadLabel: RETURN_RECONCILIATION_CONFIG.purityReadLabel,
                    }),
                    idempotencyKey: `${eventPrefix}-finished-${index}`,
                    agreementId: latestIssue.agreementId,
                    agreementVersion: agreement.version,
                }));
            });
            scrapLots.forEach((lot, index) => {
                postedEvents.push(appendLedgerEvent({
                    id: `evt-${crypto.randomUUID()}`,
                    orderId: req.params.id,
                    type: 'scrap_entry',
                    weightMg: lot.weightMg,
                    fineWeightMg: toFineGoldPerMilleMg(lot.weightMg, lot.purityPerMille),
                    purityPerMille: lot.purityPerMille,
                    status: 'pending_ack',
                    createdBy: actorId,
                    notes: JSON.stringify({
                        purityPerMille: lot.purityPerMille,
                        purityReadLabel: RETURN_RECONCILIATION_CONFIG.purityReadLabel,
                    }),
                    idempotencyKey: `${eventPrefix}-scrap-${index}`,
                    agreementId: latestIssue.agreementId,
                    agreementVersion: agreement.version,
                }));
            });
            if (result.processLossFineMg > 0 || result.processLossGrossMg > 0) {
                postedEvents.push(appendLedgerEvent({
                    id: `evt-${crypto.randomUUID()}`,
                    orderId: req.params.id,
                    type: 'process_loss',
                    weightMg: Math.max(0, result.processLossGrossMg),
                    fineWeightMg: Math.max(0, result.processLossFineMg),
                    status: 'pending_ack',
                    createdBy: actorId,
                    notes: `Process loss from return reconciliation · ${agreementRule}`,
                    idempotencyKey: `${eventPrefix}-process-loss`,
                    agreementId: latestIssue.agreementId,
                    agreementVersion: agreement.version,
                }));
            }

            let settlementDraft: any = null;
            if (result.owedFineMg > 0 && result.status !== 'EXCESS_REVIEW') {
                settlementDraft = appendLedgerEvent({
                    id: `evt-${crypto.randomUUID()}`,
                    orderId: req.params.id,
                    type: 'settlement',
                    weightMg: 0,
                    fineWeightMg: result.owedFineMg,
                    status: 'pending_ack',
                    createdBy: actorId,
                    notes: `Settlement draft · ${agreementRule}\nKarigar owes ${result.owedFineMg} mg fine gold after allowance; awaiting both parties' approval.`,
                    idempotencyKey: `${eventPrefix}-settlement`,
                    agreementId: latestIssue.agreementId,
                    agreementVersion: agreement.version,
                    debitAccount: 'process_loss',
                    creditAccount: 'jeweller_vault',
                });
                postedEvents.push(settlementDraft);
            }
            return { postedEvents, settlementDraft };
        })();

        res.json({
            result,
            agreementRule,
            events: events.postedEvents,
            settlementDraft: events.settlementDraft,
        });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/orders/:id/pending-events', (req, res) => {
    try {
        const actorId = getUserId(req);
        const order = db.prepare('SELECT jeweller_id, karigar_id FROM orders WHERE id = ?')
            .get(req.params.id) as { jeweller_id: string; karigar_id: string } | undefined;
        if (!order) throw new Error('Order not found');
        if (order.jeweller_id !== actorId && order.karigar_id !== actorId) {
            throw new Error('Unauthorized: You do not have access to this order');
        }
        const events = db.prepare(`
            SELECT id, type, notes, amount, weight_mg AS weightMg, created_by AS createdBy,
                agreement_version AS agreementVersion
            FROM ledger_events
            WHERE order_id = ? AND status = 'pending_ack' AND type != 'agreement_version'
            ORDER BY created_at, rowid
        `).all(req.params.id);
        res.json({ events });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/disputes/escalated', (req, res) => {
    try {
        res.json({ disputes: getEscalatedDisputes(getUserId(req)) });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/disputes/:id', (req, res) => {
    try {
        res.json(getDisputeDetails(req.params.id, getUserId(req)));
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.post('/api/ledger/:eventId/disputes', (req, res) => {
    try {
        const actorId = getUserId(req);
        const disputeId = createDispute(req.params.eventId, actorId, req.body);
        res.status(201).json(getDisputeDetails(disputeId, actorId));
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.post('/api/disputes/:id/escalate', (req, res) => {
    try {
        const actorId = getUserId(req);
        escalateDispute(req.params.id, actorId);
        res.json(getDisputeDetails(req.params.id, actorId));
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.post('/api/disputes/:id/resolve', (req, res) => {
    try {
        const actorId = getUserId(req);
        const result = resolveDispute(req.params.id, actorId, req.body);
        res.json({ ...result, dispute: getDisputeDetails(req.params.id, actorId) });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/orders/:id/disputes', (req, res) => {
    try {
        res.json(getOrderDisputeEntries(req.params.id, getUserId(req)));
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/orders/:id/gold-journey', (req, res) => {
    try {
        res.json(getGoldJourney(req.params.id, getUserId(req)));
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.post('/api/orders/:id/gold-journey/handoffs', (req, res) => {
    try {
        const actorId = getUserId(req);
        const journey = getGoldJourney(req.params.id, actorId);
        if (!journey.canProposeHandoff) throw new Error('Only the jeweller or current custodian can propose a handoff.');
        const input = GoldHandoffRequestSchema.parse(req.body);
        const transfer = transferCustody({
            orderId: req.params.id,
            fromKarigarId: journey.currentCustodian.id,
            toKarigarId: input.toPartyId,
            weightMg: input.sentWeightMg,
            purityPerMille: input.sentPurityPerMille,
            receivedWeightMg: input.receivedWeightMg,
            receivedPurityPerMille: input.receivedPurityPerMille,
            stage: input.stage,
            createdBy: actorId,
            idempotencyKey: input.idempotencyKey,
        });
        res.status(201).json({ transfer, journey: getGoldJourney(req.params.id, actorId) });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// Agent Tool: getOrderBalance
app.get('/api/orders/:id/balance', (req, res) => {
    try {
        const state = replayAndVerifyOrder(req.params.id);
        res.json(state);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// Agent Tool: recordLedgerEvent (Handles issues, returns, and scrap in one unified schema)
app.post('/api/ledger/event', (req, res) => {
    try {
        const actorId = getUserId(req);
        const type = req.body.type;
        if (!['issue', 'return', 'scrap_entry', 'payment', 'settlement'].includes(type)) {
            throw new Error('This event type must use its dedicated approval workflow.');
        }
        const orderId = req.body.orderId;
        let agreementId: string | null = null;
        let agreementVersion: number | null = null;
        let ratePolicy: 'issue' | 'return' | 'settlement' | null = null;
        let rateSnapshotPaisePerGram: number | null = null;
        let amount = req.body.amount ?? 0;
        let notes = req.body.notes || null;
        let purityPerMille: number | null = null;
        let fineWeightMg: number | null = null;

        if (type === 'issue') {
            const agreement = getActiveAgreement(orderId);
            agreementId = agreement?.id ?? null;
            agreementVersion = agreement?.version ?? null;
            purityPerMille = validatePurityPerMille(
                req.body.purityPerMille ?? AGREEMENT_CONFIG.demo.issuedPurityPerMille
            );
            fineWeightMg = toFineGoldPerMilleMg(req.body.weightMg, purityPerMille);
        }

        if (type === 'return' || type === 'scrap_entry') {
            purityPerMille = validatePurityPerMille(req.body.purityPerMille);
            if (!['touch', 'XRF', 'declared'].includes(req.body.method)) {
                throw new Error('A touch, XRF, or declared purity method is required.');
            }
            fineWeightMg = toFineGoldPerMilleMg(req.body.weightMg, purityPerMille);
            notes = `${notes ?? ''}\n${req.body.method} purity ${purityPerMille}‰ (${RETURN_RECONCILIATION_CONFIG.purityReadLabel}).`.trim();
        }

        if (type === 'payment' || type === 'settlement') {
            const latestIssue = db.prepare(`
                SELECT agreement_id AS agreementId, agreement_version AS agreementVersion
                FROM ledger_events
                WHERE order_id = ? AND type = 'issue' AND status = 'acknowledged'
                ORDER BY created_at DESC, rowid DESC LIMIT 1
            `).get(orderId) as { agreementId: string | null; agreementVersion: number | null } | undefined;
            if (!latestIssue?.agreementId || !latestIssue.agreementVersion) {
                throw new Error('Cash proposals require an acknowledged issue with a stored agreement version.');
            }
            const agreement = db.prepare(`
                SELECT cash_rate_policy AS cashRatePolicy
                FROM wastage_agreements WHERE id = ? AND version = ?
            `).get(latestIssue.agreementId, latestIssue.agreementVersion) as { cashRatePolicy: string } | undefined;
            if (!agreement) throw new Error('The issue agreement version is unavailable.');
            const policy = agreement.cashRatePolicy;
            if (policy !== 'issue' && policy !== 'return' && policy !== 'settlement') {
                throw new Error('The agreement has an invalid cash rate policy.');
            }
            const state = replayAndVerifyOrder(orderId);
            const fineGoldMg = toFineGoldPerMilleMg(Math.max(0, state.netKarigarHeldMg), AGREEMENT_CONFIG.demo.issuedPurityPerMille);
            const amounts = calculateRatePolicyAmounts({
                fineGoldMg,
                ratesPaisePerGram: AGREEMENT_CONFIG.demo.simulatedRatesPaisePerGram,
            });
            amount = amounts[policy];
            ratePolicy = policy;
            rateSnapshotPaisePerGram = AGREEMENT_CONFIG.demo.simulatedRatesPaisePerGram[policy];
            agreementId = latestIssue.agreementId;
            agreementVersion = latestIssue.agreementVersion;
            notes = `${notes ?? ''}\nSIMULATED rate snapshot: ${policy} date at ${rateSnapshotPaisePerGram} paise/g; agreement v${agreementVersion}.`.trim();
        }

        const payload = {
            id: `evt-${crypto.randomUUID()}`,
            orderId,
            type,
            weightMg: req.body.weightMg,
            fineWeightMg,
            purityPerMille,
            amount,
            status: 'pending_ack', // Forces dual-party state machine
            createdBy: actorId,
            idempotencyKey: req.body.idempotencyKey,
            notes,
            agreementId,
            agreementVersion,
            ratePolicy,
            rateSnapshotPaisePerGram,
        };
        const result = appendLedgerEvent(payload);
        res.json(result);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// Agent Tool: acknowledgeEvent
app.post('/api/ledger/:eventId/acknowledge', (req, res) => {
    try {
        const actorId = getUserId(req);
        const event = db.prepare('SELECT type, order_id AS orderId FROM ledger_events WHERE id = ?')
            .get(req.params.eventId) as { type: string; orderId: string } | undefined;
        if (!event) throw new Error('Event not found.');
        if (event.type === 'custody_transfer_out' || event.type === 'custody_transfer_in') {
            throw new Error('Custody transfers require separate acknowledgements from both karigars.');
        }
        const carryEvents = db.transaction(() => {
            progressEventStatus(req.params.eventId, actorId, 'acknowledged');
            const carryIds = event.type === 'issue'
                ? db.prepare(`
                    SELECT ledger_event_id AS id FROM dispute_carries
                    WHERE target_order_id = ? AND status = 'pending_ack'
                `).all(event.orderId) as Array<{ id: string }>
                : [];
            return carryIds.map((carry) => carry.id);
        })();
        res.json({ success: true, eventId: req.params.eventId, status: 'acknowledged', carryEvents });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// Agent Tool: generateSettlementProposal
app.get('/api/orders/:id/settlement', (req, res) => {
    try {
        const state = replayAndVerifyOrder(req.params.id);
        const netMg = state.netKarigarHeldMg;
        if (netMg <= 0) throw new Error('No outstanding gold to settle.');

        // Ageing and Dates
        const today = now();
        const dueDate = new Date(today.getTime());
        dueDate.setDate(today.getDate() + 7); // Net 7 terms

        const latestIssue = db.prepare(`
            SELECT agreement_id AS agreementId, agreement_version AS agreementVersion
            FROM ledger_events WHERE order_id = ? AND type = 'issue' AND status = 'acknowledged'
            ORDER BY created_at DESC, rowid DESC LIMIT 1
        `).get(req.params.id) as { agreementId: string | null; agreementVersion: number | null } | undefined;
        let agreementRule = 'No acknowledged wastage agreement was attached to the latest issue.';
        let amountDuePaise = 0;
        let ratePolicy: 'issue' | 'return' | 'settlement' | null = null;
        let rateSnapshotPaisePerGram: number | null = null;
        if (latestIssue?.agreementId && latestIssue.agreementVersion) {
            const agreement = db.prepare(`
                SELECT basis, percent_bps AS percentBps, cash_rate_policy AS cashRatePolicy
                FROM wastage_agreements WHERE id = ? AND version = ?
            `)
                .get(latestIssue.agreementId, latestIssue.agreementVersion) as { basis: string; percentBps: number; cashRatePolicy: string };
            agreementRule = `Agreement v${latestIssue.agreementVersion}: ${(agreement.percentBps / 100).toFixed(2)}% on ${agreement.basis.replaceAll('_', ' ')}.`;
            if (agreement.cashRatePolicy === 'issue' || agreement.cashRatePolicy === 'return' || agreement.cashRatePolicy === 'settlement') {
                ratePolicy = agreement.cashRatePolicy;
                rateSnapshotPaisePerGram = AGREEMENT_CONFIG.demo.simulatedRatesPaisePerGram[ratePolicy];
                const fineGoldMg = toFineGoldPerMilleMg(netMg, AGREEMENT_CONFIG.demo.issuedPurityPerMille);
                amountDuePaise = calculateRatePolicyAmounts({
                    fineGoldMg,
                    ratesPaisePerGram: AGREEMENT_CONFIG.demo.simulatedRatesPaisePerGram,
                })[ratePolicy];
            }
        }
        const amountDueRupees = (amountDuePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const rateRupeesPerGram = rateSnapshotPaisePerGram === null
            ? 'Gold-in-gold'
            : `₹${(rateSnapshotPaisePerGram / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/g (${ratePolicy} date, SIMULATED)`;
        const breakdown =
            `--- SETTLEMENT PROPOSAL ---
Outstanding Gold: ${netMg} mg
Agreed Rate: ${rateRupeesPerGram}
Total Cash Value: ₹${amountDueRupees}
${agreementRule}

Issue Date: ${today.toISOString().split('T')[0]}
Pay By: ${dueDate.toISOString().split('T')[0]}
Ageing: 0 Days (Current)`;

        res.json({ orderId: req.params.id, netMg, amountDue: amountDuePaise, amountDuePaise, ratePolicy, rateSnapshotPaisePerGram, breakdown });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// Voice/Text Parsing Endpoint
app.post('/api/agent/parse', async (req, res) => {
    try {
        const { text } = req.body;
        const draft = await parseUtterance(text);
        res.json(draft);
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/deadline/board', (req, res) => {
    try {
        const actorId = getUserId(req);
        res.json(getDeadlineBoard(actorId, now()));
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/daily-brief', (req, res) => {
    try {
        const language = DailyBriefLanguageSchema.parse(req.query.language ?? 'en');
        const asOf = req.query.asOf === undefined
            ? now()
            : new Date(DailyBriefAsOfSchema.parse(req.query.asOf));
        res.json(getDailyBrief(getUserId(req), language, asOf));
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/daily-brief/tick', (req, res) => {
    try {
        const actorId = getUserId(req);
        const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId) as { role: string } | undefined;
        if (!actor) throw new Error('User not found.');
        if (actor.role !== 'jeweller') throw new Error('Only the jeweller can fast-forward daily brief generation.');
        const request = DailyBriefTickRequestSchema.parse(req.body ?? {});
        const evaluationTime = addHoursToDate(now(), request.fastForwardHours);
        const tick = runDailyBriefTick(evaluationTime);
        res.json({
            ...tick,
            evaluationTime: evaluationTime.toISOString(),
            brief: getDailyBrief(actorId, request.language, evaluationTime),
        });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/deadline/tick', (req, res) => {
    try {
        const actorId = getUserId(req);
        const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId) as { role: string } | undefined;
        if (!actor) throw new Error('User not found.');
        if (actor.role !== 'jeweller') throw new Error('Only the jeweller can run the deadline tick.');
        const request = DeadlineTickRequestSchema.parse(req.body ?? {});
        const tickTime = new Date(now().getTime() + request.fastForwardHours * 3_600_000);
        res.json(runAgentTick(tickTime, actorId));
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/deadline/actions/:actionId/reply', (req, res) => {
    try {
        markNudgeReplied(req.params.actionId, getUserId(req), now());
        res.json({ success: true, status: 'replied' });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/deadline/orders/:orderId/rescue', (req, res) => {
    try {
        const actorId = getUserId(req);
        const request = CustodyTransferRequestSchema.parse(req.body);
        res.json(chooseRescueKarigar(req.params.orderId, request.karigarId, actorId));
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/deadline/custody-transfers/:transferId/acknowledge', (req, res) => {
    try {
        const transfer = acknowledgeCustodyTransfer(req.params.transferId, getUserId(req), now());
        res.json({ success: true, transfer });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/deadline/custody-transfers/:transferId/reject', (req, res) => {
    try {
        const input = GoldHandoffRejectionSchema.parse(req.body);
        const transfer = rejectCustodyTransfer(req.params.transferId, getUserId(req), input.reason, now());
        res.json({ success: true, transfer });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

export default app;