/**
 * @fileoverview SQLite database connection and table initialization.
 */
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.JEWELTECH_DB_PATH
    ?? (process.env.NODE_ENV === 'test' ? ':memory:' : path.resolve(__dirname, '..', 'ledger.db'));
const db = new Database(dbPath);

// Turn on foreign keys for safety
db.pragma('foreign_keys = ON');

db.exec(`
 CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT UNIQUE,
        pin TEXT
      );

CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        jeweller_id TEXT NOT NULL,
        karigar_id TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'open',
        due_date TEXT NOT NULL,
        occasion_date TEXT,
        job_type TEXT NOT NULL DEFAULT 'plain',
        FOREIGN KEY (jeweller_id) REFERENCES users (id),
        FOREIGN KEY (karigar_id) REFERENCES users (id)
      );

      CREATE TABLE IF NOT EXISTS agent_logs (
        id TEXT PRIMARY KEY,
        order_id TEXT,
        karigar_id TEXT,
        role TEXT, -- 'user' or 'agent'
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders (id),
        FOREIGN KEY (karigar_id) REFERENCES users (id)
      );

CREATE TABLE IF NOT EXISTS ledger_events (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        type TEXT NOT NULL,
        weight_mg INTEGER NOT NULL DEFAULT 0,
        fine_weight_mg INTEGER,
        purity_per_mille INTEGER,
        debit_account TEXT,
        credit_account TEXT,
        amount INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        notes TEXT,
        idempotency_key TEXT UNIQUE NOT NULL,
        previous_hash TEXT,
        hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders (id)
      );

CREATE TABLE IF NOT EXISTS wastage_agreements (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        jeweller_id TEXT NOT NULL,
        karigar_id TEXT NOT NULL,
        job_type TEXT NOT NULL,
        basis TEXT NOT NULL,
        percent_bps INTEGER NOT NULL,
        labour_rate_paise_per_gram INTEGER NOT NULL,
        sweep_owner TEXT NOT NULL,
        karigar_sweep_share_bps INTEGER NOT NULL,
        cash_rate_policy TEXT NOT NULL,
        version INTEGER NOT NULL,
        effective_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'accepted')),
        accepted_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (order_id, version),
        FOREIGN KEY (order_id) REFERENCES orders (id),
        FOREIGN KEY (jeweller_id) REFERENCES users (id),
        FOREIGN KEY (karigar_id) REFERENCES users (id)
      );

CREATE INDEX IF NOT EXISTS idx_wastage_agreements_order_version
      ON wastage_agreements (order_id, version DESC);
  CREATE TABLE IF NOT EXISTS disputes (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    karigar_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'unresolved',
      FOREIGN KEY (event_id) REFERENCES ledger_events (id),
      FOREIGN KEY (karigar_id) REFERENCES users (id)
    );

    CREATE TABLE IF NOT EXISTS dispute_evidence (
      id TEXT PRIMARY KEY,
      dispute_id TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      content_base64 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (dispute_id) REFERENCES disputes (id),
      FOREIGN KEY (uploaded_by) REFERENCES users (id)
    );

    CREATE TABLE IF NOT EXISTS dispute_actions (
      id TEXT PRIMARY KEY,
      dispute_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (dispute_id) REFERENCES disputes (id),
      FOREIGN KEY (actor_id) REFERENCES users (id)
    );

    CREATE TABLE IF NOT EXISTS dispute_carries (
      id TEXT PRIMARY KEY,
      dispute_id TEXT NOT NULL UNIQUE,
      jeweller_id TEXT NOT NULL,
      karigar_id TEXT NOT NULL,
      source_order_id TEXT NOT NULL,
      target_order_id TEXT,
      unit TEXT NOT NULL CHECK (unit IN ('mg', 'paise')),
      signed_value INTEGER NOT NULL,
      purity_per_mille INTEGER,
      status TEXT NOT NULL CHECK (status IN ('pending_ack', 'pending_job', 'applied')),
      ledger_event_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (dispute_id) REFERENCES disputes (id),
      FOREIGN KEY (jeweller_id) REFERENCES users (id),
      FOREIGN KEY (karigar_id) REFERENCES users (id),
      FOREIGN KEY (source_order_id) REFERENCES orders (id),
      FOREIGN KEY (target_order_id) REFERENCES orders (id),
      FOREIGN KEY (ledger_event_id) REFERENCES ledger_events (id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_dispute_action_order
      ON dispute_actions (dispute_id, created_at, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dispute_one_open_per_event
      ON disputes (event_id)
      WHERE status IN ('unresolved', 'escalated', 'pending_ack');

  CREATE TABLE IF NOT EXISTS consents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS nudges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS karigar_profiles (
      user_id TEXT PRIMARY KEY,
      language TEXT NOT NULL DEFAULT 'en',
      capacity_open_jobs INTEGER NOT NULL CHECK (capacity_open_jobs >= 0),
      specializations_json TEXT NOT NULL DEFAULT '[]',
      completed_jobs INTEGER NOT NULL DEFAULT 0,
      on_time_jobs INTEGER NOT NULL DEFAULT 0 CHECK (on_time_jobs >= 0 AND on_time_jobs <= completed_jobs),
      FOREIGN KEY (user_id) REFERENCES users (id)
    );

  CREATE TABLE IF NOT EXISTS staff_profiles (
      user_id TEXT PRIMARY KEY,
      owner_jeweller_id TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (owner_jeweller_id) REFERENCES users (id)
    );

  CREATE TABLE IF NOT EXISTS cash_dues (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      jeweller_id TEXT NOT NULL,
      karigar_id TEXT NOT NULL,
      amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
      pay_by_date TEXT NOT NULL,
      created_by TEXT NOT NULL,
      owner_jeweller_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders (id),
      FOREIGN KEY (jeweller_id) REFERENCES users (id),
      FOREIGN KEY (karigar_id) REFERENCES users (id),
      FOREIGN KEY (created_by) REFERENCES users (id),
      FOREIGN KEY (owner_jeweller_id) REFERENCES users (id)
    );

  CREATE TABLE IF NOT EXISTS deadline_actions (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      due_id TEXT,
      recipient_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      type TEXT NOT NULL,
      what TEXT NOT NULL,
      why TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'inbox',
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      replied_at TEXT,
      FOREIGN KEY (order_id) REFERENCES orders (id),
      FOREIGN KEY (due_id) REFERENCES cash_dues (id),
      FOREIGN KEY (recipient_id) REFERENCES users (id),
      FOREIGN KEY (created_by) REFERENCES users (id)
    );

  CREATE TABLE IF NOT EXISTS daily_briefs (
      user_id TEXT NOT NULL,
      brief_date TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      items_json TEXT NOT NULL,
      PRIMARY KEY (user_id, brief_date),
      FOREIGN KEY (user_id) REFERENCES users (id)
    );

  CREATE INDEX IF NOT EXISTS idx_deadline_actions_order_created
      ON deadline_actions (order_id, created_at);

  CREATE TABLE IF NOT EXISTS custody_transfers (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      from_karigar_id TEXT NOT NULL,
      to_karigar_id TEXT NOT NULL,
      weight_mg INTEGER NOT NULL CHECK (weight_mg > 0),
      purity_per_mille INTEGER NOT NULL CHECK (purity_per_mille > 0 AND purity_per_mille <= 1000),
      created_by TEXT NOT NULL,
      out_event_id TEXT NOT NULL UNIQUE,
      in_event_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
      from_acknowledged_at TEXT,
      to_acknowledged_at TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'reassignment',
      received_weight_mg INTEGER,
      received_purity_per_mille INTEGER,
      loss_event_id TEXT UNIQUE,
      rejected_at TEXT,
      rejection_reason TEXT,
      FOREIGN KEY (order_id) REFERENCES orders (id),
      FOREIGN KEY (from_karigar_id) REFERENCES users (id),
      FOREIGN KEY (to_karigar_id) REFERENCES users (id),
      FOREIGN KEY (created_by) REFERENCES users (id),
      FOREIGN KEY (out_event_id) REFERENCES ledger_events (id),
      FOREIGN KEY (in_event_id) REFERENCES ledger_events (id),
      FOREIGN KEY (loss_event_id) REFERENCES ledger_events (id)
    );

`);

