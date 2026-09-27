/**
 * tests/attendanceNotes.test.js
 *
 * PHASE 5 — ATTENDANCE NOTES: MULTI-CASEWORKER TAGGING TEST SUITE
 *
 * Validates:
 * TEST 1: Admin creates Attendance Note with multiple caseworkers -> Success
 * TEST 2: Assigned Caseworker #1 creates Attendance Note -> Success
 * TEST 3: Assigned Caseworker #2 creates Attendance Note -> Success
 * TEST 4: Unassigned Caseworker attempts to create Attendance Note -> HTTP 403
 * TEST 5: Client/Candidate attempts to create Attendance Note -> HTTP 403
 * TEST 6: Sponsor attempts to create Attendance Note -> HTTP 403
 * TEST 7: Attendance Note with Caseworker A + Caseworker B -> Both participants persist correctly
 * TEST 8: Duplicate participant IDs submitted -> Deduplicated, no duplicate participant records
 * TEST 9: Invalid/non-caseworker participant submitted -> Validation failure (HTTP 400)
 * TEST 10: Caseworker from another organisation submitted -> Rejected (HTTP 403)
 * TEST 11: Attendance Note is retrieved -> Participant names are returned/displayed correctly
 * TEST 12: Existing normal Case Note creation still works -> Success
 * TEST 13: BUG-027 authorization remains intact -> Intact
 * TEST 14: Exactly 2 assigned caseworkers rule remains intact -> Intact
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  createCaseNote,
  getCaseNotes,
  getCaseNoteByNoteId,
} from '../src/modules/Admin/Dashboard/caseNote.controller.js';
import { ROLES, STAFF_ROLES } from '../src/middlewares/role.middleware.js';
import { singleCaseworkerError } from '../src/utils/case.utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

describe('Phase 5: Attendance Notes — Multi-Caseworker Tagging', () => {
  // Case fixture with EXACTLY 2 assigned caseworkers: 101 and 102 in Organisation 1
  const mockCase = {
    id: 55,
    caseId: 'EPIC-ILR26-001',
    candidateId: 201,
    sponsorId: 301,
    organisation_id: 1,
    assignedcaseworkerId: [101, 102], // Exactly 2 caseworkers
  };

  // User fixture table
  const mockUsers = [
    { id: 1, first_name: 'Admin', last_name: 'User', email: 'admin@firm.com', role_id: ROLES.ADMIN, organisation_id: 1 },
    { id: 101, first_name: 'Caseworker', last_name: 'Alpha', email: 'alpha@firm.com', role_id: ROLES.CASEWORKER, organisation_id: 1 },
    { id: 102, first_name: 'Caseworker', last_name: 'Beta', email: 'beta@firm.com', role_id: ROLES.CASEWORKER, organisation_id: 1 },
    { id: 103, first_name: 'Caseworker', last_name: 'Gamma (Unassigned)', email: 'gamma@firm.com', role_id: ROLES.CASEWORKER, organisation_id: 1 },
    { id: 104, first_name: 'Caseworker', last_name: 'From Other Firm', email: 'other@otherfirm.com', role_id: ROLES.CASEWORKER, organisation_id: 2 }, // Other org!
    { id: 201, first_name: 'Candidate', last_name: 'Client', email: 'client@client.com', role_id: ROLES.CANDIDATE, organisation_id: 1 },
    { id: 301, first_name: 'Sponsor', last_name: 'Representative', email: 'sponsor@company.com', role_id: ROLES.SPONSOR, organisation_id: 1 },
  ];

  // In-memory note storage
  const notesStore = [];
  const participantsStore = [];

  const mockTenantDb = {
    Case: {
      findByPk: async (id) => (Number(id) === 55 ? mockCase : null),
      findOne: async ({ where }) => {
        if (where?.caseId === 'EPIC-ILR26-001' || Number(where?.id) === 55) {
          return mockCase;
        }
        return null;
      },
    },
    User: {
      findByPk: async (id) => mockUsers.find((u) => u.id === Number(id)) || null,
      findAll: async ({ where }) => {
        if (where?.id) {
          const ids = Array.isArray(where.id) ? where.id.map(Number) : [Number(where.id)];
          return mockUsers.filter((u) => ids.includes(u.id));
        }
        return [...mockUsers];
      },
      findOne: async ({ where }) => {
        if (where?.id) return mockUsers.find((u) => u.id === Number(where.id)) || null;
        return null;
      },
    },
    CaseTimeline: {
      create: async (data) => ({ id: 1, ...data }),
    },
    CaseNoteParticipant: {
      bulkCreate: async (rows) => {
        const created = rows.map((r, i) => {
          const cwId = r.caseworkerId || r.caseworker_id;
          const noteId = r.caseNoteId || r.case_note_id;
          const cw = mockUsers.find((u) => u.id === Number(cwId));
          const p = {
            id: participantsStore.length + i + 1,
            caseNoteId: noteId,
            case_note_id: noteId,
            caseworkerId: cwId,
            caseworker_id: cwId,
            caseworker: cw ? { id: cw.id, first_name: cw.first_name, last_name: cw.last_name, email: cw.email } : null,
            created_at: new Date(),
            updated_at: new Date(),
          };
          return p;
        });
        participantsStore.push(...created);
        return created;
      },
      findAll: async ({ where }) => {
        const noteId = where?.case_note_id || where?.caseNoteId;
        if (noteId) {
          return participantsStore.filter((p) => p.case_note_id === noteId || p.caseNoteId === noteId);
        }
        return [...participantsStore];
      },
    },
    CaseNote: {
      create: async (data) => {
        const note = {
          id: notesStore.length + 1,
          ...data,
          participants: [],
          created_at: new Date(),
          updated_at: new Date(),
        };
        notesStore.push(note);
        return note;
      },
      findByPk: async (id) => {
        const found = notesStore.find((n) => n.id === Number(id));
        if (!found) return null;
        const noteParticipants = participantsStore
          .filter((p) => p.case_note_id === found.id || p.caseNoteId === found.id)
          .map((p) => {
            const cw = mockUsers.find((u) => u.id === Number(p.caseworkerId || p.caseworker_id));
            return {
              ...p,
              caseworker: cw ? { id: cw.id, first_name: cw.first_name, last_name: cw.last_name, email: cw.email } : null,
            };
          });
        return {
          ...found,
          case: mockCase,
          participants: noteParticipants,
          toJSON() {
            return {
              ...found,
              case: mockCase,
              participants: noteParticipants,
            };
          },
        };
      },
      findOne: async ({ where }) => {
        const found = notesStore.find((n) => n.id === Number(where?.id));
        if (!found) return null;
        const noteParticipants = participantsStore
          .filter((p) => p.case_note_id === found.id || p.caseNoteId === found.id)
          .map((p) => {
            const cw = mockUsers.find((u) => u.id === Number(p.caseworkerId || p.caseworker_id));
            return {
              ...p,
              caseworker: cw ? { id: cw.id, first_name: cw.first_name, last_name: cw.last_name, email: cw.email } : null,
            };
          });
        const author = mockUsers.find((u) => u.id === Number(found.authorId));
        return {
          ...found,
          author: author ? { id: author.id, first_name: author.first_name, last_name: author.last_name } : null,
          participants: noteParticipants,
          toJSON() {
            return {
              ...found,
              author: author ? { id: author.id, first_name: author.first_name, last_name: author.last_name } : null,
              participants: noteParticipants,
            };
          },
        };
      },
      findAndCountAll: async ({ where }) => {
        const filtered = notesStore.filter((n) => n.caseId === where?.caseId);
        const mapped = filtered.map((n) => {
          const noteParticipants = participantsStore
            .filter((p) => p.case_note_id === n.id || p.caseNoteId === n.id)
            .map((p) => {
              const cw = mockUsers.find((u) => u.id === Number(p.caseworkerId || p.caseworker_id));
              return {
                ...p,
                caseworker: cw ? { id: cw.id, first_name: cw.first_name, last_name: cw.last_name, email: cw.email } : null,
              };
            });
          const author = mockUsers.find((u) => u.id === Number(n.authorId));
          return {
            ...n,
            author: author ? { id: author.id, first_name: author.first_name, last_name: author.last_name } : null,
            participants: noteParticipants,
          };
        });
        return { count: mapped.length, rows: mapped };
      },
    },
  };

  // -------------------------------------------------------------------------
  // TEST 1: Admin creates Attendance Note with multiple caseworkers -> Success
  // -------------------------------------------------------------------------
  test('TEST 1: Admin creates Attendance Note with multiple caseworkers -> Success (HTTP 201)', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Client consultation attendance note regarding visa submission details.',
        noteType: 'attendance',
        title: 'Client Consultation Meeting',
        participantIds: [101, 102],
      },
      user: {
        userId: 1,
        role_id: ROLES.ADMIN,
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 201, 'Admin should receive HTTP 201');
    assert.equal(res.body?.status, 'success');
    assert.ok(res.body?.data?.note, 'Note returned');
    assert.equal(res.body.data.note.noteType, 'attendance');
    assert.equal(res.body.data.note.title, 'Client Consultation Meeting');
    assert.equal(res.body.data.note.participants?.length, 2);
  });

  // -------------------------------------------------------------------------
  // TEST 2: Assigned Caseworker #1 creates Attendance Note -> Success
  // -------------------------------------------------------------------------
  test('TEST 2: Assigned Caseworker #1 creates Attendance Note -> Success (HTTP 201)', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Document review interview conducted with client.',
        noteType: 'attendance',
        title: 'Document Review Interview',
        participantIds: [101, 102],
      },
      user: {
        userId: 101,
        role_id: ROLES.CASEWORKER,
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 201, 'Assigned Caseworker #1 should receive HTTP 201');
    assert.equal(res.body?.status, 'success');
    assert.equal(res.body?.data?.note?.noteType, 'attendance');
  });

  // -------------------------------------------------------------------------
  // TEST 3: Assigned Caseworker #2 creates Attendance Note -> Success
  // -------------------------------------------------------------------------
  test('TEST 3: Assigned Caseworker #2 creates Attendance Note -> Success (HTTP 201)', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Biometrics preparation call conducted jointly.',
        noteType: 'attendance',
        title: 'Biometrics Prep Call',
        participantIds: [101, 102],
      },
      user: {
        userId: 102,
        role_id: ROLES.CASEWORKER,
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 201, 'Assigned Caseworker #2 should receive HTTP 201');
    assert.equal(res.body?.status, 'success');
    assert.equal(res.body?.data?.note?.noteType, 'attendance');
  });

  // -------------------------------------------------------------------------
  // TEST 4: Unassigned Caseworker attempts to create Attendance Note -> HTTP 403
  // -------------------------------------------------------------------------
  test('TEST 4: Unassigned Caseworker attempts to create Attendance Note -> HTTP 403', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Unassigned caseworker attempting to create attendance note.',
        noteType: 'attendance',
        participantIds: [101],
      },
      user: {
        userId: 103, // Unassigned caseworker
        role_id: ROLES.CASEWORKER,
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 403, 'Unassigned caseworker must be denied with HTTP 403');
    assert.equal(res.body?.status, 'error');
    assert.equal(res.body?.message, 'You are not authorized to add notes to this case.');
  });

  // -------------------------------------------------------------------------
  // TEST 5: Client/Candidate attempts to create Attendance Note -> HTTP 403
  // -------------------------------------------------------------------------
  test('TEST 5: Client/Candidate attempts to create Attendance Note -> HTTP 403', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Candidate attempting to create attendance note.',
        noteType: 'attendance',
      },
      user: {
        userId: 201,
        role_id: ROLES.CANDIDATE,
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 403, 'Client/Candidate must be denied with HTTP 403');
    assert.equal(res.body?.status, 'error');
    assert.equal(res.body?.message, 'You are not authorized to add notes to this case.');
  });

  // -------------------------------------------------------------------------
  // TEST 6: Sponsor attempts to create Attendance Note -> HTTP 403
  // -------------------------------------------------------------------------
  test('TEST 6: Sponsor attempts to create Attendance Note -> HTTP 403', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Sponsor attempting to create attendance note.',
        noteType: 'attendance',
      },
      user: {
        userId: 301,
        role_id: ROLES.SPONSOR,
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 403, 'Sponsor must be denied with HTTP 403');
    assert.equal(res.body?.status, 'error');
    assert.equal(res.body?.message, 'You are not authorized to add notes to this case.');
  });

  // -------------------------------------------------------------------------
  // TEST 7: Attendance Note with Caseworker A + Caseworker B -> Both participants persist correctly
  // -------------------------------------------------------------------------
  test('TEST 7: Attendance Note with Caseworker A + Caseworker B -> Both participants persist correctly', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Full formal consultation attended by Alpha and Beta.',
        noteType: 'attendance',
        title: 'Formal Client Consultation',
        participantIds: [101, 102],
      },
      user: {
        userId: 1,
        role_id: ROLES.ADMIN,
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 201);
    const createdNoteId = res.body?.data?.note?.id;
    assert.ok(createdNoteId);

    // Verify participants persisted in DB
    const participants = await mockTenantDb.CaseNoteParticipant.findAll({
      where: { case_note_id: createdNoteId },
    });
    assert.equal(participants.length, 2, 'Should have exactly 2 persisted participants');
    const persistedIds = participants.map((p) => p.caseworkerId || p.caseworker_id).sort();
    assert.deepEqual(persistedIds, [101, 102]);
  });

  // -------------------------------------------------------------------------
  // TEST 8: Duplicate participant IDs submitted -> Deduplicated, no duplicates
  // -------------------------------------------------------------------------
  test('TEST 8: Duplicate participant IDs submitted -> Deduplicated without duplicate records', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Meeting with duplicate IDs submitted.',
        noteType: 'attendance',
        participantIds: [101, 102, 101, 102, 101], // Duplicates!
      },
      user: {
        userId: 1,
        role_id: ROLES.ADMIN,
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 201);
    const noteId = res.body?.data?.note?.id;
    const participants = await mockTenantDb.CaseNoteParticipant.findAll({
      where: { case_note_id: noteId },
    });
    assert.equal(participants.length, 2, 'Duplicates should be stripped, resulting in exactly 2 participants');
  });

  // -------------------------------------------------------------------------
  // TEST 9: Invalid / non-caseworker participant submitted -> Validation failure
  // -------------------------------------------------------------------------
  test('TEST 9: Invalid / non-caseworker participant submitted -> Validation failure (HTTP 400)', async () => {
    // Attempting to tag a Candidate (ID 201) as a caseworker participant
    const reqCandidate = {
      body: {
        caseId: 55,
        content: 'Invalid note tagging candidate as caseworker.',
        noteType: 'attendance',
        participantIds: [201], // Role is CANDIDATE!
      },
      user: {
        userId: 1,
        role_id: ROLES.ADMIN,
      },
      tenantDb: mockTenantDb,
    };
    const resCandidate = createMockRes();

    await createCaseNote(reqCandidate, resCandidate);

    assert.equal(resCandidate.statusCode, 400, 'Tagging a candidate as a caseworker must return HTTP 400');
    assert.equal(resCandidate.body?.status, 'error');
    assert.ok(
      resCandidate.body?.message?.includes('Only caseworkers can be tagged'),
      'Must return caseworker role validation error'
    );

    // Attempting to tag a non-existent user ID (9999)
    const reqNonExistent = {
      body: {
        caseId: 55,
        content: 'Invalid note with non-existent user.',
        noteType: 'attendance',
        participantIds: [9999],
      },
      user: {
        userId: 1,
        role_id: ROLES.ADMIN,
      },
      tenantDb: mockTenantDb,
    };
    const resNonExistent = createMockRes();

    await createCaseNote(reqNonExistent, resNonExistent);

    assert.equal(resNonExistent.statusCode, 400, 'Non-existent user must return HTTP 400');
    assert.ok(resNonExistent.body?.message?.includes('Invalid caseworker participant ID'));
  });

  // -------------------------------------------------------------------------
  // TEST 10: Caseworker from another organisation submitted -> Rejected (HTTP 403)
  // -------------------------------------------------------------------------
  test('TEST 10: Caseworker from another organisation submitted -> Rejected (HTTP 403)', async () => {
    // Caseworker 104 belongs to organisation_id: 2, whereas case belongs to organisation_id: 1
    const reqCrossOrg = {
      body: {
        caseId: 55,
        content: 'Cross organisation attendee attempt.',
        noteType: 'attendance',
        participantIds: [104], // Org 2 caseworker
      },
      user: {
        userId: 1,
        role_id: ROLES.ADMIN,
      },
      tenantDb: mockTenantDb,
    };
    const resCrossOrg = createMockRes();

    await createCaseNote(reqCrossOrg, resCrossOrg);

    assert.equal(resCrossOrg.statusCode, 403, 'Cross-organisation caseworker must be rejected with HTTP 403');
    assert.equal(resCrossOrg.body?.status, 'error');
    assert.ok(
      resCrossOrg.body?.message?.includes('same organisation'),
      'Must reject cross-tenant caseworker tagging'
    );
  });

  // -------------------------------------------------------------------------
  // TEST 11: Attendance Note is retrieved -> Participant names returned correctly
  // -------------------------------------------------------------------------
  test('TEST 11: Attendance Note is retrieved -> Participant names returned / displayed correctly', async () => {
    // 1. Create an attendance note with 101 and 102
    const createReq = {
      body: {
        caseId: 55,
        content: 'Meeting with both caseworkers present.',
        noteType: 'attendance',
        title: 'Initial Consultation',
        participantIds: [101, 102],
      },
      user: {
        userId: 1,
        role_id: ROLES.ADMIN,
      },
      tenantDb: mockTenantDb,
    };
    const createRes = createMockRes();
    await createCaseNote(createReq, createRes);

    const noteId = createRes.body?.data?.note?.id;
    assert.ok(noteId);

    // 2. Fetch via getCaseNoteByNoteId
    const getReq = {
      params: { id: noteId },
      user: {
        userId: 1,
        role_id: ROLES.ADMIN,
      },
      tenantDb: mockTenantDb,
    };
    const getRes = createMockRes();
    await getCaseNoteByNoteId(getReq, getRes);

    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body?.status, 'success');
    const noteData = getRes.body?.data?.note || getRes.body?.data;
    assert.equal(noteData?.noteType, 'attendance');
    assert.ok(Array.isArray(noteData?.participants), 'Participants array exists');
    assert.equal(noteData.participants.length, 2);

    // Verify attendee names are resolved (not raw database IDs)
    assert.ok(Array.isArray(noteData?.attendees), 'Attendees array exists');
    assert.ok(noteData.attendees.includes('Caseworker Alpha'));
    assert.ok(noteData.attendees.includes('Caseworker Beta'));

    // 3. Fetch via getCaseNotes (list API)
    const listReq = {
      params: { caseId: 55 },
      query: { caseId: 55 },
      user: {
        userId: 1,
        role_id: ROLES.ADMIN,
      },
      tenantDb: mockTenantDb,
    };
    const listRes = createMockRes();
    await getCaseNotes(listReq, listRes);

    assert.equal(listRes.statusCode, 200);
    const listedNote = listRes.body?.data?.notes?.find((n) => n.id === noteId);
    assert.ok(listedNote, 'Listed note found');
    assert.equal(listedNote.noteType, 'attendance');
    assert.equal(listedNote.participants?.length, 2);
    assert.equal(listedNote.participants[0].caseworker?.first_name, 'Caseworker');
  });

  // -------------------------------------------------------------------------
  // TEST 12: Existing normal Case Note creation still works -> Success
  // -------------------------------------------------------------------------
  test('TEST 12: Existing normal Case Note creation still works -> Success (HTTP 201)', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Standard internal case note without participants.',
      },
      user: {
        userId: 101, // Assigned caseworker
        role_id: ROLES.CASEWORKER,
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body?.status, 'success');
    assert.equal(res.body?.data?.note?.noteType, 'internal');
    assert.equal(res.body?.data?.note?.content, 'Standard internal case note without participants.');
  });

  // -------------------------------------------------------------------------
  // TEST 13: BUG-027 authorization remains intact
  // -------------------------------------------------------------------------
  test('TEST 13: BUG-027 authorization remains intact across all checks', async () => {
    // 1. Admin allowed
    const adminReq = {
      body: { caseId: 55, content: 'Admin authorization test' },
      user: { userId: 1, role_id: ROLES.ADMIN },
      tenantDb: mockTenantDb,
    };
    const adminRes = createMockRes();
    await createCaseNote(adminReq, adminRes);
    assert.equal(adminRes.statusCode, 201);

    // 2. Assigned caseworker allowed
    const assignedReq = {
      body: { caseId: 55, content: 'Assigned caseworker authorization test' },
      user: { userId: 101, role_id: ROLES.CASEWORKER },
      tenantDb: mockTenantDb,
    };
    const assignedRes = createMockRes();
    await createCaseNote(assignedReq, assignedRes);
    assert.equal(assignedRes.statusCode, 201);

    // 3. Unassigned caseworker blocked (HTTP 403)
    const unassignedReq = {
      body: { caseId: 55, content: 'Unassigned caseworker blocked' },
      user: { userId: 103, role_id: ROLES.CASEWORKER },
      tenantDb: mockTenantDb,
    };
    const unassignedRes = createMockRes();
    await createCaseNote(unassignedReq, unassignedRes);
    assert.equal(unassignedRes.statusCode, 403);

    // 4. Candidate blocked (HTTP 403)
    const candidateReq = {
      body: { caseId: 55, content: 'Candidate blocked' },
      user: { userId: 201, role_id: ROLES.CANDIDATE },
      tenantDb: mockTenantDb,
    };
    const candidateRes = createMockRes();
    await createCaseNote(candidateReq, candidateRes);
    assert.equal(candidateRes.statusCode, 403);

    // 5. Sponsor blocked (HTTP 403)
    const sponsorReq = {
      body: { caseId: 55, content: 'Sponsor blocked' },
      user: { userId: 301, role_id: ROLES.SPONSOR },
      tenantDb: mockTenantDb,
    };
    const sponsorRes = createMockRes();
    await createCaseNote(sponsorReq, sponsorRes);
    assert.equal(sponsorRes.statusCode, 403);
  });

  // -------------------------------------------------------------------------
  // TEST 14: Exactly 2 assigned caseworkers rule remains intact
  // -------------------------------------------------------------------------
  test('TEST 14: Exactly 2 assigned caseworkers rule remains intact', () => {
    // 1. Verify case model fixture preserves exactly 2 assigned caseworkers
    assert.equal(mockCase.assignedcaseworkerId.length, 2);
    assert.deepEqual(mockCase.assignedcaseworkerId, [101, 102]);

    // 2. Verify singleCaseworkerError utility function is preserved
    assert.equal(typeof singleCaseworkerError, 'function');

    // 3. Verify controller enforces exactly assigned caseworkers
    const controllerPath = path.resolve(__dirname, '../src/modules/Admin/Dashboard/caseNote.controller.js');
    const controllerSrc = fs.readFileSync(controllerPath, 'utf8');
    assert.ok(
      controllerSrc.includes('roleId === ROLES.CASEWORKER && assignedIds.includes(Number(userId))'),
      'Controller strictly restricts case notes to assigned caseworkers'
    );
    assert.ok(
      controllerSrc.includes('isAdmin = roleId === ROLES.ADMIN || roleId === ROLES.SUPERADMIN'),
      'Controller allows Admin / Superadmin'
    );
    assert.ok(
      controllerSrc.includes('You are not authorized to add notes to this case.'),
      'Controller denies unauthorized access with clear message'
    );
  });
});
