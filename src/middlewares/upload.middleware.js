import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileTypeFromFile } from 'file-type';
import { 
  ALLOWED_DOCUMENT_EXTENSIONS, 
  ALLOWED_IMAGE_EXTENSIONS, 
  MAX_FILE_SIZES, 
  createFileFilter,
  BLOCKED_EXTENSIONS
} from '../config/fileSecurity.config.js';
import { scannerService } from '../services/scanner.service.js';
import { imageSanitizer } from '../services/imageSanitizer.service.js';
import { auditLogger } from '../services/auditLogger.service.js';
import { uploadLimiter } from './uploadRateLimiter.js';
import logger from '../utils/logger.js';

// Base private storage directory
const PRIVATE_STORAGE_DIR = path.resolve(process.cwd(), 'storage/private');

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

ensureDir(PRIVATE_STORAGE_DIR);

/**
 * Helper to generate secure filenames
 */
const generateSecureFilename = (originalName) => {
  const parts = originalName.toLowerCase().split('.');
  const ext = parts.length > 1 ? '.' + parts[parts.length - 1] : '';
  
  // Enforce no double extension bypass by validating intermediate parts in filter
  const timestamp = Math.floor(Date.now() / 1000);
  return `${uuidv4()}_${timestamp}${ext}`;
};

/**
 * Creates disk storage in a specific subdirectory of storage/private
 */
const createSecureDiskStorage = (subDir) => {
  const fullPath = path.join(PRIVATE_STORAGE_DIR, subDir);
  ensureDir(fullPath);
  
  return multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, fullPath);
    },
    filename: (req, file, cb) => {
      cb(null, generateSecureFilename(file.originalname));
    }
  });
};

/**
 * Base document & image upload instances
 */
const generalFileFilter = createFileFilter([...ALLOWED_DOCUMENT_EXTENSIONS, ...ALLOWED_IMAGE_EXTENSIONS]);
const imageOnlyFilter = createFileFilter(ALLOWED_IMAGE_EXTENSIONS);
const templateFilter = createFileFilter(['.pdf', '.docx']);

export const upload = multer({
  storage: createSecureDiskStorage('temp'),
  limits: { fileSize: MAX_FILE_SIZES.DOCUMENT },
  fileFilter: generalFileFilter
});

export const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZES.DOCUMENT },
  fileFilter: generalFileFilter
});

// upload-security-2: bulk-import (CSV/XLSX) upload with an explicit size limit
// and a spreadsheet-only filter. Bulk-import controllers previously used a bare
// `multer({ storage: memoryStorage() })` with NO limit and NO filter — a
// memory-DoS + unrestricted-type + XLSX zip-bomb vector. Controllers must still
// cap the parsed row count before trusting the sheet (see MAX_BULK_IMPORT_ROWS).
const spreadsheetFilter = createFileFilter(['.csv', '.xlsx', '.xls']);
export const bulkImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZES.DOCUMENT, files: 1 },
  fileFilter: spreadsheetFilter,
});
export const handleBulkImportUpload = bulkImportUpload.single('file');

// Hard cap on rows a bulk-import file may contain — enforced in controllers
// before iterating, so an attacker cannot amplify a small upload into millions
// of row inserts.
export const MAX_BULK_IMPORT_ROWS = 5000;

const cclTemplateUpload = multer({
  storage: createSecureDiskStorage('ccl-templates'),
  limits: { fileSize: MAX_FILE_SIZES.TEMPLATE },
  fileFilter: templateFilter
});

const orgLogoUpload = multer({
  storage: createSecureDiskStorage('organisations'),
  limits: { fileSize: MAX_FILE_SIZES.AVATAR },
  fileFilter: imageOnlyFilter
});

const orgFaviconUpload = multer({
  storage: createSecureDiskStorage('organisations'),
  limits: { fileSize: MAX_FILE_SIZES.FAVICON },
  fileFilter: createFileFilter([...ALLOWED_IMAGE_EXTENSIONS, '.ico'])
});

