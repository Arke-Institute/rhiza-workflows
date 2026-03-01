/**
 * JPEG to KG Workflow Tests
 *
 * Tests the jpeg-to-kg-basic, jpeg-to-kg-full, and jpeg-to-kg-recursive workflows.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  configureTestClient,
  createCollection,
  createEntity,
  invokeRhiza,
  waitForWorkflowTree,
  log,
} from '@arke-institute/klados-testing';

// Configuration
const ARKE_API_BASE = process.env.ARKE_API_BASE || 'https://arke-v1.arke.institute';
const ARKE_USER_KEY = process.env.ARKE_USER_KEY;
const NETWORK = (process.env.ARKE_NETWORK || 'main') as 'test' | 'main';

// Workflow IDs
const JPEG_TO_KG_BASIC_RHIZA = process.env.JPEG_TO_KG_BASIC_RHIZA;
const JPEG_TO_KG_FULL_RHIZA = process.env.JPEG_TO_KG_FULL_RHIZA;
const JPEG_TO_KG_RECURSIVE_RHIZA = process.env.JPEG_TO_KG_RECURSIVE_RHIZA;

// Klados IDs for verification
const OCR_WORKER_KLADOS = process.env.OCR_WORKER_KLADOS || '01KJ6WQDQ0QRVG1VP5BJFBRG9N';
const KG_EXTRACTOR_KLADOS = process.env.KG_EXTRACTOR_KLADOS || '01KJ60XQBHJ0GBGTP9X8HXAPPM';
const KG_DEDUPE_RESOLVER_KLADOS = process.env.KG_DEDUPE_RESOLVER_KLADOS || '01KJ60WNDBKP1GS1XSMJQ9F1AR';

describe('jpeg-to-kg workflows', () => {
  let targetCollection: { id: string };

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

    log('Creating test collection...');
    targetCollection = await createCollection({
      label: `JPEG to KG Test ${Date.now()}`,
      roles: { public: ['*:view', '*:invoke'] },
    });
    log(`Created collection: ${targetCollection.id}`);
  });

  async function createJpegEntity(label: string): Promise<{ id: string }> {
    // Create file entity
    const entity = await createEntity({
      type: 'file',
      properties: {
        label,
        content: {
          'test.jpeg': {
            content_type: 'image/jpeg',
          },
        },
      },
      collection: targetCollection.id,
    });

    // Upload JPEG content
    const jpegPath = path.join(__dirname, 'fixtures', 'test.jpeg');
    const jpegBuffer = fs.readFileSync(jpegPath);

    const uploadUrl = `${ARKE_API_BASE}/entities/${entity.id}/content?key=test.jpeg`;
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `ApiKey ${ARKE_USER_KEY}`,
        'X-Arke-Network': NETWORK,
        'Content-Type': 'image/jpeg',
      },
      body: jpegBuffer,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload JPEG: ${response.statusText}`);
    }

    log(`Created and uploaded JPEG entity: ${entity.id}`);
    return entity;
  }

  it('jpeg-to-kg-basic: should OCR, chunk, extract, and dedupe', async () => {
    if (!ARKE_USER_KEY || !JPEG_TO_KG_BASIC_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or JPEG_TO_KG_BASIC_RHIZA');
      return;
    }

    const jpegEntity = await createJpegEntity('Test JPEG for KG Basic');

    log('Invoking jpeg-to-kg-basic workflow...');
    const result = await invokeRhiza({
      rhizaId: JPEG_TO_KG_BASIC_RHIZA,
      targetEntity: jpegEntity.id,
      targetCollection: targetCollection.id,
      confirm: true,
    });

    expect(result.status).toBe('started');
    log(`Job started: ${result.job_id}`);

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
    const ocrLogs = logs.filter((l: any) => l.properties?.klados_id === OCR_WORKER_KLADOS);
    const extractLogs = logs.filter((l: any) => l.properties?.klados_id === KG_EXTRACTOR_KLADOS);
    const dedupeLogs = logs.filter((l: any) => l.properties?.klados_id === KG_DEDUPE_RESOLVER_KLADOS);

    log(`OCR: ${ocrLogs.length}, Extract: ${extractLogs.length}, Dedupe: ${dedupeLogs.length}`);

    expect(ocrLogs.length).toBeGreaterThan(0);
    expect(extractLogs.length).toBeGreaterThan(0);
    expect(dedupeLogs.length).toBeGreaterThan(0);

    log('jpeg-to-kg-basic completed successfully!');
  }, 180000);

  it('jpeg-to-kg-full: should include clustering and descriptions', async () => {
    if (!ARKE_USER_KEY || !JPEG_TO_KG_FULL_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or JPEG_TO_KG_FULL_RHIZA');
      return;
    }

    const jpegEntity = await createJpegEntity('Test JPEG for KG Full');

    log('Invoking jpeg-to-kg-full workflow...');
    const result = await invokeRhiza({
      rhizaId: JPEG_TO_KG_FULL_RHIZA,
      targetEntity: jpegEntity.id,
      targetCollection: targetCollection.id,
      confirm: true,
    });

    expect(result.status).toBe('started');
    log(`Job started: ${result.job_id}`);

    const tree = await waitForWorkflowTree(result.job_collection!, {
      timeout: 300000,
      pollInterval: 5000,
      onPoll: (t, elapsed) => {
        const elapsedSec = Math.round(elapsed / 1000);
        log(`[${elapsedSec}s] ${t.logs.size} logs, complete=${t.isComplete}`);
      },
    });

    expect(tree.isComplete).toBe(true);
    log('jpeg-to-kg-full completed successfully!');
  }, 300000);

  it('jpeg-to-kg-recursive: should recursively cluster', async () => {
    if (!ARKE_USER_KEY || !JPEG_TO_KG_RECURSIVE_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or JPEG_TO_KG_RECURSIVE_RHIZA');
      return;
    }

    const jpegEntity = await createJpegEntity('Test JPEG for KG Recursive');

    log('Invoking jpeg-to-kg-recursive workflow...');
    const result = await invokeRhiza({
      rhizaId: JPEG_TO_KG_RECURSIVE_RHIZA,
      targetEntity: jpegEntity.id,
      targetCollection: targetCollection.id,
      confirm: true,
    });

    expect(result.status).toBe('started');
    log(`Job started: ${result.job_id}`);

    const tree = await waitForWorkflowTree(result.job_collection!, {
      timeout: 600000,
      pollInterval: 5000,
      onPoll: (t, elapsed) => {
        const elapsedSec = Math.round(elapsed / 1000);
        log(`[${elapsedSec}s] ${t.logs.size} logs, complete=${t.isComplete}`);
      },
    });

    expect(tree.isComplete).toBe(true);
    log('jpeg-to-kg-recursive completed successfully!');
  }, 600000);
});