const custodyTransferColumns = db.prepare('PRAGMA table_info(custody_transfers)').all() as Array<{ name: string }>;
const custodyTransferMigrations: Record<string, string> = {
    stage: "TEXT NOT NULL DEFAULT 'reassignment'",
    received_weight_mg: 'INTEGER',
    received_purity_per_mille: 'INTEGER',
    loss_event_id: 'TEXT',
    rejected_at: 'TEXT',
    rejection_reason: 'TEXT',
};
for (const [column, type] of Object.entries(custodyTransferMigrations)) {
    if (!custodyTransferColumns.some((existing) => existing.name === column)) {
        db.exec(`ALTER TABLE custody_transfers ADD COLUMN ${column} ${type}`);
    }
}
db.exec(`
    UPDATE custody_transfers
    SET received_weight_mg = weight_mg, received_purity_per_mille = purity_per_mille
    WHERE received_weight_mg IS NULL OR received_purity_per_mille IS NULL;
    DROP INDEX IF EXISTS idx_one_pending_custody_transfer_per_order;
    CREATE UNIQUE INDEX idx_one_pending_custody_transfer_per_order
        ON custody_transfers (order_id) WHERE status = 'pending' AND rejected_at IS NULL;
`);

  const orderColumns = db.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>;
  if (!orderColumns.some((column) => column.name === 'occasion_date')) {
      db.exec('ALTER TABLE orders ADD COLUMN occasion_date TEXT');
  }
  if (!orderColumns.some((column) => column.name === 'job_type')) {
      db.exec("ALTER TABLE orders ADD COLUMN job_type TEXT NOT NULL DEFAULT 'plain'");
  }

