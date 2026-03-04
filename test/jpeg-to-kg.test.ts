/**
 * JPEG to KG Workflow Tests
 *
 * Tests jpeg-to-kg-basic, jpeg-to-kg-full, and jpeg-to-kg-recursive workflows.
 * Pipeline: scatter → ocr → extract → dedupe (→ cluster → describe [→ recurse])
 * No image conversion step (JPEGs are OCR-ready).
 *
 * Uses artwork-1.jpeg (Met artwork, 974x1200) as the test fixture.
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
} from './helpers';

const JPEG_TO_KG_BASIC_RHIZA = process.env.JPEG_TO_KG_BASIC_RHIZA;
const JPEG_TO_KG_FULL_RHIZA = process.env.JPEG_TO_KG_FULL_RHIZA;
const JPEG_TO_KG_RECURSIVE_RHIZA = process.env.JPEG_TO_KG_RECURSIVE_RHIZA;

describe('jpeg-to-kg workflows', () => {
  let collectionId: string;

  beforeAll(() => { initTestClient(); });

  beforeAll(async () => {
    if (!ARKE_USER_KEY) return;
    const col = await setupTestCollection('JPEG to KG Test');
    collectionId = col.id;
  });

  async function createJpeg(label: string) {
    return createFileEntity({
      collectionId,
      label,
      filename: 'artwork-1.jpeg',
      contentType: 'image/jpeg',
      fixturePath: fixturePath('artwork-1.jpeg'),
    });
  }

  it.skipIf(!ARKE_USER_KEY || !JPEG_TO_KG_BASIC_RHIZA)(
    'jpeg-to-kg-basic: OCR, extract, dedupe',
    async () => {
      const entity = await createJpeg('Artwork JPEG for KG Basic');

      const { logs } = await runWorkflow({
        rhizaId: JPEG_TO_KG_BASIC_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 180000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.OCR_WORKER]: { min: 1 },
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
      });
      assertKladosDidNotRun(logs, KLADOS_IDS.IMAGE_CONVERTER);

      log('jpeg-to-kg-basic completed successfully');
    },
    180000,
  );

  it.skipIf(!ARKE_USER_KEY || !JPEG_TO_KG_FULL_RHIZA)(
    'jpeg-to-kg-full: OCR, extract, dedupe, cluster, describe',
    async () => {
      const entity = await createJpeg('Artwork JPEG for KG Full');

      const { logs } = await runWorkflow({
        rhizaId: JPEG_TO_KG_FULL_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 480000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.OCR_WORKER]: { min: 1 },
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
        [KLADOS_IDS.KG_CLUSTER]: { min: 1 },
        [KLADOS_IDS.DESCRIBE]: { min: 1 },
      });
      assertKladosDidNotRun(logs, KLADOS_IDS.IMAGE_CONVERTER);

      log('jpeg-to-kg-full completed successfully');
    },
    480000,
  );

  it.skipIf(!ARKE_USER_KEY || !JPEG_TO_KG_RECURSIVE_RHIZA)(
    'jpeg-to-kg-recursive: full pipeline with recursive clustering',
    async () => {
      const entity = await createJpeg('Artwork JPEG for KG Recursive');

      const { logs } = await runWorkflow({
        rhizaId: JPEG_TO_KG_RECURSIVE_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 600000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.OCR_WORKER]: { min: 1 },
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
        [KLADOS_IDS.KG_CLUSTER]: { min: 1 },
        [KLADOS_IDS.DESCRIBE]: { min: 1 },
      });
      assertKladosDidNotRun(logs, KLADOS_IDS.IMAGE_CONVERTER);

      log('jpeg-to-kg-recursive completed successfully');
    },
    600000,
  );
});
