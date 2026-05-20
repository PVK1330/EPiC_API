import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure uploads directory exists
const uploadDir = 'uploads/temp/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

export const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

export const handleProfilePicUpload = memoryUpload.single('profile_pic');

export const handleDocumentUpload = (req, res, next) => {
  upload.array("files", 10)(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        status: "error",
        message: `Unexpected file field "${err.field}". Use field name "files".`,
        data: null,
      });
    }
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        status: "error",
        message: "File is too large (max 10 MB).",
        data: null,
      });
    }
    return res.status(400).json({
      status: "error",
      message: err.message || "File upload failed",
      data: null,
    });
  });
};

export const handleMessageFileUpload = upload.single('file');

export const handleCandidateIssueReportUpload = upload.single('evidence');

export const handleSponsorRegistrationUpload = upload.array('documents', 5); // Max 5 documents

const cclTemplateDir = 'uploads/ccl-templates/';
if (!fs.existsSync(cclTemplateDir)) {
  fs.mkdirSync(cclTemplateDir, { recursive: true });
}

const cclTemplateStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, cclTemplateDir);
  },
  filename: (req, file, cb) => {
    const visaId = req.params?.id || 'unknown';
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `visa-${visaId}-${uniqueSuffix}${ext}`);
  },
});

const cclTemplateUpload = multer({
  storage: cclTemplateStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.docx' || ext === '.pdf') {
      cb(null, true);
      return;
    }
    cb(new Error('Only .docx and .pdf files are allowed.'));
  },
});

const orgLogoDir = 'uploads/organisations/';
if (!fs.existsSync(orgLogoDir)) {
  fs.mkdirSync(orgLogoDir, { recursive: true });
}

const orgLogoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, orgLogoDir);
  },
  filename: (req, file, cb) => {
    const orgId = req.user?.organisation_id || 'org';
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `org-${orgId}-${uniqueSuffix}${ext}`);
  },
});

const orgLogoUpload = multer({
  storage: orgLogoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error('Logo must be PNG, JPG, WEBP, or SVG.'));
  },
});

export const handleOrganisationLogoUpload = (req, res, next) => {
  orgLogoUpload.single('logo')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        status: 'error',
        message: 'Logo file is too large (max 2 MB).',
        data: null,
      });
    }
    return res.status(400).json({
      status: 'error',
      message: err.message || 'Logo upload failed',
      data: null,
    });
  });
};

export const handleCclTemplateUpload = (req, res, next) => {
  cclTemplateUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        status: 'error',
        message: 'File is too large (max 5 MB).',
        data: null,
      });
    }
    return res.status(400).json({
      status: 'error',
      message: err.message || 'File upload failed',
      data: null,
    });
  });
};

// ── Platform branding (logo + favicon) ──────────────────────────────────────
const platformBrandDir = 'uploads/platform/';
if (!fs.existsSync(platformBrandDir)) {
  fs.mkdirSync(platformBrandDir, { recursive: true });
}

const platformBrandStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, platformBrandDir);
  },
  filename: (req, file, cb) => {
    // field name is either "logo" or "favicon" — use it as the stable filename
    // so re-uploading replaces the previous file predictably
    const field = file.fieldname === 'favicon' ? 'favicon' : 'logo';
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `platform-${field}${ext}`);
  },
});

const platformBrandUpload = multer({
  storage: platformBrandStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) { cb(null, true); return; }
    cb(new Error('Image must be PNG, JPG, WEBP, SVG, or ICO.'));
  },
});

const makePlatformBrandHandler = (field) => (req, res, next) => {
  platformBrandUpload.single(field)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ status: 'error', message: 'File too large (max 2 MB).', data: null });
    }
    return res.status(400).json({ status: 'error', message: err.message || 'Upload failed', data: null });
  });
};

export const handlePlatformLogoUpload    = makePlatformBrandHandler('logo');
export const handlePlatformFaviconUpload = makePlatformBrandHandler('favicon');
