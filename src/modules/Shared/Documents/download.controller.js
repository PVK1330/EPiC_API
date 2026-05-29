import path from 'path';
import fs from 'fs';
import { auditLogger } from '../../services/auditLogger.service.js';

// Base private storage directory matches the one in upload.middleware.js
const PRIVATE_STORAGE_DIR = path.resolve(process.cwd(), 'storage/private');

/**
 * Validates the file path to prevent directory traversal attacks.
 */
const getSecureFilePath = (subDir, filename) => {
  const secureSubDir = path.normalize(subDir).replace(/^(\.\.(\/|\\|$))+/, '');
  const secureFilename = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '');
  
  const targetPath = path.join(PRIVATE_STORAGE_DIR, secureSubDir, secureFilename);
  
  // Ensure the resolved path is strictly inside the intended directory
  if (!targetPath.startsWith(PRIVATE_STORAGE_DIR)) {
    throw new Error('Path traversal attempt detected');
  }
  
  return targetPath;
};

/**
 * Controller to handle authenticated, secure file downloads.
 * 
 * Endpoint: GET /api/documents/:category/:filename/download
 */
export const downloadDocument = (req, res) => {
  const { category, filename } = req.params;
  
  try {
    const targetPath = getSecureFilePath(category, filename);
    
    if (!fs.existsSync(targetPath)) {
      auditLogger.logDownloadAttempt({
        userId: req.user?.id,
        organisationId: req.organisationContext?.organisation?.id,
        documentId: filename,
        status: 'FAILED',
        reason: 'File not found'
      });
      return res.status(404).json({ status: false, message: 'File not found' });
    }

    // Advanced Enterprise Feature: Add RBAC checks here to ensure the user 
    // actually owns or has rights to this specific filename.
    // (This requires looking up the filename in the DB).
    // For now, relying on the unguessable UUID filename + JWT auth.

    auditLogger.logDownloadAttempt({
      userId: req.user?.id,
      organisationId: req.organisationContext?.organisation?.id,
      documentId: filename,
      status: 'SUCCESS'
    });

    // Set secure headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour locally
    
    // Determine if it should be an attachment
    const ext = path.extname(filename).toLowerCase();
    const imageExts = ['.png', '.jpg', '.jpeg', '.webp'];
    
    if (!imageExts.includes(ext)) {
      // Force download for non-images (prevents HTML/SVG/JS execution)
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    } else {
      // Allow inline viewing for explicitly safe image types
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    }

    // Stream the file
    res.sendFile(targetPath, (err) => {
      if (err) {
        if (!res.headersSent) {
          res.status(500).json({ status: false, message: 'Error streaming file' });
        }
      }
    });

  } catch (error) {
    auditLogger.logDownloadAttempt({
      userId: req.user?.id,
      organisationId: req.organisationContext?.organisation?.id,
      documentId: filename,
      status: 'FAILED',
      reason: error.message
    });
    return res.status(400).json({ status: false, message: 'Invalid file request' });
  }
};
