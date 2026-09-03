/**
 * Sanitize candidate application payloads before DB writes.
 *
 * PostgreSQL rejects "" for ENUM columns, invalid strings for DATE columns and —
 * with a raw "value too long for type character varying(n)" error — anything
 * longer than a VARCHAR(n) column. That last one reached the Edit Client form as
 * a bare "Internal server error" (BUG-020). Everything here now fails with a 400
 * that names the field and the limit instead of letting the database throw.
 */

export const APPLICATION_FIELDS = [
  'firstName', 'lastName', 'email', 'contactNumber',
  'applicationType', 'gender', 'relationshipStatus', 'address',
  'addressStartDate', 'housingStatus', 'landlordName', 'landlordContactNumber', 'landlordEmail', 'landlordAddress',
  'contactNumber2',
  'previousFullAddress', 'previousAddress', 'previousAddresses', 'startDate', 'endDate',
  'nationality', 'nationalities', 'birthCountry', 'placeOfBirth', 'dob',
  'passportNumber', 'issuingAuthority', 'issueDate', 'expiryDate', 'passportAvailable',
  'nationalIdCardNumber', 'nationalIdNumber',
  'idIssuingAuthorityCard', 'idIssuingAuthorityNational',
  'otherNationality', 'ukLicense', 'ukLicenseNumber', 'medicalTreatment', 'ukStayDuration',
  'parentName', 'parentRelation', 'parentDob', 'parentNationality', 'sameNationality',
  'parent2Name', 'parent2Relation', 'parent2Dob', 'parent2Nationality', 'parent2SameNationality',
  'illegalEntry', 'overstayed', 'breach', 'falseInfo', 'otherBreach',
  'refusedVisa', 'refusedEntry', 'refusedPermission', 'refusedAsylum',
  'deported', 'removed', 'requiredToLeave', 'banned',
  'visitedOther', 'countryVisited', 'visitReason', 'entryDate', 'leaveDate',
  'visaType', 'brpNumber', 'visaEndDate', 'niNumber', 'sponsored', 'englishProof',
  'customResponses',
];

// Human labels used in validation messages (match the application form labels).
export const APPLICATION_FIELD_LABELS = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  contactNumber: 'Contact number',
  applicationType: 'Application type',
  gender: 'Gender',
  relationshipStatus: 'Relationship status',
  address: 'Current address',
  addressStartDate: 'Move-in / start date',
  housingStatus: 'Housing status',
  landlordName: 'Landlord name',
  landlordContactNumber: 'Landlord contact number',
  landlordEmail: 'Landlord email',
  landlordAddress: 'Landlord address',
  contactNumber2: 'Alternate contact number',
  previousFullAddress: 'Previous full address',
  previousAddress: 'Previous address',
  previousAddresses: 'Previous addresses',
  startDate: 'Address start date',
  endDate: 'Address end date',
  nationality: 'Country of nationality',
  nationalities: 'Nationalities',
  birthCountry: 'Country of birth',
  placeOfBirth: 'Place of birth',
  dob: 'Date of birth',
  passportNumber: 'Passport number',
  issuingAuthority: 'Passport issuing authority',
  issueDate: 'Passport issue date',
  expiryDate: 'Passport expiry date',
  passportAvailable: 'Passport available',
  nationalIdCardNumber: 'National ID card number',
  nationalIdNumber: 'National ID number',
  idIssuingAuthorityCard: 'ID card issuing authority',
  idIssuingAuthorityNational: 'ID issuing authority',
  otherNationality: 'Other nationality / citizenship',
  ukLicense: 'UK driving licence',
  ukLicenseNumber: 'UK driving licence number',
  medicalTreatment: 'Medical treatment in UK',
  ukStayDuration: 'How long in UK',
  parentName: 'Parent one — full name',
  parentRelation: 'Parent one — relationship',
  parentDob: 'Parent one — date of birth',
  parentNationality: 'Parent one — nationality',
  sameNationality: 'Parent one — same nationality',
  parent2Name: 'Parent two — full name',
  parent2Relation: 'Parent two — relationship',
  parent2Dob: 'Parent two — date of birth',
  parent2Nationality: 'Parent two — nationality',
  parent2SameNationality: 'Parent two — same nationality',
  illegalEntry: 'Entered UK illegally',
  overstayed: 'Overstayed visa',
  breach: 'Breached leave conditions',
  falseInfo: 'False information on application',
  otherBreach: 'Other immigration breach',
  refusedVisa: 'Refused visa',
  refusedEntry: 'Refused entry',
  refusedPermission: 'Refused permission to stay',
  refusedAsylum: 'Refused asylum',
  deported: 'Deported',
  removed: 'Removed',
  requiredToLeave: 'Required to leave',
  banned: 'Banned / excluded',
  visitedOther: 'Visited other countries',
  countryVisited: 'Country visited',
  visitReason: 'Visit reason',
  entryDate: 'Entry date (visit)',
  leaveDate: 'Leave date (visit)',
  visaType: 'Current visa type',
  brpNumber: 'BRP number',
  visaEndDate: 'Permission end date',
  niNumber: 'National Insurance number',
  sponsored: 'Government / scholarship sponsor',
  englishProof: 'English language evidence',
};

