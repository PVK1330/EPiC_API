/**
 * router.param handler factory: reject non-positive-integer route params with a
 * clean 400 before the controller runs any DB query. Prevents the "invalid input
 * syntax for type integer" Postgres error from surfacing as a 500 that leaks the
 * raw DB message (e.g. GET /caseworker/documents/abc, /business/visa-workers/NaN).
 *
 * Usage:  router.param('documentId', numericParam('document id'))
 */
export function numericParam(label = 'id') {
  return (req, res, next, value) => {
    // Require a plain positive-integer STRING. Testing Number(value) is not
    // enough: "1e5", "0x10", " 5 " all coerce to integers yet are passed to
    // Postgres verbatim and trigger a 22P02 cast error (500). A strict digit
    // check rejects them up front.
    const str = String(value);
    if (!/^\d+$/.test(str) || Number(str) <= 0 || Number(str) > Number.MAX_SAFE_INTEGER) {
      return res.status(400).json({
        status: 'error',
        message: `A valid ${label} is required`,
        data: null,
      });
    }
    return next();
  };
}

export default numericParam;
