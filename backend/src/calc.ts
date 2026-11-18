/**
 * @fileoverview Pure deterministic calculation library for gold weights,
 * purity (fine-gold equivalent), wastage, and short/excess balances.
 *
 * HARD RULES:
 * 1. All weights are integer milligrams (mg). Floats are strictly rejected.
 * 2. Purity and wastage rates are integer basis points (bps): 10000 bps = 100.00%.
 *    Example: 22K (91.60% / 916 touch) = 9160 bps; 24K (99.90%) = 9990 bps.
 * 3. Rounding uses pure integer remainder arithmetic (no IEEE-754 float division).
 */

import type { DeadlineRiskConfig, DeadlineRiskLevel, RescueRankingConfig } from './deadlineConfig';
import type { DailyBriefRankingConfig, DailyBriefSchedule } from './dailyBriefConfig';

export type WeightUnit = 'mg' | 'g' | 'tola';

/**
 * Rounding modes for integer division:
 * - HALF_UP: Rounds >= 0.5 up to the next integer mg (standard commercial default).
 * - FLOOR: Always truncates remainder down toward zero.
 * - CEIL: Always rounds any non-zero remainder up.
 */
export type RoundingMode = 'HALF_UP' | 'FLOOR' | 'CEIL';

/**
 * Defines which weight base the allowed wastage percentage is applied to:
 * - 'returned_finished': % of finished ornament weight returned by karigar (default).
 * - 'issued_gross': % of gross weight issued to karigar.
 * - 'issued_minus_scrap': % of (issued gross weight - returned scrap weight).
 */
export type WastageBaseRule = 'returned_finished' | 'issued_gross' | 'issued_minus_scrap';

export interface CalcConfig {
    roundingMode: RoundingMode;
    wastageBase: WastageBaseRule;
    tolaWeightMg: number; // 10000 mg (10g metric) or 11664 mg (traditional Indian tola)
}

export type AgreementWastageBasis =
    | 'ideal_return_buffer'
    | 'fine_issued'
    | 'gross_issued'
    | 'finished_weight';

export type IdealReturnStatus = 'AT_OR_ABOVE_IDEAL' | 'WITHIN_BUFFER' | 'SHORT';

export interface IdealReturnConfiguration {
    idealReturnFactorBp: number;
    bufferBp: number;
}

export interface FairPayInput {
    retainedGoldMg: number;
    goldPurityPerMille: number;
    simulatedRatePaisePerGram: number;
    pieceCounts: { buffing: number; cutting: number; polish: number };
    perPiecePayPaise: { buffing: number; cutting: number; polish: number };
}

export interface AgreementAllowanceInput {
    issuedGrossMg: number;
    issuedPurityPerMille: number;
    finishedWeightMg: number;
    percentBps: number;
    basis: AgreementWastageBasis;
    idealReturnConfig?: IdealReturnConfiguration;
}

export interface EffectiveRateInput {
    labourRatePaisePerGram: number;
    allowanceMg: number;
    finishedWeightMg: number;
    sweepShareMg: number;
    simulatedGoldRatePaisePerGram: number;
    syntheticReferenceRangePaisePerGram: { min: number; max: number };
}

export interface EffectiveRateResult {
    labourPaisePerFinishedGram: number;
    allowanceValuePaisePerFinishedGram: number;
    sweepValuePaisePerFinishedGram: number;
    effectiveRatePaisePerFinishedGram: number;
    outlier: boolean;
}

export interface RatePolicyAmountsInput {
    fineGoldMg: number;
    ratesPaisePerGram: { issue: number; return: number; settlement: number };
}

export type GoldAtLargePhysicalAccount = 'karigar_wip' | 'finished_goods' | 'scrap' | 'refiner';
export type GoldAtLargeLedgerAccount = GoldAtLargePhysicalAccount | 'jeweller_vault' | 'karigar_float' | 'process_loss';

export interface GoldAtLargeAccountBalance {
    grossMg: number;
    fineMg: number;
}

export interface GoldAtLargeOrderInput {
    id: string;
    description: string;
    status: string;
    karigarId: string;
    karigarName: string;
    dueDate: string;
    issueDate: string | null;
    returnDate: string | null;
    cashLedgerEntries: Array<{
        type: string;
        status: string;
        weightMg: number;
        amountPaise: number;
        createdAt: string;
        labourRatePaisePerGram: number | null;
    }>;
    accountBalances: Record<GoldAtLargeLedgerAccount, GoldAtLargeAccountBalance>;
    ratesPaisePerGram: { issue: number; return: number; settlement: number };
}

export interface GoldAtLargeAgeingBucket {
    label: string;
    minDays: number;
    maxDays: number | null;
}

export interface GoldAtLargeSummaryInput {
    asOf: Date;
    currentRatePaisePerGram: number;
    stageLabels: ReadonlyArray<{ account: GoldAtLargePhysicalAccount; label: string }>;
    ageingBuckets: ReadonlyArray<GoldAtLargeAgeingBucket>;
    orders: GoldAtLargeOrderInput[];
}

export interface IssuedGoldLot {
    weightMg: number;
    purityPerMille: number;
}

export interface FinishedGoldLot extends IssuedGoldLot {
    method: 'touch' | 'XRF' | 'declared';
    stoneWeightMg?: number;
    otherNonGoldWeightMg?: number;
}

export interface ScrapGoldLot extends IssuedGoldLot {
    stoneWeightMg?: number;
    otherNonGoldWeightMg?: number;
}

export interface ReturnReconciliationInput {
    issuedLots: IssuedGoldLot[];
    finishedLots: FinishedGoldLot[];
    scrapLots: ScrapGoldLot[];
    agreement: { basis: AgreementWastageBasis; percentBps: number };
    config: {
        grossWeightToleranceMg: number;
        purityShortfallToleranceFineMg: number;
        unusedAllowancePolicy: 'karigar_keeps' | 'return_to_jeweller';
        purityLabels: Record<number, string>;
        idealReturnFactorBp?: number;
        bufferBp?: number;
        idealReturnPurityPerMille?: number;
        simulatedRatePaisePerGram?: number;
        targetWeightMg?: number;
        targetToleranceMg?: number;
        perPiecePayPaise?: FairPayInput['perPiecePayPaise'];
    };
    pieceCounts?: FairPayInput['pieceCounts'];
}

export interface ReturnReconciliationResult {
    grossIssuedMg: number;
    fineIssuedMg: number;
    grossFinishedMg: number;
    netGoldFinishedMg: number;
    fineFinishedMg: number;
    grossScrapMg: number;
    fineScrapMg: number;
    grossReturnedMg: number;
    netGoldReturnedMg: number;
    fineReturnedMg: number;
    grossWeightDeltaMg: number;
    grossWeightMatched: boolean;
    issuedPurityPerMille: number;
    returnedPurityPerMille: number;
    processLossGrossMg: number;
    processLossFineMg: number;
    allowanceFineMg: number;
    owedFineMg: number;
    excessFineMg: number;
    unusedAllowanceFineMg: number;
    unusedAllowancePolicy: 'karigar_keeps' | 'return_to_jeweller';
    idealMg: number | null;
    minAcceptableMg: number | null;
    idealReturnStatus: IdealReturnStatus | null;
    retainedGoldMg: number;
    retainedGoldValuePaise: number;
    shortFineMg: number;
    targetWeightMg: number | null;
    targetWeightDeviationMg: number | null;
    targetWeightFlagged: boolean;
    targetWeightPriceImpactPaise: number | null;
    perPiecePayPaise: number;
    fairPayPaise: number;
    status: 'WITHIN_ALLOWANCE' | 'KARIGAR_OWES' | 'PURITY_SHORTFALL' | 'EXCESS_REVIEW';
    explanation: { en: string; kn: string };
}

export function toFineGoldPerMilleMg(grossMg: number, purityPerMille: number): number {
    assertNonNegativeInt(grossMg, 'grossMg');
    if (!Number.isInteger(purityPerMille) || purityPerMille < 0 || purityPerMille > 1000) {
        throw new Error('Invalid purityPerMille: must be an integer between 0 and 1000.');
    }
    return divideAndRoundInt(grossMg * purityPerMille, 1000);
}

/**
 * Rounds both integer-milligram stages HALF_UP: ideal first, then its buffer minimum.
 */
