/**
 * @fileoverview Auth, Data Isolation, and Consent Logging.
 */
import crypto from 'crypto';
import db from './db';

// SIMULATED INTEGRATION: SMS/WhatsApp OTP
export function requestOtp(phone: string): string {
    const otp = '123456';
    console.log(`[SIMULATED SMS] Sent OTP ${otp} to ${phone}`);
    return otp;
}

export function loginWithPin(phone: string, pin: string) {
    const user = db.prepare('SELECT * FROM users WHERE phone = ? AND pin = ?').get(phone, pin);
    if (!user) throw new Error('Invalid credentials');
    return user;
}

// ACCESS CONTROL: Enforce total data isolation
export function getOrdersForUser(userId: string, role: string) {
    if (role === 'karigar') {
        return db.prepare('SELECT * FROM orders WHERE karigar_id = ?').all(userId) as any[];
    }
    if (role === 'jeweller') {
        return db.prepare('SELECT * FROM orders WHERE jeweller_id = ?').all(userId) as any[];
    }
    throw new Error('Unauthorized role');
}

// RULE 8: Explicit consent tracking
export function logConsent(userId: string, purpose: string) {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO consents (id, user_id, purpose) VALUES (?, ?, ?)')
        .run(id, userId, purpose);
}