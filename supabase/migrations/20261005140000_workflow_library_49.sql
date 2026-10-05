-- ORDANIS workflow library: bring the live library to the reviewed 49.
--
-- Source: "Workflow Library Review" (Sept 2026). 51 reviewed, 2 retired -> 49 workflows, 297 steps.
--
-- What this does
--   1. Adds the 41 templates not yet live (8 of the 49 already were).
--   2. RMD: the CPA confirmation step becomes mandatory (was conditional on confirm_with_cpa).
--   3. GRAT Annuity Payment: adds the mandatory counsel/CPA confirmation as step 2 (now 9 steps).
--   4. Deactivates "Property Insurance Renewal" (retired; folded into "Insurance renewal - all lines").
--      Reversible: update public.workflow_templates set active = true where key = 'insurance_renewal';
--
-- Notes
--   * Idempotent: inserts upsert on key; the RMD and GRAT edits are guarded.
--   * The review's step tables predate six of its own changes. Applied here: four annual-review
--     workflows are date-driven (Umbrella, Beneficiary audit, Trust funding, Liquidity event);
--     Marriage and Relocation have their single advance-notice step at day 0.
--   * actor/kind/recipient are mapped from the review's Who column onto the app's fixed vocab.
--     Recipients with no app equivalent (institutions, vendors, appraiser...) are left null and
--     named in the step note ("Reaches out to: ...").
--   * No workflow_instances reference templates yet; nothing in flight is affected.

