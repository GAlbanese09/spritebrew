// spritebrew/src/lib/ledger.ts
//
// Release 2's D1 ledger library, Pages copy (n1-release-2-spec.md revision 9,
// 6.2: the same batches as the consumer's). Built in S1; in S1 only the dev
// harness route (src/app/api/admin/ledger-harness) imports it; S4 wires it
// into the money routes.
//
// Consumer copy: spritebrew-rd-consumer/src/ledger.ts. Everything below this
// header is identical in both repos; S1's tests compare the two files.
// BEGIN SHARED
//
// The SQL below is the spec's, statement by statement, as written (A9);
// S1's harness checks every constant against the spec's text. The spec
// writes named parameters (:name); D1 binds only ordered ones (?NNN), so
// toPositional() maps each name to a number, skipping string literals and
// comments, and every call binds every name it uses.
//
// Conventions (4.0): every batch is one db.batch() (one transaction); every
// execution binds a fresh :id; the outcome comes from the batch's own last
// statement; a thrown UNIQUE on ledger.idem_key or jobs.job_id goes to the
// identity read; any other error, a timeout or a lost response included, is
// uncertain and the identity read decides; a failed identity read is an
// error. A UNIQUE on any other column is an error outright (T0: a reused :id
// is refused, never read back as ours).
//
// Dev faults (10.3), read from the dev_fault control row only when appEnv is
// 'dev': batch_throw_before:<scope> fails before the batch is sent, and
// batch_response_lost:<scope> sends it and then throws. Scopes: a movement's
// :reason (4.1), 'opening', 'generation', 'claim', 'submitted', 'task',
// 'fallback', 'release', 'stage', 'success', 'generation_failed_refund',
// 'tombstone', 'delivered_finish', 'hold', 'stripe_refusal', 'stripe_pending',
// 'resolution', 'unpause', 'kill_switch'. A fault with no scope never fires.

// ── The spec's statements ──

/** 4.1 Movement, spec line 701. */
const MOVEMENT_INSERT = `INSERT INTO ledger (id, user_id, type, amount, reason, source, job_id, style, mode, size,
                    balance_after, idem_key, created_at_ms, meta_json)
SELECT :id, :uid, :type, :amount, :reason, :source, :job, :style, :mode, :size,
       b.balance + :delta, :idem, :now, :meta
  FROM balances AS b
 WHERE b.user_id = :uid
   AND (:floor IS NULL OR b.balance + :delta >= :floor)
   AND EXISTS (SELECT 1 FROM control WHERE key = 'money_pause' AND value = '0')
   AND NOT EXISTS (SELECT 1 FROM legacy_idem WHERE key IN (:legacy1, :legacy2) AND keep_until_ms > :now)
   AND NOT EXISTS (SELECT 1 FROM stripe_pending WHERE event_id = :event AND disposition = 'none');`;

/** 4.1 Movement, spec line 711. */
const MOVEMENT_BALANCE = `UPDATE balances SET balance = balance + :delta, updated_at_ms = :now
 WHERE user_id = :uid AND EXISTS (SELECT 1 FROM ledger WHERE id = :id);`;

/** 4.1 Movement, spec line 713. */
const MOVEMENT_READ = `SELECT (SELECT balance FROM balances WHERE user_id = :uid)                                  AS balance,
       (SELECT id FROM ledger WHERE id = :id)                                                 AS applied_now,
       (SELECT id FROM ledger WHERE idem_key = :idem)                                         AS applied_any,
       (SELECT user_id || '|' || type || '|' || amount || '|' || COALESCE(job_id, '')
          FROM ledger WHERE idem_key = :idem)                                                 AS applied_identity,
       (SELECT value FROM control WHERE key = 'money_pause')                                  AS pause_value,
       (SELECT 1 FROM legacy_idem WHERE key IN (:legacy1, :legacy2) AND keep_until_ms > :now) AS legacy,
       (SELECT 1 FROM stripe_pending WHERE event_id = :event AND disposition = 'none')        AS decided_none;`;

/** 4.2 Opening at runtime, spec line 739. */
const OPENING_INSERT = `INSERT INTO ledger (id, user_id, type, amount, reason, source, balance_after, idem_key, created_at_ms, meta_json)
SELECT :id, :uid, 'opening', :amount, :reason, :source, :amount, 'open:' || :uid, :now, :meta
 WHERE NOT EXISTS (SELECT 1 FROM balances WHERE user_id = :uid)
   AND EXISTS (SELECT 1 FROM control WHERE key = 'money_pause' AND value = '0');`;

/** 4.2 Opening at runtime, spec line 743. */
const OPENING_BALANCE = `INSERT INTO balances (user_id, balance, created_at_ms, updated_at_ms, opened_via, kv_last_updated)
SELECT :uid, :amount, :now, :now, :via, :kv_last
 WHERE EXISTS (SELECT 1 FROM ledger WHERE id = :id);`;

/** 4.2 Opening at runtime, spec line 746. */
const OPENING_READ = `SELECT (SELECT balance FROM balances WHERE user_id = :uid)  AS balance,
       (SELECT id FROM ledger WHERE id = :id)                AS opened_now,
       (SELECT value FROM control WHERE key = 'money_pause') AS pause_value;`;

/** 4.3 Generation debit with its job intent, spec line 762. */
const DEBIT_INSERT = `INSERT INTO ledger (id, user_id, type, amount, reason, source, job_id, style, mode, size,
                    balance_after, idem_key, created_at_ms, meta_json)
SELECT :id, :uid, 'debit', :cost, 'generation', 'generation', :job, :style, :mode, :size,
       b.balance - :cost, 'debit:' || :job, :now, :meta
  FROM balances AS b
 WHERE b.user_id = :uid AND b.balance - :cost >= 0
   AND EXISTS (SELECT 1 FROM control WHERE key = 'money_pause' AND value = '0');`;

/** 4.3 Generation debit with its job intent, spec line 769. */
const DEBIT_BALANCE = `UPDATE balances SET balance = balance - :cost, updated_at_ms = :now
 WHERE user_id = :uid AND EXISTS (SELECT 1 FROM ledger WHERE id = :id);`;

/** 4.3 Generation debit with its job intent, spec line 771. */
const DEBIT_JOB = `INSERT INTO jobs (job_id, user_id, mode, token_cost, client_key, request_hash, provenance, state, created_at_ms)
SELECT :job, :uid, :mode, :cost, :ckey, :hash, 'd1', 'debited', :now
 WHERE EXISTS (SELECT 1 FROM ledger WHERE id = :id);`;

/** 4.3 Generation debit with its job intent, spec line 774. */
const DEBIT_READ = `SELECT (SELECT balance FROM balances WHERE user_id = :uid)      AS balance,
       (SELECT id FROM ledger WHERE id = :id)                    AS applied_now,
       (SELECT id FROM ledger WHERE idem_key = 'debit:' || :job) AS applied_any,
       (SELECT value FROM control WHERE key = 'money_pause')     AS pause_value;`;

/** 4.3 Generation debit with its job intent, spec line 783. */
const IDENTITY_READ = `SELECT j.user_id, j.request_hash, j.provenance, j.state, j.outcome,
       (SELECT id FROM ledger WHERE idem_key = 'debit:' || j.job_id) AS debit_id
  FROM jobs AS j WHERE j.job_id = :job;`;

/** 4.4 Enqueued, spec line 805. */
const ENQUEUED = `UPDATE jobs SET state = 'enqueued', enqueued_at_ms = :now WHERE job_id = :job AND state = 'debited';`;

/** 4.6 Claims, spec line 829. */
const C_SUBMIT = `UPDATE jobs AS j
   SET claim_id = :claim, claim_attempt = :attempt, claimed_at_ms = :now, lease_at_ms = :now,
       released_at_ms = NULL, state = 'claimed'
 WHERE j.job_id = :job AND j.finished_at_ms IS NULL AND j.hold_reason IS NULL
   AND j.submitted_at_ms IS NULL AND j.task_id IS NULL AND j.refund_due_code IS NULL AND j.artifact = 'none'
   AND (j.claim_id IS NULL OR j.released_at_ms IS NOT NULL OR j.lease_at_ms < :now - 300000)
   AND EXISTS (SELECT 1 FROM control WHERE key = 'money_pause' AND value = '0');`;

/** 4.6 Claims, spec line 839. */
const C_RESUME = `UPDATE jobs AS j
   SET claim_id = :claim, claim_attempt = :attempt, claimed_at_ms = :now, lease_at_ms = :now,
       released_at_ms = NULL, state = 'claimed'
 WHERE j.job_id = :job AND j.finished_at_ms IS NULL AND j.hold_reason IS NULL
   AND j.task_id IS NOT NULL AND j.refund_due_code IS NULL AND j.artifact = 'none'
   AND (j.claim_id IS NULL OR j.released_at_ms IS NOT NULL OR j.lease_at_ms < :now - 300000)
   AND EXISTS (SELECT 1 FROM control WHERE key = 'migration_open' AND value = '0');`;

/** 4.6 Claims, spec line 849. */
const C_FINALIZE = `UPDATE jobs AS j
   SET claim_id = :claim, claim_attempt = :attempt, claimed_at_ms = :now, lease_at_ms = :now,
       released_at_ms = NULL, state = 'claimed'
 WHERE j.job_id = :job AND j.finished_at_ms IS NULL AND j.hold_reason IS NULL AND j.artifact = 'staged'
   AND (j.claim_id IS NULL OR j.released_at_ms IS NOT NULL
        OR (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL
            AND j.submitted_at_ms < :now - 900000)
        OR (NOT (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL)
            AND j.lease_at_ms < :now - 300000))
   AND EXISTS (SELECT 1 FROM control WHERE key = 'migration_open' AND value = '0');`;