// Mirrors the STRING(n) columns in models/tenant/candidateApplication.model.js.
export const APPLICATION_FIELD_LIMITS = {
  firstName: 100, lastName: 100, email: 255, contactNumber: 50,
  gender: 30, relationshipStatus: 50, contactNumber2: 50,
  housingStatus: 50, landlordName: 200, landlordContactNumber: 50, landlordEmail: 255,
  nationality: 100, birthCountry: 100, placeOfBirth: 100,
  passportNumber: 50, issuingAuthority: 100,
  nationalIdCardNumber: 50, nationalIdNumber: 50,
  idIssuingAuthorityCard: 100, idIssuingAuthorityNational: 100,
  otherNationality: 100, ukStayDuration: 50, ukLicenseNumber: 100,
  parentName: 200, parentRelation: 50, parentNationality: 100,
  parent2Name: 200, parent2Relation: 50, parent2Nationality: 100,
  countryVisited: 100, visitReason: 200,
  visaType: 50, brpNumber: 50, niNumber: 20,
};

const DATE_FIELDS = new Set([
  'dob', 'issueDate', 'expiryDate',
  'startDate', 'endDate',
  'addressStartDate',
  'parentDob', 'parent2Dob',
  'entryDate', 'leaveDate',
  'visaEndDate',
]);

const YES_NO_FIELDS = new Set([
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

const ENUM_VALUES = {
  applicationType: ['Single', 'Family'],
  housingStatus: ['Rent', 'Own', 'Other'],
};

const ENUM_FIELDS = new Set([...YES_NO_FIELDS, ...Object.keys(ENUM_VALUES)]);

const labelOf = (key) => APPLICATION_FIELD_LABELS[key] || key;

/** 400-class error the global handler surfaces verbatim to the user. */
export function applicationValidationError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'APPLICATION_VALIDATION';
  return err;
}

/**
 * Normalise an enum-typed answer: accepts the canonical values in any casing and
 * common boolean spellings for Yes/No questions; blank → null; anything else → 400.
 */
function normaliseEnumValue(key, v) {
  if (v === null || v === undefined) return null;
  const allowed = YES_NO_FIELDS.has(key) ? ['Yes', 'No'] : ENUM_VALUES[key];
  if (typeof v === 'boolean') {
    if (YES_NO_FIELDS.has(key)) return v ? 'Yes' : 'No';
  }
  const s = String(v).trim();
  if (s === '') return null;
  const match = allowed.find((a) => a.toLowerCase() === s.toLowerCase());
  if (match) return match;
  if (YES_NO_FIELDS.has(key)) {
    if (['true', '1', 'y'].includes(s.toLowerCase())) return 'Yes';
    if (['false', '0', 'n'].includes(s.toLowerCase())) return 'No';
  }
  throw applicationValidationError(`${labelOf(key)} must be one of: ${allowed.join(', ')}.`);
}

function normaliseDateValue(key, v) {
  if (v === null || v === undefined) return null;
  let parsed;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw applicationValidationError(`${labelOf(key)} is not a valid date.`);
    parsed = v;
  } else {
    const s = String(v).trim();
    if (s === '') return null;
    parsed = new Date(s);
    if (Number.isNaN(parsed.getTime())) {
      throw applicationValidationError(`${labelOf(key)} is not a valid date.`);
    }
  }

  // BUG-007: addressStartDate cannot be in the future (today is permitted)
  if (key === 'addressStartDate' && parsed) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (parsed > today) {
      throw applicationValidationError('Move-in date cannot be in the future.');
    }
  }

  return parsed;
}

/**
 * Pick permitted application fields and sanitize DATE / ENUM / text values for
 * Sequelize/Postgres. Throws a 400 error (see applicationValidationError) when a
 * value cannot be stored, so callers never surface a raw database error.
 */