begin;

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$a_child_reaching_majority$K$, $N$A child reaching majority$N$, $D$The custodial account transfers by law at a fixed age whether anyone has prepared for it or not. This is the one item on the list with a date certain and no notice attached.$D$, $C$Life Events$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "identify_custodial_accounts_reaching",
  "title": "Identify custodial accounts reaching termination",
  "offset_days": -180,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "UTMA and UGMA accounts, with the termination age for the governing state. The age is 18 in some states and 21 in others and the account documents govern."
 },
 {
  "key": "route_the_tax_position_to_the_cpa",
  "title": "Route the tax position to the CPA",
  "offset_days": -150,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Transfer of a large account to a young adult has income tax consequences and may affect financial aid. Routed with the facts well in advance."
 },
 {
  "key": "prompt_the_family_conversation",
  "title": "Prompt the family conversation",
  "offset_days": -120,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "The account becomes the child's property on the date, unconditionally. Families consistently want more preparation than the deadline allows, so the prompt comes early."
 },
 {
  "key": "confirm_the_custodian_transfer_process",
  "title": "Confirm the custodian transfer process",
  "offset_days": -60,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Reaches out to: institutions. Each custodian handles termination differently and several require forms submitted in advance."
 },
 {
  "key": "open_the_receiving_account_and",
  "title": "Open the receiving account and establish access",
  "offset_days": -30,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "The young adult needs their own account and their own credentials before the date, not after."
 },
 {
  "key": "confirm_the_transfer_completed",
  "title": "Confirm the transfer completed",
  "offset_days": 7,
  "actor": "external",
  "kind": "confirm",
  "recipient": null
 },
 {
  "key": "onboard_the_new_adult_to_the_household",
  "title": "Onboard the new adult to the household record",
  "offset_days": 30,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Their own portal access at their own scope. Frequently the first time a next-generation family member touches the platform — which makes it the moment the relationship extends a generation."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$birth_or_adoption$K$, $N$Birth or adoption$N$, $D$What a new child changes administratively. Small, individually easy tasks that nobody owns, several of which have deadlines and one of which — guardianship — families consistently defer for years.$D$, $C$Life Events$C$, true, $T$manual$T$, $J$[
 {
  "key": "obtain_and_file_the_core_documents",
  "title": "Obtain and file the core documents",
  "offset_days": 14,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "Birth certificate, social security number and, where relevant, adoption order. Several later steps cannot proceed without them."
 },
 {
  "key": "add_the_child_to_health_coverage",
  "title": "Add the child to health coverage",
  "offset_days": 21,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "There is a limited enrolment window from birth or placement. The step with a hard deadline attached, and the one most often left late."
 },
 {
  "key": "raise_guardianship_provisions_with",
  "title": "Raise guardianship provisions with counsel",
  "offset_days": 30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "The most important and most deferred item on this list. Ordanis raises it and keeps raising it; naming a guardian is a legal act for the parents and their attorney."
 },
 {
  "key": "flag_estate_documents_and_trusts_for",
  "title": "Flag estate documents and trusts for review",
  "offset_days": 45,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Existing trusts may or may not include after-born children depending on how they were drafted. A question for counsel, not an assumption."
 },
 {
  "key": "present_education_funding_options",
  "title": "Present education funding options",
  "offset_days": 60,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "A 529 or similar vehicle, if the family wants one. Presented as an option with the facts; the investment decision belongs to the adviser."
 },
 {
  "key": "revisit_life_cover_adequacy",
  "title": "Revisit life cover adequacy",
  "offset_days": 75,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "A dependent changes the calculation. Routed to the agent for review."
 },
 {
  "key": "add_the_child_to_the_household_record",
  "title": "Add the child to the household record",
  "offset_days": 90,
  "actor": "ai",
  "kind": "file",
  "recipient": null,
  "note": "Member record created and linked, so future workflows include them automatically."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$death_of_a_principal_first_30_days$K$, $N$Death of a principal — first 30 days$N$, $D$The sequence for the weeks after a death. Most of this work belongs to the attorney, the executor and the family. What Ordanis does is hold the order, protect the record, and stop the routine machinery from doing something inappropriate while everyone is occupied.$D$, $C$Life Events$C$, true, $T$manual$T$, $J$[
 {
  "key": "pause_outbound_automation_on_the",
  "title": "Pause outbound automation on the household",
  "offset_days": 0,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "First action, before anything else. Suspends scheduled reminders, prompts and queued correspondence. A bill-pay reminder arriving three days after a death is the kind of thing a family never forgets."
 },
 {
  "key": "notify_the_professional_team",
  "title": "Notify the professional team",
  "offset_days": 1,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Attorney, CPA and adviser told once, together, so nobody learns second-hand and nobody assumes someone else has acted. Held for approval — the family decides when and by whom."
 },
 {
  "key": "locate_the_will_trusts_and_any_letter",
  "title": "Locate the will, trusts and any letter of instruction",
  "offset_days": 2,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Confirms what is in the Vault and what is held elsewhere — the attorney, a safe, a deposit box. The most common early problem is nobody being certain where the original is."
 },
 {
  "key": "produce_a_date_of_death_asset_snapshot",
  "title": "Produce a date-of-death asset snapshot",
  "offset_days": 5,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Accounts, properties, entities, policies and valuables as recorded on the date of death. A factual extract — not a valuation, and not an estate inventory, both of which are their work."
 },
 {
  "key": "identify_policies_that_may_respond",
  "title": "Identify policies that may respond",
  "offset_days": 7,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "Life policies, accidental death riders, credit life on any loan. Identified and listed; the claim is filed by the beneficiary or executor."
 },
 {
  "key": "review_every_recurring_payment_and",
  "title": "Review every recurring payment and obligation",
  "offset_days": 10,
  "actor": "expert",
  "kind": "check",
  "recipient": null,
  "note": "Which must continue — property insurance, utilities, staff payroll. Which must stop. Which cannot change until the estate is opened. Stopping the wrong one creates a lapse; continuing the wrong one is a misuse of estate funds."
 },
 {
  "key": "review_portal_access_and_entitlements",
  "title": "Review portal access and entitlements",
  "offset_days": 14,
  "actor": "expert",
  "kind": "check",
  "recipient": null,
  "note": "Who retains access, who should be removed, who needs adding as executor or trustee. Handled deliberately rather than left as it was."
 },
 {
  "key": "identify_entities_and_agreements",
  "title": "Identify entities and agreements requiring notice",
  "offset_days": 21,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Operating agreements, partnership agreements and loan covenants often carry notice obligations on a death. Surfaced for counsel."
 },
 {
  "key": "produce_the_estate_administration",
  "title": "Produce the estate administration handover pack",
  "offset_days": 30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Everything the executor and attorney need, assembled once. Ends the emergency phase and begins the estate phase."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$divorce_asset_and_access_separation$K$, $N$Divorce — asset and access separation$N$, $D$Separating a household into two. This is a security operation before it is an administrative one: shared access to a shared record is the immediate issue, and it has to be handled without either party being disadvantaged by how the platform is configured.$D$, $C$Life Events$C$, true, $T$manual$T$, $J$[
 {
  "key": "confirm_counsel_is_engaged_before_any",
  "title": "Confirm counsel is engaged before any change",
  "offset_days": 0,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Nothing proceeds until the family instructs through counsel. Unilateral changes to access during a divorce can prejudice a party and expose the firm. A gate, not a formality."
 },
 {
  "key": "record_the_position_as_it_stands",
  "title": "Record the position as it stands",
  "offset_days": 1,
  "actor": "expert",
  "kind": "file",
  "recipient": null,
  "note": "A dated snapshot of accounts, properties, entities and documents at the point of separation. Preserves a neutral record before anything moves."
 },
 {
  "key": "obtain_written_instruction_on_access",
  "title": "Obtain written instruction on access",
  "offset_days": 3,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Who retains access, in what scope, from when — in writing from counsel or by joint instruction. Ordanis does not decide this and does not act on a verbal request from one party."
 },
 {
  "key": "apply_the_agreed_access_changes",
  "title": "Apply the agreed access changes",
  "offset_days": 7,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Applied exactly as instructed and logged. Every change attributable, which matters if later disputed."
 },
 {
  "key": "list_joint_obligations_and_who_is_paying",
  "title": "List joint obligations and who is paying",
  "offset_days": 10,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Mortgages, insurance, staff, utilities, school fees, with the current payer. Presented so nothing lapses while responsibility is negotiated. Who should pay is a legal question."
 },
 {
  "key": "watch_for_lapses_during_the_proceeding",
  "title": "Watch for lapses during the proceeding",
  "offset_days": 14,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Divorce is when a policy lapses because each party assumed the other was paying. Monitors and raises rather than assuming."
 },
 {
  "key": "flag_beneficiary_and_estate_documents",
  "title": "Flag beneficiary and estate documents for review",
  "offset_days": 30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Designations, wills and powers of attorney typically need revisiting. Timing and permissibility are legal questions during a proceeding."
 },
 {
  "key": "confirm_the_final_separation_of_records",
  "title": "Confirm the final separation of records",
  "offset_days": 120,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Once settlement is final, records separate as directed and each household continues under its own record."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$incapacity_activating_a_power_of_attorney$K$, $N$Incapacity — activating a power of attorney$N$, $D$The sequence when a principal loses capacity and an agent steps in. The work is proving authority to a series of institutions that will each ask separately, and doing it without leaving obligations unattended in the meantime.$D$, $C$Life Events$C$, true, $T$manual$T$, $J$[
 {
  "key": "locate_the_power_of_attorney_and_health",
  "title": "Locate the power of attorney and health directives",
  "offset_days": 0,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Confirms what exists, whether it is durable, whether it is springing, and where the original is held. A springing power may require physician certification before it operates at all."
 },
 {
  "key": "confirm_with_counsel_that_the",
  "title": "Confirm with counsel that the instrument is operative",
  "offset_days": 2,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Whether a power has been validly activated is a legal question. Ordanis does not treat an agent as authorised on the strength of a document alone."
 },
 {
  "key": "list_every_institution_requiring_notice",
  "title": "List every institution requiring notice",
  "offset_days": 5,
  "actor": "expert",
  "kind": "check",
  "recipient": null,
  "note": "Banks, custodians, carriers, registered agents, utilities. Each has its own acceptance process and several will refuse a general power in favour of their own form."
 },
 {
  "key": "track_acceptance_institution_by",
  "title": "Track acceptance institution by institution",
  "offset_days": 10,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Reaches out to: institutions. The real work. Acceptance comes one institution at a time and each rejection needs following up, rather than discovering later that a critical account was never covered."
 },
 {
  "key": "confirm_obligations_continue",
  "title": "Confirm obligations continue uninterrupted",
  "offset_days": 14,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Premiums, taxes and payroll must keep running while authority is established. This is the period when things lapse quietly."
 },
 {
  "key": "grant_the_agent_appropriate_portal",
  "title": "Grant the agent appropriate portal access",
  "offset_days": 21,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Scoped to what the instrument authorises, not full access by default."
 },
 {
  "key": "establish_a_review_cadence_with_the",
  "title": "Establish a review cadence with the agent",
  "offset_days": 45,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "An agent acting under a power carries fiduciary duty. A regular review protects them as much as the principal."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$liquidity_event_or_business_sale$K$, $N$Liquidity event or business sale$N$, $D$The administrative sequence around a sale. The window before closing is when planning is still possible and after closing is when it is not, so most of this workflow sits deliberately before the date.$D$, $C$Life Events$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "convene_the_professional_team_early",
  "title": "Convene the professional team early",
  "offset_days": -90,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Attorney, CPA and adviser aligned before terms are final. Pre-closing planning raised after closing is simply a missed opportunity."
 },
 {
  "key": "document_the_current_ownership_structure",
  "title": "Document the current ownership structure",
  "offset_days": -85,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Entities, ownership percentages, basis where recorded, existing trusts. So the planning conversation starts from something accurate."
 },
 {
  "key": "flag_the_pre_closing_planning_window_to",
  "title": "Flag the pre-closing planning window to counsel",
  "offset_days": -75,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Ordanis notes that a window exists and when it closes. What should be done inside it is entirely the attorney's and CPA's judgement."
 },
 {
  "key": "assemble_diligence_documents",
  "title": "Assemble diligence documents",
  "offset_days": -45,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Entity records, filings, insurance, leases, contracts the buyer will request. Sourced from the Vault so the family isn't reconstructing them under deadline."
 },
 {
  "key": "confirm_accounts_ready_to_receive",
  "title": "Confirm accounts ready to receive proceeds",
  "offset_days": -14,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Receiving account confirmed, wire instructions verified by voice with the institution. Closing wire fraud is a specifically targeted attack; verification is not optional."
 },
 {
  "key": "closing_complete_and_funds_received",
  "title": "Closing complete and funds received",
  "offset_days": 0,
  "actor": "external",
  "kind": "confirm",
  "recipient": null
 },
 {
  "key": "route_the_estimated_tax_question_to_the",
  "title": "Route the estimated tax question to the CPA",
  "offset_days": 5,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "A large gain usually changes the estimated payment schedule immediately."
 },
 {
  "key": "update_the_household_record",
  "title": "Update the household record",
  "offset_days": 14,
  "actor": "ai",
  "kind": "file",
  "recipient": null,
  "note": "Retires the sold entity, records new balances, files closing documents."
 },
 {
  "key": "revisit_coverage_against_the_new",
  "title": "Revisit coverage against the new balance sheet",
  "offset_days": 30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "A liquidity event usually makes existing umbrella limits inadequate overnight. Raised now, not at the next annual review."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$marriage_or_remarriage$K$, $N$Marriage or remarriage$N$, $D$The administrative consequences of a marriage. Most are simple individually and none of them are anybody's specific job, which is why they sit undone for years and surface at exactly the wrong moment.$D$, $C$Life Events$C$, true, $T$manual$T$, $J$[
 {
  "key": "confirm_whether_a_marital_agreement",
  "title": "Confirm whether a marital agreement exists",
  "offset_days": 0,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "If one exists, file it and note which assets and entities it addresses. Everything downstream depends on knowing this first."
 },
 {
  "key": "flag_beneficiary_designations_for_review",
  "title": "Flag beneficiary designations for review",
  "offset_days": 14,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Retirement accounts, life policies, annuities. Frequently still naming a parent or former spouse."
 },
 {
  "key": "route_estate_documents_to_counsel",
  "title": "Route estate documents to counsel",
  "offset_days": 21,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Wills, trusts and powers of attorney generally need revisiting. In many states marriage itself changes how an existing will operates."
 },
 {
  "key": "review_insurance_across_both_households",
  "title": "Review insurance across both households",
  "offset_days": 30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "Auto, property, umbrella, health. Two households merging often means duplicate cover in one place and a gap in another."
 },
 {
  "key": "flag_any_titling_question_to_counsel",
  "title": "Flag any titling question to counsel",
  "offset_days": 45,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "How property is titled after a marriage has legal and tax consequences that vary by state. Flagged, never advised on."
 },
 {
  "key": "update_the_household_record_and_access",
  "title": "Update the household record and access",
  "offset_days": 60,
  "actor": "expert",
  "kind": "file",
  "recipient": null,
  "note": "New member added, contacts updated, portal access at whatever scope the family directs."
 },
 {
  "key": "route_the_filing_status_question_to_the",
  "title": "Route the filing status question to the CPA",
  "offset_days": 90,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Filing status and estimated payments usually change. Routed with the facts, not answered."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$relocation_to_another_state$K$, $N$Relocation to another state$N$, $D$A move changes domicile, insurance, entity filings and tax exposure at once. Families treat it as a moving problem; the administrative consequences run for a year afterwards and a contested domicile claim can arrive years later.$D$, $C$Life Events$C$, true, $T$manual$T$, $J$[
 {
  "key": "route_the_domicile_question_to_the_cpa",
  "title": "Route the domicile question to the CPA",
  "offset_days": 0,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Whether and when domicile changes is a tax determination with a real evidentiary burden. Raised at the start because the evidence has to be built as you go."
 },
 {
  "key": "open_a_domicile_evidence_file",
  "title": "Open a domicile evidence file",
  "offset_days": 0,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Licence, registration, voter record, physical presence, professional relationships. A high-tax state may contest the change; this is the file that answers them."
 },
 {
  "key": "transfer_property_and_auto_coverage",
  "title": "Transfer property and auto coverage",
  "offset_days": 14,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "Coverage is state-specific and a policy written elsewhere may not respond correctly. Includes checking whether the new location needs flood or wind cover the old one did not."
 },
 {
  "key": "review_entity_registrations_and_foreign",
  "title": "Review entity registrations and foreign qualification",
  "offset_days": 30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "An entity operating from a new state may need to register there."
 },
 {
  "key": "route_estate_documents_for_state_law",
  "title": "Route estate documents for state-law review",
  "offset_days": 45,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Wills, trusts and powers of attorney are state-specific and may operate differently or not at all. Reviewed by counsel licensed in the new state."
 },
 {
  "key": "rebuild_the_local_professional_and",
  "title": "Rebuild the local professional and vendor network",
  "offset_days": 60,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Contractors, property manager, agent. Recorded so the network moves with the family rather than being rediscovered."
 },
 {
  "key": "confirm_part_year_filing_requirements",
  "title": "Confirm part-year filing requirements with the CPA",
  "offset_days": 180,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Both states typically require a return in the year of the move."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$insurance_renewal_all_lines$K$, $N$Insurance renewal — all lines$N$, $D$The same for any line: property, auto, umbrella, valuables, flood.$D$, $C$Insurance$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "renewal_notice_received_and_read",
  "title": "Renewal notice received and read",
  "offset_days": -60,
  "actor": "ai",
  "kind": "extract",
  "recipient": null,
  "note": "Carrier, policy number, renewal premium, effective dates, coverage limits."
 },
 {
  "key": "compare_against_the_expiring_policy",
  "title": "Compare against the expiring policy",
  "offset_days": -55,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Flags every change: premium, limits, deductibles, exclusions, scheduled items. A quiet limit reduction is the failure this exists to catch."
 },
 {
  "key": "shop_the_market",
  "title": "Shop the market",
  "offset_days": -50,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "Only where the family wants cover re-bid. Drafts the broker request with the current schedule attached."
 },
 {
  "key": "review_changes_with_the_family_or",
  "title": "Review changes with the family or adviser",
  "offset_days": -45,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "Ordanis presents what changed and what it costs; the coverage decision belongs to the family and their agent."
 },
 {
  "key": "query_the_agent_on_gaps_or_changes",
  "title": "Query the agent on gaps or changes",
  "offset_days": -40,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "Drafted only where the comparison found something needing explanation."
 },
 {
  "key": "authorise_renewal_and_arrange_payment",
  "title": "Authorise renewal and arrange payment",
  "offset_days": -20,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "Confirms the bind instruction and schedules the premium."
 },
 {
  "key": "binder_or_new_policy_received",
  "title": "Binder or new policy received",
  "offset_days": -5,
  "actor": "external",
  "kind": "confirm",
  "recipient": null,
  "note": "Cannot close on an authorisation alone. Coverage is not in force until the binder exists."
 },
 {
  "key": "file_the_policy_and_update_expiry",
  "title": "File the policy and update expiry tracking",
  "offset_days": 2,
  "actor": "ai",
  "kind": "file",
  "recipient": null,
  "note": "Supersedes the expiring policy and sets the next expiry so the following renewal raises itself."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$property_insurance_claim_management$K$, $N$Property insurance claim management$N$, $D$Claims are lost on documentation and deadlines, not on merit.$D$, $C$Insurance$C$, true, $T$manual$T$, $J$[
 {
  "key": "document_the_loss_immediately",
  "title": "Document the loss immediately",
  "offset_days": 0,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Photographs, inventory and dated notes before anything is cleaned up or repaired. This is the evidence and it cannot be recreated."
 },
 {
  "key": "notify_the_carrier_within_the_policy",
  "title": "Notify the carrier within the policy period",
  "offset_days": 1,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "Policies require prompt notice, and late notice is a stated ground for denial."
 },
 {
  "key": "read_the_applicable_coverage_and",
  "title": "Read the applicable coverage and deductible",
  "offset_days": 2,
  "actor": "ai",
  "kind": "extract",
  "recipient": null
 },
 {
  "key": "arrange_emergency_mitigation_and_keep",
  "title": "Arrange emergency mitigation and keep receipts",
  "offset_days": 3,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Reaches out to: vendors. The insured has a duty to mitigate, and mitigation costs are usually recoverable if documented."
 },
 {
  "key": "coordinate_the_adjuster_inspection",
  "title": "Coordinate the adjuster inspection",
  "offset_days": 10,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier"
 },
 {
  "key": "track_the_claim_to_settlement",
  "title": "Track the claim to settlement",
  "offset_days": 30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "Claims stall silently. Keeps a dated record of every contact."
 },
 {
  "key": "confirm_settlement_and_file_the_record",
  "title": "Confirm settlement and file the record",
  "offset_days": 90,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Records whether the claim will affect renewal."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$umbrella_liability_coverage_adequacy_review$K$, $N$Umbrella liability coverage adequacy review$N$, $D$Limits are typically set once at onboarding and never revisited, so coverage falls further behind every year the family grows.$D$, $C$Insurance$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "read_current_umbrella_limits_and",
  "title": "Read current umbrella limits and underlying policies",
  "offset_days": -30,
  "actor": "ai",
  "kind": "extract",
  "recipient": null,
  "note": "The umbrella limit, and the auto and property limits it sits above. A gap between the two leaves an uninsured layer."
 },
 {
  "key": "assemble_the_current_exposure_profile",
  "title": "Assemble the current exposure profile",
  "offset_days": -22,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Net worth, properties, vehicles, watercraft, staff, board seats, rental activity, teenage drivers."
 },
 {
  "key": "check_for_gaps_beneath_the_umbrella",
  "title": "Check for gaps beneath the umbrella",
  "offset_days": -20,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Umbrella policies require minimum underlying limits. If an auto policy dropped below that floor the umbrella may not respond at all — a failure that looks like coverage right up to the claim."
 },
 {
  "key": "send_the_profile_to_the_agent_for_review",
  "title": "Send the profile to the agent for review",
  "offset_days": -14,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "Ordanis assembles the facts; the coverage recommendation is the licensed agent's role."
 },
 {
  "key": "record_the_family_decision",
  "title": "Record the family decision",
  "offset_days": 5,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "Increase, maintain or decline. A declined increase is recorded with the date and the recommendation, which matters if it is ever revisited."
 },
 {
  "key": "confirm_endorsement_if_limits_changed",
  "title": "Confirm endorsement if limits changed",
  "offset_days": 30,
  "actor": "external",
  "kind": "confirm",
  "recipient": null,
  "note": "Closes when the carrier has issued, not when the family agreed."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$valuables_scheduling_and_appraisal_refresh$K$, $N$Valuables scheduling and appraisal refresh$N$, $D$An item on a fifteen-year-old appraisal is underinsured by a margin nobody discovers until a claim.$D$, $C$Insurance$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "list_scheduled_items_and_appraisal_dates",
  "title": "List scheduled items and appraisal dates",
  "offset_days": -60,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Every valuable with its stated value, appraisal date, and whether it appears on the current policy schedule."
 },
 {
  "key": "flag_stale_appraisals_and_unscheduled",
  "title": "Flag stale appraisals and unscheduled items",
  "offset_days": -55,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Two separate failures: an item valued years ago, and an item the family owns that never made it onto the schedule at all. The second is more common."
 },
 {
  "key": "engage_the_appraiser",
  "title": "Engage the appraiser",
  "offset_days": -45,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Reaches out to: appraiser. Drafted to the family's preferred appraiser with the item list."
 },
 {
  "key": "appraisal_received_and_filed",
  "title": "Appraisal received and filed",
  "offset_days": -20,
  "actor": "external",
  "kind": "confirm",
  "recipient": null,
  "note": "Files against each item and updates the recorded value."
 },
 {
  "key": "send_updated_values_to_the_agent",
  "title": "Send updated values to the agent",
  "offset_days": -12,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "Underinsurance persists until the carrier has this."
 },
 {
  "key": "confirm_endorsement_issued",
  "title": "Confirm endorsement issued",
  "offset_days": 5,
  "actor": "external",
  "kind": "confirm",
  "recipient": null,
  "note": "The value change is only real once the carrier has endorsed it."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$flood_zone_re_determination$K$, $N$Flood zone re-determination$N$, $D$A redrawn map changes both the requirement and the premium, and the notice is easy to miss.$D$, $C$Insurance$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "check_current_designation_for_each",
  "title": "Check current designation for each property",
  "offset_days": -45,
  "actor": "expert",
  "kind": "check",
  "recipient": null
 },
 {
  "key": "compare_against_the_designation_on_file",
  "title": "Compare against the designation on file",
  "offset_days": -40,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "A change in either direction matters: newly in zone means required cover, newly out means a possible premium reduction nobody claims."
 },
 {
  "key": "route_any_change_to_the_agent",
  "title": "Route any change to the agent",
  "offset_days": -30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier"
 },
 {
  "key": "confirm_coverage_adjusted_or_not",
  "title": "Confirm coverage adjusted or not required",
  "offset_days": 0,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$lease_renewal_and_rent_escalation$K$, $N$Lease renewal and rent escalation$N$, $D$Catches the renewal window and the escalation clause before either passes unnoticed. Renewal options expire silently and unbilled escalations are rarely recovered.$D$, $C$Property$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "read_the_lease_terms",
  "title": "Read the lease terms",
  "offset_days": -150,
  "actor": "ai",
  "kind": "extract",
  "recipient": null,
  "note": "Expiry, renewal option window, notice period, escalation formula, and who must give notice to whom."
 },
 {
  "key": "verify_the_escalation_was_applied",
  "title": "Verify the escalation was applied",
  "offset_days": -140,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Compares rent actually received against the formula. An unapplied escalation compounds every year it is missed."
 },
 {
  "key": "present_the_renewal_decision",
  "title": "Present the renewal decision",
  "offset_days": -120,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "The option terms, the notice deadline, and what happens if nothing is done. Holding over usually converts to month-to-month on worse terms."
 },
 {
  "key": "serve_renewal_or_termination_notice",
  "title": "Serve renewal or termination notice",
  "offset_days": -95,
  "actor": "expert",
  "kind": "draft_letter",
  "recipient": null,
  "note": "Reaches out to: counterparty. Drafted per the lease notice provisions, which usually specify method and address."
 },
 {
  "key": "confirm_notice_received",
  "title": "Confirm notice received",
  "offset_days": -85,
  "actor": "external",
  "kind": "confirm",
  "recipient": null,
  "note": "Notice served but not received is the failure mode. Confirmed, not assumed."
 },
 {
  "key": "execute_and_file_the_renewal",
  "title": "Execute and file the renewal",
  "offset_days": 0,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Updates the rent record and sets the next renewal window."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$mortgage_maturity_and_refinance_window$K$, $N$Mortgage maturity and refinance window$N$, $D$A balloon maturity arriving without a plan is an avoidable crisis.$D$, $C$Property$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "read_the_loan_terms",
  "title": "Read the loan terms",
  "offset_days": -180,
  "actor": "ai",
  "kind": "extract",
  "recipient": null,
  "note": "Maturity, rate reset date, prepayment penalty, any covenant."
 },
 {
  "key": "present_the_position_and_the_options",
  "title": "Present the position and the options",
  "offset_days": -150,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "Balance, current rate, what happens at maturity. The financing decision belongs to the family and their banker."
 },
 {
  "key": "open_the_conversation_with_the_lender",
  "title": "Open the conversation with the lender",
  "offset_days": -120,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Reaches out to: lender."
 },
 {
  "key": "assemble_what_the_lender_will_request",
  "title": "Assemble what the lender will request",
  "offset_days": -90,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Returns, statements, entity documents, property records — from the Vault."
 },
 {
  "key": "confirm_refinance_or_payoff_complete",
  "title": "Confirm refinance or payoff complete",
  "offset_days": -5,
  "actor": "external",
  "kind": "confirm",
  "recipient": null
 },
 {
  "key": "update_loan_record_and_file_documents",
  "title": "Update loan record and file documents",
  "offset_days": 10,
  "actor": "ai",
  "kind": "file",
  "recipient": null
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$property_tax_assessment_appeal_window$K$, $N$Property tax assessment appeal window$N$, $D$The appeal deadline is short, hard and different in every jurisdiction. A missed window costs the overpayment every year until the next reassessment.$D$, $C$Property$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "assessment_notice_received_and_read",
  "title": "Assessment notice received and read",
  "offset_days": -40,
  "actor": "ai",
  "kind": "extract",
  "recipient": null,
  "note": "Assessed value, prior year value, appeal deadline, filing method for that jurisdiction."
 },
 {
  "key": "compare_to_prior_year_and_to_recorded",
  "title": "Compare to prior year and to recorded value",
  "offset_days": -38,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Flags an increase materially above prior year or above the value on file. A large jump is the signal worth acting on."
 },
 {
  "key": "confirm_the_appeal_deadline_for_this",
  "title": "Confirm the appeal deadline for this jurisdiction",
  "offset_days": -35,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Commonly 30 to 45 days from the notice, and it varies by county. The deadline, not the merit, is what is usually missed."
 },
 {
  "key": "present_the_assessment_and_the_option",
  "title": "Present the assessment and the option to appeal",
  "offset_days": -30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "The increase, the deadline, and that appealing is the family's decision. Whether an appeal has merit is a question for a property tax adviser or counsel."
 },
 {
  "key": "engage_representation_if_appealing",
  "title": "Engage representation if appealing",
  "offset_days": -20,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Conditional. Routes to the firm the family uses for assessment appeals."
 },
 {
  "key": "record_the_outcome",
  "title": "Record the outcome",
  "offset_days": 10,
  "actor": "expert",
  "kind": "file",
  "recipient": null,
  "note": "Filed, withdrawn, or deliberately not pursued. Recorded either way so next year has the history."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$seasonal_property_opening_and_closing$K$, $N$Seasonal property opening and closing$N$, $D$Skipped steps are discovered months later as water damage, a lapsed alarm certificate or a frozen pipe.$D$, $C$Property$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "confirm_dates_and_vendor_availability",
  "title": "Confirm dates and vendor availability",
  "offset_days": -45,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Reaches out to: vendors. Vendors in seasonal markets book out well ahead."
 },
 {
  "key": "schedule_systems_work",
  "title": "Schedule systems work",
  "offset_days": -30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Reaches out to: vendors. Water, heating, alarm, generator. Water is the one that causes catastrophic damage when missed."
 },
 {
  "key": "confirm_vacancy_provisions",
  "title": "Confirm vacancy provisions",
  "offset_days": -20,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Many policies restrict cover on a property left unoccupied beyond a stated period, or require specific precautions."
 },
 {
  "key": "confirm_work_completed",
  "title": "Confirm work completed",
  "offset_days": 0,
  "actor": "external",
  "kind": "confirm",
  "recipient": null
 },
 {
  "key": "file_certificates_and_queue_the_reverse",
  "title": "File certificates and queue the reverse cycle",
  "offset_days": 7,
  "actor": "ai",
  "kind": "file",
  "recipient": null
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$short_term_rental_compliance$K$, $N$Short-term rental compliance$N$, $D$Enforcement is increasingly active and penalties are per-night.$D$, $C$Property$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "confirm_current_local_rules_and_permit",
  "title": "Confirm current local rules and permit status",
  "offset_days": -60,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Municipal rules on short-term letting change frequently, and often mid-year."
 },
 {
  "key": "renew_the_permit_or_registration",
  "title": "Renew the permit or registration",
  "offset_days": -30,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null
 },
 {
  "key": "confirm_occupancy_tax_filings_with_the",
  "title": "Confirm occupancy tax filings with the CPA",
  "offset_days": -20,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Transient occupancy tax is usually a separate filing from income tax and is commonly overlooked."
 },
 {
  "key": "confirm_the_policy_permits_short_term",
  "title": "Confirm the policy permits short-term letting",
  "offset_days": -15,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "A standard homeowners policy commonly excludes it, which leaves the property effectively uninsured while let."
 },
 {
  "key": "confirm_compliant_and_file_evidence",
  "title": "Confirm compliant and file evidence",
  "offset_days": 0,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$vehicle_vessel_and_aircraft_registration$K$, $N$Vehicle, vessel and aircraft registration$N$, $D$Multi-jurisdiction, easy to miss, and the consequence is an asset that cannot legally be used.$D$, $C$Property$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "list_titled_assets_and_expiry_dates",
  "title": "List titled assets and expiry dates",
  "offset_days": -60,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Registration state, expiry, and where the asset is actually kept — which is not always the same."
 },
 {
  "key": "confirm_prerequisites",
  "title": "Confirm prerequisites",
  "offset_days": -45,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Inspection, emissions or an airworthiness check. These take longer than the renewal itself."
 },
 {
  "key": "confirm_insurance_in_force_on_each_asset",
  "title": "Confirm insurance in force on each asset",
  "offset_days": -40,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Renewal is commonly refused without current cover, and an uninsured asset is the bigger problem anyway."
 },
 {
  "key": "complete_renewals",
  "title": "Complete renewals",
  "offset_days": -20,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null
 },
 {
  "key": "file_documents_and_set_next_expiry",
  "title": "File documents and set next expiry",
  "offset_days": 5,
  "actor": "ai",
  "kind": "file",
  "recipient": null
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$contractor_onboarding$K$, $N$Contractor onboarding$N$, $D$Licence, insurance and tax documentation collected once, up front, rather than after an incident.$D$, $C$Property$C$, true, $T$manual$T$, $J$[
 {
  "key": "request_licence_insurance_certificate",
  "title": "Request licence, insurance certificate and W-9",
  "offset_days": 0,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Reaches out to: vendor. Requested together at engagement. Asking afterwards rarely works."
 },
 {
  "key": "verify_the_certificate_names_the",
  "title": "Verify the certificate names the correct insured",
  "offset_days": 5,
  "actor": "expert",
  "kind": "check",
  "recipient": null,
  "note": "A certificate is routinely provided that names a different entity or has already expired. Reading it is the point of this step."
 },
 {
  "key": "confirm_additional_insured_status_where",
  "title": "Confirm additional insured status where required",
  "offset_days": 7,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "Whether it is required is a question for the family's agent or counsel."
 },
 {
  "key": "add_to_the_vendor_network_with_expiry",
  "title": "Add to the vendor network with expiry tracking",
  "offset_days": 10,
  "actor": "ai",
  "kind": "file",
  "recipient": null,
  "note": "The certificate expiry becomes a tracked date, so a lapsed contractor is caught before the next job."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$hoa_dues_and_compliance$K$, $N$HOA dues and compliance$N$, $D$Unpaid dues can become a lien on the property.$D$, $C$Property$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "read_the_dues_or_assessment_notice",
  "title": "Read the dues or assessment notice",
  "offset_days": -30,
  "actor": "ai",
  "kind": "extract",
  "recipient": null
 },
 {
  "key": "flag_any_special_assessment",
  "title": "Flag any special assessment",
  "offset_days": -25,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "A special assessment is materially different from routine dues and usually warrants a decision rather than a payment."
 },
 {
  "key": "schedule_payment",
  "title": "Schedule payment",
  "offset_days": -10,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null
 },
 {
  "key": "confirm_receipt_and_account_current",
  "title": "Confirm receipt and account current",
  "offset_days": 5,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Confirmed current, not merely paid. Associations misapply payments more often than one would expect."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$home_improvement_capital_tracking$K$, $N$Home improvement capital tracking$N$, $D$Records improvements as they happen so cost basis is provable at sale. Reconstructing twenty years of receipts afterwards is the alternative, and it usually fails.$D$, $C$Property$C$, true, $T$manual$T$, $J$[
 {
  "key": "capture_the_project_and_its_documents",
  "title": "Capture the project and its documents",
  "offset_days": 0,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Contract, invoices and proof of payment filed against the property at the time of the work."
 },
 {
  "key": "flag_the_improvement_versus_repair",
  "title": "Flag the improvement-versus-repair question",
  "offset_days": 7,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "The distinction affects basis and it is a tax determination. Flagged, not decided."
 },
 {
  "key": "record_against_the_property_basis",
  "title": "Record against the property basis",
  "offset_days": 14,
  "actor": "ai",
  "kind": "file",
  "recipient": null
 },
 {
  "key": "produce_the_annual_basis_summary",
  "title": "Produce the annual basis summary",
  "offset_days": 365,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "A running record the CPA can rely on at sale."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$charitable_and_daf_annual_granting$K$, $N$Charitable and DAF annual granting$N$, $D$Run deliberately rather than in the last week of December, when appraisals and appreciated-security transfers can no longer settle in time.$D$, $C$Tax$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "summarise_prior_year_giving",
  "title": "Summarise prior year giving",
  "offset_days": -120,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Recipients, amounts, vehicles used, and any multi-year pledge still outstanding."
 },
 {
  "key": "route_the_deduction_question_to_the_cpa",
  "title": "Route the deduction question to the CPA",
  "offset_days": -100,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Deduction limits depend on income, vehicle and asset type. Routed with the facts; the calculation belongs to the CPA."
 },
 {
  "key": "identify_appreciated_securities",
  "title": "Identify appreciated securities suitable for gifting",
  "offset_days": -90,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Gifting stock instead of cash is common practice and needs lead time. Identified and routed, not recommended."
 },
 {
  "key": "present_recipients_and_amounts_for",
  "title": "Present recipients and amounts for decision",
  "offset_days": -60,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor"
 },
 {
  "key": "submit_grant_recommendations",
  "title": "Submit grant recommendations",
  "offset_days": -30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Reaches out to: sponsor. Sponsors typically need weeks, not days, at year end."
 },
 {
  "key": "collect_and_file_acknowledgement_letters",
  "title": "Collect and file acknowledgement letters",
  "offset_days": 20,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "A written acknowledgement is required to substantiate the deduction. Collected while recipients are responsive."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$gift_tax_return_709_preparation_support$K$, $N$Gift tax return (709) preparation support$N$, $D$Assembles what the CPA needs and tracks the deadline. Ordanis does not determine whether a gift is reportable or how it is valued.$D$, $C$Tax$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "list_transfers_made_during_the_year",
  "title": "List transfers made during the year",
  "offset_days": -90,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Gifts, trust contributions, forgiven loans, below-market transactions. A list of what happened, not a determination of what is reportable."
 },
 {
  "key": "collect_supporting_documents",
  "title": "Collect supporting documents",
  "offset_days": -75,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Trust instruments, appraisals, transfer records. Valuation support is what the CPA asks for first."
 },
 {
  "key": "send_the_package_to_the_cpa",
  "title": "Send the package to the CPA",
  "offset_days": -60,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Whether a return is required, and what it says, is entirely their determination."
 },
 {
  "key": "confirm_filing_or_extension_by_the",
  "title": "Confirm filing or extension by the deadline",
  "offset_days": -10,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "An extension of the income tax deadline generally extends this one, but confirm rather than assume."
 },
 {
  "key": "file_the_filed_return_to_the_vault",
  "title": "File the filed return to the Vault",
  "offset_days": 15,
  "actor": "expert",
  "kind": "file",
  "recipient": null,
  "note": "709s are cumulative across a lifetime. Every year needs to survive, and families routinely cannot produce old ones."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$foreign_account_reporting_support$K$, $N$Foreign account reporting support$N$, $D$Penalties for a missed FBAR are severe, and Ordanis does not assess whether one is required.$D$, $C$Tax$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "list_accounts_and_assets_held_outside",
  "title": "List accounts and assets held outside the country",
  "offset_days": -90,
  "actor": "expert",
  "kind": "check",
  "recipient": null,
  "note": "Including accounts where the family has signature authority but no ownership — the case most often overlooked."
 },
 {
  "key": "collect_maximum_balance_for_each_during",
  "title": "Collect maximum balance for each during the year",
  "offset_days": -70,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Reaches out to: institutions. Maximum during the year, not the closing balance. Collecting the wrong figure is the common error."
 },
 {
  "key": "send_to_the_cpa_for_determination",
  "title": "Send to the CPA for determination",
  "offset_days": -50,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Whether a filing is required, and which one, is entirely theirs."
 },
 {
  "key": "confirm_filed_or_confirmed_not_required",
  "title": "Confirm filed or confirmed not required",
  "offset_days": 0,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Either outcome is recorded with a date. A silent absence of filing is not a record."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$multi_state_activity_review$K$, $N$Multi-state activity review$N$, $D$Assembles where the family lives, owns, works and earns so the CPA can assess state filing obligations. Ordanis reports facts and never concludes whether nexus exists.$D$, $C$Tax$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "assemble_the_multi_state_footprint",
  "title": "Assemble the multi-state footprint",
  "offset_days": -75,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Residences, properties, entities, employment and board seats by state."
 },
 {
  "key": "flag_what_changed_since_last_year",
  "title": "Flag what changed since last year",
  "offset_days": -60,
  "actor": "expert",
  "kind": "check",
  "recipient": null,
  "note": "A new property, a new entity registration or a change in time spent is what usually creates a new obligation."
 },
 {
  "key": "send_the_footprint_to_the_cpa",
  "title": "Send the footprint to the CPA",
  "offset_days": -45,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Nexus varies by state and by year. This step provides facts, nothing more."
 },
 {
  "key": "record_the_filing_conclusion",
  "title": "Record the filing conclusion",
  "offset_days": 0,
  "actor": "expert",
  "kind": "file",
  "recipient": null,
  "note": "Which states require a return this year, per the CPA, recorded against the household."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$annual_trustee_review_and_accounting$K$, $N$Annual trustee review and accounting$N$, $D$A fiduciary obligation that is frequently informal, which is exactly the problem if it is ever questioned.$D$, $C$Trusts & Estates$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "confirm_the_trust_terms_and",
  "title": "Confirm the trust terms and distribution standard",
  "offset_days": -60,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "What the trustee is actually required to do, and to whom, per the instrument."
 },
 {
  "key": "assemble_the_year_s_activity",
  "title": "Assemble the year's activity",
  "offset_days": -40,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Contributions, distributions, income, expenses, asset changes."
 },
 {
  "key": "review_distributions_against_the",
  "title": "Review distributions against the standard",
  "offset_days": -30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Surfaces distributions that appear inconsistent with the instrument. Whether one was proper is a legal question for counsel."
 },
 {
  "key": "prepare_the_beneficiary_accounting",
  "title": "Prepare the beneficiary accounting",
  "offset_days": -15,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "trustee",
  "note": "For the trustee to review, adopt and issue. It is the trustee's accounting, not ours."
 },
 {
  "key": "confirm_issued_to_beneficiaries",
  "title": "Confirm issued to beneficiaries",
  "offset_days": 0,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Issuance often starts a limitation period, which is why the date is worth recording."
 },
 {
  "key": "file_and_queue_next_year",
  "title": "File and queue next year",
  "offset_days": 10,
  "actor": "ai",
  "kind": "file",
  "recipient": null
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$beneficiary_designation_audit$K$, $N$Beneficiary designation audit$N$, $D$Designations override the will, so a stale one silently defeats the entire estate plan.$D$, $C$Trusts & Estates$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "list_every_account_carrying_a",
  "title": "List every account carrying a designation",
  "offset_days": -30,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Retirement accounts, life policies, annuities, HSAs, transfer-on-death registrations."
 },
 {
  "key": "request_current_designations_from_each",
  "title": "Request current designations from each institution",
  "offset_days": -25,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Reaches out to: institutions. What the family believes is on file and what the custodian actually holds are frequently different. This asks the custodian, not the family."
 },
 {
  "key": "compare_designations_against_the_estate",
  "title": "Compare designations against the estate plan",
  "offset_days": -12,
  "actor": "expert",
  "kind": "check",
  "recipient": null,
  "note": "Surfaces contradictions: an ex-spouse still named, a deceased beneficiary, a minor named outright, an estate named where a trust was intended."
 },
 {
  "key": "report_the_contradictions_found",
  "title": "Report the contradictions found",
  "offset_days": -6,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "Each finding states what is on file and what the plan says. Whether it is wrong is a legal question."
 },
 {
  "key": "route_findings_to_counsel_and_adviser",
  "title": "Route findings to counsel and adviser",
  "offset_days": -3,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Ordanis surfaces and tracks; it does not advise on who should be named."
 },
 {
  "key": "confirm_each_change_accepted_by_the",
  "title": "Confirm each change accepted by the custodian",
  "offset_days": 45,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "A submitted change form is not a completed change. Closes only on custodian confirmation."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$trust_funding_verification$K$, $N$Trust funding verification$N$, $D$Unfunded trusts are usually discovered at death, when the drafting cost has been paid and the benefit has been lost.$D$, $C$Trusts & Estates$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "inventory_every_trust_on_file",
  "title": "Inventory every trust on file",
  "offset_days": -30,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Each trust with its date, trustee and stated purpose."
 },
 {
  "key": "identify_what_each_trust_should_hold",
  "title": "Identify what each trust should hold",
  "offset_days": -25,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "From the trust document and the estate plan. Where intended funding isn't evident from the documents, this routes to counsel rather than being inferred."
 },
 {
  "key": "compare_against_titled_ownership",
  "title": "Compare against titled ownership",
  "offset_days": -20,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Accounts, deeds and entity records for assets actually titled in each trust."
 },
 {
  "key": "produce_the_funding_gap_report",
  "title": "Produce the funding gap report",
  "offset_days": -10,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "Which trusts are funded, partially funded, or empty. A finding, not a recommendation."
 },
 {
  "key": "route_gaps_to_the_estate_attorney",
  "title": "Route gaps to the estate attorney",
  "offset_days": -5,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Funding a trust is a legal act with tax consequences. Ordanis identifies the gap; it does not retitle assets."
 },
 {
  "key": "confirm_each_gap_closed_or_accepted",
  "title": "Confirm each gap closed or accepted",
  "offset_days": 30,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Every gap ends either funded or deliberately accepted with a reason recorded. Nothing left ambiguous."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$annual_gifting_execution$K$, $N$Annual gifting execution$N$, $D$The deadline is 31 December and unused capacity does not carry forward.$D$, $C$Trusts & Estates$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "confirm_this_year_s_plan_with_the_cpa",
  "title": "Confirm this year's plan with the CPA and counsel",
  "offset_days": -90,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Recipients, amounts, vehicles. The plan is theirs; Ordanis executes and records it."
 },
 {
  "key": "summarise_gifts_already_made_this_year",
  "title": "Summarise gifts already made this year",
  "offset_days": -75,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "So capacity is measured against what actually happened, including gifts made outside the platform."
 },
 {
  "key": "execute_the_transfers",
  "title": "Execute the transfers",
  "offset_days": -45,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Securities transfers need weeks at year end, not days."
 },
 {
  "key": "record_date_amount_and_recipient_for",
  "title": "Record date, amount and recipient for each gift",
  "offset_days": -15,
  "actor": "expert",
  "kind": "file",
  "recipient": null,
  "note": "The evidence a 709 will be built from next spring."
 },
 {
  "key": "confirm_all_transfers_settled_before",
  "title": "Confirm all transfers settled before year end",
  "offset_days": -2,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "A gift initiated in December but settling in January is a next-year gift."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$annual_family_meeting_preparation$K$, $N$Annual family meeting preparation$N$, $D$The meeting is where a family governs itself, and it is generally the least prepared item on the calendar.$D$, $C$Governance$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "draft_the_agenda_from_the_year",
  "title": "Draft the agenda from the year",
  "offset_days": -45,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "Built from what actually happened — entities formed, properties bought, documents changed, exceptions raised — rather than from last year's agenda."
 },
 {
  "key": "assemble_the_materials_pack",
  "title": "Assemble the materials pack",
  "offset_days": -30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "A plain-English position summary. Not a portfolio review, which is the adviser's to give."
 },
 {
  "key": "confirm_which_professionals_should",
  "title": "Confirm which professionals should attend",
  "offset_days": -21,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal"
 },
 {
  "key": "distribute_materials_in_advance",
  "title": "Distribute materials in advance",
  "offset_days": -7,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "Materials handed out in the room do not get read."
 },
 {
  "key": "record_decisions_and_actions",
  "title": "Record decisions and actions",
  "offset_days": 3,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "The step that makes the meeting worth holding. Each action gets an owner and a date."
 },
 {
  "key": "convert_actions_into_tracked_work",
  "title": "Convert actions into tracked work",
  "offset_days": 10,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Actions become tasks or workflows, so next year opens with what was done rather than what was said."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$cybersecurity_and_credential_hygiene_review$K$, $N$Cybersecurity and credential hygiene review$N$, $D$Wealthy families are specifically targeted, and the attack is usually social rather than technical.$D$, $C$Governance$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "audit_who_has_access_to_what",
  "title": "Audit who has access to what",
  "offset_days": -30,
  "actor": "expert",
  "kind": "check",
  "recipient": null,
  "note": "Portal users, professionals, vendors and former staff. Access granted for a reason that has ended is the commonest finding."
 },
 {
  "key": "remove_access_no_longer_needed",
  "title": "Remove access no longer needed",
  "offset_days": -25,
  "actor": "expert",
  "kind": "check",
  "recipient": null,
  "note": "Admin only. Access changes are restricted to administrators and are enforced in the database; an Expert escalates rather than attempting the change."
 },
 {
  "key": "confirm_institution_level_protections",
  "title": "Confirm institution-level protections",
  "offset_days": -10,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Two-factor authentication and callback verification at each custodian and bank. Reaches out to: institutions."
 },
 {
  "key": "record_the_review_and_set_the_next",
  "title": "Record the review and set the next",
  "offset_days": 5,
  "actor": "ai",
  "kind": "file",
  "recipient": null
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$digital_asset_and_credential_succession$K$, $N$Digital asset and credential succession$N$, $D$Increasingly the category where value and access are simply lost.$D$, $C$Governance$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "inventory_digital_assets_and_accounts",
  "title": "Inventory digital assets and accounts",
  "offset_days": -45,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "Domains, digital currency, loyalty balances, business accounts, cloud storage, email. Recorded as existing and where — never as credentials."
 },
 {
  "key": "confirm_how_access_would_be_obtained",
  "title": "Confirm how access would be obtained",
  "offset_days": -30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "A password manager with an emergency contact, or a sealed instruction with counsel. Ordanis records that a mechanism exists; it does not hold the keys."
 },
 {
  "key": "route_the_fiduciary_access_question_to",
  "title": "Route the fiduciary access question to counsel",
  "offset_days": -20,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Most states have legislation on fiduciary access to digital assets, and estate documents usually need explicit language. A legal question."
 },
 {
  "key": "confirm_self_custodied_assets_are",
  "title": "Confirm self-custodied assets are recoverable",
  "offset_days": -10,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "A self-custodied wallet with no recoverable key is permanently lost on incapacity or death. Worth confirming a plan exists while it still can be."
 },
 {
  "key": "file_the_inventory_and_set_the_next",
  "title": "File the inventory and set the next review",
  "offset_days": 5,
  "actor": "ai",
  "kind": "file",
  "recipient": null
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$document_retention_and_destruction_cycle$K$, $N$Document retention and destruction cycle$N$, $D$Keeping everything forever is its own liability, and so is destroying the wrong thing.$D$, $C$Governance$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "confirm_the_retention_policy_with",
  "title": "Confirm the retention policy with counsel",
  "offset_days": -45,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Retention periods are legal and jurisdictional. Ordanis applies the policy; counsel sets it."
 },
 {
  "key": "list_documents_past_their_retention",
  "title": "List documents past their retention period",
  "offset_days": -30,
  "actor": "ai",
  "kind": "check",
  "recipient": null
 },
 {
  "key": "check_for_litigation_or_audit_holds",
  "title": "Check for litigation or audit holds",
  "offset_days": -25,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "A hold overrides retention absolutely. Destroying a document under hold is a serious matter, so this step gates the next."
 },
 {
  "key": "present_the_destruction_list_for",
  "title": "Present the destruction list for approval",
  "offset_days": -15,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "Nothing is destroyed on a schedule alone. A person approves the list."
 },
 {
  "key": "execute_and_record_what_was_destroyed",
  "title": "Execute and record what was destroyed",
  "offset_days": 0,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "A record of what was destroyed and when — which is itself retained."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$education_funding_review$K$, $N$Education funding review$N$, $D$Contribution decisions are the adviser's and the CPA's; the tracking is not.$D$, $C$Governance$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "list_education_accounts_by_beneficiary",
  "title": "List education accounts by beneficiary",
  "offset_days": -45,
  "actor": "ai",
  "kind": "check",
  "recipient": null
 },
 {
  "key": "confirm_the_timeline_for_each",
  "title": "Confirm the timeline for each beneficiary",
  "offset_days": -35,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "Years until first use drives everything downstream."
 },
 {
  "key": "route_funding_and_allocation_to_the",
  "title": "Route funding and allocation to the adviser and CPA",
  "offset_days": -25,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Contribution levels, state deduction and any front-loading election are their decisions."
 },
 {
  "key": "confirm_beneficiary_designations_current",
  "title": "Confirm beneficiary designations current",
  "offset_days": -15,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Successor beneficiaries on education accounts are frequently never set."
 },
 {
  "key": "record_the_position_and_set_the_next",
  "title": "Record the position and set the next review",
  "offset_days": 5,
  "actor": "ai",
  "kind": "file",
  "recipient": null
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$professional_network_annual_review$K$, $N$Professional network annual review$N$, $D$Relationships lapse quietly and are discovered when someone urgently needs an attorney who retired two years ago.$D$, $C$Governance$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "list_the_current_professional_network",
  "title": "List the current professional network",
  "offset_days": -45,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "CPA, attorneys, agents, bankers, trustees, with role and last recorded contact."
 },
 {
  "key": "flag_relationships_with_no_recent",
  "title": "Flag relationships with no recent activity",
  "offset_days": -40,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "A professional with no contact in a year is either not needed or not engaged. Both are worth knowing."
 },
 {
  "key": "confirm_engagement_letters_current",
  "title": "Confirm engagement letters current",
  "offset_days": -30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Several professional relationships require a current engagement letter to be effective at all."
 },
 {
  "key": "identify_gaps_in_the_network",
  "title": "Identify gaps in the network",
  "offset_days": -15,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "grantor",
  "note": "A family with a trust and no successor trustee; property in a state with no counsel there."
 },
 {
  "key": "update_the_network_record_and_portal",
  "title": "Update the network record and portal access",
  "offset_days": 5,
  "actor": "ai",
  "kind": "file",
  "recipient": null,
  "note": "Removes those no longer engaged, which is also an access-control action. Admin only: access changes are restricted to administrators; an Expert escalates rather than attempting the change."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$entity_annual_report_and_registered_agent$K$, $N$Entity annual report and registered agent renewal$N$, $D$Administrative dissolution for a missed filing is silent until a transaction fails or a lender asks for a certificate of good standing.$D$, $C$Entities$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "confirm_the_entity_register_and_filing",
  "title": "Confirm the entity register and filing dates",
  "offset_days": -45,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Each entity, its jurisdiction, formation date, deadline and registered agent."
 },
 {
  "key": "check_current_standing_in_each",
  "title": "Check current standing in each jurisdiction",
  "offset_days": -40,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "An entity already delinquent needs reinstatement — a different and slower process than a routine filing. Better found now than at the deadline."
 },
 {
  "key": "confirm_registered_agent_is_current_and",
  "title": "Confirm registered agent is current and paid",
  "offset_days": -30,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "A lapsed agent means state notices go nowhere, which is how a filing gets missed without anyone being told."
 },
 {
  "key": "prepare_each_annual_report",
  "title": "Prepare each annual report",
  "offset_days": -20,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Ownership or officer changes since last year are flagged for confirmation rather than carried forward silently."
 },
 {
  "key": "confirm_filing_accepted_and_fee_paid",
  "title": "Confirm filing accepted and fee paid",
  "offset_days": -3,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Confirmation from the state, not a submission receipt."
 },
 {
  "key": "file_confirmations_and_set_next_year",
  "title": "File confirmations and set next year",
  "offset_days": 5,
  "actor": "ai",
  "kind": "file",
  "recipient": null
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$household_staff_payroll_and_tax_compliance$K$, $N$Household staff payroll and tax compliance$N$, $D$This exposure sits personally with the principal, not an entity, and is almost never systematised.$D$, $C$Household$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "confirm_the_current_staff_register",
  "title": "Confirm the current staff register",
  "offset_days": -30,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Each person, role, start date, pay rate, and whether treated as employee or contractor. A misclassification is the underlying exposure, worth revisiting each cycle."
 },
 {
  "key": "flag_any_classification_question_to_the",
  "title": "Flag any classification question to the CPA",
  "offset_days": -25,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Employee versus contractor is a legal determination with penalties attached. Ordanis flags the pattern — regular schedule, work at the family home, tools provided — and routes it. It does not decide."
 },
 {
  "key": "confirm_payroll_filings_and_deposits",
  "title": "Confirm payroll filings and deposits current",
  "offset_days": -15,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Federal and state withholding, unemployment filings, any local requirement."
 },
 {
  "key": "confirm_workers_compensation_in_force",
  "title": "Confirm workers compensation in force",
  "offset_days": -12,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "Required in most states for household employees and commonly assumed to be covered by homeowners, which it usually is not."
 },
 {
  "key": "prepare_w_2_or_1099_for_each_person",
  "title": "Prepare W-2 or 1099 for each person",
  "offset_days": -8,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "From the payroll record, routed to the CPA for filing."
 },
 {
  "key": "confirm_all_filings_accepted",
  "title": "Confirm all filings accepted",
  "offset_days": 5,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Closes on acceptance."
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$1099_issuance_for_household_vendors$K$, $N$1099 issuance for household vendors$N$, $D$$D$, $C$Household$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "list_vendors_paid_above_the_threshold",
  "title": "List vendors paid above the threshold",
  "offset_days": -60,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "From the payment register, aggregated per vendor across the year."
 },
 {
  "key": "flag_vendors_with_no_w_9_on_file",
  "title": "Flag vendors with no W-9 on file",
  "offset_days": -55,
  "actor": "ai",
  "kind": "check",
  "recipient": null
 },
 {
  "key": "request_missing_w_9s",
  "title": "Request missing W-9s",
  "offset_days": -45,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Reaches out to: vendors. Sent while there is still leverage. Chasing a W-9 in February from a vendor no longer working for the family rarely succeeds."
 },
 {
  "key": "send_the_package_to_the_cpa",
  "title": "Send the package to the CPA",
  "offset_days": -20,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "Who is a 1099 recipient is the CPA's determination. Ordanis provides payment records and W-9s."
 },
 {
  "key": "confirm_issued_and_filed",
  "title": "Confirm issued and filed",
  "offset_days": 10,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$quarterly_statement_collection_and$K$, $N$Quarterly statement collection and reconciliation$N$, $D$Every report the family sees depends on this, and it is currently a chase.$D$, $C$Investments$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "list_expected_statements",
  "title": "List expected statements",
  "offset_days": -10,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Every account with its institution and the period expected. The absence of a statement is the signal here, not the presence of one."
 },
 {
  "key": "match_arrived_statements_to_expected",
  "title": "Match arrived statements to expected",
  "offset_days": 10,
  "actor": "ai",
  "kind": "check",
  "recipient": null,
  "note": "Files what arrived; flags what has not."
 },
 {
  "key": "chase_missing_statements",
  "title": "Chase missing statements",
  "offset_days": 15,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": null,
  "note": "Reaches out to: institutions. Drafted per institution for the specific period missing."
 },
 {
  "key": "extract_closing_balances",
  "title": "Extract closing balances",
  "offset_days": 20,
  "actor": "ai",
  "kind": "extract",
  "recipient": null,
  "note": "Records the closing balance and as-of date with the statement as source document."
 },
 {
  "key": "reconcile_against_recorded_balances",
  "title": "Reconcile against recorded balances",
  "offset_days": 25,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Flags any material variance before it reaches a family report."
 },
 {
  "key": "close_the_period",
  "title": "Close the period",
  "offset_days": 30,
  "actor": "ai",
  "kind": "file",
  "recipient": null
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

insert into public.workflow_templates (key, name, description, category, is_starter, trigger_kind, steps, active)
values ($K$entity_document_review$K$, $N$Entity document review$N$, $D$Gathers the entity's governing and succession documents, compares recorded ownership to the agreement, checks any buy-sell agreement is funded and the valuation mechanism is current, and routes every finding to counsel in a single package.$D$, $C$Entities$C$, true, $T$obligation_date$T$, $J$[
 {
  "key": "gather_governing_and_succession",
  "title": "Gather governing and succession documents",
  "offset_days": -60,
  "actor": "expert",
  "kind": "confirm",
  "recipient": null,
  "note": "Including any amendment that was executed but never filed with the others."
 },
 {
  "key": "compare_recorded_ownership_to_the",
  "title": "Compare recorded ownership to the agreement",
  "offset_days": -45,
  "actor": "expert",
  "kind": "check",
  "recipient": null,
  "note": "Ownership drifts through gifts and transfers while the agreement stays as drafted. Surfaces the discrepancy; does not resolve it."
 },
 {
  "key": "confirm_any_buy_sell_agreement_is_funded",
  "title": "Confirm any buy-sell agreement is funded",
  "offset_days": -38,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "carrier",
  "note": "Buy-sell agreements are commonly funded by life insurance that lapsed, was never bought, or no longer covers current value. An unfunded agreement is unenforceable in practice."
 },
 {
  "key": "check_the_valuation_mechanism_is_current",
  "title": "Check the valuation mechanism is current",
  "offset_days": -30,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal",
  "note": "A formula agreed a decade ago may bear no relation to the business today."
 },
 {
  "key": "route_all_findings_to_counsel_in_one",
  "title": "Route all findings to counsel in one package",
  "offset_days": -15,
  "actor": "expert",
  "kind": "draft_email",
  "recipient": "internal"
 },
 {
  "key": "file_current_versions_and_set_the_next",
  "title": "File current versions and set the next review",
  "offset_days": 10,
  "actor": "ai",
  "kind": "file",
  "recipient": null
 }
]$J$::jsonb, true)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  is_starter = true, trigger_kind = excluded.trigger_kind, steps = excluded.steps, active = true, updated_at = now();

-- RMD: CPA confirmation is mandatory, not conditional.
update public.workflow_templates
set steps = (
      select jsonb_agg(
               case when e.s->>'key' = 'cpa_confirm'
                    then (e.s - 'requires') || jsonb_build_object('note',
                         'Mandatory and not skippable. The platform must never be the sole source of a figure that carries a penalty.')
                    else e.s end
               order by e.ord)
      from jsonb_array_elements(steps) with ordinality as e(s, ord)),
    updated_at = now()
where key = 'rmd'
  and exists (select 1 from jsonb_array_elements(steps) x where x->>'key' = 'cpa_confirm' and x ? 'requires');

-- GRAT: mandatory counsel/CPA confirmation of the annuity amount, inserted as step 2.
update public.workflow_templates
set steps = jsonb_insert(steps, '{1}', $J${
      "key": "counsel_confirm",
      "title": "Confirm the annuity amount with counsel or the CPA",
      "offset_days": -52,
      "actor": "expert",
      "kind": "draft_email",
      "recipient": "internal",
      "note": "Mandatory. The platform reads the annuity schedule from the trust instrument, so a professional confirms the amount before anything is paid. A misread schedule can cause the structure to fail."
    }$J$::jsonb),
    updated_at = now()
where key = 'grat_annuity'
  and not exists (select 1 from jsonb_array_elements(steps) x where x->>'key' = 'counsel_confirm');

-- Retire Property Insurance Renewal (replaced by "Insurance renewal - all lines").
update public.workflow_templates set active = false, updated_at = now() where key = 'insurance_renewal';

commit;
