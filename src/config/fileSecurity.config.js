export const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.csv', '.xlsx', '.xls'];
export const ALLOWED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export const BLOCKED_EXTENSIONS = [
  '.html', '.htm', '.svg', '.js', '.exe', '.sh', '.bat', 
  '.php', '.py', '.jar', '.ts', '.jsx', '.tsx', '.cgi', 
  '.pl', '.rb', '.pif', '.scr', '.vbs', '.com'
];

export const ALLOWED_MIME_TYPES = {
  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

export const MAX_FILE_SIZES = {
  DOCUMENT: 10 * 1024 * 1024, // 10MB
  IMAGE: 5 * 1024 * 1024,     // 5MB
  AVATAR: 2 * 1024 * 1024,    // 2MB
  TEMPLATE: 5 * 1024 * 1024   // 5MB
};

/**
 * Creates a robust file filter for multer.
 * Checks extension denylists and allowed safelists.
 * Note: MIME type checking via Multer is easily spoofed, 
 * so it serves as a pre-filter before magic-byte inspection.
 */
export const createFileFilter = (allowedExtensions) => {
  return (req, file, cb) => {
    const originalName = file.originalname.toLowerCase();
    
    // Check for double extensions (e.g. file.php.jpg)
    const parts = originalName.split('.');
    if (parts.length > 2) {
      // If there are multiple parts, check if any intermediate part is a blocked extension
      for (let i = 1; i < parts.length - 1; i++) {
        if (BLOCKED_EXTENSIONS.includes(`.${parts[i]}`)) {
          return cb(new Error(`Double extension bypass detected: .${parts[i]}`));
        }
      }
    }

    const ext = '.' + parts[parts.length - 1];

    if (BLOCKED_EXTENSIONS.includes(ext)) {
      return cb(new Error(`Dangerous file type blocked: ${ext}`));
    }

    if (!allowedExtensions.includes(ext)) {
      return cb(new Error(`Unsupported file type: ${ext}. Allowed: ${allowedExtensions.join(', ')}`));
    }

    // BUG-014: do NOT reject on the client-supplied MIME header — it is trivially
    // spoofable and rejects legitimate files whose browser-reported type differs
    // slightly from our table. The authoritative check is the magic-byte
    // inspection in processFileSecurity() (upload.middleware.js), which runs after
    // multer. Extension allow/block lists above remain the fast pre-filter.

    cb(null, true);
  };
};
