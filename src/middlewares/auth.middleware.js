import jwt from 'jsonwebtoken';

export const verifyToken = (req, res, next) => {
  try {
    // Primary: Authorization Header (Bearer Token) - Best for APIs
    let token = null;
    let tokenSource = 'none';

    // Check Authorization Header first
    const authHeader = req.headers['authorization'] || req.headers['Authorization'] || req.headers['AUTHORIZATION'];
    if (authHeader) {
      // Possible formats: 'Bearer <token>' or just '<token>'
      const parts = String(authHeader).trim().split(' ');
      if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
        token = parts[1];
        tokenSource = 'authorization header';
      } else if (parts.length === 1) {
        token = parts[0];
        tokenSource = 'authorization header (no-bearer)';
      }
    }



    // Trim possible surrounding quotes and whitespace
    if (token && (token.startsWith('"') || token.startsWith("'"))) {
      token = token.replace(/^['\"]|['\"]$/g, '');
    }

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required. No token provided.',
        data: null,
      });
    }


    console.debug(`verifyToken - token source: ${tokenSource}`);
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