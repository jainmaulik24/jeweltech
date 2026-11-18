/**
 * @fileoverview Core REST API. Endpoints double as AI Agent Tools.
 */
import { parseUtterance } from './agent';
import express from 'express';
import crypto from 'crypto';
import db from './db';
import {
    appendLedgerEvent,
    replayAndVerifyOrder,
    progressEventStatus,
    recordLedgerAcknowledgement,
} from './ledger';
import { loginWithPin } from './auth';
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
    PinLoginSchema,
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
    calculateFairPayPaise,
    calculateIdealReturn,
    calculateRatePolicyAmounts,
    computeAgreementAllowanceMg,
    divideAndRoundInt,
    formatWeightMgAsGrams,
    calculateNetGoldMg,
    calculateSignedGoldValuePaise,
    parseUnitToMg,
    parsePercentToBps,
    parseRupeesToPaise,
    toFineGoldPerMilleMg,
    calculateGoldAtLargeSummary,
    calculateAgeingDays,
    calculateDaysUntil,
    addHoursToDate,
    calculateKarigarSlip,
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
import { KARIGAR_FLOAT_CONFIG } from './karigarFloatConfig';
import { KARIGAR_EXPOSURE_CONFIG } from './karigarExposureConfig';
import {
    completeOwnerIssueApproval,
    createOwnerIssueApproval,
    getCleanReturnCount,
    getKarigarExposureDashboard,
    getKarigarExposureSentence,
    getOwnerIssueApproval,
    getPendingFloatIssueReservationMg,
    getPendingOwnerIssueApprovals,
    getTrustTier,
} from './karigarExposure';
import {
    createFloatSettlementDraft,
    createThresholdSettlementDraft,
    ensureKarigarFloat,
    getPendingFloatSettlementDraft,
    getKarigarFloatForPair,
    listKarigarFloats,
    replayKarigarFloat,
} from './karigarFloats';

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

