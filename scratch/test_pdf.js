import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PdfPrinter = require('pdfmake');
console.log('PdfPrinter type:', typeof PdfPrinter);






import fs from 'fs';

const fonts = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

try {
  const printer = new PdfPrinter(fonts);
  const docDefinition = { content: 'Test' };
  const pdfDoc = printer.createPdfKitDocument(docDefinition);
  pdfDoc.pipe(fs.createWriteStream('test.pdf'));
  pdfDoc.end();
  console.log('PDF created successfully');
} catch (error) {
  console.error('PDF creation failed:', error);
}
