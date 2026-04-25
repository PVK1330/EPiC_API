import jwt from 'jsonwebtoken';

export const verifyToken = (req, res, next) => {
  try {
    // Validate JWT_SECRET is configured
    if (!process.env.JWT_SECRET) {
      console.error('CRITICAL: JWT_SECRET environment variable is not configured');
      return res.status(500).json({
        status: 'error',
        message: 'Server configuration error',
        data: null,
      });
    }

    let token = null;

    // 1. Check Authorization Header (Bearer Token)
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    // 2. Fallback to Cookies if no header (Useful for browser requests/testing)
    if (!token && req.cookies) {
      token = req.cookies.token;
    }

    if (!token) {
      // Use 401 for authentication issues
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required. No token provided.',
        data: null,
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId, email, role_id, role_name }
    next();
  } catch (err) {
    console.error('verifyToken - Error:', err.message);
    const status = err.name === 'TokenExpiredError' ? 401 : 401; // Always 401 for auth failures
    return res.status(status).json({
      status: 'error',
      message: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid or expired token.',
      data: null,
    });
  }
};