import jwt from 'jsonwebtoken';

export const verifyToken = (req, res, next) => {
  try {
    // Validate JWT_SECRET is configured
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET environment variable is not configured');
      return res.status(500).json({
        status: 'error',
        message: 'Server configuration error: JWT secret not configured',
        data: null,
      });
    }

    // Primary: Authorization Header (Bearer Token) - Best for APIs
    let token = null;
    let tokenSource = 'none';

    // Check Authorization Header first
    if (req.headers['authorization']) {
      const parts = req.headers['authorization'].split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
        tokenSource = 'authorization header';
      }
    }

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required. No token provided.',
        data: null,
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;   // { userId, email, role_id, role_name }
    next();
  } catch (err) {
    console.error('verifyToken - Token verification failed:', err.message);
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token.',
      data: null,
    });
  }
};