import { consumeOAuthState } from "../../../services/oauthState.service.js";
import { verifyTokenAndTenant } from "../../../middlewares/authStack.middleware.js";
import logger from "../../../utils/logger.js";

function frontendBase() {
  return (process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:5173").replace(/\/$/, "");
}

/**
 * Secure OAuth callback session restorer.
 *
 * Replaces the previous (insecure) approach of carrying the user's JWT in the
 * OAuth `state` parameter. Here `state` is a random, single-use, server-stored
 * CSRF nonce. We:
 *   1. validate + consume the nonce (single use; rejects replay/expired/unknown)
 *   2. restore the originating session from the SERVER-SIDE stored token
 *      (works even when the auth cookie is SameSite=Strict and so is not sent
 *      on the cross-site provider redirect)
 *   3. defer to verifyTokenAndTenant to populate req.user / req.tenantDb
 *
 * @param {'google'|'microsoft'} provider
 */
export const oauthCallbackSession = (provider) => async (req, res, next) => {
  const { state } = req.query;

  let session = null;
  try {
    session = await consumeOAuthState(state, provider);
  } catch (err) {
    logger.error({ err, provider }, "OAuth state consumption error");
  }

  if (!session) {
    logger.warn(
      { provider, hasState: Boolean(state) },
      "Rejected OAuth callback: missing, invalid, expired, or replayed state (CSRF protection)",
    );
    return res.redirect(`${frontendBase()}/login?sync=${provider}_invalid_state`);
  }

  // Restore the session server-side. The token never travelled through the URL,
  // the browser address bar, the provider, or any referer/log.
  if (session.authToken) {
    req.headers.authorization = `Bearer ${session.authToken}`;
  }
  // Expose the verified binding for downstream handlers / defense in depth.
  req.oauthState = session;

  return verifyTokenAndTenant(req, res, next);
};
