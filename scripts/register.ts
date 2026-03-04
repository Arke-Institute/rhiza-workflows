#!/usr/bin/env npx tsx
/**
 * Unified Rhiza Workflow Registration Script
 *
 * Registers rhiza workflows to Arke from the workflows/ directory.
 *
 * Usage:
 *   ARKE_USER_KEY=uk_... npm run register -- --all                    # Register all (test)
 *   ARKE_USER_KEY=uk_... npm run register:prod -- --all               # Register all (main)
 *   ARKE_USER_KEY=uk_... npm run register -- --workflow pdf-to-kg-full # Register one (test)
 *   ARKE_USER_KEY=uk_... npm run register:prod -- --workflow pdf-to-kg-full # Register one (main)
 *   ARKE_USER_KEY=uk_... npm run register -- --dry-run --all          # Preview only
 *   ARKE_USER_KEY=uk_... npm run register -- --force --all            # Force update (ignore hash)
 *   ARKE_USER_KEY=uk_... npm run register -- --list                   # List available workflows
 */

import * as fs from 'fs';
import * as path from 'path';
import { ArkeClient } from '@arke-institute/sdk';
import {
  syncRhiza,
  readState,
  writeState,
  getStateFilePath,
  findWorkspaceConfig,
  resolveWorkspaceCollection,
  type RhizaConfig,
  type RhizaRegistrationState,
  type DryRunResult,
  type SyncResult,
} from '@arke-institute/rhiza/registration';

// =============================================================================
// Configuration
// =============================================================================

const ARKE_USER_KEY = process.env.ARKE_USER_KEY;
const WORKFLOWS_DIR = path.join(process.cwd(), 'workflows');

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Recursively substitute environment variables in workflow definitions.
 * Values starting with $ are replaced with the corresponding env var.
 */
function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    if (obj.startsWith('$')) {
      const envVar = obj.slice(1);
      const value = process.env[envVar];
      if (!value) {
        throw new Error(`Environment variable ${envVar} is not set`);
      }
      return value;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVars);
  }

  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const newKey =
        typeof key === 'string' && key.startsWith('$')
          ? (process.env[key.slice(1)] ?? key)
          : key;
      result[newKey] = substituteEnvVars(value);
    }
    return result;
  }

  return obj;
}

function isDryRunResult(
  result: SyncResult<RhizaRegistrationState> | DryRunResult
): result is DryRunResult {
  return (
    result.action === 'would_create' ||
    result.action === 'would_update' ||
    (result.action === 'unchanged' && !('state' in result))
  );
}

function listWorkflows(): string[] {
  const files = fs.readdirSync(WORKFLOWS_DIR);
  return files
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort();
}

function parseArgs(): {
  isProduction: boolean;
  isDryRun: boolean;
  force: boolean;
  migrateCollection: boolean;
  listOnly: boolean;
  registerAll: boolean;
  specificWorkflow: string | null;
  activate: boolean;
} {
  const args = process.argv.slice(2);
  const isProduction = args.includes('--production') || args.includes('--prod');
  const isDryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const migrateCollection = args.includes('--migrate-collection');
  const listOnly = args.includes('--list');
  const registerAll = args.includes('--all');
  const activate = args.includes('--activate');

  let specificWorkflow: string | null = null;
  const workflowIdx = args.indexOf('--workflow');
  if (workflowIdx !== -1 && args[workflowIdx + 1]) {
    specificWorkflow = args[workflowIdx + 1].replace(/\.json$/, '');
  }

  return { isProduction, isDryRun, force, migrateCollection, listOnly, registerAll, specificWorkflow, activate };
}

// =============================================================================
// Main
// =============================================================================

