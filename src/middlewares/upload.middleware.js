import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use a temporary path initially, we'll move files later
    const tempPath = path.join('uploads', 'temp');
    
    // Create temp directory if it doesn't exist
    fs.mkdirSync(tempPath, { recursive: true });
    
    cb(null, tempPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `${timestamp}_${originalName}`;
    cb(null, filename);
  }
});

const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/zip',
    'application/x-zip-compressed'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images, PDFs, documents, and zip files are allowed.'), false);
  }
};

export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 10 // Maximum 10 files at once (needed for sponsor registration)
  }
});

export const handleDocumentUpload = upload.array('documents', 5);

// Profile picture upload middleware
export const handleProfilePicUpload = upload.single('profile_pic');

/** Candidate issue reports: images only (screenshots, photos), max 5 × 5MB */
const issueReportImageFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, GIF, or WebP images are allowed for issue reports.'), false);
  }
};

const uploadIssueImages = multer({
  storage,
  fileFilter: issueReportImageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 5,
  },
});

export const handleCandidateIssueReportUpload = uploadIssueImages.array('attachments', 5);

// Message file upload middleware
export const handleMessageFileUpload = upload.single('file');

// Sponsor registration documents upload middleware
export const handleSponsorRegistrationUpload = upload.fields([
  { name: 'profile_pic', maxCount: 1 },
  { name: 'sponsorLetter', maxCount: 1 },
  { name: 'insuranceCertificate', maxCount: 1 },
  { name: 'hrPolicies', maxCount: 1 },
  { name: 'organisationalChart', maxCount: 1 },
  { name: 'recruitmentDocs', maxCount: 1 }
]);
