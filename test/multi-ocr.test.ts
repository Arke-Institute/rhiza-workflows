/**
 * OCR-Only Workflow Tests
 *
 * Tests all OCR-only workflows (no KG extraction):
 * - jpegs-to-ocr: scatter → ocr → done
 * - images-to-ocr: scatter → convert → ocr → done
 * - pdfs-to-ocr: scatter → pdf_convert → ocr → done
 *
 * These tests use multiple input files to verify the scatter pattern.
 * Uses real artwork images (Met collection) and a scanned government PDF.
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
  filterLogs,
} from './helpers';

const JPEGS_TO_OCR_RHIZA = process.env.JPEGS_TO_OCR_RHIZA;
const IMAGES_TO_OCR_RHIZA = process.env.IMAGES_TO_OCR_RHIZA;
const PDFS_TO_OCR_RHIZA = process.env.PDFS_TO_OCR_RHIZA;

describe('ocr-only workflows', () => {
  let collectionId: string;

  beforeAll(() => { initTestClient(); });

  beforeAll(async () => {
    if (!ARKE_USER_KEY) return;
    const col = await setupTestCollection('OCR Workflows Test');
    collectionId = col.id;
  });

  // =========================================================================
  // jpegs-to-ocr
  // =========================================================================

  it.skipIf(!ARKE_USER_KEY || !JPEGS_TO_OCR_RHIZA)(
    'jpegs-to-ocr: scatter 3 JPEGs and OCR each',
    async () => {
      log('Creating 3 JPEG entities...');
      const jpegs = await Promise.all([
        createFileEntity({ collectionId, label: 'Artwork 1', filename: 'artwork-1.jpeg', contentType: 'image/jpeg', fixturePath: fixturePath('artwork-1.jpeg') }),
        createFileEntity({ collectionId, label: 'Artwork 2', filename: 'artwork-2.jpeg', contentType: 'image/jpeg', fixturePath: fixturePath('artwork-2.jpeg') }),
        createFileEntity({ collectionId, label: 'Artwork 3', filename: 'artwork-3.jpeg', contentType: 'image/jpeg', fixturePath: fixturePath('artwork-3.jpeg') }),
      ]);
      const entityIds = jpegs.map(j => j.id);
      log(`Created entities: ${entityIds.join(', ')}`);

      const { logs } = await runWorkflow({
        rhizaId: JPEGS_TO_OCR_RHIZA!,
        entityIds,
        collectionId,
        timeout: 180000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.SCATTER]: { min: 1 },
        [KLADOS_IDS.OCR_WORKER]: { exact: 3 },
      });

      log('jpegs-to-ocr completed successfully');
    },
    180000,
  );

  // =========================================================================
  // images-to-ocr (mixed formats: PNG + WebP)
  // =========================================================================

  it.skipIf(!ARKE_USER_KEY || !IMAGES_TO_OCR_RHIZA)(
    'images-to-ocr: scatter PNGs and WebP, convert and OCR each',
    async () => {
      log('Creating image entities (2 PNG + 1 WebP)...');
      const images = await Promise.all([
        createFileEntity({ collectionId, label: 'Artwork PNG 1', filename: 'artwork-1.png', contentType: 'image/png', fixturePath: fixturePath('artwork-1.png') }),
        createFileEntity({ collectionId, label: 'Artwork PNG 2', filename: 'artwork-1.png', contentType: 'image/png', fixturePath: fixturePath('artwork-1.png') }),
        createFileEntity({ collectionId, label: 'Artwork WebP', filename: 'artwork-2.webp', contentType: 'image/webp', fixturePath: fixturePath('artwork-2.webp') }),
      ]);
      const entityIds = images.map(i => i.id);
      log(`Created entities: ${entityIds.join(', ')}`);

      const { logs } = await runWorkflow({
        rhizaId: IMAGES_TO_OCR_RHIZA!,
        entityIds,
        collectionId,
        timeout: 180000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.SCATTER]: { min: 1 },
        [KLADOS_IDS.IMAGE_CONVERTER]: { exact: 3 },
        [KLADOS_IDS.OCR_WORKER]: { exact: 3 },
      });

      log('images-to-ocr completed successfully');
    },
    180000,
  );

  // =========================================================================
  // pdfs-to-ocr
  // =========================================================================

  it.skipIf(!ARKE_USER_KEY || !PDFS_TO_OCR_RHIZA)(
    'pdfs-to-ocr: scatter scanned PDF, convert to JPEG, OCR each page',
    async () => {
      log('Creating PDF entity...');
      const pdf = await createFileEntity({
        collectionId,
        label: 'Scanned PDF',
        filename: 'scanned.pdf',
        contentType: 'application/pdf',
        fixturePath: fixturePath('scanned.pdf'),
      });
      log(`Created entity: ${pdf.id}`);

      const { logs } = await runWorkflow({
        rhizaId: PDFS_TO_OCR_RHIZA!,
        entityIds: [pdf.id],
        collectionId,
        timeout: 180000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.SCATTER]: { min: 1 },
        [KLADOS_IDS.PDF_TO_JPEG]: { min: 1 },
      });

      // Each PDF page produces an OCR invocation
      const ocrLogs = filterLogs(logs, KLADOS_IDS.OCR_WORKER);
      expect(ocrLogs.length).toBeGreaterThanOrEqual(1);
      log(`OCR logs: ${ocrLogs.length} (one per page)`);

      log('pdfs-to-ocr completed successfully');
    },
    180000,
  );
});
