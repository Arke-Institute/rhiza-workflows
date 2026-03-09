/**
 * Generate a 6-page digital PDF fixture for page grouping tests.
 *
 * Each page contains distinct, entity-rich text content that can be
 * verified after page grouping concatenation.
 *
 * Run: npx tsx test/fixtures/generate-multipage-pdf.ts
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Known text content per page — tests assert against these.
 * Each page has distinct named entities for KG extraction verification.
 */
export const PAGE_CONTENTS = [
  // Page 1
  'Albert Einstein developed the theory of general relativity in Berlin, Germany. His work at the Kaiser Wilhelm Institute transformed modern physics and our understanding of spacetime.',
  // Page 2
  'Marie Curie conducted groundbreaking research on radioactivity at the University of Paris. She was the first woman to win a Nobel Prize and remains the only person to win Nobel Prizes in two different sciences.',
  // Page 3
  'The Apollo 11 mission launched from Kennedy Space Center in Florida on July 16, 1969. Neil Armstrong and Buzz Aldrin became the first humans to walk on the Moon while Michael Collins orbited above.',
  // Page 4
  'The construction of the Panama Canal was completed in 1914 by the United States Army Corps of Engineers. The canal connects the Atlantic Ocean to the Pacific Ocean through the Isthmus of Panama.',
  // Page 5
  'Ada Lovelace wrote the first computer algorithm for Charles Babbage\'s Analytical Engine in London, England. She is widely regarded as the first computer programmer in history.',
  // Page 6
  'The Treaty of Westphalia was signed in 1648 in Osnabruck and Munster, establishing the principle of state sovereignty in Europe. It ended the Thirty Years War and the Eighty Years War.',
];

async function generateMultipagePdf(): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < PAGE_CONTENTS.length; i++) {
    const page = doc.addPage([612, 792]); // US Letter
    const text = PAGE_CONTENTS[i];
    const fontSize = 12;
    const margin = 72;
    const maxWidth = page.getWidth() - 2 * margin;

    // Page header
    page.drawText(`Page ${i + 1}`, {
      x: margin,
      y: page.getHeight() - margin,
      size: 18,
      font,
    });

    // Word-wrap the content text
    const words = text.split(' ');
    let line = '';
    let y = page.getHeight() - margin - 40;
    const lineHeight = fontSize * 1.4;

    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      if (width > maxWidth && line) {
        page.drawText(line, { x: margin, y, size: fontSize, font });
        y -= lineHeight;
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) {
      page.drawText(line, { x: margin, y, size: fontSize, font });
    }
  }

  const pdfBytes = await doc.save();
  const outputPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'digital-multipage.pdf');
  fs.writeFileSync(outputPath, pdfBytes);
  console.log(`Generated ${outputPath} (${pdfBytes.length} bytes, ${PAGE_CONTENTS.length} pages)`);
}

generateMultipagePdf().catch(console.error);
