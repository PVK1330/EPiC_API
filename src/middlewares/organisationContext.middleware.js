import { resolveOrganisationContext } from "../utils/organisationHost.js";

/**
 * Attach req.organisationContext = { slug, organisation } for auth / public routes.
 */
export async function attachOrganisationContext(req, res, next) {
  try {
    req.organisationContext = await resolveOrganisationContext(req);
    next();
  } catch (err) {
    next(err);
  }
}
