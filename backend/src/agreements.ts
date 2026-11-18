import db from './db';
import { CashRatePolicy, JobType, SweepOwner } from './agreementConfig';
import { AgreementWastageBasis } from './calc';
import { now } from './clock';

export interface WastageAgreement {
    id: string;
    orderId: string;
    jewellerId: string;
    karigarId: string;
    jobType: JobType;
    basis: AgreementWastageBasis;
    percentBps: number;
    labourRatePaisePerGram: number;
    sweepOwner: SweepOwner;
    karigarSweepShareBps: number;
    cashRatePolicy: CashRatePolicy;
    version: number;
    effectiveAt: string;
    status: 'draft' | 'accepted';
    acceptedAt: string | null;
    createdAt: string;
}

export function getAgreementVersions(orderId: string): WastageAgreement[] {
    const rows = db.prepare(`
        SELECT id, order_id AS orderId, jeweller_id AS jewellerId, karigar_id AS karigarId,
            job_type AS jobType, basis, percent_bps AS percentBps,
            labour_rate_paise_per_gram AS labourRatePaisePerGram,
            sweep_owner AS sweepOwner, karigar_sweep_share_bps AS karigarSweepShareBps,
            cash_rate_policy AS cashRatePolicy, version, effective_at AS effectiveAt,
            status, accepted_at AS acceptedAt, created_at AS createdAt
        FROM wastage_agreements WHERE order_id = ? ORDER BY version
    `).all(orderId) as WastageAgreement[];
    return rows;
}

export function getActiveAgreement(orderId: string): WastageAgreement | null {
    return db.prepare(`
        SELECT id, order_id AS orderId, jeweller_id AS jewellerId, karigar_id AS karigarId,
            job_type AS jobType, basis, percent_bps AS percentBps,
            labour_rate_paise_per_gram AS labourRatePaisePerGram,
            sweep_owner AS sweepOwner, karigar_sweep_share_bps AS karigarSweepShareBps,
            cash_rate_policy AS cashRatePolicy, version, effective_at AS effectiveAt,
            status, accepted_at AS acceptedAt, created_at AS createdAt
        FROM wastage_agreements
        WHERE order_id = ? AND status = 'accepted' AND effective_at <= ?
        ORDER BY version DESC LIMIT 1
    `).get(orderId, now().toISOString()) as WastageAgreement | undefined ?? null;
}

export function formatAgreementSummary(
    agreement: Pick<WastageAgreement, 'jobType' | 'basis' | 'percentBps' | 'labourRatePaisePerGram' | 'sweepOwner' | 'karigarSweepShareBps' | 'version'>,
    karigarName: string,
    language: 'en' | 'kn' = 'en'
): string {
    const percent = `${(agreement.percentBps / 100).toFixed(2)}%`;
    const rupees = `Rs ${(agreement.labourRatePaisePerGram / 100).toFixed(2)}/g`;
    const basisEnglish: Record<AgreementWastageBasis, string> = {
        ideal_return_buffer: 'ideal 22K return with a 2% buffer',
        fine_issued: 'fine gold issued',
        gross_issued: 'gross gold issued',
        finished_weight: 'finished weight',
    };
    const sweepEnglish = agreement.sweepOwner === 'split'
        ? `sweepings are split (${(agreement.karigarSweepShareBps / 100).toFixed(0)}% yours)`
        : agreement.sweepOwner === 'karigar' ? 'sweepings are yours' : 'sweepings belong to the jeweller';
    if (language === 'kn') {
        const jobKn: Record<JobType, string> = {
            plain: 'ಸರಳ',
            chain: 'ಸರಪಳಿ',
            handmade: 'ಕೈಕೆಲಸ',
            stone_set: 'ಕಲ್ಲು ಅಳವಡಿಸಿದ',
        };
        const basisKn: Record<AgreementWastageBasis, string> = {
            ideal_return_buffer: '2% ಮಿತಿಯೊಂದಿಗೆ ಆದರ್ಶ 22K ಮರಳಿಕೆ',
            fine_issued: 'ನೀಡಿದ ಶುದ್ಧ ಚಿನ್ನದ ಮೇಲೆ',
            gross_issued: 'ನೀಡಿದ ಒಟ್ಟು ಚಿನ್ನದ ಮೇಲೆ',
            finished_weight: 'ತಯಾರಾದ ತೂಕದ ಮೇಲೆ',
        };
        const sweepKn = agreement.sweepOwner === 'karigar'
            ? 'ಸವೆತದ ಪುಡಿ ನಿಮ್ಮದು'
            : agreement.sweepOwner === 'jeweller'
                ? 'ಸವೆತದ ಪುಡಿ ಅಂಗಡಿಯವರಿಗೆ'
                : `ಸವೆತದ ಪುಡಿಯಲ್ಲಿ ${(agreement.karigarSweepShareBps / 100).toFixed(0)}% ನಿಮ್ಮದು`;
        return `${karigarName}, ${jobKn[agreement.jobType]} ಕೆಲಸಕ್ಕೆ: ${basisKn[agreement.basis]} ${percent} ವ್ಯರ್ಥ, ಕೆಲಸದ ಕೂಲಿ ${rupees}, ${sweepKn}. ಒಪ್ಪಂದ ಆವೃತ್ತಿ ${agreement.version}.`;
    }

    return `${karigarName}, for ${agreement.jobType}: ${percent} wastage on ${basisEnglish[agreement.basis]}, ${rupees} labour, ${sweepEnglish}. Agreement version ${agreement.version}.`;
}