const platformBrandUpload = multer({
  storage: createSecureDiskStorage('platform'),
  limits: { fileSize: MAX_FILE_SIZES.AVATAR },
  fileFilter: createFileFilter(ALLOWED_IMAGE_EXTENSIONS)
});

// Favicons are tiny; cap at 512 KB and allow .ico + standard image formats.
// .ico is explicitly included because ALLOWED_IMAGE_EXTENSIONS excludes it.
const platformFaviconUpload = multer({
  storage: createSecureDiskStorage('platform'),
  limits: { fileSize: MAX_FILE_SIZES.FAVICON },
  fileFilter: createFileFilter([...ALLOWED_IMAGE_EXTENSIONS, '.ico'])
});

const superadminAvatarUpload = multer({
  storage: createSecureDiskStorage('superadmin'),
  limits: { fileSize: MAX_FILE_SIZES.AVATAR },
  fileFilter: imageOnlyFilter
});

// Tenant/user profile pictures land directly in a PUBLICLY-SERVED subdir
// (storage/private/avatars). Previously they went to storage/private/temp and
// were renamed into uploads/profile_pics/<id>/ — a directory the app no longer
// serves, which is why those avatars stopped rendering. Writing here removes the
// rename step entirely; controllers store toPublicImagePath(req.file.path).
const avatarUpload = multer({
  storage: createSecureDiskStorage('avatars'),
  limits: { fileSize: MAX_FILE_SIZES.AVATAR },
  fileFilter: imageOnlyFilter
});

// Candidate issue-report screenshots. IMAGE-ONLY on purpose: every accepted file
// is therefore re-encoded by the sharp sanitizer in processFileSecurity(), which
// strips embedded payloads — this is our defence given the malware scanner is a
// stub/optional. Capped at the shared 5 MB image limit to match the UI, and
// written under storage/private (NOT the removed public /uploads mount) so the
// files are reachable only through the authenticated download endpoint.
const issueReportUpload = multer({
  storage: createSecureDiskStorage('candidate_reports'),
  limits: { fileSize: MAX_FILE_SIZES.IMAGE },
  fileFilter: imageOnlyFilter
});

// Plain-text formats legitimately have NO magic bytes, so file-type returns
// undefined for them. They are still constrained by the multer extension filter.
const NO_MAGIC_TEXT_EXTS = ['.txt', '.csv'];

// Magic-byte-detected types we accept (upload-security-9 fix — positive
// allowlist, default-deny). Union of our allowed document/image formats plus the
// ZIP/compound-file containers that Office documents (docx/xlsx/doc/xls) present
// as when inspected by content.
const ALLOWED_DETECTED_EXTS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'ico',
  'docx', 'xlsx', 'pptx', 'zip', 'cfb', 'doc', 'xls',
]);

/**
 * ── POST-UPLOAD VALIDATION ───────────────────────────────────────────────────
 * Validates magic bytes, checks malware, sanitizes images, and logs audits.
 * All file reads are async (upload-security-10) to avoid blocking the event loop.
 */