async function registerWorkflow(
  client: ArkeClient,
  workflowName: string,
  network: 'test' | 'main',
  options: {
    isDryRun: boolean;
    force: boolean;
    migrateCollection: boolean;
    collectionId?: string;
    activate: boolean;
  }
): Promise<{ success: boolean; rhizaId?: string; action?: string }> {
  const workflowFile = path.join(WORKFLOWS_DIR, `${workflowName}.json`);

  if (!fs.existsSync(workflowFile)) {
    console.error(`  Error: Workflow file not found: ${workflowFile}`);
    return { success: false };
  }

  // Load and parse workflow definition
  const rawContent = fs.readFileSync(workflowFile, 'utf-8');
  const rawWorkflow = JSON.parse(rawContent);

  // Substitute environment variables
  let config: RhizaConfig;
  try {
    config = substituteEnvVars(rawWorkflow) as RhizaConfig;
  } catch (error) {
    console.error(`  Error: ${(error as Error).message}`);
    return { success: false };
  }

  console.log(`  Label: ${config.label}`);
  console.log(`  Version: ${config.version}`);
  console.log(`  Steps: ${Object.keys(config.flow).length}`);

  // Load existing state
  const stateFile = getStateFilePath(`.rhiza-state-${workflowName}`, network);
  const state = readState<RhizaRegistrationState>(stateFile);
  let updatedState = state;

  if (state) {
    console.log(`  Found existing rhiza: ${state.rhiza_id}`);
  }

  // Handle --migrate-collection
  if (options.migrateCollection && state && options.collectionId && state.collection_id !== options.collectionId) {
    if (!options.isDryRun) {
      console.log(`  Migrating rhiza from ${state.collection_id} to ${options.collectionId}...`);

      const { data: tipData, error: tipError } = await client.api.GET('/entities/{id}/tip', {
        params: { path: { id: state.rhiza_id } },
      });

      if (tipError || !tipData) {
        console.error(`  Failed to get entity tip: ${tipError?.error || 'Unknown error'}`);
        return { success: false };
      }

      const { error: updateError } = await client.api.PUT('/entities/{id}', {
        params: { path: { id: state.rhiza_id } },
        body: {
          expect_tip: tipData.cid,
          relationships_remove: [{ peer: state.collection_id, predicate: 'collection' }],
          relationships_add: [{ peer: options.collectionId, peer_type: 'collection', predicate: 'collection' }],
        } as any,
      });

      if (updateError) {
        console.error(`  Failed to migrate rhiza: ${updateError.error || 'Unknown error'}`);
        return { success: false };
      }

      updatedState = { ...state, collection_id: options.collectionId, updated_at: new Date().toISOString() };
      writeState(stateFile, updatedState);
      console.log(`  Migrated to collection ${options.collectionId}`);
    } else {
      console.log(`  Would migrate rhiza from ${state.collection_id} to ${options.collectionId}`);
    }
  }

  try {
    // Sync rhiza
    const result = await syncRhiza(client, config, updatedState, {
      network,
      dryRun: options.isDryRun,
      force: options.force,
      collectionId: options.collectionId,
      collectionLabel: `Rhiza: ${config.label}`,
    });

    // Handle dry run result
    if (isDryRunResult(result)) {
      console.log(`  Would: ${result.action}`);
      if (result.changes && result.changes.length > 0) {
        for (const change of result.changes) {
          console.log(`    ${change.field}: ${change.from ?? '(none)'} -> ${change.to}`);
        }
      }
      return { success: true, action: result.action };
    }

    // Handle actual sync result
    const { action, state: newState } = result;

    // Save state
    if (action !== 'unchanged') {
      writeState(stateFile, newState);
    }

    console.log(`  ${action.charAt(0).toUpperCase() + action.slice(1)}: ${newState.rhiza_id}`);

    // Activate if requested
    if (options.activate && !options.isDryRun && (action === 'created' || action === 'updated')) {
      const { data: tipData } = await client.api.GET('/entities/{id}/tip', {
        params: { path: { id: newState.rhiza_id } },
      });

      if (tipData) {
        const { error: activateError } = await client.api.PUT('/entities/{id}', {
          params: { path: { id: newState.rhiza_id } },
          body: {
            expect_tip: tipData.cid,
            properties: { status: 'active' },
          },
        });

        if (activateError) {
          console.log(`  Warning: Failed to activate: ${activateError.error}`);
        } else {
          console.log(`  Activated`);
        }
      }
    }

    return { success: true, rhizaId: newState.rhiza_id, action };
  } catch (error) {
    console.error(`  Registration failed: ${error instanceof Error ? error.message : error}`);
    return { success: false };
  }
}

