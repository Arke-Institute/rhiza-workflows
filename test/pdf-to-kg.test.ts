/**
 * PDF to KG Workflow Tests
 *
 * Tests pdf-to-kg-basic, pdf-to-kg-full, and pdf-to-kg-recursive workflows.
 * Pipeline: scatter → pdf_convert → ocr → extract → dedupe (→ cluster → describe [→ recurse])
 *
 * Uses scanned.pdf (600K government doc, PDF v1.6) which triggers render mode
 * instead of text extraction, exercising the full OCR pipeline.
 *
 * NOTE: These tests produce 500-700+ workflow logs. Tree traversal polling is
 * very slow at this scale (~3-5 min per poll with 700 nodes), so timeouts are
 * set to 1800s (30 min) for full/recursive tiers.
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
} from './helpers';

const PDF_TO_KG_BASIC_RHIZA = process.env.PDF_TO_KG_BASIC_RHIZA;
const PDF_TO_KG_FULL_RHIZA = process.env.PDF_TO_KG_FULL_RHIZA;
const PDF_TO_KG_RECURSIVE_RHIZA = process.env.PDF_TO_KG_RECURSIVE_RHIZA;

describe('pdf-to-kg workflows', () => {
  let collectionId: string;

  beforeAll(() => { initTestClient(); });

  beforeAll(async () => {
    if (!ARKE_USER_KEY) return;
    const col = await setupTestCollection('PDF to KG Test');
    collectionId = col.id;
  });

  async function createPdf(label: string) {
    return createFileEntity({
      collectionId,
      label,
      filename: 'scanned.pdf',
      contentType: 'application/pdf',
      fixturePath: fixturePath('scanned.pdf'),
    });
  }

  it.skipIf(!ARKE_USER_KEY || !PDF_TO_KG_BASIC_RHIZA)(
    'pdf-to-kg-basic: convert PDF, OCR, extract, dedupe',
    async () => {
      const entity = await createPdf('Scanned PDF for KG Basic');

      // allowErrors: some PDF pages have images with no extractable text
      const { logs } = await runWorkflow({
        rhizaId: PDF_TO_KG_BASIC_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 900000,
        allowErrors: true,
        pollInterval: 15000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.PDF_TO_JPEG]: { min: 1 },
        [KLADOS_IDS.OCR_WORKER]: { min: 1 },
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
      });

      log('pdf-to-kg-basic completed successfully');
    },
    900000,
  );

  it.skipIf(!ARKE_USER_KEY || !PDF_TO_KG_FULL_RHIZA)(
    'pdf-to-kg-full: convert, OCR, extract, dedupe, cluster, describe',
    async () => {
      const entity = await createPdf('Scanned PDF for KG Full');

      // allowErrors: some PDF pages have images with no extractable text
      const { logs } = await runWorkflow({
        rhizaId: PDF_TO_KG_FULL_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 1800000,
        allowErrors: true,
        pollInterval: 15000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.PDF_TO_JPEG]: { min: 1 },
        [KLADOS_IDS.OCR_WORKER]: { min: 1 },
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
        [KLADOS_IDS.KG_CLUSTER]: { min: 1 },
        // DESCRIBE may not run if cluster produces no output
      });

      log('pdf-to-kg-full completed successfully');
    },
    1800000,
  );

  it.skipIf(!ARKE_USER_KEY || !PDF_TO_KG_RECURSIVE_RHIZA)(
    'pdf-to-kg-recursive: full pipeline with recursive clustering',
    async () => {
      const entity = await createPdf('Scanned PDF for KG Recursive');

      // allowErrors: some PDF pages have images with no extractable text
      const { logs } = await runWorkflow({
        rhizaId: PDF_TO_KG_RECURSIVE_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 1800000,
        allowErrors: true,
        pollInterval: 15000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.PDF_TO_JPEG]: { min: 1 },
        [KLADOS_IDS.OCR_WORKER]: { min: 1 },
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
        [KLADOS_IDS.KG_CLUSTER]: { min: 1 },
        // DESCRIBE may not run if cluster produces no output
      });

      log('pdf-to-kg-recursive completed successfully');
    },
    1800000,
  );
});
