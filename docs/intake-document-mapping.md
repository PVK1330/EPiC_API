# Intake Document Mapping (Stage 4 → Stage 10)

## Purpose

Sponsors upload supporting evidence twice in the licence journey:

- **Stage 4 — Supporting Documents** (Appendix A), collected during the
  application wizard and stored in `licence_appendix_documents`.
- **Stage 10 — Document Collection & Verification** (the Home Office intake
  checklist), stored in `licence_intake_documents`.

Several of these requirements are the *same physical document*. To avoid forcing
sponsors to upload the same file twice, when the Stage 10 checklist opens we
auto-attach any matching Stage 4 upload, mark it **Imported from Licence
Application**, and let the sponsor replace it if they have a newer version.

## Mapping table

The mapping is defined by `INTAKE_TO_APPENDIX_MAP` in
[`src/services/licenceIntake.service.js`](../src/services/licenceIntake.service.js).
Keep this document and that constant in sync.

| Intake document (Stage 10) `documentKey` | Appendix A (Stage 4) `documentKey` | Auto-import? |
| --- | --- | --- |
| `employer_liability_insurance` (Employer's Liability Insurance) | `employer_liability_insurance` | ✅ |
| `certificate_of_incorporation` (Certificate of Incorporation) | `proof_of_registration` | ✅ |
| `paye_hmrc_registration` (PAYE / HMRC Registration) | `paye_hmrc_registration` | ✅ |
| `business_bank_statement` (Business Bank Statement) | `business_bank_statement` | ✅ |
| `evidence_of_premises` (Trading Premises Evidence) | `evidence_of_premises` | ✅ |
| `vat_registration` (VAT Registration) | `vat_registration` | ✅ |
| `company_financials` (Latest Company Accounts) | `annual_accounts` | ✅ |
| `id_proof_named_person` (ID — Named Person) | _none_ | ❌ manual upload |
| `right_to_work_named_person` (Right to Work — Named Person) | _none_ | ❌ manual upload |
| `organisational_chart` (Organisational Chart) | _none_ | ❌ manual upload |

> Conditional intake documents (food / alcohol / care / TUPE / candidate) have no
> Appendix A counterpart and are always uploaded manually.

## Behaviour

When the sponsor opens **Info & Documents** (`getIntakeSummary`):

1. The mandatory + conditional checklist is seeded as usual.
2. `importMatchingAppendixDocuments()` runs:
   - For each intake slot still **pending** (no file) with a mapping entry,
     it finds the first mapped Appendix A document that has an uploaded file and
     is **not** rejected.
   - It copies the file reference onto the intake slot, sets `status = "uploaded"`,
     `source = "imported_from_application"`, and records
     `source_appendix_document_id` for the audit trail.
3. Imported slots show a violet **Imported from Licence Application** badge.
4. **Replacement is always allowed.** Uploading a new file (`recordDocumentUpload`)
   resets `source = "manual"` and clears `source_appendix_document_id`. Removing
   the file (`deleteSponsorIntakeDocument`) resets the slot to `pending`/`manual`.
5. A slot only **requires** a manual upload when no matching Stage 4 document
   exists (the three rows above, plus any conditional documents).

### Non-destructive guarantees

- Import never overwrites a slot the sponsor has already uploaded or replaced
  (only `pending`, empty slots are touched).
- Import never overwrites a verified or rejected slot.
- Manual upload capability is fully retained for every document.

## Data model

`licence_intake_documents` gained two columns (migration
`20260621000000-add-source-to-intake-documents.sql`):

| Column | Type | Meaning |
| --- | --- | --- |
| `source` | `VARCHAR(40)` default `'manual'` | `manual` or `imported_from_application` |
| `source_appendix_document_id` | `INTEGER` (nullable) | originating `licence_appendix_documents.id` |

## Verification flow note

Imported documents arrive at `status = "uploaded"`, **not** `verified` — a
caseworker still verifies each one against Home Office requirements. The import
only removes duplicate *upload* work from the sponsor, not the caseworker review.

## Tests

See [`tests/intake.documentImport.test.js`](../tests/intake.documentImport.test.js)
— covers the mapping completeness, `planAppendixImports()` selection rules, and
the non-destructive guarantees.
