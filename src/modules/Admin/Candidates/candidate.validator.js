import ApiResponse from '../../../utils/apiResponse.js';

/**
 * Validator for Candidate creation and updates.
 */
export const validateCandidate = (req, res, next) => {
  const { first_name, last_name, email, country_code, mobile } = req.body;

  if (req.method === 'POST') {
    if (!first_name || !last_name || !email || !country_code || !mobile) {
      return ApiResponse.badRequest(res, "First name, last name, email, country code, and mobile are required");
    }
  }

  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return ApiResponse.badRequest(res, "Invalid email format");
    }
  }

  next();
};