const ledgerColumns = db.prepare('PRAGMA table_info(ledger_events)').all() as Array<{ name: string }>;
if (!ledgerColumns.some((column) => column.name === 'agreement_id')) {
    db.exec('ALTER TABLE ledger_events ADD COLUMN agreement_id TEXT');
}
if (!ledgerColumns.some((column) => column.name === 'agreement_version')) {
    db.exec('ALTER TABLE ledger_events ADD COLUMN agreement_version INTEGER');
}
if (!ledgerColumns.some((column) => column.name === 'rate_policy')) {
    db.exec('ALTER TABLE ledger_events ADD COLUMN rate_policy TEXT');
}
if (!ledgerColumns.some((column) => column.name === 'rate_snapshot_paise_per_gram')) {
    db.exec('ALTER TABLE ledger_events ADD COLUMN rate_snapshot_paise_per_gram INTEGER');
}
if (!ledgerColumns.some((column) => column.name === 'fine_weight_mg')) {
    db.exec('ALTER TABLE ledger_events ADD COLUMN fine_weight_mg INTEGER');
}
if (!ledgerColumns.some((column) => column.name === 'purity_per_mille')) {
    db.exec('ALTER TABLE ledger_events ADD COLUMN purity_per_mille INTEGER');
}
if (!ledgerColumns.some((column) => column.name === 'debit_account')) {
    db.exec('ALTER TABLE ledger_events ADD COLUMN debit_account TEXT');
}
if (!ledgerColumns.some((column) => column.name === 'credit_account')) {
    db.exec('ALTER TABLE ledger_events ADD COLUMN credit_account TEXT');
}
if (!ledgerColumns.some((column) => column.name === 'acknowledged_at')) {
    db.exec('ALTER TABLE ledger_events ADD COLUMN acknowledged_at TEXT');
}
if (!ledgerColumns.some((column) => column.name === 'stage')) {
    db.exec('ALTER TABLE ledger_events ADD COLUMN stage TEXT');
}

const disputeColumns = db.prepare('PRAGMA table_info(disputes)').all() as Array<{ name: string }>;
const disputeMigrations: Record<string, string> = {
    created_by: 'TEXT',
    created_at: 'TEXT',
    claimed_weight_mg: 'INTEGER',
    claimed_purity_per_mille: 'INTEGER',
    claimed_amount_paise: 'INTEGER',
    resolution_option: 'TEXT',
    resolution_event_id: 'TEXT',
    resolution_selected_by: 'TEXT',
    resolution_at: 'TEXT',
    resolved_at: 'TEXT',
    escalated_at: 'TEXT',
    jeweller_ack_at: 'TEXT',
    karigar_ack_at: 'TEXT',
};
for (const [column, type] of Object.entries(disputeMigrations)) {
    if (!disputeColumns.some((existing) => existing.name === column)) {
        db.exec(`ALTER TABLE disputes ADD COLUMN ${column} ${type}`);
    }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_dispute_escalations ON disputes (status, created_at)');

export default db;