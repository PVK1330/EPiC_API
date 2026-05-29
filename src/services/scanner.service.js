import logger from '../utils/logger.js';

/**
 * ScannerService abstraction layer for malware detection.
 * 
 * In a real-world enterprise environment, this would integrate with:
 * - ClamAV (via clamdjs or clamscan)
 * - VirusTotal API
 * - AWS GuardDuty for S3
 * 
 * This service currently mocks the ClamAV abstraction, logging the check
 * and randomly (or deterministically based on file content) passing it.
 */
class ScannerService {
  constructor() {
    this.enabled = process.env.MALWARE_SCANNER_ENABLED === 'true';
    logger.info(`Malware Scanner is ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Scans a file buffer for malware signatures.
   * 
   * @param {Buffer} buffer - The file buffer to scan
   * @param {string} originalName - The original filename for logging
   * @returns {Promise<{ isSafe: boolean, threatName?: string }>}
   */
  async scanBuffer(buffer, originalName) {
    if (!this.enabled) {
      return { isSafe: true };
    }

    try {
      logger.info({ originalName }, 'Initiating malware scan on uploaded file');
      
      // MOCK CLAMAV INTEGRATION
      // In production: const result = await clamav.scanBuffer(buffer);
      // For this implementation, we will simulate a clean scan 
      // but explicitly catch a mock EICAR test string if present.
      
      const fileContent = buffer.toString('utf8');
      if (fileContent.includes('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')) {
        logger.warn({ originalName }, 'Malware signature detected in file (EICAR)');
        return { isSafe: false, threatName: 'Win.Test.EICAR_HDB-1' };
      }

      // Simulate API latency
      await new Promise(resolve => setTimeout(resolve, 50));

      return { isSafe: true };
    } catch (error) {
      logger.error({ err: error, originalName }, 'Error during malware scan');
      // Fail-safe approach: If the scanner crashes, reject the file to be safe.
      // Alternatively, depending on enterprise policy, could allow with a warning.
      return { isSafe: false, threatName: 'SCANNER_ERROR' };
    }
  }
}

export const scannerService = new ScannerService();
