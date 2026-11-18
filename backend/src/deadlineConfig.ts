export type DeadlineLanguage = 'en' | 'kn';
export type DeadlineRiskLevel = 'ok' | 'watch' | 'at_risk';

export interface DeadlineRiskConfig {
    imminentDays: number;
    watchDays: number;
    progressWindowDays: number;
    minimumProgressBps: number;
    watchLoadBps: number;
    atRiskLoadBps: number;
    minimumHistoryJobs: number;
    watchOnTimeRateBps: number;
    atRiskOnTimeRateBps: number;
    imminentPoints: number;
    approachingPoints: number;
    stageBehindPoints: number;
    overloadedPoints: number;
    elevatedLoadPoints: number;
    poorHistoryPoints: number;
    mixedHistoryPoints: number;
    watchScore: number;
    atRiskScore: number;
}

export interface RescueRankingConfig {
    maxCandidates: number;
    minimumOnTimeRateBps: number;
    capacityWeightBps: number;
    reliabilityWeightBps: number;
}

export const DEADLINE_CONFIG = {
    silenceHours: 24,
    maxFastForwardHours: 168,
    fastForwardStepHours: 24,
    defaultOccasionLeadDays: 7,
    defaultCapacityOpenJobs: 3,
    risk: {
        imminentDays: 10,
        watchDays: 14,
        progressWindowDays: 14,
        minimumProgressBps: 5000,
        watchLoadBps: 8000,
        atRiskLoadBps: 10000,
        minimumHistoryJobs: 3,
        watchOnTimeRateBps: 7500,
        atRiskOnTimeRateBps: 5000,
        imminentPoints: 25,
        approachingPoints: 15,
        stageBehindPoints: 30,
        overloadedPoints: 25,
        elevatedLoadPoints: 15,
        poorHistoryPoints: 20,
        mixedHistoryPoints: 10,
        watchScore: 30,
        atRiskScore: 60,
    } satisfies DeadlineRiskConfig,
    rescue: {
        maxCandidates: 2,
        minimumOnTimeRateBps: 5000,
        capacityWeightBps: 5000,
        reliabilityWeightBps: 5000,
    } satisfies RescueRankingConfig,
    rescueOptions: [
        {
            value: 'lend_backup_piece',
            label: 'Lend a backup piece for the occasion',
            draftOnly: true,
        },
    ],
    templates: {
        en: {
            nudge: '{name}, the customer occasion is in {daysLeft} days. Please share your work progress.',
            escalation: 'No reply was recorded after {hours} hours. A rescue plan is ready for review.',
            duesNudge: 'A payment of {amount} is past its pay-by date by {daysOverdue} days. Please review it.',
            duesAgeing: 'Your payment of {amount} is {daysOverdue} days past its pay-by date.',
            ownerEscalation: 'Staff-created payment {amount} is overdue by {daysOverdue} days. Owner review requested.',
            etaDraft: 'We are arranging a backup workshop for the order. The customer occasion is {occasionDate}; please confirm a revised delivery estimate before sending.',
        },
        kn: {
            nudge: '{name}, ಗ್ರಾಹಕರ ಕಾರ್ಯಕ್ರಮಕ್ಕೆ ಇನ್ನೂ {daysLeft} ದಿನಗಳಿವೆ. ದಯವಿಟ್ಟು ಕೆಲಸದ ಪ್ರಗತಿ ತಿಳಿಸಿ.',
            escalation: '{hours} ಗಂಟೆಗಳಾದರೂ ಉತ್ತರ ಬಂದಿಲ್ಲ. ಪರಿಶೀಲನೆಗಾಗಿ ಪರ್ಯಾಯ ಕೆಲಸದ ಯೋಜನೆ ಸಿದ್ಧವಾಗಿದೆ.',
            duesNudge: '{amount} ಪಾವತಿಯ ಗಡುವು ದಾಟಿ {daysOverdue} ದಿನಗಳಾಗಿದೆ. ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ.',
            duesAgeing: 'ನಿಮ್ಮ {amount} ಪಾವತಿಯ ಗಡುವು ದಾಟಿ {daysOverdue} ದಿನಗಳಾಗಿದೆ.',
            ownerEscalation: 'ಸಿಬ್ಬಂದಿ ದಾಖಲಿಸಿದ {amount} ಪಾವತಿ {daysOverdue} ದಿನಗಳಿಂದ ಬಾಕಿಯಿದೆ. ಮಾಲೀಕರ ಪರಿಶೀಲನೆ ಅಗತ್ಯ.',
            etaDraft: 'ಈ ಆರ್ಡರ್‌ಗೆ ಪರ್ಯಾಯ ಕಾರ್ಯಾಗಾರವನ್ನು ವ್ಯವಸ್ಥೆ ಮಾಡುತ್ತಿದ್ದೇವೆ. ಗ್ರಾಹಕರ ಕಾರ್ಯಕ್ರಮದ ದಿನಾಂಕ {occasionDate}; ಕಳುಹಿಸುವ ಮೊದಲು ಹೊಸ ವಿತರಣಾ ಸಮಯವನ್ನು ದೃಢಪಡಿಸಿ.',
        },
    } satisfies Record<DeadlineLanguage, Record<string, string>>,
} as const;

export const DEADLINE_DEMO_CONFIG = {
    wedding: {
        orderId: 'ord-wedding-deadline',
        description: 'Wedding bangles — deadline rescue',
        jobType: 'plain',
        occasionInDays: 10,
        issuedGrossMg: 100_000,
        issuedPurityPerMille: 916,
    },
    overdueDues: {
        id: 'due-overdue-demo',
        orderId: 'ord-gold-board-k1',
        amountPaise: 160_000,
        overdueByDays: 2,
    },
    karigarProfiles: [
        { userId: 'k1', language: 'kn', capacityOpenJobs: 3, specializations: ['plain', 'chain'], completedJobs: 4, onTimeJobs: 1 },
        { userId: 'k2', language: 'en', capacityOpenJobs: 8, specializations: ['plain', 'chain'], completedJobs: 5, onTimeJobs: 4 },
        { userId: 'k3', language: 'kn', capacityOpenJobs: 8, specializations: ['handmade', 'stone_set'], completedJobs: 4, onTimeJobs: 3 },
        { userId: 'k4', language: 'en', capacityOpenJobs: 6, specializations: ['stone_set', 'handmade'], completedJobs: 5, onTimeJobs: 4 },
        { userId: 'k5', language: 'kn', capacityOpenJobs: 8, specializations: ['plain'], completedJobs: 4, onTimeJobs: 3 },
        { userId: 'k6', language: 'kn', capacityOpenJobs: 6, specializations: ['chain'], completedJobs: 3, onTimeJobs: 2 },
    ],
} as const;
