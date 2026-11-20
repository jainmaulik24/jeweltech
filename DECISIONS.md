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

## Ideal return, target weight, and durable approvals

- New agreements default to `ideal_return_buffer`: ideal 22K ornament return is issued milligrams multiplied by `idealReturnFactorBp` (default 10860), and minimum acceptable return is ideal milligrams multiplied by `(10000 - bufferBp)` (default 200). Both divisions use integer HALF_UP rounding, first for ideal milligrams and then for minimum acceptable milligrams. The historical 12/11 alloy factor is retained only as a theoretical reference.
- Return classes are `AT_OR_ABOVE_IDEAL`, `WITHIN_BUFFER`, and `SHORT`. Within the buffer, retained gold is ideal return less net gold returned and is valued at configured 916 purity and the SIMULATED settlement rate. A SHORT result creates a flagged settlement draft for the fine-gold value of the gap below the minimum; approval remains pending with both parties.
- Net gold is gross weight less stone and other non-gold weight, all in integer milligrams. Net gold is used for fine-gold return accounting and target-weight comparison.
- New orders default to a 10,000 mg target and 100 mg tolerance, both configurable and individually overridable. A deviation beyond tolerance is stored with the return ledger event and valued at 916 purity using the SIMULATED settlement rate so both parties see the same flag.
- Unused allowance defaults to the karigar (`karigar_keeps`). Cash labour defaults to zero. Fair-pay is retained-gold value plus configured buffing, cutting, and polish amounts per entered piece count; these demo rates default to zero and the rates and counts are not market guidance.
- Voice `load <weight>` is an issue intent. Pending ledger acknowledgements are exposed in a user-scoped inbox and remain visible until acknowledged; the UI refreshes this persistent inbox periodically rather than relying on a transient toast.
- The ideal-return, stone-set, target-overweight, simulated-price, and inbox examples are synthetic demo data. The factor, buffer, default target/tolerance, retained-gold ownership, purity valuation, simulated rate, and per-piece amounts require field validation.

## Karigar float, draw-down, and home

- Floats are scoped to a jeweller/karigar pair and are ledger-backed. A bulk issue without `orderId` creates or reuses that pair's float ledger account; the issue is recorded in integer milligrams at configured 999‰ purity and remains pending until the karigar acknowledges it.
- When a pair has a float, a per-order issue draws from it through a balanced `karigar_float` → `karigar_wip` posting. The pending draw-down is reserved against further issues, while replayed acknowledged entries alone determine the displayed balance. Per-order issues for pairs without a float retain the existing jeweller-vault path.
- Float balances replay every hash-verified event tagged to the float. Float account references are hash-covered; the existing hash format for untagged historical events is unchanged.
- The target float defaults to 100,000 mg and the settlement threshold to 20,000 mg, both typed configuration. An acknowledged draw-down at or below threshold creates a settlement snapshot draft; a party may also request one on demand. The draft records the acknowledged balance and suggested top-up to target, posts no gold or cash, and stays pending for the other party's approval. No draft auto-finalizes a cycle or moves a balance.
- Karigar home data is scoped to the logged-in karigar and includes all pair-scoped float balances, open jobs, explicit unpaid cash dues with days waiting, and pending acknowledgements. Days waiting are whole UTC days since the due record was created; overdue days remain separately shown.
- Rescue plans include “Lend a backup piece for the occasion” as a draft-only option. It does not create a custody transfer, promise a piece, or change job assignment.
- The float amounts, threshold, purity, sample orders, and settlement recommendations are synthetic defaults requiring field validation. Cycle settlement is an informational snapshot only; physical float settlement/top-up still requires separate agreed issue/return entries.

## Karigar paper slips, PIN entry, and assisted approval

- The karigar home is a single paper-slip screen with English, Hindi, and Kannada locale strings. Grams are rendered from integer milligrams with exactly three decimal places; the displayed slip calculation itself uses integer milligrams and rejects deductions greater than issuance.
- One slip is returned per open, non-float job. “Issued” is the first acknowledged issue, later acknowledged issues appear as “Given again,” and the slip uses acknowledged process-loss and return facts. Return gross, stone, and other non-gold milligrams are stored as hash-covered ledger fields; older events fall back to their recorded notes.
- The signed-in karigar can acknowledge one pending event per job at a time; the next pending event appears after refresh. Acknowledgements are idempotent and have one append-only audit row per ledger event. Assisted records identify the karigar represented and the jeweller who assisted; only the order's jeweller may assist on an entry they created.
- Jeweller-assisted slip access is limited to that jeweller/karigar pair's orders, float, and cash dues. The karigar's own view remains scoped to all of his pairs.
- `Mujhe milna hai` shows explicit recorded cash dues and their waiting days, plus retained-gold wages only after every return on the job is acknowledged and the issue-pinned agreement uses `ideal_return_buffer`. Wage grams and waiting days are recomputed from those ledger facts; gold is never inferred from physical WIP or settlement drafts. “Mera maal” remains the separate float balance.
- PIN sign-in is SIMULATED and selects a seeded demo identity through the existing header-based demo auth model; it is not production session authentication. Seeded demo phones are 111 (jeweller), 222 (second jeweller), 333-338 (karigars), and 777 (staff); the demo PIN is 1234.
- The named `Ramesh paper-slip examples` seed scenario uses synthetic 10,000 mg issue, 600 mg wastage, 600 mg stone, and 500 mg additional issue examples. Browser speech synthesis reads the same displayed, localized slip fields and sends no audio externally.
- Slip examples, demo PINs, and acknowledgement workflows are synthetic. Wastage attribution and the separation between gold wages and physical WIP remain UNCONFIRMED and require field validation.

