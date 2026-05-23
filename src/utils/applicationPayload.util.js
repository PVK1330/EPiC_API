/**
 * Sanitize candidate application payloads before DB writes.
 * PostgreSQL ENUM columns reject ""; DATE columns reject invalid strings.
 */

export const APPLICATION_FIELDS = [
  'firstName', 'lastName', 'email', 'contactNumber',
  'applicationType', 'gender', 'relationshipStatus', 'address', 'contactNumber2',
  'previousFullAddress', 'previousAddress', 'startDate', 'endDate',
  'nationality', 'birthCountry', 'placeOfBirth', 'dob',
  'passportNumber', 'issuingAuthority', 'issueDate', 'expiryDate', 'passportAvailable',
  'nationalIdCardNumber', 'nationalIdNumber',
  'idIssuingAuthorityCard', 'idIssuingAuthorityNational',
  'otherNationality', 'ukLicense', 'medicalTreatment', 'ukStayDuration',
  'parentName', 'parentRelation', 'parentDob', 'parentNationality', 'sameNationality',
  'parent2Name', 'parent2Relation', 'parent2Dob', 'parent2Nationality', 'parent2SameNationality',
  'illegalEntry', 'overstayed', 'breach', 'falseInfo', 'otherBreach',
  'refusedVisa', 'refusedEntry', 'refusedPermission', 'refusedAsylum',
  'deported', 'removed', 'requiredToLeave', 'banned',
  'visitedOther', 'countryVisited', 'visitReason', 'entryDate', 'leaveDate',
  'visaType', 'brpNumber', 'visaEndDate', 'niNumber', 'sponsored', 'englishProof',
  'customResponses',
];

const DATE_FIELDS = new Set([
  'dob', 'issueDate', 'expiryDate',
  'startDate', 'endDate',
  'parentDob', 'parent2Dob',
  'entryDate', 'leaveDate',
  'visaEndDate',
]);

const ENUM_FIELDS = new Set([
  'applicationType',
  'passportAvailable',
  'ukLicense',
  'medicalTreatment',
  'sameNationality',
  'parent2SameNationality',
  'illegalEntry',
  'overstayed',
  'breach',
  'falseInfo',
  'otherBreach',
  'refusedVisa',
  'refusedEntry',
  'refusedPermission',
  'refusedAsylum',
  'deported',
  'removed',
  'requiredToLeave',
  'banned',
  'visitedOther',
  'sponsored',
  'englishProof',
]);

/**
 * Pick permitted application fields and sanitize DATE / ENUM values for Sequelize/Postgres.
 */
export function sanitizeApplicationPayload(body) {
  const payload = {};
  const source = body && typeof body === 'object' ? body : {};

  for (const key of APPLICATION_FIELDS) {
    if (source[key] === undefined) continue;

    const v = source[key];

    if (DATE_FIELDS.has(key)) {
      if (!v || (typeof v === 'string' && v.trim() === '')) {
        payload[key] = null;
      } else {
        const parsed = new Date(v);
        payload[key] = Number.isNaN(parsed.getTime()) ? null : parsed;
      }
    } else if (ENUM_FIELDS.has(key)) {
      payload[key] = (v === null || v === undefined || String(v).trim() === '')
        ? null
        : v;
    } else {
      payload[key] = v;
    }
  }

  return payload;
}