/** 4.6 Claims, spec line 861. */
const CLAIM_READ = `SELECT j.claim_id, j.state, j.finished_at_ms, j.hold_reason, j.artifact, j.refund_due_code, j.task_id,
       j.submitted_at_ms, (SELECT value FROM control WHERE key = 'money_pause') AS pause_value,
       (SELECT value FROM control WHERE key = 'migration_open') AS phase_value
  FROM jobs AS j WHERE j.job_id = :job;`;

/** 4.7 Owner updates, spec line 883. */
const OWNER_READ = `SELECT j.claim_id, j.released_at_ms, j.finished_at_ms, j.submitted_at_ms, j.task_id, j.phase,
       j.artifact, j.lease_at_ms
  FROM jobs AS j WHERE j.job_id = :job;`;

/** 4.7 Owner updates, spec line 898. */
const U_SUBMITTED = `UPDATE jobs AS j SET submitted_at_ms = :now, lease_at_ms = :now
 WHERE j.job_id = :job AND j.claim_id = :claim AND j.released_at_ms IS NULL AND j.finished_at_ms IS NULL
   AND j.submitted_at_ms IS NULL AND j.task_id IS NULL;`;

/** 4.7 Owner updates, spec line 903. */
const U_TASK = `UPDATE jobs AS j SET task_id = :task, lease_at_ms = :now
 WHERE j.job_id = :job AND j.claim_id = :claim AND j.released_at_ms IS NULL AND j.finished_at_ms IS NULL
   AND j.submitted_at_ms IS NOT NULL AND j.task_id IS NULL;`;

/** 4.7 Owner updates, spec line 908. */
const U_FALLBACK = `UPDATE jobs AS j SET phase = 'fallback', task_id = NULL, submitted_at_ms = :now, lease_at_ms = :now
 WHERE j.job_id = :job AND j.claim_id = :claim AND j.released_at_ms IS NULL AND j.finished_at_ms IS NULL
   AND j.phase = 'primary' AND j.mode = 'animate';`;

/** 4.7 Owner updates, spec line 913. */
const U_RELEASE_CREATE = `UPDATE jobs AS j SET released_at_ms = :now, submitted_at_ms = NULL, lease_at_ms = :now
 WHERE j.job_id = :job AND j.claim_id = :claim AND j.released_at_ms IS NULL AND j.finished_at_ms IS NULL
   AND j.mode = 'create' AND j.task_id IS NULL;`;

/** 4.7 Owner updates, spec line 918. */
const U_RELEASE_ANIMATE = `UPDATE jobs AS j SET released_at_ms = :now, lease_at_ms = :now
 WHERE j.job_id = :job AND j.claim_id = :claim AND j.released_at_ms IS NULL AND j.finished_at_ms IS NULL
   AND j.task_id IS NOT NULL;`;

/** 4.7 Owner updates, spec line 923. */
const U_STAGE = `UPDATE jobs AS j SET artifact = 'staged', artifact_meta_json = :meta, lease_at_ms = :now
 WHERE j.job_id = :job AND j.claim_id = :claim AND j.released_at_ms IS NULL AND j.finished_at_ms IS NULL
   AND j.artifact IN ('none', 'staged');`;

/** 4.7 Owner updates, spec line 928. */
const U_SUCCESS = `UPDATE jobs AS j SET state = 'finished', outcome = :outcome, finished_at_ms = :now
 WHERE j.job_id = :job AND j.claim_id = :claim AND j.released_at_ms IS NULL AND j.finished_at_ms IS NULL
   AND EXISTS (SELECT 1 FROM control WHERE key = 'money_pause' AND value = '0');`;

/** 4.7 Owner updates, spec line 931. */
const SUCCESS_READ = `SELECT j.state, j.outcome, j.claim_id, j.released_at_ms, j.artifact,
       (SELECT value FROM control WHERE key = 'money_pause') AS pause_value
  FROM jobs AS j WHERE j.job_id = :job;`;

/** 4.8 Refund and finish, one batch, spec line 954. */
const R1_REFUND = `INSERT INTO ledger (id, user_id, type, amount, reason, source, job_id, mode,
                    balance_after, idem_key, created_at_ms, meta_json)
SELECT :id, j.user_id, 'credit',
       COALESCE(d.amount, CASE WHEN j.provenance = 'kv' THEN j.token_cost END),
       'generation_failed_refund', 'generation_failed_refund', j.job_id, j.mode,
       b.balance + COALESCE(d.amount, CASE WHEN j.provenance = 'kv' THEN j.token_cost END),
       'refund:' || j.job_id, :now, :meta
  FROM jobs AS j
  JOIN balances AS b ON b.user_id = j.user_id
  LEFT JOIN ledger AS d ON d.idem_key = 'debit:' || j.job_id AND d.type = 'debit'
                       AND d.user_id = j.user_id AND d.job_id = j.job_id
 WHERE j.job_id = :job AND j.finished_at_ms IS NULL AND j.hold_reason IS NULL
   AND (   (:fence = 'owner' AND j.claim_id = :claim AND j.released_at_ms IS NULL)
        OR (:fence = 'canceller' AND j.artifact <> 'staged'
            AND (j.claim_id IS NULL OR j.released_at_ms IS NOT NULL
                 OR (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL
                     AND j.submitted_at_ms < :now - 900000)
                 OR (NOT (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL)
                     AND j.lease_at_ms < :now - 300000))
            AND COALESCE(j.lease_at_ms, j.created_at_ms) < :now - 1200000)
        OR (:fence IN ('pages', 'recovery') AND j.claim_id IS NULL))
   AND COALESCE(d.amount, CASE WHEN j.provenance = 'kv' THEN j.token_cost END) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM legacy_idem
                    WHERE key = 'token_idempotency:refund:' || j.job_id AND keep_until_ms > :now)
   AND (CASE WHEN :fence = 'pages'
             THEN EXISTS (SELECT 1 FROM control WHERE key = 'migration_open' AND value = '0')
             ELSE EXISTS (SELECT 1 FROM control WHERE key = 'money_pause' AND value = '0') END);`;

/** 4.8 Refund and finish, one batch, spec line 982. */
const R2_BALANCE = `UPDATE balances SET balance = balance + (SELECT amount FROM ledger WHERE id = :id), updated_at_ms = :now
 WHERE user_id = (SELECT user_id FROM ledger WHERE id = :id);`;

/** 4.8 Refund and finish, one batch, spec line 985. */
const R3_FINISH = `UPDATE jobs SET state = 'finished', outcome = 'refunded', error_code = :code, error_message = :msg,
                refunded_amount = (SELECT amount FROM ledger WHERE id = :id), finished_at_ms = :now
 WHERE job_id = :job AND EXISTS (SELECT 1 FROM ledger WHERE id = :id);`;

/** 4.8 Refund and finish, one batch, spec line 989. */
const R4_LEGACY = `UPDATE jobs AS j SET state = 'finished', outcome = 'refunded_legacy', error_code = :code, error_message = :msg,
                     finished_at_ms = :now
 WHERE j.job_id = :job AND j.finished_at_ms IS NULL AND j.hold_reason IS NULL
   AND (   (:fence = 'owner' AND j.claim_id = :claim AND j.released_at_ms IS NULL)
        OR (:fence = 'canceller' AND j.artifact <> 'staged'
            AND (j.claim_id IS NULL OR j.released_at_ms IS NOT NULL
                 OR (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL
                     AND j.submitted_at_ms < :now - 900000)
                 OR (NOT (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL)
                     AND j.lease_at_ms < :now - 300000))
            AND COALESCE(j.lease_at_ms, j.created_at_ms) < :now - 1200000)
        OR (:fence IN ('pages', 'recovery') AND j.claim_id IS NULL))
   AND EXISTS (SELECT 1 FROM legacy_idem
                WHERE key = 'token_idempotency:refund:' || j.job_id AND keep_until_ms > :now)
   AND (CASE WHEN :fence = 'pages'
             THEN EXISTS (SELECT 1 FROM control WHERE key = 'migration_open' AND value = '0')
             ELSE EXISTS (SELECT 1 FROM control WHERE key = 'money_pause' AND value = '0') END);`;

/** 4.8 Refund and finish, one batch, spec line 1007. */
const R5_READ = `SELECT (SELECT id FROM ledger WHERE id = :id)                         AS refunded_now,
       (SELECT amount FROM ledger WHERE id = :id)                     AS amount,
       j.state, j.outcome, j.provenance, j.claim_id, j.released_at_ms, j.hold_reason, j.artifact,
       j.finished_at_ms,
       (SELECT balance FROM balances WHERE user_id = j.user_id)       AS balance,
       (SELECT id FROM ledger WHERE idem_key = 'debit:' || j.job_id AND type = 'debit'
                                AND user_id = j.user_id AND job_id = j.job_id) AS debit_id,
       (SELECT value FROM control WHERE key = 'money_pause')          AS pause_value,
       (SELECT value FROM control WHERE key = 'migration_open')       AS migration_value
  FROM jobs AS j WHERE j.job_id = :job;`;

/** 4.8 Refund and finish, one batch, spec line 1037. */
const TOMBSTONE_INSERT = `INSERT INTO jobs (job_id, user_id, mode, token_cost, provenance, state, outcome, error_code, created_at_ms, finished_at_ms)
SELECT :job, :uid, :mode, :cost, 'tombstone', 'finished', 'no_record', :code, :now, :now
 WHERE EXISTS (SELECT 1 FROM control WHERE key = 'money_pause' AND value = '0')
ON CONFLICT (job_id) DO NOTHING;`;

