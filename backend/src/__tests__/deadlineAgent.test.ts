import db from '../db';
import { setClock } from '../clock';
import app from '../app';
import request from 'supertest';
import { agentTools } from '../agent';
import { calculateDeadlineRisk, rankRescueCandidates } from '../calc';
import { DEADLINE_CONFIG } from '../deadlineConfig';
import {
    acknowledgeCustodyTransfer,
    deadlineAgentTools,
    getGoldJourney,
    markNudgeReplied,
    rejectCustodyTransfer,
    runAgentTick,
    transferCustody,
} from '../deadlineAgent';
import { appendLedgerEvent, replayAndVerifyOrder } from '../ledger';

const BASE_TIME = new Date('2026-11-16T12:00:00.000Z');

describe('Deadline agent and custody rescue', () => {
    beforeEach(() => {
        setClock({ now: () => BASE_TIME });
        db.exec(`
            DELETE FROM deadline_actions;
            DELETE FROM custody_transfers;
            DELETE FROM cash_dues;
            DELETE FROM karigar_profiles;
            DELETE FROM staff_profiles;
            DELETE FROM ledger_events;
            DELETE FROM orders;
            DELETE FROM users;

            INSERT INTO users (id, role, name) VALUES
                ('j1', 'jeweller', 'Jeweller One'),
                ('j2', 'jeweller', 'Jeweller Two'),
                ('k1', 'karigar', 'Ramesh'),
                ('k2', 'karigar', 'Asha'),
                ('k3', 'karigar', 'Mohan'),
                ('s1', 'staff', 'Staff One');

            INSERT INTO orders
                (id, jeweller_id, karigar_id, description, due_date, occasion_date, job_type)
            VALUES
                ('ord-wedding', 'j1', 'k1', 'Wedding bangles', '2026-11-26', '2026-11-26', 'plain'),
                ('ord-dues', 'j1', 'k1', 'Overdue dues job', '2026-11-26', '2026-11-26', 'plain');

            INSERT INTO karigar_profiles
                (user_id, language, capacity_open_jobs, specializations_json, completed_jobs, on_time_jobs)
            VALUES
                ('k1', 'kn', 1, '["plain"]', 4, 1),
                ('k2', 'en', 4, '["plain","chain"]', 5, 4),
                ('k3', 'kn', 3, '["plain","handmade"]', 4, 3);

            INSERT INTO staff_profiles (user_id, owner_jeweller_id) VALUES ('s1', 'j1');

            INSERT INTO cash_dues
                (id, order_id, jeweller_id, karigar_id, amount_paise, pay_by_date, created_by, owner_jeweller_id)
            VALUES
                ('due-1', 'ord-dues', 'j1', 'k1', 160000, '2026-11-15T12:00:00.000Z', 's1', 'j1');
        `);

        for (const orderId of ['ord-wedding', 'ord-dues']) {
            appendLedgerEvent({
                id: `issue-${orderId}`,
                orderId,
                type: 'issue',
                weightMg: 100_000,
                purityPerMille: 916,
                status: 'acknowledged',
                createdBy: 'j1',
                idempotencyKey: `issue-${orderId}`,
            });
        }
    });

    afterEach(() => setClock(null));

    it('combines days left, stage progress, open load, and on-time history into explainable risk', () => {
        const result = calculateDeadlineRisk({
            daysLeft: 10,
            progressBps: 0,
            openJobs: 4,
            capacityOpenJobs: 2,
            completedJobs: 4,
            onTimeJobs: 1,
        }, DEADLINE_CONFIG.risk);

        expect(result.level).toBe('at_risk');
        expect(result.reasons).toEqual(expect.arrayContaining([
            'occasion_soon',
            'stage_behind',
            'open_load_high',
            'on_time_history_low',
        ]));
    });

    it('ranks eligible rescue karigars with capacity, specialization, and reliability reasons', () => {
        const ranked = rankRescueCandidates({
            jobType: 'plain',
            candidates: [
                { id: 'k2', name: 'Asha', openJobs: 1, capacityOpenJobs: 4, specializations: ['plain'], onTimeJobs: 4, completedJobs: 5 },
                { id: 'k3', name: 'Mohan', openJobs: 3, capacityOpenJobs: 3, specializations: ['plain'], onTimeJobs: 3, completedJobs: 4 },
            ],
            config: DEADLINE_CONFIG.rescue,
        });

        expect(ranked.map((candidate) => candidate.karigarId)).toEqual(['k2']);
        expect(ranked[0].reasons).toEqual(expect.arrayContaining([
            'specialization_match',
            'capacity_available',
            'reliable_history',
        ]));
    });

    it('uses the injected Clock, nudges in the karigar language, deduplicates ticks, and escalates after silence', () => {
        const firstTick = runAgentTick();
        const firstNudge = db.prepare(`
            SELECT recipient_id AS recipientId, message, type FROM deadline_actions
            WHERE order_id = 'ord-wedding' AND type = 'karigar_nudge'
        `).get() as { recipientId: string; message: string; type: string };

        expect(firstNudge.recipientId).toBe('k1');
        expect(firstNudge.message).toMatch(/ಮದುವೆ|ಕೆಲಸ/);
        expect(firstTick.actions.some((action) => action.type === 'karigar_nudge')).toBe(true);

        runAgentTick();
        expect(db.prepare("SELECT COUNT(*) AS count FROM deadline_actions WHERE order_id = 'ord-wedding' AND type = 'karigar_nudge'").get())
            .toEqual({ count: 1 });

        setClock({ now: () => new Date(BASE_TIME.getTime() + DEADLINE_CONFIG.silenceHours * 60 * 60 * 1000 + 1) });
        const escalationTick = runAgentTick();
        expect(escalationTick.actions.map((action) => action.type)).toEqual(expect.arrayContaining([
            'silence_escalation',
            'rescue_plan',
            'customer_eta_draft',
        ]));
        expect(db.prepare("SELECT karigar_id FROM orders WHERE id = 'ord-wedding'").get())
            .toEqual({ karigar_id: 'k1' });
        expect(db.prepare("SELECT COUNT(*) AS count FROM ledger_events WHERE order_id = 'ord-wedding'").get())
            .toEqual({ count: 1 });
    });

    it('nudges the jeweller on overdue dues, exposes ageing to the karigar, and escalates staff-created dues to the owner', () => {
        runAgentTick();

        const actions = db.prepare(`
            SELECT type, recipient_id AS recipientId, why FROM deadline_actions
            WHERE order_id = 'ord-dues'
        `).all() as Array<{ type: string; recipientId: string; why: string }>;

        expect(actions).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'dues_nudge', recipientId: 'j1' }),
            expect.objectContaining({ type: 'dues_ageing', recipientId: 'k1' }),
            expect.objectContaining({ type: 'owner_escalation', recipientId: 'j1' }),
        ]));
        expect(actions.every((action) => action.why.length > 0)).toBe(true);
    });

    it('does not escalate after the karigar replies to the simulated nudge', () => {
        runAgentTick();
        const nudge = db.prepare(`
            SELECT id FROM deadline_actions
            WHERE order_id = 'ord-wedding' AND type = 'karigar_nudge'
        `).get() as { id: string };
        markNudgeReplied(nudge.id, 'k1');
        setClock({ now: () => new Date(BASE_TIME.getTime() + (DEADLINE_CONFIG.silenceHours + 1) * 3_600_000) });

        runAgentTick();

        expect(db.prepare(`
            SELECT COUNT(*) AS count FROM deadline_actions
            WHERE order_id = 'ord-wedding' AND type IN ('silence_escalation', 'rescue_plan')
        `).get()).toEqual({ count: 0 });
    });

    it('transfers custody through two balanced legs and does not reassign until both karigars acknowledge', () => {
        const transfer = transferCustody({
            orderId: 'ord-wedding',
            fromKarigarId: 'k1',
            toKarigarId: 'k2',
            weightMg: 100_000,
            purityPerMille: 916,
            createdBy: 'j1',
            idempotencyKey: 'rescue-wedding-k1-k2',
        });

        expect(replayAndVerifyOrder('ord-wedding').accountBalances.karigar_wip.grossMg).toBe(100_000);
        expect(db.prepare("SELECT karigar_id FROM orders WHERE id = 'ord-wedding'").get())
            .toEqual({ karigar_id: 'k1' });

        acknowledgeCustodyTransfer(transfer.id, 'k1');
        expect(replayAndVerifyOrder('ord-wedding').accountBalances.karigar_wip.grossMg).toBe(100_000);
        expect(db.prepare("SELECT karigar_id FROM orders WHERE id = 'ord-wedding'").get())
            .toEqual({ karigar_id: 'k1' });

        acknowledgeCustodyTransfer(transfer.id, 'k2');
        const replay = replayAndVerifyOrder('ord-wedding');
        expect(replay.isValidChain).toBe(true);
        expect(replay.accountBalances.karigar_wip.grossMg).toBe(100_000);
        expect(Object.values(replay.accountBalances).reduce((sum, account) => sum + account.grossMg, 0)).toBe(0);
        expect(Object.values(replay.accountBalances).reduce((sum, account) => sum + account.fineMg, 0)).toBe(0);
        expect(db.prepare("SELECT karigar_id FROM orders WHERE id = 'ord-wedding'").get())
            .toEqual({ karigar_id: 'k2' });
    });

    it('registers only draft/propose tools and never finalizes, sends, or reassigns automatically', () => {
        const toolNames = Object.keys(agentTools.deadline).join(' ').toLowerCase();
        expect(toolNames).toContain('draft');
        expect(toolNames).not.toMatch(/finalize|send|reassign|transfer/);
        expect(Object.keys(deadlineAgentTools)).toEqual(Object.keys(agentTools.deadline));
    });

    it('keeps the deadline board tenant- and karigar-scoped', async () => {
        const jewellerBoard = await request(app)
            .get('/api/deadline/board')
            .set('x-user-id', 'j1');
        const karigarBoard = await request(app)
            .get('/api/deadline/board')
            .set('x-user-id', 'k1');
        const alternateBoard = await request(app)
            .get('/api/deadline/board')
            .set('x-user-id', 'k2');
        const otherJewellerBoard = await request(app)
            .get('/api/deadline/board')
            .set('x-user-id', 'j2');
        const unauthorizedTick = await request(app)
            .post('/api/deadline/tick')
            .set('x-user-id', 'k1')
            .send({});

        expect(jewellerBoard.status).toBe(200);
        expect(jewellerBoard.body.orders.map((order: { id: string }) => order.id)).toContain('ord-wedding');
        expect(karigarBoard.status).toBe(200);
        expect(karigarBoard.body.dues).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'due-1', overdueDays: 1 }),
        ]));
        expect(alternateBoard.status).toBe(200);
        expect(alternateBoard.body.orders).toHaveLength(0);
        expect(otherJewellerBoard.status).toBe(200);
        expect(otherJewellerBoard.body.orders).toHaveLength(0);
        expect(otherJewellerBoard.body.dues).toHaveLength(0);
        expect(unauthorizedTick.status).toBe(400);
    });

    it('runs the no-reply rescue through both karigar acknowledgements without agent finalization', async () => {
        await request(app)
            .post('/api/deadline/tick')
            .set('x-user-id', 'j1')
            .send({ fastForwardHours: 0 })
            .expect(200);
        await request(app)
            .post('/api/deadline/tick')
            .set('x-user-id', 'j1')
            .send({ fastForwardHours: DEADLINE_CONFIG.silenceHours })
            .expect(200);

        const board = await request(app)
            .get('/api/deadline/board')
            .set('x-user-id', 'j1');
        const plan = board.body.actionLog.find(
            (action: { order_id: string; type: string }) => action.order_id === 'ord-wedding' && action.type === 'rescue_plan',
        );
        expect(plan).toBeDefined();
        expect(JSON.parse(plan.payload_json).options).toContainEqual({
            value: 'lend_backup_piece',
            label: 'Lend a backup piece for the occasion',
            draftOnly: true,
        });
        const etaDraft = board.body.actionLog.find(
            (action: { order_id: string; type: string }) => action.order_id === 'ord-wedding' && action.type === 'customer_eta_draft',
        );
        expect(etaDraft.status).toBe('draft');
        expect(JSON.parse(etaDraft.payload_json).sent).toBe(false);
        expect(db.prepare("SELECT COUNT(*) AS count FROM ledger_events WHERE order_id = 'ord-wedding'").get())
            .toEqual({ count: 1 });
        const candidates = JSON.parse(plan.payload_json).candidates as Array<{ karigarId: string }>;
        expect(candidates.map((candidate) => candidate.karigarId)).toContain('k2');

        const selection = await request(app)
            .post('/api/deadline/orders/ord-wedding/rescue')
            .set('x-user-id', 'j1')
            .send({ karigarId: 'k2' })
            .expect(200);
        const transferId = selection.body.id as string;
        const outEventId = selection.body.out_event_id as string;
        await request(app)
            .post(`/api/deadline/custody-transfers/${transferId}/acknowledge`)
            .set('x-user-id', 'k2')
            .expect(400);
        await request(app)
            .post(`/api/ledger/${outEventId}/acknowledge`)
            .set('x-user-id', 'k1')
            .expect(400);

        const outgoingAck = await request(app)
            .post(`/api/deadline/custody-transfers/${transferId}/acknowledge`)
            .set('x-user-id', 'k1')
            .expect(200);
        expect(outgoingAck.body.transfer.status).toBe('pending');
        expect(replayAndVerifyOrder('ord-wedding').accountBalances.karigar_wip.grossMg).toBe(100_000);
        expect((db.prepare('SELECT status FROM ledger_events WHERE id = ?').get(outgoingAck.body.transfer.out_event_id) as { status: string }).status)
            .toBe('pending_ack');
        expect((db.prepare("SELECT karigar_id FROM orders WHERE id = 'ord-wedding'").get() as { karigar_id: string }).karigar_id)
            .toBe('k1');

        const incomingAck = await request(app)
            .post(`/api/deadline/custody-transfers/${transferId}/acknowledge`)
            .set('x-user-id', 'k2')
            .expect(200);
        expect(incomingAck.body.transfer.status).toBe('completed');
        expect((db.prepare("SELECT karigar_id FROM orders WHERE id = 'ord-wedding'").get() as { karigar_id: string }).karigar_id)
            .toBe('k2');
        const replay = replayAndVerifyOrder('ord-wedding');
        expect(replay.isValidChain).toBe(true);
        expect(Object.values(replay.accountBalances).reduce((sum, account) => sum + account.grossMg, 0)).toBe(0);
        expect(Object.values(replay.accountBalances).reduce((sum, account) => sum + account.fineMg, 0)).toBe(0);
    });

    it('records three acknowledged journey stages and attributes fine loss to each stage', () => {
        const handoff = (
            stage: string,
            fromKarigarId: string,
            toKarigarId: string,
            sentMg: number,
            receivedMg: number,
            idempotencyKey: string,
        ) => {
            const transfer = transferCustody({
                orderId: 'ord-wedding',
                fromKarigarId,
                toKarigarId,
                weightMg: sentMg,
                purityPerMille: 916,
                receivedWeightMg: receivedMg,
                receivedPurityPerMille: 916,
                stage,
                createdBy: 'j1',
                idempotencyKey,
            });
            acknowledgeCustodyTransfer(transfer.id, fromKarigarId);
            return acknowledgeCustodyTransfer(transfer.id, toKarigarId);
        };

        handoff('casting', 'k1', 'k2', 100_000, 99_800, 'journey-casting');
        handoff('filing', 'k2', 's1', 99_800, 99_400, 'journey-filing');
        handoff('polish', 's1', 'j1', 99_400, 99_000, 'journey-polish');

        const journey = getGoldJourney('ord-wedding', 'j1');
        expect(journey.stages.map((stage: { stage: string }) => stage.stage))
            .toEqual(['casting', 'filing', 'polish']);
        expect(journey.stages.map((stage: { fineLossMg: number }) => stage.fineLossMg))
            .toEqual([183, 367, 366]);
        expect(journey.currentCustodian.id).toBe('j1');

        const replay = replayAndVerifyOrder('ord-wedding');
        expect(replay.isValidChain).toBe(true);
        expect(replay.accountBalances.karigar_wip.grossMg).toBe(0);
        expect(replay.accountBalances.finished_goods.grossMg).toBe(99_000);
        expect(replay.accountBalances.process_loss.fineMg).toBe(916);
        expect(Object.values(replay.accountBalances).reduce((sum, account) => sum + account.grossMg, 0)).toBe(0);
        expect(Object.values(replay.accountBalances).reduce((sum, account) => sum + account.fineMg, 0)).toBe(0);
        const castingEvent = db.prepare(`
            SELECT id FROM ledger_events
            WHERE order_id = 'ord-wedding' AND type = 'custody_transfer_out' AND stage = 'casting'
        `).get() as { id: string };
        db.prepare("UPDATE ledger_events SET stage = 'setting' WHERE id = ?").run(castingEvent.id);
        expect(replayAndVerifyOrder('ord-wedding').isValidChain).toBe(false);
    });

    it('rejects a pending handoff without moving gold from the sender', () => {
        const transfer = transferCustody({
            orderId: 'ord-wedding',
            fromKarigarId: 'k1',
            toKarigarId: 'k2',
            weightMg: 100_000,
            purityPerMille: 916,
            receivedWeightMg: 99_000,
            receivedPurityPerMille: 916,
            stage: 'setting',
            createdBy: 'j1',
            idempotencyKey: 'journey-rejected',
        });

        const rejected = rejectCustodyTransfer(transfer.id, 'k2', 'Purity reading needs a joint recheck.');
        expect(rejected.rejected_at).toBeTruthy();
        const replay = replayAndVerifyOrder('ord-wedding');
        expect(replay.accountBalances.karigar_wip.grossMg).toBe(100_000);
        expect(replay.accountBalances.process_loss.fineMg).toBe(0);
        expect(replay.isValidChain).toBe(true);
    });
});
