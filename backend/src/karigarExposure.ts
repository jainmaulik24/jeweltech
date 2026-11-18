import crypto from 'crypto';
import db from './db';
import { now } from './clock';
import {
    calculateAgeingDays,
    calculateDaysUntil,
    calculateGoldValuePaise,
    calculateSignedGoldValuePaise,
    divideAndRoundInt,
    toFineGoldPerMilleMg,
} from './calc';
import { replayAndVerifyOrder } from './ledger';
import { getRate } from './rateService';
import { KARIGAR_EXPOSURE_CONFIG, type ExposureSignalCode } from './karigarExposureConfig';
import { listKarigarFloats, replayKarigarFloat } from './karigarFloats';

export interface ExposureMetrics {
    floatMg: number;
    exposureMg: number;
    trailingIssueMg: number;
    trailingWindowDays: number;
    oldestGoldAgeDays: number;
    missedReturnPromises: number;
    portfolioExposureMg: number;
    purityShortfallCount: number;
    recentLossBps: number | null;
    historicalLossBps: number | null;
    peerLossBps?: number | null;
}

export interface ExposureSignal {
    code: ExposureSignalCode;
    severity: 0 | 1 | 2;
    weight: number;
    contribution: number;
    reason: string | null;
}

export interface KarigarExposureAssessment {
    level: 'steady' | 'watch' | 'high';
    score: number;
    signals: ExposureSignal[];
    reasons: string[];
    recommendedActions: Array<{ code: string; label: string }>;
}

interface PairExposure {
    jewellerId: string;
    karigarId: string;
    karigarName: string;
    floatMg: number;
    exposureMg: number;
    fineMg: number;
    exposurePaise: number;
    cleanReturnCount: number;
    metrics: Omit<ExposureMetrics, 'portfolioExposureMg'>;
}

interface CompletedOrderLoss {
    lossBps: number;
    completedAt: string;
    clean: boolean;
}

const DAY_MS = 86_400_000;

