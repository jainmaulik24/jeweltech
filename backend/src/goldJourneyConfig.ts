export const GOLD_JOURNEY_CONFIG = {
    stages: [
        { id: 'casting', label: 'Casting' },
        { id: 'filing', label: 'Filing' },
        { id: 'setting', label: 'Setting' },
        { id: 'polish', label: 'Polish' },
        { id: 'reassignment', label: 'Reassignment' },
    ],
    demo: {
        orderId: 'ord-gold-journey-demo',
        description: 'Bangles · three-stage gold journey',
        issueWeightMg: 100_000,
        purityPerMille: 916,
        handoffs: [
            { stage: 'casting', from: 'k1', to: 'k2', receivedWeightMg: 99_800 },
            { stage: 'filing', from: 'k2', to: 's1', receivedWeightMg: 99_400 },
            { stage: 'polish', from: 's1', to: 'j1', receivedWeightMg: 99_000 },
        ],
    },
} as const;

export type GoldJourneyStage = (typeof GOLD_JOURNEY_CONFIG.stages)[number]['id'];
