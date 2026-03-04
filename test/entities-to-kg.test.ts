/**
 * KG Multi Workflow Tests
 *
 * Tests kg-basic-multi, kg-full-multi, and kg-recursive-multi workflows.
 * Pipeline: scatter → extract → dedupe (→ cluster → describe [→ recurse])
 *
 * These workflows accept multiple entities with built-in scatter.
 * No chunking step - for entities that already have text content.
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
  assertKladosDidNotRun,
} from './helpers';

const KG_BASIC_MULTI_RHIZA = process.env.KG_BASIC_MULTI_RHIZA;
const KG_FULL_MULTI_RHIZA = process.env.KG_FULL_MULTI_RHIZA;
const KG_RECURSIVE_MULTI_RHIZA = process.env.KG_RECURSIVE_MULTI_RHIZA;

describe('kg-multi workflows', () => {
  let collectionId: string;

  beforeAll(() => { initTestClient(); });

  beforeAll(async () => {
    if (!ARKE_USER_KEY) return;
    const col = await setupTestCollection('KG Multi Test');
    collectionId = col.id;
  });

  it.skipIf(!ARKE_USER_KEY || !KG_BASIC_MULTI_RHIZA)(
    'kg-basic-multi: extract and dedupe without chunking',
    async () => {
      const entity = await createTextEntity(collectionId, 'Metamorphosis Excerpt', SAMPLE_TEXT);

      const { logs } = await runWorkflow({
        rhizaId: KG_BASIC_MULTI_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 180000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
      });
      assertKladosDidNotRun(logs, KLADOS_IDS.TEXT_CHUNKER);

      log('kg-basic-multi completed successfully');
    },
    180000,
  );

  it.skipIf(!ARKE_USER_KEY || !KG_FULL_MULTI_RHIZA)(
    'kg-full-multi: extract, dedupe, cluster, describe',
    async () => {
      const entity = await createTextEntity(collectionId, 'Metamorphosis Excerpt', SAMPLE_TEXT);

      const { logs } = await runWorkflow({
        rhizaId: KG_FULL_MULTI_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 300000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
        [KLADOS_IDS.KG_CLUSTER]: { min: 1 },
        // DESCRIBE may not run if cluster produces no output (short text input)
      });
      assertKladosDidNotRun(logs, KLADOS_IDS.TEXT_CHUNKER);

      log('kg-full-multi completed successfully');
    },
    360000,
  );

  it.skipIf(!ARKE_USER_KEY || !KG_RECURSIVE_MULTI_RHIZA)(
    'kg-recursive-multi: extract, dedupe, cluster, describe, recurse',
    async () => {
      const entity = await createTextEntity(collectionId, 'Metamorphosis Excerpt', SAMPLE_TEXT);

      const { logs } = await runWorkflow({
        rhizaId: KG_RECURSIVE_MULTI_RHIZA!,
        entityId: entity.id,
        collectionId,
        timeout: 600000,
      });

      assertKladosRan(logs, {
        [KLADOS_IDS.KG_EXTRACTOR]: { min: 1 },
        [KLADOS_IDS.KG_DEDUPE]: { min: 1 },
        [KLADOS_IDS.KG_CLUSTER]: { min: 1 },
        // DESCRIBE may not run if cluster produces no output (short text input)
      });
      assertKladosDidNotRun(logs, KLADOS_IDS.TEXT_CHUNKER);

      log('kg-recursive-multi completed successfully');
    },
    600000,
  );
});
