/**
 * Digital PDF Routing Test
 *
 * Verifies that digital (text-based) PDFs route around OCR.
 * The pdf_convert step should detect native text and set needs_ocr: false,
 * causing the workflow to skip OCR and go directly to KG extraction.
 *
 * Key assertion: OCR worker should NOT run for any page of a digital PDF.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { log } from '@arke-institute/klados-testing';
import {
  ARKE_USER_KEY,
  KLADOS_IDS,
  initTestClient,
  setupTestCollection,
  createFileEntity,
  fixturePath,
  runWorkflow,
  assertKladosRan,
  assertKladosDidNotRun,
  filterLogs,
} from './helpers';

const PDF_TO_KG_BASIC_RHIZA = process.env.PDF_TO_KG_BASIC_RHIZA;

describe('digital PDF routing', () => {
  let collectionId: string;

  beforeAll(() => { initTestClient(); });

  beforeAll(async () => {
    if (!ARKE_USER_KEY) return;
    const col = await setupTestCollection('Digital PDF Routing Test');
    collectionId = col.id;
  });

  it.skipIf(!ARKE_USER_KEY || !PDF_TO_KG_BASIC_RHIZA)(
    'digital PDF skips OCR and routes directly to extraction',
    async () => {
      const entity = await createFileEntity({
        collectionId,
        label: 'Digital PDF (no OCR needed)',
        filename: 'digital.pdf',
        contentType: 'application/pdf',
        fixturePath: fixturePath('digital.pdf'),
      });

      log(`Created digital PDF entity: ${entity.id}`);

      const { logs } = await runWorkflow({
        rhizaId: PDF_TO_KG_BASIC_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 300000,
        allowErrors: true,
        pollInterval: 5000,
      });

      // PDF-to-JPEG should run (it does the text extraction + type detection)
      assertKladosRan(logs, {
        [KLADOS_IDS.PDF_TO_JPEG]: { min: 1 },
      });

      // OCR should NOT run - digital PDF text pages have needs_ocr: false
      const ocrLogs = filterLogs(logs, KLADOS_IDS.OCR_WORKER);
      log(`OCR logs: ${ocrLogs.length} (expected 0 for pure digital PDF)`);

      // If there are embedded images, some OCR logs are acceptable.
      // But for our simple test PDF with no images, OCR should be skipped entirely.
      assertKladosDidNotRun(logs, KLADOS_IDS.OCR_WORKER);

      // KG extraction should still run (routed directly from pdf_convert)
      assertKladosRan(logs, {
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
      });

      log('Digital PDF routing test passed - OCR was skipped');
    },
    300000,
  );
});