export function sanitizeApplicationPayload(body) {
  const payload = {};
  const source = body && typeof body === 'object' ? body : {};

  for (const key of APPLICATION_FIELDS) {
    if (source[key] === undefined) continue;

    let v = source[key];

    if (DATE_FIELDS.has(key)) {
      payload[key] = normaliseDateValue(key, v);
    } else if (ENUM_FIELDS.has(key)) {
      payload[key] = normaliseEnumValue(key, v);
    } else if (key === 'customResponses') {
      payload[key] = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } else if (key === 'nationalities') {
      let list = [];
      if (Array.isArray(v)) {
        list = v;
      } else if (typeof v === 'string' && v.trim()) {
        list = v.includes(',') ? v.split(',').map((x) => x.trim()) : [v.trim()];
      }
      const unique = Array.from(new Set(list.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)));
      for (const item of unique) {
        if (item.length > 100) {
          throw applicationValidationError(`Nationality value "${item}" must be 100 characters or fewer.`);
        }
      }
      payload[key] = unique;
    } else if (key === 'previousAddresses') {
      let rawList = [];
      if (Array.isArray(v)) {
        rawList = v;
      } else if (typeof v === 'string' && v.trim()) {
        try {
          const parsed = JSON.parse(v);
          if (Array.isArray(parsed)) rawList = parsed;
        } catch {
          rawList = [{ previousAddress: v.trim() }];
        }
      }
      const sanitizedAddresses = [];
      for (const item of rawList) {
        if (!item || typeof item !== 'object') continue;
        const addr = typeof item.previousAddress === 'string'
          ? item.previousAddress.trim()
          : (typeof item.address === 'string' ? item.address.trim() : '');
        const sDate = item.startDate ? normaliseDateValue('startDate', item.startDate) : null;
        const eDate = item.endDate ? normaliseDateValue('endDate', item.endDate) : null;
        
        if (sDate && eDate && new Date(sDate) > new Date(eDate)) {
          throw applicationValidationError('Previous address end date cannot be before start date.');
        }
        if (addr || sDate || eDate) {
          sanitizedAddresses.push({
            previousAddress: addr,
            startDate: sDate,
            endDate: eDate,
          });
        }
      }
      payload[key] = sanitizedAddresses;
    } else {
      if (typeof v === 'string') v = v.trim();
      const limit = APPLICATION_FIELD_LIMITS[key];
      if (limit && typeof v === 'string' && v.length > limit) {
        throw applicationValidationError(
          `${labelOf(key)} must be ${limit} characters or fewer (you entered ${v.length}).`,
        );
      }
      payload[key] = v;
    }
  }

  // Bidirectional synchronization between nationalities array and legacy nationality string
  if (Array.isArray(payload.nationalities) && payload.nationalities.length > 0) {
    if (!payload.nationality) {
      payload.nationality = payload.nationalities[0];
    }
  } else if (payload.nationality && (!payload.nationalities || payload.nationalities.length === 0)) {
    payload.nationalities = [payload.nationality];
  }

  // Bidirectional synchronization between previousAddresses array and legacy previousAddress columns
  if (Array.isArray(payload.previousAddresses) && payload.previousAddresses.length > 0) {
    if (payload.previousAddress === undefined && payload.previousAddresses[0]?.previousAddress) {
      payload.previousAddress = payload.previousAddresses[0].previousAddress;
    }
    if (payload.startDate === undefined && payload.previousAddresses[0]?.startDate) {
      payload.startDate = payload.previousAddresses[0].startDate;
    }
    if (payload.endDate === undefined && payload.previousAddresses[0]?.endDate) {
      payload.endDate = payload.previousAddresses[0].endDate;
    }
  } else if (payload.previousAddress && (!payload.previousAddresses || payload.previousAddresses.length === 0)) {
    payload.previousAddresses = [
      {
        previousAddress: payload.previousAddress,
        startDate: payload.startDate || null,
        endDate: payload.endDate || null,
      },
    ];
  }

  return payload;
}

/**
 * Validate required fields on final candidate application submission.
 * Enforces move-in date and landlord details when housingStatus === 'Rent'.
 */
export function validateFinalApplicationSubmission(payload) {
  if (!payload || typeof payload !== 'object') {
    throw applicationValidationError('Application payload is required.');
  }

  // addressStartDate is required for final application submission
  if (!payload.addressStartDate) {
    throw applicationValidationError('Move-in date is required.');
  }

  // Landlord validations when renting
  if (payload.housingStatus === 'Rent') {
    if (!payload.landlordName || !String(payload.landlordName).trim()) {
      throw applicationValidationError('Landlord name is required when renting.');
    }
    if (!payload.landlordContactNumber || !String(payload.landlordContactNumber).trim()) {
      throw applicationValidationError('Landlord contact number is required when renting.');
    }
    if (payload.landlordEmail && String(payload.landlordEmail).trim()) {
      const email = String(payload.landlordEmail).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw applicationValidationError('Please enter a valid landlord email address.');
      }
    }
  }

  // UK Driving Licence Number validation when applicant holds a UK licence
  if (payload.ukLicense === 'Yes') {
    if (!payload.ukLicenseNumber || !String(payload.ukLicenseNumber).trim()) {
      throw applicationValidationError('UK driving licence number is required when you have a UK driving licence.');
    }
  }

  return true;
}
