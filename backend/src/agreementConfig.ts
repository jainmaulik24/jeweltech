export const JOB_TYPES = ['plain', 'chain', 'handmade', 'stone_set'] as const;
export const AGREEMENT_BASES = ['ideal_return_buffer', 'fine_issued', 'gross_issued', 'finished_weight'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export type SweepOwner = 'karigar' | 'jeweller' | 'split';
export type CashRatePolicy = 'issue' | 'return' | 'settlement';
export type PurityReadMethod = 'touch' | 'XRF' | 'declared';
export type UnusedAllowancePolicy = 'karigar_keeps' | 'return_to_jeweller';

export const PURITY_TABLE = [
    { perMille: 999, label: '24K' },
    { perMille: 958, label: '23K' },
    { perMille: 916, label: '22K' },
    { perMille: 833, label: '20K' },
    { perMille: 750, label: '18K' },
    { perMille: 585, label: '14K' },
] as const;

interface DemoReturnScenario {
    orderId: string;
    label: string;
    description: string;
    issuedGrossMg?: number;
    issuedPurityPerMille?: number;
    targetWeightMg?: number;
    finishedLots: Array<{
        weightMg: number;
        purityPerMille: number;
        method: PurityReadMethod;
        stoneWeightMg?: number;
        otherNonGoldWeightMg?: number;
    }>;
    scrapLots?: Array<{ weightMg: number; purityPerMille: number }>;
}

export const AGREEMENT_CONFIG = {
    jobTypes: JOB_TYPES.map((value) => ({
        value,
        label: { plain: 'Plain', chain: 'Chain', handmade: 'Handmade', stone_set: 'Stone-set' }[value],
    })),
    bases: AGREEMENT_BASES.map((value) => ({
        value,
        label: {
            ideal_return_buffer: 'Ideal return with 2% buffer',
            fine_issued: 'Fine gold issued',
            gross_issued: 'Gross gold issued',
            finished_weight: 'Finished weight',
        }[value],
    })),
    idealReturnFactorBp: 10_860,
    bufferBp: 200,
    idealReturnPurityPerMille: 916,
    perPiecePayPaise: { buffing: 0, cutting: 0, polish: 0 },
    theoreticalAlloyFactorNumerator: 12,
    theoreticalAlloyFactorDenominator: 11,
    syntheticReferenceRangePaisePerGram: { min: 25_000, max: 32_000 },
    demo: {
        issuedGrossMg: 20_000,
        issuedPurityPerMille: 916,
        finishedWeightMg: 18_000,
        estimatedSweepMg: 180,
        simulatedRatesPaisePerGram: {
            issue: 700_000,
            return: 720_000,
            settlement: 750_000,
        },
    },
    fairPayDemo: {
        issuedGrossMg: 100_000,
        issuedPurityPerMille: 999,
        finishedWeightMg: 107_500,
        pieceCounts: { buffing: 1, cutting: 1, polish: 1 },
    },
} as const;

export const RETURN_RECONCILIATION_CONFIG = {
    grossWeightToleranceMg: 100,
    purityShortfallToleranceFineMg: 0,
    unusedAllowancePolicy: 'karigar_keeps' as UnusedAllowancePolicy,
    targetWeightMg: 10_000,
    targetToleranceMg: 100,
    purityReadLabel: 'SIMULATED',
    purities: PURITY_TABLE,
    demoScenarios: [
        {
            orderId: 'ord-return-purity-mismatch',
            label: 'Purity mismatch',
            description: 'Plain bangles - Purity check sample',
            finishedLots: [{ weightMg: 100_000, purityPerMille: 833, method: 'XRF' }],
            scrapLots: [] as DemoReturnScenario['scrapLots'],
        },
        {
            orderId: 'ord-return-within-allowance',
            label: 'Within allowance',
            description: 'Plain bangles - Within allowance sample',
            finishedLots: [{ weightMg: 98_000, purityPerMille: 916, method: 'touch' }],
            scrapLots: [] as DemoReturnScenario['scrapLots'],
        },
        {
            orderId: 'ord-return-over-allowance',
            label: 'Over allowance',
            description: 'Plain bangles - Allowance review sample',
            finishedLots: [{ weightMg: 96_000, purityPerMille: 916, method: 'declared' }],
            scrapLots: [] as DemoReturnScenario['scrapLots'],
        },
        {
            orderId: 'ord-return-excess',
            label: 'Excess return',
            description: 'Plain bangles - Excess review sample',
            finishedLots: [{ weightMg: 102_000, purityPerMille: 916, method: 'XRF' }],
            scrapLots: [] as DemoReturnScenario['scrapLots'],
        },
    ] satisfies DemoReturnScenario[],
    idealReturnScenarios: [
        {
            orderId: 'ord-return-ideal-within',
            label: 'Ideal return · within buffer',
            description: '100 g 24K issue, 107.5 g 22K return',
            issuedGrossMg: 100_000,
            issuedPurityPerMille: 999,
            targetWeightMg: 108_600,
            finishedLots: [{ weightMg: 107_500, purityPerMille: 916, method: 'XRF' as const, stoneWeightMg: 0, otherNonGoldWeightMg: 0 }],
        },
        {
            orderId: 'ord-return-ideal-short',
            label: 'Ideal return · short',
            description: '100 g 24K issue, 105 g 22K return',
            issuedGrossMg: 100_000,
            issuedPurityPerMille: 999,
            targetWeightMg: 108_600,
            finishedLots: [{ weightMg: 105_000, purityPerMille: 916, method: 'XRF' as const, stoneWeightMg: 0, otherNonGoldWeightMg: 0 }],
        },
        {
            orderId: 'ord-return-ideal-above',
            label: 'Ideal return · above ideal',
            description: '100 g 24K issue, 109 g 22K return',
            issuedGrossMg: 100_000,
            issuedPurityPerMille: 999,
            targetWeightMg: 108_600,
            finishedLots: [{ weightMg: 109_000, purityPerMille: 916, method: 'XRF' as const, stoneWeightMg: 0, otherNonGoldWeightMg: 0 }],
        },
        {
            orderId: 'ord-return-stone-set',
            label: 'Stone-set net gold',
            description: '10 g piece with 0.6 g stone and 9.4 g gold',
            issuedGrossMg: 10_000,
            issuedPurityPerMille: 999,
            targetWeightMg: 9_400,
            finishedLots: [{ weightMg: 10_000, purityPerMille: 916, method: 'XRF' as const, stoneWeightMg: 600, otherNonGoldWeightMg: 0 }],
        },
        {
            orderId: 'ord-return-target-over',
            label: 'Target weight · 0.5 g over',
            description: '10.5 g delivery against a 10 g target',
            issuedGrossMg: 10_000,
            issuedPurityPerMille: 999,
            targetWeightMg: 10_000,
            finishedLots: [{ weightMg: 10_500, purityPerMille: 916, method: 'XRF' as const, stoneWeightMg: 0, otherNonGoldWeightMg: 0 }],
        },
    ] satisfies DemoReturnScenario[],
} as const;