/** 4.8 Refund and finish, one batch, spec line 1041. */
const TOMBSTONE_READ = `SELECT (SELECT provenance || '|' || state || '|' || COALESCE(outcome, '') || '|' || created_at_ms
          FROM jobs WHERE job_id = :job)                    AS row_now,
       (SELECT value FROM control WHERE key = 'money_pause') AS pause_value;`;

/** 4.9 Success, and the paused result, spec line 1065. */
const PUBLISH = `UPDATE jobs SET artifact = 'published' WHERE job_id = :job AND artifact = 'staged' AND outcome IN ('succeeded', 'rescued');`;

/** 4.9 Success, and the paused result, spec line 1071. */
const STATUS_WRITTEN = `UPDATE jobs SET status_written_at_ms = :now WHERE job_id = :job AND finished_at_ms IS NOT NULL;`;

/** 4.11 Repair pass, spec line 1096. */
const REPAIR_LIST = `SELECT job_id, user_id, mode, provenance, outcome, error_code, error_message, refunded_amount,
       artifact, artifact_meta_json, json_extract(import_json, '$.repair_record') AS repair_record,
       status_written_at_ms, finished_at_ms
  FROM jobs
 WHERE finished_at_ms IS NOT NULL AND finished_at_ms > :now - 86400000
   AND (status_written_at_ms IS NULL OR artifact = 'staged')
 ORDER BY finished_at_ms LIMIT 200;`;

/** 4.11 Repair pass, spec line 1117. */
const OVERDUE_LIST = `SELECT job_id, user_id, finished_at_ms, created_at_ms FROM jobs
 WHERE (finished_at_ms IS NOT NULL AND finished_at_ms <= :now - 86400000
        AND (status_written_at_ms IS NULL OR artifact = 'staged'))
    OR (finished_at_ms IS NULL AND created_at_ms <= :now - 86400000)
 LIMIT 200;`;

/** 4.12 The sweep, spec line 1129. */
const SWEEP_LIST = `SELECT j.job_id, j.provenance, j.state, j.refund_due_code, j.artifact, j.claim_id
  FROM jobs AS j
 WHERE j.finished_at_ms IS NULL AND j.hold_reason IS NULL
   AND (   (j.artifact = 'staged'                                                                   -- (6)
            AND (j.claim_id IS NULL OR j.released_at_ms IS NOT NULL
                 OR (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL
                     AND j.submitted_at_ms < :now - 900000)
                 OR (NOT (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL)
                     AND j.lease_at_ms < :now - 300000)))
        OR (j.refund_due_code IS NOT NULL)                                                          -- (3)
        OR (j.state = 'debited' AND j.claim_id IS NULL AND j.provenance = 'd1'                    -- (1)
            AND j.created_at_ms < :now - 600000)
        OR (j.state = 'enqueued' AND j.claim_id IS NULL AND j.provenance = 'd1'
            AND j.enqueued_at_ms < :now - 3600000)                                                  -- (5)
        OR (j.claim_id IS NOT NULL AND j.artifact <> 'staged'                                       -- (2)
            AND (j.released_at_ms IS NOT NULL
                 OR (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL
                     AND j.submitted_at_ms < :now - 900000)
                 OR (NOT (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL)
                     AND j.lease_at_ms < :now - 300000))
            AND COALESCE(j.lease_at_ms, j.created_at_ms) < :now - 1200000)
        OR (j.provenance = 'kv' AND j.claim_id IS NULL AND j.state IN ('claimed', 'enqueued')    -- (4)
            AND j.refund_due_code IS NULL
            AND :now > (SELECT CAST(value AS INTEGER) FROM control WHERE key = 'switch_at_ms') + 1800000))
 ORDER BY j.created_at_ms LIMIT 200;`;

/** 4.12 The sweep, spec line 1181. */
const DELIVERED_FINISH = `UPDATE jobs AS j SET state = 'finished', outcome = 'succeeded', artifact = 'staged',
                     artifact_meta_json = :meta, finished_at_ms = :now
 WHERE j.job_id = :job AND j.provenance = 'kv' AND j.finished_at_ms IS NULL AND j.hold_reason IS NULL
   AND j.artifact <> 'staged'
   AND (j.claim_id IS NULL OR j.released_at_ms IS NOT NULL
        OR (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL
            AND j.submitted_at_ms < :now - 900000)
        OR (NOT (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL)
            AND j.lease_at_ms < :now - 300000))
   AND COALESCE(j.lease_at_ms, j.created_at_ms) < :now - 1200000
   AND EXISTS (SELECT 1 FROM control WHERE key = 'money_pause' AND value = '0');`;

/** 4.12 The sweep, spec line 1192. */
const DELIVERED_READ = `SELECT j.state, j.outcome, j.claim_id, j.released_at_ms, j.hold_reason, j.finished_at_ms,
       (SELECT value FROM control WHERE key = 'money_pause') AS pause_value
  FROM jobs AS j WHERE j.job_id = :job;`;

/** 4.12 The sweep, spec line 1197. */
const HOLD_INDEX_ONLY = `UPDATE jobs AS j SET hold_reason = 'index_only', claim_id = NULL, claim_attempt = NULL,
                     claimed_at_ms = NULL, lease_at_ms = NULL, released_at_ms = NULL
 WHERE j.job_id = :job AND j.provenance = 'kv' AND j.finished_at_ms IS NULL AND j.hold_reason IS NULL
   AND j.artifact <> 'staged'
   AND (j.claim_id IS NULL OR j.released_at_ms IS NOT NULL
        OR (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL
            AND j.submitted_at_ms < :now - 900000)
        OR (NOT (j.mode = 'animate' AND j.task_id IS NULL AND j.submitted_at_ms IS NOT NULL)
            AND j.lease_at_ms < :now - 300000))
   AND COALESCE(j.lease_at_ms, j.created_at_ms) < :now - 1200000;`;

/** 4.12 The sweep, spec line 1207. */
const HOLD_READ = `SELECT j.state, j.outcome, j.claim_id, j.released_at_ms, j.hold_reason, j.finished_at_ms,
       (SELECT value FROM control WHERE key = 'money_pause') AS pause_value
  FROM jobs AS j WHERE j.job_id = :job;`;

/** 4.13 The key table, spec line 1240. */
const HELD_RELEASE1 = `INSERT INTO stripe_held (event_id, pause_epoch_ms, r1_keys, event_type, event_created_ms, refused_ms)
SELECT :event, c.updated_at_ms, :r1_keys, :type, :created_ms, :now
  FROM control AS c
 WHERE c.key = 'money_pause' AND c.value <> '0'
ON CONFLICT (event_id, pause_epoch_ms, r1_keys) DO NOTHING;`;

/** 4.13 The key table, spec line 1247. */
const HELD_RELEASE2 = `INSERT INTO stripe_held (event_id, pause_epoch_ms, r1_keys, event_type, event_created_ms, refused_ms)
SELECT :event, c.updated_at_ms,
       CASE WHEN EXISTS (SELECT 1 FROM legacy_idem
                          WHERE key IN ('token_idempotency:' || :event, 'webhook:stripe:' || :event)
                            AND keep_until_ms > :now)
            THEN 'present' ELSE 'absent' END,
       :type, :created_ms, :now
  FROM control AS c
 WHERE c.key = 'money_pause' AND c.value <> '0'
ON CONFLICT (event_id, pause_epoch_ms, r1_keys) DO NOTHING;`;

/** 4.13 The key table, spec line 1269. */
const ADMISSION_READ = `SELECT EXISTS (SELECT 1 FROM stripe_held AS h JOIN switch_marks AS s ON s.name = 'pause_start_ms'
                WHERE h.event_id = :event AND h.pause_epoch_ms = s.value_ms AND h.r1_keys = 'absent')   AS refused_absent,
       EXISTS (SELECT 1 FROM stripe_held AS h JOIN switch_marks AS s ON s.name = 'pause_start_ms'
                WHERE h.event_id = :event AND h.pause_epoch_ms = s.value_ms AND h.r1_keys = 'present')  AS refused_present,
       (SELECT MIN(h.refused_ms) - MIN(h.event_created_ms)
          FROM stripe_held AS h JOIN switch_marks AS s ON s.name = 'pause_start_ms'
         WHERE h.event_id = :event AND h.pause_epoch_ms = s.value_ms)                                    AS refusal_age_ms,
       (SELECT value_ms FROM switch_marks WHERE name = 'pause_start_ms')                               AS pause_start_ms,
       (SELECT CAST(value AS INTEGER) FROM control WHERE key = 'switch_at_ms')                          AS switch_at_ms,
       (SELECT MIN(keep_until_ms) FROM legacy_idem)                                                    AS legacy_kept_until_ms,
       EXISTS (SELECT 1 FROM legacy_idem
                WHERE key IN (:legacy1, :legacy2) AND keep_until_ms > :now)                             AS legacy,
       (SELECT id FROM ledger WHERE idem_key = 'stripe:' || :event)                                   AS applied,
       (SELECT disposition FROM stripe_pending WHERE event_id = :event)                               AS disposition;`;

/** 4.13 The key table, spec line 1303. */
const PENDING_FIRST = `INSERT INTO stripe_pending (event_id, reason, first_seen_ms) VALUES (:event, :reason, :now)
ON CONFLICT (event_id) DO NOTHING;`;

/** 4.13 The key table, spec line 1306. */
const PENDING_DISPOSITION = `UPDATE stripe_pending SET disposition = :disposition, evidence_note = :note, decided_by = :who, decided_at_ms = :now
 WHERE event_id = :event AND reason = 'no_evidence' AND disposition IS NULL
   AND (:disposition IS NOT 'none' OR NOT EXISTS (SELECT 1 FROM ledger WHERE idem_key = 'stripe:' || :event));`;

