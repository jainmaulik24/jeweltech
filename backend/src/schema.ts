/**
 * @fileoverview Zod schemas for all Jeweltech entities.
 * Enforces integer-only rules for weights and money.
 */
import { z } from 'zod';
import { AGREEMENT_BASES, JOB_TYPES } from './agreementConfig';
import { DEADLINE_CONFIG } from './deadlineConfig';
import { DAILY_BRIEF_CONFIG } from './dailyBriefConfig';
import { DISPUTE_CONFIG, DisputeResolutionOption } from './disputeConfig';

// RULE 1: Integer milligrams ONLY. No floats allowed.
// Removed .nonnegative() here so we can support negative weights for correction events.
export const IntegerMg = z.number().int("Weight must be integer mg");
export const IntegerMoney = z.number().int("Money must be integer paise").nonnegative();
export const BasisPoints = z.number().int().min(0).max(10000);
export const IntegerPerMille = z.number().int().min(0).max(1000);
export const AccountTagSchema = z.enum([
    'jeweller_vault',
    'karigar_wip',
    'finished_goods',
    'scrap',
    'refiner',
    'process_loss',
]);
export type AccountTag = z.infer<typeof AccountTagSchema>;

export const WastageAgreementDraftSchema = z.object({
    jobType: z.enum(JOB_TYPES),
    basis: z.enum(AGREEMENT_BASES),
    percentBps: BasisPoints,
    labourRatePaisePerGram: IntegerMoney,
    sweepOwner: z.enum(['karigar', 'jeweller', 'split']),
    karigarSweepShareBps: BasisPoints,
    cashRatePolicy: z.enum(['issue', 'return', 'settlement']),
    effectiveAt: z.string().datetime().optional(),
}).superRefine((value, context) => {
    if (value.sweepOwner === 'karigar' && value.karigarSweepShareBps !== 10000) {
        context.addIssue({ code: 'custom', path: ['karigarSweepShareBps'], message: 'A karigar-owned sweep share must be 10000 bps.' });
    }
    if (value.sweepOwner === 'jeweller' && value.karigarSweepShareBps !== 0) {
        context.addIssue({ code: 'custom', path: ['karigarSweepShareBps'], message: 'A jeweller-owned sweep share must be 0 bps.' });
    }
});

const ReturnLotInputSchema = z.object({
    weightGrams: z.string().regex(/^\d+(\.\d{1,3})?$/, 'Weight must be entered in grams to at most 3 decimal places.'),
    purityPerMille: IntegerPerMille,
});

export const ReturnReconciliationRequestSchema = z.object({
    idempotencyKey: z.string().min(1),
    finishedLots: z.array(ReturnLotInputSchema.extend({
        method: z.enum(['touch', 'XRF', 'declared']),
    })).min(1),
    scrapLots: z.array(ReturnLotInputSchema).default([]),
});

export const UserSchema = z.object({
    id: z.string(),
    role: z.enum(['jeweller', 'staff', 'karigar']),
    name: z.string().min(1),
    phone: z.string().optional()
});

export const OrderSchema = z.object({
    id: z.string(),
    jewellerId: z.string(),
    karigarId: z.string(),
    description: z.string(),
    status: z.enum(['open', 'closed']),
    dueDate: z.string(),
    occasionDate: z.string().datetime().nullable().optional(),
    jobType: z.enum(JOB_TYPES).default('plain'),
});

export const CreateOrderSchema = z.object({
    jewellerId: z.string().min(1),
    karigarId: z.string().min(1),
    description: z.string().min(1),
    occasionDate: z.string().datetime().optional(),
    jobType: z.enum(JOB_TYPES).default('plain'),
});

