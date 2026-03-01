/**
 * Text to KG Workflow Tests
 *
 * Tests the text-to-kg-basic, text-to-kg-full, and text-to-kg-recursive workflows.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  configureTestClient,
  createCollection,
  createEntity,
  invokeRhiza,
  waitForWorkflowTree,
  log,
} from '@arke-institute/klados-testing';
import { SAMPLE_TEXTS } from './fixtures/sample-text';

// Configuration
const ARKE_API_BASE = process.env.ARKE_API_BASE || 'https://arke-v1.arke.institute';
const ARKE_USER_KEY = process.env.ARKE_USER_KEY;
const NETWORK = (process.env.ARKE_NETWORK || 'main') as 'test' | 'main';

// Workflow IDs
const TEXT_TO_KG_BASIC_RHIZA = process.env.TEXT_TO_KG_BASIC_RHIZA;
const TEXT_TO_KG_FULL_RHIZA = process.env.TEXT_TO_KG_FULL_RHIZA;
const TEXT_TO_KG_RECURSIVE_RHIZA = process.env.TEXT_TO_KG_RECURSIVE_RHIZA;

// Klados IDs for verification
const TEXT_CHUNKER_KLADOS = process.env.TEXT_CHUNKER_KLADOS || '01KJ6WPT018SDDANE6N7Q8E428';
const KG_EXTRACTOR_KLADOS = process.env.KG_EXTRACTOR_KLADOS || '01KJ60XQBHJ0GBGTP9X8HXAPPM';
const KG_DEDUPE_RESOLVER_KLADOS = process.env.KG_DEDUPE_RESOLVER_KLADOS || '01KJ60WNDBKP1GS1XSMJQ9F1AR';
const KG_CLUSTER_KLADOS = process.env.KG_CLUSTER_KLADOS || '01KJ60VSSCSQQ32PRJS0BQJ6Q8';
const DESCRIBE_KLADOS = process.env.DESCRIBE_KLADOS || '01KJ60TTR9BACEJHH5WGW2H10C';

describe('text-to-kg workflows', () => {
  let targetCollection: { id: string };
  let textEntity: { id: string };

  beforeAll(() => {
    if (!ARKE_USER_KEY) {
      console.warn('Skipping tests: ARKE_USER_KEY not set');
      return;
    }
    configureTestClient({
      apiBase: ARKE_API_BASE,
      userKey: ARKE_USER_KEY,
      network: NETWORK,
    });
  });

  beforeAll(async () => {
    if (!ARKE_USER_KEY) return;

    log('Creating test fixtures...');

    // Create collection with invoke permissions
    targetCollection = await createCollection({
      label: `Text to KG Test ${Date.now()}`,
      roles: { public: ['*:view', '*:invoke'] },
    });
    log(`Created collection: ${targetCollection.id}`);

    // Create text entity with sample text
    textEntity = await createEntity({
      type: 'entity',
      properties: {
        label: 'Einstein Biography',
        text: SAMPLE_TEXTS.einstein,
      },
      collection: targetCollection.id,
    });
    log(`Created text entity: ${textEntity.id}`);
  });

  it('text-to-kg-basic: should chunk, extract, and dedupe', async () => {
    if (!ARKE_USER_KEY || !TEXT_TO_KG_BASIC_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or TEXT_TO_KG_BASIC_RHIZA');
      return;
    }

    log('Invoking text-to-kg-basic workflow...');
    const result = await invokeRhiza({
      rhizaId: TEXT_TO_KG_BASIC_RHIZA,
      targetEntity: textEntity.id,
      targetCollection: targetCollection.id,
      confirm: true,
    });

    expect(result.status).toBe('started');
    expect(result.job_collection).toBeDefined();
    log(`Job started: ${result.job_id}`);

    // Wait for completion
    const tree = await waitForWorkflowTree(result.job_collection!, {
      timeout: 180000,
      pollInterval: 5000,
      onPoll: (t, elapsed) => {
        const elapsedSec = Math.round(elapsed / 1000);
        log(`[${elapsedSec}s] ${t.logs.size} logs, complete=${t.isComplete}`);
      },
    });

    expect(tree.isComplete).toBe(true);

    // Verify expected steps
    const logs = Array.from(tree.logs.values());
    const chunkerLogs = logs.filter((l: any) => l.properties?.klados_id === TEXT_CHUNKER_KLADOS);
    const extractorLogs = logs.filter((l: any) => l.properties?.klados_id === KG_EXTRACTOR_KLADOS);
    const dedupeLogs = logs.filter((l: any) => l.properties?.klados_id === KG_DEDUPE_RESOLVER_KLADOS);

    log(`Chunker logs: ${chunkerLogs.length}, Extractor logs: ${extractorLogs.length}, Dedupe logs: ${dedupeLogs.length}`);

    expect(chunkerLogs.length).toBeGreaterThan(0);
    expect(extractorLogs.length).toBeGreaterThan(0);
    expect(dedupeLogs.length).toBeGreaterThan(0);

    // All logs should be successful
    for (const l of logs) {
      expect((l as any).properties?.status).toBe('done');
    }

    log('text-to-kg-basic completed successfully!');
  }, 180000);

  it('text-to-kg-full: should include clustering and descriptions', async () => {
    if (!ARKE_USER_KEY || !TEXT_TO_KG_FULL_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or TEXT_TO_KG_FULL_RHIZA');
      return;
    }

    // Create fresh entity for this test
    const entity = await createEntity({
      type: 'entity',
      properties: {
        label: 'Moby Dick Excerpt',
        text: SAMPLE_TEXTS.mobyDick,
      },
      collection: targetCollection.id,
    });

    log('Invoking text-to-kg-full workflow...');
    const result = await invokeRhiza({
      rhizaId: TEXT_TO_KG_FULL_RHIZA,
      targetEntity: entity.id,
      targetCollection: targetCollection.id,
      confirm: true,
    });

    expect(result.status).toBe('started');
    log(`Job started: ${result.job_id}`);

    // Wait for completion (longer timeout for full pipeline)
    const tree = await waitForWorkflowTree(result.job_collection!, {
      timeout: 300000,
      pollInterval: 5000,
      onPoll: (t, elapsed) => {
        const elapsedSec = Math.round(elapsed / 1000);
        log(`[${elapsedSec}s] ${t.logs.size} logs, complete=${t.isComplete}`);
      },
    });

    expect(tree.isComplete).toBe(true);

    // Verify all stages ran
    const logs = Array.from(tree.logs.values());
    const clusterLogs = logs.filter((l: any) => l.properties?.klados_id === KG_CLUSTER_KLADOS);
    const describeLogs = logs.filter((l: any) => l.properties?.klados_id === DESCRIBE_KLADOS);

    log(`Cluster logs: ${clusterLogs.length}, Describe logs: ${describeLogs.length}`);

    expect(clusterLogs.length).toBeGreaterThan(0);
    expect(describeLogs.length).toBeGreaterThan(0);

    log('text-to-kg-full completed successfully!');
  }, 300000);

  it('text-to-kg-recursive: should recursively cluster', async () => {
    if (!ARKE_USER_KEY || !TEXT_TO_KG_RECURSIVE_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or TEXT_TO_KG_RECURSIVE_RHIZA');
      return;
    }

    // Create fresh entity
    const entity = await createEntity({
      type: 'entity',
      properties: {
        label: 'UN Overview',
        text: SAMPLE_TEXTS.shortText,
      },
      collection: targetCollection.id,
    });

    log('Invoking text-to-kg-recursive workflow...');
    const result = await invokeRhiza({
      rhizaId: TEXT_TO_KG_RECURSIVE_RHIZA,
      targetEntity: entity.id,
      targetCollection: targetCollection.id,
      confirm: true,
    });

    expect(result.status).toBe('started');
    log(`Job started: ${result.job_id}`);

    // Wait for completion (longest timeout for recursive)
    const tree = await waitForWorkflowTree(result.job_collection!, {
      timeout: 600000,
      pollInterval: 5000,
      onPoll: (t, elapsed) => {
        const elapsedSec = Math.round(elapsed / 1000);
        log(`[${elapsedSec}s] ${t.logs.size} logs, complete=${t.isComplete}`);
      },
    });

    expect(tree.isComplete).toBe(true);

    // Count cluster logs to verify recursion happened
    const logs = Array.from(tree.logs.values());
    const clusterLogs = logs.filter((l: any) => l.properties?.klados_id === KG_CLUSTER_KLADOS);

    log(`Total cluster logs: ${clusterLogs.length} (expecting multiple rounds)`);

    // Should have at least 1 cluster log
    expect(clusterLogs.length).toBeGreaterThan(0);

    log('text-to-kg-recursive completed successfully!');
  }, 600000);
});
