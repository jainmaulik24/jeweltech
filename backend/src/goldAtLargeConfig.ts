import type { AccountTag } from './schema';

export interface GoldAtLargeDemoJob {
    orderId: string;
    karigarId: string;
    description: string;
    ageDays: number;
    dueInDays: number;
    issuedGrossMg: number;
    issuedPurityPerMille: number;
    returnedFinishedMg: number;
    scrapGrossMg: number;
    refinerGrossMg: number;
    labourRatePaisePerGram: number;
}

export const GOLD_RATE_CONFIG = {
    label: 'SIMULATED',
    series: [
        { effectiveDate: '2026-10-12', rate24KPaisePerGram: 680_000 },
        { effectiveDate: '2026-10-23', rate24KPaisePerGram: 690_000 },
        { effectiveDate: '2026-11-02', rate24KPaisePerGram: 700_000 },
        { effectiveDate: '2026-11-06', rate24KPaisePerGram: 710_000 },
        { effectiveDate: '2026-11-10', rate24KPaisePerGram: 720_000 },
        { effectiveDate: '2026-11-14', rate24KPaisePerGram: 730_000 },
        { effectiveDate: '2026-11-15', rate24KPaisePerGram: 740_000 },
        { effectiveDate: '2026-11-16', rate24KPaisePerGram: 750_000 },
    ],
    shock: {
        minPercent: -20,
        maxPercent: 20,
        stepPercent: 5,
        defaultPercent: 0,
    },
} as const;

export const GOLD_AT_LARGE_CONFIG = {
    physicalAccounts: [
        { account: 'karigar_wip', label: 'At workshop' },
        { account: 'finished_goods', label: 'Finished goods' },
        { account: 'scrap', label: 'Scrap / sweepings' },
        { account: 'refiner', label: 'At refiner' },
    ] satisfies Array<{ account: AccountTag; label: string }>,
    ageingBuckets: [
        { label: '0-7 days', minDays: 0, maxDays: 7 },
        { label: '8-14 days', minDays: 8, maxDays: 14 },
        { label: '15-30 days', minDays: 15, maxDays: 30 },
        { label: '31+ days', minDays: 31, maxDays: null },
    ],
    demoJobs: [
        {
            orderId: 'ord-gold-board-k1',
            karigarId: 'k1',
            description: 'Plain bangles - Ramesh',
            ageDays: 35,
            dueInDays: -3,
            issuedGrossMg: 100_000,
            issuedPurityPerMille: 916,
            returnedFinishedMg: 40_000,
            scrapGrossMg: 0,
            refinerGrossMg: 0,
            labourRatePaisePerGram: 4_000,
        },
        {
            orderId: 'ord-gold-board-k2',
            karigarId: 'k2',
            description: 'Gold chain - workshop',
            ageDays: 24,
            dueInDays: 2,
            issuedGrossMg: 80_000,
            issuedPurityPerMille: 916,
            returnedFinishedMg: 0,
            scrapGrossMg: 0,
            refinerGrossMg: 0,
            labourRatePaisePerGram: 4_500,
        },
        {
            orderId: 'ord-gold-board-k3',
            karigarId: 'k3',
            description: 'Handmade earrings - sweepings',
            ageDays: 14,
            dueInDays: 5,
            issuedGrossMg: 60_000,
            issuedPurityPerMille: 916,
            returnedFinishedMg: 0,
            scrapGrossMg: 2_000,
            refinerGrossMg: 0,
            labourRatePaisePerGram: 5_000,
        },
        {
            orderId: 'ord-gold-board-k4',
            karigarId: 'k4',
            description: 'Stone-set work - refining',
            ageDays: 10,
            dueInDays: 10,
            issuedGrossMg: 50_000,
            issuedPurityPerMille: 916,
            returnedFinishedMg: 0,
            scrapGrossMg: 5_000,
            refinerGrossMg: 3_000,
            labourRatePaisePerGram: 5_000,
        },
        {
            orderId: 'ord-gold-board-k5',
            karigarId: 'k5',
            description: 'Plain bangles - finished lot',
            ageDays: 6,
            dueInDays: -1,
            issuedGrossMg: 70_000,
            issuedPurityPerMille: 999,
            returnedFinishedMg: 30_000,
            scrapGrossMg: 0,
            refinerGrossMg: 0,
            labourRatePaisePerGram: 5_000,
        },
        {
            orderId: 'ord-gold-board-k6',
            karigarId: 'k6',
            description: 'Chain work - in progress',
            ageDays: 2,
            dueInDays: 14,
            issuedGrossMg: 35_000,
            issuedPurityPerMille: 958,
            returnedFinishedMg: 0,
            scrapGrossMg: 0,
            refinerGrossMg: 0,
            labourRatePaisePerGram: 4_000,
        },
    ] satisfies GoldAtLargeDemoJob[],
} as const;