export function calculateIdealReturn(
    issuedMg: number,
    returnedMg: number | undefined,
    config: IdealReturnConfiguration,
): {
    idealMg: number;
    minAcceptableMg: number;
    status: IdealReturnStatus | null;
    retainedGoldMg: number;
    shortfallMg: number;
} {
    assertNonNegativeInt(issuedMg, 'issuedMg');
    if (returnedMg !== undefined) assertNonNegativeInt(returnedMg, 'returnedMg');
    if (!Number.isInteger(config.idealReturnFactorBp) || config.idealReturnFactorBp < 0) {
        throw new Error('idealReturnFactorBp must be a non-negative integer.');
    }
    if (!Number.isInteger(config.bufferBp) || config.bufferBp < 0 || config.bufferBp > 10_000) {
        throw new Error('bufferBp must be an integer between 0 and 10000.');
    }

    const idealMg = divideAndRoundInt(issuedMg * config.idealReturnFactorBp, 10_000, 'HALF_UP');
    const minAcceptableMg = divideAndRoundInt(idealMg * (10_000 - config.bufferBp), 10_000, 'HALF_UP');
    if (returnedMg === undefined) {
        return { idealMg, minAcceptableMg, status: null, retainedGoldMg: 0, shortfallMg: 0 };
    }

    const status: IdealReturnStatus = returnedMg < minAcceptableMg
        ? 'SHORT'
        : returnedMg < idealMg
            ? 'WITHIN_BUFFER'
            : 'AT_OR_ABOVE_IDEAL';
    return {
        idealMg,
        minAcceptableMg,
        status,
        retainedGoldMg: status === 'WITHIN_BUFFER' ? idealMg - returnedMg : 0,
        shortfallMg: status === 'SHORT' ? minAcceptableMg - returnedMg : 0,
    };
}

export function calculateNetGoldMg(
    grossMg: number,
    stoneMg: number,
    otherNonGoldMg: number,
): number {
    assertNonNegativeInt(grossMg, 'grossMg');
    assertNonNegativeInt(stoneMg, 'stoneMg');
    assertNonNegativeInt(otherNonGoldMg, 'otherNonGoldMg');
    const deductionsMg = stoneMg + otherNonGoldMg;
    if (deductionsMg > grossMg) {
        throw new Error('Stone and other non-gold weight cannot exceed gross weight.');
    }
    return grossMg - deductionsMg;
}

export function calculateKarigarSlip(input: {
    issuedMg: number;
    wastageMg: number;
    stoneMg: number;
    givenAgainMg: number;
}): {
    issuedMg: number;
    wastageMg: number;
    stoneMg: number;
    netMg: number;
    givenAgainMg: number;
    finalMg: number;
} {
    assertNonNegativeInt(input.issuedMg, 'issuedMg');
    assertNonNegativeInt(input.wastageMg, 'wastageMg');
    assertNonNegativeInt(input.stoneMg, 'stoneMg');
    assertNonNegativeInt(input.givenAgainMg, 'givenAgainMg');
    if (input.wastageMg + input.stoneMg > input.issuedMg) {
        throw new Error('Wastage and stone weight cannot exceed issued weight.');
    }
    const netMg = input.issuedMg - input.wastageMg - input.stoneMg;
    return {
        ...input,
        netMg,
        finalMg: netMg + input.givenAgainMg,
    };
}

export function calculateFairPayPaise(input: FairPayInput): {
    retainedGoldValuePaise: number;
    perPiecePayPaise: number;
    fairPayPaise: number;
} {
    assertNonNegativeInt(input.retainedGoldMg, 'retainedGoldMg');
    assertNonNegativeInt(input.simulatedRatePaisePerGram, 'simulatedRatePaisePerGram');
    const fineGoldMg = toFineGoldPerMilleMg(input.retainedGoldMg, input.goldPurityPerMille);
    const retainedGoldValuePaise = calculateGoldValuePaise(fineGoldMg, input.simulatedRatePaisePerGram);
    const counts = [input.pieceCounts.buffing, input.pieceCounts.cutting, input.pieceCounts.polish];
    const rates = [input.perPiecePayPaise.buffing, input.perPiecePayPaise.cutting, input.perPiecePayPaise.polish];
    counts.forEach((count, index) => assertNonNegativeInt(count, `pieceCounts[${index}]`));
    rates.forEach((rate, index) => assertNonNegativeInt(rate, `perPiecePayPaise[${index}]`));
    const perPiecePayPaise = counts.reduce((total, count, index) => total + count * rates[index], 0);
    return {
        retainedGoldValuePaise,
        perPiecePayPaise,
        fairPayPaise: retainedGoldValuePaise + perPiecePayPaise,
    };
}

export function calculateWeightShareMg(weightMg: number, shareBps: number): number {
    assertNonNegativeInt(weightMg, 'weightMg');
    assertValidBps(shareBps, 'shareBps');
    return divideAndRoundInt(weightMg * shareBps, 10000);
}

export function calculateCappedSplitValue(original: number, claimed: number, cap: number): number {
    assertNonNegativeInt(original, 'original');
    assertNonNegativeInt(claimed, 'claimed');
    assertNonNegativeInt(cap, 'cap');
    const difference = claimed - original;
    const cappedDifference = Math.min(Math.abs(difference), cap);
    const halfDifference = divideAndRoundInt(cappedDifference, 2);
    return original + (difference < 0 ? -halfDifference : halfDifference);
}

export function calculateCappedSplitSignedValue(original: number, claimed: number, cap: number): number {
    if (!Number.isInteger(original)) throw new Error('original must be an integer.');
    if (!Number.isInteger(claimed)) throw new Error('claimed must be an integer.');
    assertNonNegativeInt(cap, 'cap');
    const difference = claimed - original;
    const cappedDifference = Math.min(Math.abs(difference), cap);
    const halfDifference = divideAndRoundInt(cappedDifference, 2);
    return original + (difference < 0 ? -halfDifference : halfDifference);
}

export function calculateSignedFineGoldMg(grossMg: number, purityPerMille: number): number {
    if (!Number.isInteger(grossMg)) throw new Error('grossMg must be an integer.');
    const absoluteFineMg = toFineGoldPerMilleMg(Math.abs(grossMg), purityPerMille);
    return grossMg < 0 ? -absoluteFineMg : absoluteFineMg;
}

export interface GoldJourneyLossInput {
    sentGrossMg: number;
    sentPurityPerMille: number;
    receivedGrossMg: number;
    receivedPurityPerMille: number;
}

export function calculateGoldJourneyLoss(input: GoldJourneyLossInput) {
    assertNonNegativeInt(input.sentGrossMg, 'sentGrossMg');
    assertNonNegativeInt(input.receivedGrossMg, 'receivedGrossMg');
    if (input.receivedGrossMg > input.sentGrossMg) {
        throw new Error('Received gross weight cannot exceed the sent gross weight.');
    }
    const sentFineMg = toFineGoldPerMilleMg(input.sentGrossMg, input.sentPurityPerMille);
    const receivedFineMg = toFineGoldPerMilleMg(input.receivedGrossMg, input.receivedPurityPerMille);
    if (receivedFineMg > sentFineMg) {
        throw new Error('Received fine gold cannot exceed the sent fine gold.');
    }
    return {
        sentFineMg,
        receivedFineMg,
        grossLossMg: input.sentGrossMg - input.receivedGrossMg,
        fineLossMg: sentFineMg - receivedFineMg,
    };
}

export interface DisputeHistoryJobInput {
    issuedLots: Array<{ grossMg: number; fineMg: number }>;
    finishedLots: Array<{ grossMg: number; fineMg: number }>;
    scrapLots: Array<{ grossMg: number; fineMg: number }>;
    agreement: {
        basis: AgreementWastageBasis;
        percentBps: number;
        idealReturnConfig?: IdealReturnConfiguration;
        idealReturnPurityPerMille?: number;
    } | null;
}

export function calculateDisputeHistoryTotals(jobs: DisputeHistoryJobInput[]) {
    const completedJobs = jobs.filter((job) =>
        job.agreement !== null && (job.finishedLots.length > 0 || job.scrapLots.length > 0));
    const totals = completedJobs.reduce((result, job) => {
        const issuedGrossMg = job.issuedLots.reduce((sum, lot) => sum + lot.grossMg, 0);
        const issuedFineMg = job.issuedLots.reduce((sum, lot) => sum + lot.fineMg, 0);
        const finishedGrossMg = job.finishedLots.reduce((sum, lot) => sum + lot.grossMg, 0);
        const returnedFineMg = job.finishedLots.reduce((sum, lot) => sum + lot.fineMg, 0)
            + job.scrapLots.reduce((sum, lot) => sum + lot.fineMg, 0);
        const allowanceBaseMg = job.agreement?.basis === 'fine_issued'
            ? issuedFineMg
            : job.agreement?.basis === 'gross_issued' ? issuedGrossMg : finishedGrossMg;
        let allowanceMg: number;
        if (job.agreement?.basis === 'ideal_return_buffer') {
            if (!job.agreement.idealReturnConfig || job.agreement.idealReturnPurityPerMille === undefined) {
                throw new Error('Ideal-return configuration is required for dispute history.');
            }
            const ideal = calculateIdealReturn(issuedGrossMg, undefined, job.agreement.idealReturnConfig);
            allowanceMg = toFineGoldPerMilleMg(
                ideal.idealMg - ideal.minAcceptableMg,
                job.agreement.idealReturnPurityPerMille,
            );
        } else {
            allowanceMg = divideAndRoundInt(
                allowanceBaseMg * (job.agreement?.percentBps ?? 0),
                10_000,
            );
        }
        return {
            lossMg: result.lossMg + Math.max(0, issuedFineMg - returnedFineMg),
            allowanceMg: result.allowanceMg + allowanceMg,
        };
    }, { lossMg: 0, allowanceMg: 0 });
    return { ...totals, completedJobs: completedJobs.length };
}

