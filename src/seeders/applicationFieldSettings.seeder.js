import db from "../models/index.js";

const ApplicationFieldSetting = db.ApplicationFieldSetting;

const BUILTIN = [
  ["applicationType", "Application type", "select", 1],
  ["firstName", "First name", "text", 2],
  ["lastName", "Last name", "text", 3],
  ["email", "Email", "email", 4],
  ["gender", "Gender", "select", 5],
  ["contactNumber", "Contact number", "text", 6],
  ["relationshipStatus", "Relationship status", "select", 7],
  ["address", "Current address", "textarea", 8],
  ["nationality", "Country of nationality", "text", 9],
  ["birthCountry", "Country of birth", "text", 10],
  ["placeOfBirth", "Place of birth", "text", 11],
  ["dob", "Date of birth", "date", 12],
  ["passportNumber", "Passport number", "text", 13],
  ["issuingAuthority", "Passport issuing authority", "text", 14],
  ["issueDate", "Passport issue date", "date", 15],
  ["expiryDate", "Passport expiry date", "date", 16],
  ["passportAvailable", "Passport available", "select", 17],
  ["nationalIdCardNumber", "National ID card number", "text", 18],
  ["nationalIdNumber", "National ID number", "text", 19],
  ["idIssuingAuthorityCard", "ID issuing authority (card)", "text", 20],
  ["idIssuingAuthorityNational", "ID issuing authority", "text", 21],
  ["otherNationality", "Other nationality / citizenship", "select", 22],
  ["ukLicense", "UK driving licence", "select", 23],
  ["medicalTreatment", "Medical treatment in UK", "select", 24],
  ["ukStayDuration", "How long in UK", "text", 25],
  ["contactNumber2", "Alternate contact number", "text", 26],
  ["previousFullAddress", "Previous full address", "textarea", 27],
  ["previousAddress", "Previous address", "textarea", 28],
  ["startDate", "Address start date", "date", 29],
  ["endDate", "Address end date", "date", 30],
  ["parentName", "Parent one — full name", "text", 31],
  ["parentRelation", "Parent one — relationship", "text", 32],
  ["parentDob", "Parent one — date of birth", "date", 33],
  ["parentNationality", "Parent one — nationality", "text", 34],
  ["sameNationality", "Parent one — same nationality", "select", 35],
  ["parent2Name", "Parent two — full name", "text", 36],
  ["parent2Relation", "Parent two — relationship", "text", 37],
  ["parent2Dob", "Parent two — date of birth", "date", 38],
  ["parent2Nationality", "Parent two — nationality", "text", 39],
  ["parent2SameNationality", "Parent two — same nationality", "select", 40],
  ["illegalEntry", "Entered UK illegally", "select", 41],
  ["overstayed", "Overstayed visa", "select", 42],
  ["breach", "Breached leave conditions", "select", 43],
  ["falseInfo", "False information on application", "select", 44],
  ["otherBreach", "Other immigration breach", "select", 45],
  ["refusedVisa", "Refused visa", "select", 46],
  ["refusedEntry", "Refused entry", "select", 47],
  ["refusedPermission", "Refused permission to stay", "select", 48],
  ["refusedAsylum", "Refused asylum", "select", 49],
  ["deported", "Deported", "select", 50],
  ["removed", "Removed", "select", 51],
  ["requiredToLeave", "Required to leave", "select", 52],
  ["banned", "Banned / excluded", "select", 53],
  ["visitedOther", "Visited other countries (10 years)", "select", 54],
  ["countryVisited", "Country visited", "text", 55],
  ["visitReason", "Visit reason", "text", 56],
  ["entryDate", "Entry date (visit)", "date", 57],
  ["leaveDate", "Leave date (visit)", "date", 58],
  ["visaType", "Current visa type", "select", 59],
  ["brpNumber", "BRP number", "text", 60],
  ["visaEndDate", "Permission end date", "date", 61],
  ["niNumber", "National Insurance number", "text", 62],
  ["sponsored", "Government / scholarship sponsor", "select", 63],
  ["englishProof", "English language evidence", "select", 64],
];

export default async function seedApplicationFieldSettings() {
  try {
    for (const [field_key, field_label, field_type, field_order] of BUILTIN) {
      await ApplicationFieldSetting.findOrCreate({
        where: { field_key },
        defaults: {
          field_label,
          is_visible: true,
          is_required: false,
          field_order,
          field_type,
        },
      });
    }
  } catch (err) {
    console.error("applicationFieldSettings seeder:", err.message);
  }
}
