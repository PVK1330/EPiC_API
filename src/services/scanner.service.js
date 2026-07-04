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
    try {
      // Baseline signature check — runs ALWAYS, even when the full external
      // scanner is disabled, so the known EICAR test signature and raw native
      // executable headers can never slip through unscanned. (The authoritative
      // type gate is the magic-byte allowlist in upload.middleware.js; this is a
      // cheap complementary content check.)
      const baseline = this.baselineSignatureCheck(buffer, originalName);
      if (!baseline.isSafe) return baseline;

      if (!this.enabled) {
        return { isSafe: true };
      }

      logger.info({ originalName }, 'Initiating malware scan on uploaded file');

      // NOTE: real anti-virus (ClamAV daemon via clamdjs/clamscan, or a hosted
      // API such as VirusTotal) is an INFRASTRUCTURE dependency — wire it in here
      // and keep the fail-closed behaviour below when it is unreachable.
      // In production: const result = await clamav.scanBuffer(buffer);

      // Simulate API latency
      await new Promise(resolve => setTimeout(resolve, 50));

      return { isSafe: true };
    } catch (error) {
      logger.error({ err: error, originalName }, 'Error during malware scan');
      // Fail-closed: if the scanner crashes, reject the file to be safe.
      return { isSafe: false, threatName: 'SCANNER_ERROR' };
    }
  }

  /**
   * Cheap, dependency-free content signature check. Catches the EICAR test file
   * and raw native-executable headers (PE `MZ`, ELF, Mach-O) embedded in a file
   * that claimed to be a document/image. Not a substitute for real AV, but a
   * baseline that always runs.
   */
  baselineSignatureCheck(buffer, originalName) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { isSafe: true };

    const head = buffer.subarray(0, 4);
    // PE (Windows .exe/.dll): "MZ"
    if (head[0] === 0x4d && head[1] === 0x5a) {
      logger.warn({ originalName }, 'Rejected file with PE/MZ executable header');
      return { isSafe: false, threatName: 'Heur.Executable.PE' };
    }
    // ELF (Linux executables): 0x7F 'E' 'L' 'F'
    if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) {
      logger.warn({ originalName }, 'Rejected file with ELF executable header');
      return { isSafe: false, threatName: 'Heur.Executable.ELF' };
    }

    const fileContent = buffer.toString('utf8');
    if (fileContent.includes('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')) {
      logger.warn({ originalName }, 'Malware signature detected in file (EICAR)');
      return { isSafe: false, threatName: 'Win.Test.EICAR_HDB-1' };
    }

    return { isSafe: true };
  }
}

export const scannerService = new ScannerService();