export const DEFAULT_CALC_CONFIG: CalcConfig = {
    roundingMode: 'HALF_UP',
    wastageBase: 'returned_finished',
    tolaWeightMg: 10000,
};

export function computeAgreementAllowanceMg(input: AgreementAllowanceInput): number {
    assertNonNegativeInt(input.issuedGrossMg, 'issuedGrossMg');
    assertNonNegativeInt(input.finishedWeightMg, 'finishedWeightMg');
    if (!Number.isInteger(input.issuedPurityPerMille) || input.issuedPurityPerMille < 0 || input.issuedPurityPerMille > 1000) {
        throw new Error('Invalid issuedPurityPerMille: must be an integer between 0 and 1000.');
    }
    assertValidBps(input.percentBps, 'percentBps');

    let baseMg: number;
    switch (input.basis) {
        case 'ideal_return_buffer': {
            if (!input.idealReturnConfig) {
                throw new Error('Ideal-return configuration is required for this wastage basis.');
            }
            const ideal = calculateIdealReturn(input.issuedGrossMg, undefined, input.idealReturnConfig);
            return ideal.idealMg - ideal.minAcceptableMg;
        }
        case 'fine_issued':
            baseMg = toFineGoldPerMilleMg(input.issuedGrossMg, input.issuedPurityPerMille);
            break;
        case 'gross_issued':
            baseMg = input.issuedGrossMg;
            break;
        case 'finished_weight':
            baseMg = input.finishedWeightMg;
            break;
        default:
            throw new Error(`Unsupported wastage basis: ${input.basis}`);
    }

    return divideAndRoundInt(baseMg * input.percentBps, 10000);
}

export function calculateReturnReconciliation(input: ReturnReconciliationInput): ReturnReconciliationResult {
    if (input.issuedLots.length === 0 || input.finishedLots.length === 0) {
        throw new Error('At least one issued lot and one finished lot are required.');
    }
    assertNonNegativeInt(input.config.grossWeightToleranceMg, 'grossWeightToleranceMg');
    assertNonNegativeInt(input.config.purityShortfallToleranceFineMg, 'purityShortfallToleranceFineMg');
    assertValidBps(input.agreement.percentBps, 'agreement.percentBps');

    const sumLots = (lots: Array<IssuedGoldLot & { stoneWeightMg?: number; otherNonGoldWeightMg?: number }>) => lots.reduce((total, lot) => {
        assertNonNegativeInt(lot.weightMg, 'lot.weightMg');
        const netGoldMg = calculateNetGoldMg(
            lot.weightMg,
            lot.stoneWeightMg ?? 0,
            lot.otherNonGoldWeightMg ?? 0,
        );
        return {
            grossMg: total.grossMg + lot.weightMg,
            netGoldMg: total.netGoldMg + netGoldMg,
            fineMg: total.fineMg + toFineGoldPerMilleMg(netGoldMg, lot.purityPerMille),
        };
    }, { grossMg: 0, netGoldMg: 0, fineMg: 0 });

    const issued = sumLots(input.issuedLots);
    const finished = sumLots(input.finishedLots);
    const scrap = sumLots(input.scrapLots);
    const fineReturnedMg = finished.fineMg + scrap.fineMg;
    const grossReturnedMg = finished.grossMg + scrap.grossMg;
    const netGoldReturnedMg = finished.netGoldMg + scrap.netGoldMg;
    const grossWeightDeltaMg = grossReturnedMg - issued.grossMg;
    const processLossFineMg = issued.fineMg - fineReturnedMg;
    const processLossGrossMg = issued.grossMg - netGoldReturnedMg;
    const allowanceBaseMg = input.agreement.basis === 'fine_issued'
        ? issued.fineMg
        : input.agreement.basis === 'gross_issued'
            ? issued.grossMg
            : input.agreement.basis === 'finished_weight'
                ? finished.netGoldMg
                : 0;
    const idealConfig = input.agreement.basis === 'ideal_return_buffer'
        ? {
            idealReturnFactorBp: input.config.idealReturnFactorBp,
            bufferBp: input.config.bufferBp,
        }
        : null;
    if (idealConfig && (idealConfig.idealReturnFactorBp === undefined || idealConfig.bufferBp === undefined)) {
        throw new Error('Ideal-return configuration is required for this wastage basis.');
    }
    const idealReturn = idealConfig
        ? calculateIdealReturn(issued.grossMg, netGoldReturnedMg, {
            idealReturnFactorBp: idealConfig.idealReturnFactorBp!,
            bufferBp: idealConfig.bufferBp!,
        })
        : null;
    const allowanceFineMg = idealReturn
        ? toFineGoldPerMilleMg(
            idealReturn.idealMg - idealReturn.minAcceptableMg,
            input.config.idealReturnPurityPerMille ?? 916,
        )
        : divideAndRoundInt(allowanceBaseMg * input.agreement.percentBps, 10_000);
    const beyondAllowanceFineMg = Math.max(0, processLossFineMg - allowanceFineMg);
    const shortFineMg = idealReturn?.status === 'SHORT'
        ? toFineGoldPerMilleMg(idealReturn.shortfallMg, input.config.idealReturnPurityPerMille ?? 916)
        : 0;
    const owedFineMg = idealReturn
        ? shortFineMg
        : beyondAllowanceFineMg > input.config.purityShortfallToleranceFineMg
            ? beyondAllowanceFineMg
            : 0;
    const excessFineMg = Math.max(0, -processLossFineMg);
    const grossWeightMatched = Math.abs(grossWeightDeltaMg) <= input.config.grossWeightToleranceMg;
    const issuedPurityPerMille = issued.grossMg === 0
        ? 0
        : divideAndRoundInt(issued.fineMg * 1000, issued.grossMg);
    const returnedPurityPerMille = netGoldReturnedMg === 0
        ? 0
        : divideAndRoundInt(fineReturnedMg * 1000, netGoldReturnedMg);
    const retainedGoldMg = idealReturn?.retainedGoldMg ?? 0;
    const retainedGoldValuePaise = idealReturn
        ? calculateGoldValuePaise(
            toFineGoldPerMilleMg(retainedGoldMg, input.config.idealReturnPurityPerMille ?? 916),
            input.config.simulatedRatePaisePerGram ?? 0,
        )
        : 0;
    const targetWeightMg = input.config.targetWeightMg ?? null;
    const targetWeightDeviationMg = targetWeightMg === null ? null : netGoldReturnedMg - targetWeightMg;
    const targetWeightFlagged = targetWeightDeviationMg !== null
        && Math.abs(targetWeightDeviationMg) > (input.config.targetToleranceMg ?? 0);
    const targetWeightPriceImpactPaise = targetWeightDeviationMg === null
        ? null
        : calculateSignedGoldValuePaise(
            targetWeightDeviationMg,
            input.config.idealReturnPurityPerMille ?? 916,
            input.config.simulatedRatePaisePerGram ?? 0,
        );
    const fairPay = calculateFairPayPaise({
        retainedGoldMg,
        goldPurityPerMille: input.config.idealReturnPurityPerMille ?? 916,
        simulatedRatePaisePerGram: input.config.simulatedRatePaisePerGram ?? 0,
        pieceCounts: input.pieceCounts ?? { buffing: 0, cutting: 0, polish: 0 },
        perPiecePayPaise: input.config.perPiecePayPaise ?? { buffing: 0, cutting: 0, polish: 0 },
    });

    let status: ReturnReconciliationResult['status'] = 'WITHIN_ALLOWANCE';
    if (idealReturn?.status === 'SHORT') {
        status = 'KARIGAR_OWES';
    } else if (excessFineMg > 0) {
        status = 'EXCESS_REVIEW';
    } else if (owedFineMg > 0 && grossWeightMatched && returnedPurityPerMille < issuedPurityPerMille) {
        status = 'PURITY_SHORTFALL';
    } else if (owedFineMg > 0) {
        status = 'KARIGAR_OWES';
    }

    const result: ReturnReconciliationResult = {
        grossIssuedMg: issued.grossMg,
        fineIssuedMg: issued.fineMg,
        grossFinishedMg: finished.grossMg,
        netGoldFinishedMg: finished.netGoldMg,
        fineFinishedMg: finished.fineMg,
        grossScrapMg: scrap.grossMg,
        fineScrapMg: scrap.fineMg,
        grossReturnedMg,
        netGoldReturnedMg,
        fineReturnedMg,
        grossWeightDeltaMg,
        grossWeightMatched,
        issuedPurityPerMille,
        returnedPurityPerMille,
        processLossGrossMg,
        processLossFineMg,
        allowanceFineMg,
        owedFineMg,
        excessFineMg,
        unusedAllowanceFineMg: idealReturn
            ? toFineGoldPerMilleMg(retainedGoldMg, input.config.idealReturnPurityPerMille ?? 916)
            : Math.max(0, allowanceFineMg - Math.max(0, processLossFineMg)),
        unusedAllowancePolicy: input.config.unusedAllowancePolicy,
        idealMg: idealReturn?.idealMg ?? null,
        minAcceptableMg: idealReturn?.minAcceptableMg ?? null,
        idealReturnStatus: idealReturn?.status ?? null,
        retainedGoldMg,
        retainedGoldValuePaise,
        shortFineMg,
        targetWeightMg,
        targetWeightDeviationMg,
        targetWeightFlagged,
        targetWeightPriceImpactPaise,
        perPiecePayPaise: fairPay.perPiecePayPaise,
        fairPayPaise: fairPay.fairPayPaise,
        status,
        explanation: { en: '', kn: '' },
    };
    result.explanation = {
        en: formatReturnExplanation(result, 'en', input.config.purityLabels),
        kn: formatReturnExplanation(result, 'kn', input.config.purityLabels),
    };
    return result;
}

