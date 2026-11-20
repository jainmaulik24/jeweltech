/**
 * @fileoverview Seed script to populate DB with synthetic users and orders.
 */
import db from './db';
import { now } from './clock';
import { appendLedgerEvent } from './ledger';
import { toFineGoldPerMilleMg } from './calc';
import { formatAgreementSummary } from './agreements';
import { AGREEMENT_CONFIG, RETURN_RECONCILIATION_CONFIG } from './agreementConfig';
import { GOLD_AT_LARGE_CONFIG } from './goldAtLargeConfig';
import { setClock } from './clock';
import { DEADLINE_DEMO_CONFIG } from './deadlineConfig';
import { DAILY_BRIEF_CONFIG } from './dailyBriefConfig';
import { DISPUTE_CONFIG } from './disputeConfig';
import { GOLD_JOURNEY_CONFIG } from './goldJourneyConfig';
import { acknowledgeCustodyTransfer, transferCustody } from './deadlineAgent';
import { KARIGAR_FLOAT_CONFIG } from './karigarFloatConfig';
import { KARIGAR_EXPOSURE_CONFIG } from './karigarExposureConfig';

console.log('🌱 Starting DB seed...');

// Clear existing data safely
db.exec(`
  DELETE FROM daily_briefs; DELETE FROM deadline_actions; DELETE FROM custody_transfers; DELETE FROM cash_dues;
  DELETE FROM owner_issue_approvals; DELETE FROM karigar_floats;
  DELETE FROM karigar_profiles; DELETE FROM staff_profiles;
  DELETE FROM dispute_evidence; DELETE FROM dispute_actions; DELETE FROM dispute_carries;
  DELETE FROM nudges; DELETE FROM consents; DELETE FROM disputes;
  DELETE FROM wastage_agreements; DELETE FROM ledger_events; DELETE FROM orders; DELETE FROM users;
`);

const insertUser = db.prepare('INSERT INTO users (id, role, name, phone, pin) VALUES (?, ?, ?, ?, ?)');

