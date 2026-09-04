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
  'otherNationality', 'ukLicense', 'ukLicenseNumber',
  'medicalTreatment', 'medicalTreatmentHospitalClinicName', 'medicalTreatmentHospitalClinicAddress', 'medicalTreatmentStartDate', 'medicalTreatmentEndDate', 'medicalTreatmentDetails', 'ukStayDuration',
  'parentName', 'parentRelation', 'parentDob', 'parentNationality', 'sameNationality',
  'parent2Name', 'parent2Relation', 'parent2Dob', 'parent2Nationality', 'parent2SameNationality',
  'illegalEntry', 'illegalEntryDetails', 'overstayed', 'overstayedDetails', 'breach', 'breachDetails', 'falseInfo', 'falseInfoDetails', 'otherBreach', 'otherBreachDetails',
  'refusedVisa', 'refusedVisaReason', 'refusedVisaDate', 'refusedVisaCountry', 'refusedVisaType', 'refusedVisaReference', 'refusedVisaDetails', 'refusedEntry', 'refusedEntryDetails', 'refusedPermission', 'refusedPermissionDetails', 'refusedAsylum', 'refusedAsylumDetails',
  'deported', 'deportedDetails', 'removed', 'removedDetails', 'requiredToLeave', 'requiredToLeaveDetails', 'banned', 'bannedDetails',
  'visitedOther', 'travelHistory', 'countryVisited', 'visitReason', 'entryDate', 'leaveDate',
  'visaType', 'brpNumber', 'visaEndDate', 'niNumber', 'sponsored', 'sponsoredDetails', 'englishProof',
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
  medicalTreatmentHospitalClinicName: 'Hospital / clinic name',
  medicalTreatmentHospitalClinicAddress: 'Hospital / clinic address',
  medicalTreatmentStartDate: 'Treatment start date',
  medicalTreatmentEndDate: 'Treatment end date',
  medicalTreatmentDetails: 'Other treatment details',
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
  illegalEntryDetails: 'Illegal entry details',
  overstayed: 'Overstayed visa',
  overstayedDetails: 'Overstaying details',
  breach: 'Breached leave conditions',
  breachDetails: 'Leave condition breach details',
  falseInfo: 'False information on application',
  falseInfoDetails: 'False information details',
  otherBreach: 'Other immigration breach',
  otherBreachDetails: 'Other immigration breach details',
  refusedVisa: 'Refused visa',
  refusedVisaReason: 'Reason for visa refusal',
  refusedVisaDate: 'Refusal date',
  refusedVisaCountry: 'Country of visa refusal',
  refusedVisaType: 'Visa / application type',
  refusedVisaReference: 'Refusal reference details',
  refusedVisaDetails: 'Visa refusal details',
  refusedEntry: 'Refused entry',
  refusedEntryDetails: 'Refused entry details',
  refusedPermission: 'Refused permission to stay',
  refusedPermissionDetails: 'Refused permission details',
  refusedAsylum: 'Refused asylum',
  refusedAsylumDetails: 'Refused asylum details',
  deported: 'Deported',
  deportedDetails: 'Deportation details',
  removed: 'Removed',
  removedDetails: 'Removal details',
  requiredToLeave: 'Required to leave',
  requiredToLeaveDetails: 'Required to leave details',
  banned: 'Banned / excluded',
  bannedDetails: 'Exclusion / ban details',
  visitedOther: 'Visited other countries',
  travelHistory: 'Travel history',
  countryVisited: 'Country visited',
  visitReason: 'Visit reason',
  entryDate: 'Entry date (visit)',
  leaveDate: 'Leave date (visit)',
  visaType: 'Current visa type',
  brpNumber: 'BRP number',
  visaEndDate: 'Permission end date',
  niNumber: 'National Insurance number',
  sponsored: 'Government / scholarship sponsor',
  sponsoredDetails: 'Sponsorship details',
  englishProof: 'English language evidence',
};