export function formatReturnExplanation(
    result: ReturnReconciliationResult,
    language: 'en' | 'kn',
    purityLabels: Record<number, string> = {},
): string {
    if (result.idealReturnStatus !== null) {
        const idealText = result.idealReturnStatus === 'SHORT'
            ? language === 'en'
                ? `Return is SHORT: ${result.netGoldReturnedMg.toLocaleString()} mg is below the minimum ${result.minAcceptableMg!.toLocaleString()} mg.`
                : `ಮರಳಿಕೆ ಕಡಿಮೆ: ${result.netGoldReturnedMg.toLocaleString()} ಮಿ.ಗ್ರಾಂ ಕನಿಷ್ಠ ${result.minAcceptableMg!.toLocaleString()} ಮಿ.ಗ್ರಾಂಗಿಂತ ಕಡಿಮೆ.`
            : result.idealReturnStatus === 'WITHIN_BUFFER'
                ? language === 'en'
                    ? `Return is within the buffer. Karigar retains ${result.retainedGoldMg.toLocaleString()} mg.`
                    : `ಮರಳಿಕೆ ಮಿತಿಯೊಳಗೆ ಇದೆ. ಕಾರಿಗರರು ${result.retainedGoldMg.toLocaleString()} ಮಿ.ಗ್ರಾಂ ಉಳಿಸಿಕೊಳ್ಳುತ್ತಾರೆ.`
                : language === 'en'
                    ? 'Return is at or above the ideal.'
                    : 'ಮರಳಿಕೆ ಆದರ್ಶ ತೂಕಕ್ಕೆ ಸಮ ಅಥವಾ ಅದಕ್ಕಿಂತ ಹೆಚ್ಚು.';
        const targetText = result.targetWeightFlagged
            ? language === 'en'
                ? ` Target weight is off by ${Math.abs(result.targetWeightDeviationMg!).toLocaleString()} mg; simulated price impact ${result.targetWeightPriceImpactPaise! < 0 ? '-' : '+'}${formatPaiseAsRupees(Math.abs(result.targetWeightPriceImpactPaise!))} (SIMULATED).`
                : ` ಗುರಿ ತೂಕದಿಂದ ${Math.abs(result.targetWeightDeviationMg!).toLocaleString()} ಮಿ.ಗ್ರಾಂ ವ್ಯತ್ಯಾಸ; ಸಿಮ್ಯುಲೇಟೆಡ್ ಬೆಲೆ ಪರಿಣಾಮ ${result.targetWeightPriceImpactPaise! < 0 ? '-' : '+'}${formatPaiseAsRupees(Math.abs(result.targetWeightPriceImpactPaise!))} (SIMULATED).`
            : '';
        return `${idealText}${targetText}`;
    }
    if (result.status === 'PURITY_SHORTFALL') {
        const issuedLabel = purityLabels[result.issuedPurityPerMille] ?? `${result.issuedPurityPerMille}‰`;
        const returnedLabel = purityLabels[result.returnedPurityPerMille] ?? `${result.returnedPurityPerMille}‰`;
        const missing = formatWeightMgAsGrams(result.processLossFineMg);
        return language === 'en'
            ? `Weight matched, but purity was ${returnedLabel} instead of ${issuedLabel}, so ${missing} g of fine gold is missing.`
            : `ತೂಕ ಹೊಂದಿದೆ, ಆದರೆ ಶುದ್ಧತೆ ${issuedLabel} ಬದಲಿಗೆ ${returnedLabel} ಆಗಿದೆ; ಆದ್ದರಿಂದ ${missing} ಗ್ರಾಂ ಶುದ್ಧ ಚಿನ್ನ ಕಡಿಮೆಯಾಗಿದೆ.`;
    }
    if (result.status === 'KARIGAR_OWES') {
        return language === 'en'
            ? `Fine-gold loss exceeds the agreed allowance by ${result.owedFineMg.toLocaleString()} mg.`
            : `ಶುದ್ಧ ಚಿನ್ನದ ನಷ್ಟವು ಒಪ್ಪಿಗೆಯ ಮಿತಿಗಿಂತ ${result.owedFineMg.toLocaleString()} ಮಿ.ಗ್ರಾಂ ಹೆಚ್ಚು.`;
    }
    if (result.status === 'EXCESS_REVIEW') {
        return language === 'en'
            ? `The return contains ${result.excessFineMg.toLocaleString()} mg more fine gold than issued; flag for review.`
            : `ನೀಡಿದ ಪ್ರಮಾಣಕ್ಕಿಂತ ${result.excessFineMg.toLocaleString()} ಮಿ.ಗ್ರಾಂ ಹೆಚ್ಚು ಶುದ್ಧ ಚಿನ್ನ ಮರಳಿದೆ; ಪರಿಶೀಲನೆಗೆ ಗುರುತಿಸಲಾಗಿದೆ.`;
    }
    return language === 'en'
        ? 'Fine-gold loss is within the agreed allowance.'
        : 'ಶುದ್ಧ ಚಿನ್ನದ ನಷ್ಟವು ಒಪ್ಪಿಗೆಯ ಮಿತಿಯೊಳಗೆ ಇದೆ.';
}

