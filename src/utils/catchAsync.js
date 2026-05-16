/**
 * Catches errors in async functions and passes them to the next middleware (global error handler).
 * Removes the need for try-catch blocks in controllers.
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

export default catchAsync;