/** 4.13 The key table, spec line 1310. */
const PENDING_NONE_N14 = `UPDATE stripe_pending SET disposition = 'none', evidence_note = :note, decided_by = :who, decided_at_ms = :now
 WHERE event_id = :event AND reason = 'mapping_missing' AND disposition IS NULL
   AND NOT EXISTS (SELECT 1 FROM ledger WHERE idem_key = 'stripe:' || :event);`;

/** 4.13 The key table, spec line 1313. */
const PENDING_READ = `SELECT disposition, (SELECT COUNT(*) FROM ledger WHERE idem_key = 'stripe:' || :event) AS moved
  FROM stripe_pending WHERE event_id = :event;`;

/** 4.13 The key table, spec line 1322. */
const RESOLVE = `UPDATE stripe_pending SET resolved_at_ms = :now
 WHERE event_id = :event AND resolved_at_ms IS NULL
   AND (disposition IS 'none'
        OR EXISTS (SELECT 1 FROM ledger WHERE idem_key = 'stripe:' || :event)
        OR EXISTS (SELECT 1 FROM legacy_idem
                    WHERE key IN ('token_idempotency:' || :event, 'webhook:stripe:' || :event)
                      AND keep_until_ms > :now));`;

/** 4.13 The key table, spec line 1329. */
const RESOLVE_READ = `SELECT resolved_at_ms, disposition FROM stripe_pending WHERE event_id = :event;`;

/** 4.13 The key table, spec line 1348. */
const UNSETTLED_REFUSALS = `SELECT h.event_id, h.event_type, h.event_created_ms, MIN(h.refused_ms) AS first_refused_ms
  FROM stripe_held AS h
 WHERE h.pause_epoch_ms = :epoch
   AND h.event_type IN ('checkout.session.completed', 'charge.refunded', 'charge.dispute.created')
   AND NOT EXISTS (SELECT 1 FROM ledger WHERE idem_key = 'stripe:' || h.event_id)
   AND NOT EXISTS (SELECT 1 FROM stripe_pending WHERE event_id = h.event_id)
   AND NOT EXISTS (SELECT 1 FROM legacy_idem
                    WHERE key IN ('token_idempotency:' || h.event_id, 'webhook:stripe:' || h.event_id))
 GROUP BY h.event_id, h.event_type, h.event_created_ms;`;

/** 4.15 The guarded unpause, spec line 1413. */
const UNPAUSE = `UPDATE control
   SET value = CASE key WHEN 'money_pause' THEN '0' ELSE CAST(:now AS TEXT) END,
       updated_at_ms = :now, updated_by = 'switch'
 WHERE key IN ('money_pause', 'switch_at_ms')
   AND (SELECT COUNT(*) FROM control
         WHERE (key = 'money_pause' AND value = '1')
            OR (key = 'switch_at_ms' AND value = '99999999999999')) = 2
   AND EXISTS (SELECT 1 FROM control WHERE key = 'migration_open' AND value = '0');`;

/** 4.15 The guarded unpause, spec line 1421. */
const UNPAUSE_READ = `SELECT key, value FROM control ORDER BY key;`;

/** 4.16 The kill switch, spec line 1429. */
const KILL_PAUSE = `UPDATE control SET value = '1', updated_at_ms = :now, updated_by = :who WHERE key = 'money_pause' AND value = '0';`;

/** 4.16 The kill switch, spec line 1430. */
const KILL_REOPEN = `UPDATE control SET value = '0', updated_at_ms = :now, updated_by = :who WHERE key = 'money_pause' AND value = '1'
   AND NOT EXISTS (SELECT 1 FROM switch_drift WHERE disposition IS NULL)
   AND (EXISTS (SELECT 1 FROM control WHERE key = 'switch_at_ms' AND value = '99999999999999')   -- release 1: no backstop
        OR EXISTS (SELECT 1 FROM backstop_runs WHERE purpose = 'close' AND complete = 1)        -- after Close
        OR EXISTS (SELECT 1 FROM backstop_runs
                    WHERE complete = 1
                      AND run_pause_ms = (SELECT updated_at_ms FROM control WHERE key = 'money_pause' AND value = '1')));`;

/** 4.16 The kill switch, spec line 1437. */
const KILL_READ = `SELECT key, value, updated_at_ms FROM control WHERE key = 'money_pause';`;

/** 4.11 Repair pass, spec line 1110 (in the prose). */
const REPAIR_DISCARD = `UPDATE jobs SET artifact = 'discarded' WHERE job_id = :job AND artifact = 'staged' AND outcome IN ('refunded', 'refunded_legacy', 'no_record')`;

/** 4.12 The sweep, spec line 1171 (in the prose). */
const PNG_ONLY_DISCARD = `UPDATE jobs SET artifact = 'discarded' WHERE job_id = :job AND artifact IN ('none', 'staged') AND outcome IN ('refunded', 'refunded_legacy')`;

/** 4.16 The kill switch, spec line 1440 (in the prose). */
const REOPEN_BEFORE_0003 = `UPDATE control SET value = '0', updated_at_ms = :now, updated_by = :who WHERE key = 'money_pause' AND value = '1';`;

/** The phase read before the repair pass (4.11: it runs only in phase '0').
 *  The library's own read, not a spec statement. */
const PHASE_READ = `SELECT value FROM control WHERE key = 'migration_open';`;

/** The dev fault row (10.3); read only on dev. */
const DEV_FAULT_READ = `SELECT value FROM control WHERE key = 'dev_fault';`;

/** Every spec statement the library runs, by name (S1's tests compare each
 *  with the spec's text). */
export const LEDGER_SQL: Readonly<Record<string, string>> = {
  MOVEMENT_INSERT, MOVEMENT_BALANCE, MOVEMENT_READ,
  OPENING_INSERT, OPENING_BALANCE, OPENING_READ,
  DEBIT_INSERT, DEBIT_BALANCE, DEBIT_JOB, DEBIT_READ, IDENTITY_READ,
  ENQUEUED,
  C_SUBMIT, C_RESUME, C_FINALIZE, CLAIM_READ,
  OWNER_READ, U_SUBMITTED, U_TASK, U_FALLBACK, U_RELEASE_CREATE, U_RELEASE_ANIMATE, U_STAGE, U_SUCCESS, SUCCESS_READ,
  R1_REFUND, R2_BALANCE, R3_FINISH, R4_LEGACY, R5_READ,
  TOMBSTONE_INSERT, TOMBSTONE_READ,
  PUBLISH, STATUS_WRITTEN,
  REPAIR_LIST, OVERDUE_LIST, REPAIR_DISCARD,
  SWEEP_LIST, DELIVERED_FINISH, DELIVERED_READ, HOLD_INDEX_ONLY, HOLD_READ, PNG_ONLY_DISCARD,
  HELD_RELEASE1, HELD_RELEASE2, ADMISSION_READ,
  PENDING_FIRST, PENDING_DISPOSITION, PENDING_NONE_N14, PENDING_READ,
  RESOLVE, RESOLVE_READ, UNSETTLED_REFUSALS,
  UNPAUSE, UNPAUSE_READ,
  KILL_PAUSE, KILL_REOPEN, KILL_READ, REOPEN_BEFORE_0003,
};

// ── The D1 surface (a structural subset of D1Database, so both repos and the
//    offline harness can supply it) ──

export interface LedgerStatement {
  bind(...values: unknown[]): LedgerStatement;
}
export interface LedgerResult {
  results?: unknown[];
  meta?: { changes?: number };
}
export interface LedgerDb {
  prepare(sql: string): LedgerStatement;
  batch(statements: LedgerStatement[]): Promise<LedgerResult[]>;
}
export interface LedgerCtx {
  db: LedgerDb;
  /** 'dev' turns on the dev faults (10.3); anything else never reads them. */
  appEnv?: string;
  /** :now, the caller's clock (4.0). */
  now?: () => number;
  /** A fresh :id per execution (4.0). */
  newId?: () => string;
  /** A call that has not answered by then is treated as uncertain (4.0). */
  timeoutMs?: number;
}

type Value = string | number | null;
type Params = Record<string, Value>;
type Row = Record<string, unknown>;

/** A caller's mistake (an amount that is not a positive safe integer, a
 *  credit with a floor): nothing is sent. */
export class LedgerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerInputError';
  }
}

// ── Named to ordered parameters ──

const converted = new Map<string, { sql: string; names: string[] }>();

/** Rewrites each :name as ?N (N by first appearance), outside string literals
 *  and -- comments, and answers the names in order. */
export function toPositional(sql: string): { sql: string; names: string[] } {
  const hit = converted.get(sql);
  if (hit) return hit;
  const names: string[] = [];
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i);
      const end = j === -1 ? sql.length : j;
      out += sql.slice(i, end);
      i = end;
    } else if (ch === ':' && /[a-z_]/.test(sql[i + 1] ?? '')) {
      let j = i + 1;
      while (j < sql.length && /[a-z0-9_]/.test(sql[j])) j++;
      const name = sql.slice(i + 1, j);
      let n = names.indexOf(name);
      if (n === -1) n = names.push(name) - 1;
      out += `?${n + 1}`;
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  const result = { sql: out, names };
  converted.set(sql, result);
  return result;
}

function bound(db: LedgerDb, sql: string, params: Params): LedgerStatement {
  const { sql: text, names } = toPositional(sql);
  const values = names.map((n) => {
    const v = params[n];
    if (v === undefined) throw new LedgerInputError(`parameter :${n} not bound`);
    return v;
  });
  return db.prepare(text).bind(...values);
}

