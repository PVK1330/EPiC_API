import sharp from 'sharp';
import logger from '../utils/logger.js';

class ImageSanitizerService {
  /**
   * Sanitizes an image buffer by completely re-encoding it using sharp.
   * This strips EXIF data, embedded profiles, and any malicious polyglot payloads.
   * 
   * @param {Buffer} buffer - The raw uploaded image buffer
   * @param {string} originalMime - The detected mime type
   * @returns {Promise<Buffer>} - The sanitized, re-encoded image buffer
   */
  async sanitizeImage(buffer, originalMime) {
    try {
      // SVGs are explicitly blocked earlier, but we enforce it here just in case.
      if (originalMime === 'image/svg+xml') {
        throw new Error('SVG images are not permitted due to XSS risks.');
      }

      // Initialize sharp instance
      let image = sharp(buffer, { failOn: 'truncated' });
      
      const metadata = await image.metadata();
      
      // Determine format to save as (convert non-standard to JPEG or keep standard)
      const format = ['jpeg', 'png', 'webp'].includes(metadata.format) 
        ? metadata.format 
        : 'jpeg';

      // Re-encode and strip metadata
      // .withMetadata() is explicitly NOT called, which means EXIF is stripped
      const sanitizedBuffer = await image
        .toFormat(format, { quality: 85 })
        .toBuffer();

      return sanitizedBuffer;
    } catch (error) {
      logger.error({ err: error }, 'Image sanitization failed');
      throw new Error(`Failed to process image: ${error.message}`);
    }
  }
}

export const imageSanitizer = new ImageSanitizerService();
