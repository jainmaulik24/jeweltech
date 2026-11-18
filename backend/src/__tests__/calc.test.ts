import {
    parseUnitToMg,
    toFineGoldMg,
    computeAllowedWastageMg,
    calculatePurityBalance,
    calculateMultiPuritySettlement,
    calculateCappedSplitValue,
    calculateCappedSplitSignedValue,
    calculateDisputeHistoryTotals,
    calculateSignedFineGoldMg,
    calculateGoldJourneyLoss,
    calculateNetGoldMg,
    calculateIdealReturn,
    calculateFairPayPaise,
    DEFAULT_CALC_CONFIG,
    CalcConfig,
} from '../calc';

describe('Chunk 2: Pure Calculation Library', () => {
    describe('Ideal return and net gold', () => {
        it('uses integer half-up milligrams for the 24K-to-22K ideal and buffer', () => {
            expect(calculateIdealReturn(100_000, undefined, {
                idealReturnFactorBp: 10_860,
                bufferBp: 200,
            })).toMatchObject({
                idealMg: 108_600,
                minAcceptableMg: 106_428,
            });
        });

        it('classifies returns and retains the unused ideal allowance only within buffer', () => {
            const config = { idealReturnFactorBp: 10_860, bufferBp: 200 };
            const within = calculateIdealReturn(100_000, 107_500, config);
            const short = calculateIdealReturn(100_000, 105_000, config);
            const above = calculateIdealReturn(100_000, 109_000, config);

            expect(within).toMatchObject({ status: 'WITHIN_BUFFER', retainedGoldMg: 1_100 });
            expect(short).toMatchObject({ status: 'SHORT', retainedGoldMg: 0 });
            expect(above).toMatchObject({ status: 'AT_OR_ABOVE_IDEAL', retainedGoldMg: 0 });
        });

        it('subtracts stones and other non-gold weight before valuing gold', () => {
            expect(calculateNetGoldMg(10_000, 600, 0)).toBe(9_400);
        });

        it('values retained gold at 916 and adds configured per-piece pay', () => {
            expect(calculateFairPayPaise({
                retainedGoldMg: 1_100,
                goldPurityPerMille: 916,
                simulatedRatePaisePerGram: 750_000,
                pieceCounts: { buffing: 1, cutting: 2, polish: 1 },
                perPiecePayPaise: { buffing: 100, cutting: 200, polish: 300 },
            })).toEqual({
                retainedGoldValuePaise: 756_000,
                perPiecePayPaise: 800,
                fairPayPaise: 756_800,
            });
        });
    });

    describe('Gold journey loss', () => {
        it('calculates gross and fine loss from sender and receiver purity weigh-ins', () => {
            expect(calculateGoldJourneyLoss({
                sentGrossMg: 100_000,
                sentPurityPerMille: 916,
                receivedGrossMg: 99_800,
                receivedPurityPerMille: 916,
            })).toEqual({
                sentFineMg: 91_600,
                receivedFineMg: 91_417,
                grossLossMg: 200,
                fineLossMg: 183,
            });
        });

        it('rejects a received reading that implies more physical or fine gold than was sent', () => {
            expect(() => calculateGoldJourneyLoss({
                sentGrossMg: 10_000,
                sentPurityPerMille: 916,
                receivedGrossMg: 10_001,
                receivedPurityPerMille: 916,
            })).toThrow(/gross weight cannot exceed/);
            expect(() => calculateGoldJourneyLoss({
                sentGrossMg: 10_000,
                sentPurityPerMille: 916,
                receivedGrossMg: 10_000,
                receivedPurityPerMille: 958,
            })).toThrow(/fine gold cannot exceed/);
        });
    });

    describe('Dispute calculations', () => {
        it('splits signed differences without exceeding the cap and converts signed gold deltas', () => {
            expect(calculateCappedSplitValue(8_000, 8_500, 1_000)).toBe(8_250);
            expect(calculateCappedSplitValue(8_000, 10_000, 1_000)).toBe(8_500);
            expect(calculateCappedSplitValue(8_000, 7_500, 1_000)).toBe(7_750);
            expect(calculateCappedSplitSignedValue(-500, 500, 1_000)).toBe(0);
            expect(calculateSignedFineGoldMg(-500, 916)).toBe(-458);
        });

        it('totals historical fine-gold loss against each pinned agreement allowance', () => {
            expect(calculateDisputeHistoryTotals([{
                issuedLots: [{ grossMg: 10_000, fineMg: 9_160 }],
                finishedLots: [{ grossMg: 8_000, fineMg: 7_328 }],
                scrapLots: [],
                agreement: { basis: 'fine_issued', percentBps: 200 },
            }])).toEqual({ lossMg: 1_832, allowanceMg: 183, completedJobs: 1 });
        });
    });

    describe('Rule 1: Strict Integer Milligram Enforcement & Unit Conversion', () => {
        it('converts grams and tolas to exact integer milligrams without float bugs', () => {
            // Classic IEEE-754 float trap: 19.99 * 1000 in JS float can be 19989.999999999996
            expect(parseUnitToMg('19.99', 'g')).toBe(19990);
            expect(parseUnitToMg('10.525', 'g')).toBe(10525);
            expect(parseUnitToMg('500', 'mg')).toBe(500);
            expect(parseUnitToMg('1.5', 'tola')).toBe(15000); // Default 10g metric tola

            const tradTolaConfig: CalcConfig = { ...DEFAULT_CALC_CONFIG, tolaWeightMg: 11664 };
            expect(parseUnitToMg('1', 'tola', tradTolaConfig)).toBe(11664);
        });

        it('rejects floating-point numbers passed to calculation functions', () => {
            expect(() => toFineGoldMg(10.5, 9160)).toThrow(/no floats allowed/);
            expect(() => computeAllowedWastageMg(10000, 9500.2, 0, 300)).toThrow(/no floats allowed/);
        });
    });

    describe('Edge Case: Zero Weights and Zero Wastage', () => {
        it('handles zero weights cleanly without division errors', () => {
            expect(toFineGoldMg(0, 9160)).toBe(0);
            expect(computeAllowedWastageMg(0, 0, 0, 500)).toBe(0);

            const res = calculatePurityBalance({
                purityBps: 9160,
                issuedMg: 0,
                returnedFinishedMg: 0,
                scrapMg: 0,
                wastageRateBps: 300,
            });

            expect(res.differenceGrossMg).toBe(0);
            expect(res.status).toBe('SETTLED');
        });
    });

    describe('Edge Case: Rounding Rules (HALF_UP, FLOOR, CEIL)', () => {
        it('applies documented integer rounding rules accurately', () => {
            // 1005 mg * 9165 bps / 10000 = 921.0825 mg
            expect(toFineGoldMg(1005, 9165, 'HALF_UP')).toBe(921);
            expect(toFineGoldMg(1005, 9165, 'FLOOR')).toBe(921);
            expect(toFineGoldMg(1005, 9165, 'CEIL')).toBe(922);

            // Exact halfway case: 1000 mg * 5005 bps / 10000 = 500.5 mg
            expect(toFineGoldMg(1000, 5005, 'HALF_UP')).toBe(501);
            expect(toFineGoldMg(1000, 5005, 'FLOOR')).toBe(500);
            expect(toFineGoldMg(1000, 5005, 'CEIL')).toBe(501);
        });
    });

    describe('Edge Case: Configurable Wastage Bases & Scrap Handling', () => {
        it('calculates wastage across all three configurable conventions', () => {
            // Issued: 20g (20,000mg), Returned ornament: 18g (18,000mg), Scrap: 1.5g (1,500mg), Wastage: 3% (300 bps)
            const issued = 20000;
            const returned = 18000;
            const scrap = 1500;
            const rateBps = 300; // 3.00%

            // 1. Default: % of returned_finished (3% of 18,000 = 540 mg)
            expect(computeAllowedWastageMg(issued, returned, scrap, rateBps, DEFAULT_CALC_CONFIG)).toBe(540);

            // 2. % of issued_gross (3% of 20,000 = 600 mg)
            expect(
                computeAllowedWastageMg(issued, returned, scrap, rateBps, {
                    ...DEFAULT_CALC_CONFIG,
                    wastageBase: 'issued_gross',
                })
            ).toBe(600);

            // 3. % of issued_minus_scrap (3% of (20,000 - 1,500) = 3% of 18,500 = 555 mg)
            expect(
                computeAllowedWastageMg(issued, returned, scrap, rateBps, {
                    ...DEFAULT_CALC_CONFIG,
                    wastageBase: 'issued_minus_scrap',
                })
            ).toBe(555);
        });

        it('detects SHORT and EXCESS accurately with scrap included', () => {
            // Issued: 20,000 mg (22K = 9160 bps)
            // Returned: 18,000 mg, Scrap: 1,400 mg, Wastage (3% of returned): 540 mg
            // Total Accounted = 18,000 + 1,400 + 540 = 19,940 mg -> 60 mg SHORT (-60 mg)
            const shortResult = calculatePurityBalance({
                purityBps: 9160,
                issuedMg: 20000,
                returnedFinishedMg: 18000,
                scrapMg: 1400,
                wastageRateBps: 300,
            });

            expect(shortResult.allowedWastageMg).toBe(540);
            expect(shortResult.totalAccountedGrossMg).toBe(19940);
            expect(shortResult.differenceGrossMg).toBe(-60);
            expect(shortResult.status).toBe('SHORT');

            // If Scrap was 1,500 mg -> Total Accounted = 20,040 mg -> 40 mg EXCESS (+40 mg)
            const excessResult = calculatePurityBalance({
                purityBps: 9160,
                issuedMg: 20000,
                returnedFinishedMg: 18000,
                scrapMg: 1500,
                wastageRateBps: 300,
            });

            expect(excessResult.differenceGrossMg).toBe(40);
            expect(excessResult.status).toBe('EXCESS');
        });
    });

    describe('Edge Case: Multiple Purities & Fine-Gold Settlement', () => {
        it('computes cross-purity settlement using fine-gold equivalent', () => {
            // Jeweller issues 10g of 24K (9990 bps -> 9,990 mg fine)
            // Karigar returns 10g of 22K ornament (9160 bps) + 0.5g 22K scrap with 3% wastage
            const summary = calculateMultiPuritySettlement([
                {
                    purityBps: 9990,
                    issuedMg: 10000,
                    returnedFinishedMg: 0,
                    scrapMg: 0,
                    wastageRateBps: 0,
                },
                {
                    purityBps: 9160,
                    issuedMg: 0,
                    returnedFinishedMg: 10000,
                    scrapMg: 500,
                    wastageRateBps: 300, // 300 mg wastage -> 10,800 mg gross 22K accounted
                },
            ]);

            // Issued fine: 10,000 * 9990 / 10000 = 9,990 mg
            // Accounted fine: 10,800 * 9160 / 10000 = 9,892.8 -> 9,893 mg
            // Net Fine Difference: 9,893 - 9,990 = -97 mg (SHORT 97 mg fine gold)
            expect(summary.totalIssuedFineMg).toBe(9990);
            expect(summary.totalAccountedFineMg).toBe(9893);
            expect(summary.netDifferenceFineMg).toBe(-97);
            expect(summary.overallStatus).toBe('SHORT');
        });
    });
});