async function withTimeout<T>(ctx: LedgerCtx, work: Promise<T>): Promise<T> {
  if (!ctx.timeoutMs) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('ledger: timed out')), ctx.timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const clock = (ctx: LedgerCtx): number => (ctx.now ? ctx.now() : Date.now());
const freshId = (ctx: LedgerCtx): string => (ctx.newId ? ctx.newId() : crypto.randomUUID());

async function devFaults(ctx: LedgerCtx): Promise<string[]> {
  if (ctx.appEnv !== 'dev') return [];
  try {
    const [r] = await ctx.db.batch([ctx.db.prepare(DEV_FAULT_READ)]);
    const v = (r?.results?.[0] as Row | undefined)?.value;
    return typeof v === 'string' && v ? v.split(',').map((s) => s.trim()) : [];
  } catch {
    return [];
  }
}

interface BatchOut {
  rows: Row[][];
  changes: number[];
}

/** One db.batch: one transaction (4.0), with the dev faults around it. */
async function runBatch(ctx: LedgerCtx, scope: string, stmts: Array<[string, Params]>): Promise<BatchOut> {
  const prepared = stmts.map(([sql, p]) => bound(ctx.db, sql, p));
  const faults = await devFaults(ctx);
  if (faults.includes(`batch_throw_before:${scope}`)) throw new Error(`dev fault: batch_throw_before:${scope}`);
  const res = await withTimeout(ctx, ctx.db.batch(prepared));
  if (faults.includes(`batch_response_lost:${scope}`)) throw new Error(`dev fault: batch_response_lost:${scope}`);
  return {
    rows: res.map((r) => (r.results ?? []) as Row[]),
    changes: res.map((r) => r.meta?.changes ?? 0),
  };
}

/** A read on its own (an identity read, or a batch's read-back after an
 *  error). Reads carry no fault. */
async function runRead(ctx: LedgerCtx, sql: string, params: Params): Promise<Row[]> {
  const [r] = await withTimeout(ctx, ctx.db.batch([bound(ctx.db, sql, params)]));
  return (r?.results ?? []) as Row[];
}

type ErrorKind = 'idem_unique' | 'other_unique' | 'uncertain';

/** 4.0's errors: the two named UNIQUEs go to the identity read; another
 *  UNIQUE is an error; anything else is uncertain. */
export function errorKind(err: unknown): ErrorKind {
  const m = err instanceof Error ? err.message : String(err);
  if (/UNIQUE constraint failed: (ledger\.idem_key|jobs\.job_id)\b/.test(m)) return 'idem_unique';
  if (/UNIQUE constraint failed/.test(m)) return 'other_unique';
  return 'uncertain';
}

/** The fail-closed reading (D5): only '0' is open; NULL and any other value
 *  is paused. */
export const isPausedValue = (v: unknown): boolean => v !== '0';

const num = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null);
const safeInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

// ── 4.1 Movement ──

export type MovementOutcome =
  | 'applied' | 'replayed' | 'error' | 'refused_by_decision' | 'paused' | 'no_balance' | 'declined';

export interface MovementInput {
  uid: string;
  type: 'credit' | 'debit';
  amount: number;
  reason: string;
  source: string | null;
  idem: string;
  job?: string | null;
  style?: string | null;
  mode?: 'create' | 'animate' | null;
  size?: number | null;
  meta?: string | null;
  /** NULL for every release 2 caller (A6). */
  floor?: number | null;
  legacy1?: string | null;
  legacy2?: string | null;
  /** The Stripe event's id for its movement; NULL otherwise. */
  event?: string | null;
}

export interface MovementResult {
  outcome: MovementOutcome;
  id: string;
  balance: number | null;
  alarm?: 'unique_mismatch';
  uncertain?: boolean;
}

/** 4.1's read-back table, in order. After an uncertain error only the rows
 *  that show what is stored decide; nothing found is an error. */
export function classifyMovement(r: Row | undefined, id: string, identity: string, uncertain = false):
  { outcome: MovementOutcome; alarm?: 'unique_mismatch' } {
  if (!r) return { outcome: 'error' };
  if (r.applied_now === id) return { outcome: 'applied' };
  if (r.applied_any != null) {
    return r.applied_identity === identity ? { outcome: 'replayed' } : { outcome: 'error', alarm: 'unique_mismatch' };
  }
  if (num(r.legacy) === 1) return { outcome: 'replayed' };
  if (num(r.decided_none) === 1) return { outcome: 'refused_by_decision' };
  if (uncertain) return { outcome: 'error' };
  if (isPausedValue(r.pause_value)) return { outcome: 'paused' };
  if (r.balance == null) return { outcome: 'no_balance' };
  return { outcome: 'declined' };
}

export async function movement(ctx: LedgerCtx, m: MovementInput): Promise<MovementResult> {
  if (!safeInt(m.amount) || m.amount <= 0) throw new LedgerInputError('amount must be a positive safe integer');
  const floor = m.floor ?? null;
  if (m.type === 'credit' && floor !== null) throw new LedgerInputError('no credit has a floor (A6)');
  const id = freshId(ctx);
  const now = clock(ctx);
  const p: Params = {
    id, uid: m.uid, type: m.type, amount: m.amount, reason: m.reason, source: m.source,
    job: m.job ?? null, style: m.style ?? null, mode: m.mode ?? null, size: m.size ?? null,
    delta: m.type === 'credit' ? m.amount : -m.amount, idem: m.idem, now, meta: m.meta ?? null,
    floor, legacy1: m.legacy1 ?? null, legacy2: m.legacy2 ?? null, event: m.event ?? null,
  };
  const identity = `${m.uid}|${m.type}|${m.amount}|${m.job ?? ''}`;
  let read: Row | undefined;
  let uncertain = false;
  try {
    const out = await runBatch(ctx, m.reason, [[MOVEMENT_INSERT, p], [MOVEMENT_BALANCE, p], [MOVEMENT_READ, p]]);
    read = out.rows[2][0];
  } catch (err) {
    const kind = errorKind(err);
    if (kind === 'other_unique') return { outcome: 'error', id, balance: null };
    uncertain = kind === 'uncertain';
    try {
      read = (await runRead(ctx, MOVEMENT_READ, p))[0];
    } catch {
      return { outcome: 'error', id, balance: null, uncertain };
    }
  }
  const c = classifyMovement(read, id, identity, uncertain);
  return { ...c, id, balance: num(read?.balance), ...(uncertain ? { uncertain } : {}) };
}

// ── 4.2 Opening at runtime ──

export type OpeningOutcome = 'opened' | 'already_open' | 'paused' | 'error';

export interface OpeningInput {
  uid: string;
  amount: number;
  reason: string;
  source: string | null;
  /** The runtime openers; 'snapshot' is 4.17's alone (A1). */
  via: 'signup' | 'early_adopter' | 'disposable' | 'zero_alarm';
  kvLast?: string | null;
  meta?: string | null;
}

export interface OpeningResult {
  outcome: OpeningOutcome;
  id: string;
  balance: number | null;
  alarm?: 'zero_alarm';
  uncertain?: boolean;
}

export function classifyOpening(r: Row | undefined, id: string, uncertain = false): OpeningOutcome {
  if (!r) return 'error';
  if (r.opened_now === id) return 'opened';
  if (r.balance != null) return 'already_open';
  if (uncertain) return 'error';
  if (isPausedValue(r.pause_value)) return 'paused';
  return 'error';
}

export async function openBalance(ctx: LedgerCtx, o: OpeningInput): Promise<OpeningResult> {
  if (!safeInt(o.amount)) throw new LedgerInputError('amount must be a safe integer');
  const id = freshId(ctx);
  const now = clock(ctx);
  const p: Params = {
    id, uid: o.uid, amount: o.amount, reason: o.reason, source: o.source, now,
    meta: o.meta ?? null, via: o.via, kv_last: o.kvLast ?? null,
  };
  let read: Row | undefined;
  let uncertain = false;
  try {
    const out = await runBatch(ctx, 'opening', [[OPENING_INSERT, p], [OPENING_BALANCE, p], [OPENING_READ, p]]);
    read = out.rows[2][0];
  } catch (err) {
    const kind = errorKind(err);
    if (kind === 'other_unique') return { outcome: 'error', id, balance: null };
    uncertain = kind === 'uncertain';
    try {
      read = (await runRead(ctx, OPENING_READ, p))[0];
    } catch {
      return { outcome: 'error', id, balance: null, uncertain };
    }
  }
  const outcome = classifyOpening(read, id, uncertain);
  return {
    outcome, id, balance: num(read?.balance),
    ...(outcome === 'opened' && o.via === 'zero_alarm' ? { alarm: 'zero_alarm' as const } : {}),
    ...(uncertain ? { uncertain } : {}),
  };
}

// ── 4.3 Generation debit, and the identity read ──

export type IdentityClass = 'none' | 'charged' | 'old_request' | 'replay' | 'conflict';

export interface JobIdentity {
  user_id: string;
  request_hash: string | null;
  provenance: 'd1' | 'kv' | 'tombstone';
  state: string;
  outcome: string | null;
  debit_id: string | null;
}

/** 4.3's identity rules (A5): the debit's id against :id, then a d1 row's
 *  user and hash, an imported or tombstone row's user only. */
export function classifyIdentity(row: Row | undefined, uid: string, hash: string, id: string | null): IdentityClass {
  if (!row) return 'none';
  if (id !== null && row.debit_id === id) return 'charged';
  if (row.provenance === 'kv' || row.provenance === 'tombstone') return row.user_id === uid ? 'old_request' : 'conflict';
  if (row.provenance === 'd1' && row.user_id === uid && row.request_hash === hash) return 'replay';
  return 'conflict';
}