const processFileSecurity = async (req, file) => {
  try {
    const ext = path.extname(file.originalname).toLowerCase();

    const logSuccess = (detectedMime) =>
      auditLogger.logUploadAttempt({
        userId: req.user?.id,
        organisationId: req.organisationContext?.organisation?.id,
        originalFilename: file.originalname,
        savedFilename: file.filename,
        detectedMime,
        fileSize: file.size,
        status: 'SUCCESS',
      });

    // 1. Magic Bytes Validation
    const typeInfo = await fileTypeFromFile(file.path);
    if (!typeInfo) {
      // Accept only genuine no-magic-byte text formats (txt/csv). Anything else
      // that lacks magic bytes is treated as spoofing and rejected.
      if (!NO_MAGIC_TEXT_EXTS.includes(ext)) {
        throw new Error('Could not determine actual file type (missing magic bytes).');
      }
      const textBuf = await fs.promises.readFile(file.path);
      const textScan = await scannerService.scanBuffer(textBuf, file.originalname);
      if (!textScan.isSafe) {
        throw new Error(`File rejected: Malware detected (${textScan.threatName})`);
      }
      logSuccess('text/plain');
      return;
    }

    // upload-security-9: detected type must be neither dangerous NOR outside our
    // allowlist. Previously a mismatch branch was a no-op, so a file whose true
    // magic-byte type was unlisted (spoofed extension) passed through.
    if (BLOCKED_EXTENSIONS.includes(`.${typeInfo.ext}`)) {
      throw new Error(`Dangerous file type detected by magic bytes: .${typeInfo.ext}`);
    }
    if (!ALLOWED_DETECTED_EXTS.has(typeInfo.ext)) {
      throw new Error(`File content type .${typeInfo.ext} is not permitted for this upload.`);
    }

    // 2. Malware Scan (async read)
    const scanResult = await scannerService.scanBuffer(
      await fs.promises.readFile(file.path),
      file.originalname,
    );
    if (!scanResult.isSafe) {
      auditLogger.logUploadAttempt({
        userId: req.user?.id,
        organisationId: req.organisationContext?.organisation?.id,
        originalFilename: file.originalname,
        savedFilename: file.filename,
        detectedMime: typeInfo.mime,
        fileSize: file.size,
        status: 'QUARANTINED',
        reason: scanResult.threatName,
      });
      throw new Error(`File rejected: Malware detected (${scanResult.threatName})`);
    }

    // 3. Image Sanitization (if image) — async read + write
    if (typeInfo.mime.startsWith('image/') && typeInfo.mime !== 'image/x-icon') {
      const buffer = await fs.promises.readFile(file.path);
      const sanitizedBuffer = await imageSanitizer.sanitizeImage(buffer, typeInfo.mime);
      await fs.promises.writeFile(file.path, sanitizedBuffer); // Overwrite with sanitized safe image
    }

    // 4. Success Audit Log
    logSuccess(typeInfo.mime);
  } catch (err) {
    // Purge the file if validation fails
    if (fs.existsSync(file.path)) {
      await fs.promises.unlink(file.path).catch(() => {});
    }
    throw err; // Re-throw to be caught by the route handler wrapper
  }
};

/**
 * Wrapper to run multer upload and then the security post-processor.
 * Exported (upload-security-1) so route files that previously used a raw multer
 * instance can run the full magic-byte + scan + image-sanitise pipeline by
 * wrapping their disk-storage upload: `secureUpload(upload.single('document'))`.
 */
export const withSecurityProcessing = (uploadMiddleware) => {
  return (req, res, next) => {
    uploadMiddleware(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          let limitStr = null;
          if (err.limit) {
            limitStr = err.limit >= 1024 * 1024
              ? `${Math.round(err.limit / (1024 * 1024))} MB`
              : `${Math.round(err.limit / 1024)} KB`;
          }
          const msg = limitStr
            ? `File is too large. Maximum allowed size is ${limitStr}.`
            : 'File is too large.';
          return res.status(400).json({ status: "error", message: msg });
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          // Bare multer text is "Unexpected field" (BUG-030) — say what was wrong.
          const field = err.field ? ` "${err.field}"` : "";
          return res.status(400).json({
            status: "error",
            message: `Upload rejected: unexpected file field${field} or too many files. Please refresh the page and try again.`,
          });
        }
        return res.status(400).json({ status: "error", message: err.message || "File upload failed" });
      }

      try {
        if (req.file) {
          await processFileSecurity(req, req.file);
        } else if (Array.isArray(req.files)) {
          // .single()/.array() -> req.files is an array of files
          for (const file of req.files) {
            await processFileSecurity(req, file);
          }
        } else if (req.files && typeof req.files === 'object') {
          // .fields() -> req.files is an object keyed by field name (each an array)
          for (const fileList of Object.values(req.files)) {
            for (const file of fileList) {
              await processFileSecurity(req, file);
            }
          }
        }
        next();
      } catch (securityErr) {
        return res.status(400).json({ status: "error", message: securityErr.message });
      }
    });
  };
};

