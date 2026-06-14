/**
 * Utility class for consistent API responses.
 */
class ApiResponse {
  static success(res, message, data = null, statusCode = 200) {
    return res.status(statusCode).json({
      status: 'success',
      message,
      data,
    });
  }

  static created(res, message, data = null) {
    return this.success(res, message, data, 201);
  }

  /**
   * Standard error response.
   *
   * Canonical error shape: { status: 'error', code?, message, data: null }
   * The optional `code` is a machine-readable error code (e.g. 'INVALID_TOKEN')
   * and is only included in the JSON when explicitly provided by the caller.
   *
   * @param {object} res - Express response object.
   * @param {string} message - Human-readable error message.
   * @param {number} [statusCode=500] - HTTP status code.
   * @param {Error|string|null} [error=null] - Error detail (exposed only in development).
   * @param {string|null} [code=null] - Optional machine-readable error code.
   */
  static error(res, message, statusCode = 500, error = null, code = null) {
    const response = {
      status: 'error',
      message,
      data: null,
    };

    if (code !== null && code !== undefined) {
      response.code = code;
    }

    if (error && process.env.NODE_ENV === 'development') {
      response.error = error.message || error;
      response.stack = error.stack;
    }

    return res.status(statusCode).json(response);
  }

  static badRequest(res, message, error = null) {
    return this.error(res, message, 400, error);
  }

  static unauthorized(res, message = 'Unauthorized', error = null) {
    return this.error(res, message, 401, error);
  }

  static forbidden(res, message = 'Forbidden', error = null) {
    return this.error(res, message, 403, error);
  }

  static notFound(res, message = 'Resource not found', error = null) {
    return this.error(res, message, 404, error);
  }

  static validationError(res, message = 'Validation failed', errors = []) {
    return res.status(400).json({
      status: 'error',
      message,
      errors, // Array of field validation errors [{ field, message }]
      data: null,
    });
  }
}

export default ApiResponse;