/** The identity read, before the debit (5.1's replay step) and after any
 *  doubt about it. */
export async function readGenerationIdentity(ctx: LedgerCtx, job: string): Promise<JobIdentity | null> {
  const rows = await runRead(ctx, IDENTITY_READ, { job });
  return (rows[0] as unknown as JobIdentity | undefined) ?? null;
}

export type DebitOutcome =
  | 'charged' | 'old_request' | 'replay' | 'conflict' | 'paused' | 'no_balance' | 'insufficient'
  | 'not_charged' | 'unconfirmed' | 'error';

export interface DebitInput {
  uid: string;
  job: string;
  cost: number;
  mode: 'create' | 'animate';
  ckey: string;
  hash: string;
  style?: string | null;
  size?: number | null;
  meta?: string | null;
}

export interface DebitResult {
  /** charged: enqueue (q.send, then 4.4). old_request, replay: answer from
   *  the row, never enqueue. conflict: 409. paused, not_charged: 503 "not
   *  charged". unconfirmed: 503 "will be refunded if it happened" (L 004
   *  ruling 3), never enqueue. insufficient: 402. no_balance: open (4.2), then
   *  run once more (a fresh :id). */
  outcome: DebitOutcome;
  id: string;
  balance: number | null;
  row?: JobIdentity | null;
  uncertain?: boolean;
}

export async function generationDebit(ctx: LedgerCtx, d: DebitInput): Promise<DebitResult> {
  if (!safeInt(d.cost) || d.cost < 1 || d.cost > 50) throw new LedgerInputError('cost must be an integer from 1 to 50');
  const id = freshId(ctx);
  const now = clock(ctx);
  const p: Params = {
    id, uid: d.uid, cost: d.cost, job: d.job, style: d.style ?? null, mode: d.mode, size: d.size ?? null,
    now, meta: d.meta ?? null, ckey: d.ckey, hash: d.hash,
  };
  const byIdentity = async (uncertain: boolean): Promise<DebitResult> => {
    let row: JobIdentity | null;
    try {
      row = await readGenerationIdentity(ctx, d.job);
    } catch {
      return { outcome: uncertain ? 'unconfirmed' : 'error', id, balance: null, uncertain };
    }
    const c = classifyIdentity(row as unknown as Row | undefined, d.uid, d.hash, id);
    if (c === 'none') return { outcome: uncertain ? 'not_charged' : 'error', id, balance: null, row, uncertain };
    return { outcome: c, id, balance: null, row, ...(uncertain ? { uncertain } : {}) };
  };
  let read: Row | undefined;
  try {
    const out = await runBatch(ctx, 'generation', [[DEBIT_INSERT, p], [DEBIT_BALANCE, p], [DEBIT_JOB, p], [DEBIT_READ, p]]);
    read = out.rows[3][0];
  } catch (err) {
    const kind = errorKind(err);
    if (kind === 'other_unique') return { outcome: 'error', id, balance: null };
    return byIdentity(kind === 'uncertain');
  }
  if (read?.applied_now === id) return { outcome: 'charged', id, balance: num(read.balance) };
  if (read?.applied_any != null) {
    const r = await byIdentity(false);
    return { ...r, balance: num(read.balance) };
  }
  if (!read) return { outcome: 'error', id, balance: null };
  if (isPausedValue(read.pause_value)) return { outcome: 'paused', id, balance: num(read.balance) };
  if (read.balance == null) return { outcome: 'no_balance', id, balance: null };
  return { outcome: 'insufficient', id, balance: num(read.balance) };
}

// ── 4.4 Enqueued ──