## Float exposure early warning, trust ladder, and owner check

- Exposure is the replayed gross milligrams in the karigar's float plus outstanding `karigar_wip` on that jeweller/karigar pair. The money estimate uses replayed fine milligrams and the dated 24K rate from the SIMULATED rate series, with integer half-up paise rounding.
- Exposure signals are deterministic and use weights and thresholds from `KARIGAR_EXPOSURE_CONFIG`: float coverage against acknowledged issues over the trailing 30-day rate, oldest unreturned-gold age, overdue open orders, share of the jeweller's outstanding gold held by one karigar, acknowledged return readings below configured 916‰ during the configured 90-day window, and recent completed-order loss against that karigar's own earlier average. A clean return for trust progression is completed with no remaining WIP, on time, at or above the configured return purity, without an active dispute, and at or below the configured loss cap.
- Peer loss comparison is disabled by default. Risk levels, plain-language reasons, and recommended actions are advisory only: even “pause new issues” is a human recommendation and never automatically blocks or changes a ledger event.
- Clean-return counts select the configured starting, steady, or trusted float limit. A bulk float issue above that tier's limit is stored as a separate pending approval request; staff issues at or above the configured large-issue threshold also require an owner check. Approval appends the ordinary hash-chained issue as `pending_ack`; the karigar must still acknowledge it. Rejection or a pending request moves no gold. Staff-created large issues require a distinct owner actor; an owner-originated over-limit request requires an explicit recorded owner confirmation because this demo has one owner identity per jeweller.
- Pending owner-approved float credits and draw-downs, and pending-karigar-ack float credits, reserve their requested milligrams against later requests, but do not alter replayed balances until approval posts the issue. Risk warnings do not add reservations.
- The replay slider is a deterministic 90-day synthetic timeline of increasing float, slowing returns, and then silence. The first warning day and both historical value estimates are computed from the configured synthetic balances and SIMULATED dated rates. It is labelled `SYNTHETIC`; it cites no real incident.
- Trust tier limits, signal weights/thresholds, staff approval size, purity baseline, loss caps, recommendation wording, replay values, and rates are demo configuration requiring field validation. The loss-age allocation uses the earliest acknowledged issue date as an estimate, consistent with the existing Gold-at-Large ageing convention.

## Workshop demo low-float alerts and speech entry

- The workshop demo shows a dashboard alert and notification count when untouched float falls below its existing configurable threshold (20 g by default). Selecting the alert opens that karigar's detail, where a clearly labelled top-up form adds the reviewed amount to their float; top-ups remain SIMULATED demo-ledger activity.
- Hindi speech input uses `hi-IN` and normalizes common Hindi number words and Devanagari digits to milligram-safe gram values before preview. Speech recognition availability remains browser-dependent; no audio is sent to an external application by this UI.

## Customer orders, activity ledger, and command entry

- Customer orders are recorded in the shared browser demo ledger; assignment creates a linked karigar order and reserves the requested milligrams from untouched float. Customer status progresses from received to with-karigar, then ready only after linked work is acknowledged, and delivered only by a manual jeweller action.
- The customer balance in the ready WhatsApp deep link is an estimate: expected grams multiplied by the editable 22K demo rate, plus making charges, less advance. The link opens WhatsApp for human review; the app does not send a message automatically.
- Customer notifications, issue/assignment, wastage report, acknowledgement, and delivery steps are appended to Activity. Weight statements aggregate the demo ledger's gross issue, reported wastage, below-threshold bonus, and current in-order balance.
- Default wastage, low-float threshold, and demo rates persist in the shared local demo store. Command amounts must be adjacent to a gram unit or “point”; the user reviews and edits karigar, item, and grams before confirming. Speech recognition is attempted in Hindi; keyboard voice typing remains the fallback.
- These customer values, wa.me links, weights, and activity are demo workflow data and do not replace the backend's audited ledger or external message delivery.

## Step five navigation and simplification

- Jewellers enter the existing ledger-backed workspace with exactly four bottom tabs: Home, Karigars, Orders, and Records. Advanced rate, risk replay, inbox, action-log, and flagged demo-control panels are under More; the route manifest maps prior feature areas to these screens.
- Karigars enter only their own slip dashboard. Assisted slip access stays in jeweller karigar details; staff keeps the separate handoff view.
- Secondary panels use native disclosure sections so less-used controls remain available without crowding the default view. Orders keeps rescue planning and approvals within the three-card visible limit.
- Daily-brief links open the corresponding order detail. Agreement and return panels load only when expanded, avoiding requests for detail data the user has not opened.
- Step five changes presentation and navigation only; ledger APIs and their approval behavior remain unchanged. All example balances, rates, inbox entries, and scenario replays retain SIMULATED or SYNTHETIC labels.