// FIX IS HERE: Added due_date to the SQL string
const insertOrder = db.prepare('INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date) VALUES (?, ?, ?, ?, ?)');
const insertTargetOrder = db.prepare(`
    INSERT INTO orders
        (id, jeweller_id, karigar_id, description, due_date, target_weight_mg, tolerance_mg)
    VALUES (?, 'j1', 'k1', ?, ?, ?, ?)
`);
const insertOccasionOrder = db.prepare(`
    INSERT INTO orders (id, jeweller_id, karigar_id, description, due_date, occasion_date, job_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertScenarioAgreement = db.prepare(`
    INSERT INTO wastage_agreements
    (id, order_id, jeweller_id, karigar_id, job_type, basis, percent_bps,
     labour_rate_paise_per_gram, sweep_owner, karigar_sweep_share_bps,
     cash_rate_policy, version, effective_at, status, accepted_at, created_at)
    VALUES (?, ?, 'j1', 'k1', 'plain', 'fine_issued', ?, 4000, 'karigar',
     10000, 'settlement', 1, ?, 'accepted', ?, ?)
`);

const appendAt = (date: Date, event: Parameters<typeof appendLedgerEvent>[0]) => {
    setClock({ now: () => date });
    return appendLedgerEvent(event);
};

// Run everything inside a transaction for safety
const seed = db.transaction(() => {
    // 1. Create 2 Jewellers
    const jewellers = ['j1', 'j2'];
    insertUser.run('j1', 'jeweller', 'Sri Raj Jewellers', '111', '1234');
    insertUser.run('j2', 'jeweller', 'Laxmi Gold Palace', '222', '1234');
    insertUser.run('s1', 'staff', 'Sample Staff', '777', '1234');

    // 2. Create 6 Karigars
    const karigars = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'];
    karigars.forEach((id, index) => insertUser.run(
        id,
        'karigar',
        id === 'k1' ? 'Ramesh' : `Karigar ${index + 1}`,
        String(333 + index),
        '1234',
    ));
    const insertKarigarProfile = db.prepare(`
        INSERT INTO karigar_profiles
            (user_id, language, capacity_open_jobs, specializations_json, completed_jobs, on_time_jobs)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    DEADLINE_DEMO_CONFIG.karigarProfiles.forEach((profile) => insertKarigarProfile.run(
        profile.userId,
        profile.language,
        profile.capacityOpenJobs,
        JSON.stringify(profile.specializations),
        profile.completedJobs,
        profile.onTimeJobs,
    ));
    db.prepare('INSERT INTO staff_profiles (user_id, owner_jeweller_id) VALUES (?, ?)')
        .run('s1', 'j1');

    // Generate a default due date (7 days from now)
    const seedTime = now();
    const dueDate = new Date(seedTime.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // 3. Create 10 Orders (Job-works)
    for (let i = 1; i <= 10; i++) {
        // Assign randomly to jewellers and karigars
        const jId = jewellers[i % 2];
        const kId = karigars[i % 6];

        // FIX IS HERE: Passed the dueDate variable into the run command
        insertOrder.run(`ord-${i}`, jId, kId, `Making 2 Gold Bangles - Batch ${i}`, dueDate);
    }

    const karigarSlipScenario = {
        name: 'Ramesh paper-slip examples',
        accountOrderId: 'ord-slip-ramesh-account',
        stoneOrderId: 'ord-slip-ramesh-stone',
        issuedMg: 10_000,
        wastageMg: 600,
        stoneMg: 600,
        givenAgainMg: 500,
    };
    insertOrder.run(
        karigarSlipScenario.accountOrderId,
        'j1',
        'k1',
        'SYNTHETIC paper slip · repeat issue example',
        dueDate,
    );
    appendAt(seedTime, {
        id: 'evt-slip-ramesh-issued',
        orderId: karigarSlipScenario.accountOrderId,
        type: 'issue',
        weightMg: karigarSlipScenario.issuedMg,
        purityPerMille: 999,
        status: 'acknowledged',
        createdBy: 'j1',
        notes: 'SYNTHETIC paper-slip starting issue.',
        idempotencyKey: 'slip-ramesh-issued',
    });
    appendAt(seedTime, {
        id: 'evt-slip-ramesh-wastage',
        orderId: karigarSlipScenario.accountOrderId,
        type: 'process_loss',
        weightMg: karigarSlipScenario.wastageMg,
        fineWeightMg: toFineGoldPerMilleMg(karigarSlipScenario.wastageMg, 999),
        purityPerMille: 999,
        status: 'acknowledged',
        createdBy: 'j1',
        notes: 'SYNTHETIC paper-slip wastage example.',
        idempotencyKey: 'slip-ramesh-wastage',
    });
    appendAt(seedTime, {
        id: 'evt-slip-ramesh-refill',
        orderId: karigarSlipScenario.accountOrderId,
        type: 'issue',
        weightMg: karigarSlipScenario.givenAgainMg,
        purityPerMille: 999,
        status: 'acknowledged',
        createdBy: 'j1',
        notes: 'SYNTHETIC additional gold given again.',
        idempotencyKey: 'slip-ramesh-refill',
    });
    insertOrder.run(
        karigarSlipScenario.stoneOrderId,
        'j1',
        'k1',
        'SYNTHETIC stone-set paper slip',
        dueDate,
    );
    appendAt(seedTime, {
        id: 'evt-slip-ramesh-stone-issued',
        orderId: karigarSlipScenario.stoneOrderId,
        type: 'issue',
        weightMg: karigarSlipScenario.issuedMg,
        purityPerMille: 916,
        status: 'acknowledged',
        createdBy: 'j1',
        notes: 'SYNTHETIC stone-set starting issue.',
        idempotencyKey: 'slip-ramesh-stone-issued',
    });
    appendAt(seedTime, {
        id: 'evt-slip-ramesh-stone-return',
        orderId: karigarSlipScenario.stoneOrderId,
        type: 'return',
        weightMg: 9_400,
        purityPerMille: 916,
        grossWeightMg: karigarSlipScenario.issuedMg,
        stoneWeightMg: karigarSlipScenario.stoneMg,
        otherNonGoldWeightMg: 0,
        status: 'acknowledged',
        createdBy: 'k1',
        notes: 'SYNTHETIC gross 10000 mg; stone 600 mg; net gold 9400 mg.',
        idempotencyKey: 'slip-ramesh-stone-return',
    });
    appendAt(seedTime, {
        id: 'evt-slip-ramesh-stone-loss',
        orderId: karigarSlipScenario.stoneOrderId,
        type: 'process_loss',
        weightMg: karigarSlipScenario.stoneMg,
        fineWeightMg: toFineGoldPerMilleMg(karigarSlipScenario.stoneMg, 916),
        purityPerMille: 916,
        status: 'acknowledged',
        createdBy: 'j1',
        notes: 'SYNTHETIC process-loss posting for the stone-set example.',
        idempotencyKey: 'slip-ramesh-stone-loss',
    });

    const floatDemo = KARIGAR_FLOAT_CONFIG.demo;
    db.prepare(`
        INSERT INTO orders
            (id, jeweller_id, karigar_id, description, status, due_date, job_type, target_weight_mg, tolerance_mg)
        VALUES (?, ?, ?, 'Gold float account · Ramesh', 'closed', ?, 'plain', 0, 0)
    `).run(floatDemo.ledgerOrderId, floatDemo.jewellerId, floatDemo.karigarId, dueDate);
    db.prepare(`
        INSERT INTO karigar_floats (id, jeweller_id, karigar_id, ledger_order_id, created_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(
        floatDemo.floatId,
        floatDemo.jewellerId,
        floatDemo.karigarId,
        floatDemo.ledgerOrderId,
        seedTime.toISOString(),
    );
    appendLedgerEvent({
        id: 'evt-float-demo-issue',
        orderId: floatDemo.ledgerOrderId,
        type: 'issue',
        weightMg: floatDemo.weightMg,
        purityPerMille: floatDemo.purityPerMille,
        debitAccount: 'jeweller_vault',
        creditAccount: 'karigar_float',
        floatId: floatDemo.floatId,
        status: 'acknowledged',
        createdBy: floatDemo.jewellerId,
        notes: 'SIMULATED 100 g 24K karigar float; three sample jobs draw from this balance.',
        idempotencyKey: 'float-demo-issue-100g',
    });
    floatDemo.draws.forEach((draw, index) => {
        insertOrder.run(draw.orderId, floatDemo.jewellerId, floatDemo.karigarId, draw.description, dueDate);
        appendLedgerEvent({
            id: `evt-float-demo-draw-${index + 1}`,
            orderId: draw.orderId,
            type: 'issue',
            weightMg: draw.weightMg,
            purityPerMille: floatDemo.purityPerMille,
            debitAccount: 'karigar_float',
            creditAccount: 'karigar_wip',
            floatId: floatDemo.floatId,
            status: 'acknowledged',
            createdBy: floatDemo.jewellerId,
            notes: 'SIMULATED draw-down from Ramesh’s seeded karigar float.',
            idempotencyKey: `float-demo-draw-${index + 1}`,
        });
    });

    const exposureScenario = KARIGAR_EXPOSURE_CONFIG.demoScenario;
    const exposureStart = new Date(seedTime.getTime() - (KARIGAR_EXPOSURE_CONFIG.replay.days - 1) * 86_400_000);
    const exposureFloatCreatedAt = exposureStart.toISOString();
    const exposureDueDate = new Date(seedTime.getTime() - 2 * 86_400_000).toISOString();
    db.prepare(`
        INSERT INTO orders
            (id, jeweller_id, karigar_id, description, status, due_date, job_type, target_weight_mg, tolerance_mg)
        VALUES (?, ?, ?, 'SYNTHETIC float replay account', 'closed', ?, 'plain', 0, 0)
    `).run(
        exposureScenario.floatOrderId,
        exposureScenario.jewellerId,
        exposureScenario.karigarId,
        exposureFloatCreatedAt,
    );
    db.prepare(`
        INSERT INTO karigar_floats (id, jeweller_id, karigar_id, ledger_order_id, created_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(
        exposureScenario.floatId,
        exposureScenario.jewellerId,
        exposureScenario.karigarId,
        exposureScenario.floatOrderId,
        exposureFloatCreatedAt,
    );
    insertOrder.run(
        exposureScenario.workOrderId,
        exposureScenario.jewellerId,
        exposureScenario.karigarId,
        exposureScenario.name,
        exposureDueDate,
    );
    appendAt(exposureStart, {
        id: 'evt-exposure-replay-opening-float',
        orderId: exposureScenario.floatOrderId,
        type: 'issue',
        weightMg: exposureScenario.openingFloatMg,
        purityPerMille: 999,
        debitAccount: 'jeweller_vault',
        creditAccount: 'karigar_float',
        floatId: exposureScenario.floatId,
        status: 'acknowledged',
        createdBy: exposureScenario.jewellerId,
        notes: `SYNTHETIC replay opening float for ${exposureScenario.name}.`,
        idempotencyKey: 'exposure-replay-opening-float',
    });
    for (const [index, stage] of exposureScenario.stages.entries()) {
        const stageDate = new Date(exposureStart.getTime() + stage.day * 86_400_000);
        const stageKey = `exposure-replay-stage-${index + 1}`;
        appendAt(stageDate, {
            id: `evt-${stageKey}-topup`,
            orderId: exposureScenario.floatOrderId,
            type: 'issue',
            weightMg: stage.issueMg,
            purityPerMille: 999,
            debitAccount: 'jeweller_vault',
            creditAccount: 'karigar_float',
            floatId: exposureScenario.floatId,
            status: 'acknowledged',
            createdBy: exposureScenario.jewellerId,
            notes: `SYNTHETIC replay float top-up for ${exposureScenario.name}.`,
            idempotencyKey: `${stageKey}-topup`,
        });
        appendAt(stageDate, {
            id: `evt-${stageKey}-draw`,
            orderId: exposureScenario.workOrderId,
            type: 'issue',
            weightMg: stage.issueMg,
            purityPerMille: 999,
            debitAccount: 'karigar_float',
            creditAccount: 'karigar_wip',
            floatId: exposureScenario.floatId,
            status: 'acknowledged',
            createdBy: exposureScenario.jewellerId,
            notes: `SYNTHETIC replay draw from float for ${exposureScenario.name}.`,
            idempotencyKey: `${stageKey}-draw`,
        });
        if (stage.returnMg > 0) {
            appendAt(stageDate, {
                id: `evt-${stageKey}-return`,
                orderId: exposureScenario.workOrderId,
                type: 'return',
                weightMg: stage.returnMg,
                purityPerMille: 916,
                status: 'acknowledged',
                createdBy: exposureScenario.jewellerId,
                notes: `SYNTHETIC replay return for ${exposureScenario.name}.`,
                idempotencyKey: `${stageKey}-return`,
            });
        }
    }

    insertOrder.run('ord-handshake-demo', 'j1', 'k1', 'Plain gold bangles - Agreement sample', dueDate);
    const weddingOccasion = new Date(seedTime.getTime() + DEADLINE_DEMO_CONFIG.wedding.occasionInDays * 86_400_000);
    insertOccasionOrder.run(
        DEADLINE_DEMO_CONFIG.wedding.orderId,
        'j1',
        'k1',
        DEADLINE_DEMO_CONFIG.wedding.description,
        weddingOccasion.toISOString(),
        weddingOccasion.toISOString(),
        DEADLINE_DEMO_CONFIG.wedding.jobType,
    );
    const weddingAgreementId = `agr-${DEADLINE_DEMO_CONFIG.wedding.orderId}-v1`;
    const weddingAgreementTime = seedTime.toISOString();
    const weddingAgreementPercentBps = DISPUTE_CONFIG.demo.agreementPercentBps;
    insertScenarioAgreement.run(
        weddingAgreementId,
        DEADLINE_DEMO_CONFIG.wedding.orderId,
        weddingAgreementPercentBps,
        weddingAgreementTime,
        weddingAgreementTime,
        weddingAgreementTime,
    );
    const weddingAgreement = {
        id: weddingAgreementId,
        orderId: DEADLINE_DEMO_CONFIG.wedding.orderId,
        jobType: DEADLINE_DEMO_CONFIG.wedding.jobType,
        basis: 'fine_issued' as const,
        percentBps: weddingAgreementPercentBps,
        labourRatePaisePerGram: 4000,
        sweepOwner: 'karigar' as const,
        karigarSweepShareBps: 10000,
        version: 1,
    };
    appendLedgerEvent({
        id: `evt-${DEADLINE_DEMO_CONFIG.wedding.orderId}-agreement`,
        orderId: DEADLINE_DEMO_CONFIG.wedding.orderId,
        type: 'agreement_version',
        weightMg: 0,
        status: 'acknowledged',
        createdBy: 'j1',
        notes: JSON.stringify({
            agreement: weddingAgreement,
            summary: formatAgreementSummary(weddingAgreement, 'Ramesh'),
        }),
        idempotencyKey: `${DEADLINE_DEMO_CONFIG.wedding.orderId}-agreement-v1`,
        agreementId: weddingAgreementId,
        agreementVersion: 1,
    });
    appendLedgerEvent({
        id: `evt-${DEADLINE_DEMO_CONFIG.wedding.orderId}-agreement-ack`,
        orderId: DEADLINE_DEMO_CONFIG.wedding.orderId,
        type: 'agreement_acknowledgement',
        weightMg: 0,
        status: 'acknowledged',
        createdBy: 'k1',
        notes: JSON.stringify({
            agreementId: weddingAgreementId,
            version: 1,
            acceptedAt: weddingAgreementTime,
        }),
        idempotencyKey: `${DEADLINE_DEMO_CONFIG.wedding.orderId}-agreement-ack-v1`,
        agreementId: weddingAgreementId,
        agreementVersion: 1,
    });

    const versions = [
        { basis: 'fine_issued', percentBps: 300, sweepOwner: 'karigar', karigarSweepShareBps: 10000, cashRatePolicy: 'issue', status: 'accepted' },
        { basis: 'gross_issued', percentBps: 200, sweepOwner: 'split', karigarSweepShareBps: 5000, cashRatePolicy: 'return', status: 'accepted' },
        { basis: 'finished_weight', percentBps: 250, sweepOwner: 'karigar', karigarSweepShareBps: 10000, cashRatePolicy: 'settlement', status: 'draft' },
    ] as const;
    const insertAgreement = db.prepare(`
        INSERT INTO wastage_agreements
        (id, order_id, jeweller_id, karigar_id, job_type, basis, percent_bps,
         labour_rate_paise_per_gram, sweep_owner, karigar_sweep_share_bps,
         cash_rate_policy, version, effective_at, status, accepted_at, created_at)
        VALUES (?, 'ord-handshake-demo', 'j1', 'k1', 'plain', ?, ?, 4000, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    versions.forEach((terms, index) => {
        const version = index + 1;
        const id = `agr-handshake-demo-v${version}`;
        const createdAt = new Date(seedTime.getTime() - (versions.length - version) * 60_000).toISOString();
        const acceptedAt = terms.status === 'accepted' ? createdAt : null;
        insertAgreement.run(
            id, terms.basis, terms.percentBps, terms.sweepOwner, terms.karigarSweepShareBps,
            terms.cashRatePolicy, version, createdAt, terms.status, acceptedAt, createdAt
        );
        const agreement = {
            id,
            orderId: 'ord-handshake-demo',
            jobType: 'plain' as const,
            basis: terms.basis,
            percentBps: terms.percentBps,
            labourRatePaisePerGram: 4000,
            sweepOwner: terms.sweepOwner,
            karigarSweepShareBps: terms.karigarSweepShareBps,
            version,
        };
        appendLedgerEvent({
            id: `evt-handshake-demo-version-${version}`,
            orderId: 'ord-handshake-demo',
            type: 'agreement_version',
            weightMg: 0,
            amount: 0,
            status: acceptedAt ? 'acknowledged' : 'pending_ack',
            createdBy: 'j1',
            notes: JSON.stringify({ agreement, summary: formatAgreementSummary(agreement, 'Ramesh') }),
            idempotencyKey: `handshake-demo-version-${version}`,
            agreementId: id,
            agreementVersion: version,
        });
        if (acceptedAt) {
            appendLedgerEvent({
                id: `evt-handshake-demo-ack-${version}`,
                orderId: 'ord-handshake-demo',
                type: 'agreement_acknowledgement',
                weightMg: 0,
                amount: 0,
                status: 'acknowledged',
                createdBy: 'k1',
                notes: JSON.stringify({ agreementId: id, version, acceptedAt }),
                idempotencyKey: `handshake-demo-ack-${version}`,
                agreementId: id,
                agreementVersion: version,
            });
        }
    });

    appendLedgerEvent({
        id: 'evt-handshake-demo-issue-v2',
        orderId: 'ord-handshake-demo',
        type: 'issue',
        weightMg: 20000,
        purityPerMille: 916,
        amount: 0,
        status: 'acknowledged',
        createdBy: 'j1',
        notes: 'Sample issue pinned to agreement version 2.',
        idempotencyKey: 'handshake-demo-issue-v2',
        agreementId: 'agr-handshake-demo-v2',
        agreementVersion: 2,
    });

    appendLedgerEvent({
        id: 'evt-wedding-deadline-issue',
        orderId: DEADLINE_DEMO_CONFIG.wedding.orderId,
        type: 'issue',
        weightMg: DEADLINE_DEMO_CONFIG.wedding.issuedGrossMg,
        purityPerMille: DEADLINE_DEMO_CONFIG.wedding.issuedPurityPerMille,
        amount: 0,
        status: 'acknowledged',
        createdBy: 'j1',
        notes: 'SIMULATED wedding job issue; seeded for deadline rescue.',
        idempotencyKey: 'wedding-deadline-issue',
        agreementId: weddingAgreementId,
        agreementVersion: 1,
    });

    const journeyDemo = GOLD_JOURNEY_CONFIG.demo;
    insertOrder.run(journeyDemo.orderId, 'j1', 'k1', journeyDemo.description, dueDate);
    appendLedgerEvent({
        id: `evt-${journeyDemo.orderId}-issue`,
        orderId: journeyDemo.orderId,
        type: 'issue',
        weightMg: journeyDemo.issueWeightMg,
        purityPerMille: journeyDemo.purityPerMille,
        amount: 0,
        status: 'acknowledged',
        createdBy: 'j1',
        notes: 'SIMULATED gold issue for the three-stage journey demo.',
        idempotencyKey: `${journeyDemo.orderId}-issue`,
    });
    journeyDemo.handoffs.forEach((handoff, index) => {
        const sentWeightMg = index === 0
            ? journeyDemo.issueWeightMg
            : journeyDemo.handoffs[index - 1].receivedWeightMg;
        const transfer = transferCustody({
            orderId: journeyDemo.orderId,
            fromKarigarId: handoff.from,
            toKarigarId: handoff.to,
            weightMg: sentWeightMg,
            purityPerMille: journeyDemo.purityPerMille,
            receivedWeightMg: handoff.receivedWeightMg,
            receivedPurityPerMille: journeyDemo.purityPerMille,
            stage: handoff.stage,
            createdBy: handoff.from,
            idempotencyKey: `${journeyDemo.orderId}-${handoff.stage}`,
        });
        acknowledgeCustodyTransfer(transfer.id, handoff.from, seedTime);
        acknowledgeCustodyTransfer(transfer.id, handoff.to, seedTime);
    });
    const pendingJourneyTransfer = transferCustody({
        orderId: journeyDemo.orderId,
        fromKarigarId: 'j1',
        toKarigarId: 'k1',
        weightMg: journeyDemo.handoffs[journeyDemo.handoffs.length - 1].receivedWeightMg,
        purityPerMille: journeyDemo.purityPerMille,
        stage: 'reassignment',
        createdBy: 'j1',
        idempotencyKey: `${journeyDemo.orderId}-pending-reassignment`,
    });
    acknowledgeCustodyTransfer(pendingJourneyTransfer.id, 'j1', seedTime);

    const disputeDemo = DISPUTE_CONFIG.demo;
    const defaultScenarioAgreementPercentBps = disputeDemo.agreementPercentBps;
    const disputeAgreementId = `agr-${disputeDemo.orderId}-v1`;
    const disputeTime = seedTime.toISOString();
    insertOrder.run(disputeDemo.orderId, 'j1', 'k1', disputeDemo.description, dueDate);
    insertScenarioAgreement.run(disputeAgreementId, disputeDemo.orderId, defaultScenarioAgreementPercentBps, disputeTime, disputeTime, disputeTime);
    appendLedgerEvent({
        id: `evt-${disputeDemo.orderId}-issue`,
        orderId: disputeDemo.orderId,
        type: 'issue',
        weightMg: disputeDemo.issueWeightMg,
        purityPerMille: disputeDemo.purityPerMille,
        status: 'acknowledged',
        createdBy: 'j1',
        notes: 'SIMULATED issue for the named dispute scenario.',
        idempotencyKey: `${disputeDemo.orderId}-issue`,
        agreementId: disputeAgreementId,
        agreementVersion: 1,
        ratePolicy: 'issue',
        rateSnapshotPaisePerGram: AGREEMENT_CONFIG.demo.simulatedRatesPaisePerGram.issue,
    });
    const disputeReturnEventId = `evt-${disputeDemo.orderId}-return`;
    appendLedgerEvent({
        id: disputeReturnEventId,
        orderId: disputeDemo.orderId,
        type: 'return',
        weightMg: disputeDemo.returnWeightMg,
        purityPerMille: disputeDemo.purityPerMille,
        status: 'acknowledged',
        createdBy: 'k1',
        notes: 'SIMULATED return. The two sides recorded different scale readings.',
        idempotencyKey: `${disputeDemo.orderId}-return`,
        agreementId: disputeAgreementId,
        agreementVersion: 1,
        ratePolicy: 'return',
        rateSnapshotPaisePerGram: AGREEMENT_CONFIG.demo.simulatedRatesPaisePerGram.return,
    });
    db.prepare(`
        INSERT INTO disputes
            (id, event_id, karigar_id, reason, status, created_by, created_at,
             claimed_weight_mg, claimed_purity_per_mille)
        VALUES (?, ?, 'k1', 'Scale readings differ; please review together.', 'unresolved',
            'k1', ?, ?, ?)
    `).run(
        `dispute-${disputeDemo.orderId}`,
        disputeReturnEventId,
        disputeTime,
        disputeDemo.claimedWeightMg,
        disputeDemo.purityPerMille,
    );
    db.prepare(`
        INSERT INTO dispute_actions (id, dispute_id, actor_id, action, details_json, created_at)
        VALUES (?, ?, 'k1', 'opened', ?, ?)
    `).run(
        `action-${disputeDemo.orderId}-opened`,
        `dispute-${disputeDemo.orderId}`,
        JSON.stringify({ eventId: disputeReturnEventId, unit: 'mg' }),
        disputeTime,
    );

    const dailyBriefOrders = [
        {
            id: DAILY_BRIEF_CONFIG.demo.dueTodayOrderId,
            description: DAILY_BRIEF_CONFIG.demo.dueTodayDescription,
        },
        {
            id: DAILY_BRIEF_CONFIG.demo.jewellerApprovalOrderId,
            description: DAILY_BRIEF_CONFIG.demo.jewellerApprovalDescription,
        },
    ];
    dailyBriefOrders.forEach((order) => {
        const agreementId = `agr-${order.id}-v1`;
        const agreementTime = seedTime.toISOString();
        insertOrder.run(order.id, 'j1', 'k1', order.description, seedTime.toISOString());
        insertScenarioAgreement.run(agreementId, order.id, defaultScenarioAgreementPercentBps, agreementTime, agreementTime, agreementTime);
        appendLedgerEvent({
            id: `evt-${order.id}-agreement`,
            orderId: order.id,
            type: 'agreement_version',
            weightMg: 0,
            status: 'acknowledged',
            createdBy: 'j1',
            notes: `Accepted wastage agreement v1 for ${order.description}.`,
            idempotencyKey: `${order.id}-agreement-v1`,
            agreementId,
            agreementVersion: 1,
        });
        appendLedgerEvent({
            id: `evt-${order.id}-agreement-ack`,
            orderId: order.id,
            type: 'agreement_acknowledgement',
            weightMg: 0,
            status: 'acknowledged',
            createdBy: 'k1',
            notes: JSON.stringify({ agreementId, version: 1, acceptedAt: agreementTime }),
            idempotencyKey: `${order.id}-agreement-ack-v1`,
            agreementId,
            agreementVersion: 1,
        });
    });

    const dueTodayOrder = DAILY_BRIEF_CONFIG.demo.dueTodayOrderId;
    const dueTodayAgreement = `agr-${dueTodayOrder}-v1`;
    appendLedgerEvent({
        id: `evt-${dueTodayOrder}-issue`,
        orderId: dueTodayOrder,
        type: 'issue',
        weightMg: DAILY_BRIEF_CONFIG.demo.issuedGrossMg,
        purityPerMille: DAILY_BRIEF_CONFIG.demo.issuedPurityPerMille,
        status: 'acknowledged',
        createdBy: 'j1',
        notes: 'SIMULATED gold issue for the due-today brief example.',
        idempotencyKey: `${dueTodayOrder}-issue`,
        agreementId: dueTodayAgreement,
        agreementVersion: 1,
    });
    appendLedgerEvent({
        id: `evt-${dueTodayOrder}-payment`,
        orderId: dueTodayOrder,
        type: 'payment',
        weightMg: 0,
        amount: DAILY_BRIEF_CONFIG.demo.pendingPaymentAmountPaise,
        status: 'pending_ack',
        createdBy: 'j1',
        notes: 'SIMULATED payment awaiting karigar acknowledgement.',
        idempotencyKey: `${dueTodayOrder}-payment`,
        agreementId: dueTodayAgreement,
        agreementVersion: 1,
    });

    const jewellerApprovalOrder = DAILY_BRIEF_CONFIG.demo.jewellerApprovalOrderId;
    const jewellerApprovalAgreement = `agr-${jewellerApprovalOrder}-v1`;
    appendLedgerEvent({
        id: `evt-${jewellerApprovalOrder}-issue`,
        orderId: jewellerApprovalOrder,
        type: 'issue',
        weightMg: DAILY_BRIEF_CONFIG.demo.issuedGrossMg,
        purityPerMille: DAILY_BRIEF_CONFIG.demo.issuedPurityPerMille,
        status: 'acknowledged',
        createdBy: 'j1',
        notes: 'SIMULATED gold issue for the jeweller approval brief example.',
        idempotencyKey: `${jewellerApprovalOrder}-issue`,
        agreementId: jewellerApprovalAgreement,
        agreementVersion: 1,
    });
    const pendingReturnEventId = `evt-${jewellerApprovalOrder}-return`;
    appendLedgerEvent({
        id: pendingReturnEventId,
        orderId: jewellerApprovalOrder,
        type: 'return',
        weightMg: DAILY_BRIEF_CONFIG.demo.pendingReturnGrossMg,
        purityPerMille: DAILY_BRIEF_CONFIG.demo.issuedPurityPerMille,
        status: 'pending_ack',
        createdBy: 'k1',
        notes: 'SIMULATED finished lot awaiting jeweller acknowledgement.',
        idempotencyKey: `${jewellerApprovalOrder}-return`,
        agreementId: jewellerApprovalAgreement,
        agreementVersion: 1,
    });
    db.prepare(`
        INSERT INTO disputes (id, event_id, karigar_id, reason, status)
        VALUES (?, ?, 'k1', 'Return requires review', 'unresolved')
    `).run(`dispute-${pendingReturnEventId}`, pendingReturnEventId);

    RETURN_RECONCILIATION_CONFIG.demoScenarios.forEach((scenario) => {
        insertOrder.run(scenario.orderId, 'j1', 'k1', scenario.description, dueDate);
        const agreementId = `agr-${scenario.orderId}-v1`;
        const agreementTime = seedTime.toISOString();
        insertScenarioAgreement.run(agreementId, scenario.orderId, defaultScenarioAgreementPercentBps, agreementTime, agreementTime, agreementTime);
        const agreement = {
            id: agreementId,
            orderId: scenario.orderId,
            jobType: 'plain' as const,
            basis: 'fine_issued' as const,
            percentBps: 200,
            labourRatePaisePerGram: 4000,
            sweepOwner: 'karigar' as const,
            karigarSweepShareBps: 10000,
            version: 1,
        };
        appendLedgerEvent({
            id: `evt-${scenario.orderId}-agreement`,
            orderId: scenario.orderId,
            type: 'agreement_version',
            weightMg: 0,
            amount: 0,
            status: 'acknowledged',
            createdBy: 'j1',
            notes: JSON.stringify({ agreement, summary: formatAgreementSummary(agreement, 'Ramesh') }),
            idempotencyKey: `${scenario.orderId}-agreement-v1`,
            agreementId,
            agreementVersion: 1,
        });
        appendLedgerEvent({
            id: `evt-${scenario.orderId}-agreement-ack`,
            orderId: scenario.orderId,
            type: 'agreement_acknowledgement',
            weightMg: 0,
            amount: 0,
            status: 'acknowledged',
            createdBy: 'k1',
            notes: JSON.stringify({ agreementId, version: 1, acceptedAt: agreementTime }),
            idempotencyKey: `${scenario.orderId}-agreement-ack-v1`,
            agreementId,
            agreementVersion: 1,
        });
        appendLedgerEvent({
            id: `evt-${scenario.orderId}-issue`,
            orderId: scenario.orderId,
            type: 'issue',
            weightMg: 100_000,
            purityPerMille: 916,
            amount: 0,
            status: 'acknowledged',
            createdBy: 'j1',
            notes: `${scenario.label} sample issue`,
            idempotencyKey: `${scenario.orderId}-issue`,
            agreementId,
            agreementVersion: 1,
        });
    });

    RETURN_RECONCILIATION_CONFIG.idealReturnScenarios.forEach((scenario) => {
        insertTargetOrder.run(
            scenario.orderId,
            scenario.description,
            dueDate,
            scenario.targetWeightMg ?? RETURN_RECONCILIATION_CONFIG.targetWeightMg,
            RETURN_RECONCILIATION_CONFIG.targetToleranceMg,
        );
        const agreementId = `agr-${scenario.orderId}-v1`;
        const agreementTime = seedTime.toISOString();
        db.prepare(`
            INSERT INTO wastage_agreements
                (id, order_id, jeweller_id, karigar_id, job_type, basis, percent_bps,
                 labour_rate_paise_per_gram, sweep_owner, karigar_sweep_share_bps,
                 cash_rate_policy, version, effective_at, status, accepted_at, created_at)
            VALUES (?, ?, 'j1', 'k1', 'stone_set', 'ideal_return_buffer', 0,
                    0, 'karigar', 10000, 'settlement', 1, ?, 'accepted', ?, ?)
        `).run(agreementId, scenario.orderId, agreementTime, agreementTime, agreementTime);
        const agreement = {
            id: agreementId,
            orderId: scenario.orderId,
            jobType: 'stone_set' as const,
            basis: 'ideal_return_buffer' as const,
            percentBps: 0,
            labourRatePaisePerGram: 0,
            sweepOwner: 'karigar' as const,
            karigarSweepShareBps: 10000,
            version: 1,
        };
        appendLedgerEvent({
            id: `evt-${scenario.orderId}-agreement`,
            orderId: scenario.orderId,
            type: 'agreement_version',
            weightMg: 0,
            status: 'acknowledged',
            createdBy: 'j1',
            notes: JSON.stringify({ agreement, summary: formatAgreementSummary(agreement, 'Ramesh') }),
            idempotencyKey: `${scenario.orderId}-agreement-v1`,
            agreementId,
            agreementVersion: 1,
        });
        appendLedgerEvent({
            id: `evt-${scenario.orderId}-agreement-ack`,
            orderId: scenario.orderId,
            type: 'agreement_acknowledgement',
            weightMg: 0,
            status: 'acknowledged',
            createdBy: 'k1',
            notes: JSON.stringify({ agreementId, version: 1, acceptedAt: agreementTime }),
            idempotencyKey: `${scenario.orderId}-agreement-ack-v1`,
            agreementId,
            agreementVersion: 1,
        });
        appendLedgerEvent({
            id: `evt-${scenario.orderId}-issue`,
            orderId: scenario.orderId,
            type: 'issue',
            weightMg: scenario.issuedGrossMg ?? 100_000,
            purityPerMille: scenario.issuedPurityPerMille ?? 999,
            status: 'acknowledged',
            createdBy: 'j1',
            notes: `SIMULATED issue · ${scenario.label}`,
            idempotencyKey: `${scenario.orderId}-issue`,
            agreementId,
            agreementVersion: 1,
            ratePolicy: 'issue',
            rateSnapshotPaisePerGram: AGREEMENT_CONFIG.demo.simulatedRatesPaisePerGram.issue,
        });
    });

    const insertBoardAgreement = db.prepare(`
        INSERT INTO wastage_agreements
        (id, order_id, jeweller_id, karigar_id, job_type, basis, percent_bps,
         labour_rate_paise_per_gram, sweep_owner, karigar_sweep_share_bps,
         cash_rate_policy, version, effective_at, status, accepted_at, created_at)
        VALUES (?, ?, 'j1', ?, 'plain', 'fine_issued', 200, ?, 'karigar',
         10000, 'settlement', 1, ?, 'accepted', ?, ?)
    `);

    try {
        GOLD_AT_LARGE_CONFIG.demoJobs.forEach((job) => {
            const issueAt = new Date(seedTime.getTime() - job.ageDays * 86_400_000);
            const dueAt = new Date(seedTime.getTime() + job.dueInDays * 86_400_000);
            const returnAt = new Date(seedTime.getTime() - 86_400_000);
            const agreementId = `agr-${job.orderId}-v1`;
            insertOrder.run(job.orderId, 'j1', job.karigarId, job.description, dueAt.toISOString());
            insertBoardAgreement.run(
                agreementId,
                job.orderId,
                job.karigarId,
                job.labourRatePaisePerGram,
                issueAt.toISOString(),
                issueAt.toISOString(),
                issueAt.toISOString(),
            );

            appendAt(issueAt, {
                id: `evt-${job.orderId}-agreement`,
                orderId: job.orderId,
                type: 'agreement_version',
                weightMg: 0,
                amount: 0,
                status: 'acknowledged',
                createdBy: 'j1',
                notes: `Accepted wastage agreement v1 for ${job.description}.`,
                idempotencyKey: `${job.orderId}-agreement-v1`,
                agreementId,
                agreementVersion: 1,
            });
            appendAt(issueAt, {
                id: `evt-${job.orderId}-agreement-ack`,
                orderId: job.orderId,
                type: 'agreement_acknowledgement',
                weightMg: 0,
                amount: 0,
                status: 'acknowledged',
                createdBy: job.karigarId,
                notes: JSON.stringify({ agreementId, version: 1, acceptedAt: issueAt.toISOString() }),
                idempotencyKey: `${job.orderId}-agreement-ack-v1`,
                agreementId,
                agreementVersion: 1,
            });
            appendAt(issueAt, {
                id: `evt-${job.orderId}-issue`,
                orderId: job.orderId,
                type: 'issue',
                weightMg: job.issuedGrossMg,
                purityPerMille: job.issuedPurityPerMille,
                amount: 0,
                status: 'acknowledged',
                createdBy: 'j1',
                notes: `Gold issued for ${job.description}.`,
                idempotencyKey: `${job.orderId}-issue`,
                agreementId,
                agreementVersion: 1,
            });

            if (job.returnedFinishedMg > 0) {
                appendAt(returnAt, {
                    id: `evt-${job.orderId}-finished-return`,
                    orderId: job.orderId,
                    type: 'return',
                    weightMg: job.returnedFinishedMg,
                    purityPerMille: job.issuedPurityPerMille,
                    amount: 0,
                    status: 'acknowledged',
                    createdBy: job.karigarId,
                    notes: 'Finished lot returned; purity reading is SIMULATED.',
                    idempotencyKey: `${job.orderId}-finished-return`,
                    agreementId,
                    agreementVersion: 1,
                });
            }
            if (job.scrapGrossMg > 0) {
                appendAt(returnAt, {
                    id: `evt-${job.orderId}-scrap`,
                    orderId: job.orderId,
                    type: 'scrap_entry',
                    weightMg: job.scrapGrossMg,
                    purityPerMille: job.issuedPurityPerMille,
                    amount: 0,
                    status: 'acknowledged',
                    createdBy: job.karigarId,
                    notes: 'Sweepings returned; purity reading is SIMULATED.',
                    idempotencyKey: `${job.orderId}-scrap`,
                    agreementId,
                    agreementVersion: 1,
                });
            }
            if (job.refinerGrossMg > 0) {
                appendAt(returnAt, {
                    id: `evt-${job.orderId}-refiner-transfer`,
                    orderId: job.orderId,
                    type: 'refiner_transfer',
                    weightMg: job.refinerGrossMg,
                    purityPerMille: job.issuedPurityPerMille,
                    amount: 0,
                    status: 'acknowledged',
                    createdBy: 'j1',
                    notes: 'Scrap sent to refiner.',
                    idempotencyKey: `${job.orderId}-refiner-transfer`,
                    agreementId,
                    agreementVersion: 1,
                });
            }
        });

        const dueScenario = DEADLINE_DEMO_CONFIG.overdueDues;
        const payByDate = new Date(seedTime.getTime() - dueScenario.overdueByDays * 86_400_000);
        db.prepare(`
            INSERT INTO cash_dues
                (id, order_id, jeweller_id, karigar_id, amount_paise, pay_by_date,
                 created_by, owner_jeweller_id, status, created_at)
            VALUES (?, ?, 'j1', 'k1', ?, ?, 's1', 'j1', 'open', ?)
        `).run(
            dueScenario.id,
            dueScenario.orderId,
            dueScenario.amountPaise,
            payByDate.toISOString(),
            seedTime.toISOString(),
        );

        const k1Job = GOLD_AT_LARGE_CONFIG.demoJobs[0];
        appendAt(seedTime, {
            id: `evt-${k1Job.orderId}-pending-payment`,
            orderId: k1Job.orderId,
            type: 'payment',
            weightMg: 0,
            amount: 10_000,
            status: 'pending_ack',
            createdBy: 'j1',
            notes: 'SIMULATED payment awaiting karigar acknowledgement.',
            idempotencyKey: `${k1Job.orderId}-pending-payment`,
        });
    } finally {
        setClock(null);
    }
});

seed();
console.log('✅ Seed complete! Added users, sample jobs, Ramesh paper-slip examples, dispute review, daily brief, deadline rescue, overdue dues, and gold-at-large scenarios.');