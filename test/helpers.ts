/**
 * Shared test helpers for workflow E2E tests.
 *
 * Provides reusable utilities for creating test entities, uploading files,
 * and running workflows with consistent assertions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'vitest';
import {
  configureTestClient,
  createCollection,
  createEntity,
  invokeRhiza,
  waitForWorkflowTree,
  log,
  type WorkflowLogTree,
  type KladosLogEntry,
} from '@arke-institute/klados-testing';

// =============================================================================
// Configuration
// =============================================================================

export const ARKE_API_BASE = process.env.ARKE_API_BASE || 'https://arke-v1.arke.institute';
export const ARKE_USER_KEY = process.env.ARKE_USER_KEY;
export const NETWORK = (process.env.ARKE_NETWORK || 'main') as 'test' | 'main';

// Klados IDs for log verification
export const KLADOS_IDS = {
  SCATTER: process.env.SCATTER_KLADOS || '01KJ61043AFBTGY9CQSVDF5WW2',
  PDF_TO_JPEG: process.env.PDF_TO_JPEG_KLADOS || '01KJ6WRER2NMWF7P7AJEP33J6H',
  OCR_WORKER: process.env.OCR_WORKER_KLADOS || '01KJ6WQDQ0QRVG1VP5BJFBRG9N',
  IMAGE_CONVERTER: process.env.IMAGE_CONVERTER_KLADOS || '01KJAZMNZ3YRX46HWG2V55NXQC',
  TEXT_CHUNKER: process.env.TEXT_CHUNKER_KLADOS || '01KJ6WPT018SDDANE6N7Q8E428',
  KG_EXTRACTOR: process.env.KG_EXTRACTOR_KLADOS || '01KJ60XQBHJ0GBGTP9X8HXAPPM',
  KG_DEDUPE: process.env.KG_DEDUPE_RESOLVER_KLADOS || '01KJ60WNDBKP1GS1XSMJQ9F1AR',
  KG_CLUSTER: process.env.KG_CLUSTER_KLADOS || '01KJ60VSSCSQQ32PRJS0BQJ6Q8',
  DESCRIBE: process.env.DESCRIBE_KLADOS || '01KJ60TTR9BACEJHH5WGW2H10C',
};

// =============================================================================
// Setup Helpers
// =============================================================================

/**
 * Initialize the test client. Call in beforeAll.
 */
export function initTestClient(): void {
  if (!ARKE_USER_KEY) return;
  configureTestClient({
    apiBase: ARKE_API_BASE,
    userKey: ARKE_USER_KEY,
    network: NETWORK,
  });
}

/**
 * Create a test collection with default permissions.
 */
export async function setupTestCollection(label: string): Promise<{ id: string }> {
  const collection = await createCollection({
    label: `${label} ${Date.now()}`,
    roles: { public: ['*:view', '*:invoke'] },
  });
  log(`Created collection: ${collection.id}`);
  return collection;
}

// =============================================================================
// Entity Creation Helpers
// =============================================================================

/**
 * Create a text entity with the given content.
 */
export async function createTextEntity(
  collectionId: string,
  label: string,
  text: string,
): Promise<{ id: string }> {
  const entity = await createEntity({
    type: 'entity',
    properties: { label, text },
    collection: collectionId,
  });
  log(`Created text entity: ${entity.id} (${label})`);
  return entity;
}

interface FileUploadOptions {
  collectionId: string;
  label: string;
  filename: string;
  contentType: string;
  fixturePath: string;
}

/**
 * Create a file entity and upload binary content from a fixture.
 */
export async function createFileEntity(opts: FileUploadOptions): Promise<{ id: string }> {
  const entity = await createEntity({
    type: 'file',
    properties: {
      label: opts.label,
      content: {
        [opts.filename]: { content_type: opts.contentType },
      },
    },
    collection: opts.collectionId,
  });

  const buffer = fs.readFileSync(opts.fixturePath);
  const uploadUrl = `${ARKE_API_BASE}/entities/${entity.id}/content?key=${opts.filename}`;
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${ARKE_USER_KEY}`,
      'X-Arke-Network': NETWORK,
      'Content-Type': opts.contentType,
    },
    body: buffer,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload ${opts.filename}: ${response.statusText}`);
  }

  log(`Created file entity: ${entity.id} (${opts.label})`);
  return entity;
}

