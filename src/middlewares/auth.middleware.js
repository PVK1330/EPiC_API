import jwt from 'jsonwebtoken';

export const verifyToken = (req, res, next) => {
  try {
    // Primary: read from HttpOnly cookie
    let token = req.cookies?.token;

    // Fallback: Authorization: Bearer <token>
    if (!token && req.headers['authorization']) {
      const parts = req.headers['authorization'].split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
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
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token.',
      data: null,
    });
  }
};