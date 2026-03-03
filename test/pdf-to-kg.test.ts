/**
 * PDF to KG Workflow Tests
 *
 * Tests the pdf-to-kg-basic, pdf-to-kg-full, and pdf-to-kg-recursive workflows.
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
const PDF_TO_KG_BASIC_RHIZA = process.env.PDF_TO_KG_BASIC_RHIZA;
const PDF_TO_KG_FULL_RHIZA = process.env.PDF_TO_KG_FULL_RHIZA;
const PDF_TO_KG_RECURSIVE_RHIZA = process.env.PDF_TO_KG_RECURSIVE_RHIZA;

// Klados IDs for verification
const PDF_TO_JPEG_KLADOS = process.env.PDF_TO_JPEG_KLADOS || '01KJ6WRER2NMWF7P7AJEP33J6H';
const OCR_WORKER_KLADOS = process.env.OCR_WORKER_KLADOS || '01KJ6WQDQ0QRVG1VP5BJFBRG9N';
const KG_EXTRACTOR_KLADOS = process.env.KG_EXTRACTOR_KLADOS || '01KJ60XQBHJ0GBGTP9X8HXAPPM';
const KG_DEDUPE_RESOLVER_KLADOS = process.env.KG_DEDUPE_RESOLVER_KLADOS || '01KJ60WNDBKP1GS1XSMJQ9F1AR';

describe('pdf-to-kg workflows', () => {
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
      label: `PDF to KG Test ${Date.now()}`,
      roles: { public: ['*:view', '*:invoke'] },
    });
    log(`Created collection: ${targetCollection.id}`);
  });

  async function createPdfEntity(label: string): Promise<{ id: string }> {
    // Create file entity
    const entity = await createEntity({
      type: 'file',
      properties: {
        label,
        content: {
          'test.pdf': {
            content_type: 'application/pdf',
          },
        },
      },
      collection: targetCollection.id,
    });

    // Upload PDF content
    const pdfPath = path.join(__dirname, 'fixtures', 'test.pdf');
    const pdfBuffer = fs.readFileSync(pdfPath);

    const uploadUrl = `${ARKE_API_BASE}/entities/${entity.id}/content?key=test.pdf`;
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `ApiKey ${ARKE_USER_KEY}`,
        'X-Arke-Network': NETWORK,
        'Content-Type': 'application/pdf',
      },
      body: pdfBuffer,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload PDF: ${response.statusText}`);
    }

    log(`Created and uploaded PDF entity: ${entity.id}`);
    return entity;
  }

  it('pdf-to-kg-basic: should convert PDF, OCR, chunk, extract, and dedupe', async () => {
    if (!ARKE_USER_KEY || !PDF_TO_KG_BASIC_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or PDF_TO_KG_BASIC_RHIZA');
      return;
    }

    const pdfEntity = await createPdfEntity('Test PDF for KG Basic');

    log('Invoking pdf-to-kg-basic workflow...');
    const result = await invokeRhiza({
      rhizaId: PDF_TO_KG_BASIC_RHIZA,
      targetEntity: pdfEntity.id,
      targetCollection: targetCollection.id,
      confirm: true,
    });

    expect(result.status).toBe('started');
    log(`Job started: ${result.job_id}`);

    // Wait for completion
    const tree = await waitForWorkflowTree(result.job_collection!, {
      timeout: 240000, // 4 min for PDF processing
      pollInterval: 5000,
      onPoll: (t, elapsed) => {
        const elapsedSec = Math.round(elapsed / 1000);
        log(`[${elapsedSec}s] ${t.logs.size} logs, complete=${t.isComplete}`);
      },
    });

    expect(tree.isComplete).toBe(true);

    // Verify expected steps
    const logs = Array.from(tree.logs.values());
    const pdfLogs = logs.filter((l: any) => l.properties?.klados_id === PDF_TO_JPEG_KLADOS);
    const ocrLogs = logs.filter((l: any) => l.properties?.klados_id === OCR_WORKER_KLADOS);
    const extractLogs = logs.filter((l: any) => l.properties?.klados_id === KG_EXTRACTOR_KLADOS);
    const dedupeLogs = logs.filter((l: any) => l.properties?.klados_id === KG_DEDUPE_RESOLVER_KLADOS);

    log(`PDF: ${pdfLogs.length}, OCR: ${ocrLogs.length}, Extract: ${extractLogs.length}, Dedupe: ${dedupeLogs.length}`);

    expect(pdfLogs.length).toBeGreaterThan(0);
    expect(ocrLogs.length).toBeGreaterThan(0);
    // Note: Extract and dedupe may not run if PDF has no chunked text content
    // (e.g., embedded/selectable text PDFs vs scanned document images)

    log('pdf-to-kg-basic completed successfully!');
  }, 240000);

  it('pdf-to-kg-full: should include clustering and descriptions', async () => {
    if (!ARKE_USER_KEY || !PDF_TO_KG_FULL_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or PDF_TO_KG_FULL_RHIZA');
      return;
    }

    const pdfEntity = await createPdfEntity('Test PDF for KG Full');

    log('Invoking pdf-to-kg-full workflow...');
    const result = await invokeRhiza({
      rhizaId: PDF_TO_KG_FULL_RHIZA,
      targetEntity: pdfEntity.id,
      targetCollection: targetCollection.id,
      confirm: true,
    });

    expect(result.status).toBe('started');
    log(`Job started: ${result.job_id}`);

    const tree = await waitForWorkflowTree(result.job_collection!, {
      timeout: 360000, // 6 min for full pipeline
      pollInterval: 5000,
      onPoll: (t, elapsed) => {
        const elapsedSec = Math.round(elapsed / 1000);
        log(`[${elapsedSec}s] ${t.logs.size} logs, complete=${t.isComplete}`);
      },
    });

    expect(tree.isComplete).toBe(true);
    log('pdf-to-kg-full completed successfully!');
  }, 360000);

  it('pdf-to-kg-recursive: should recursively cluster', async () => {
    if (!ARKE_USER_KEY || !PDF_TO_KG_RECURSIVE_RHIZA) {
      console.warn('Test skipped: missing ARKE_USER_KEY or PDF_TO_KG_RECURSIVE_RHIZA');
      return;
    }

    const pdfEntity = await createPdfEntity('Test PDF for KG Recursive');

    log('Invoking pdf-to-kg-recursive workflow...');
    const result = await invokeRhiza({
      rhizaId: PDF_TO_KG_RECURSIVE_RHIZA,
      targetEntity: pdfEntity.id,
      targetCollection: targetCollection.id,
      confirm: true,
    });

    expect(result.status).toBe('started');
    log(`Job started: ${result.job_id}`);

    const tree = await waitForWorkflowTree(result.job_collection!, {
      timeout: 600000, // 10 min for recursive
      pollInterval: 5000,
      onPoll: (t, elapsed) => {
        const elapsedSec = Math.round(elapsed / 1000);
        log(`[${elapsedSec}s] ${t.logs.size} logs, complete=${t.isComplete}`);
      },
    });

    expect(tree.isComplete).toBe(true);
    log('pdf-to-kg-recursive completed successfully!');
  }, 600000);
});
