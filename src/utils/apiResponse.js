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

  static error(res, message, statusCode = 500, error = null) {
    const response = {
      status: 'error',
      message,
      data: null,
    };

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
}

export default ApiResponse;