// ── EXPORTED HANDLERS ────────────────────────────────────────────────────────
// Profile pics go straight to the served avatars dir (see avatarUpload above).
export const handleProfilePicUpload = withSecurityProcessing(avatarUpload.single('profile_pic'));
export const handleMessageFileUpload = withSecurityProcessing(upload.single('file'));
// The candidate issue-report form sends up to 5 screenshots under the `attachments`
// field, and the controller reads them from req.files (an array). Use the
// image-only, private-storage instance above (see issueReportUpload).
export const handleCandidateIssueReportUpload = withSecurityProcessing(issueReportUpload.array('attachments', 5));
// The sponsor registration form uploads each document under its own field name
// (profile_pic + the five business documents), so multer must accept those named
// fields. Using .array('documents') here caused a multer "Unexpected field" error
// for every other field name. The controller reads req.files[<fieldName>][0].
export const handleSponsorRegistrationUpload = withSecurityProcessing(
  upload.fields([
    { name: 'profile_pic', maxCount: 1 },
    { name: 'sponsorLetter', maxCount: 1 },
    { name: 'insuranceCertificate', maxCount: 1 },
    { name: 'hrPolicies', maxCount: 1 },
    { name: 'organisationalChart', maxCount: 1 },
    { name: 'recruitmentDocs', maxCount: 1 },
  ])
);
// Case / candidate document uploads (BUG-019 / BUG-030). Different screens send the
// file under different field names — the admin case page and the caseworker case
// tab use `files`, the caseworker Documents page (and older clients) use
// `documents`. `.array("files")` rejected every other name with a bare multer
// "Unexpected field" error, so accept all known names and flatten the result back
// to the array shape the controllers already read from `req.files`.
const DOCUMENT_UPLOAD_FIELDS = ["files", "documents", "file", "document"];
const MAX_DOCUMENT_UPLOAD_FILES = 10;
const documentFieldsUpload = withSecurityProcessing(
  upload.fields(DOCUMENT_UPLOAD_FIELDS.map((name) => ({ name, maxCount: MAX_DOCUMENT_UPLOAD_FILES }))),
);
export const handleDocumentUpload = (req, res, next) =>
  documentFieldsUpload(req, res, async () => {
    if (req.files && !Array.isArray(req.files)) {
      req.files = DOCUMENT_UPLOAD_FIELDS.flatMap((name) => req.files[name] || []);
    }
    if (Array.isArray(req.files) && req.files.length > MAX_DOCUMENT_UPLOAD_FILES) {
      await Promise.all(req.files.map((f) => fs.promises.unlink(f.path).catch(() => {})));
      return res.status(400).json({
        status: "error",
        message: `Too many files. You can upload up to ${MAX_DOCUMENT_UPLOAD_FILES} files at a time.`,
      });
    }
    next();
  });

/**
 * upload-security-1/4: one-liner for route files that previously used a raw
 * `upload.single(field)` / `upload.array(field, n)` (disk storage, no magic-byte
 * check, no scan, no image sanitisation, no rate limit). Returns a middleware
 * array that applies the per-user/tenant upload rate limiter AND the full
 * security post-processor. Usage:
 *   router.post('/evidence', ...secureUpload('document'), handler)
 *   router.post('/apply',    ...secureUpload('documents', 10), handler)
 */
export const secureUpload = (field, count = null) => {
  const mw = count == null
    ? upload.single(field)
    : upload.array(field, count);
  return [uploadLimiter, withSecurityProcessing(mw)];
};

export const handleOrganisationLogoUpload = withSecurityProcessing(orgLogoUpload.single('logo'));
export const handleOrganisationFaviconUpload = withSecurityProcessing(orgFaviconUpload.single('favicon'));
export const handleCclTemplateUpload = withSecurityProcessing(cclTemplateUpload.single('file'));

export const handlePlatformLogoUpload = withSecurityProcessing(platformBrandUpload.single('logo'));
export const handlePlatformFaviconUpload = withSecurityProcessing(platformFaviconUpload.single('favicon'));

export const handleSuperadminAvatarUpload = withSecurityProcessing(superadminAvatarUpload.single('avatar'));