/**
 * Fixture path helper.
 */
export function fixturePath(filename: string): string {
  return path.join(__dirname, 'fixtures', filename);
}

// =============================================================================
// Workflow Execution & Assertion Helpers
// =============================================================================

interface RunWorkflowOptions {
  rhizaId: string;
  /** Single entity (for cardinality: one entry klados) */
  entityId?: string;
  /** Multiple entities (for cardinality: many entry klados, e.g. scatter) */
  entityIds?: string[];
  collectionId: string;
  timeout: number;
  input?: Record<string, unknown>;
  /** Allow workflow errors (e.g. some PDF pages have no text for KG extraction) */
  allowErrors?: boolean;
  /** Poll interval in ms (default 5000). Use higher values for large workflows to reduce API load. */
  pollInterval?: number;
}

interface WorkflowResult {
  tree: WorkflowLogTree;
  logs: KladosLogEntry[];
  jobId: string;
  jobCollection: string;
}

/**
 * Invoke a workflow, wait for completion, and run basic assertions.
 * Returns the tree and logs for further assertions.
 */
export async function runWorkflow(opts: RunWorkflowOptions): Promise<WorkflowResult> {
  const invokeOpts: Record<string, unknown> = {
    rhizaId: opts.rhizaId,
    targetCollection: opts.collectionId,
    input: opts.input,
    confirm: true,
  };
  if (opts.entityIds) {
    invokeOpts.targetEntities = opts.entityIds;
  } else if (opts.entityId) {
    invokeOpts.targetEntities = [opts.entityId];
  }
  const result = await invokeRhiza(invokeOpts as any);

  expect(result.status).toBe('started');
  expect(result.job_collection).toBeDefined();
  log(`Job started: ${result.job_id}`);

  const tree = await waitForWorkflowTree(result.job_collection!, {
    timeout: opts.timeout,
    pollInterval: opts.pollInterval || 5000,
    onPoll: (t, elapsed) => {
      const sec = Math.round(elapsed / 1000);
      log(`[${sec}s] ${t.logs.size} logs, complete=${t.isComplete}, errors=${t.hasErrors}, fetches=${t.fetchCount}`);
    },
  });

  // Log errors before asserting so failures are debuggable
  if (tree.hasErrors) {
    log(`Workflow errors: ${JSON.stringify(tree.errors, null, 2)}`);
  }

  expect(tree.isComplete).toBe(true);
  if (!opts.allowErrors) {
    expect(tree.hasErrors).toBe(false);
  }

  // All logs should have terminal status (done or error)
  const logs = Array.from(tree.logs.values());
  for (const l of logs) {
    const status = (l as any).properties?.status;
    if (opts.allowErrors) {
      expect(['done', 'error']).toContain(status);
    } else {
      expect(status).toBe('done');
    }
  }

  return {
    tree,
    logs,
    jobId: result.job_id!,
    jobCollection: result.job_collection!,
  };
}

/**
 * Filter logs by klados ID.
 */
export function filterLogs(logs: KladosLogEntry[], kladosId: string): KladosLogEntry[] {
  return logs.filter((l: any) => l.properties?.klados_id === kladosId);
}

/**
 * Assert that specific klados steps ran with expected counts.
 */
export function assertKladosRan(
  logs: KladosLogEntry[],
  expectations: Record<string, { min?: number; exact?: number }>,
): void {
  for (const [kladosId, expected] of Object.entries(expectations)) {
    const matching = filterLogs(logs, kladosId);
    if (expected.exact !== undefined) {
      expect(matching.length, `Expected ${expected.exact} logs for klados ${kladosId}`).toBe(expected.exact);
    } else if (expected.min !== undefined) {
      expect(matching.length, `Expected at least ${expected.min} logs for klados ${kladosId}`).toBeGreaterThanOrEqual(expected.min);
    }
  }
}

/**
 * Assert that a specific klados did NOT run.
 */
export function assertKladosDidNotRun(logs: KladosLogEntry[], kladosId: string): void {
  const matching = filterLogs(logs, kladosId);
  expect(matching.length, `Expected klados ${kladosId} to not run`).toBe(0);
}