// Mirrors the STRING(n) columns in models/tenant/candidateApplication.model.js.
export const APPLICATION_FIELD_LIMITS = {
  firstName: 100, lastName: 100, email: 255, contactNumber: 50,
  gender: 30, relationshipStatus: 50, contactNumber2: 50,
  housingStatus: 50, landlordName: 200, landlordContactNumber: 50, landlordEmail: 255,
  medicalTreatmentHospitalClinicName: 255,
  refusedVisaCountry: 100, refusedVisaType: 100, refusedVisaReference: 100,
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
  'refusedVisaDate',
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

  // BUG-013: refusedVisaDate cannot be in the future (today is permitted)
  if (key === 'refusedVisaDate' && parsed) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (parsed > today) {
      throw applicationValidationError('Refusal date cannot be in the future.');
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
  const source = body && typeof body === 'object' ? { ...body } : {};

  // BUG-013: Alias conflict detection & normalization
  // 1. refusedVisa vs visaRefusal
  if (source.refusedVisa !== undefined && source.visaRefusal !== undefined) {
    const v1 = String(source.refusedVisa).trim().toLowerCase();
    const v2 = String(source.visaRefusal).trim().toLowerCase();
    if (v1 && v2 && v1 !== v2) {
      throw applicationValidationError('Conflicting values provided for refused visa.');
    }
  }
  if (source.refusedVisa === undefined && source.visaRefusal !== undefined) {
    source.refusedVisa = source.visaRefusal;
  }

  // 2. refusedVisaReason vs aliases (refusedVisaDetails, visaRefusalReason, visaRefusalDetails)
  const reasonAliases = [
    { key: 'refusedVisaReason', val: source.refusedVisaReason },
    { key: 'refusedVisaDetails', val: source.refusedVisaDetails },
    { key: 'visaRefusalReason', val: source.visaRefusalReason },
    { key: 'visaRefusalDetails', val: source.visaRefusalDetails },
  ].filter((a) => a.val !== undefined && String(a.val).trim() !== '');

  if (reasonAliases.length > 1) {
    const first = String(reasonAliases[0].val).trim();
    for (let i = 1; i < reasonAliases.length; i++) {
      if (String(reasonAliases[i].val).trim() !== first) {
        throw applicationValidationError('Conflicting values provided for visa refusal reason.');
      }
    }
  }
  if (reasonAliases.length > 0) {
    source.refusedVisaReason = reasonAliases[0].val;
    source.refusedVisaDetails = reasonAliases[0].val;
  }

  // 3. refusedVisaDate vs visaRefusalDate
  if (source.refusedVisaDate !== undefined && source.visaRefusalDate !== undefined) {
    const d1 = String(source.refusedVisaDate).trim();
    const d2 = String(source.visaRefusalDate).trim();
    if (d1 && d2 && d1 !== d2) {
      throw applicationValidationError('Conflicting values provided for refusal date.');
    }
  }
  if (source.refusedVisaDate === undefined && source.visaRefusalDate !== undefined) {
    source.refusedVisaDate = source.visaRefusalDate;
  }

  // 4. refusedVisaCountry vs visaRefusalCountry
  if (source.refusedVisaCountry !== undefined && source.visaRefusalCountry !== undefined) {
    const c1 = String(source.refusedVisaCountry).trim();
    const c2 = String(source.visaRefusalCountry).trim();
    if (c1 && c2 && c1.toLowerCase() !== c2.toLowerCase()) {
      throw applicationValidationError('Conflicting values provided for refusal country.');
    }
  }
  if (source.refusedVisaCountry === undefined && source.visaRefusalCountry !== undefined) {
    source.refusedVisaCountry = source.visaRefusalCountry;
  }

  // 5. refusedVisaType vs aliases (refusedVisaApplicationType, visaRefusalType, visaRefusalApplicationType)
  const typeAliases = [
    { key: 'refusedVisaType', val: source.refusedVisaType },
    { key: 'refusedVisaApplicationType', val: source.refusedVisaApplicationType },
    { key: 'visaRefusalType', val: source.visaRefusalType },
    { key: 'visaRefusalApplicationType', val: source.visaRefusalApplicationType },
  ].filter((a) => a.val !== undefined && String(a.val).trim() !== '');

  if (typeAliases.length > 1) {
    const first = String(typeAliases[0].val).trim();
    for (let i = 1; i < typeAliases.length; i++) {
      if (String(typeAliases[i].val).trim() !== first) {
        throw applicationValidationError('Conflicting values provided for visa refusal type.');
      }
    }
  }
  if (typeAliases.length > 0) {
    source.refusedVisaType = typeAliases[0].val;
  }

  // 6. refusedVisaReference vs aliases (refusedVisaReferenceDetails, visaRefusalReference, visaRefusalReferenceDetails)
  const refAliases = [
    { key: 'refusedVisaReference', val: source.refusedVisaReference },
    { key: 'refusedVisaReferenceDetails', val: source.refusedVisaReferenceDetails },
    { key: 'visaRefusalReference', val: source.visaRefusalReference },
    { key: 'visaRefusalReferenceDetails', val: source.visaRefusalReferenceDetails },
  ].filter((a) => a.val !== undefined && String(a.val).trim() !== '');

  if (refAliases.length > 1) {
    const first = String(refAliases[0].val).trim();
    for (let i = 1; i < refAliases.length; i++) {
      if (String(refAliases[i].val).trim() !== first) {
        throw applicationValidationError('Conflicting values provided for refusal reference.');
      }
    }
  }
  if (refAliases.length > 0) {
    source.refusedVisaReference = refAliases[0].val;
  }

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
    } else if (key === 'travelHistory') {
      // BUG-014: multiple trips, each { countryVisited, visitReason, entryDate,
      // leaveDate, duration, details }.
      let rawList = [];
      if (Array.isArray(v)) {
        rawList = v;
      } else if (typeof v === 'string' && v.trim()) {
        try { const parsed = JSON.parse(v); if (Array.isArray(parsed)) rawList = parsed; } catch { rawList = []; }
      }
      const trips = [];
      for (const item of rawList) {
        if (!item || typeof item !== 'object') continue;
        const country = typeof item.countryVisited === 'string' ? item.countryVisited.trim() : '';
        const reason = typeof item.visitReason === 'string' ? item.visitReason.trim() : '';
        const entry = item.entryDate ? normaliseDateValue('entryDate', item.entryDate) : null;
        const leave = item.leaveDate ? normaliseDateValue('leaveDate', item.leaveDate) : null;
        const duration = typeof item.duration === 'string' ? item.duration.trim() : '';
        const details = typeof item.details === 'string' ? item.details.trim() : '';
        if (entry && leave && new Date(entry) > new Date(leave)) {
          throw applicationValidationError('Travel history: the leave date cannot be before the entry date.');
        }
        if (country || reason || entry || leave || duration || details) {
          trips.push({ countryVisited: country, visitReason: reason, entryDate: entry, leaveDate: leave, duration, details });
        }
      }
      payload[key] = trips;
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

  // Bidirectional synchronization between canonical refusedVisaReason and legacy refusedVisaDetails
  if (payload.refusedVisaReason !== undefined && payload.refusedVisaDetails === undefined) {
    payload.refusedVisaDetails = payload.refusedVisaReason;
  } else if (payload.refusedVisaDetails !== undefined && payload.refusedVisaReason === undefined) {
    payload.refusedVisaReason = payload.refusedVisaDetails;
  }

  // BUG-014: keep the legacy single-trip columns in step with the travelHistory array.
  if (Array.isArray(payload.travelHistory) && payload.travelHistory.length > 0) {
    const first = payload.travelHistory[0];
    if (payload.countryVisited === undefined && first?.countryVisited) payload.countryVisited = first.countryVisited;
    if (payload.visitReason === undefined && first?.visitReason) payload.visitReason = first.visitReason;
    if (payload.entryDate === undefined && first?.entryDate) payload.entryDate = first.entryDate;
    if (payload.leaveDate === undefined && first?.leaveDate) payload.leaveDate = first.leaveDate;
  } else if (payload.countryVisited && (!payload.travelHistory || payload.travelHistory.length === 0)) {
    payload.travelHistory = [
      {
        countryVisited: payload.countryVisited,
        visitReason: payload.visitReason || '',
        entryDate: payload.entryDate || null,
        leaveDate: payload.leaveDate || null,
        duration: '',
        details: '',
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

  // Medical Treatment structured details validation (BUG-012)
  if (payload.medicalTreatment === 'Yes') {
    if (!payload.medicalTreatmentHospitalClinicName || !String(payload.medicalTreatmentHospitalClinicName).trim()) {
      throw applicationValidationError('Hospital or clinic name is required when you have received medical treatment in the UK.');
    }
    if (!payload.medicalTreatmentHospitalClinicAddress || !String(payload.medicalTreatmentHospitalClinicAddress).trim()) {
      throw applicationValidationError('Hospital or clinic address is required when you have received medical treatment in the UK.');
    }
    if (!payload.medicalTreatmentStartDate) {
      throw applicationValidationError('Treatment start date is required when you have received medical treatment in the UK.');
    }
    if (!payload.medicalTreatmentEndDate) {
      throw applicationValidationError('Treatment end date is required when you have received medical treatment in the UK.');
    }
    if (payload.medicalTreatmentStartDate && payload.medicalTreatmentEndDate) {
      const start = new Date(payload.medicalTreatmentStartDate);
      const end = new Date(payload.medicalTreatmentEndDate);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end < start) {
        throw applicationValidationError('Treatment end date cannot be before treatment start date.');
      }
    }
  }

  // Visa Refusal structured details validation (BUG-013)
  if (payload.refusedVisa === 'Yes') {
    const reason = payload.refusedVisaReason || payload.refusedVisaDetails;
    if (!reason || !String(reason).trim()) {
      throw applicationValidationError('Reason for visa refusal is required when you have had a visa refused.');
    }
    if (!payload.refusedVisaDate) {
      throw applicationValidationError('Refusal date is required when you have had a visa refused.');
    }
    if (!payload.refusedVisaCountry || !String(payload.refusedVisaCountry).trim()) {
      throw applicationValidationError('Country of visa refusal is required when you have had a visa refused.');
    }
    const visaType = payload.refusedVisaType;
    if (!visaType || !String(visaType).trim()) {
      throw applicationValidationError('Visa or application type is required when you have had a visa refused.');
    }
  }

  // Conditional Yes/No details validation for other immigration history & sponsorship
  const CONDITIONAL_YES_DETAIL_RULES = [
    { parent: 'refusedEntry', detail: 'refusedEntryDetails', msg: 'Refused entry details are required when you have been refused entry at the border.' },
    { parent: 'refusedPermission', detail: 'refusedPermissionDetails', msg: 'Refused permission details are required when you have been refused permission to stay.' },
    { parent: 'refusedAsylum', detail: 'refusedAsylumDetails', msg: 'Refused asylum details are required when you have been refused asylum.' },
    { parent: 'deported', detail: 'deportedDetails', msg: 'Deportation details are required when you have been deported.' },
    { parent: 'removed', detail: 'removedDetails', msg: 'Removal details are required when you have been removed.' },
    { parent: 'requiredToLeave', detail: 'requiredToLeaveDetails', msg: 'Details are required when you have been required to leave.' },
    { parent: 'banned', detail: 'bannedDetails', msg: 'Exclusion/ban details are required when you have been excluded or banned.' },
    { parent: 'illegalEntry', detail: 'illegalEntryDetails', msg: 'Illegal entry details are required when you entered the UK illegally.' },
    { parent: 'overstayed', detail: 'overstayedDetails', msg: 'Overstaying details are required when you have overstayed a visa.' },
    { parent: 'breach', detail: 'breachDetails', msg: 'Condition breach details are required when you have breached leave conditions.' },
    { parent: 'falseInfo', detail: 'falseInfoDetails', msg: 'Details are required when false information was previously given.' },
    { parent: 'otherBreach', detail: 'otherBreachDetails', msg: 'Immigration breach details are required when you have breached UK immigration law.' },
    { parent: 'sponsored', detail: 'sponsoredDetails', msg: 'Sponsorship details are required when you have received government or scholarship sponsorship.' },
  ];

  for (const rule of CONDITIONAL_YES_DETAIL_RULES) {
    if (payload[rule.parent] === 'Yes') {
      if (!payload[rule.detail] || !String(payload[rule.detail]).trim()) {
        throw applicationValidationError(rule.msg);
      }
    }
  }

  return true;
}
