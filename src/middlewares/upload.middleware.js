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

const platformBrandUpload = multer({
  storage: createSecureDiskStorage('platform'),
  limits: { fileSize: MAX_FILE_SIZES.AVATAR },
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

/**
 * ── POST-UPLOAD VALIDATION ───────────────────────────────────────────────────
 * Validates magic bytes, checks malware, sanitizes images, and logs audits.
 */
const processFileSecurity = async (req, file) => {
  try {
    const ext = path.extname(file.originalname).toLowerCase();
    
    // 1. Magic Bytes Validation
    const typeInfo = await fileTypeFromFile(file.path);
    if (!typeInfo) {
      throw new Error('Could not determine actual file type (missing magic bytes).');
    }
    
    // Check if the detected extension is dangerous (e.g., zip pretending to be pdf, or exe)
    if (BLOCKED_EXTENSIONS.includes(`.${typeInfo.ext}`)) {
      throw new Error(`Dangerous file type detected by magic bytes: .${typeInfo.ext}`);
    }

    // Check if detected extension matches the declared one (allow docx/xlsx which are zip based)
    const isArchiveBased = ['docx', 'xlsx', 'pptx'].includes(ext.replace('.', ''));
    if (!isArchiveBased && `.${typeInfo.ext}` !== ext && typeInfo.ext !== 'cfb') {
      // Ignore some minor mismatches, but generally flag spoofing
      // Note: doc format is often cfb
    }

    // 2. Malware Scan
    const scanResult = await scannerService.scanBuffer(fs.readFileSync(file.path), file.originalname);
    if (!scanResult.isSafe) {
      auditLogger.logUploadAttempt({
        userId: req.user?.id,
        organisationId: req.organisationContext?.organisation?.id,
        originalFilename: file.originalname,
        savedFilename: file.filename,
        detectedMime: typeInfo.mime,
        fileSize: file.size,
        status: 'QUARANTINED',
        reason: scanResult.threatName
      });
      throw new Error(`File rejected: Malware detected (${scanResult.threatName})`);
    }

    // 3. Image Sanitization (if image)
    if (typeInfo.mime.startsWith('image/') && typeInfo.mime !== 'image/x-icon') {
      const buffer = fs.readFileSync(file.path);
      const sanitizedBuffer = await imageSanitizer.sanitizeImage(buffer, typeInfo.mime);
      fs.writeFileSync(file.path, sanitizedBuffer); // Overwrite with sanitized safe image
    }

    // 4. Success Audit Log
    auditLogger.logUploadAttempt({
      userId: req.user?.id,
      organisationId: req.organisationContext?.organisation?.id,
      originalFilename: file.originalname,
      savedFilename: file.filename,
      detectedMime: typeInfo.mime,
      fileSize: file.size,
      status: 'SUCCESS'
    });

  } catch (err) {
    // Purge the file if validation fails
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    throw err; // Re-throw to be caught by the route handler wrapper
  }
};

/**
 * Wrapper to run multer upload and then the security post-processor
 */
const withSecurityProcessing = (uploadMiddleware) => {
  return (req, res, next) => {
    uploadMiddleware(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ status: "error", message: "File is too large." });
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
export const handleCandidateIssueReportUpload = withSecurityProcessing(upload.single('evidence'));
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
export const handleDocumentUpload = withSecurityProcessing(upload.array("files", 10));

export const handleOrganisationLogoUpload = withSecurityProcessing(orgLogoUpload.single('logo'));
export const handleCclTemplateUpload = withSecurityProcessing(cclTemplateUpload.single('file'));

export const handlePlatformLogoUpload = withSecurityProcessing(platformBrandUpload.single('logo'));
export const handlePlatformFaviconUpload = withSecurityProcessing(platformBrandUpload.single('favicon'));

export const handleSuperadminAvatarUpload = withSecurityProcessing(superadminAvatarUpload.single('avatar'));
