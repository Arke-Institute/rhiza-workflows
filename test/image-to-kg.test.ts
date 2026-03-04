/**
 * Image to KG Workflow Tests
 *
 * Tests image-to-kg-basic, image-to-kg-full, and image-to-kg-recursive workflows.
 * Pipeline: scatter → convert → ocr → extract → dedupe (→ cluster → describe [→ recurse])
 *
 * Uses artwork-1.png (converted from Met artwork JPEG) to exercise the
 * image converter step before OCR.
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

const IMAGE_TO_KG_BASIC_RHIZA = process.env.IMAGE_TO_KG_BASIC_RHIZA;
const IMAGE_TO_KG_FULL_RHIZA = process.env.IMAGE_TO_KG_FULL_RHIZA;
const IMAGE_TO_KG_RECURSIVE_RHIZA = process.env.IMAGE_TO_KG_RECURSIVE_RHIZA;

describe('image-to-kg workflows', () => {
  let collectionId: string;

  beforeAll(() => { initTestClient(); });

  beforeAll(async () => {
    if (!ARKE_USER_KEY) return;
    const col = await setupTestCollection('Image to KG Test');
    collectionId = col.id;
  });

  async function createPng(label: string) {
    return createFileEntity({
      collectionId,
      label,
      filename: 'artwork-1.png',
      contentType: 'image/png',
      fixturePath: fixturePath('artwork-1.png'),
    });
  }

  it.skipIf(!ARKE_USER_KEY || !IMAGE_TO_KG_BASIC_RHIZA)(
    'image-to-kg-basic: convert, OCR, extract, dedupe',
    async () => {
      const entity = await createPng('Artwork PNG for KG Basic');

      const { logs } = await runWorkflow({
        rhizaId: IMAGE_TO_KG_BASIC_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 180000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.IMAGE_CONVERTER]: { min: 1 },
        [KLADOS_IDS.OCR_WORKER]: { min: 1 },
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
      });

      log('image-to-kg-basic completed successfully');
    },
    180000,
  );

  it.skipIf(!ARKE_USER_KEY || !IMAGE_TO_KG_FULL_RHIZA)(
    'image-to-kg-full: convert, OCR, extract, dedupe, cluster, describe',
    async () => {
      const entity = await createPng('Artwork PNG for KG Full');

      const { logs } = await runWorkflow({
        rhizaId: IMAGE_TO_KG_FULL_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 480000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.IMAGE_CONVERTER]: { min: 1 },
        [KLADOS_IDS.OCR_WORKER]: { min: 1 },
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
        [KLADOS_IDS.KG_CLUSTER]: { min: 1 },
        [KLADOS_IDS.DESCRIBE]: { min: 1 },
      });

      log('image-to-kg-full completed successfully');
    },
    480000,
  );

  it.skipIf(!ARKE_USER_KEY || !IMAGE_TO_KG_RECURSIVE_RHIZA)(
    'image-to-kg-recursive: full pipeline with recursive clustering',
    async () => {
      const entity = await createPng('Artwork PNG for KG Recursive');

      const { logs } = await runWorkflow({
        rhizaId: IMAGE_TO_KG_RECURSIVE_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 600000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.IMAGE_CONVERTER]: { min: 1 },
        [KLADOS_IDS.OCR_WORKER]: { min: 1 },
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
        [KLADOS_IDS.KG_CLUSTER]: { min: 1 },
        [KLADOS_IDS.DESCRIBE]: { min: 1 },
      });

      log('image-to-kg-recursive completed successfully');
    },
    600000,
  );
});