// RULE 3 & 4: Append-only ledger events. Workflow status is mutable, financial facts are immutable.
export const LedgerEventSchema = z.object({
    id: z.string(),
    orderId: z.string(),
    type: z.enum([
        'issue',
        'return',
        'scrap_entry',
        'process_loss',
        'refiner_transfer',
        'custody_transfer_out',
        'custody_transfer_in',
        'custody_loss',
        'settlement',
        'payment',
        'correction',
        'agreement_version',
        'agreement_acknowledgement',
    ]),
    weightMg: IntegerMg.default(0),
    fineWeightMg: IntegerMg.nullable().default(null),
    purityPerMille: IntegerPerMille.nullable().default(null),
    debitAccount: AccountTagSchema.nullable().default(null),
    creditAccount: AccountTagSchema.nullable().default(null),
    amount: z.number().int().default(0),
    status: z.enum(['draft', 'pending_ack', 'acknowledged', 'contested']), // New state machine
    createdBy: z.string(), // Added to track who initiated the draft
    notes: z.string().nullable().default(null),
    idempotencyKey: z.string().min(1),
    previousHash: z.string().nullable(),
    hash: z.string(),
    agreementId: z.string().nullable().default(null),
    agreementVersion: z.number().int().positive().nullable().default(null),
    ratePolicy: z.enum(['issue', 'return', 'settlement']).nullable().default(null),
    rateSnapshotPaisePerGram: IntegerMoney.nullable().default(null),
    stage: z.string().nullable().default(null),
}).superRefine((event, context) => {
    if (event.type !== 'correction' && event.amount < 0) {
        context.addIssue({ code: 'custom', path: ['amount'], message: 'Only correction events may carry a signed amount.' });
    }
});

export const DeadlineTickRequestSchema = z.object({
    fastForwardHours: z.number().int().min(0).max(DEADLINE_CONFIG.maxFastForwardHours).default(0),
});

export const DailyBriefLanguageSchema = z.enum(['en', 'kn']);
export const DailyBriefAsOfSchema = z.string().datetime();
export const DailyBriefTickRequestSchema = z.object({
    fastForwardHours: z.number().int().min(0).max(DAILY_BRIEF_CONFIG.schedule.maxFastForwardHours).default(0),
    language: DailyBriefLanguageSchema.default('en'),
});

const DisputeEvidenceSchema = z.object({
    fileName: z.string().min(1).max(120),
    mimeType: z.enum(DISPUTE_CONFIG.allowedEvidenceMimeTypes),
    base64: z.string().min(1).max(Math.ceil(DISPUTE_CONFIG.maxEvidenceBytes * 4 / 3) + 4),
});

export const DisputeContestSchema = z.object({
    reason: z.string().trim().min(1).max(500),
    claimedWeightMg: IntegerMg.optional(),
    claimedPurityPerMille: IntegerPerMille.min(1).optional(),
    claimedAmountPaise: z.number().int().optional(),
    evidence: z.array(DisputeEvidenceSchema).max(DISPUTE_CONFIG.maxEvidenceAttachments).default([]),
});

export const DisputeResolutionSchema = z.object({
    option: z.enum(DISPUTE_CONFIG.resolutionOptions.map(({ value }) => value) as [DisputeResolutionOption, ...DisputeResolutionOption[]]),
    agreedWeightMg: IntegerMg.optional(),
    agreedPurityPerMille: IntegerPerMille.min(1).optional(),
    agreedAmountPaise: z.number().int().optional(),
});

export const CustodyTransferRequestSchema = z.object({
    karigarId: z.string().min(1),
});

export const GoldHandoffRequestSchema = z.object({
    toPartyId: z.string().min(1),
    stage: z.string().min(1),
    sentWeightMg: IntegerMg.positive(),
    sentPurityPerMille: IntegerPerMille.min(1),
    receivedWeightMg: IntegerMg.positive(),
    receivedPurityPerMille: IntegerPerMille.min(1),
    idempotencyKey: z.string().min(1).max(120),
});

export const GoldHandoffRejectionSchema = z.object({
    reason: z.string().trim().min(1).max(300),
});

export const DisputeSchema = z.object({
    id: z.string(),
    eventId: z.string(),
    karigarId: z.string(),
    reason: z.string(),
    status: z.enum(['unresolved', 'escalated', 'pending_ack', 'resolved'])
});

// RULE 8: Explicit consent tracking
export const ConsentSchema = z.object({
    id: z.string(),
    userId: z.string(),
    purpose: z.string(),
    grantedAt: z.string()
});

export const NudgeSchema = z.object({
    id: z.string(),
    userId: z.string(),
    message: z.string(),
    isRead: z.boolean()
});