/**
 * Standard document checklists per visa type.
 *
 * Used to seed the per-tenant `document_checklists` table (one row per item,
 * caseId = NULL = applies to all cases of that visa type). Admins can then edit
 * these from the panel. `resolveRequiredDocuments` (DCS email) and the candidate
 * document-checklist UI both read from this table.
 *
 * Each group is matched to an org's existing visa_types row by `matchers`
 * (normalised substring). If none matches and `createIfMissing` is true, the
 * visa type is created so the checklist has a home.
 */

export const VISA_DOCUMENT_CHECKLISTS = [
  {
    key: "sponsor_licence",
    canonicalName: "Sponsor Licence",
    createIfMissing: true,
    matchers: ["sponsorlicence", "sponsorlicense"],
    items: [
      "Trading name of the business and premises address",
      "Name of the owning limited company",
      "Details for the individual to be named on the licence: full name, phone number, NI number, personal email address, and a copy of their passport",
      "Last 3 months of business bank statements (bank must appear on the PRA approved list)",
      "Organisational chart for the business",
      "PAYE reference number on HMRC-headed documentation",
      "VAT registration certificate",
      "Annual accounts (if turnover is not shown, provide alternative financial trading information)",
      "Lease agreement for business premises",
      "Employer's liability insurance certificate",
      "Evidence of local council registration to serve hot food / Scores on Doors (food businesses only)",
      "Number of CoS requests (if any): passport, draft employment contract, SOC code, share code of candidate to be sponsored",
      "Evidence of proof of purchase, sales and invoices",
      "Incoming AO and Outgoing AO letter (TUPE transfer)",
      "Solicitor letter (TUPE transfer)",
      "CQC registration evidence (care businesses only)",
      "Job titles to recruit under sponsor licence",
      "Company website",
      "Number of total employees and employees under Immigration rules",
      "Companies House incorporation certificate and CH extracts",
      "Premises alcohol licence (if applicable)",
      "RTW checks of all current employees under Immigration Rules",
    ],
  },
  {
    key: "visit_visa",
    canonicalName: "Visit Visa",
    createIfMissing: false,
    matchers: ["visit", "visitor"],
    items: [
      "Passport copy",
      "Previous passports (if applicable)",
      "Travel history",
      "UK visit dates and travel plan",
      "Purpose of visit to the UK",
      "Current residential address and contact details",
      "Employment / business / study details",
      "Last 6 months' bank statements",
      "Last 3 months' payslips (if employed)",
      "Employment letter / NOC from employer (if employed)",
      "Business registration and trading documents (if self-employed)",
      "Invitation letter from UK sponsor / host (if applicable)",
      "Sponsor's passport / BRP copy and UK address proof (if sponsored)",
      "Proof of accommodation in the UK",
      "Evidence of ties to home country",
      "Marriage certificate (if applicable)",
      "Birth certificates for children travelling (if applicable)",
      "Travel history / previous visa refusals (if applicable)",
      "Tuberculosis certificate (if applicable)",
    ],
  },
  {
    key: "student_visa",
    canonicalName: "Student",
    createIfMissing: false,
    matchers: ["student"],
    items: [
      "Passport copy",
      "CAS (Confirmation of Acceptance for Studies)",
      "Current BRP card",
      "eVisa share code (for inside UK applications)",
      "Educational documents used for CAS",
      "Proof of funds / bank statements (if required)",
      "Tuberculosis certificate (if applicable)",
      "ATAS certificate (if applicable)",
      "Previous visa / immigration status documents",
      "Travel history / previous visa refusal details (if applicable)",
    ],
  },
  {
    key: "graduate_visa",
    canonicalName: "Graduate",
    createIfMissing: false,
    matchers: ["graduate"],
    items: [
      "Passport copy",
      "Current BRP card",
      "eVisa share code",
      "CAS / student details",
      "Confirmation of successful course completion from university",
      "Current UK residential address and contact details",
      "Previous visa / immigration status documents",
      "Travel history / previous visa refusal details (if applicable)",
    ],
  },
  {
    key: "skilled_worker",
    canonicalName: "Skilled Worker",
    createIfMissing: false,
    matchers: ["skilledworker", "skilled"],
    items: [
      "Passport copy",
      "Latest BRP",
      "eVisa share code",
      "Certificate of Sponsorship (CoS)",
      "Proof of English language requirement (if applicable)",
      "Degree certificate / ECCTIS certificate (if applicable)",
      "Tuberculosis certificate (if applicable)",
      "Marriage certificate (for dependant spouse applications)",
      "Birth certificates of children (for dependant child applications)",
      "Proof of relationship / cohabitation (if applicable)",
      "Previous visa / immigration status documents",
      "Previous visa application copy",
      "ATAS certificate (if applicable)",
    ],
  },
  {
    key: "dependent_visa",
    canonicalName: "Dependent Visa",
    createIfMissing: true,
    matchers: ["dependent", "dependant"],
    items: [
      "Passport copy of dependant applicant",
      "Current BRP card",
      "eVisa share code (for inside UK applications)",
      "Main applicant's passport copy",
      "Main applicant's BRP card",
      "Main applicant's eVisa share code",
      "Main applicant's Certificate of Sponsorship (CoS) or visa approval",
      "Marriage certificate (spouse applications)",
      "Birth certificate (child dependant applications)",
      "Proof of genuine relationship / cohabitation (for spouse/partner applications)",
      "Proof of shared address / joint documents (inside UK spouse/partner applications)",
      "Tuberculosis certificate (outside UK applications where required)",
      "Last 3 months' bank statements (if maintenance funds are required)",
      "Child school letter / address proof (inside UK child dependant applications, if applicable)",
      "Current visa / immigration status documents (inside UK applications)",
      "Previous visa refusal details / Home Office correspondence (if applicable)",
    ],
  },
  {
    key: "ilr",
    canonicalName: "Indefinite Leave to Remain (ILR)",
    createIfMissing: false,
    matchers: ["indefiniteleave", "ilr"],
    items: [
      "Passport copy",
      "Current BRP card",
      "eVisa share code",
      "All previous UK visa copies / immigration status documents",
      "Proof of continuous residence in the UK",
      "Absence / travel history outside the UK",
      "Last 3 months' payslips",
      "Last 3 months' bank statements showing salary credits",
      "Employment letter confirming ongoing employment (if employed)",
      "P60s (if applicable)",
      "Life in the UK Test pass notification",
      "Proof of English language requirement (if applicable)",
      "Degree certificate / ECCTIS certificate (if applicable)",
      "Sponsor / employer details (if applicable)",
      "Marriage certificate (if applicable)",
      "Birth certificates for dependent children (if applicable)",
      "Proof of cohabitation / relationship evidence (if applicable)",
      "Previous visa refusal or Home Office correspondence (if applicable)",
      "Criminal conviction details / documents (if applicable)",
    ],
  },
  {
    key: "naturalisation",
    canonicalName: "British Citizenship / Naturalisation",
    createIfMissing: true,
    matchers: ["britishcitizen", "naturalisation", "naturalization", "nationality", "citizenship"],
    items: [
      "Passport copy",
      "Current BRP card",
      "eVisa share code",
      "ILR approval / current settled status proof",
      "Proof of continuous residence in the UK",
      "Absence / travel history outside the UK",
      "Life in the UK Test pass notification",
      "Proof of English language requirement (if applicable)",
      "Marriage certificate (if applying based on marriage to a British citizen)",
      "Referee details and declarations",
      "Previous visa / immigration status documents",
      "Criminal conviction details / documents (if applicable)",
    ],
  },
  {
    key: "family_visa",
    canonicalName: "Spouse / Partner",
    createIfMissing: false,
    matchers: ["spouse", "partner", "family"],
    items: [
      "Passport copy of applicant",
      "Current BRP card",
      "eVisa share code (for inside UK applications)",
      "Sponsor's passport copy and immigration status proof",
      "Marriage certificate / civil partnership certificate (spouse applications)",
      "Birth certificate (child applications)",
      "Proof of genuine relationship / cohabitation",
      "Proof of shared address / joint documents (if applicable)",
      "Financial evidence meeting the minimum income requirement",
      "Employment / business documents of sponsor (if applicable)",
      "Accommodation proof in the UK",
      "Tuberculosis certificate (outside UK applications where required)",
      "Consent letter from other parent (child applications where applicable)",
      "Previous visa / immigration status documents",
      "Travel history / previous visa refusal details (if applicable)",
    ],
  },
];

