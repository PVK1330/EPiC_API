import logger from '../utils/logger.js';

/**
 * AuditLoggerService specifically handles logging of sensitive security events
 * related to file handling, such as uploads, quarantine, and downloads.
 */
class AuditLoggerService {
  /**
   * Log an upload attempt.
   * 
   * @param {Object} params
   * @param {string} params.userId - ID of the user uploading
   * @param {string} params.organisationId - Tenant ID
   * @param {string} params.originalFilename - Client-provided filename
   * @param {string} params.savedFilename - Server-generated secure filename
   * @param {string} params.detectedMime - The MIME type detected by magic bytes
   * @param {number} params.fileSize - Size of the file in bytes
   * @param {'SUCCESS' | 'REJECTED' | 'QUARANTINED'} params.status - Result status
   * @param {string} [params.reason] - Reason for rejection/quarantine
   */
  logUploadAttempt({
    userId,
    organisationId,
    originalFilename,
    savedFilename,
    detectedMime,
    fileSize,
    status,
    reason,
  }) {
    const logData = {
      event: 'FILE_UPLOAD',
      userId: userId || 'anonymous',
      organisationId: organisationId || 'system',
      file: {
        originalName: originalFilename,
        savedName: savedFilename,
        mimeType: detectedMime,
        sizeBytes: fileSize,
      },
      status,
      reason,
      timestamp: new Date().toISOString(),
    };

    if (status === 'SUCCESS') {
      logger.info(logData, 'File upload succeeded');
    } else if (status === 'QUARANTINED') {
      logger.warn(logData, 'File upload quarantined (malware detected)');
    } else {
      logger.warn(logData, 'File upload rejected (validation failed)');
    }
  }

  /**
   * Log a file download attempt.
   */
  logDownloadAttempt({
    userId,
    organisationId,
    documentId,
    status,
    reason
  }) {
    const logData = {
      event: 'FILE_DOWNLOAD',
      userId: userId || 'anonymous',
      organisationId: organisationId || 'system',
      documentId,
      status,
      reason,
      timestamp: new Date().toISOString(),
    };

    if (status === 'SUCCESS') {
      logger.info(logData, 'File download succeeded');
    } else {
      logger.warn(logData, 'File download rejected (unauthorized or not found)');
    }
  }
}

export const auditLogger = new AuditLoggerService();
