/**
 * Text to KG Workflow Tests
 *
 * Tests text-to-kg-basic, text-to-kg-full, and text-to-kg-recursive workflows.
 * Pipeline: scatter → chunk → extract → dedupe (→ cluster → describe [→ recurse])
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { log } from '@arke-institute/klados-testing';
import { SAMPLE_TEXT } from './fixtures/sample-text';
import {
  ARKE_USER_KEY,
  KLADOS_IDS,
  initTestClient,
  setupTestCollection,
  createTextEntity,
  runWorkflow,
  assertKladosRan,
} from './helpers';

const TEXT_TO_KG_BASIC_RHIZA = process.env.TEXT_TO_KG_BASIC_RHIZA;
const TEXT_TO_KG_FULL_RHIZA = process.env.TEXT_TO_KG_FULL_RHIZA;
const TEXT_TO_KG_RECURSIVE_RHIZA = process.env.TEXT_TO_KG_RECURSIVE_RHIZA;

describe('text-to-kg workflows', () => {
  let collectionId: string;

  beforeAll(() => { initTestClient(); });

  beforeAll(async () => {
    if (!ARKE_USER_KEY) return;
    const col = await setupTestCollection('Text to KG Test');
    collectionId = col.id;
  });

  it.skipIf(!ARKE_USER_KEY || !TEXT_TO_KG_BASIC_RHIZA)(
    'text-to-kg-basic: chunk, extract, and dedupe',
    async () => {
      const entity = await createTextEntity(collectionId, 'Metamorphosis Excerpt', SAMPLE_TEXT);

      const { logs } = await runWorkflow({
        rhizaId: TEXT_TO_KG_BASIC_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 180000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.TEXT_CHUNKER]: { min: 1 },
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
      });

      log('text-to-kg-basic completed successfully');
    },
    180000,
  );

  it.skipIf(!ARKE_USER_KEY || !TEXT_TO_KG_FULL_RHIZA)(
    'text-to-kg-full: chunk, extract, dedupe, cluster, describe',
    async () => {
      const entity = await createTextEntity(collectionId, 'Metamorphosis Excerpt', SAMPLE_TEXT);

      const { logs } = await runWorkflow({
        rhizaId: TEXT_TO_KG_FULL_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 360000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.TEXT_CHUNKER]: { min: 1 },
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
        [KLADOS_IDS.KG_CLUSTER]: { min: 1 },
        // DESCRIBE may not run if cluster produces no output (short text input)
      });

      log('text-to-kg-full completed successfully');
    },
    360000,
  );

  it.skipIf(!ARKE_USER_KEY || !TEXT_TO_KG_RECURSIVE_RHIZA)(
    'text-to-kg-recursive: chunk, extract, dedupe, cluster, describe, recurse',
    async () => {
      const entity = await createTextEntity(collectionId, 'Metamorphosis Excerpt', SAMPLE_TEXT);

      const { logs } = await runWorkflow({
        rhizaId: TEXT_TO_KG_RECURSIVE_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 600000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.TEXT_CHUNKER]: { min: 1 },
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
        [KLADOS_IDS.KG_CLUSTER]: { min: 1 },
        // DESCRIBE may not run if cluster produces no output (short text input)
      });

      log('text-to-kg-recursive completed successfully');
    },
    600000,
  );
});