/** Best effort: a failure is logged and answered false. */
export async function markEnqueued(ctx: LedgerCtx, job: string): Promise<boolean> {
  try {
    const out = await runBatch(ctx, 'enqueued', [[ENQUEUED, { job, now: clock(ctx) }]]);
    return out.changes[0] > 0;
  } catch (err) {
    console.error(JSON.stringify({ source: 'ledger', event: 'enqueued_mark_failed', error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' }));
    return false;
  }
}

// ── 4.6 Claims ──

export type ClaimKind = 'submit' | 'resume' | 'finalize';
export type ClaimOutcome = 'won' | 'paused' | 'phase_open' | 'held' | 'owner_live' | 'row_decides' | 'no_row' | 'error';

export interface ClaimResult {
  outcome: ClaimOutcome;
  row: Row | null;
}

/** 4.6's read-back table, in order. */
export function classifyClaim(kind: ClaimKind, r: Row | undefined, claim: string): ClaimOutcome {
  if (!r) return 'no_row';
  if (r.claim_id === claim) return 'won';
  if (kind === 'submit' && isPausedValue(r.pause_value)) return 'paused';
  if (kind !== 'submit' && isPausedValue(r.phase_value)) return 'phase_open';
  if (r.hold_reason != null) return 'held';
  if (kind === 'finalize' && r.artifact === 'staged' && r.finished_at_ms == null) return 'owner_live';
  return 'row_decides';
}

export async function claimJob(ctx: LedgerCtx, kind: ClaimKind, c: { job: string; claim: string; attempt: number }):
  Promise<ClaimResult> {
  const sql = kind === 'submit' ? C_SUBMIT : kind === 'resume' ? C_RESUME : C_FINALIZE;
  const p: Params = { job: c.job, claim: c.claim, attempt: c.attempt, now: clock(ctx) };
  let read: Row | undefined;
  try {
    read = (await runBatch(ctx, 'claim', [[sql, p], [CLAIM_READ, p]])).rows[1][0];
  } catch {
    try {
      read = (await runRead(ctx, CLAIM_READ, p))[0];
    } catch {
      return { outcome: 'error', row: null };
    }
  }
  return { outcome: classifyClaim(kind, read, c.claim), row: read ?? null };
}

// ── 4.7 Owner updates ──

export type OwnerUpdateKind = 'submitted' | 'task' | 'fallback' | 'release_create' | 'release_animate' | 'stage';
export type OwnerUpdateOutcome = 'committed' | 'ownership_lost' | 'retry_message';

const OWNER_SQL: Record<OwnerUpdateKind, string> = {
  submitted: U_SUBMITTED, task: U_TASK, fallback: U_FALLBACK,
  release_create: U_RELEASE_CREATE, release_animate: U_RELEASE_ANIMATE, stage: U_STAGE,
};
const OWNER_SCOPE: Record<OwnerUpdateKind, string> = {
  submitted: 'submitted', task: 'task', fallback: 'fallback',
  release_create: 'release', release_animate: 'release', stage: 'stage',
};

export interface OwnerUpdateInput {
  job: string;
  claim: string;
  task?: string | null;
  meta?: string | null;
}

/** 4.7's lost-response table (R3-17): the transition's own marker, with this
 *  execution's value, and the claim. */
export function classifyOwnerRead(kind: OwnerUpdateKind, r: Row | undefined, u: OwnerUpdateInput, now: number):
  'committed' | 'not_committed' | 'ownership_lost' {
  if (!r || r.claim_id !== u.claim || r.finished_at_ms != null) return 'ownership_lost';
  const marker =
    kind === 'submitted' ? num(r.submitted_at_ms) === now
    : kind === 'task' ? r.task_id === u.task
    : kind === 'fallback' ? r.phase === 'fallback' && num(r.submitted_at_ms) === now
    : kind === 'stage' ? r.artifact === 'staged' && num(r.lease_at_ms) === now
    : num(r.released_at_ms) === now;
  if (marker) return 'committed';
  if (r.released_at_ms == null) return 'not_committed';
  return 'ownership_lost';
}

/** One owner update. changes 0 is ownership lost. An error is resolved by
 *  the owner read before anything billable: committed goes on; not committed
 *  runs once more with a fresh :now and reads again; a second doubt retries
 *  the message (no RD call). */
export async function ownerUpdate(ctx: LedgerCtx, kind: OwnerUpdateKind, u: OwnerUpdateInput): Promise<OwnerUpdateOutcome> {
  const params = (now: number): Params => ({ job: u.job, claim: u.claim, now, task: u.task ?? null, meta: u.meta ?? null });
  const sql = OWNER_SQL[kind];
  let now = clock(ctx);
  try {
    const out = await runBatch(ctx, OWNER_SCOPE[kind], [[sql, params(now)]]);
    return out.changes[0] > 0 ? 'committed' : 'ownership_lost';
  } catch {
    let r: Row | undefined;
    try {
      r = (await runRead(ctx, OWNER_READ, { job: u.job }))[0];
    } catch {
      return 'retry_message';
    }
    const first = classifyOwnerRead(kind, r, u, now);
    if (first !== 'not_committed') return first;
    now = Math.max(clock(ctx), now + 1);
    try {
      await runBatch(ctx, OWNER_SCOPE[kind], [[sql, params(now)]]);
    } catch {
      // the read below decides
    }
    try {
      r = (await runRead(ctx, OWNER_READ, { job: u.job }))[0];
    } catch {
      return 'retry_message';
    }
    const second = classifyOwnerRead(kind, r, u, now);
    return second === 'not_committed' ? 'retry_message' : second;
  }
}

export type SuccessOutcome = 'succeeded' | 'paused' | 'ownership_lost' | 'error';

/** 4.7's success read-back table. */
export function classifySuccess(r: Row | undefined, claim: string, outcome: string): SuccessOutcome {
  if (r && r.state === 'finished' && r.outcome === outcome && r.claim_id === claim) return 'succeeded';
  if (r && r.state !== 'finished' && r.claim_id === claim && r.released_at_ms == null && isPausedValue(r.pause_value)) {
    return 'paused';
  }
  return 'ownership_lost';
}

/** The success update (A4), guarded like every settling transition. */
export async function successUpdate(ctx: LedgerCtx, s: { job: string; claim: string; outcome: 'succeeded' | 'rescued' }):
  Promise<SuccessOutcome> {
  const p: Params = { job: s.job, claim: s.claim, outcome: s.outcome, now: clock(ctx) };
  let r: Row | undefined;
  try {
    r = (await runBatch(ctx, 'success', [[U_SUCCESS, p], [SUCCESS_READ, { job: s.job }]])).rows[1][0];
  } catch {
    try {
      r = (await runRead(ctx, SUCCESS_READ, { job: s.job }))[0];
    } catch {
      return 'error';
    }
  }
  return classifySuccess(r, s.claim, s.outcome);
}

// ── 4.8 Refund and finish ──

export type Fence = 'owner' | 'canceller' | 'recovery' | 'pages';
export type RefundOutcome =
  | 'refunded' | 'already_refunded_legacy' | 'already_finished' | 'held' | 'ownership_lost' | 'staged_result'
  | 'paused' | 'corruption' | 'no_balance' | 'live_owner' | 'no_record' | 'error';

export interface RefundInput {
  job: string;
  fence: Fence;
  /** The owner's claim; required for 'owner', NULL otherwise. */
  claim?: string | null;
  code: string;
  msg?: string | null;
  meta?: string | null;
}

export interface RefundResult {
  outcome: RefundOutcome;
  id: string;
  amount: number | null;
  row: Row | null;
  alarm?: 'debit_missing' | 'no_record';
  uncertain?: boolean;
}

/** r5's table, in order (4.8). */
export function classifyRefund(r: Row | undefined, fence: Fence, claim: string | null): RefundOutcome {
  if (!r) return 'no_record';
  if (r.refunded_now != null) return 'refunded';
  if (r.outcome === 'refunded_legacy') return 'already_refunded_legacy';
  if (r.finished_at_ms != null) return 'already_finished';
  if (r.hold_reason != null) return 'held';
  if (fence === 'owner' && (r.claim_id !== claim || r.released_at_ms != null)) return 'ownership_lost';
  if (r.artifact === 'staged' && fence === 'canceller') return 'staged_result';
  if (fence === 'pages' ? isPausedValue(r.migration_value) : isPausedValue(r.pause_value)) return 'paused';
  if (r.provenance === 'd1' && r.debit_id == null) return 'corruption';
  if (r.balance == null) return 'no_balance';
  return 'live_owner';
}

export async function refundAndFinish(ctx: LedgerCtx, f: RefundInput): Promise<RefundResult> {
  if (f.fence === 'owner' && !f.claim) throw new LedgerInputError("the 'owner' fence needs its claim");
  const id = freshId(ctx);
  const claim = f.fence === 'owner' ? (f.claim as string) : null;
  const p: Params = { id, job: f.job, fence: f.fence, claim, now: clock(ctx), meta: f.meta ?? null, code: f.code, msg: f.msg ?? null };
  let r: Row | undefined;
  let uncertain = false;
  try {
    const out = await runBatch(ctx, 'generation_failed_refund',
      [[R1_REFUND, p], [R2_BALANCE, p], [R3_FINISH, p], [R4_LEGACY, p], [R5_READ, p]]);
    r = out.rows[4][0];
  } catch (err) {
    const kind = errorKind(err);
    if (kind === 'other_unique') return { outcome: 'error', id, amount: null, row: null };
    uncertain = kind === 'uncertain';
    try {
      r = (await runRead(ctx, R5_READ, p))[0];
    } catch {
      return { outcome: 'error', id, amount: null, row: null, uncertain };
    }
  }
  const outcome = classifyRefund(r, f.fence, claim);
  return {
    outcome, id, amount: num(r?.amount), row: r ?? null,
    ...(outcome === 'corruption' ? { alarm: 'debit_missing' as const } : outcome === 'no_record' ? { alarm: 'no_record' as const } : {}),
    ...(uncertain ? { uncertain } : {}),
  };
}

export type TombstoneOutcome = 'tombstoned' | 'row_exists' | 'paused' | 'error';

/** The tombstone's read-back table (4.8). A no_record tombstone found as the
 *  existing row also raises the (deduped) no_record alarm. */
export function classifyTombstone(r: Row | undefined, now: number): { outcome: TombstoneOutcome; alarm?: 'no_record' } {
  if (!r) return { outcome: 'error' };
  if (r.row_now === `tombstone|finished|no_record|${now}`) return { outcome: 'tombstoned', alarm: 'no_record' };
  if (r.row_now != null) {
    return String(r.row_now).startsWith('tombstone|finished|no_record|')
      ? { outcome: 'row_exists', alarm: 'no_record' } : { outcome: 'row_exists' };
  }
  if (isPausedValue(r.pause_value)) return { outcome: 'paused' };
  return { outcome: 'error' };
}

export async function tombstone(ctx: LedgerCtx, t: { job: string; uid: string; mode: 'create' | 'animate'; cost: number; code: string }):
  Promise<{ outcome: TombstoneOutcome; alarm?: 'no_record' }> {
  const now = clock(ctx);
  const p: Params = { job: t.job, uid: t.uid, mode: t.mode, cost: t.cost, code: t.code, now };
  let r: Row | undefined;
  try {
    r = (await runBatch(ctx, 'tombstone', [[TOMBSTONE_INSERT, p], [TOMBSTONE_READ, { job: t.job }]])).rows[1][0];
  } catch {
    try {
      r = (await runRead(ctx, TOMBSTONE_READ, { job: t.job }))[0];
    } catch {
      return { outcome: 'error' };
    }
  }
  return classifyTombstone(r, now);
}

// ── 4.9 Publish and the status marker ──

export async function markPublished(ctx: LedgerCtx, job: string): Promise<boolean> {
  return (await runBatch(ctx, 'publish', [[PUBLISH, { job }]])).changes[0] > 0;
}

export async function markStatusWritten(ctx: LedgerCtx, job: string): Promise<boolean> {
  return (await runBatch(ctx, 'status', [[STATUS_WRITTEN, { job, now: clock(ctx) }]])).changes[0] > 0;
}

// ── 4.11 Repair pass ──

/** The repair list, only while the phase reads '0' (a failed phase read
 *  counts as open). */
export async function repairList(ctx: LedgerCtx): Promise<{ outcome: 'ok' | 'phase_open'; rows: Row[] }> {
  let phase: unknown;
  try {
    phase = (await runRead(ctx, PHASE_READ, {}))[0]?.value;
  } catch {
    phase = null;
  }
  if (isPausedValue(phase)) return { outcome: 'phase_open', rows: [] };
  return { outcome: 'ok', rows: await runRead(ctx, REPAIR_LIST, { now: clock(ctx) }) };
}

export async function overdueList(ctx: LedgerCtx): Promise<Row[]> {
  return runRead(ctx, OVERDUE_LIST, { now: clock(ctx) });
}

/** After the R2 delete of a staged object on a refunded or no_record row. */
export async function discardStaged(ctx: LedgerCtx, job: string): Promise<boolean> {
  return (await runBatch(ctx, 'discard', [[REPAIR_DISCARD, { job }]])).changes[0] > 0;
}

// ── 4.12 The sweep ──

export type SweepCandidate = 6 | 3 | 1 | 5 | 2 | 4;

export async function sweepList(ctx: LedgerCtx): Promise<Row[]> {
  return runRead(ctx, SWEEP_LIST, { now: clock(ctx) });
}

/** The first matching candidate of a row the sweep list returned. */
export function sweepCandidate(r: Row): SweepCandidate {
  if (r.artifact === 'staged') return 6;
  if (r.refund_due_code != null) return 3;
  if (r.state === 'debited' && r.claim_id == null && r.provenance === 'd1') return 1;
  if (r.state === 'enqueued' && r.claim_id == null && r.provenance === 'd1') return 5;
  if (r.claim_id != null) return 2;
  return 4;
}

export type DeliveredOutcome = 'finished_now' | 'paused' | 'fence_lost' | 'error';

export function classifyDelivered(r: Row | undefined, now: number): DeliveredOutcome {
  if (r && r.state === 'finished' && num(r.finished_at_ms) === now) return 'finished_now';
  if (r && isPausedValue(r.pause_value)) return 'paused';
  return 'fence_lost';
}

/** The delivered finish for an imported row (no money, guarded). */
export async function deliveredFinish(ctx: LedgerCtx, d: { job: string; meta: string }): Promise<DeliveredOutcome> {
  const now = clock(ctx);
  let r: Row | undefined;
  try {
    r = (await runBatch(ctx, 'delivered_finish', [[DELIVERED_FINISH, { job: d.job, meta: d.meta, now }], [DELIVERED_READ, { job: d.job }]])).rows[1][0];
  } catch {
    try {
      r = (await runRead(ctx, DELIVERED_READ, { job: d.job }))[0];
    } catch {
      return 'error';
    }
  }
  return classifyDelivered(r, now);
}

/** The index-only hold: not a settling transition, so no pause predicate. */
export async function holdIndexOnly(ctx: LedgerCtx, job: string): Promise<'held' | 'fence_lost' | 'error'> {
  let r: Row | undefined;
  try {
    r = (await runBatch(ctx, 'hold', [[HOLD_INDEX_ONLY, { job, now: clock(ctx) }], [HOLD_READ, { job }]])).rows[1][0];
  } catch {
    try {
      r = (await runRead(ctx, HOLD_READ, { job }))[0];
    } catch {
      return 'error';
    }
  }
  return r?.hold_reason === 'index_only' ? 'held' : 'fence_lost';
}

/** After a verified refund, the R2 delete of the PNG, then this. */
export async function discardPngOnly(ctx: LedgerCtx, job: string): Promise<boolean> {
  return (await runBatch(ctx, 'discard', [[PNG_ONLY_DISCARD, { job }]])).changes[0] > 0;
}

// ── 4.13 Stripe's refusals, admission, pending rows and the one resolution ──

export interface RefusalInput {
  event: string;
  type: string;
  createdMs: number;
}

/** S0's statement (release 1 reads its two keys for r1_keys). */
export async function recordRefusalRelease1(ctx: LedgerCtx, r: RefusalInput & { r1Keys: 'absent' | 'present' | 'unknown' }):
  Promise<boolean> {
  const p: Params = { event: r.event, r1_keys: r.r1Keys, type: r.type, created_ms: r.createdMs, now: clock(ctx) };
  return (await runBatch(ctx, 'stripe_refusal', [[HELD_RELEASE1, p]])).changes[0] > 0;
}

/** Release 2's statement: r1_keys from legacy_idem. */
export async function recordRefusal(ctx: LedgerCtx, r: RefusalInput): Promise<boolean> {
  const p: Params = { event: r.event, type: r.type, created_ms: r.createdMs, now: clock(ctx) };
  return (await runBatch(ctx, 'stripe_refusal', [[HELD_RELEASE2, p]])).changes[0] > 0;
}

export interface AdmissionDecision {
  admitted: boolean;
  by?: 'a' | 'b';
  /** Why not: evidence (applied or live legacy: replayed), veto, no_switch,
   *  lapsed, or not_shown (neither (a) nor (b)). */
  why?: 'evidence' | 'veto' | 'no_switch' | 'lapsed' | 'not_shown';
}

/** 4.13's admission rules, on the admission read. */
export function classifyAdmission(r: Row | undefined, createdMs: number, now: number): AdmissionDecision {
  if (!r) return { admitted: false, why: 'not_shown' };
  if (r.applied != null || num(r.legacy) === 1) return { admitted: false, why: 'evidence' };
  if (r.disposition === 'none' || num(r.refused_present) === 1) return { admitted: false, why: 'veto' };
  const pauseStart = num(r.pause_start_ms);
  if (pauseStart === null) return { admitted: false, why: 'no_switch' };
  const kept = num(r.legacy_kept_until_ms);
  const switchAt = num(r.switch_at_ms);
  const bound = kept !== null ? kept : switchAt !== null ? switchAt + 3888000000 : null;
  if (bound === null || !(now < bound)) return { admitted: false, why: 'lapsed' };
  const age = num(r.refusal_age_ms);
  if (num(r.refused_absent) === 1 && age !== null && age <= 259200000) return { admitted: true, by: 'a' };
  if (createdMs > pauseStart) return { admitted: true, by: 'b' };
  return { admitted: false, why: 'not_shown' };
}

export async function readAdmission(ctx: LedgerCtx, a: { event: string; createdMs: number; legacy1: string; legacy2: string }):
  Promise<{ row: Row | null; decision: AdmissionDecision }> {
  const now = clock(ctx);
  const row = (await runRead(ctx, ADMISSION_READ, { event: a.event, legacy1: a.legacy1, legacy2: a.legacy2, now }))[0];
  return { row: row ?? null, decision: classifyAdmission(row, a.createdMs, now) };
}

export interface PendingRead {
  disposition: string | null;
  moved: number | null;
}

const pendingRead = (r: Row | undefined): PendingRead | null =>
  r ? { disposition: (r.disposition as string | null) ?? null, moved: num(r.moved) } : null;

/** The first unresolved delivery. */
export async function recordPending(ctx: LedgerCtx, p: { event: string; reason: 'no_evidence' | 'mapping_missing' }):
  Promise<PendingRead | null> {
  const out = await runBatch(ctx, 'stripe_pending', [[PENDING_FIRST, { event: p.event, reason: p.reason, now: clock(ctx) }], [PENDING_READ, { event: p.event }]]);
  return pendingRead(out.rows[1][0]);
}

/** George's disposition for a 'no_evidence' event (G). */
export async function recordDisposition(ctx: LedgerCtx, d: { event: string; disposition: 'apply' | 'none'; note: string | null; who: string }):
  Promise<PendingRead | null> {
  const p: Params = { event: d.event, disposition: d.disposition, note: d.note, who: d.who, now: clock(ctx) };
  const out = await runBatch(ctx, 'stripe_pending', [[PENDING_DISPOSITION, p], [PENDING_READ, { event: d.event }]]);
  return pendingRead(out.rows[1][0]);
}

/** N14: George's evidenced 'none' for a 'mapping_missing' charge (G). */
export async function recordNoneN14(ctx: LedgerCtx, d: { event: string; note: string; who: string }): Promise<PendingRead | null> {
  const p: Params = { event: d.event, note: d.note, who: d.who, now: clock(ctx) };
  const out = await runBatch(ctx, 'stripe_pending', [[PENDING_NONE_N14, p], [PENDING_READ, { event: d.event }]]);
  return pendingRead(out.rows[1][0]);
}

/** The one resolution (S2 028 amendment 6): run after applied or replayed, or
 *  for a recorded 'none'; never after paused, error or an uncertain result. */
export async function resolvePending(ctx: LedgerCtx, event: string):
  Promise<{ resolved: boolean; resolvedNow: boolean; disposition: string | null } | null> {
  const now = clock(ctx);
  const out = await runBatch(ctx, 'resolution', [[RESOLVE, { event, now }], [RESOLVE_READ, { event }]]);
  const r = out.rows[1][0];
  if (!r) return null;
  const at = num(r.resolved_at_ms);
  return { resolved: at !== null, resolvedNow: at === now, disposition: (r.disposition as string | null) ?? null };
}

/** The refusals a pause refused that nothing has settled, for :epoch. */
export async function unsettledRefusals(ctx: LedgerCtx, epoch: number): Promise<Row[]> {
  return runRead(ctx, UNSETTLED_REFUSALS, { epoch });
}

// ── 4.15 The guarded unpause ──

export const SWITCH_SENTINEL = '99999999999999';

export type UnpauseOutcome = 'committed' | 'not_committed' | 'unclear';

function controlMap(rows: Row[]): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [String(r.key), String(r.value)]));
}

