/**
 * Multi-file OCR Workflow Tests
 *
 * Tests the jpegs-to-ocr and images-to-ocr workflows.
 * These workflows scatter multiple input files for parallel OCR processing.
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
const JPEGS_TO_OCR_RHIZA = process.env.JPEGS_TO_OCR_RHIZA;
const IMAGES_TO_OCR_RHIZA = process.env.IMAGES_TO_OCR_RHIZA;

// Klados IDs for verification
const SCATTER_KLADOS = process.env.SCATTER_KLADOS || '01KJ61043AFBTGY9CQSVDF5WW2';
const IMAGE_CONVERTER_KLADOS = process.env.IMAGE_CONVERTER_KLADOS || '01KJAZMNZ3YRX46HWG2V55NXQC';
const OCR_WORKER_KLADOS = process.env.OCR_WORKER_KLADOS || '01KJ6WQDQ0QRVG1VP5BJFBRG9N';

describe('multi-ocr workflows', () => {
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
      label: `Multi OCR Test ${Date.now()}`,
      roles: { public: ['*:view', '*:invoke'] },
    });
    log(`Created collection: ${targetCollection.id}`);
  });

  async function createJpegEntity(label: string): Promise<{ id: string }> {
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

    return entity;
  }

  async function createPngEntity(label: string): Promise<{ id: string }> {
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

    return entity;
  }

  it('jpegs-to-ocr: should scatter multiple JPEGs and OCR each', async () => {
    if (!ARKE_USER_KEY || !JPEGS_TO_OCR_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or JPEGS_TO_OCR_RHIZA');
      return;
    }

    // Create multiple JPEG entities
    log('Creating 3 JPEG entities...');
    const jpeg1 = await createJpegEntity('JPEG 1');
    const jpeg2 = await createJpegEntity('JPEG 2');
    const jpeg3 = await createJpegEntity('JPEG 3');
    const entityIds = [jpeg1.id, jpeg2.id, jpeg3.id];
    log(`Created entities: ${entityIds.join(', ')}`);

    log('Invoking jpegs-to-ocr workflow...');
    const result = await invokeRhiza({
      rhizaId: JPEGS_TO_OCR_RHIZA,
      targetEntity: jpeg1.id, // Entry point (scatter will use entity_ids)
      targetCollection: targetCollection.id,
      input: { entity_ids: entityIds },
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

    // Verify scatter and OCR steps
    const logs = Array.from(tree.logs.values());
    const scatterLogs = logs.filter((l: any) => l.properties?.klados_id === SCATTER_KLADOS);
    const ocrLogs = logs.filter((l: any) => l.properties?.klados_id === OCR_WORKER_KLADOS);

    log(`Scatter: ${scatterLogs.length}, OCR: ${ocrLogs.length}`);

    expect(scatterLogs.length).toBeGreaterThan(0);
    expect(ocrLogs.length).toBe(3); // One OCR per JPEG

    log('jpegs-to-ocr completed successfully!');
  }, 180000);

  it('images-to-ocr: should scatter, convert to JPEG, and OCR each', async () => {
    if (!ARKE_USER_KEY || !IMAGES_TO_OCR_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or IMAGES_TO_OCR_RHIZA');
      return;
    }

    // Create multiple PNG entities
    log('Creating 2 PNG entities...');
    const png1 = await createPngEntity('PNG 1');
    const png2 = await createPngEntity('PNG 2');
    const entityIds = [png1.id, png2.id];
    log(`Created entities: ${entityIds.join(', ')}`);

    log('Invoking images-to-ocr workflow...');
    const result = await invokeRhiza({
      rhizaId: IMAGES_TO_OCR_RHIZA,
      targetEntity: png1.id,
      targetCollection: targetCollection.id,
      input: { entity_ids: entityIds },
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

    // Verify all steps
    const logs = Array.from(tree.logs.values());
    const scatterLogs = logs.filter((l: any) => l.properties?.klados_id === SCATTER_KLADOS);
    const convertLogs = logs.filter((l: any) => l.properties?.klados_id === IMAGE_CONVERTER_KLADOS);
    const ocrLogs = logs.filter((l: any) => l.properties?.klados_id === OCR_WORKER_KLADOS);

    log(`Scatter: ${scatterLogs.length}, Convert: ${convertLogs.length}, OCR: ${ocrLogs.length}`);

    expect(scatterLogs.length).toBeGreaterThan(0);
    expect(convertLogs.length).toBe(2); // One convert per PNG
    expect(ocrLogs.length).toBe(2); // One OCR per converted image

    log('images-to-ocr completed successfully!');
  }, 180000);
});
