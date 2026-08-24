import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import express from "express";

// node:test module mocking (run with --experimental-test-module-mocks).
// Mock every outbound edge — Graph, Google, SMTP — before importing the
// controller, so these tests exercise the sync/invite wiring with no network.

const outlookEvents = [];
const googleEvents = [];

const microsoftMeeting = {
  createTeamsOnlineMeeting: mock.fn(async () => ({ eventId: "om-1", meetUrl: "https://teams/online" })),
  createTeamsCalendarMeeting: mock.fn(async () => ({
    eventId: "ms-event-1",
    meetUrl: "https://teams.microsoft.com/l/meetup-join/abc",
    htmlLink: "https://outlook/web",
  })),
  updateTeamsOnlineMeeting: mock.fn(async () => ({})),
  cancelTeamsOnlineMeeting: mock.fn(async () => true),
  createOutlookCalendarEvent: mock.fn(async () => ({ eventId: "ms-event-1" })),
  updateOutlookCalendarEvent: mock.fn(async () => ({})),
  deleteOutlookCalendarEvent: mock.fn(async () => true),
  listOutlookCalendarEvents: mock.fn(async () => outlookEvents),
};

const googleMeeting = {
  createGoogleMeetMeeting: mock.fn(async () => ({ eventId: "g-1", meetUrl: "https://meet.google.com/xyz", htmlLink: "" })),
  updateGoogleCalendarEvent: mock.fn(async () => ({})),
  cancelGoogleCalendarEvent: mock.fn(async () => true),
  deleteGoogleCalendarEvent: mock.fn(async () => true),
  listGoogleCalendarEvents: mock.fn(async () => googleEvents),
};

const sentMail = [];
const mailService = {
  sendTransactionalEmail: mock.fn(async ({ to, subject, html }) => {
    sentMail.push({ to, subject, html });
    return { sent: true, usedSource: "test" };
  }),
  isValidEmailAddress: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "")),
};

mock.module("../src/modules/Shared/Integrations/microsoft/microsoftMeeting.service.js", {
  namedExports: microsoftMeeting,
});
mock.module("../src/modules/Shared/Integrations/google/googleMeeting.service.js", {
  namedExports: googleMeeting,
});
mock.module("../src/services/mail.service.js", { namedExports: mailService });
mock.module("../src/utils/emailBranding.js", {
  namedExports: {
    getOrganisationEmailBranding: mock.fn(async () => ({ orgName: "Test Org" })),
    absoluteImageUrl: (v) => v,
    platformFallbackLogoUrl: () => "",
    escapeHtml: (v) => String(v ?? ""),
    textToInnerHtml: (v) => String(v ?? ""),
    isFullHtmlDocument: () => false,
    clearEmailBrandingCache: () => {},
    EMAIL_PALETTE: {},
  },
});
mock.module("../src/modules/Shared/Integrations/google/google.service.js", {
  namedExports: { getConnection: mock.fn(async () => ({ id: 1, user_id: 1 })) },
});

const controller = await import(
  "../src/modules/Shared/Integrations/teamsMeeting.controller.js"
);

// ── In-memory stand-ins for the tenant models ────────────────────────────────

let meetingRows = [];
let nextMeetingId = 1;
let connections = [];

const makeRow = (values) => {
  const row = {
    ...values,
    get() {
      const { get: _g, update: _u, reload: _r, ...plain } = row;
      return plain;
    },
    async update(patch) {
      Object.assign(row, patch);
      return row;
    },
    async reload() {
      return row;
    },
  };
  return row;
};

const matches = (row, where) =>
  Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      // Only the operators these tests actually rely on.
      const ne = Object.getOwnPropertySymbols(cond).find((s) => s.description === "ne");
      if (ne) return row[key] !== cond[ne];
      return true;
    }
    return row[key] === cond;
  });

const tenantDbStub = () => ({
  CalendarMeeting: {
    async create(values) {
      const row = makeRow({ id: nextMeetingId++, status: "scheduled", ...values });
      meetingRows.push(row);
      return row;
    },
    async findOne({ where }) {
      return meetingRows.find((r) => matches(r, where)) || null;
    },
    async findAll({ where }) {
      return meetingRows.filter((r) => matches(r, where));
    },
    async update(patch, { where }) {
      const hit = meetingRows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, patch));
      return [hit.length];
    },
  },
  CalendarConnection: {
    async findAll() {
      return connections;
    },
    async findOne() {
      return connections[0] || null;
    },
  },
  User: {
    async findByPk() {
      return { id: 1, first_name: "Ada", last_name: "Byron", email: "ada@elitepic.co.uk" };
    },
  },
});