export function formatWeightMgAsGrams(weightMg: number): string {
    assertNonNegativeInt(weightMg, 'weightMg');
    const whole = Math.floor(weightMg / 1000);
    const fraction = String(weightMg % 1000).padStart(3, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : String(whole);
}

export function formatRupeesAsLakhPaise(amountPaise: number): string {
    assertNonNegativeInt(amountPaise, 'amountPaise');
    const tenthsOfLakh = divideAndRoundInt(amountPaise, 1_000_000);
    return `${Math.floor(tenthsOfLakh / 10)}.${tenthsOfLakh % 10}`;
}

export function calculateEffectiveRatePaisePerFinishedGram(input: EffectiveRateInput): EffectiveRateResult {
    assertNonNegativeInt(input.labourRatePaisePerGram, 'labourRatePaisePerGram');
    assertNonNegativeInt(input.allowanceMg, 'allowanceMg');
    assertNonNegativeInt(input.finishedWeightMg, 'finishedWeightMg');
    assertNonNegativeInt(input.sweepShareMg, 'sweepShareMg');
    assertNonNegativeInt(input.simulatedGoldRatePaisePerGram, 'simulatedGoldRatePaisePerGram');
    assertNonNegativeInt(input.syntheticReferenceRangePaisePerGram.min, 'syntheticReferenceRange.min');
    assertNonNegativeInt(input.syntheticReferenceRangePaisePerGram.max, 'syntheticReferenceRange.max');
    if (input.finishedWeightMg === 0 || input.syntheticReferenceRangePaisePerGram.min > input.syntheticReferenceRangePaisePerGram.max) {
        throw new Error('Finished weight must be positive and the reference range must be ordered.');
    }

    const allowanceValuePaisePerFinishedGram = divideAndRoundInt(
        input.allowanceMg * input.simulatedGoldRatePaisePerGram,
        input.finishedWeightMg
    );
    const sweepValuePaisePerFinishedGram = divideAndRoundInt(
        input.sweepShareMg * input.simulatedGoldRatePaisePerGram,
        input.finishedWeightMg
    );
    const effectiveRatePaisePerFinishedGram =
        input.labourRatePaisePerGram + allowanceValuePaisePerFinishedGram + sweepValuePaisePerFinishedGram;

    return {
        labourPaisePerFinishedGram: input.labourRatePaisePerGram,
        allowanceValuePaisePerFinishedGram,
        sweepValuePaisePerFinishedGram,
        effectiveRatePaisePerFinishedGram,
        outlier: effectiveRatePaisePerFinishedGram < input.syntheticReferenceRangePaisePerGram.min
            || effectiveRatePaisePerFinishedGram > input.syntheticReferenceRangePaisePerGram.max,
    };
}

export function calculateRatePolicyAmounts(input: RatePolicyAmountsInput): { issue: number; return: number; settlement: number } {
    assertNonNegativeInt(input.fineGoldMg, 'fineGoldMg');
    for (const [policy, rate] of Object.entries(input.ratesPaisePerGram)) {
        assertNonNegativeInt(rate, `${policy}RatePaisePerGram`);
    }

    return {
        issue: divideAndRoundInt(input.fineGoldMg * input.ratesPaisePerGram.issue, 1000),
        return: divideAndRoundInt(input.fineGoldMg * input.ratesPaisePerGram.return, 1000),
        settlement: divideAndRoundInt(input.fineGoldMg * input.ratesPaisePerGram.settlement, 1000),
    };
}

export function calculateRateWithShockPaisePerGram(baseRatePaisePerGram: number, shockPercent: number): number {
    assertNonNegativeInt(baseRatePaisePerGram, 'baseRatePaisePerGram');
    if (!Number.isInteger(shockPercent) || shockPercent < -100) {
        throw new Error('Rate shock must be an integer percent greater than or equal to -100.');
    }
    return divideAndRoundInt(baseRatePaisePerGram * (100 + shockPercent), 100);
}

export function calculatePurityRatePaisePerGram(rate24KPaisePerGram: number, purityPerMille: number): number {
    assertNonNegativeInt(rate24KPaisePerGram, 'rate24KPaisePerGram');
    if (!Number.isInteger(purityPerMille) || purityPerMille < 0 || purityPerMille > 999) {
        throw new Error('Purity rate must use a configured per-mille value between 0 and 999.');
    }
    return divideAndRoundInt(rate24KPaisePerGram * purityPerMille, 999);
}

export function calculateGoldValuePaise(fineGoldMg: number, ratePaisePerGram: number): number {
    assertNonNegativeInt(fineGoldMg, 'fineGoldMg');
    assertNonNegativeInt(ratePaisePerGram, 'ratePaisePerGram');
    return divideAndRoundInt(fineGoldMg * ratePaisePerGram, 1000);
}

export function calculateSignedGoldValuePaise(
    goldMg: number,
    purityPerMille: number,
    ratePaisePerGram: number,
): number {
    if (!Number.isInteger(goldMg)) throw new Error('goldMg must be an integer.');
    const value = calculateGoldValuePaise(
        toFineGoldPerMilleMg(Math.abs(goldMg), purityPerMille),
        ratePaisePerGram,
    );
    return goldMg < 0 ? -value : value;
}

export function calculateDailyBriefRankingScore(
    amountPaise: number,
    urgencyScore: number,
    config: DailyBriefRankingConfig,
): number {
    assertNonNegativeInt(amountPaise, 'amountPaise');
    if (!Number.isInteger(urgencyScore) || urgencyScore < 0 || urgencyScore > 100) {
        throw new Error('Daily brief urgency must be an integer from 0 to 100.');
    }
    assertNonNegativeInt(config.amountCapPaise, 'amountCapPaise');
    assertValidBps(config.amountWeightBps, 'amountWeightBps');
    assertValidBps(config.urgencyWeightBps, 'urgencyWeightBps');
    if (config.amountWeightBps + config.urgencyWeightBps !== 10_000) {
        throw new Error('Daily brief ranking weights must total 10000 bps.');
    }
    const amountScoreBps = config.amountCapPaise === 0
        ? 0
        : Math.min(10_000, Math.floor(amountPaise * 10_000 / config.amountCapPaise));
    const urgencyScoreBps = urgencyScore * 100;
    return divideAndRoundInt(
        amountScoreBps * config.amountWeightBps + urgencyScoreBps * config.urgencyWeightBps,
        10_000,
    );
}

export function calculateDailyBriefUrgency(base: number, ageDays: number, perDay: number): number {
    if (!Number.isInteger(base) || base < 0 || base > 100) throw new Error('Urgency base must be an integer from 0 to 100.');
    assertNonNegativeInt(ageDays, 'ageDays');
    assertNonNegativeInt(perDay, 'perDay');
    return Math.min(100, base + ageDays * perDay);
}

export function sumFineGoldMg(...fineGoldMg: number[]): number {
    fineGoldMg.forEach((value) => assertNonNegativeInt(value, 'fineGoldMg'));
    return fineGoldMg.reduce((sum, value) => sum + value, 0);
}

export function calculateDaysOverdue(payByDate: string | Date, asOf: Date): number {
    return Math.max(0, -calculateDaysUntil(payByDate, asOf));
}

export function formatPaiseAsRupees(amountPaise: number): string {
    assertNonNegativeInt(amountPaise, 'amountPaise');
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amountPaise / 100);
}

interface ZonedDateParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
    if (Number.isNaN(date.getTime())) throw new Error('Date must be valid.');
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) => {
        const part = parts.find((entry) => entry.type === type);
        if (!part) throw new Error(`Could not read ${type} in time zone ${timeZone}.`);
        return Number(part.value);
    };
    return {
        year: value('year'),
        month: value('month'),
        day: value('day'),
        hour: value('hour'),
        minute: value('minute'),
        second: value('second'),
    };
}

export function getDateKeyInTimeZone(date: Date, timeZone: string): string {
    const parts = getZonedDateParts(date, timeZone);
    return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

export function isDailyBriefScheduleDue(date: Date, schedule: DailyBriefSchedule): boolean {
    const parts = getZonedDateParts(date, schedule.timeZone);
    return parts.hour * 60 + parts.minute >= schedule.hour * 60 + schedule.minute;
}

export function calculateHoursUntilNextDailyBrief(
    date: Date,
    schedule: DailyBriefSchedule,
): number {
    const parts = getZonedDateParts(date, schedule.timeZone);
    const currentLocalMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    let targetLocalMs = Date.UTC(parts.year, parts.month - 1, parts.day, schedule.hour, schedule.minute);
    if (targetLocalMs <= currentLocalMs) targetLocalMs += 86_400_000;

    let targetUtcMs = targetLocalMs;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const targetParts = getZonedDateParts(new Date(targetUtcMs), schedule.timeZone);
        const targetAsLocalMs = Date.UTC(
            targetParts.year,
            targetParts.month - 1,
            targetParts.day,
            targetParts.hour,
            targetParts.minute,
            targetParts.second,
        );
        targetUtcMs = targetLocalMs - (targetAsLocalMs - targetUtcMs);
    }
    return Math.max(1, Math.ceil((targetUtcMs - date.getTime()) / 3_600_000));
}

export function addHoursToDate(date: Date, hours: number): Date {
    if (Number.isNaN(date.getTime())) throw new Error('Date must be valid.');
    if (!Number.isInteger(hours) || hours < 0) throw new Error('Hours must be a non-negative integer.');
    return new Date(date.getTime() + hours * 3_600_000);
}

export function calculateLabourOwedPaise(
    returnedFinishedMg: number,
    labourRatePaisePerGram: number,
    paidPaise: number,
): number {
    assertNonNegativeInt(returnedFinishedMg, 'returnedFinishedMg');
    assertNonNegativeInt(labourRatePaisePerGram, 'labourRatePaisePerGram');
    assertNonNegativeInt(paidPaise, 'paidPaise');
    const earnedPaise = divideAndRoundInt(returnedFinishedMg * labourRatePaisePerGram, 1000);
    return Math.max(0, earnedPaise - paidPaise);
}

export function calculateCashOwed(
    accruals: Array<{ amountPaise: number; createdAt: string }>,
    paidPaise: number,
    asOf: Date,
): { owedPaise: number; ageDays: number } {
    assertNonNegativeInt(paidPaise, 'paidPaise');
    let remainingPaymentPaise = paidPaise;
    let owedPaise = 0;
    let oldestUnpaidDate: string | null = null;
    for (const accrual of [...accruals].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
        assertNonNegativeInt(accrual.amountPaise, 'accrual.amountPaise');
        const appliedPaymentPaise = Math.min(remainingPaymentPaise, accrual.amountPaise);
        remainingPaymentPaise -= appliedPaymentPaise;
        const remainingAccrualPaise = accrual.amountPaise - appliedPaymentPaise;
        owedPaise += remainingAccrualPaise;
        if (remainingAccrualPaise > 0 && oldestUnpaidDate === null) {
            oldestUnpaidDate = accrual.createdAt;
        }
    }
    return {
        owedPaise,
        ageDays: oldestUnpaidDate ? calculateAgeingDays(oldestUnpaidDate, asOf) : 0,
    };
}

