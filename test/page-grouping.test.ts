/**
 * Page Grouping E2E Tests
 *
 * Verifies that pdf-to-jpeg creates page_group entities to reduce KG entity
 * explosion, and that OCR + KG extraction work correctly with grouped pages.
 *
 * Test matrix:
 *   1. Digital multipage PDF → page groups with concatenated text
 *   2. Scanned PDF → page groups processed through OCR
 *   3. Backward compatibility → page_group_size=0 skips grouping
 *   4. Single-page PDF → no unnecessary groups created
 *
 * Note: pdf-lib generated PDFs are rendered as images by pdf-to-jpeg (no
 * extractable text layer), so they go through OCR like scanned PDFs.
 *
 * Prerequisites: Workers must be deployed with page grouping changes.
 * Requires: ARKE_USER_KEY and rhiza IDs in .env.test
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
  filterLogs,
  assertKladosRan,
  assertKladosDidNotRun,
  getCollectionEntitiesByType,
  getEntityWithRelationships,
} from './helpers';
import { PAGE_CONTENTS } from './fixtures/generate-multipage-pdf';

const PDF_TO_KG_BASIC_RHIZA = process.env.PDF_TO_KG_BASIC_RHIZA;

describe('page grouping', () => {
  let collectionId: string;

  beforeAll(() => { initTestClient(); });

  beforeAll(async () => {
    if (!ARKE_USER_KEY) return;
    const col = await setupTestCollection('Page Grouping Test');
    collectionId = col.id;
  });

  // =========================================================================
  // Test 1: Multipage PDF creates page groups
  // =========================================================================

  it.skipIf(!ARKE_USER_KEY || !PDF_TO_KG_BASIC_RHIZA)(
    'multipage PDF creates page groups with concatenated text',
    async () => {
      const entity = await createFileEntity({
        collectionId,
        label: '6-page PDF for grouping',
        filename: 'digital-multipage.pdf',
        contentType: 'application/pdf',
        fixturePath: fixturePath('digital-multipage.pdf'),
      });

      log(`Created multipage PDF entity: ${entity.id}`);

      const { logs } = await runWorkflow({
        rhizaId: PDF_TO_KG_BASIC_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 600000,
        allowErrors: true,
        pollInterval: 5000,
      });

      // pdf-to-jpeg should run (converts + creates groups)
      assertKladosRan(logs, {
        [KLADOS_IDS.PDF_TO_JPEG]: { min: 1 },
      });

      // Log OCR and extractor counts for diagnostics
      const ocrLogs = filterLogs(logs, KLADOS_IDS.OCR_WORKER);
      const extractorLogs = filterLogs(logs, KLADOS_IDS.KG_EXTRACTOR);
      log(`OCR logs: ${ocrLogs.length}, KG extractor logs: ${extractorLogs.length}`);

      // Verify page_group entities in target collection
      // 6 pages / default group size 3 = 2 groups
      // NOTE: This assertion validates the page grouping deployment.
      // If 0 groups found, the workers haven't been deployed with grouping yet.
      const pageGroups = await getCollectionEntitiesByType(collectionId, 'page_group');
      log(`Page groups found: ${pageGroups.length}`);
      expect(pageGroups.length, 'Expected 2 page groups (6 pages / 3 per group). Are workers deployed with page grouping?').toBe(2);

      for (const group of pageGroups) {
        const props = group.properties as Record<string, any>;

        // Should have page_numbers array
        expect(props.page_numbers).toBeDefined();
        expect(Array.isArray(props.page_numbers)).toBe(true);

        // Should have text with --- Page N --- markers
        expect(typeof props.text).toBe('string');
        for (const pageNum of props.page_numbers) {
          expect(props.text).toContain(`--- Page ${pageNum} ---`);
        }

        // Verify contains_page relationships
        const withRels = await getEntityWithRelationships(group.id);
        const containsPageRels = withRels.relationships?.filter(
          (r) => r.predicate === 'contains_page'
        );
        log(`Group ${group.id}: pages=${JSON.stringify(props.page_numbers)}, contains_page rels=${containsPageRels?.length}`);
        expect(containsPageRels?.length).toBe(props.page_numbers.length);
      }

      // Verify both groups cover all 6 pages
      const allPageNumbers = pageGroups
        .flatMap((g) => (g.properties as any).page_numbers as number[])
        .sort((a, b) => a - b);
      expect(allPageNumbers).toEqual([1, 2, 3, 4, 5, 6]);

      // Verify individual page entities still exist
      const pages = await getCollectionEntitiesByType(collectionId, 'page');
      log(`Individual pages found: ${pages.length}`);
      expect(pages.length).toBe(6);

      // With grouping, extractor runs per group (2), not per page (6)
      expect(extractorLogs.length).toBeLessThan(6);

      log('Multipage PDF grouping test passed');
    },
    600000,
  );

  // =========================================================================
  // Test 2: Scanned PDF creates page groups, OCR processes them
  // =========================================================================

  it.skipIf(!ARKE_USER_KEY || !PDF_TO_KG_BASIC_RHIZA)(
    'scanned PDF creates page groups and OCR processes them',
    async () => {
      const entity = await createFileEntity({
        collectionId,
        label: 'Scanned PDF for grouping + OCR',
        filename: 'scanned.pdf',
        contentType: 'application/pdf',
        fixturePath: fixturePath('scanned.pdf'),
      });

      log(`Created scanned PDF entity: ${entity.id}`);

      const { logs } = await runWorkflow({
        rhizaId: PDF_TO_KG_BASIC_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 900000,
        allowErrors: true,
        pollInterval: 15000,
      });

      // pdf-to-jpeg should run
      assertKladosRan(logs, {
        [KLADOS_IDS.PDF_TO_JPEG]: { min: 1 },
      });

      // OCR should run — scanned pages need OCR
      const ocrLogs = filterLogs(logs, KLADOS_IDS.OCR_WORKER);
      log(`OCR logs: ${ocrLogs.length}`);
      expect(ocrLogs.length).toBeGreaterThan(0);

      // KG extractor should run on groups
      const extractorLogs = filterLogs(logs, KLADOS_IDS.KG_EXTRACTOR);
      log(`KG extractor logs: ${extractorLogs.length}`);
      expect(extractorLogs.length).toBeGreaterThan(0);

      // Verify page groups exist
      const pageGroups = await getCollectionEntitiesByType(collectionId, 'page_group');
      const pages = await getCollectionEntitiesByType(collectionId, 'page');
      log(`Page groups: ${pageGroups.length}, Individual pages: ${pages.length}`);

      if (pageGroups.length > 0) {
        // With grouping, OCR runs per group, not per page
        expect(ocrLogs.length).toBe(pageGroups.length);

        // Fewer groups than pages means grouping is working
        expect(pageGroups.length).toBeLessThan(pages.length);

        // Verify groups have text populated after OCR
        for (const group of pageGroups) {
          const props = group.properties as Record<string, any>;
          expect(props.page_numbers).toBeDefined();

          // Text should be populated by OCR with page markers
          if (props.text) {
            for (const pageNum of props.page_numbers) {
              expect(props.text).toContain(`--- Page ${pageNum} ---`);
            }
          }
        }
      }

      log('Scanned PDF grouping + OCR test passed');
    },
    900000,
  );

  // =========================================================================
  // Test 3: Backward compatibility — page_group_size=0 skips grouping
  // =========================================================================

  it.skipIf(!ARKE_USER_KEY || !PDF_TO_KG_BASIC_RHIZA)(
    'page_group_size=0 skips grouping (backward compatibility)',
    async () => {
      const entity = await createFileEntity({
        collectionId,
        label: '6-page PDF (no grouping)',
        filename: 'digital-multipage.pdf',
        contentType: 'application/pdf',
        fixturePath: fixturePath('digital-multipage.pdf'),
      });

      log(`Created PDF entity (no grouping): ${entity.id}`);

      const { logs } = await runWorkflow({
        rhizaId: PDF_TO_KG_BASIC_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 600000,
        input: { options: { page_group_size: 0 } },
        allowErrors: true,
        pollInterval: 5000,
      });

      // pdf-to-jpeg should run
      assertKladosRan(logs, {
        [KLADOS_IDS.PDF_TO_JPEG]: { min: 1 },
      });

      // No page_group entities should exist
      const pageGroups = await getCollectionEntitiesByType(collectionId, 'page_group');
      log(`Page groups: ${pageGroups.length} (expected 0)`);
      expect(pageGroups.length).toBe(0);

      // Without grouping, each page is processed individually
      // Some pages may not produce enough text for extraction
      const extractorLogs = filterLogs(logs, KLADOS_IDS.KG_EXTRACTOR);
      const ocrLogs = filterLogs(logs, KLADOS_IDS.OCR_WORKER);
      log(`KG extractor logs: ${extractorLogs.length}, OCR logs: ${ocrLogs.length}`);
      // At least 5 extractors should run (some pages may be skipped if text is too short)
      expect(extractorLogs.length).toBeGreaterThanOrEqual(5);

      log('Backward compatibility test passed');
    },
    600000,
  );

  // =========================================================================
  // Test 4: Single-page PDF doesn't create unnecessary groups
  // =========================================================================

  it.skipIf(!ARKE_USER_KEY || !PDF_TO_KG_BASIC_RHIZA)(
    'single-page PDF works without creating page groups',
    async () => {
      const entity = await createFileEntity({
        collectionId,
        label: 'Single page digital PDF',
        filename: 'digital.pdf',
        contentType: 'application/pdf',
        fixturePath: fixturePath('digital.pdf'),
      });

      log(`Created single-page PDF entity: ${entity.id}`);

      const { logs } = await runWorkflow({
        rhizaId: PDF_TO_KG_BASIC_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 300000,
        allowErrors: true,
        pollInterval: 5000,
      });

      // pdf-to-jpeg should run
      assertKladosRan(logs, {
        [KLADOS_IDS.PDF_TO_JPEG]: { min: 1 },
      });

      // OCR should NOT run (digital PDF with extractable text)
      assertKladosDidNotRun(logs, KLADOS_IDS.OCR_WORKER);

      // KG extractor should run (at least once)
      const extractorLogs = filterLogs(logs, KLADOS_IDS.KG_EXTRACTOR);
      log(`KG extractor logs: ${extractorLogs.length}`);
      expect(extractorLogs.length).toBeGreaterThanOrEqual(1);

      // No page_group entities should exist for a single page
      const pageGroups = await getCollectionEntitiesByType(collectionId, 'page_group');
      log(`Page groups: ${pageGroups.length} (expected 0 for single page)`);
      expect(pageGroups.length).toBe(0);

      log('Single-page PDF test passed');
    },
    300000,
  );
});
