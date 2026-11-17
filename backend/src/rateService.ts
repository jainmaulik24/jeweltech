import { calculatePurityRatePaisePerGram, calculateRateWithShockPaisePerGram } from './calc';
import { PURITY_TABLE } from './agreementConfig';
import { GOLD_RATE_CONFIG } from './goldAtLargeConfig';

export interface RateQuote {
    label: typeof GOLD_RATE_CONFIG.label;
    requestedDate: string;
    sourceDate: string;
    purityPerMille: number;
    baseRatePaisePerGram: number;
    rate24KPaisePerGram: number;
    ratePaisePerGram: number;
    shockPercent: number;
}

export function getRate(
    date: Date,
    purityPerMille = 999,
    shockPercent: number = GOLD_RATE_CONFIG.shock.defaultPercent,
): RateQuote {
    if (Number.isNaN(date.getTime())) throw new Error('Rate date must be valid.');
    if (!PURITY_TABLE.some((purity) => purity.perMille === purityPerMille)) {
        throw new Error('Rate purity must match a configured fineness-table value.');
    }
    if (!Number.isInteger(shockPercent)
        || shockPercent < GOLD_RATE_CONFIG.shock.minPercent
        || shockPercent > GOLD_RATE_CONFIG.shock.maxPercent) {
        throw new Error(
            `Rate shock must be an integer between ${GOLD_RATE_CONFIG.shock.minPercent}% and ${GOLD_RATE_CONFIG.shock.maxPercent}%.`,
        );
    }

    const requestedDate = date.toISOString().slice(0, 10);
    const seriesEntry = GOLD_RATE_CONFIG.series
        .filter((entry) => entry.effectiveDate <= requestedDate)
        .at(-1) ?? GOLD_RATE_CONFIG.series[0];
    const rate24KPaisePerGram = calculateRateWithShockPaisePerGram(
        seriesEntry.rate24KPaisePerGram,
        shockPercent,
    );

    return {
        label: GOLD_RATE_CONFIG.label,
        requestedDate,
        sourceDate: seriesEntry.effectiveDate,
        purityPerMille,
        baseRatePaisePerGram: seriesEntry.rate24KPaisePerGram,
        rate24KPaisePerGram,
        ratePaisePerGram: calculatePurityRatePaisePerGram(rate24KPaisePerGram, purityPerMille),
        shockPercent,
    };
}
