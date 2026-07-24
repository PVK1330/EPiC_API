import { renderCclPdfBuffer } from './src/services/cclGenerator.service.js';
import fs from 'fs';

const html = `
<table border="1">
  <tr>
    <td>Transfer UKVI visa fees</td>
    <td>Transfer shivora Management Fees</td>
    <td colspan="6"></td>
  </tr>
  <tr>
    <td>Bank - HSBC</td>
    <td>Company name - shivora</td>
    <td>Account No - 55332788</td>
    <td>Sort Code - 40-35-18</td>
    <td>Bank - HSBC</td>
    <td>Company name - shivora</td>
    <td>Account No 25101352</td>
    <td>Sort Code 40-11-18</td>
  </tr>
</table>
`;

import htmlToPdfmake from "html-to-pdfmake";
import jsdom from "jsdom";
const { JSDOM } = jsdom;
const { window } = new JSDOM("");

async function test() {
  try {
    const buffer = await renderCclPdfBuffer({ html });
    fs.writeFileSync('test_output.pdf', buffer);
    console.log("PDF generated successfully! test passed.");
  } catch (error) {
    console.error("PDF generation failed:", error);
  }
}

test();
