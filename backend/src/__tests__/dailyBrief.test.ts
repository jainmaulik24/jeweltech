import db from '../db';
import { setClock } from '../clock';
import app from '../app';
import request from 'supertest';
import { appendLedgerEvent } from '../ledger';
import { getDailyBrief, runDailyBriefTick } from '../dailyBrief';
import { DAILY_BRIEF_CONFIG } from '../dailyBriefConfig';
import { escalateDispute } from '../disputes';
import { transferCustody } from '../deadlineAgent';

const BEFORE_SCHEDULE = new Date('2026-11-16T02:25:00.000Z');
const AFTER_SCHEDULE = new Date('2026-11-16T02:31:00.000Z');

describe('Daily brief', () => {
    beforeEach(() => {
        setClock({ now: () => BEFORE_SCHEDULE });
        db.exec(`
            DELETE FROM daily_briefs;
            DELETE FROM deadline_actions;
            DELETE FROM custody_transfers;
            DELETE FROM cash_dues;
            DELETE FROM dispute_evidence;
            DELETE FROM dispute_actions;
            DELETE FROM dispute_carries;
            DELETE FROM disputes;
            DELETE FROM karigar_profiles;
            DELETE FROM staff_profiles;
            DELETE FROM ledger_events;
            DELETE FROM orders;
            DELETE FROM users;

            INSERT INTO users (id, role, name) VALUES
                ('j1', 'jeweller', 'Jeweller One'),
                ('j2', 'jeweller', 'Jeweller Two'),
                ('k1', 'karigar', 'Ramesh'),
                ('k2', 'karigar', 'Asha');

            INSERT INTO orders
                (id, jeweller_id, karigar_id, description, due_date, occasion_date, job_type)
            VALUES
                ('ord-risk', 'j1', 'k1', 'Urgent wedding order', '2026-11-26', '2026-11-26', 'plain'),
                ('ord-today', 'j1', 'k1', 'Bangles due today', '2026-11-16', NULL, 'plain'),
                ('ord-pending', 'j1', 'k1', 'Pending return', '2026-11-18', NULL, 'plain'),
                ('ord-other', 'j2', 'k2', 'Other jeweller order', '2026-11-16', NULL, 'plain');

            INSERT INTO karigar_profiles
                (user_id, language, capacity_open_jobs, specializations_json, completed_jobs, on_time_jobs)
            VALUES
                ('k1', 'kn', 2, '["plain"]', 4, 1),
                ('k2', 'en', 4, '["plain"]', 4, 3);

            INSERT INTO cash_dues
                (id, order_id, jeweller_id, karigar_id, amount_paise, pay_by_date,
                 created_by, owner_jeweller_id, created_at)
            VALUES
                ('due-k1', 'ord-pending', 'j1', 'k1', 160000, '2026-11-15T00:00:00.000Z',
                 'j1', 'j1', '2026-11-10T00:00:00.000Z');
        `);

        appendLedgerEvent({
            id: 'evt-risk-issue',
            orderId: 'ord-risk',
            type: 'issue',
            weightMg: 100_000,
            purityPerMille: 916,
            status: 'acknowledged',
            createdBy: 'j1',
            idempotencyKey: 'evt-risk-issue',
        });
        appendLedgerEvent({
            id: 'evt-today-issue',
            orderId: 'ord-today',
            type: 'issue',
            weightMg: 20_000,
            purityPerMille: 916,
            status: 'pending_ack',
            createdBy: 'j1',
            idempotencyKey: 'evt-today-issue',
        });
        appendLedgerEvent({
            id: 'evt-pending-return',
            orderId: 'ord-pending',
            type: 'return',
            weightMg: 10_000,
            purityPerMille: 916,
            status: 'pending_ack',
            createdBy: 'k1',
            idempotencyKey: 'evt-pending-return',
        });
        db.prepare(`
            INSERT INTO disputes (id, event_id, karigar_id, reason, status)
            VALUES ('dispute-pending-return', 'evt-pending-return', 'k1', 'Review return', 'unresolved')
        `).run();
    });

    afterEach(() => setClock(null));

    it('ranks jeweller actions from ledger, risk, dues, and flags with working order/event deep links', () => {
        const brief = getDailyBrief('j1', 'en', BEFORE_SCHEDULE);
        const risk = brief.items.find((item) => item.category === 'at_risk_order');
        const due = brief.items.find((item) => item.category === 'overdue_due');
        const approval = brief.items.find((item) => item.category === 'pending_approval');
        const flag = brief.items.find((item) => item.category === 'flag');

        expect(brief.items.length).toBeLessThanOrEqual(DAILY_BRIEF_CONFIG.ranking.maxItems);
        expect(risk).toEqual(expect.objectContaining({
            orderId: 'ord-risk',
            amountPaise: 68_700_000,
            href: '#order-ord-risk',
        }));
        expect(due).toEqual(expect.objectContaining({
            dueId: 'due-k1',
            orderId: 'ord-pending',
            amountPaise: 160_000,
            href: '#order-ord-pending',
        }));
        expect(approval).toEqual(expect.objectContaining({
            orderId: 'ord-pending',
            eventId: 'evt-pending-return',
            href: '#ledger-event-evt-pending-return',
        }));
        expect(flag).toEqual(expect.objectContaining({
            eventId: 'evt-pending-return',
            category: 'flag',
        }));
        expect(brief.items.map((item) => item.rankingScore)).toEqual(
            [...brief.items].map((item) => item.rankingScore).sort((left, right) => right - left),
        );
    });

    it('gives both roles English and Kannada briefs from their own due, owed, and approval data', () => {
        const karigarEnglish = getDailyBrief('k1', 'en', BEFORE_SCHEDULE);
        const karigarKannada = getDailyBrief('k1', 'kn', BEFORE_SCHEDULE);
        const jewellerKannada = getDailyBrief('j1', 'kn', BEFORE_SCHEDULE);

        expect(karigarEnglish.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ category: 'due_today', orderId: 'ord-today' }),
            expect.objectContaining({ category: 'owed_cash', dueId: 'due-k1', amountPaise: 160_000, ageDays: 6 }),
            expect.objectContaining({ category: 'pending_approval', eventId: 'evt-today-issue' }),
        ]));
        expect(karigarKannada.items.find((item) => item.category === 'due_today')?.detail).toMatch(/ಇಂದು/);
        expect(jewellerKannada.items.find((item) => item.category === 'at_risk_order')?.title).toMatch(/ಅಪಾಯ/);
        expect(karigarEnglish.items.every((item) => item.orderId === 'ord-risk'
            || item.orderId === 'ord-today' || item.orderId === 'ord-pending')).toBe(true);
    });

    it('includes role-scoped escalations with age and a dispute deep link in both languages', () => {
        db.prepare('UPDATE disputes SET created_at = ? WHERE id = ?')
            .run('2026-11-10T02:25:00.000Z', 'dispute-pending-return');
        escalateDispute('dispute-pending-return', 'k1');

        const jewellerEnglish = getDailyBrief('j1', 'en', BEFORE_SCHEDULE);
        const karigarKannada = getDailyBrief('k1', 'kn', BEFORE_SCHEDULE);
        const otherJeweller = getDailyBrief('j2', 'en', BEFORE_SCHEDULE);
        const jewellerItem = jewellerEnglish.items.find((item) => item.category === 'escalated_dispute');
        const karigarItem = karigarKannada.items.find((item) => item.category === 'escalated_dispute');

        expect(jewellerItem).toEqual(expect.objectContaining({
            eventId: 'evt-pending-return',
            ageDays: 6,
            href: '#dispute-entry-evt-pending-return',
        }));
        expect(karigarItem?.title).toMatch(/ಮಾಲೀಕರ/);
        expect(karigarItem?.detail).toMatch(/6 ದಿನ/);
        expect(otherJeweller.items.some((item) => item.category === 'escalated_dispute')).toBe(false);
    });

    it('links pending custody acknowledgements to Gold Journey instead of generic ledger approval', () => {
        appendLedgerEvent({
            id: 'evt-journey-issue',
            orderId: 'ord-pending',
            type: 'issue',
            weightMg: 10_000,
            purityPerMille: 916,
            status: 'acknowledged',
            createdBy: 'j1',
            idempotencyKey: 'evt-journey-issue',
        });
        const transfer = transferCustody({
            orderId: 'ord-pending',
            fromKarigarId: 'k1',
            toKarigarId: 'k2',
            weightMg: 10_000,
            purityPerMille: 916,
            createdBy: 'j1',
            idempotencyKey: 'brief-custody-approval',
        });

        const brief = getDailyBrief('k2', 'en', BEFORE_SCHEDULE);
        expect(brief.items).toEqual(expect.arrayContaining([
            expect.objectContaining({
                category: 'custody_approval',
                eventId: transfer.in_event_id,
                href: '#gold-journey',
            }),
        ]));
    });

    it('creates one scheduled snapshot per role only after the configured local time', () => {
        expect(runDailyBriefTick()).toEqual(expect.objectContaining({ generated: false, briefDate: '2026-11-16' }));

        setClock({ now: () => AFTER_SCHEDULE });
        const firstRun = runDailyBriefTick();
        const secondRun = runDailyBriefTick();

        expect(firstRun.generated).toBe(true);
        expect(firstRun.userIds).toEqual(expect.arrayContaining(['j1', 'j2', 'k1', 'k2']));
        expect(secondRun.generated).toBe(false);
        expect(db.prepare('SELECT COUNT(*) AS count FROM daily_briefs').get()).toEqual({ count: 4 });
        expect(getDailyBrief('k1', 'kn', AFTER_SCHEDULE).preview).toBe(false);
    });

    it('serves localized, role-scoped briefs and allows only jewellers to fast-forward generation', async () => {
        const jeweller = await request(app)
            .get('/api/daily-brief?language=kn')
            .set('x-user-id', 'j1')
            .expect(200);
        const karigar = await request(app)
            .get('/api/daily-brief?language=en')
            .set('x-user-id', 'k1')
            .expect(200);
        const otherJeweller = await request(app)
            .get('/api/daily-brief')
            .set('x-user-id', 'j2')
            .expect(200);
        const forbiddenTick = await request(app)
            .post('/api/daily-brief/tick')
            .set('x-user-id', 'k1')
            .send({ fastForwardHours: 1 })
            .expect(400);
        const fastForward = await request(app)
            .post('/api/daily-brief/tick')
            .set('x-user-id', 'j1')
            .send({ fastForwardHours: 1, language: 'kn' })
            .expect(200);
        const fastForwardedBrief = await request(app)
            .get(`/api/daily-brief?language=kn&asOf=${encodeURIComponent(fastForward.body.evaluationTime)}`)
            .set('x-user-id', 'j1')
            .expect(200);

        expect(jeweller.body.language).toBe('kn');
        expect(jeweller.body.items.some((item: { title: string }) => /ಅಪಾಯ/.test(item.title))).toBe(true);
        expect(karigar.body.items.some((item: { orderId: string }) => item.orderId === 'ord-today')).toBe(true);
        expect(otherJeweller.body.items).toHaveLength(0);
        expect(forbiddenTick.body.error).toMatch(/jeweller/i);
        expect(fastForward.body.generated).toBe(true);
        expect(fastForward.body.brief.language).toBe('kn');
        expect(fastForward.body.brief.preview).toBe(false);
        expect(fastForward.body.brief.briefDate).toBe('2026-11-16');
        expect(fastForwardedBrief.body.preview).toBe(false);
    });
});
