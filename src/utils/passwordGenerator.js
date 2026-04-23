import crypto from 'crypto';

/**
 * Generate a cryptographically secure random password
 * @param {number} length - Length of the password (default: 12)
 * @returns {string} Generated password
 */
export function generateStrongPassword(length = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  
  // Generate random bytes and map to character set
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += chars[randomBytes[i] % chars.length];
  }
  
  // Ensure at least one uppercase, lowercase, number, and special character
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*]/.test(password);
  
  if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
    return generateStrongPassword(length);
  }
  
  return password;
}
