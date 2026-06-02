# Google & Microsoft Meeting Integration — Setup Guide

> **Important:** The integration code is already written and wired into the app.
> You do **not** need to write any code. This guide only covers getting the
> credentials from Google / Microsoft and putting them in your `.env`.

---

## 1. What's already built (so you know what to expect)

When a user connects their account and an appointment is created, the app
**automatically**:

1. Creates a calendar event on the host's Google/Outlook calendar.
2. Generates a **Google Meet** (or **Teams**) join link.
3. Saves the link to the appointment (`meeting_url`).
4. Lets the **provider** email all attendees the invite + join link.
5. Re-syncs on appointment update, and deletes the event on cancel.
6. Retries failed syncs via an internal retry queue + writes audit logs.

> **Required secret — `SETTINGS_ENCRYPTION_KEY`.** OAuth client secrets and
> access/refresh tokens are encrypted at rest with this dedicated AES-256 key.
> It must be a **64-char hex string (32 bytes)** and **different from
> `JWT_SECRET`** — the server refuses to start otherwise. Generate one with:
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
> If you are upgrading an existing deployment that previously relied on the old
> `JWT_SECRET` fallback, run the one-time re-encryption migration after setting
> the new key: `npm run reencrypt:secrets -- --dry-run` then `npm run reencrypt:secrets`.

Relevant code (no need to touch it):

- Google OAuth:      `src/modules/Shared/Integrations/google/google.oauth.js`
- Google meetings:   `src/modules/Shared/Integrations/google/googleMeeting.service.js`
- Google auto-sync:  `src/modules/Shared/Integrations/google/googleWorkflow.service.js`
- Microsoft OAuth:   `src/modules/Shared/Integrations/microsoft/microsoft.oauth.js`
- Wired into:        `src/modules/Shared/Appointments/appointment.controller.js`
- Routes mounted at: `/api/google/*` and the Microsoft equivalents (`src/routes/index.js`)

---

## 2. Is it free?

| Service | API cost | Catch |
|---|---|---|
| Google Calendar API | **Free** | None for normal volume. |
| Google Meet links | **Free** | Auto-created with any Google account (incl. free Gmail). |
| Microsoft Graph (Outlook Calendar) | **Free** | Works on personal + work accounts. |
| Microsoft Teams meeting links | **Free API** | The connecting user must have a **Microsoft 365 / work-or-school** account. Personal `@outlook.com` accounts **cannot** create Teams meetings via the API. |

You pay nothing to Google or Microsoft for the API itself.

---

## 3. Google setup (free)

1. Go to <https://console.cloud.google.com> and create a project.
2. **APIs & Services → Library →** enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen:**
   - User type: **External** (unless all users are in one Google Workspace).
   - Add scopes: `.../auth/calendar`, `email`, `profile`, `openid`.
   - While in "Testing" mode, add your test users' emails. Publish to allow anyone.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID:**
   - Application type: **Web application**.
   - **Authorized redirect URI** — must match exactly:
     - Local:      `http://localhost:5000/api/google/callback`
     - Production: `https://<your-api-domain>/api/google/callback`
5. Copy the **Client ID** and **Client Secret** into your backend `.env`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:5000/api/google/callback
```

6. Restart the API. Users can now click **Connect Google** in the app.

> Note: the redirect URI points at the **backend** (`/api/google/callback`),
> not the frontend — the backend handles the token exchange, then redirects
> the browser back to the frontend.

---

## 4. Microsoft setup (free API; Teams needs an M365 account)

> ⚠️ **Heads-up:** the codebase has two Microsoft entry points using
> **different env var names**:
> - Active module (`microsoft/microsoft.oauth.js`) → `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`, `MICROSOFT_AUTHORITY`.
> - Legacy file (`microsoft.controller.js`) → `MS_CLIENT_ID`, `MS_REDIRECT_URI`, `MS_SCOPES`.
>
> Set the **`MICROSOFT_*`** ones. If something still reads "not configured",
> also set the `MS_*` aliases to the same values. (Worth cleaning up later so
> only one set exists.)

1. Go to <https://portal.azure.com> → **Microsoft Entra ID → App registrations → New registration**.
2. **Supported account types:** "Accounts in any org directory and personal Microsoft accounts" (matches the `common` authority).
3. **Redirect URI** (Web) — must match exactly what's in `.env`:
   - Current default in `.env.example`: `http://localhost:5173/auth/microsoft/callback`
   - Production example: `https://cms.elitepic.co.uk/auth/microsoft/callback`
4. **Certificates & secrets → New client secret** → copy the **Value** (not the ID).
5. **API permissions → Microsoft Graph → Delegated:** add
   `User.Read`, `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`, `offline_access`.
6. Fill in `.env`:

```env
MICROSOFT_CLIENT_ID=your-azure-app-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret-value
MICROSOFT_REDIRECT_URI=http://localhost:5173/auth/microsoft/callback
MICROSOFT_TENANT_ID=common
MICROSOFT_AUTHORITY=https://login.microsoftonline.com/common
# Optional aliases for the legacy controller:
MS_CLIENT_ID=your-azure-app-client-id
MS_REDIRECT_URI=http://localhost:5173/auth/microsoft/callback
```

7. Restart the API.

---

## 5. Per-organisation credentials (multi-tenant option)

You don't have to use one global Google app for everyone. The code also reads
**per-organisation** Google credentials from the platform
`organisations.smtp_settings` JSON under a `google` (or `integrations.google`)
key — see `google.config.js`. The env vars above are the fallback used when an
org hasn't configured its own. So:

- **Global app**: set the `.env` vars → all tenants share one Google app.
- **Per-tenant**: store each org's `client_id` / `client_secret` / `redirect_uri`
  in that org's settings → each tenant uses its own Google app.

---

## 6. How "automatic notify" works (and one small gap)

When a Google Calendar event is created **with attendees**, Google itself emails
each attendee the invite containing the Meet link — you write no email code.

**Small gap to be aware of:** to *guarantee* Google sends those emails, the event
insert/patch should pass `sendUpdates: 'all'`. The current
`googleMeeting.service.js` does **not** set it, so depending on account settings
some attendees may not get an automatic email (the event still appears on their
calendar if they're on the same Workspace). If you later want guaranteed email
invites, that's a one-line addition to the `events.insert` / `events.patch`
calls. Not required to go live — just noted.

---

## 7. Quick test checklist

1. Set the Google `.env` vars, restart API.
2. In the app, open account/settings and click **Connect Google** → authorize.
3. `GET /api/google/status` should return `connected: true`.
4. Create an appointment with the connected user as host + an attendee email.
5. Check the host's Google Calendar — the event + Meet link should appear, and
   the appointment's `meeting_url` should be populated.
6. Repeat for Microsoft if you need Teams/Outlook.