async function main() {
  const {
    isProduction,
    isDryRun,
    force,
    migrateCollection,
    listOnly,
    registerAll,
    specificWorkflow,
    activate,
  } = parseArgs();

  const network = isProduction ? 'main' : 'test';

  // List workflows only
  if (listOnly) {
    console.log('\nAvailable workflows:');
    const workflows = listWorkflows();
    for (const w of workflows) {
      console.log(`  - ${w}`);
    }
    console.log(`\nTotal: ${workflows.length} workflows`);
    return;
  }

  // Validate ARKE_USER_KEY
  if (!ARKE_USER_KEY) {
    console.error('Error: ARKE_USER_KEY environment variable is required');
    process.exit(1);
  }

  // Determine which workflows to register
  let workflowsToRegister: string[];

  if (specificWorkflow) {
    workflowsToRegister = [specificWorkflow];
  } else if (registerAll) {
    workflowsToRegister = listWorkflows();
  } else {
    console.error('Error: Specify --all to register all workflows, or --workflow <name> for a specific one');
    console.error('       Use --list to see available workflows');
    process.exit(1);
  }

  console.log(`\nRhiza Workflow Registration (${network} network)${isDryRun ? ' [DRY RUN]' : ''}${force ? ' [FORCE]' : ''}${activate ? ' [ACTIVATE]' : ''}\n`);
  console.log(`Workflows to register: ${workflowsToRegister.length}`);

  // Create client
  const client = new ArkeClient({ authToken: ARKE_USER_KEY, network });

  // Resolve workspace collection
  const workspace = findWorkspaceConfig();
  let collectionId: string | undefined;

  if (workspace) {
    console.log(`Found workspace config: ${workspace.path}`);
    if (!isDryRun) {
      const resolved = await resolveWorkspaceCollection(client, network, workspace.path);
      collectionId = resolved.collectionId;
      if (!resolved.created) {
        console.log(`Using workspace collection: ${collectionId}`);
      }
    } else {
      const networkConfig = workspace.config[network];
      if (networkConfig.collection_id) {
        collectionId = networkConfig.collection_id;
        console.log(`Would use workspace collection: ${collectionId}`);
      } else {
        console.log(`Would create workspace collection: ${networkConfig.collection_label}`);
      }
    }
  }

  console.log('');

  // Register each workflow
  const results: { name: string; success: boolean; rhizaId?: string; action?: string }[] = [];

  for (const workflowName of workflowsToRegister) {
    console.log(`[${workflowName}]`);
    const result = await registerWorkflow(client, workflowName, network, {
      isDryRun,
      force,
      migrateCollection,
      collectionId,
      activate,
    });
    results.push({ name: workflowName, ...result });
    console.log('');
  }

  // Summary
  console.log('='.repeat(60));
  console.log('Registration Summary');
  console.log('='.repeat(60));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\nSuccessful: ${successful.length}`);
  for (const r of successful) {
    console.log(`  - ${r.name}: ${r.action || 'ok'}${r.rhizaId ? ` (${r.rhizaId})` : ''}`);
  }

  if (failed.length > 0) {
    console.log(`\nFailed: ${failed.length}`);
    for (const r of failed) {
      console.log(`  - ${r.name}`);
    }
    process.exit(1);
  }

  console.log('\nDone!');
}

main();