export function calculateCashOwedFromLedger(
    entries: GoldAtLargeOrderInput['cashLedgerEntries'],
    asOf: Date,
): { owedPaise: number; ageDays: number } {
    const accruals: Array<{ amountPaise: number; createdAt: string }> = [];
    let paidPaise = 0;
    for (const entry of entries) {
        if (entry.status !== 'acknowledged') continue;
        if (entry.type === 'return' && entry.labourRatePaisePerGram !== null) {
            assertNonNegativeInt(entry.weightMg, 'cashReturn.weightMg');
            accruals.push({
                amountPaise: divideAndRoundInt(entry.weightMg * entry.labourRatePaisePerGram, 1000),
                createdAt: entry.createdAt,
            });
        } else if (entry.type === 'payment' || entry.type === 'settlement') {
            assertNonNegativeInt(entry.amountPaise, 'cashPayment.amountPaise');
            paidPaise += entry.amountPaise;
        }
    }
    return calculateCashOwed(accruals, paidPaise, asOf);
}

function dayNumber(value: string | Date): number {
    const normalized = value instanceof Date
        ? null
        : value.includes(' ')
            ? value.replace(' ', 'T')
            : value.includes('T')
                ? value
                : `${value}T00:00:00`;
    const parsed = value instanceof Date
        ? value
        : new Date(normalized && /(Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`);
    if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${String(value)}`);
    return Math.floor(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()) / 86_400_000);
}

export function calculateAgeingDays(from: string | Date, asOf: Date): number {
    return Math.max(0, dayNumber(asOf) - dayNumber(from));
}

export function calculateDaysUntil(dueDate: string | Date, asOf: Date): number {
    return dayNumber(dueDate) - dayNumber(asOf);
}

export function calculateGoldAtLargeSummary(input: GoldAtLargeSummaryInput) {
    assertNonNegativeInt(input.currentRatePaisePerGram, 'currentRatePaisePerGram');
    const accountTags: GoldAtLargeLedgerAccount[] = [
        'jeweller_vault',
        'karigar_float',
        'karigar_wip',
        'finished_goods',
        'scrap',
        'refiner',
        'process_loss',
    ];
    const stageTotals = input.stageLabels.map(({ account, label }) => ({
        account,
        label,
        grossMg: 0,
        fineGoldMg: 0,
        valuePaise: 0,
    }));
    const ageing = input.ageingBuckets.map((bucket) => ({
        ...bucket,
        grossMg: 0,
        fineGoldMg: 0,
        valuePaise: 0,
    }));
    const karigarTotals = new Map<string, {
        id: string;
        name: string;
        grossMg: number;
        fineGoldMg: number;
        valuePaise: number;
        openJobsCount: number;
        oldestAgeDays: number;
        orders: Array<Record<string, unknown>>;
    }>();
    const policyTotals = { issue: 0, return: 0, settlement: 0 };
    const karigarPolicyTotals = { issue: 0, return: 0, settlement: 0 };
    let grossGoldMg = 0;
    let fineGoldMg = 0;
    let karigarHeldGrossMg = 0;
    let karigarHeldFineMg = 0;
    let cashOwedPaise = 0;
    let openJobsCount = 0;
    let accountNetGrossMg = 0;
    let accountNetFineMg = 0;

    const orders = input.orders.map((order) => {
        const accountBalances = order.accountBalances;
        for (const account of accountTags) {
            const balance = accountBalances[account];
            if (!Number.isSafeInteger(balance.grossMg) || !Number.isSafeInteger(balance.fineMg)) {
                throw new Error(`Invalid replayed account balance for ${order.id}.${account}.`);
            }
            accountNetGrossMg += balance.grossMg;
            accountNetFineMg += balance.fineMg;
        }
        for (const stage of input.stageLabels) {
            const balance = accountBalances[stage.account];
            assertNonNegativeInt(balance.grossMg, `${order.id}.${stage.account}.grossMg`);
            assertNonNegativeInt(balance.fineMg, `${order.id}.${stage.account}.fineMg`);
        }

        const orderGrossMg = input.stageLabels.reduce(
            (total, stage) => total + accountBalances[stage.account].grossMg,
            0,
        );
        const orderFineMg = input.stageLabels.reduce(
            (total, stage) => total + accountBalances[stage.account].fineMg,
            0,
        );
        const ageDays = order.issueDate ? calculateAgeingDays(order.issueDate, input.asOf) : 0;
        const dueInDays = calculateDaysUntil(order.dueDate, input.asOf);
        const orderValuePaise = calculateGoldValuePaise(orderFineMg, input.currentRatePaisePerGram);
        const cashOwed = calculateCashOwedFromLedger(order.cashLedgerEntries, input.asOf);
        const orderCashOwedPaise = cashOwed.owedPaise;
        const cashAgeDays = cashOwed.ageDays;
        const orderPolicyAmounts = calculateRatePolicyAmounts({
            fineGoldMg: orderFineMg,
            ratesPaisePerGram: order.ratesPaisePerGram,
        });
        const karigarPolicyAmounts = calculateRatePolicyAmounts({
            fineGoldMg: accountBalances.karigar_wip.fineMg,
            ratesPaisePerGram: order.ratesPaisePerGram,
        });
        policyTotals.issue += orderPolicyAmounts.issue;
        policyTotals.return += orderPolicyAmounts.return;
        policyTotals.settlement += orderPolicyAmounts.settlement;
        karigarPolicyTotals.issue += karigarPolicyAmounts.issue;
        karigarPolicyTotals.return += karigarPolicyAmounts.return;
        karigarPolicyTotals.settlement += karigarPolicyAmounts.settlement;
        cashOwedPaise += orderCashOwedPaise;
        grossGoldMg += orderGrossMg;
        fineGoldMg += orderFineMg;
        if (order.status === 'open') openJobsCount += 1;

        for (const stage of stageTotals) {
            stage.grossMg += accountBalances[stage.account].grossMg;
            stage.fineGoldMg += accountBalances[stage.account].fineMg;
        }
        karigarHeldGrossMg += accountBalances.karigar_wip.grossMg;
        karigarHeldFineMg += accountBalances.karigar_wip.fineMg;

        if (orderFineMg > 0 && order.issueDate) {
            const bucket = ageing.find((item) => ageDays >= item.minDays
                && (item.maxDays === null || ageDays <= item.maxDays));
            if (!bucket) throw new Error(`No ageing bucket configured for ${ageDays} days.`);
            bucket.grossMg += orderGrossMg;
            bucket.fineGoldMg += orderFineMg;
        }

        let karigar = karigarTotals.get(order.karigarId);
        if (!karigar) {
            karigar = {
                id: order.karigarId,
                name: order.karigarName,
                grossMg: 0,
                fineGoldMg: 0,
                valuePaise: 0,
                openJobsCount: 0,
                oldestAgeDays: 0,
                orders: [],
            };
            karigarTotals.set(order.karigarId, karigar);
        }
        karigar.grossMg += orderGrossMg;
        karigar.fineGoldMg += orderFineMg;
        karigar.valuePaise += orderValuePaise;
        if (order.status === 'open') karigar.openJobsCount += 1;
        karigar.oldestAgeDays = Math.max(karigar.oldestAgeDays, ageDays);

        const nonZeroStages = input.stageLabels
            .filter((stage) => accountBalances[stage.account].fineMg > 0)
            .map((stage) => stage.label);
        const orderSummary = {
            id: order.id,
            description: order.description,
            status: order.status,
            dueDate: order.dueDate,
            dueInDays,
            daysToDue: Math.max(0, dueInDays),
            daysOverdue: Math.max(0, -dueInDays),
            ageDays,
            stage: nonZeroStages.length > 1 ? 'Multiple stages' : nonZeroStages[0] ?? 'No gold issued',
            grossMg: orderGrossMg,
            fineGoldMg: orderFineMg,
            valuePaise: orderValuePaise,
            cashOwedPaise: orderCashOwedPaise,
            cashAgeDays,
            accountBalances,
            cashPolicyAmountsPaise: orderPolicyAmounts,
            cashPolicyRatesPaisePerGram: order.ratesPaisePerGram,
        };
        karigar.orders.push(orderSummary);
        return { ...orderSummary, karigarId: order.karigarId, karigarName: order.karigarName };
    });

    const stages = stageTotals.map((stage) => ({
        ...stage,
        valuePaise: calculateGoldValuePaise(stage.fineGoldMg, input.currentRatePaisePerGram),
        shareBps: fineGoldMg === 0 ? 0 : divideAndRoundInt(stage.fineGoldMg * 10_000, fineGoldMg),
        sharePercent: fineGoldMg === 0 ? 0 : divideAndRoundInt(stage.fineGoldMg * 10_000, fineGoldMg) / 100,
    }));
    const ageingResult = ageing.map((bucket) => ({
        ...bucket,
        valuePaise: calculateGoldValuePaise(bucket.fineGoldMg, input.currentRatePaisePerGram),
        shareBps: fineGoldMg === 0 ? 0 : divideAndRoundInt(bucket.fineGoldMg * 10_000, fineGoldMg),
        sharePercent: fineGoldMg === 0 ? 0 : divideAndRoundInt(bucket.fineGoldMg * 10_000, fineGoldMg) / 100,
    }));
    const karigars = Array.from(karigarTotals.values())
        .map((karigar) => ({
            ...karigar,
            concentrationBps: fineGoldMg === 0
                ? 0
                : divideAndRoundInt(karigar.fineGoldMg * 10_000, fineGoldMg),
            concentrationPercent: fineGoldMg === 0
                ? 0
                : divideAndRoundInt(karigar.fineGoldMg * 10_000, fineGoldMg) / 100,
        }))
        .sort((left, right) => right.fineGoldMg - left.fineGoldMg);

    const totalValuePaise = calculateGoldValuePaise(fineGoldMg, input.currentRatePaisePerGram);
    return {
        totals: {
            grossMg: grossGoldMg,
            fineGoldMg,
            valuePaise: totalValuePaise,
            valueLakh: formatRupeesAsLakhPaise(totalValuePaise),
            karigarHeldGrossMg,
            karigarHeldFineMg,
            karigarHeldValuePaise: calculateGoldValuePaise(karigarHeldFineMg, input.currentRatePaisePerGram),
            workshopCount: karigars.filter((karigar) => karigar.fineGoldMg > 0).length,
            openJobsCount,
            cashOwedPaise,
        },
        stages,
        ageing: ageingResult,
        karigars,
        orders,
        cashPolicyAmountsPaise: policyTotals,
        karigarCashPolicyAmountsPaise: karigarPolicyTotals,
        replayTotals: {
            grossMg: grossGoldMg,
            fineGoldMg,
            accountNetGrossMg,
            accountNetFineMg,
        },
    };
}

