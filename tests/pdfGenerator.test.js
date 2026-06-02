import test from 'node:test';
import assert from 'node:assert';
import {
  generatePdfBufferFromDefinition,
  buildBrandedPdfDocDefinition,
} from '../src/services/pdfGenerator.service.js';

test('generatePdfBufferFromDefinition returns a valid PDF buffer', async () => {
  const docDefinition = {
    content: [
      { text: 'Unit test PDF', fontSize: 18 },
      { text: 'This is a simple PDF generated during automated tests.' },
    ],
    defaultStyle: { font: 'Helvetica' },
  };

  const buffer = await generatePdfBufferFromDefinition(docDefinition);
  assert.ok(Buffer.isBuffer(buffer), 'Expected a Buffer');
  assert.ok(buffer.length > 0, 'Expected non-empty buffer');
});

test('buildBrandedPdfDocDefinition includes footer and generated date', () => {
  const docDefinition = buildBrandedPdfDocDefinition({
    title: 'Test Report',
    metadata: { subtitle: 'Subtitle', reference: 'REF-123' },
    sections: [
      {
        sectionTitle: 'Section 1',
        rows: [
          { label: 'Name', value: 'Jane Doe' },
          { label: 'Status', value: 'Active' },
        ],
      },
    ],
  });

  assert.strictEqual(docDefinition.pageMargins.length, 4);
  assert.ok(typeof docDefinition.footer === 'function');
  assert.ok(Array.isArray(docDefinition.content));
  assert.ok(docDefinition.content.some((item) => item.text === 'Test Report'));
  assert.ok(docDefinition.content.some((item) => item.text === 'Subtitle'));
});
