export type DailyBriefLanguage = 'en' | 'kn';
export type DailyBriefRole = 'jeweller' | 'karigar';

export interface DailyBriefSchedule {
    hour: number;
    minute: number;
    timeZone: string;
    pollIntervalMs: number;
    maxFastForwardHours: number;
}

export interface DailyBriefRankingConfig {
    maxItems: number;
    amountCapPaise: number;
    amountWeightBps: number;
    urgencyWeightBps: number;
    overdueBaseUrgency: number;
    overdueUrgencyPerDay: number;
    pendingBaseUrgency: number;
    pendingUrgencyPerDay: number;
    flagUrgency: number;
    escalatedDisputeUrgency: number;
    atRiskUrgency: number;
    dueTodayUrgency: number;
}

export const DAILY_BRIEF_CONFIG = {
    schedule: {
        hour: 8,
        minute: 0,
        timeZone: 'Asia/Kolkata',
        pollIntervalMs: 60_000,
        maxFastForwardHours: 24,
    } satisfies DailyBriefSchedule,
    ranking: {
        maxItems: 5,
        amountCapPaise: 10_000_000,
        amountWeightBps: 5000,
        urgencyWeightBps: 5000,
        overdueBaseUrgency: 35,
        overdueUrgencyPerDay: 10,
        pendingBaseUrgency: 40,
        pendingUrgencyPerDay: 5,
        flagUrgency: 90,
        escalatedDisputeUrgency: 95,
        atRiskUrgency: 100,
        dueTodayUrgency: 80,
    } satisfies DailyBriefRankingConfig,
    templates: {
        en: {
            title: '{name}’s daily brief',
            noItems: 'No actions need your attention today.',
            atRiskTitle: 'At-risk order',
            atRiskDetail: '{description}: {value} of gold at stake; {daysLeft} days to the customer occasion.',
            overdueTitle: 'Overdue payment',
            overdueDetail: '{description}: {amount} overdue by {overdueDays} days.',
            approvalTitle: 'Approval needed',
            approvalDetail: '{eventType} for {description}: {amount} awaits your acknowledgement.',
            flagTitle: 'Flag for review',
            flagDetail: '{reason} for {description}: {amount} at stake.',
            disputeTitle: 'Owner review needed',
            disputeDetail: '{description}: {reason}; escalation open for {ageDays} days.',
            dueTodayTitle: 'Due today',
            dueTodayDetail: '{description} is due today.',
            owedTitle: 'Cash owed',
            owedDetail: '{description}: {amount} owed; {ageDays} days old; {overdueDays} days overdue.',
        },
        kn: {
            title: '{name} ಅವರ ದೈನಂದಿನ ಮಾಹಿತಿ',
            noItems: 'ಇಂದು ಗಮನಿಸಬೇಕಾದ ಕೆಲಸಗಳಿಲ್ಲ.',
            atRiskTitle: 'ಅಪಾಯದಲ್ಲಿರುವ ಕೆಲಸ',
            atRiskDetail: '{description}: {value} ಮೌಲ್ಯದ ಚಿನ್ನ ಅಪಾಯದಲ್ಲಿದೆ; ಗ್ರಾಹಕರ ಕಾರ್ಯಕ್ರಮಕ್ಕೆ {daysLeft} ದಿನಗಳಿವೆ.',
            overdueTitle: 'ವಿಳಂಬವಾದ ಪಾವತಿ',
            overdueDetail: '{description}: {amount} ಪಾವತಿ {overdueDays} ದಿನಗಳಿಂದ ಬಾಕಿಯಿದೆ.',
            approvalTitle: 'ಒಪ್ಪಿಗೆ ಅಗತ್ಯ',
            approvalDetail: '{description} ಕೆಲಸದ {eventType}: {amount} ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತಿದೆ.',
            flagTitle: 'ಪರಿಶೀಲನೆಗೆ ಸೂಚನೆ',
            flagDetail: '{description} ಕೆಲಸದಲ್ಲಿ {reason}: {amount} ಮೌಲ್ಯ ಪರಿಶೀಲನೆಯಲ್ಲಿದೆ.',
            disputeTitle: 'ಮಾಲೀಕರ ಪರಿಶೀಲನೆ ಅಗತ್ಯ',
            disputeDetail: '{description}: {reason}; {ageDays} ದಿನಗಳಿಂದ ವಿವಾದ ತೆರೆದಿದೆ.',
            dueTodayTitle: 'ಇಂದು ಗಡುವು',
            dueTodayDetail: '{description} ಕೆಲಸಕ್ಕೆ ಇಂದು ಗಡುವು.',
            owedTitle: 'ಬಾಕಿ ನಗದು',
            owedDetail: '{description}: {amount} ಬಾಕಿ; {ageDays} ದಿನಗಳಿಂದ ಇದೆ; {overdueDays} ದಿನ ವಿಳಂಬವಾಗಿದೆ.',
        },
    } satisfies Record<DailyBriefLanguage, Record<string, string>>,
    demo: {
        dueTodayOrderId: 'ord-daily-brief-due-today',
        dueTodayDescription: 'Plain bangles due today',
        jewellerApprovalOrderId: 'ord-daily-brief-pending-return',
        jewellerApprovalDescription: 'Plain bangles awaiting return approval',
        issuedGrossMg: 100_000,
        issuedPurityPerMille: 916,
        pendingReturnGrossMg: 10_000,
        pendingPaymentAmountPaise: 45_000,
    },
} as const;