/** Normalise a visa-type name for matching: lowercase alphanumerics only. */
export function normaliseVisaName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** An item is optional when its text is conditional ("if applicable", "(... only)", etc.). */
export function deriveIsRequired(itemText) {
  const t = String(itemText).toLowerCase();
  const optional =
    /\bif\b|\bwhere\b|\bapplicable\b|application[s]?\b|\bonly\)|\(for |businesses only/.test(t) &&
    /\(/.test(t);
  return !optional;
}

const CATEGORY_RULES = [
  { category: "identity", kw: ["passport", "brp", "evisa", "share code", "birth certificate", "marriage certificate", "civil partnership", "national id", "settled status"] },
  { category: "financial", kw: ["bank statement", "payslip", "p60", "annual accounts", "vat", "invoice", "proof of funds", "financial", "salary", "turnover", "maintenance funds", "minimum income", "purchase, sales"] },
  { category: "education", kw: ["cas", "degree", "ecctis", "atas", "course", "university", "educational", "life in the uk", "english language"] },
  { category: "work", kw: ["certificate of sponsorship", "cos", "employment", "employer", "paye", "employment contract", "soc code", "job", "organisational chart", "employees", "right-to-work", "rtw", "sponsor", "company", "companies house", "trading", "website", "noc"] },
  { category: "medical", kw: ["tuberculosis", "cqc", "scores on doors", "hot food"] },
  { category: "legal", kw: ["solicitor", "tupe", "consent", "referee", "criminal", "conviction", "alcohol licence", "council registration", "incorporation", "lease", "insurance", "home office", "refusal", "immigration status", "ilr approval", "licence"] },
];

/** Best-effort category for an item (defaults to 'other'). */
export function deriveCategory(itemText) {
  const t = String(itemText).toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.kw.some((k) => t.includes(k))) return rule.category;
  }
  return "other";
}

/** Short documentType label (<=100 chars) derived from the item text. */
export function deriveDocumentType(itemText) {
  const beforeParen = String(itemText).split("(")[0];
  const beforeSep = beforeParen.split(/[:;]/)[0];
  return beforeSep.trim().slice(0, 100) || "Document";
}