export function parseRupeesToPaise(amount: string): number {
    const trimmed = amount.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
        throw new Error('Rupee amount must be a non-negative number with at most two decimal places.');
    }
    const [rupees, paise = ''] = trimmed.split('.');
    const value = Number(rupees) * 100 + Number(paise.padEnd(2, '0'));
    assertNonNegativeInt(value, 'amountPaise');
    return value;
}

export function parsePercentToBps(percent: string): number {
    const trimmed = percent.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
        throw new Error('Percent must be a non-negative number with at most two decimal places.');
    }
    const [whole, fraction = ''] = trimmed.split('.');
    const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    assertValidBps(value, 'percentBps');
    return value;
}

export interface PurityEntry {
    purityBps: number; // e.g., 9160 for 91.60%
    issuedMg: number;
    returnedFinishedMg: number;
    scrapMg: number;
    wastageRateBps: number; // e.g., 300 for 3.00%
}

export interface PurityBalanceResult {
    purityBps: number;
    issuedGrossMg: number;
    returnedFinishedMg: number;
    scrapMg: number;
    allowedWastageMg: number;
    totalAccountedGrossMg: number;
    /**
     * differenceGrossMg = totalAccountedGrossMg - issuedGrossMg
     * Negative = SHORT (Karigar owes Jeweller)
     * Positive = EXCESS (Jeweller owes Karigar)
     * Zero = SETTLED
     */
    differenceGrossMg: number;
    status: 'SHORT' | 'EXCESS' | 'SETTLED';
    issuedFineMg: number;
    accountedFineMg: number;
    differenceFineMg: number;
}

export interface MultiPuritySummary {
    byPurity: PurityBalanceResult[];
    totalIssuedFineMg: number;
    totalAccountedFineMg: number;
    netDifferenceFineMg: number;
    overallStatus: 'SHORT' | 'EXCESS' | 'SETTLED';
}

/**
 * Asserts that a number is a non-negative integer. Throws if float or negative.
 * @param value Value to check
 * @param label Field name for error messages
 */
