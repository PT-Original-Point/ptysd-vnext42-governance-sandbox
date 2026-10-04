#!/usr/bin/env node
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createShadowJournal} from '../lib/shadow-journal.mjs';
import {createShadowRuntime, ensureShadowStateDirectory, summarizeShadowRun} from '../lib/shadow-runtime.mjs';

function usage() {
  return [
    'Usage:',
    '  node bin/host-supervisor.mjs --shadow-once --state-dir <absolute-path> [--operation-facts <absolute-path>]',
    '  node bin/host-supervisor.mjs --inspect-journal --state-dir <existing-absolute-path>',
    '  node bin/host-supervisor.mjs --help'
  ].join('\n');
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return {mode: 'HELP'};
  if (!['--shadow-once', '--inspect-journal'].includes(args[0]) || args[1] !== '--state-dir' ||
      (args[0] === '--inspect-journal' && args.length !== 3) ||
      (args[0] === '--shadow-once' && ![3, 5].includes(args.length)) ||
      (args[0] === '--shadow-once' && args.length === 5 && args[3] !== '--operation-facts')) {
    const error = new Error('D02_ARGUMENTS_INVALID');
    error.code = 'D02_ARGUMENTS_INVALID';
    throw error;
  }
  if (!path.isAbsolute(args[2])) {
    const error = new Error('LOCAL_SHADOW_ABSOLUTE_STATE_DIRECTORY_REQUIRED');
    error.code = 'LOCAL_SHADOW_ABSOLUTE_STATE_DIRECTORY_REQUIRED';
    throw error;
  }
  if (args.length === 5 && !path.isAbsolute(args[4])) {
    const error = new Error('D02_OPERATION_FACTS_ABSOLUTE_PATH_REQUIRED');
    error.code = 'D02_OPERATION_FACTS_ABSOLUTE_PATH_REQUIRED';
    throw error;
  }
  return {mode: args[0] === '--shadow-once' ? 'SHADOW_ONCE' : 'INSPECT_JOURNAL',
    stateDir: args[2], operationFactsPath: args.length === 5 ? args[4] : null};
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseArgs(args);
  if (parsed.mode === 'HELP') {
    process.stdout.write(usage() + '\n');
    return 0;
  }
  if (parsed.mode === 'INSPECT_JOURNAL') {
    const journal = createShadowJournal(parsed.stateDir);
    const restored = journal.restore();
    process.stdout.write(JSON.stringify({
      mode: 'INSPECT_JOURNAL',
      status: restored.status,
      sequence: restored.sequence,
      last_digest: restored.last_digest,
      record_count: restored.records.length,
      file: 'runtime-shadow-journal.jsonl'
    }, null, 2) + '\n');
    return 0;
  }

  const stateDir = ensureShadowStateDirectory(parsed.stateDir);
  const runtime = createShadowRuntime({stateDir, operationFactsPath: parsed.operationFactsPath});
  const run = await runtime.runOnce();
  process.stdout.write(JSON.stringify(summarizeShadowRun(run), null, 2) + '\n');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(JSON.stringify({
      status: 'STOPPED',
      code: error?.code || 'D02_RUNTIME_FAILED'
    }) + '\n');
    process.exitCode = 2;
  });
}
