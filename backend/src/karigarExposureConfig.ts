export type ExposureSignalCode =
    | 'draw_rate'
    | 'gold_age'
    | 'missed_promises'
    | 'concentration'
    | 'purity_shortfall'
    | 'loss_history'
    | 'peer_comparison';

export const KARIGAR_EXPOSURE_CONFIG = {
    drawRateWindowDays: 30,
    expectedReturnPurityPerMille: 916,
    weights: {
        draw_rate: 18,
        gold_age: 18,
        missed_promises: 18,
        concentration: 14,
        purity_shortfall: 14,
        loss_history: 8,
        peer_comparison: 10,
    } satisfies Record<ExposureSignalCode, number>,
    thresholds: {
        drawCoverageWatchDays: 45,
        drawCoverageHighDays: 90,
        goldAgeWatchDays: 14,
        goldAgeHighDays: 30,
        missedPromisesWatch: 1,
        missedPromisesHigh: 3,
        concentrationWatchBps: 6_000,
        concentrationHighBps: 8_000,
        purityShortfallWatchCount: 1,
        purityShortfallHighCount: 3,
        purityShortfallDays: 90,
        ownLossWatchDeltaBps: 300,
        ownLossHighDeltaBps: 700,
        peerLossWatchDeltaBps: 500,
        peerLossHighDeltaBps: 1_000,
        cleanLossMaxBps: 500,
        recentLossDays: 30,
        historyLossDays: 180,
    },
    riskLevels: {
        watchScore: 4,
        highScore: 45,
    },
    peerComparisonEnabled: false,
    trustTiers: [
        { id: 'starting', label: 'Starting', minCleanReturns: 0, floatLimitMg: 100_000 },
        { id: 'steady', label: 'Steady', minCleanReturns: 3, floatLimitMg: 150_000 },
        { id: 'trusted', label: 'Trusted', minCleanReturns: 8, floatLimitMg: 250_000 },
    ],
    staffLargeIssueMg: 50_000,
    recommendations: {
        watch: [
            { code: 'request_weigh_in', label: 'Request a weigh-in together.' },
        ],
        high: [
            { code: 'pause_new_issues', label: 'Consider pausing new issues until the balance is checked.' },
            { code: 'request_weigh_in', label: 'Request a weigh-in together.' },
            { code: 'notify_owner', label: 'Notify the owner to review this exposure.' },
        ],
    },
    sentences: {
        steady: 'Your gold is being tracked with regular checks; ask us if you want to weigh it together.',
    },
    karigarSignalSentences: {
        draw_rate: 'Your float may be more than your recent work pace needs; let us check it together.',
        gold_age: 'Some gold has been with you longer than usual; let us weigh it together soon.',
        missed_promises: 'Some open work is past its promised return date; let us check the gold together.',
        concentration: 'A large share of this shop’s gold is with you; let us review the balance together.',
        purity_shortfall: 'A recent gold return was below the configured purity reading; let us check it together.',
        loss_history: 'Recent gold loss is above your own earlier average; let us review the weights together.',
        peer_comparison: 'Recent gold loss is above the comparison reference; let us review the weights together.',
    } satisfies Record<ExposureSignalCode, string>,
    replay: {
        label: 'SYNTHETIC',
        days: 90,
        startingExposureMg: 20_000,
        dailyIssueMg: 1_000,
        earlyReturnMg: 800,
        earlyPhaseThroughDay: 29,
        slowingReturnMg: 300,
        slowingPhaseThroughDay: 59,
    },
    demoScenario: {
        name: 'SYNTHETIC 90-day float exposure replay',
        jewellerId: 'j1',
        karigarId: 'k6',
        floatId: 'float-exposure-replay-demo',
        floatOrderId: 'ord-exposure-replay-float',
        workOrderId: 'ord-exposure-replay-work',
        openingFloatMg: 20_000,
        stages: [
            { day: 30, issueMg: 20_000, returnMg: 15_000 },
            { day: 60, issueMg: 25_000, returnMg: 7_500 },
            { day: 89, issueMg: 35_000, returnMg: 0 },
        ],
    },
} as const;
