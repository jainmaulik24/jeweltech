export type DisputeResolutionOption =
    | 'reweigh_together'
    | 'apply_agreement'
    | 'split_capped_difference'
    | 'carry_to_next_job'
    | 'escalate_to_human';

export const DISPUTE_CONFIG = {
    demo: {
        orderId: 'ord-dispute-demo',
        description: 'Dispute sample - bangles',
        issueWeightMg: 10_000,
        returnWeightMg: 8_000,
        claimedWeightMg: 8_500,
        purityPerMille: 916,
        agreementPercentBps: 200,
    },
    splitDifferenceCapMg: 1_000,
    splitDifferenceCapPaise: 100_000,
    splitDifferenceCapPurityPerMille: 25,
    carryDefaultPurityPerMille: 916,
    maxEvidenceBytes: 2_000_000,
    maxEvidenceAttachments: 3,
    allowedEvidenceMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
    resolutionOptions: [
        {
            value: 'reweigh_together',
            label: { en: 'Re-weigh together', kn: 'ಒಟ್ಟಿಗೆ ಮರುತೂಕ ಮಾಡಿ' },
            explanation: {
                en: 'Record the weight or amount both sides agree on after checking it together.',
                kn: 'ಒಟ್ಟಿಗೆ ಪರಿಶೀಲಿಸಿದ ನಂತರ ಇಬ್ಬರೂ ಒಪ್ಪಿದ ತೂಕ ಅಥವಾ ಮೊತ್ತವನ್ನು ದಾಖಲಿಸಿ.',
            },
        },
        {
            value: 'apply_agreement',
            label: { en: 'Apply the agreement as written', kn: 'ಒಪ್ಪಂದವನ್ನು ಇದ್ದಂತೆಯೇ ಅನ್ವಯಿಸಿ' },
            explanation: {
                en: 'Use the original entry and its pinned agreement version and rate snapshot.',
                kn: 'ಮೂಲ ದಾಖಲೆಯಲ್ಲಿರುವ ಆವೃತ್ತಿ ಮತ್ತು ದರದ ಪ್ರಕಾರ ಒಪ್ಪಂದವನ್ನು ಅನ್ವಯಿಸಿ.',
            },
        },
        {
            value: 'split_capped_difference',
            label: { en: 'Split a capped difference', kn: 'ಮಿತಿಯೊಳಗೆ ವ್ಯತ್ಯಾಸ ಹಂಚಿಕೊಳ್ಳಿ' },
            explanation: {
                en: 'Split the difference, but never move more than the configured cap.',
                kn: 'ವ್ಯತ್ಯಾಸವನ್ನು ಹಂಚಿಕೊಳ್ಳಿ; ಆದರೆ ನಿಗದಿತ ಮಿತಿಗಿಂತ ಹೆಚ್ಚು ಅಲ್ಲ.',
            },
        },
        {
            value: 'carry_to_next_job',
            label: { en: 'Carry difference to next job', kn: 'ವ್ಯತ್ಯಾಸವನ್ನು ಮುಂದಿನ ಕೆಲಸಕ್ಕೆ ವರ್ಗಾಯಿಸಿ' },
            explanation: {
                en: 'Carry the signed difference in milligrams or paise to the next shared job; both sides must acknowledge it.',
                kn: 'ಮಿಲಿಗ್ರಾಂ ಅಥವಾ ಪೈಸೆಯಲ್ಲಿರುವ ವ್ಯತ್ಯಾಸವನ್ನು ಮುಂದಿನ ಹಂಚಿಕೊಂಡ ಕೆಲಸಕ್ಕೆ ವರ್ಗಾಯಿಸಿ; ಇಬ್ಬರೂ ಒಪ್ಪಬೇಕು.',
            },
        },
        {
            value: 'escalate_to_human',
            label: { en: 'Escalate to a human', kn: 'ಮಾಲೀಕರ ಪರಿಶೀಲನೆಗೆ ಕಳುಹಿಸಿ' },
            explanation: {
                en: 'Keep the dispute open for owner review. No ledger adjustment is made until the owner chooses an outcome.',
                kn: 'ಮಾಲೀಕರ ಪರಿಶೀಲನೆಗೆ ವಿವಾದವನ್ನು ತೆರೆದಿಡಿ. ಮಾಲೀಕರು ನಿರ್ಧರಿಸುವವರೆಗೆ ಲೆಡ್ಜರ್ ಬದಲಾಗುವುದಿಲ್ಲ.',
            },
        },
    ] satisfies Array<{
        value: DisputeResolutionOption;
        label: Record<'en' | 'kn', string>;
        explanation: Record<'en' | 'kn', string>;
    }>,
} as const;
