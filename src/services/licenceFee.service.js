/**
 * Sponsor licence fee calculation (Step 8).
 *
 * IMPORTANT: the figures below are the standard published UK Home Office sponsor
 * licence fees and are kept here as a single, configurable source of truth.
 * They change periodically — verify against the current gov.uk schedule
 * ("Sponsorship fees" / "Immigration Skills Charge") before relying on them in
 * production. Nothing else in the codebase hard-codes these amounts.
 */

export const FEE_CURRENCY = "GBP";

// Licence application fees by route category and sponsor-size band (GBP).
export const LICENCE_FEES = Object.freeze({
  worker: { small: 574, large: 1579 }, // Worker (Skilled Worker, Scale-up, GBM)
  temporary: { small: 574, large: 574 }, // Temporary Worker (incl. GAE)
  student: { small: 574, large: 574 }, // Student sponsor licence
});

// Immigration Skills Charge per sponsored worker, per year (GBP). Informational
// estimate only — the ISC is paid per CoS at assignment, not as part of the
// licence application fee. Applies to Worker-route CoS (not Temporary/Student).
export const IMMIGRATION_SKILLS_CHARGE = Object.freeze({
  small: 364,
  large: 1000,
});

// Map a Step-1 route code to its fee category.
export const ROUTE_CATEGORY = Object.freeze({
  SkilledWorker: "worker",
  ScaleUp: "worker",
  GBM: "worker",
  GAE: "temporary",
  Student: "student",
});

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Resolve the sponsor-size band. Charities always pay the small/charity rate.
 * Otherwise the caller's declared band is used; when unknown we default to the
 * larger band so the preview never understates the fee.
 */
export function resolveSponsorSizeBand({ sponsorSize = null, charityStatus = false } = {}) {
  if (charityStatus) return "small";
  return sponsorSize === "small" || sponsorSize === "large" ? sponsorSize : "large";
}

/**
 * Compute the licence application fee + an informational Immigration Skills
 * Charge estimate.
 *
 * @param {object} input
 * @param {string[]} input.routes            selected route codes (Step 1)
 * @param {('small'|'large')} [input.sponsorSize]
 * @param {boolean} [input.charityStatus]
 * @param {Array<{sponsorshipDurationMonths?:number}>} [input.cosRequirements]
 * @returns {{ sponsorSizeBand, currency, lineItems, applicationFeeTotal, immigrationSkillsChargeEstimate }}
 */
export function computeFee({ routes = [], sponsorSize = null, charityStatus = false, cosRequirements = [] } = {}) {
  const band = resolveSponsorSizeBand({ sponsorSize, charityStatus });
  const codes = Array.isArray(routes) ? routes : [];
  const categories = new Set(codes.map((c) => ROUTE_CATEGORY[c]).filter(Boolean));

  // A new application pays one licence fee: the highest applicable category.
  // Worker > Temporary/Student. (Worker is the only band-dependent category.)
  let category = null;
  if (categories.has("worker")) category = "worker";
  else if (categories.has("temporary")) category = "temporary";
  else if (categories.has("student")) category = "student";

  const applicationFeeTotal = category ? LICENCE_FEES[category][band] : 0;

  const lineItems = [];
  if (category) {
    lineItems.push({
      key: "licence_fee",
      label: `Sponsor licence fee (${category}, ${band === "small" ? "small/charity" : "medium/large"} sponsor)`,
      amount: applicationFeeTotal,
    });
  }

  // ISC estimate — only for Worker-route CoS; per worker per year.
  let immigrationSkillsChargeEstimate = 0;
  if (categories.has("worker") && Array.isArray(cosRequirements) && cosRequirements.length) {
    const rate = IMMIGRATION_SKILLS_CHARGE[band];
    immigrationSkillsChargeEstimate = cosRequirements.reduce((sum, cos) => {
      const months = toNumber(cos?.sponsorshipDurationMonths);
      const years = Math.max(1, Math.ceil(months / 12) || 0);
      return sum + rate * years;
    }, 0);
  }

  return {
    sponsorSizeBand: band,
    currency: FEE_CURRENCY,
    lineItems,
    applicationFeeTotal,
    immigrationSkillsChargeEstimate,
  };
}

export default { computeFee, resolveSponsorSizeBand, LICENCE_FEES, IMMIGRATION_SKILLS_CHARGE, ROUTE_CATEGORY, FEE_CURRENCY };