app.post('/api/auth/pin-login', (req, res) => {
    try {
        const credentials = PinLoginSchema.parse(req.body);
        const user = loginWithPin(credentials.phone, credentials.pin) as {
            id: string;
            role: string;
            name: string;
        };
        res.json({ id: user.id, role: user.role, name: user.name });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

const sampleOrderIds = [
    'ord-handshake-demo',
    DAILY_BRIEF_CONFIG.demo.dueTodayOrderId,
    DAILY_BRIEF_CONFIG.demo.jewellerApprovalOrderId,
    DISPUTE_CONFIG.demo.orderId,
    GOLD_JOURNEY_CONFIG.demo.orderId,
    ...RETURN_RECONCILIATION_CONFIG.demoScenarios.map((scenario) => scenario.orderId),
    ...RETURN_RECONCILIATION_CONFIG.idealReturnScenarios.map((scenario) => scenario.orderId),
    ...GOLD_AT_LARGE_CONFIG.demoJobs.map((scenario) => scenario.orderId),
    ...KARIGAR_FLOAT_CONFIG.demo.draws.map((draw) => draw.orderId),
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
        const targetWeightMg = request.targetWeightMg ?? RETURN_RECONCILIATION_CONFIG.targetWeightMg;
        const toleranceMg = request.toleranceMg ?? RETURN_RECONCILIATION_CONFIG.targetToleranceMg;

        db.prepare(`
            INSERT INTO orders
                (id, jeweller_id, karigar_id, description, due_date, occasion_date, job_type, target_weight_mg, tolerance_mg)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, request.jewellerId, request.karigarId, request.description,
            dueDate, occasionDate, request.jobType, targetWeightMg, toleranceMg,
        );
        res.json({
            id,
            jewellerId: request.jewellerId,
            karigarId: request.karigarId,
            description: request.description,
            status: 'open',
            dueDate,
            occasionDate,
            jobType: request.jobType,
            targetWeightMg,
            toleranceMg,
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
                AND NOT EXISTS (
                    SELECT 1 FROM karigar_floats f WHERE f.ledger_order_id = o.id
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
            labourRatePaisePerGram: req.body.labourRatePaisePerGram
                ?? (req.body.labourRateRupees === undefined
                    ? 0
                    : parseRupeesToPaise(String(req.body.labourRateRupees))),
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
            idealReturnConfig: {
                idealReturnFactorBp: AGREEMENT_CONFIG.idealReturnFactorBp,
                bufferBp: AGREEMENT_CONFIG.bufferBp,
            },
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
            const fairPaySample = activeAgreement.basis === 'ideal_return_buffer'
                ? AGREEMENT_CONFIG.fairPayDemo
                : sample;
            const fairPayAllowanceInput = {
                issuedGrossMg: fairPaySample.issuedGrossMg,
                issuedPurityPerMille: fairPaySample.issuedPurityPerMille,
                finishedWeightMg: fairPaySample.finishedWeightMg,
                percentBps: activeAgreement.percentBps,
                idealReturnConfig: allowanceInput.idealReturnConfig,
            };
            const allowanceMg = computeAgreementAllowanceMg({
                ...fairPayAllowanceInput,
                basis: activeAgreement.basis,
            });
            const retainedGoldMg = activeAgreement.basis === 'ideal_return_buffer'
                ? calculateIdealReturn(fairPaySample.issuedGrossMg, fairPaySample.finishedWeightMg, {
                    idealReturnFactorBp: AGREEMENT_CONFIG.idealReturnFactorBp,
                    bufferBp: AGREEMENT_CONFIG.bufferBp,
                }).retainedGoldMg
                : allowanceMg;
            const fairPayParts = calculateFairPayPaise({
                retainedGoldMg,
                goldPurityPerMille: AGREEMENT_CONFIG.idealReturnPurityPerMille,
                simulatedRatePaisePerGram: sample.simulatedRatesPaisePerGram.settlement,
                pieceCounts: AGREEMENT_CONFIG.fairPayDemo.pieceCounts,
                perPiecePayPaise: AGREEMENT_CONFIG.perPiecePayPaise,
            });
            const effectiveRatePaisePerFinishedGram = divideAndRoundInt(
                fairPayParts.fairPayPaise * 1000,
                fairPaySample.finishedWeightMg,
            );
            fairPay = {
                labourPaisePerFinishedGram: 0,
                allowanceValuePaisePerFinishedGram: divideAndRoundInt(
                    fairPayParts.retainedGoldValuePaise * 1000,
                    fairPaySample.finishedWeightMg,
                ),
                sweepValuePaisePerFinishedGram: divideAndRoundInt(
                    fairPayParts.perPiecePayPaise * 1000,
                    fairPaySample.finishedWeightMg,
                ),
                effectiveRatePaisePerFinishedGram,
                outlier: effectiveRatePaisePerFinishedGram < AGREEMENT_CONFIG.syntheticReferenceRangePaisePerGram.min
                    || effectiveRatePaisePerFinishedGram > AGREEMENT_CONFIG.syntheticReferenceRangePaisePerGram.max,
                retainedGoldMg,
                retainedGoldValuePaise: fairPayParts.retainedGoldValuePaise,
                perPiecePayPaise: fairPayParts.perPiecePayPaise,
                fairPayPaise: fairPayParts.fairPayPaise,
                version: activeAgreement.version,
                syntheticReferenceRangePaisePerGram: AGREEMENT_CONFIG.syntheticReferenceRangePaisePerGram,
                sample: fairPaySample,
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
                idealReturnFactorBp: AGREEMENT_CONFIG.idealReturnFactorBp,
                bufferBp: AGREEMENT_CONFIG.bufferBp,
                perPiecePayPaise: AGREEMENT_CONFIG.perPiecePayPaise,
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
            basis: 'ideal_return_buffer' | 'fine_issued' | 'gross_issued' | 'finished_weight';
            percentBps: number;
            version: number;
        } | undefined;
        if (!agreement) throw new Error('The issue agreement version is unavailable.');

        const scenario = [
            ...RETURN_RECONCILIATION_CONFIG.demoScenarios,
            ...RETURN_RECONCILIATION_CONFIG.idealReturnScenarios,
        ].find((item) => item.orderId === req.params.id) ?? null;
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
                    stoneWeightGrams: formatWeightMgAsGrams(
                        'stoneWeightMg' in lot ? lot.stoneWeightMg ?? 0 : 0,
                    ),
                    otherNonGoldWeightGrams: formatWeightMgAsGrams(
                        'otherNonGoldWeightMg' in lot ? lot.otherNonGoldWeightMg ?? 0 : 0,
                    ),
                })),
                scrapLots: ('scrapLots' in scenario ? scenario.scrapLots ?? [] : []).map((lot) => ({
                    weightGrams: formatWeightMgAsGrams(lot.weightMg),
                    purityPerMille: lot.purityPerMille,
                })),
            } : null,
            configuration: {
                grossWeightToleranceMg: RETURN_RECONCILIATION_CONFIG.grossWeightToleranceMg,
                purityShortfallToleranceFineMg: RETURN_RECONCILIATION_CONFIG.purityShortfallToleranceFineMg,
                unusedAllowancePolicy: RETURN_RECONCILIATION_CONFIG.unusedAllowancePolicy,
                idealReturnFactorBp: AGREEMENT_CONFIG.idealReturnFactorBp,
                bufferBp: AGREEMENT_CONFIG.bufferBp,
                idealReturnPurityPerMille: AGREEMENT_CONFIG.idealReturnPurityPerMille,
                simulatedRatePaisePerGram: AGREEMENT_CONFIG.demo.simulatedRatesPaisePerGram.settlement,
                targetWeightMg: order.target_weight_mg,
                targetToleranceMg: order.tolerance_mg,
                perPiecePayPaise: AGREEMENT_CONFIG.perPiecePayPaise,
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
            basis: 'ideal_return_buffer' | 'fine_issued' | 'gross_issued' | 'finished_weight';
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
            stoneWeightMg: parseUnitToMg(lot.stoneWeightGrams ?? '0', 'g'),
            otherNonGoldWeightMg: parseUnitToMg(lot.otherNonGoldWeightGrams ?? '0', 'g'),
            purityPerMille: toPurityPerMille(lot.purityPerMille),
            method: lot.method,
        }));
        const scrapLots = requestInput.scrapLots.map((lot) => ({
            weightMg: parseUnitToMg(lot.weightGrams, 'g'),
            stoneWeightMg: parseUnitToMg(lot.stoneWeightGrams ?? '0', 'g'),
            otherNonGoldWeightMg: parseUnitToMg(lot.otherNonGoldWeightGrams ?? '0', 'g'),
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
                idealReturnFactorBp: AGREEMENT_CONFIG.idealReturnFactorBp,
                bufferBp: AGREEMENT_CONFIG.bufferBp,
                idealReturnPurityPerMille: AGREEMENT_CONFIG.idealReturnPurityPerMille,
                simulatedRatePaisePerGram: AGREEMENT_CONFIG.demo.simulatedRatesPaisePerGram.settlement,
                targetWeightMg: order.target_weight_mg,
                targetToleranceMg: order.tolerance_mg,
                perPiecePayPaise: AGREEMENT_CONFIG.perPiecePayPaise,
            },
            pieceCounts: requestInput.pieceCounts,
        });

        const agreementRule = agreement.basis === 'ideal_return_buffer'
            ? `Agreement v${agreement.version}: ideal return ${AGREEMENT_CONFIG.idealReturnFactorBp} bp with ${AGREEMENT_CONFIG.bufferBp} bp buffer.`
            : `Agreement v${agreement.version}: ${(agreement.percentBps / 100).toFixed(2)}% on ${agreement.basis.replaceAll('_', ' ')}.`;
        const targetFlagNote = result.targetWeightFlagged
            ? `TARGET WEIGHT FLAG · ${result.targetWeightDeviationMg! < 0 ? 'under' : 'over'} target by ${Math.abs(result.targetWeightDeviationMg!)} mg; price impact ${result.targetWeightPriceImpactPaise! < 0 ? '-' : '+'}${Math.abs(result.targetWeightPriceImpactPaise!)} paise at the SIMULATED rate.`
            : '';
        const eventPrefix = `return-reconcile-${requestInput.idempotencyKey}`;
        const events = db.transaction(() => {
            const postedEvents: any[] = [];
            finishedLots.forEach((lot, index) => {
                const netGoldMg = calculateNetGoldMg(
                    lot.weightMg,
                    lot.stoneWeightMg,
                    lot.otherNonGoldWeightMg,
                );
                postedEvents.push(appendLedgerEvent({
                    id: `evt-${crypto.randomUUID()}`,
                    orderId: req.params.id,
                    type: 'return',
                    weightMg: netGoldMg,
                    fineWeightMg: toFineGoldPerMilleMg(netGoldMg, lot.purityPerMille),
                    purityPerMille: lot.purityPerMille,
                    status: 'pending_ack',
                    createdBy: actorId,
                    notes: [
                        `${lot.method} purity ${lot.purityPerMille}‰ (${RETURN_RECONCILIATION_CONFIG.purityReadLabel})`,
                        `gross ${lot.weightMg} mg; stone ${lot.stoneWeightMg} mg; other non-gold ${lot.otherNonGoldWeightMg} mg; net gold ${netGoldMg} mg`,
                        targetFlagNote,
                    ].filter(Boolean).join('; '),
                    idempotencyKey: `${eventPrefix}-finished-${index}`,
                    agreementId: latestIssue.agreementId,
                    agreementVersion: agreement.version,
                    grossWeightMg: lot.weightMg,
                    stoneWeightMg: lot.stoneWeightMg,
                    otherNonGoldWeightMg: lot.otherNonGoldWeightMg,
                }));
            });
            scrapLots.forEach((lot, index) => {
                const netGoldMg = calculateNetGoldMg(
                    lot.weightMg,
                    lot.stoneWeightMg,
                    lot.otherNonGoldWeightMg,
                );
                postedEvents.push(appendLedgerEvent({
                    id: `evt-${crypto.randomUUID()}`,
                    orderId: req.params.id,
                    type: 'scrap_entry',
                    weightMg: netGoldMg,
                    fineWeightMg: toFineGoldPerMilleMg(netGoldMg, lot.purityPerMille),
                    purityPerMille: lot.purityPerMille,
                    status: 'pending_ack',
                    createdBy: actorId,
                    notes: [
                        `purity ${lot.purityPerMille}‰ (${RETURN_RECONCILIATION_CONFIG.purityReadLabel})`,
                        `gross ${lot.weightMg} mg; stone ${lot.stoneWeightMg} mg; other non-gold ${lot.otherNonGoldWeightMg} mg; net gold ${netGoldMg} mg`,
                        targetFlagNote,
                    ].filter(Boolean).join('; '),
                    idempotencyKey: `${eventPrefix}-scrap-${index}`,
                    agreementId: latestIssue.agreementId,
                    agreementVersion: agreement.version,
                    grossWeightMg: lot.weightMg,
                    stoneWeightMg: lot.stoneWeightMg,
                    otherNonGoldWeightMg: lot.otherNonGoldWeightMg,
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
                    notes: `${result.idealReturnStatus === 'SHORT' ? 'FLAGGED SETTLEMENT DRAFT · SHORT' : 'Settlement draft'} · ${agreementRule}\nKarigar owes ${result.owedFineMg} mg fine gold after allowance; awaiting both parties' approval.`,
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

app.get('/api/notifications/pending', (req, res) => {
    try {
        const actorId = getUserId(req);
        const actor = db.prepare('SELECT id FROM users WHERE id = ?').get(actorId);
        if (!actor) throw new Error('User not found.');
        const events = db.prepare(`
            SELECT e.id, e.order_id AS orderId, o.description, e.type, e.notes,
                e.amount, e.weight_mg AS weightMg, e.created_by AS createdBy,
                e.agreement_version AS agreementVersion, e.created_at AS createdAt
            FROM ledger_events e
            JOIN orders o ON o.id = e.order_id
            WHERE (o.jeweller_id = ? OR o.karigar_id = ?)
                AND e.status = 'pending_ack'
                AND e.type != 'agreement_version'
                AND e.created_by != ?
            ORDER BY e.created_at, e.rowid
        `).all(actorId, actorId, actorId);
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
        let orderId = req.body.orderId as string | undefined;
        let floatId: string | null = null;
        let debitAccount: 'jeweller_vault' | 'karigar_float' | null = null;
        let creditAccount: 'karigar_float' | 'karigar_wip' | null = null;
        let agreementId: string | null = null;
        let agreementVersion: number | null = null;
        let ratePolicy: 'issue' | 'return' | 'settlement' | null = null;
        let rateSnapshotPaisePerGram: number | null = null;
        let amount = req.body.amount ?? 0;
        let notes = req.body.notes || null;
        let purityPerMille: number | null = null;
        let fineWeightMg: number | null = null;
        let eventWeightMg = req.body.weightMg;
        let grossWeightMg: number | null = null;
        let stoneWeightMg: number | null = null;
        let otherNonGoldWeightMg: number | null = null;
        let issueMakerRole: string | null = null;
        let issueJewellerId: string | null = null;
        let issueKarigarId: string | null = null;
        let isBulkFloatIssue = false;

        if (type === 'issue') {
            if (!Number.isInteger(eventWeightMg) || eventWeightMg <= 0) {
                throw new Error('Issue weight must be a positive integer number of milligrams.');
            }
            if (!orderId) {
                const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId) as { role: string } | undefined;
                if (actor?.role !== 'jeweller') throw new Error('Only a jeweller can issue a karigar float.');
                if (typeof req.body.karigarId !== 'string' || !req.body.karigarId) {
                    throw new Error('Select a karigar when issuing gold without an order.');
                }
                issueMakerRole = actor.role;
                issueJewellerId = actorId;
                issueKarigarId = req.body.karigarId;
                isBulkFloatIssue = true;
                if (req.body.purityPerMille !== undefined
                    && req.body.purityPerMille !== KARIGAR_FLOAT_CONFIG.defaultPurityPerMille) {
                    throw new Error('Karigar floats are issued at the configured 24K purity.');
                }
                const float = ensureKarigarFloat(actorId, req.body.karigarId);
                orderId = float.ledgerOrderId;
                floatId = float.id;
                debitAccount = 'jeweller_vault';
                creditAccount = 'karigar_float';
                notes = `${notes ?? ''}\nBulk issue to karigar float.`.trim();
            } else {
                const order = db.prepare('SELECT jeweller_id AS jewellerId, karigar_id AS karigarId FROM orders WHERE id = ?')
                    .get(orderId) as { jewellerId: string; karigarId: string } | undefined;
                if (!order) throw new Error('Order not found.');
                const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId) as { role: string } | undefined;
                if (actor?.role === 'jeweller') {
                    if (order.jewellerId !== actorId) throw new Error('Only the order jeweller can issue gold.');
                } else if (actor?.role === 'staff') {
                    const staff = db.prepare(`
                        SELECT owner_jeweller_id AS ownerJewellerId FROM staff_profiles WHERE user_id = ?
                    `).get(actorId) as { ownerJewellerId: string } | undefined;
                    if (!staff || staff.ownerJewellerId !== order.jewellerId) {
                        throw new Error('Staff can issue only for their configured jeweller owner.');
                    }
                } else {
                    throw new Error('Only a jeweller or their staff can issue gold.');
                }
                issueMakerRole = actor.role;
                issueJewellerId = order.jewellerId;
                issueKarigarId = order.karigarId;
                const float = getKarigarFloatForPair(order.jewellerId, order.karigarId);
                if (float) {
                    if (req.body.purityPerMille !== undefined
                        && req.body.purityPerMille !== KARIGAR_FLOAT_CONFIG.defaultPurityPerMille) {
                        throw new Error('A float draw-down must match the configured 24K purity.');
                    }
                    const balance = replayKarigarFloat(float.id);
                    if (eventWeightMg > balance.availableMg) {
                        throw new Error(`The karigar float has ${balance.availableMg} mg available; the requested draw-down is ${eventWeightMg} mg.`);
                    }
                    floatId = float.id;
                    debitAccount = 'karigar_float';
                    creditAccount = 'karigar_wip';
                    notes = `${notes ?? ''}\nDraw-down from the karigar float.`.trim();
                }
            }
            const agreement = getActiveAgreement(orderId);
            agreementId = agreement?.id ?? null;
            agreementVersion = agreement?.version ?? null;
            purityPerMille = validatePurityPerMille(
                req.body.purityPerMille
                    ?? (floatId ? KARIGAR_FLOAT_CONFIG.defaultPurityPerMille : AGREEMENT_CONFIG.demo.issuedPurityPerMille)
            );
            fineWeightMg = toFineGoldPerMilleMg(req.body.weightMg, purityPerMille);
        }

        if (!orderId) throw new Error('An order is required for this ledger event.');

        if (type === 'return' || type === 'scrap_entry') {
            purityPerMille = validatePurityPerMille(req.body.purityPerMille);
            if (!['touch', 'XRF', 'declared'].includes(req.body.method)) {
                throw new Error('A touch, XRF, or declared purity method is required.');
            }
            const grossWeight = req.body.weightMg as number;
            const stoneWeight = (req.body.stoneWeightMg ?? 0) as number;
            const otherNonGoldWeight = (req.body.otherNonGoldWeightMg ?? 0) as number;
            grossWeightMg = grossWeight;
            stoneWeightMg = stoneWeight;
            otherNonGoldWeightMg = otherNonGoldWeight;
            eventWeightMg = calculateNetGoldMg(grossWeight, stoneWeight, otherNonGoldWeight);
            fineWeightMg = toFineGoldPerMilleMg(eventWeightMg, purityPerMille);
            notes = `${notes ?? ''}\n${req.body.method} purity ${purityPerMille}‰ (${RETURN_RECONCILIATION_CONFIG.purityReadLabel}); gross ${req.body.weightMg} mg, stone ${stoneWeightMg} mg, other non-gold ${otherNonGoldWeightMg} mg, net gold ${eventWeightMg} mg.`.trim();
            if (type === 'return') {
                const order = db.prepare(`
                    SELECT target_weight_mg AS targetWeightMg, tolerance_mg AS toleranceMg
                    FROM orders WHERE id = ?
                `).get(orderId) as { targetWeightMg: number; toleranceMg: number } | undefined;
                if (!order) throw new Error('Order not found.');
                const deviationMg = eventWeightMg - order.targetWeightMg;
                if (Math.abs(deviationMg) > order.toleranceMg) {
                    const impactPaise = calculateSignedGoldValuePaise(
                        deviationMg,
                        AGREEMENT_CONFIG.idealReturnPurityPerMille,
                        AGREEMENT_CONFIG.demo.simulatedRatesPaisePerGram.settlement,
                    );
                    notes += ` RETURN WEIGHT FLAG · ${deviationMg < 0 ? 'under' : 'over'} target by ${Math.abs(deviationMg)} mg; price impact ${impactPaise < 0 ? '-' : '+'}${Math.abs(impactPaise)} paise at the SIMULATED rate.`;
                }
            }
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
            weightMg: eventWeightMg,
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
            floatId,
            debitAccount,
            creditAccount,
            grossWeightMg,
            stoneWeightMg,
            otherNonGoldWeightMg,
        };

        if (type === 'issue' && issueMakerRole && issueJewellerId && issueKarigarId) {
            const approvalReasons: string[] = [];
            if (isBulkFloatIssue && floatId) {
                const tier = getTrustTier(getCleanReturnCount(issueJewellerId, issueKarigarId));
                const balance = replayKarigarFloat(floatId);
                const reservedMg = getPendingFloatIssueReservationMg(floatId);
                if (balance.remainingMg + reservedMg + eventWeightMg > tier.floatLimitMg) {
                    approvalReasons.push(
                        `Requested float would exceed the ${tier.label} trust limit of ${tier.floatLimitMg} mg.`,
                    );
                }
            }
            if (issueMakerRole === 'staff'
                && eventWeightMg >= KARIGAR_EXPOSURE_CONFIG.staffLargeIssueMg) {
                approvalReasons.push('Large staff issues require the jeweller owner to check and approve them.');
            }
            if (approvalReasons.length > 0) {
                const approval = createOwnerIssueApproval({
                    jewellerId: issueJewellerId,
                    karigarId: issueKarigarId,
                    makerId: actorId,
                    orderId,
                    floatId,
                    debitAccount,
                    creditAccount,
                    weightMg: eventWeightMg,
                    reason: approvalReasons.join(' '),
                    idempotencyKey: req.body.idempotencyKey,
                    payload,
                });
                if (approval.status === 'approved' && approval.ledgerEventId) {
                    const event = db.prepare('SELECT * FROM ledger_events WHERE id = ?')
                        .get(approval.ledgerEventId);
                    res.json({ approvalRequired: false, event });
                    return;
                }
                if (approval.status === 'rejected') {
                    throw new Error('This issue request was rejected. Create a new request to try again.');
                }
                res.json({
                    approvalRequired: true,
                    approvalId: approval.id,
                    status: approval.status,
                    reason: approvalReasons.join(' '),
                });
                return;
            }
        }
        const result = appendLedgerEvent(payload);
        res.json(result);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/owner-issue-approvals', (req, res) => {
    try {
        const actorId = getUserId(req);
        const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId) as { role: string } | undefined;
        if (actor?.role !== 'jeweller') throw new Error('Only a jeweller owner can review issue requests.');
        res.json({ approvals: getPendingOwnerIssueApprovals(actorId) });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.post('/api/owner-issue-approvals/:approvalId/approve', (req, res) => {
    try {
        const actorId = getUserId(req);
        const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId) as { role: string } | undefined;
        if (actor?.role !== 'jeweller') throw new Error('Only a jeweller owner can approve issue requests.');
        const approval = getOwnerIssueApproval(req.params.approvalId, actorId);
        if (!approval) throw new Error('Issue approval request not found for this jeweller.');
        if (approval.status === 'approved' && approval.ledgerEventId) {
            const event = db.prepare('SELECT * FROM ledger_events WHERE id = ?').get(approval.ledgerEventId);
            res.json({ success: true, idempotent: true, event });
            return;
        }
        if (approval.status !== 'pending') throw new Error('This issue request is no longer pending.');
        const maker = db.prepare('SELECT role FROM users WHERE id = ?').get(approval.makerId) as { role: string } | undefined;
        if (maker?.role === 'staff') {
            const staff = db.prepare(`
                SELECT owner_jeweller_id AS ownerJewellerId FROM staff_profiles WHERE user_id = ?
            `).get(approval.makerId) as { ownerJewellerId: string } | undefined;
            if (!staff || staff.ownerJewellerId !== actorId || approval.makerId === actorId) {
                throw new Error('Owner approval must be separate from the staff maker.');
            }
        }
        const event = db.transaction(() => {
            const payload = JSON.parse(approval.payloadJson) as Parameters<typeof appendLedgerEvent>[0];
            const created = appendLedgerEvent(payload) as { id: string };
            if (!completeOwnerIssueApproval(approval.id, actorId, 'approved', actorId, created.id)) {
                throw new Error('Issue request was already reviewed.');
            }
            return created;
        })();
        res.json({ success: true, idempotent: false, event });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.post('/api/owner-issue-approvals/:approvalId/reject', (req, res) => {
    try {
        const actorId = getUserId(req);
        const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId) as { role: string } | undefined;
        if (actor?.role !== 'jeweller') throw new Error('Only a jeweller owner can reject issue requests.');
        const approval = getOwnerIssueApproval(req.params.approvalId, actorId);
        if (!approval) throw new Error('Issue approval request not found for this jeweller.');
        if (approval.status !== 'pending') throw new Error('This issue request is no longer pending.');
        if (!completeOwnerIssueApproval(approval.id, actorId, 'rejected', actorId)) {
            throw new Error('Issue request was already reviewed.');
        }
        res.json({ success: true, approvalId: approval.id, status: 'rejected' });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// Agent Tool: acknowledgeEvent
app.post('/api/ledger/:eventId/acknowledge', (req, res) => {
    try {
        const actorId = getUserId(req);
        const event = db.prepare(`
            SELECT type, order_id AS orderId, float_id AS floatId,
                debit_account AS debitAccount, created_by AS createdBy
            FROM ledger_events WHERE id = ?
        `).get(req.params.eventId) as {
            type: string;
            orderId: string;
            floatId: string | null;
            debitAccount: string | null;
            createdBy: string;
        } | undefined;
        if (!event) throw new Error('Event not found.');
        if (event.type === 'custody_transfer_out' || event.type === 'custody_transfer_in') {
            throw new Error('Custody transfers require separate acknowledgements from both karigars.');
        }
        const acknowledgement = db.transaction(() => {
            const changed = progressEventStatus(req.params.eventId, actorId, 'acknowledged');
            const record = recordLedgerAcknowledgement(req.params.eventId, actorId, 'self');
            const carryIds = changed && event.type === 'issue'
                ? db.prepare(`
                    SELECT ledger_event_id AS id FROM dispute_carries
                    WHERE target_order_id = ? AND status = 'pending_ack'
                `).all(event.orderId) as Array<{ id: string }>
                : [];
            const floatSettlementDraft = changed && event.type === 'issue'
                && event.floatId
                && event.debitAccount === 'karigar_float'
                ? createThresholdSettlementDraft(
                    event.floatId,
                    (db.prepare('SELECT jeweller_id AS jewellerId FROM karigar_floats WHERE id = ?')
                        .get(event.floatId) as { jewellerId: string }).jewellerId,
                )
                : null;
            return {
                carryEvents: carryIds.map((carry) => carry.id),
                floatSettlementDraft,
                acknowledgement: record,
                idempotent: !changed,
            };
        })();
        res.json({
            success: true,
            eventId: req.params.eventId,
            status: 'acknowledged',
            ...acknowledgement,
        });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.post('/api/ledger/:eventId/assisted-acknowledge', (req, res) => {
    try {
        const jewellerId = getUserId(req);
        const event = db.prepare(`
            SELECT e.type, e.order_id AS orderId, e.created_by AS createdBy,
                e.float_id AS floatId, e.debit_account AS debitAccount,
                o.jeweller_id AS jewellerId, o.karigar_id AS karigarId
            FROM ledger_events e
            JOIN orders o ON o.id = e.order_id
            WHERE e.id = ?
        `).get(req.params.eventId) as {
            type: string;
            orderId: string;
            createdBy: string;
            floatId: string | null;
            debitAccount: string | null;
            jewellerId: string;
            karigarId: string;
        } | undefined;
        if (!event) throw new Error('Event not found.');
        if (event.jewellerId !== jewellerId) {
            throw new Error('Only this order’s jeweller can assist the karigar.');
        }
        if (event.createdBy !== jewellerId) {
            throw new Error('Only a jeweller-created entry can be acknowledged for the karigar.');
        }
        if (event.type === 'custody_transfer_out' || event.type === 'custody_transfer_in') {
            throw new Error('Custody transfers require separate acknowledgements from both karigars.');
        }
        const acknowledgement = db.transaction(() => {
            const changed = progressEventStatus(req.params.eventId, event.karigarId, 'acknowledged');
            const record = recordLedgerAcknowledgement(
                req.params.eventId,
                event.karigarId,
                'assisted',
                jewellerId,
            );
            const carryIds = changed && event.type === 'issue'
                ? db.prepare(`
                    SELECT ledger_event_id AS id FROM dispute_carries
                    WHERE target_order_id = ? AND status = 'pending_ack'
                `).all(event.orderId) as Array<{ id: string }>
                : [];
            const floatSettlementDraft = changed && event.type === 'issue'
                && event.floatId
                && event.debitAccount === 'karigar_float'
                ? createThresholdSettlementDraft(event.floatId, jewellerId)
                : null;
            return {
                acknowledgement: record,
                idempotent: !changed,
                carryEvents: carryIds.map((carry) => carry.id),
                floatSettlementDraft,
            };
        })();
        res.json({
            success: true,
            eventId: req.params.eventId,
            status: 'acknowledged',
            ...acknowledgement,
        });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/karigar-floats', (req, res) => {
    try {
        const actorId = getUserId(req);
        const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId) as { role: string } | undefined;
        if (actor?.role !== 'jeweller') throw new Error('Only a jeweller can manage karigar floats.');
        const exposureDashboard = getKarigarExposureDashboard(actorId);
        const exposureByKarigar = new Map(
            exposureDashboard.karigars.map((entry) => [entry.karigarId, entry]),
        );
        const karigars = db.prepare(`
            SELECT u.id AS karigarId, u.name AS karigarName, f.id AS floatId,
                EXISTS (
                    SELECT 1 FROM orders o
                    WHERE o.jeweller_id = ? AND o.karigar_id = u.id
                ) AS hasPair
            FROM users u
            LEFT JOIN karigar_floats f ON f.karigar_id = u.id AND f.jeweller_id = ?
            WHERE u.role = 'karigar'
            ORDER BY u.name, u.id
        `).all(actorId, actorId) as Array<{
            karigarId: string;
            karigarName: string;
            floatId: string | null;
            hasPair: number;
        }>;
        res.json({
            karigars: karigars.map((karigar) => ({
                ...karigar,
                hasPair: Boolean(karigar.hasPair || karigar.floatId),
                exposure: exposureByKarigar.get(karigar.karigarId) ?? null,
                ...(karigar.floatId ? {
                    ...replayKarigarFloat(karigar.floatId),
                    pendingSettlementDraft: getPendingFloatSettlementDraft(karigar.floatId),
                } : {
                    remainingMg: 0,
                    availableMg: 0,
                    pendingDrawdownMg: 0,
                    targetMg: KARIGAR_FLOAT_CONFIG.targetFloatMg,
                    settlementThresholdMg: KARIGAR_FLOAT_CONFIG.settlementThresholdMg,
                    pendingSettlementDraft: null,
                }),
            })),
            configuration: {
                targetFloatMg: KARIGAR_FLOAT_CONFIG.targetFloatMg,
                settlementThresholdMg: KARIGAR_FLOAT_CONFIG.settlementThresholdMg,
                defaultPurityPerMille: KARIGAR_FLOAT_CONFIG.defaultPurityPerMille,
                trustTiers: KARIGAR_EXPOSURE_CONFIG.trustTiers,
                staffLargeIssueMg: KARIGAR_EXPOSURE_CONFIG.staffLargeIssueMg,
            },
            pendingOwnerApprovals: getPendingOwnerIssueApprovals(actorId),
            syntheticReplay: exposureDashboard.syntheticReplay,
        });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/karigar-exposure', (req, res) => {
    try {
        const actorId = getUserId(req);
        const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId) as { role: string } | undefined;
        if (actor?.role !== 'jeweller') throw new Error('Only a jeweller owner can view exposure signals.');
        res.json(getKarigarExposureDashboard(actorId));
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.post('/api/karigar-floats/:floatId/settlement-drafts', (req, res) => {
    try {
        const draft = createFloatSettlementDraft(req.params.floatId, getUserId(req));
        res.json(draft);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.get('/api/karigar/home', (req, res) => {
    try {
        const actorId = getUserId(req);
        const actor = db.prepare('SELECT id, name, role FROM users WHERE id = ?')
            .get(actorId) as { id: string; name: string; role: string } | undefined;
        if (!actor) throw new Error('User not found.');
        let karigarId: string;
        let jewellerId: string | null = null;
        let karigar: { id: string; name: string };
        if (actor.role === 'karigar') {
            const requestedKarigarId = typeof req.query.karigarId === 'string'
                ? req.query.karigarId
                : actor.id;
            if (requestedKarigarId !== actor.id) {
                throw new Error('A karigar can only view his own home data.');
            }
            karigarId = actor.id;
            karigar = { id: actor.id, name: actor.name };
        } else if (actor.role === 'jeweller') {
            const requestedKarigarId = typeof req.query.karigarId === 'string'
                ? req.query.karigarId
                : '';
            if (!requestedKarigarId) throw new Error('Choose a karigar to open his slip.');
            const target = db.prepare(`
                SELECT id, name FROM users WHERE id = ? AND role = 'karigar'
            `).get(requestedKarigarId) as { id: string; name: string } | undefined;
            if (!target) throw new Error('Karigar not found.');
            const hasPair = db.prepare(`
                SELECT 1 FROM orders WHERE jeweller_id = ? AND karigar_id = ?
                UNION
                SELECT 1 FROM karigar_floats WHERE jeweller_id = ? AND karigar_id = ?
                LIMIT 1
            `).get(actor.id, target.id, actor.id, target.id);
            if (!hasPair) throw new Error('You do not have a job or float with this karigar.');
            karigarId = target.id;
            jewellerId = actor.id;
            karigar = target;
        } else {
            throw new Error('Only a karigar or his jeweller can view slip data.');
        }
        const asOf = now();
        const exposure = getKarigarExposureSentence(karigarId, asOf, jewellerId ?? undefined);
        const floats = listKarigarFloats(karigarId, jewellerId ?? undefined);
        const orderRows = db.prepare(`
            SELECT o.id, o.jeweller_id AS jewellerId, j.name AS jewellerName,
                o.description, o.due_date AS dueDate
            FROM orders o
            JOIN users j ON j.id = o.jeweller_id
            WHERE o.karigar_id = ? AND o.status = 'open'
                AND (? IS NULL OR o.jeweller_id = ?)
                AND NOT EXISTS (SELECT 1 FROM karigar_floats f WHERE f.ledger_order_id = o.id)
            ORDER BY o.due_date, o.id
        `).all(karigarId, jewellerId, jewellerId) as Array<{
            id: string;
            jewellerId: string;
            jewellerName: string;
            description: string | null;
            dueDate: string;
        }>;
        const openJobs = orderRows.map((order) => {
            const replay = replayAndVerifyOrder(order.id, asOf);
            if (!replay.isValidChain) throw new Error(`Ledger replay failed verification for ${order.id}.`);
            return {
                ...order,
                description: order.description ?? 'Gold work',
                goldInWorkMg: replay.accountBalances.karigar_wip.grossMg,
                dueInDays: calculateDaysUntil(order.dueDate, asOf),
            };
        });
        const pendingAcknowledgements = db.prepare(`
            SELECT e.id, e.order_id AS orderId, o.description, e.type, e.notes,
                e.amount, e.weight_mg AS weightMg, e.created_by AS createdBy,
                e.float_id AS floatId, e.created_at AS createdAt
            FROM ledger_events e
            JOIN orders o ON o.id = e.order_id
            WHERE o.karigar_id = ? AND e.status = 'pending_ack'
                AND e.type != 'agreement_version'
                AND (? IS NULL OR o.jeweller_id = ?)
                AND ((? = 'karigar' AND e.created_by != ?)
                    OR (? = 'jeweller' AND e.created_by = ?))
            ORDER BY e.created_at, e.rowid
        `).all(
            karigarId,
            jewellerId,
            jewellerId,
            actor.role,
            karigarId,
            actor.role,
            jewellerId,
        ) as Array<{
            id: string;
            orderId: string;
            description: string | null;
            type: string;
            notes: string | null;
            amount: number;
            weightMg: number;
            createdBy: string;
            floatId: string | null;
            createdAt: string;
        }>;
        const goldAmountsOwed: Array<{
            id: string;
            orderId: string;
            amountMg: number;
            daysWaiting: number;
        }> = [];
        const slips = openJobs.map((job) => {
            const eventRows = db.prepare(`
                SELECT id, type, status, notes, amount,
                    weight_mg AS weightMg, created_by AS createdBy,
                    gross_weight_mg AS grossWeightMg,
                    stone_weight_mg AS stoneWeightMg,
                    other_non_gold_weight_mg AS otherNonGoldWeightMg,
                    agreement_id AS agreementId, agreement_version AS agreementVersion,
                    created_at AS createdAt
                FROM ledger_events
                WHERE order_id = ?
                ORDER BY created_at, rowid
            `).all(job.id) as Array<{
                id: string;
                type: string;
                status: string;
                notes: string | null;
                amount: number;
                weightMg: number;
                createdBy: string;
                grossWeightMg: number | null;
                stoneWeightMg: number | null;
                otherNonGoldWeightMg: number | null;
                agreementId: string | null;
                agreementVersion: number | null;
                createdAt: string;
            }>;
            const acknowledged = eventRows.filter((event) => event.status === 'acknowledged');
            const issues = acknowledged.filter((event) => event.type === 'issue');
            const initialIssue = issues[0]?.weightMg ?? 0;
            const givenAgainMg = issues.slice(1).reduce((total, event) => total + event.weightMg, 0);
            const returnedRows = acknowledged.filter((event) =>
                event.type === 'return' || event.type === 'scrap_entry');
            const noteWeight = (notes: string | null, expression: RegExp): number | null => {
                const match = notes?.match(expression);
                return match ? Number(match[1]) : null;
            };
            const stoneMg = returnedRows.reduce((total, event) =>
                total + (event.stoneWeightMg ?? noteWeight(event.notes, /stone\s+(\d+)\s+mg/i) ?? 0), 0);
            const otherNonGoldMg = returnedRows.reduce((total, event) =>
                total + (event.otherNonGoldWeightMg
                    ?? noteWeight(event.notes, /other non-gold\s+(\d+)\s+mg/i)
                    ?? 0), 0);
            const grossReturnedMg = returnedRows.reduce((total, event) =>
                total + (event.grossWeightMg
                    ?? noteWeight(event.notes, /gross\s+(\d+)\s+mg/i)
                    ?? event.weightMg), 0);
            const processLossMg = acknowledged
                .filter((event) => event.type === 'process_loss')
                .reduce((total, event) => total + event.weightMg, 0);
            const wastageMg = processLossMg > 0
                ? Math.max(0, processLossMg - stoneMg - otherNonGoldMg)
                : returnedRows.length > 0
                    ? Math.max(0, initialIssue - grossReturnedMg)
                    : 0;
            const slip = calculateKarigarSlip({
                issuedMg: initialIssue,
                wastageMg,
                stoneMg,
                givenAgainMg,
            });
            const physicalReturns = eventRows.filter((event) =>
                event.type === 'return' || event.type === 'scrap_entry');
            const acknowledgedReturns = acknowledged.filter((event) =>
                event.type === 'return' || event.type === 'scrap_entry');
            const latestIssue = issues[issues.length - 1];
            if (physicalReturns.length > 0
                && physicalReturns.length === acknowledgedReturns.length
                && latestIssue?.agreementId
                && latestIssue.agreementVersion) {
                const agreement = db.prepare(`
                    SELECT basis FROM wastage_agreements
                    WHERE id = ? AND version = ?
                `).get(latestIssue.agreementId, latestIssue.agreementVersion) as { basis: string } | undefined;
                if (agreement?.basis === 'ideal_return_buffer') {
                    const idealReturn = calculateIdealReturn(
                        issues.reduce((total, event) => total + event.weightMg, 0),
                        acknowledgedReturns.reduce((total, event) => total + event.weightMg, 0),
                        {
                            idealReturnFactorBp: AGREEMENT_CONFIG.idealReturnFactorBp,
                            bufferBp: AGREEMENT_CONFIG.bufferBp,
                        },
                    );
                    if (idealReturn.status === 'WITHIN_BUFFER' && idealReturn.retainedGoldMg > 0) {
                        const lastReturn = acknowledgedReturns[acknowledgedReturns.length - 1];
                        goldAmountsOwed.push({
                            id: `gold-wage-${job.id}`,
                            orderId: job.id,
                            amountMg: idealReturn.retainedGoldMg,
                            daysWaiting: calculateAgeingDays(lastReturn.createdAt, asOf),
                        });
                    }
                }
            }
            const pendingEvent = pendingAcknowledgements.find((event) => event.orderId === job.id);
            const latestDisputableEvent = [...eventRows].reverse().find((event) =>
                (event.status === 'acknowledged' || event.status === 'pending_ack')
                && (event.weightMg !== 0 || event.amount !== 0));
            const activeDispute = latestDisputableEvent
                ? db.prepare(`
                    SELECT id FROM disputes
                    WHERE event_id = ? AND status IN ('unresolved', 'escalated', 'pending_ack')
                `).get(latestDisputableEvent.id)
                : null;
            const disputeEventId = activeDispute ? null : latestDisputableEvent?.id ?? null;
            const lastAssistedAcknowledgement = db.prepare(`
                SELECT a.event_id AS eventId, a.assisted_by AS assistedBy,
                    u.name AS assistedByName, a.created_at AS createdAt
                FROM ledger_acknowledgements a
                JOIN ledger_events e ON e.id = a.event_id
                JOIN users u ON u.id = a.assisted_by
                WHERE e.order_id = ? AND a.mode = 'assisted'
                ORDER BY a.created_at DESC, a.rowid DESC LIMIT 1
            `).get(job.id) ?? null;
            return {
                orderId: job.id,
                description: job.description,
                jewellerId: job.jewellerId,
                jewellerName: job.jewellerName,
                ...slip,
                pendingAcknowledgementEventId: pendingEvent?.id ?? null,
                disputeEventId,
                lastAssistedAcknowledgement,
            };
        });
        const dueRows = db.prepare(`
            SELECT d.id, d.order_id AS orderId, d.jeweller_id AS jewellerId,
                j.name AS jewellerName, d.amount_paise AS amountPaise,
                d.pay_by_date AS payByDate, d.created_at AS createdAt
            FROM cash_dues d
            JOIN users j ON j.id = d.jeweller_id
            WHERE d.karigar_id = ? AND d.status = 'open'
                AND (? IS NULL OR d.jeweller_id = ?)
            ORDER BY d.created_at, d.id
        `).all(karigarId, jewellerId, jewellerId) as Array<{
            id: string;
            orderId: string;
            jewellerId: string;
            jewellerName: string;
            amountPaise: number;
            payByDate: string;
            createdAt: string;
        }>;
        const amountsOwed = dueRows.map((due) => ({
            ...due,
            daysWaiting: calculateAgeingDays(due.createdAt, asOf),
            overdueDays: Math.max(0, calculateAgeingDays(due.payByDate, asOf)),
        }));
        res.json({
            actor,
            karigar,
            asOf: asOf.toISOString(),
            floatRemainingMg: floats.reduce((total, float) => total + float.remainingMg, 0),
            floats,
            openJobs,
            slips,
            amountsOwed,
            goldAmountsOwed,
            pendingAcknowledgements,
            exposureLevel: exposure.level,
            exposureSignal: exposure.signal,
            exposureSentence: exposure.sentence,
        });
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