# Business Profile Sync — Audit & Implementation Report

## Goal

The **Business Profile** is the single source of truth for the sponsor's
organisation and people. The Sponsor Licence application wizard must **import**
this data rather than ask the sponsor to re-type it, show an **"Imported From
Business Profile"** indicator, offer **Sync From Business Profile**, and record
**when** and **by whom** each sync happened.

## 1. Duplicate data collection — audit

Four areas of the V2 wizard overlap with the Business Profile (`sponsor_profiles`).

### Authorising Officer — HIGH duplication
Wizard Step 5 (`Step5AuthorisingOfficer.jsx`) vs profile `authorising*` fields.

| Wizard field | Business Profile | Verdict |
| --- | --- | --- |
| firstName + lastName | `authorisingName` (split on sync) | **duplicate → imported** |
| email | `authorisingEmail` | **duplicate → imported** |
| phone | `authorisingPhone` | **duplicate → imported** |
| dob, nationality, niNumber, immigrationStatus, convictions | _none_ | wizard-only compliance data — kept |

### Key Contact — HIGH duplication
Wizard Step 6 vs profile `keyContact*` fields.

| Wizard field | Business Profile | Verdict |
| --- | --- | --- |
| firstName + lastName | `keyContactName` (split on sync) | **duplicate → imported** |
| email | `keyContactEmail` | **duplicate → imported** |
| phone | `keyContactPhone` | **duplicate → imported** |
| jobTitle | `keyContactDepartment` | **duplicate → imported** |

### Level 1 Users — HIGH duplication
Wizard Step 7 vs profile `level1Users` (JSON array).

| Wizard field | Business Profile | Verdict |
| --- | --- | --- |
| firstName + lastName | `level1Users[].name` (split) | **duplicate → imported** |
| email / phone / jobTitle | `level1Users[].{email,phone,jobTitle}` | **duplicate → imported** |
| isAuthorisingOfficer | _none_ | wizard-only flag — kept |

### Company Information — LOW duplication
Wizard Step 2 (`Step2Organisation.jsx`) captures **regulatory** data the profile
does not hold (PAYE, Accounts Office ref, VAT, SIC codes, regions, charity status,
trading start date). The only genuine overlap:

| Wizard field | Business Profile | Verdict |
| --- | --- | --- |
| companiesHouseNumber | `registrationNumber` | **duplicate → imported (fill-if-blank)** |
| organisationType, PAYE, VAT, SIC, regions, charity… | _none_ | wizard-only — kept |

> Because the profile cannot supply the regulatory fields, Company Info is
> **prefilled, not overwritten** — only `companiesHouseNumber` is filled when blank.

## 2. "Imported From Business Profile" indicator

`ProfileSyncBanner.jsx` now reads **Imported From Business Profile** and is shown
on the Company (Step 2), Authorising Officer (5), Key Contact (6) and Level 1
Users (7) steps. The previous "Pre-filled from Business Profile" copy is replaced.

## 3. Sync From Business Profile

- **Button:** "Sync From Business Profile" on each of the four steps.
- **Endpoint:** `POST /api/business/licence/v2/applications/:id/sync-from-profile`
  → controller `syncFromProfile` → service `syncPersonnelFromProfile`
  (aliased `syncFromBusinessProfile`) in `licenceApplicationV2.service.js`.
- Also runs automatically on **draft creation** so a new application starts
  pre-imported.

## 4. Sync tracking — `lastSyncedAt` / `lastSyncedBy`

Migration `20260622000000-add-profile-sync-tracking.sql` adds nullable columns to
the four sub-tables:

| Table | Columns |
| --- | --- |
| `licence_authorising_officer` | `last_synced_at`, `last_synced_by_user_id` |
| `licence_key_contact` | `last_synced_at`, `last_synced_by_user_id` |
| `licence_level1_users` | `last_synced_at`, `last_synced_by_user_id` |
| `licence_organisation_info` | `last_synced_at`, `last_synced_by_user_id` |

Every record the sync touches is stamped with the current time and the acting
user. The wizard banner derives its "Last synced …" label from these columns
(`deriveSyncedAt()` in `ApplyLicenceV2.jsx`), replacing the old `localStorage`
tracking so the indicator is correct across devices and sessions.

## Non-destructive guarantees (existing applications are safe)

- All new columns are **nullable & additive**; the migration is idempotent
  (`ADD COLUMN IF NOT EXISTS`). A null `last_synced_at` = manually entered.
- AO / KC sync writes **only** profile-owned fields; wizard compliance fields
  (dob, NI number, immigration status, convictions) are never touched.
- Company sync fills `companiesHouseNumber` **only when blank** and never clears
  regulatory fields.
- Manual entry is fully retained — sync is opt-in via the button and never
  locks a field.

## Files changed

**Backend**
- `src/migrations/tenants/20260622000000-add-profile-sync-tracking.sql` (+ rollback)
- `src/models/tenant/licenceAuthorisingOfficer.model.js`
- `src/models/tenant/licenceKeyContact.model.js`
- `src/models/tenant/licenceLevel1User.model.js`
- `src/models/tenant/licenceOrganisationInfo.model.js`
- `src/services/licenceApplicationV2.service.js` (`syncPersonnelFromProfile` + `syncFromBusinessProfile`)

**Frontend**
- `src/components/licenceV2/ProfileSyncBanner.jsx`
- `src/components/licenceV2/Step2Organisation.jsx`
- `src/pages/business/ApplyLicenceV2.jsx`

**Tests**
- `tests/businessProfileSync.test.js`

## How to deploy

```bash
cd Server && npm run migrate:tenants   # add the tracking columns to each tenant DB
```
No data backfill required — existing rows keep `last_synced_at = NULL` until the
sponsor next syncs.