function parseLedgerTimestamp(value: string): Date {
    const normalized = value.includes(' ') ? value.replace(' ', 'T') : value;
    return new Date(/(Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`);
}

function integerRatioCeiling(numerator: number, denominator: number): number {
    if (!Number.isSafeInteger(numerator) || numerator < 0
        || !Number.isSafeInteger(denominator) || denominator <= 0) {
        throw new Error('Exposure ratios require safe non-negative integers.');
    }
    const n = BigInt(numerator);
    const d = BigInt(denominator);
    return Number((n + d - 1n) / d);
}

function signalSeverity(value: number, watch: number, high: number): 0 | 1 | 2 {
    if (value >= high) return 2;
    if (value >= watch) return 1;
    return 0;
}

function formatBpsAsPercent(bps: number): string {
    const absolute = Math.abs(bps);
    const sign = bps < 0 ? '-' : '';
    return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}%`;
}

export function getTrustTier(cleanReturnCount: number) {
    if (!Number.isSafeInteger(cleanReturnCount) || cleanReturnCount < 0) {
        throw new Error('Clean return count must be a non-negative integer.');
    }
    const tier = [...KARIGAR_EXPOSURE_CONFIG.trustTiers]
        .reverse()
        .find((candidate) => cleanReturnCount >= candidate.minCleanReturns);
    if (!tier) throw new Error('The trust ladder must define a starting tier.');
    return tier;
}

export function evaluateKarigarExposure(
    metrics: ExposureMetrics,
    config = KARIGAR_EXPOSURE_CONFIG,
): KarigarExposureAssessment {
    const numericMetrics = [
        metrics.floatMg,
        metrics.exposureMg,
        metrics.trailingIssueMg,
        metrics.trailingWindowDays,
        metrics.oldestGoldAgeDays,
        metrics.missedReturnPromises,
        metrics.portfolioExposureMg,
        metrics.purityShortfallCount,
    ];
    if (numericMetrics.some((value) => !Number.isSafeInteger(value) || value < 0)) {
        throw new Error('Exposure metrics must be safe non-negative integers.');
    }

    const drawCoverageDays = metrics.floatMg > 0
        && metrics.trailingIssueMg > 0
        && metrics.trailingWindowDays > 0
        ? integerRatioCeiling(
            metrics.floatMg * metrics.trailingWindowDays,
            metrics.trailingIssueMg,
        )
        : 0;
    const concentrationBps = metrics.portfolioExposureMg > 0
        ? divideAndRoundInt(metrics.exposureMg * 10_000, metrics.portfolioExposureMg)
        : 0;
    const lossDeltaBps = metrics.recentLossBps !== null && metrics.historicalLossBps !== null
        ? metrics.recentLossBps - metrics.historicalLossBps
        : null;
    const peerLossDeltaBps = metrics.peerLossBps !== null
        && metrics.peerLossBps !== undefined
        && metrics.recentLossBps !== null
        ? metrics.recentLossBps - metrics.peerLossBps
        : null;

    const signalSpecs: Array<{
        code: ExposureSignalCode;
        severity: 0 | 1 | 2;
        reason: string | null;
    }> = [
        {
            code: 'draw_rate',
            severity: signalSeverity(
                drawCoverageDays,
                config.thresholds.drawCoverageWatchDays,
                config.thresholds.drawCoverageHighDays,
            ),
            reason: `The float covers about ${drawCoverageDays} days at his recent issue pace.`,
        },
        {
            code: 'gold_age',
            severity: signalSeverity(
                metrics.oldestGoldAgeDays,
                config.thresholds.goldAgeWatchDays,
                config.thresholds.goldAgeHighDays,
            ),
            reason: `Some gold has been with him for ${metrics.oldestGoldAgeDays} days.`,
        },
        {
            code: 'missed_promises',
            severity: signalSeverity(
                metrics.missedReturnPromises,
                config.thresholds.missedPromisesWatch,
                config.thresholds.missedPromisesHigh,
            ),
            reason: `${metrics.missedReturnPromises} open job${metrics.missedReturnPromises === 1 ? ' is' : 's are'} past the promised return date.`,
        },
        {
            code: 'concentration',
            severity: signalSeverity(
                concentrationBps,
                config.thresholds.concentrationWatchBps,
                config.thresholds.concentrationHighBps,
            ),
            reason: `${formatBpsAsPercent(concentrationBps)} of this shop's outstanding gold is with this karigar.`,
        },
        {
            code: 'purity_shortfall',
            severity: signalSeverity(
                metrics.purityShortfallCount,
                config.thresholds.purityShortfallWatchCount,
                config.thresholds.purityShortfallHighCount,
            ),
            reason: `${metrics.purityShortfallCount} return${metrics.purityShortfallCount === 1 ? ' is' : 's are'} below the configured purity reading.`,
        },
        {
            code: 'loss_history',
            severity: lossDeltaBps === null
                ? 0
                : signalSeverity(
                    lossDeltaBps,
                    config.thresholds.ownLossWatchDeltaBps,
                    config.thresholds.ownLossHighDeltaBps,
                ),
            reason: lossDeltaBps === null
                ? null
                : `Recent gold loss is ${formatBpsAsPercent(lossDeltaBps)} above his earlier average.`,
        },
        {
            code: 'peer_comparison',
            severity: !config.peerComparisonEnabled || peerLossDeltaBps === null
                ? 0
                : signalSeverity(
                    peerLossDeltaBps,
                    config.thresholds.peerLossWatchDeltaBps,
                    config.thresholds.peerLossHighDeltaBps,
                ),
            reason: !config.peerComparisonEnabled || peerLossDeltaBps === null
                ? null
                : `Recent gold loss is ${formatBpsAsPercent(peerLossDeltaBps)} above the configured peer reference.`,
        },
    ];

    const signals = signalSpecs.map((signal) => {
        const weight = config.weights[signal.code];
        const contribution = divideAndRoundInt(weight * signal.severity, 2);
        return {
            ...signal,
            weight,
            contribution,
        };
    });
    const score = signals.reduce((total, signal) => total + signal.contribution, 0);
    const level = score >= config.riskLevels.highScore
        ? 'high'
        : score >= config.riskLevels.watchScore
            ? 'watch'
            : 'steady';
    const recommendations = level === 'high'
        ? config.recommendations.high
        : level === 'watch'
            ? config.recommendations.watch
            : [];
    return {
        level,
        score,
        signals,
        reasons: signals.flatMap((signal) =>
            signal.severity > 0 && signal.reason ? [signal.reason] : []),
        recommendedActions: recommendations.map((action) => ({ ...action })),
    };
}

function getCompletedLossHistory(jewellerId: string, karigarId: string, asOf: Date) {
    const orderRows = db.prepare(`
        SELECT id, due_date AS dueDate FROM orders
        WHERE jeweller_id = ? AND karigar_id = ?
            AND NOT EXISTS (SELECT 1 FROM karigar_floats f WHERE f.ledger_order_id = orders.id)
    `).all(jewellerId, karigarId) as Array<{ id: string; dueDate: string }>;
    const results: CompletedOrderLoss[] = [];
    for (const order of orderRows) {
        const replay = replayAndVerifyOrder(order.id, asOf);
        if (!replay.isValidChain) throw new Error(`Ledger replay failed verification for ${order.id}.`);
        const events = db.prepare(`
            SELECT type, status, weight_mg AS weightMg, fine_weight_mg AS fineWeightMg,
                purity_per_mille AS purityPerMille, created_at AS createdAt
            FROM ledger_events WHERE order_id = ? ORDER BY created_at, rowid
        `).all(order.id) as Array<{
            type: string;
            status: string;
            weightMg: number;
            fineWeightMg: number | null;
            purityPerMille: number | null;
            createdAt: string;
        }>;
        const acknowledged = events.filter((event) => event.status === 'acknowledged');
        const issues = acknowledged.filter((event) => event.type === 'issue');
        const returns = acknowledged.filter((event) => event.type === 'return' || event.type === 'scrap_entry');
        if (issues.length === 0 || returns.length === 0
            || replay.accountBalances.karigar_wip.grossMg !== 0) continue;

        const issuedFineMg = issues.reduce((total, event) =>
            total + (event.fineWeightMg
                ?? toFineGoldPerMilleMg(event.weightMg, event.purityPerMille ?? 999)), 0);
        if (issuedFineMg <= 0) continue;
        const returnedFineMg = returns.reduce((total, event) =>
            total + (event.fineWeightMg
                ?? toFineGoldPerMilleMg(event.weightMg, event.purityPerMille ?? 999)), 0);
        const lossBps = divideAndRoundInt(
            Math.max(0, issuedFineMg - returnedFineMg) * 10_000,
            issuedFineMg,
        );
        const completedAt = returns[returns.length - 1].createdAt;
        const activeDispute = db.prepare(`
            SELECT 1 FROM disputes d JOIN ledger_events e ON e.id = d.event_id
            WHERE e.order_id = ? AND d.status IN ('unresolved', 'escalated', 'pending_ack')
            LIMIT 1
        `).get(order.id);
        const onTime = calculateDaysUntil(order.dueDate, parseLedgerTimestamp(completedAt)) >= 0;
        const clean = returns.every((event) =>
            (event.purityPerMille ?? 0) >= KARIGAR_EXPOSURE_CONFIG.expectedReturnPurityPerMille)
            && onTime
            && !activeDispute
            && lossBps <= KARIGAR_EXPOSURE_CONFIG.thresholds.cleanLossMaxBps;
        results.push({ lossBps, completedAt, clean });
    }
    return results;
}

function readPairExposure(jewellerId: string, karigarId: string, asOf: Date): PairExposure {
    const karigar = db.prepare(`
        SELECT name AS karigarName FROM users WHERE id = ? AND role = 'karigar'
    `).get(karigarId) as { karigarName: string } | undefined;
    if (!karigar) throw new Error('Karigar not found.');
    const floats = listKarigarFloats(karigarId, jewellerId);
    const floatMg = floats.reduce((total, item) => total + item.remainingMg, 0);
    let exposureMg = floatMg;
    let fineMg = floats.reduce((total, item) => total + item.fineMg, 0);
    let oldestGoldAgeDays = 0;
    let missedReturnPromises = 0;

    for (const balance of floats) {
        if (balance.remainingMg <= 0) continue;
        const oldest = db.prepare(`
            SELECT MIN(created_at) AS createdAt FROM ledger_events
            WHERE order_id = ? AND type = 'issue' AND status = 'acknowledged'
        `).get(balance.ledgerOrderId) as { createdAt: string | null };
        if (oldest.createdAt) {
            oldestGoldAgeDays = Math.max(oldestGoldAgeDays, calculateAgeingDays(oldest.createdAt, asOf));
        }
    }

    const orders = db.prepare(`
        SELECT id, due_date AS dueDate, status FROM orders
        WHERE jeweller_id = ? AND karigar_id = ?
            AND NOT EXISTS (SELECT 1 FROM karigar_floats f WHERE f.ledger_order_id = orders.id)
    `).all(jewellerId, karigarId) as Array<{ id: string; dueDate: string; status: string }>;
    for (const order of orders) {
        const replay = replayAndVerifyOrder(order.id, asOf);
        if (!replay.isValidChain) throw new Error(`Ledger replay failed verification for ${order.id}.`);
        const workBalance = replay.accountBalances.karigar_wip;
        if (workBalance.grossMg <= 0) continue;
        exposureMg += workBalance.grossMg;
        fineMg += workBalance.fineMg;
        const issue = db.prepare(`
            SELECT MIN(created_at) AS createdAt FROM ledger_events
            WHERE order_id = ? AND type = 'issue' AND status = 'acknowledged'
        `).get(order.id) as { createdAt: string | null };
        if (issue.createdAt) {
            oldestGoldAgeDays = Math.max(oldestGoldAgeDays, calculateAgeingDays(issue.createdAt, asOf));
        }
        if (order.status === 'open' && calculateDaysUntil(order.dueDate, asOf) < 0) {
            missedReturnPromises += 1;
        }
    }

    const windowStart = new Date(asOf.getTime() - KARIGAR_EXPOSURE_CONFIG.drawRateWindowDays * DAY_MS);
    const trailing = db.prepare(`
        SELECT COALESCE(SUM(weight_mg), 0) AS issueMg
        FROM ledger_events e JOIN orders o ON o.id = e.order_id
        WHERE o.jeweller_id = ? AND o.karigar_id = ?
            AND e.type = 'issue' AND e.status = 'acknowledged'
            AND e.debit_account = 'jeweller_vault'
            AND e.created_at >= ?
    `).get(
        jewellerId,
        karigarId,
        windowStart.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
    ) as { issueMg: number };
    const firstIssue = db.prepare(`
        SELECT MIN(e.created_at) AS createdAt
        FROM ledger_events e JOIN orders o ON o.id = e.order_id
        WHERE o.jeweller_id = ? AND o.karigar_id = ?
            AND e.type = 'issue' AND e.status = 'acknowledged'
    `).get(jewellerId, karigarId) as { createdAt: string | null };
    const trailingWindowDays = firstIssue.createdAt
        ? Math.min(
            KARIGAR_EXPOSURE_CONFIG.drawRateWindowDays,
            Math.max(1, calculateAgeingDays(firstIssue.createdAt, asOf)),
        )
        : 0;

    const purityCutoff = new Date(
        asOf.getTime() - KARIGAR_EXPOSURE_CONFIG.thresholds.purityShortfallDays * DAY_MS,
    ).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const purityShortfallCount = (db.prepare(`
        SELECT COUNT(*) AS count FROM ledger_events e
        JOIN orders o ON o.id = e.order_id
        WHERE o.jeweller_id = ? AND o.karigar_id = ?
            AND e.type = 'return' AND e.status = 'acknowledged'
            AND e.purity_per_mille < ?
            AND e.created_at >= ?
    `).get(
        jewellerId,
        karigarId,
        KARIGAR_EXPOSURE_CONFIG.expectedReturnPurityPerMille,
        purityCutoff,
    ) as { count: number }).count;

    const lossHistory = getCompletedLossHistory(jewellerId, karigarId, asOf);
    const recentCutoff = asOf.getTime() - KARIGAR_EXPOSURE_CONFIG.thresholds.recentLossDays * DAY_MS;
    const historyCutoff = asOf.getTime() - KARIGAR_EXPOSURE_CONFIG.thresholds.historyLossDays * DAY_MS;
    const recentLosses = lossHistory.filter((item) => parseLedgerTimestamp(item.completedAt).getTime() >= recentCutoff);
    const historicalLosses = lossHistory.filter((item) => {
        const completed = parseLedgerTimestamp(item.completedAt).getTime();
        return completed < recentCutoff && completed >= historyCutoff;
    });
    const average = (items: CompletedOrderLoss[]) => items.length > 0
        ? divideAndRoundInt(items.reduce((total, item) => total + item.lossBps, 0), items.length)
        : null;
    const recentLossBps = average(recentLosses);
    const historicalLossBps = average(historicalLosses);
    const cleanReturnCount = lossHistory.filter((item) => item.clean).length;
    const currentRate = getRate(asOf, 999).rate24KPaisePerGram;

    return {
        jewellerId,
        karigarId,
        karigarName: karigar.karigarName,
        floatMg,
        exposureMg,
        fineMg,
        exposurePaise: calculateGoldValuePaise(fineMg, currentRate),
        cleanReturnCount,
        metrics: {
            floatMg,
            exposureMg,
            trailingIssueMg: trailing.issueMg,
            trailingWindowDays,
            oldestGoldAgeDays,
            missedReturnPromises,
            purityShortfallCount,
            recentLossBps,
            historicalLossBps,
        },
    };
}

export function getKarigarExposureDashboard(jewellerId: string, asOf: Date = now()) {
    const jeweller = db.prepare(`
        SELECT id FROM users WHERE id = ? AND role = 'jeweller'
    `).get(jewellerId);
    if (!jeweller) throw new Error('Only a jeweller owner can view exposure signals.');

    const karigars = db.prepare(`
        SELECT DISTINCT u.id AS karigarId
        FROM users u
        LEFT JOIN orders o ON o.karigar_id = u.id AND o.jeweller_id = ?
        LEFT JOIN karigar_floats f ON f.karigar_id = u.id AND f.jeweller_id = ?
        WHERE u.role = 'karigar' AND (o.id IS NOT NULL OR f.id IS NOT NULL)
        ORDER BY u.id
    `).all(jewellerId, jewellerId) as Array<{ karigarId: string }>;
    const pairRows = karigars.map(({ karigarId }) => readPairExposure(jewellerId, karigarId, asOf));
    const portfolioExposureMg = pairRows.reduce((total, pair) => total + pair.exposureMg, 0);
    const entries = pairRows.map((pair) => {
        const risk = evaluateKarigarExposure({
            ...pair.metrics,
            portfolioExposureMg,
        });
        const trustTier = getTrustTier(pair.cleanReturnCount);
        return {
            karigarId: pair.karigarId,
            karigarName: pair.karigarName,
            floatMg: pair.floatMg,
            exposureMg: pair.exposureMg,
            exposurePaise: pair.exposurePaise,
            cleanReturnCount: pair.cleanReturnCount,
            trustTier: {
                id: trustTier.id,
                label: trustTier.label,
                floatLimitMg: trustTier.floatLimitMg,
            },
            risk,
        };
    });
    return {
        asOf: asOf.toISOString(),
        configuration: {
            trustTiers: KARIGAR_EXPOSURE_CONFIG.trustTiers,
            staffLargeIssueMg: KARIGAR_EXPOSURE_CONFIG.staffLargeIssueMg,
            peerComparisonEnabled: KARIGAR_EXPOSURE_CONFIG.peerComparisonEnabled,
        },
        karigars: entries,
        syntheticReplay: computeSyntheticExposureReplay(asOf),
    };
}

export function getKarigarExposureSentence(
    karigarId: string,
    asOf: Date = now(),
    onlyJewellerId?: string,
) {
    const jewellerRows = onlyJewellerId
        ? [{ jewellerId: onlyJewellerId }]
        : db.prepare(`
            SELECT DISTINCT jeweller_id AS jewellerId FROM orders WHERE karigar_id = ?
            UNION SELECT DISTINCT jeweller_id AS jewellerId FROM karigar_floats WHERE karigar_id = ?
            ORDER BY jewellerId
        `).all(karigarId, karigarId) as Array<{ jewellerId: string }>;
    const assessments = jewellerRows.map(({ jewellerId }) =>
        getKarigarExposureDashboard(jewellerId, asOf).karigars
            .find((entry) => entry.karigarId === karigarId)?.risk)
        .filter((assessment): assessment is KarigarExposureAssessment => assessment !== undefined);
    const levelRank = { steady: 0, watch: 1, high: 2 } as const;
    const assessment = assessments.reduce<KarigarExposureAssessment | null>(
        (worst, item) => !worst
            || levelRank[item.level] > levelRank[worst.level]
            || (item.level === worst.level && item.score > worst.score)
            ? item
            : worst,
        null,
    );
    const level = assessment?.level ?? 'steady';
    const signal = assessment?.signals
        .filter((item) => item.severity > 0)
        .sort((left, right) => right.contribution - left.contribution)[0]?.code ?? null;
    return {
        level,
        signal,
        sentence: signal
            ? KARIGAR_EXPOSURE_CONFIG.karigarSignalSentences[signal]
            : KARIGAR_EXPOSURE_CONFIG.sentences.steady,
    };
}

export function getCleanReturnCount(jewellerId: string, karigarId: string, asOf: Date = now()) {
    return getCompletedLossHistory(jewellerId, karigarId, asOf)
        .filter((entry) => entry.clean).length;
}

export function computeSyntheticExposureReplay(asOf: Date = now()) {
    const config = KARIGAR_EXPOSURE_CONFIG.replay;
    const days: Array<{
        day: number;
        date: string;
        exposureMg: number;
        valuePaise: number;
        riskLevel: KarigarExposureAssessment['level'];
    }> = [];
    let exposureMg = config.startingExposureMg;
    let firstFlag: typeof days[number] | null = null;
    for (let day = 0; day < config.days; day += 1) {
        if (day > 0) {
            const dailyReturnMg = day <= config.earlyPhaseThroughDay
                ? config.earlyReturnMg
                : day <= config.slowingPhaseThroughDay
                    ? config.slowingReturnMg
                    : 0;
            exposureMg += config.dailyIssueMg - dailyReturnMg;
        }
        const date = new Date(asOf.getTime() - (config.days - 1 - day) * DAY_MS);
        const trailingWindowDays = Math.min(day, KARIGAR_EXPOSURE_CONFIG.drawRateWindowDays);
        const trailingIssueMg = config.dailyIssueMg * trailingWindowDays;
        const assessment = evaluateKarigarExposure({
            floatMg: exposureMg,
            exposureMg,
            trailingIssueMg,
            trailingWindowDays,
            oldestGoldAgeDays: day,
            missedReturnPromises: 0,
            portfolioExposureMg: exposureMg * 2,
            purityShortfallCount: 0,
            recentLossBps: null,
            historicalLossBps: null,
        });
        const valuePaise = calculateSignedGoldValuePaise(
            exposureMg,
            999,
            getRate(date, 999).rate24KPaisePerGram,
        );
        const entry = {
            day,
            date: date.toISOString(),
            exposureMg,
            valuePaise,
            riskLevel: assessment.level,
        };
        days.push(entry);
        if (!firstFlag && assessment.level !== 'steady') firstFlag = entry;
    }
    if (!firstFlag) throw new Error('The configured synthetic replay must trigger an early warning.');
    const atLoss = days[days.length - 1];
    return {
        label: config.label,
        name: '90-day float balance, slowing returns, then silence',
        days,
        firstFlag,
        atLoss: {
            ...atLoss,
            valuePaise: calculateSignedGoldValuePaise(
                atLoss.exposureMg,
                999,
                getRate(new Date(atLoss.date), 999).rate24KPaisePerGram,
            ),
        },
    };
}

export interface OwnerIssueApprovalInput {
    jewellerId: string;
    karigarId: string;
    makerId: string;
    orderId: string;
    floatId: string | null;
    debitAccount: string | null;
    creditAccount: string | null;
    weightMg: number;
    reason: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
}

export function createOwnerIssueApproval(input: OwnerIssueApprovalInput) {
    const existing = db.prepare(`
        SELECT id, status, ledger_event_id AS ledgerEventId
        FROM owner_issue_approvals WHERE maker_id = ? AND idempotency_key = ?
    `).get(input.makerId, input.idempotencyKey) as {
        id: string;
        status: string;
        ledgerEventId: string | null;
    } | undefined;
    if (existing) return existing;

    const id = `issue-approval-${crypto.randomUUID()}`;
    db.prepare(`
        INSERT INTO owner_issue_approvals
            (id, jeweller_id, karigar_id, maker_id, order_id, float_id,
             debit_account, credit_account, weight_mg,
             reason, payload_json, idempotency_key, status, requested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
        id,
        input.jewellerId,
        input.karigarId,
        input.makerId,
        input.orderId,
        input.floatId,
        input.debitAccount,
        input.creditAccount,
        input.weightMg,
        input.reason,
        JSON.stringify(input.payload),
        input.idempotencyKey,
        now().toISOString(),
    );
    return { id, status: 'pending', ledgerEventId: null };
}

export function getPendingFloatIssueReservationMg(floatId: string): number {
    const pendingLedgerIssue = (db.prepare(`
        SELECT COALESCE(SUM(weight_mg), 0) AS weightMg FROM ledger_events
        WHERE float_id = ? AND credit_account = 'karigar_float' AND status = 'pending_ack'
    `).get(floatId) as { weightMg: number }).weightMg;
    const pendingApproval = (db.prepare(`
        SELECT COALESCE(SUM(weight_mg), 0) AS weightMg FROM owner_issue_approvals
        WHERE float_id = ? AND credit_account = 'karigar_float' AND status = 'pending'
    `).get(floatId) as { weightMg: number }).weightMg;
    return pendingLedgerIssue + pendingApproval;
}

export function getPendingFloatDrawdownMg(floatId: string): number {
    return (db.prepare(`
        SELECT COALESCE(SUM(weight_mg), 0) AS weightMg FROM owner_issue_approvals
        WHERE float_id = ? AND debit_account = 'karigar_float' AND status = 'pending'
    `).get(floatId) as { weightMg: number }).weightMg;
}

export function getPendingOwnerIssueApprovals(jewellerId: string) {
    return db.prepare(`
        SELECT a.id, a.karigar_id AS karigarId, k.name AS karigarName,
            a.maker_id AS makerId, m.name AS makerName,
            a.order_id AS orderId, o.description,
            a.float_id AS floatId, a.weight_mg AS weightMg, a.reason,
            a.status, a.requested_at AS requestedAt
        FROM owner_issue_approvals a
        JOIN users k ON k.id = a.karigar_id
        JOIN users m ON m.id = a.maker_id
        JOIN orders o ON o.id = a.order_id
        WHERE a.jeweller_id = ? AND a.status = 'pending'
        ORDER BY a.requested_at, a.id
    `).all(jewellerId);
}

export function getOwnerIssueApproval(approvalId: string, jewellerId: string) {
    return db.prepare(`
        SELECT id, jeweller_id AS jewellerId, karigar_id AS karigarId,
            maker_id AS makerId, order_id AS orderId, float_id AS floatId,
            weight_mg AS weightMg, reason, payload_json AS payloadJson,
            status, idempotency_key AS idempotencyKey,
            ledger_event_id AS ledgerEventId
        FROM owner_issue_approvals WHERE id = ? AND jeweller_id = ?
    `).get(approvalId, jewellerId) as {
        id: string;
        jewellerId: string;
        karigarId: string;
        makerId: string;
        orderId: string;
        floatId: string | null;
        weightMg: number;
        reason: string;
        payloadJson: string;
        status: string;
        idempotencyKey: string;
        ledgerEventId: string | null;
    } | undefined;
}

export function completeOwnerIssueApproval(
    approvalId: string,
    jewellerId: string,
    status: 'approved' | 'rejected',
    actorId: string,
    eventId: string | null = null,
) {
    return db.prepare(`
        UPDATE owner_issue_approvals
        SET status = ?,
            approved_by = CASE WHEN ? = 'approved' THEN ? ELSE NULL END,
            approved_at = CASE WHEN ? = 'approved' THEN ? ELSE NULL END,
            rejected_by = CASE WHEN ? = 'rejected' THEN ? ELSE NULL END,
            rejected_at = CASE WHEN ? = 'rejected' THEN ? ELSE NULL END,
            ledger_event_id = ?
        WHERE id = ? AND jeweller_id = ? AND status = 'pending'
    `).run(
        status,
        status,
        actorId,
        status,
        now().toISOString(),
        status,
        actorId,
        status,
        now().toISOString(),
        eventId,
        approvalId,
        jewellerId,
    ).changes === 1;
}
