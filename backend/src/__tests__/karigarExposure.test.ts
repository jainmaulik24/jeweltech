import request from 'supertest';
import app from '../app';
import db from '../db';
import { setClock } from '../clock';
import { calculateSignedGoldValuePaise } from '../calc';
import { appendLedgerEvent } from '../ledger';
import { getRate } from '../rateService';
import {
    computeSyntheticExposureReplay,
    evaluateKarigarExposure,
    getCleanReturnCount,
    getTrustTier,
    type ExposureMetrics,
} from '../karigarExposure';
import { KARIGAR_EXPOSURE_CONFIG } from '../karigarExposureConfig';

const BASE_TIME = new Date('2026-11-18T12:00:00.000Z');

const baseMetrics = (): ExposureMetrics => ({
    floatMg: 10_000,
    exposureMg: 20_000,
    trailingIssueMg: 100_000,
    trailingWindowDays: 30,
    oldestGoldAgeDays: 3,
    missedReturnPromises: 0,
    portfolioExposureMg: 200_000,
    purityShortfallCount: 0,
    recentLossBps: null,
    historicalLossBps: null,
});

describe('karigar exposure and trust ladder', () => {
    beforeEach(() => {
        setClock({ now: () => BASE_TIME });
        db.exec(`
            DELETE FROM owner_issue_approvals;
            DELETE FROM karigar_floats;
            DELETE FROM ledger_acknowledgements;
            DELETE FROM ledger_events;
            DELETE FROM orders;
            DELETE FROM staff_profiles;
            DELETE FROM users;

            INSERT INTO users (id, role, name, phone, pin) VALUES
                ('j1', 'jeweller', 'Owner One', '111', '1234'),
                ('j2', 'jeweller', 'Owner Two', '222', '1234'),
                ('k1', 'karigar', 'Ramesh', '333', '1234'),
                ('k2', 'karigar', 'Asha', '334', '1234'),
                ('s1', 'staff', 'Staff One', '777', '1234');
            INSERT INTO staff_profiles (user_id, owner_jeweller_id) VALUES ('s1', 'j1');
            INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date)
            VALUES
                ('ord-1', 'j1', 'k1', 'Ramesh bangle', '2026-11-30'),
                ('ord-private', 'j2', 'k2', 'Private order', '2026-11-30');
        `);
    });

    afterEach(() => setClock(null));

    it('raises a weighted signal for float compared with trailing draw rate', () => {
        const result = evaluateKarigarExposure({
            ...baseMetrics(),
            floatMg: 100_000,
            trailingIssueMg: 1_000,
        });
        expect(result.signals.find((signal) => signal.code === 'draw_rate')?.severity).toBe(2);
        expect(result.reasons.join(' ')).toContain('issue pace');
    });

    it('raises a signal for the oldest unreturned gold age', () => {
        const result = evaluateKarigarExposure({ ...baseMetrics(), oldestGoldAgeDays: 45 });
        expect(result.signals.find((signal) => signal.code === 'gold_age')?.severity).toBe(2);
    });

    it('raises a signal for missed return promises', () => {
        const result = evaluateKarigarExposure({ ...baseMetrics(), missedReturnPromises: 3 });
        expect(result.signals.find((signal) => signal.code === 'missed_promises')?.severity).toBe(2);
    });

    it('raises a signal for concentration with one karigar', () => {
        const result = evaluateKarigarExposure({
            ...baseMetrics(),
            exposureMg: 90_000,
            portfolioExposureMg: 100_000,
        });
        expect(result.signals.find((signal) => signal.code === 'concentration')?.severity).toBe(2);
    });

    it('raises a signal for purity shortfalls', () => {
        const result = evaluateKarigarExposure({ ...baseMetrics(), purityShortfallCount: 1 });
        expect(result.signals.find((signal) => signal.code === 'purity_shortfall')?.severity).toBe(1);
    });

    it('compares losses with personal history and ignores peers by default', () => {
        const personalHistory = evaluateKarigarExposure({
            ...baseMetrics(),
            recentLossBps: 1_000,
            historicalLossBps: 200,
            peerLossBps: 9_000,
        });
        const sameWithoutPeers = evaluateKarigarExposure({
            ...baseMetrics(),
            recentLossBps: 1_000,
            historicalLossBps: 200,
        });
        expect(personalHistory.signals.find((signal) => signal.code === 'loss_history')?.severity).toBe(2);
        expect(personalHistory.score).toBe(sameWithoutPeers.score);
    });

    it('increases trust float limits only at configured clean-return milestones', () => {
        const tiers = KARIGAR_EXPOSURE_CONFIG.trustTiers;
        expect(getTrustTier(tiers[0].minCleanReturns).id).toBe(tiers[0].id);
        expect(getTrustTier(tiers[1].minCleanReturns - 1).id).toBe(tiers[0].id);
        expect(getTrustTier(tiers[1].minCleanReturns).floatLimitMg).toBeGreaterThan(tiers[0].floatLimitMg);
    });

    it('counts completed on-time returns with matching purity and no excess loss as clean', () => {
        appendLedgerEvent({
            id: 'evt-clean-issue',
            orderId: 'ord-1',
            type: 'issue',
            weightMg: 10_000,
            purityPerMille: 916,
            status: 'acknowledged',
            createdBy: 'j1',
            idempotencyKey: 'clean-issue',
        });
        appendLedgerEvent({
            id: 'evt-clean-return',
            orderId: 'ord-1',
            type: 'return',
            weightMg: 10_000,
            purityPerMille: 916,
            status: 'acknowledged',
            createdBy: 'j1',
            idempotencyKey: 'clean-return',
        });
        expect(getCleanReturnCount('j1', 'k1', BASE_TIME)).toBe(1);
    });

    it('replays a labeled synthetic 90-day timeline with an exact first flag and loss valuation', () => {
        const replay = computeSyntheticExposureReplay(BASE_TIME);
        expect(replay.label).toBe('SYNTHETIC');
        expect(replay.days).toHaveLength(90);
        expect(replay.firstFlag.day).toBe(14);
        expect(replay.firstFlag.exposureMg).toBe(22_800);
        expect(replay.atLoss.exposureMg).toBe(76_800);
        expect(replay.firstFlag.valuePaise).toBe(calculateSignedGoldValuePaise(
            replay.firstFlag.exposureMg,
            999,
            getRate(new Date(replay.firstFlag.date), 999).rate24KPaisePerGram,
        ));
        expect(replay.atLoss.valuePaise).toBe(calculateSignedGoldValuePaise(
            replay.atLoss.exposureMg,
            999,
            getRate(new Date(replay.atLoss.date), 999).rate24KPaisePerGram,
        ));
    });

    it('holds an above-tier float issue for explicit owner approval without posting gold early', async () => {
        const weightMg = KARIGAR_EXPOSURE_CONFIG.trustTiers[0].floatLimitMg + 1;
        const created = await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 'j1')
            .send({
                type: 'issue',
                karigarId: 'k1',
                weightMg,
                purityPerMille: 999,
                idempotencyKey: 'over-limit-float',
            })
            .expect(200);
        expect(created.body).toEqual(expect.objectContaining({ approvalRequired: true }));
        expect(db.prepare("SELECT COUNT(*) AS count FROM ledger_events WHERE type = 'issue'").get())
            .toEqual({ count: 0 });

        const queue = await request(app)
            .get('/api/owner-issue-approvals')
            .set('x-user-id', 'j1')
            .expect(200);
        expect(queue.body.approvals).toEqual([
            expect.objectContaining({ id: created.body.approvalId, weightMg, status: 'pending' }),
        ]);
        await request(app)
            .post(`/api/owner-issue-approvals/${created.body.approvalId}/approve`)
            .set('x-user-id', 'j2')
            .expect(400);

        const approved = await request(app)
            .post(`/api/owner-issue-approvals/${created.body.approvalId}/approve`)
            .set('x-user-id', 'j1')
            .expect(200);
        expect(approved.body.event).toEqual(expect.objectContaining({
            type: 'issue',
            status: 'pending_ack',
            weightMg,
        }));
        expect(db.prepare('SELECT status, approved_by AS approvedBy FROM owner_issue_approvals WHERE id = ?')
            .get(created.body.approvalId)).toEqual({ status: 'approved', approvedBy: 'j1' });
        expect(db.prepare('SELECT COUNT(*) AS count FROM ledger_events WHERE type = ? AND status = ?')
            .get('issue', 'acknowledged')).toEqual({ count: 0 });
    });

    it('requires the jeweller owner to check a large issue requested by staff', async () => {
        const created = await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 's1')
            .send({
                orderId: 'ord-1',
                type: 'issue',
                weightMg: KARIGAR_EXPOSURE_CONFIG.staffLargeIssueMg,
                purityPerMille: 999,
                idempotencyKey: 'staff-large-issue',
            })
            .expect(200);
        expect(created.body.approvalRequired).toBe(true);

        await request(app)
            .post(`/api/owner-issue-approvals/${created.body.approvalId}/approve`)
            .set('x-user-id', 's1')
            .expect(400);
        const approved = await request(app)
            .post(`/api/owner-issue-approvals/${created.body.approvalId}/approve`)
            .set('x-user-id', 'j1')
            .expect(200);
        expect(approved.body.event.createdBy).toBe('s1');
        expect(approved.body.event.status).toBe('pending_ack');
    });

    it('keeps high exposure advisory and does not block an ordinary issue', async () => {
        const oldTime = new Date(BASE_TIME.getTime() - 60 * 86_400_000);
        setClock({ now: () => oldTime });
        db.prepare(`
            UPDATE orders SET due_date = '2026-10-01' WHERE id = 'ord-1'
        `).run();
        for (let index = 0; index < 3; index += 1) {
            const orderId = index === 0 ? 'ord-1' : `ord-overdue-${index}`;
            if (index > 0) {
                db.prepare(`
                    INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date)
                    VALUES (?, 'j1', 'k1', 'Overdue job', '2026-10-01')
                `).run(orderId);
            }
            appendLedgerEvent({
                id: `evt-risk-held-${index}`,
                orderId,
                type: 'issue',
                weightMg: 10_000,
                purityPerMille: 999,
                status: 'acknowledged',
                createdBy: 'j1',
                idempotencyKey: `risk-held-${index}`,
            });
        }
        setClock({ now: () => BASE_TIME });
        const dashboard = await request(app)
            .get('/api/karigar-exposure')
            .set('x-user-id', 'j1')
            .expect(200);
        expect(dashboard.body.karigars.find((row: { karigarId: string }) => row.karigarId === 'k1').risk.level)
            .toBe('high');

        const issue = await request(app)
            .post('/api/ledger/event')
            .set('x-user-id', 'j1')
            .send({
                orderId: 'ord-1',
                type: 'issue',
                weightMg: 1_000,
                purityPerMille: 999,
                idempotencyKey: 'ordinary-issue-after-warning',
            })
            .expect(200);
        expect(issue.body.status).toBe('pending_ack');
    });

    it('limits jeweller exposure data and gives karigars one plain warning sentence', async () => {
        const jeweller = await request(app)
            .get('/api/karigar-exposure')
            .set('x-user-id', 'j1')
            .expect(200);
        expect(jeweller.body.karigars.map((row: { karigarId: string }) => row.karigarId))
            .not.toContain('k2');
        expect(jeweller.body.syntheticReplay.label).toBe('SYNTHETIC');

        const home = await request(app)
            .get('/api/karigar/home')
            .set('x-user-id', 'k1')
            .expect(200);
        expect(home.body.exposureSentence).toEqual(expect.any(String));
        expect(home.body.exposureSentence).toMatch(/[.!?]$/);
        expect(home.body).not.toHaveProperty('exposureScore');
        expect(home.body).not.toHaveProperty('exposureSignals');
    });
});