export function assertNonNegativeInt(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid ${label}: "${value}". Must be a non-negative integer (no floats allowed).`);
    }
}

/**
 * Asserts that basis points are an integer between 0 and 10000.
 * @param bps Basis points (10000 = 100.00%)
 * @param label Field name for error messages
 */
export function assertValidBps(bps: number, label: string): void {
    if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
        throw new Error(`Invalid ${label}: "${bps}". Must be an integer between 0 and 10000 bps.`);
    }
}

/**
 * Performs exact integer division (numerator / denominator) using the specified rounding rule.
 * Never uses floating-point arithmetic.
 * @param numerator Non-negative integer numerator
 * @param denominator Positive integer denominator
 * @param mode RoundingMode ('HALF_UP' | 'FLOOR' | 'CEIL')
 * @returns Rounded integer result
 */
export function divideAndRoundInt(
    numerator: number,
    denominator: number,
    mode: RoundingMode = 'HALF_UP'
): number {
    assertNonNegativeInt(numerator, 'numerator');
    if (!Number.isInteger(denominator) || denominator <= 0) {
        throw new Error(`Invalid denominator: "${denominator}". Must be a positive integer.`);
    }

    const num = BigInt(numerator);
    const den = BigInt(denominator);
    const quotient = num / den;
    const remainder = num % den;

    if (remainder === 0n) {
        return Number(quotient);
    }

    if (mode === 'FLOOR') {
        return Number(quotient);
    }

    if (mode === 'CEIL') {
        return Number(quotient + 1n);
    }

    // HALF_UP: round up if remainder * 2 >= denominator
    if (remainder * 2n >= den) {
        return Number(quotient + 1n);
    }
    return Number(quotient);
}

/**
 * Converts a string weight representation (e.g. "12.55" g) into integer milligrams
 * using pure string parsing so IEEE-754 floating-point errors never occur.
 * @param amountStr Numeric string such as "10", "10.5", "10.525"
 * @param unit 'mg' | 'g' | 'tola'
 * @param config Optional calculation config (for tola definition)
 * @returns Exact weight in integer milligrams
 */
export function parseUnitToMg(
    amountStr: string,
    unit: WeightUnit,
    config: CalcConfig = DEFAULT_CALC_CONFIG
): number {
    const trimmed = amountStr.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
        throw new Error(`Invalid weight string: "${amountStr}". Must be a non-negative number string.`);
    }

    const [wholePart, fracPart = ''] = trimmed.split('.');

    if (unit === 'mg') {
        if (fracPart.length > 0 && Number(fracPart) !== 0) {
            throw new Error(`Milligrams cannot have fractional parts: "${amountStr}"`);
        }
        return Number(wholePart);
    }

    const unitMultiplierMg = unit === 'g' ? 1000 : config.tolaWeightMg;
    assertNonNegativeInt(unitMultiplierMg, 'unitMultiplierMg');

    // Scale fractional part using integer math
    const fracScale = 10 ** fracPart.length;
    const totalScaledUnits = Number(wholePart) * fracScale + (fracPart ? Number(fracPart) : 0);

    return divideAndRoundInt(totalScaledUnits * unitMultiplierMg, fracScale, config.roundingMode);
}

/**
 * Computes the fine-gold (24K / 10000 bps) equivalent weight in integer milligrams.
 * Formula: (grossMg * purityBps) / 10000
 * @param grossMg Gross gold weight in integer mg
 * @param purityBps Purity in basis points (e.g. 9160 for 91.60%)
 * @param roundingMode Rounding rule to apply
 * @returns Fine gold weight in integer mg
 */
export function toFineGoldMg(
    grossMg: number,
    purityBps: number,
    roundingMode: RoundingMode = 'HALF_UP'
): number {
    assertNonNegativeInt(grossMg, 'grossMg');
    assertValidBps(purityBps, 'purityBps');

    if (grossMg === 0 || purityBps === 0) {
        return 0;
    }

    return divideAndRoundInt(grossMg * purityBps, 10000, roundingMode);
}

/**
 * Computes the allowed wastage in integer milligrams based on configurable convention.
 * @param issuedMg Gross weight issued in mg
 * @param returnedFinishedMg Finished ornament weight returned in mg
 * @param scrapMg Scrap/findings returned in mg
 * @param wastageRateBps Agreed wastage in basis points (e.g. 300 = 3.00%)
 * @param config Calculation configuration
 * @returns Allowed wastage in integer mg
 */
export function computeAllowedWastageMg(
    issuedMg: number,
    returnedFinishedMg: number,
    scrapMg: number,
    wastageRateBps: number,
    config: CalcConfig = DEFAULT_CALC_CONFIG
): number {
    assertNonNegativeInt(issuedMg, 'issuedMg');
    assertNonNegativeInt(returnedFinishedMg, 'returnedFinishedMg');
    assertNonNegativeInt(scrapMg, 'scrapMg');
    assertValidBps(wastageRateBps, 'wastageRateBps');

    let baseWeightMg = 0;

    if (config.wastageBase === 'returned_finished') {
        baseWeightMg = returnedFinishedMg;
    } else if (config.wastageBase === 'issued_gross') {
        baseWeightMg = issuedMg;
    } else if (config.wastageBase === 'issued_minus_scrap') {
        baseWeightMg = Math.max(0, issuedMg - scrapMg);
    }

    if (baseWeightMg === 0 || wastageRateBps === 0) {
        return 0;
    }

    return divideAndRoundInt(baseWeightMg * wastageRateBps, 10000, config.roundingMode);
}

/**
 * Evaluates a single purity bucket for short/excess in both gross mg and fine mg.
 * @param entry PurityEntry containing issued, returned, scrap, and wastage rate
 * @param config Calculation configuration
 * @returns PurityBalanceResult
 */
export function calculatePurityBalance(
    entry: PurityEntry,
    config: CalcConfig = DEFAULT_CALC_CONFIG
): PurityBalanceResult {
    assertValidBps(entry.purityBps, 'purityBps');
    assertNonNegativeInt(entry.issuedMg, 'issuedMg');
    assertNonNegativeInt(entry.returnedFinishedMg, 'returnedFinishedMg');
    assertNonNegativeInt(entry.scrapMg, 'scrapMg');
    assertValidBps(entry.wastageRateBps, 'wastageRateBps');

    const allowedWastageMg = computeAllowedWastageMg(
        entry.issuedMg,
        entry.returnedFinishedMg,
        entry.scrapMg,
        entry.wastageRateBps,
        config
    );

    const totalAccountedGrossMg = entry.returnedFinishedMg + entry.scrapMg + allowedWastageMg;
    const differenceGrossMg = totalAccountedGrossMg - entry.issuedMg;

    const issuedFineMg = toFineGoldMg(entry.issuedMg, entry.purityBps, config.roundingMode);
    const accountedFineMg = toFineGoldMg(totalAccountedGrossMg, entry.purityBps, config.roundingMode);
    const differenceFineMg = accountedFineMg - issuedFineMg;

    let status: 'SHORT' | 'EXCESS' | 'SETTLED' = 'SETTLED';
    if (differenceGrossMg < 0) status = 'SHORT';
    else if (differenceGrossMg > 0) status = 'EXCESS';

    return {
        purityBps: entry.purityBps,
        issuedGrossMg: entry.issuedMg,
        returnedFinishedMg: entry.returnedFinishedMg,
        scrapMg: entry.scrapMg,
        allowedWastageMg,
        totalAccountedGrossMg,
        differenceGrossMg,
        status,
        issuedFineMg,
        accountedFineMg,
        differenceFineMg,
    };
}

/**
 * Aggregates multiple entries across one or more purities, grouping by purityBps
 * and computing both per-purity balances and net fine-gold settlement balance.
 * @param entries List of PurityEntry items
 * @param config Calculation configuration
 * @returns MultiPuritySummary
 */
export function calculateMultiPuritySettlement(
    entries: PurityEntry[],
    config: CalcConfig = DEFAULT_CALC_CONFIG
): MultiPuritySummary {
    const byPurity = entries.map((entry) => calculatePurityBalance(entry, config));

    let totalIssuedFineMg = 0;
    let totalAccountedFineMg = 0;

    for (const res of byPurity) {
        totalIssuedFineMg += res.issuedFineMg;
        totalAccountedFineMg += res.accountedFineMg;
    }

    const netDifferenceFineMg = totalAccountedFineMg - totalIssuedFineMg;
    let overallStatus: 'SHORT' | 'EXCESS' | 'SETTLED' = 'SETTLED';
    if (netDifferenceFineMg < 0) overallStatus = 'SHORT';
    else if (netDifferenceFineMg > 0) overallStatus = 'EXCESS';

    return {
        byPurity,
        totalIssuedFineMg,
        totalAccountedFineMg,
        netDifferenceFineMg,
        overallStatus,
    };
}

export interface DeadlineRiskInput {
    daysLeft: number;
    progressBps: number;
    openJobs: number;
    capacityOpenJobs: number;
    completedJobs: number;
    onTimeJobs: number;
}

export interface DeadlineRiskResult {
    level: DeadlineRiskLevel;
    score: number;
    progressBps: number;
    openLoadBps: number;
    onTimeRateBps: number | null;
    reasons: string[];
}

export interface RescueCandidateInput {
    id: string;
    name: string;
    openJobs: number;
    capacityOpenJobs: number;
    specializations: string[];
    completedJobs: number;
    onTimeJobs: number;
}

export interface RankedRescueCandidate {
    karigarId: string;
    name: string;
    score: number;
    openJobs: number;
    capacityOpenJobs: number;
    onTimeRateBps: number;
    reasons: string[];
}

export function calculateDeadlineRisk(
    input: DeadlineRiskInput,
    config: DeadlineRiskConfig,
): DeadlineRiskResult {
    const reasons: string[] = [];
    let score = 0;
    const openLoadBps = input.capacityOpenJobs > 0
        ? Math.floor(input.openJobs * 10_000 / input.capacityOpenJobs)
        : input.openJobs > 0 ? 10_000 : 0;
    const onTimeRateBps = input.completedJobs > 0
        ? Math.floor(input.onTimeJobs * 10_000 / input.completedJobs)
        : null;

    if (input.daysLeft <= config.imminentDays) {
        score += config.imminentPoints;
        reasons.push('occasion_soon');
    } else if (input.daysLeft <= config.watchDays) {
        score += config.approachingPoints;
        reasons.push('occasion_approaching');
    }

    if (input.daysLeft <= config.progressWindowDays && input.progressBps < config.minimumProgressBps) {
        score += config.stageBehindPoints;
        reasons.push('stage_behind');
    }

    if (openLoadBps >= config.atRiskLoadBps) {
        score += config.overloadedPoints;
        reasons.push('open_load_high');
    } else if (openLoadBps >= config.watchLoadBps) {
        score += config.elevatedLoadPoints;
        reasons.push('open_load_elevated');
    }

    if (onTimeRateBps !== null && input.completedJobs >= config.minimumHistoryJobs) {
        if (onTimeRateBps < config.atRiskOnTimeRateBps) {
            score += config.poorHistoryPoints;
            reasons.push('on_time_history_low');
        } else if (onTimeRateBps < config.watchOnTimeRateBps) {
            score += config.mixedHistoryPoints;
            reasons.push('on_time_history_mixed');
        }
    }

    const level: DeadlineRiskLevel = score >= config.atRiskScore
        ? 'at_risk'
        : score >= config.watchScore ? 'watch' : 'ok';

    return { level, score, progressBps: input.progressBps, openLoadBps, onTimeRateBps, reasons };
}

export function calculateElapsedHours(from: string | Date, to: Date): number {
    const fromTime = from instanceof Date ? from.getTime() : new Date(from).getTime();
    if (!Number.isFinite(fromTime)) throw new Error('Start date is invalid.');
    return Math.floor(Math.max(0, to.getTime() - fromTime) / 3_600_000);
}

export function calculateProgressBps(
    issuedGrossMg: number,
    finishedGrossMg: number,
    scrapGrossMg: number,
): number {
    assertNonNegativeInt(issuedGrossMg, 'issuedGrossMg');
    assertNonNegativeInt(finishedGrossMg, 'finishedGrossMg');
    assertNonNegativeInt(scrapGrossMg, 'scrapGrossMg');
    if (issuedGrossMg === 0) return 0;
    return Math.min(10_000, Math.floor((finishedGrossMg + scrapGrossMg) * 10_000 / issuedGrossMg));
}

export function rankRescueCandidates(input: {
    jobType: string;
    candidates: RescueCandidateInput[];
    config: RescueRankingConfig;
}): RankedRescueCandidate[] {
    return input.candidates
        .filter((candidate) => (
            candidate.capacityOpenJobs > candidate.openJobs
            && candidate.specializations.includes(input.jobType)
            && candidate.completedJobs > 0
            && Math.floor(candidate.onTimeJobs * 10_000 / candidate.completedJobs) >= input.config.minimumOnTimeRateBps
        ))
        .map((candidate) => {
            const onTimeRateBps = Math.floor(candidate.onTimeJobs * 10_000 / candidate.completedJobs);
            const availableCapacityBps = Math.floor(
                (candidate.capacityOpenJobs - candidate.openJobs) * 10_000 / candidate.capacityOpenJobs,
            );
            const score = Math.floor(
                availableCapacityBps * input.config.capacityWeightBps / 10_000
                + onTimeRateBps * input.config.reliabilityWeightBps / 10_000,
            );
            return {
                karigarId: candidate.id,
                name: candidate.name,
                score,
                openJobs: candidate.openJobs,
                capacityOpenJobs: candidate.capacityOpenJobs,
                onTimeRateBps,
                reasons: ['capacity_available', 'specialization_match', 'reliable_history'],
            };
        })
        .sort((left, right) => right.score - left.score || left.karigarId.localeCompare(right.karigarId))
        .slice(0, input.config.maxCandidates);
}