# Decisions

## Versioned agreement and fair-pay

- Agreement percentages are integer basis points; weights are integer milligrams; gold purity for this feature is integer per-mille; money rates and cash amounts are integer paise.
- Drafting a new agreement creates the next immutable terms version. Acceptance is a separate acknowledgement ledger event. Issues keep the accepted version ID and version number that were in force when issued.
- Job types, wastage bases, and the synthetic fair-pay range are typed configuration. Seed values, benchmark values, and all three comparison rates are demo-only.
- Demo cash rates are labelled SIMULATED and the fair-pay comparison band is labelled SYNTHETIC. These values are not market guidance.
- Wastage basis, sweep ownership, labour rates, and cash-rate date conventions remain UNCONFIRMED trade conventions until field validation.

## Return reconciliation and account postings

- Fine-gold loss is calculated from each issued, finished, and scrap lot using its recorded per-mille purity. The agreement percentage is applied to its named base in integer milligrams; that amount is compared with fine-gold loss. This normalization is an operational convention and remains UNCONFIRMED.
- Gross-weight tolerance is 100 mg and the fine-gold shortfall tolerance is 0 mg in typed configuration; both require field validation.
- Unused allowance defaults to `karigar_keeps` and is marked UNCONFIRMED. Purity readings in the sample workflow are SIMULATED, including touch, XRF, and declared methods.
- Acknowledged ledger events carry minimal debit/credit account tags and fine-milligram amounts. Returns, scrap, process loss, and any settlement recovery remain pending until the other party approves them. A recovery clears the repayable part from process loss; the allowed remainder stays posted as process loss.

## Gold-at-large board and rate shock

- The board totals acknowledged balances in `karigar_wip`, `finished_goods`, `scrap`, and `refiner`. It excludes the jeweller vault and process-loss account; replayed account balances must remain balanced. A refiner movement is a separate append-only `refiner_transfer` from scrap to refiner.
- Simulated 24K rates come from the typed dated series. For other configured purities, the 24K quote is multiplied by the per-mille fineness and divided by 999, with integer half-up paise rounding. The dashboard shock is bounded by the typed configuration, changes only estimates, and never writes a ledger event or rate snapshot.
- Ageing assigns a job's current physical balance to the earliest acknowledged issue date for that order. This is an estimate when an order has multiple issue lots and is UNCONFIRMED.
- Karigar cash owed is estimated from acknowledged finished-return weight times the labour rate from the return's pinned agreement version; acknowledged payment and settlement amounts reduce accrued labour FIFO. Pending amounts are not treated as paid. This labour-accrual convention is UNCONFIRMED until field validation.
- The policy comparison values outstanding fine gold at each order's earliest issue date, most recent acknowledged return date (or today if there is no return), and today's settlement date. All three are SIMULATED estimates; the rate shock does not alter saved settlement events.
- Demo board data contains six j1 workshop jobs with varied age, due dates, WIP, finished goods, scrap, and refiner stages. Cash rates, wages, gold holdings, and dates are synthetic demo data, not market or trade guidance.

## Deadline rescue and dues chase

- Customer occasion date is stored separately from the workshop due date. New orders without an explicit occasion date use the configured default lead time; deadline risk runs only for orders with an occasion date.
- Deadline score weights, time windows, minimum stage progress, capacity thresholds, reliability thresholds, silence hours, and fast-forward limits are typed configuration. Progress is the acknowledged finished, scrap, and refiner gross weight divided by issued gross weight, capped at 100%.
- Karigar capacity and on-time history are profile aggregates; the demo values are synthetic. Candidate ranking requires a matching specialization, open capacity, and enough recorded on-time history. Only aggregate load is used, not other jewellers' order details.
- Deadline nudges use the karigar's configured English or Kannada template and are SIMULATED inbox entries. A silence escalation and rescue plan are drafted after the configured reply window. Customer ETA text is always a draft; no external message is sent.
- Fast-forward changes only the evaluation timestamp for that tick. It does not change the injected Clock or send a real message.
- A rescue transfer posts an outgoing karigar-WIP-to-vault event and an incoming vault-to-karigar-WIP event. The outgoing and incoming karigars acknowledge their respective legs; order assignment changes only after both acknowledgements. These custody approval conventions require field validation.
- Dues are stored as explicit pay-by records. Ageing is whole UTC days past pay-by. A staff-created overdue due generates an owner escalation in the same tick; the demo due and all amounts are SIMULATED.

## Daily brief

- Brief content is generated only from structured deadline/risk assessments, explicit dues, pending ledger acknowledgements, and unresolved review flags. English and Kannada output uses typed templates; no language model performs calculations or ranking.
- The scheduled snapshot is generated once per user per local date at 08:00 Asia/Kolkata. The server polls once per minute; the jeweller demo control can fast-forward the evaluation time by at most 24 hours without changing the injected Clock or creating a message.
- Jeweller briefs include up to five actions. Ranking uses equal configured weights for capped money at stake and urgency; urgency values and the cap are synthetic prioritization settings, not financial advice.
- Karigar briefs are limited to that karigar's due-today jobs, outstanding explicit cash dues with age/overdue days, and pending acknowledgements. User-scoped API queries prevent cross-jeweller and cross-karigar item exposure.
- Action links open the related job; pending-approval links target the specific ledger event. Spoken output uses browser speech synthesis from the same localized structured brief.
- Demo orders, dues, gold values, and pending approvals for the daily brief are synthetic. Cash dues are sourced from explicit due records; they are not inferred by the brief.

## Disputes and correction history

- Disputing an entry adds a separate case and action timeline; it does not change the original financial facts or hash. Outcomes append a correction event and require the other party's acknowledgement before replay applies the adjustment.
- Evidence photos are stored locally with their SHA-256 digest and are re-verified when dispute details are read. File size, count, and accepted image types are typed configuration; evidence and all dispute readings are labelled SIMULATED in the demo.
- Rule-generated outcomes are re-weigh together, apply the pinned agreement as written, split the signed difference under configured milligram/paise caps, carry the signed unit to the next open job, or escalate for owner review. A split uses integer half-up rounding.
- Carry-forward balances stay open for the jeweller/karigar pair when there is no shared open job. They are posted to the next acknowledged issue as a new correction and require the other party's acknowledgement. A negative signed delta reverses the account movement without editing prior entries.
- Escalations remain open without a ledger adjustment until the jeweller selects an outcome. The dashboard and role-specific daily brief show the escalation age; the karigar view is limited to that karigar's own cases.
- Historical loss and allowance are aggregated from acknowledged lots and each job's issue-pinned agreement version. This comparison is descriptive and does not automatically decide a dispute.
- These dispute outcomes, evidence records, and the sample weights are synthetic workflow data; legal and trade treatment of corrections, splits, and carry-forward balances remains UNCONFIRMED pending field validation.

## Custody handoffs and Gold Journey

- Each handoff records sender and receiver gross-weight and per-mille purity readings as paired ledger transfers through the vault-clearing account. A transfer and any attributed stage-loss entry affect replayed balances only after both parties acknowledge; a rejection contests the pending entries and leaves all gold with the sender.
- Fine loss is calculated from sent and received fine-gold milligrams using integer half-up rounding. Gross and fine losses are separately posted from vault clearing to process loss, and the journey records the responsible stage and sender. Stage labels are included in each transfer event's hash.
- Rescue reassignment uses the same custody transfer, acknowledgement, rejection, and replay path as ordinary stage handoffs. Order assignment changes only after both acknowledgements.
- The named three-stage journey and its weight readings are SIMULATED. Purity, stage-loss attribution, and the custody/accounting conventions require field validation.