const makeConnection = (provider, lastSync = null) =>
  makeRow({
    id: provider === "microsoft" ? 10 : 11,
    user_id: 1,
    provider,
    is_active: true,
    last_successful_sync: lastSync,
  });

let currentDb;
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { userId: 1, id: 1, role_name: "caseworker", organisation_id: 1 };
  req.tenantDb = currentDb;
  next();
});
app.get("/api/teams-meetings", controller.getTeamsMeetings);
app.post("/api/teams-meetings", controller.createTeamsMeeting);
app.post("/api/teams-meetings/sync", controller.syncTeamsMeetings);
app.delete("/api/teams-meetings/:id", controller.cancelTeamsMeeting);

// Invite mail is dispatched fire-and-forget so a slow SMTP relay cannot outlast
// the request; give those microtasks a turn before asserting on the mailbox.
const flushMail = () => new Promise((resolve) => setImmediate(resolve));

describe("Calendar sync + meeting invitations", () => {
  beforeEach(() => {
    meetingRows = [];
    nextMeetingId = 1;
    connections = [];
    outlookEvents.length = 0;
    googleEvents.length = 0;
    sentMail.length = 0;
    currentDb = tenantDbStub();
    microsoftMeeting.listOutlookCalendarEvents.mock.resetCalls();
    microsoftMeeting.createTeamsCalendarMeeting.mock.resetCalls();
    googleMeeting.listGoogleCalendarEvents.mock.resetCalls();
    googleMeeting.createGoogleMeetMeeting.mock.resetCalls();
    mailService.sendTransactionalEmail.mock.resetCalls();
  });

  it("pulls meetings that already exist in Outlook into the calendar", async () => {
    connections = [makeConnection("microsoft")];
    outlookEvents.push({
      externalId: "ms-existing-1",
      subject: "Sponsor compliance review",
      description: "Quarterly check",
      startTime: new Date("2026-09-01T10:00:00Z"),
      endTime: new Date("2026-09-01T11:00:00Z"),
      location: "Microsoft Teams",
      joinUrl: "https://teams.microsoft.com/l/meetup-join/existing",
      attendees: ["sponsor@example.com"],
      isCancelled: false,
    });

    const res = await request(app).post("/api/teams-meetings/sync");

    assert.equal(res.status, 200);
    assert.equal(res.body.data.created, 1);
    assert.equal(meetingRows.length, 1);
    assert.equal(meetingRows[0].subject, "Sponsor compliance review");
    assert.equal(meetingRows[0].meeting_provider, "microsoft");
    assert.equal(meetingRows[0].external_event_id, "ms-existing-1");
  });

  it("reports the real reason when nothing is connected instead of a silent zero", async () => {
    connections = [];
    const res = await request(app).post("/api/teams-meetings/sync");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.connected, false);
    assert.match(res.body.message, /Connect Microsoft or Google/);
  });

  it("updates an already-synced meeting rather than duplicating it", async () => {
    connections = [makeConnection("microsoft")];
    outlookEvents.push({
      externalId: "ms-existing-1",
      subject: "Original title",
      startTime: new Date("2026-09-01T10:00:00Z"),
      endTime: new Date("2026-09-01T11:00:00Z"),
      attendees: [],
      isCancelled: false,
    });
    await request(app).post("/api/teams-meetings/sync");

    outlookEvents[0].subject = "Renamed in Outlook";
    const res = await request(app).post("/api/teams-meetings/sync");

    assert.equal(meetingRows.length, 1, "must not create a second row for the same event");
    assert.equal(res.body.data.updated, 1);
    assert.equal(meetingRows[0].subject, "Renamed in Outlook");
  });

  it("syncs both providers when both are connected", async () => {
    connections = [makeConnection("microsoft"), makeConnection("google")];
    outlookEvents.push({
      externalId: "ms-1",
      subject: "Teams call",
      startTime: new Date("2026-09-02T09:00:00Z"),
      endTime: new Date("2026-09-02T09:30:00Z"),
      attendees: [],
      isCancelled: false,
    });
    googleEvents.push({
      externalId: "g-1",
      subject: "Meet call",
      startTime: new Date("2026-09-03T09:00:00Z"),
      endTime: new Date("2026-09-03T09:30:00Z"),
      attendees: [],
      isCancelled: false,
    });

    const res = await request(app).post("/api/teams-meetings/sync");

    assert.equal(res.body.data.created, 2);
    assert.equal(res.body.data.providers.length, 2);
    assert.deepEqual(
      meetingRows.map((r) => r.meeting_provider).sort(),
      ["google", "microsoft"],
    );
  });

  it("keeps serving the calendar when a provider errors", async () => {
    connections = [makeConnection("microsoft")];
    microsoftMeeting.listOutlookCalendarEvents.mock.mockImplementationOnce(async () => {
      throw new Error("Graph 503");
    });

    const res = await request(app).get("/api/teams-meetings");

    assert.equal(res.status, 200, "a provider outage must not 500 the calendar");
    assert.ok(Array.isArray(res.body.data.meetings));
  });

  it("does not re-hit the provider on every calendar load", async () => {
    connections = [makeConnection("microsoft", new Date())];
    await request(app).get("/api/teams-meetings");
    assert.equal(
      microsoftMeeting.listOutlookCalendarEvents.mock.calls.length,
      0,
      "a sync inside the cooldown window should be skipped",
    );
  });

  it("emails the join link to every attendee when a meeting is created", async () => {
    connections = [makeConnection("microsoft")];

    const res = await request(app)
      .post("/api/teams-meetings")
      .send({
        subject: "Case review",
        start_time: "2026-09-10T10:00:00Z",
        end_time: "2026-09-10T11:00:00Z",
        meeting_provider: "microsoft",
        attendees: [{ email: "persona@gmail.com", type: "required" }],
      });

    assert.equal(res.status, 201);
    await flushMail();

    const recipients = sentMail.map((m) => m.to);
    assert.ok(recipients.includes("persona@gmail.com"), `attendee not emailed: ${recipients}`);
    assert.ok(recipients.includes("ada@elitepic.co.uk"), "organiser should get a copy");

    const attendeeMail = sentMail.find((m) => m.to === "persona@gmail.com");
    assert.match(attendeeMail.subject, /Meeting invitation: Case review/);
    assert.ok(
      attendeeMail.html.includes("https://teams.microsoft.com/l/meetup-join/abc"),
      "the join link must appear in the email body",
    );
  });

  it("creates the Teams meeting as a calendar event with its attendees", async () => {
    connections = [makeConnection("microsoft")];

    await request(app)
      .post("/api/teams-meetings")
      .send({
        subject: "Case review",
        start_time: "2026-09-10T10:00:00Z",
        end_time: "2026-09-10T11:00:00Z",
        meeting_provider: "microsoft",
        attendees: ["persona@gmail.com", "second@example.com"],
      });

    const call = microsoftMeeting.createTeamsCalendarMeeting.mock.calls[0];
    assert.ok(call, "must use the calendar-event endpoint, not /me/onlineMeetings");
    assert.deepEqual(call.arguments[0].attendees, ["persona@gmail.com", "second@example.com"]);
  });

  it("passes attendees through to Google Meet", async () => {
    await request(app)
      .post("/api/teams-meetings")
      .send({
        subject: "Google call",
        start_time: "2026-09-11T10:00:00Z",
        end_time: "2026-09-11T11:00:00Z",
        meeting_provider: "google",
        attendees: ["persona@gmail.com"],
      });

    const call = googleMeeting.createGoogleMeetMeeting.mock.calls[0];
    assert.ok(call);
    assert.deepEqual(call.arguments[0].attendees, ["persona@gmail.com"]);
  });

  it("emails plain in-app meetings too, with no provider connected", async () => {
    const res = await request(app)
      .post("/api/teams-meetings")
      .send({
        subject: "Office catch-up",
        start_time: "2026-09-12T10:00:00Z",
        end_time: "2026-09-12T11:00:00Z",
        meeting_provider: "none",
        location: "Head office",
        attendees: ["persona@gmail.com"],
      });

    assert.equal(res.status, 201);
    await flushMail();
    assert.ok(sentMail.some((m) => m.to === "persona@gmail.com"));
  });

  it("tells attendees when a meeting is cancelled", async () => {
    const created = await request(app)
      .post("/api/teams-meetings")
      .send({
        subject: "Case review",
        start_time: "2026-09-13T10:00:00Z",
        end_time: "2026-09-13T11:00:00Z",
        attendees: ["persona@gmail.com"],
      });
    await flushMail();
    sentMail.length = 0;

    await request(app).delete(`/api/teams-meetings/${created.body.data.id}`);
    await flushMail();

    const mail = sentMail.find((m) => m.to === "persona@gmail.com");
    assert.ok(mail, "attendee must be told the meeting is off");
    assert.match(mail.subject, /Meeting cancelled/);
  });

  it("skips malformed attendee addresses without dropping the valid ones", async () => {
    await request(app)
      .post("/api/teams-meetings")
      .send({
        subject: "Mixed list",
        start_time: "2026-09-14T10:00:00Z",
        end_time: "2026-09-14T11:00:00Z",
        attendees: ["not-an-email", "persona@gmail.com"],
      });
    await flushMail();

    assert.ok(sentMail.some((m) => m.to === "persona@gmail.com"));
    assert.ok(!sentMail.some((m) => m.to === "not-an-email"));
  });
});