/** The state the guard produces: both rows changed, or neither. Anything
 *  else (money_pause '0' with the sentinel, a missing row) is unclear: pause
 *  again (4.16), then decideUnpause on its read. */
export function classifyUnpause(rows: Row[]): UnpauseOutcome {
  const c = controlMap(rows);
  const timed = c.switch_at_ms !== undefined && c.switch_at_ms !== SWITCH_SENTINEL && /^\d+$/.test(c.switch_at_ms);
  if (c.money_pause === '0' && timed) return 'committed';
  if (c.money_pause === '1' && c.switch_at_ms === SWITCH_SENTINEL) return 'not_committed';
  return 'unclear';
}

/** 4.15's read-back after an unclear answer, paused again: a time means it
 *  committed (the fix forward only); the sentinel means it did not (the
 *  rollback abort). Never run again. */
export function decideUnpause(rows: Row[]): 'committed' | 'not_committed' | 'unknown' {
  const v = controlMap(rows).switch_at_ms;
  if (v === SWITCH_SENTINEL) return 'not_committed';
  if (v !== undefined && /^\d+$/.test(v)) return 'committed';
  return 'unknown';
}

export async function unpause(ctx: LedgerCtx): Promise<{ outcome: UnpauseOutcome; rows: Row[] }> {
  try {
    const out = await runBatch(ctx, 'unpause', [[UNPAUSE, { now: clock(ctx) }], [UNPAUSE_READ, {}]]);
    return { outcome: classifyUnpause(out.rows[1]), rows: out.rows[1] };
  } catch {
    let rows: Row[] = [];
    try {
      rows = await runRead(ctx, UNPAUSE_READ, {});
    } catch {
      // nothing read: unclear
    }
    return { outcome: 'unclear', rows };
  }
}

// ── 4.16 The kill switch ──

export type KillOutcome = 'paused_now' | 'already_paused' | 'reopened' | 'refused' | 'already_open' | 'absent' | 'error';

export async function killPause(ctx: LedgerCtx, who: string): Promise<{ outcome: KillOutcome; row: Row | null }> {
  const now = clock(ctx);
  let r: Row | undefined;
  try {
    r = (await runBatch(ctx, 'kill_switch', [[KILL_PAUSE, { now, who }], [KILL_READ, {}]])).rows[1][0];
  } catch {
    try {
      r = (await runRead(ctx, KILL_READ, {}))[0];
    } catch {
      return { outcome: 'error', row: null };
    }
  }
  if (!r) return { outcome: 'absent', row: null };
  if (r.value === '1') return { outcome: num(r.updated_at_ms) === now ? 'paused_now' : 'already_paused', row: r };
  return { outcome: 'error', row: r };
}

export async function killReopen(ctx: LedgerCtx, who: string): Promise<{ outcome: KillOutcome; row: Row | null }> {
  const now = clock(ctx);
  let r: Row | undefined;
  try {
    r = (await runBatch(ctx, 'kill_switch', [[KILL_REOPEN, { now, who }], [KILL_READ, {}]])).rows[1][0];
  } catch {
    try {
      r = (await runRead(ctx, KILL_READ, {}))[0];
    } catch {
      return { outcome: 'error', row: null };
    }
  }
  if (!r) return { outcome: 'absent', row: null };
  if (r.value === '0') return { outcome: num(r.updated_at_ms) === now ? 'reopened' : 'already_open', row: r };
  if (r.value === '1') return { outcome: 'refused', row: r };
  return { outcome: 'error', row: r };
}
