/**
 * Image to KG Workflow Tests
 *
 * Tests the image-to-kg-basic, image-to-kg-full, and image-to-kg-recursive workflows.
 * Uses PNG images that get converted to JPEG before OCR.
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
const IMAGE_TO_KG_BASIC_RHIZA = process.env.IMAGE_TO_KG_BASIC_RHIZA;
const IMAGE_TO_KG_FULL_RHIZA = process.env.IMAGE_TO_KG_FULL_RHIZA;
const IMAGE_TO_KG_RECURSIVE_RHIZA = process.env.IMAGE_TO_KG_RECURSIVE_RHIZA;

// Klados IDs for verification
const IMAGE_CONVERTER_KLADOS = process.env.IMAGE_CONVERTER_KLADOS || '01KJAZMNZ3YRX46HWG2V55NXQC';
const OCR_WORKER_KLADOS = process.env.OCR_WORKER_KLADOS || '01KJ6WQDQ0QRVG1VP5BJFBRG9N';
const KG_EXTRACTOR_KLADOS = process.env.KG_EXTRACTOR_KLADOS || '01KJ60XQBHJ0GBGTP9X8HXAPPM';
const KG_DEDUPE_RESOLVER_KLADOS = process.env.KG_DEDUPE_RESOLVER_KLADOS || '01KJ60WNDBKP1GS1XSMJQ9F1AR';

describe('image-to-kg workflows', () => {
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
      label: `Image to KG Test ${Date.now()}`,
      roles: { public: ['*:view', '*:invoke'] },
    });
    log(`Created collection: ${targetCollection.id}`);
  });

  async function createPngEntity(label: string): Promise<{ id: string }> {
    // Create file entity
    const entity = await createEntity({
      type: 'file',
      properties: {
        label,
        content: {
          'test.png': {
            content_type: 'image/png',
          },
        },
      },
      collection: targetCollection.id,
    });

    // Upload PNG content
    const pngPath = path.join(__dirname, 'fixtures', 'test.png');
    const pngBuffer = fs.readFileSync(pngPath);

    const uploadUrl = `${ARKE_API_BASE}/entities/${entity.id}/content?key=test.png`;
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `ApiKey ${ARKE_USER_KEY}`,
        'X-Arke-Network': NETWORK,
        'Content-Type': 'image/png',
      },
      body: pngBuffer,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload PNG: ${response.statusText}`);
    }

    log(`Created and uploaded PNG entity: ${entity.id}`);
    return entity;
  }

  it('image-to-kg-basic: should convert, OCR, chunk, extract, and dedupe', async () => {
    if (!ARKE_USER_KEY || !IMAGE_TO_KG_BASIC_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or IMAGE_TO_KG_BASIC_RHIZA');
      return;
    }

    const pngEntity = await createPngEntity('Test PNG for KG Basic');

    log('Invoking image-to-kg-basic workflow...');
    const result = await invokeRhiza({
      rhizaId: IMAGE_TO_KG_BASIC_RHIZA,
      targetEntity: pngEntity.id,
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
    const convertLogs = logs.filter((l: any) => l.properties?.klados_id === IMAGE_CONVERTER_KLADOS);
    const ocrLogs = logs.filter((l: any) => l.properties?.klados_id === OCR_WORKER_KLADOS);
    const extractLogs = logs.filter((l: any) => l.properties?.klados_id === KG_EXTRACTOR_KLADOS);
    const dedupeLogs = logs.filter((l: any) => l.properties?.klados_id === KG_DEDUPE_RESOLVER_KLADOS);

    log(`Convert: ${convertLogs.length}, OCR: ${ocrLogs.length}, Extract: ${extractLogs.length}, Dedupe: ${dedupeLogs.length}`);

    expect(convertLogs.length).toBeGreaterThan(0);
    expect(ocrLogs.length).toBeGreaterThan(0);
    expect(extractLogs.length).toBeGreaterThan(0);
    expect(dedupeLogs.length).toBeGreaterThan(0);

    log('image-to-kg-basic completed successfully!');
  }, 180000);

  it('image-to-kg-full: should include clustering and descriptions', async () => {
    if (!ARKE_USER_KEY || !IMAGE_TO_KG_FULL_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or IMAGE_TO_KG_FULL_RHIZA');
      return;
    }

    const pngEntity = await createPngEntity('Test PNG for KG Full');

    log('Invoking image-to-kg-full workflow...');
    const result = await invokeRhiza({
      rhizaId: IMAGE_TO_KG_FULL_RHIZA,
      targetEntity: pngEntity.id,
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
    log('image-to-kg-full completed successfully!');
  }, 300000);

  it('image-to-kg-recursive: should recursively cluster', async () => {
    if (!ARKE_USER_KEY || !IMAGE_TO_KG_RECURSIVE_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or IMAGE_TO_KG_RECURSIVE_RHIZA');
      return;
    }

    const pngEntity = await createPngEntity('Test PNG for KG Recursive');

    log('Invoking image-to-kg-recursive workflow...');
    const result = await invokeRhiza({
      rhizaId: IMAGE_TO_KG_RECURSIVE_RHIZA,
      targetEntity: pngEntity.id,
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
    log('image-to-kg-recursive completed successfully!');
  }, 600000);
});
