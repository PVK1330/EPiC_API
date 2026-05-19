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
