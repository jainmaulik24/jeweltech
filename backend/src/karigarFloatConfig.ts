export const KARIGAR_FLOAT_CONFIG = {
    defaultPurityPerMille: 999,
    targetFloatMg: 100_000,
    settlementThresholdMg: 20_000,
    demo: {
        floatId: 'float-demo-ramesh',
        ledgerOrderId: 'ord-float-demo-ramesh',
        jewellerId: 'j1',
        karigarId: 'k1',
        weightMg: 100_000,
        purityPerMille: 999,
        draws: [
            { orderId: 'ord-float-draw-one', description: 'Float draw · bangles', weightMg: 20_000 },
            { orderId: 'ord-float-draw-two', description: 'Float draw · chain', weightMg: 20_000 },
            { orderId: 'ord-float-draw-three', description: 'Float draw · ring', weightMg: 20_000 },
        ],
    },
} as const;
