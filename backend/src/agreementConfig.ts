export const JOB_TYPES = ['plain', 'chain', 'handmade', 'stone_set'] as const;
export const AGREEMENT_BASES = ['fine_issued', 'gross_issued', 'finished_weight'] as const;
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
    finishedLots: Array<{ weightMg: number; purityPerMille: number; method: PurityReadMethod }>;
    scrapLots: Array<{ weightMg: number; purityPerMille: number }>;
}

export const AGREEMENT_CONFIG = {
    jobTypes: JOB_TYPES.map((value) => ({
        value,
        label: { plain: 'Plain', chain: 'Chain', handmade: 'Handmade', stone_set: 'Stone-set' }[value],
    })),
    bases: AGREEMENT_BASES.map((value) => ({
        value,
        label: {
            fine_issued: 'Fine gold issued',
            gross_issued: 'Gross gold issued',
            finished_weight: 'Finished weight',
        }[value],
    })),
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
} as const;

export const RETURN_RECONCILIATION_CONFIG = {
    grossWeightToleranceMg: 100,
    purityShortfallToleranceFineMg: 0,
    unusedAllowancePolicy: 'karigar_keeps' as UnusedAllowancePolicy,
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
} as const;

