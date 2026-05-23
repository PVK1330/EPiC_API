# EPiC SaaS Platform Audit Report

Generated during tenant-architecture cleanup. Use with `node scripts/audit-tenant-refs.mjs`.

## Architecture (target)

```
Platform DB (epic_api)          Tenant DB(s) (epic_t_<slug>)
├── organisations               ├── users, roles, cases, documents
├── users (login mirror)        ├── messages, conversations, notifications
└── database_name routing       └── all operational tables (buildDb.js)
```

| Layer | Path | Responsibility |
|--------|------|----------------|
| Platform models | `src/models/index.js` | Organisation + User registry only |
| Tenant models | `src/models/buildDb.js` | Full operational schema per org |
| Tenant pool | `src/services/tenantDb.service.js` | LRU cache of Sequelize instances |
| Request context | `src/middlewares/tenantDb.middleware.js` | `req.tenantDb` after JWT |
| Auth stack | `src/middlewares/authStack.middleware.js` | `verifyToken` + `attachTenantDb` |
| Superadmin | `src/routes/superadmin.routes.js` | Platform-only (no tenant) |

## API surface (mounted in `app.js`)

### Platform / superadmin
- `POST /api/auth/*` — login, register (writes platform + tenant)
- `GET/POST /api/superadmin/*` — orgs, billing, team (platform DB)

### Tenant-scoped (require `verifyTokenAndTenant`)
- **Cases:** `/api/cases`, `/api/case-details`, `/api/case-notes`
- **Users:** `/api/admin`, `/api/caseworker`, `/api/candidate`, `/api/business`
- **Comms:** `/api/messages`, `/api/notifications`
- **Ops:** `/api/documents`, `/api/tasks`, `/api/appointments`, `/api/escalations`
- **Reporting:** `/api/dashboard`, `/api/workload`, `/api/reports`

## Fixes applied (this session)

| Issue | Cause | Fix |
|--------|--------|-----|
| `GET /api/messages/conversations` 500 | `getUnreadCountForUserInConversation(userId, id)` wrong arity | Pass `req.tenantDb` as first argument |
| Socket updates silent | `emitMessageNew*` missing `tenantDb` | Pass `tenantDb: req.tenantDb` |
| `GET /api/notifications/unread-count` 500 | Possible type / cron helpers using undefined `tenantDb` | Numeric `userId`; `processScheduledNotifications(tenantDb)` |
| Documents / account 500 | Module-level `req`, bare models | `getDocumentAttributes(tenantDb)`, `req.tenantDb.*` |
| Migrations broken | `run.js` used `req.tenantDb` | `platform_*` / `tenant_*` SQL + `run.js all` |

## Folders removed / deprecated

| Path | Action | Reason |
|------|--------|--------|
| `scratch/` | **Remove** | Ad-hoc test scripts, not part of runtime |
| `scripts/refactor-tenant-*.mjs` | Keep in `scripts/` | One-off migration aids; do not run in prod |
| `images/` | Keep | Email/assets (e.g. logo) |

## Remaining technical debt

Run `node scripts/audit-tenant-refs.mjs` — expect hits in:

- `case.controller.js` — many legacy `Case.` references
- `appointment.controller.js`, `timeline.controller.js` — bare `Case.`
- `notification.service.js` — helpers like `notifyTaskAssigned` still omit `tenantDb`
- Some notify helpers called without `tenantDb` until callers are updated

## Migrations

```bash
npm run migrate              # platform + all tenants
npm run migrate:platform
npm run migrate:tenants
```

| File | Database |
|------|----------|
| `platform_001_registry.sql` | Platform |
| `tenant_001_workflow_and_documents.sql` | Each tenant |

## Frontend notes

- Vite “Failed to reload CaseWorkflowProgress” was a **cascade** from broken imports/HMR during edits; `npm run build` succeeds.
- Chrome extension error *“listener indicated an asynchronous response…”* is a **browser extension**, not EPiC code.
- WebSocket failures: ensure server running, JWT on handshake, CORS origins in `frontendOrigins.js`.

## Recommended folder structure (Server)

```
Server/
├── docs/                 # This report, API notes
├── scripts/              # audit, postman, one-off maintenance
├── src/
│   ├── config/
│   ├── constants/        # immigrationCaseProcess, etc.
│   ├── controllers/
│   │   ├── AdminControllers/
│   │   ├── CandidateControllers/
│   │   ├── CaseworkerControllers/
│   │   └── superadmin/
│   ├── middlewares/
│   ├── migrations/       # SQL patches
│   ├── models/           # index.js (platform) + buildDb.js (tenant)
│   ├── realtime/
│   ├── routes/
│   ├── seeders/
│   ├── services/
│   └── utils/
├── uploads/
└── package.json
```

## Recommended folder structure (Frontend)

```
EPiC_Frontend/src/
├── components/
│   ├── admin/ | caseworker/ | candidate/ | business/ | case/ | common/
├── constants/            # Shared with server workflow ids
├── layouts/
├── pages/                # Role-based screens
├── routes/
├── services/             # API clients only
└── hooks/
```
