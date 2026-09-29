import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {durableFingerprint} from './fingerprint.mjs';
import {selectNextUnit} from './scheduler.mjs';

export function evaluateSupervisorState(input) {
  if (!input || typeof input !== 'object') throw new TypeError('input must be an object');
  const fingerprint = durableFingerprint(input.fingerprint);
  const scheduler = selectNextUnit(input.units);
  return {
    schema: 'vnext5.autonomy-supervisor-control.v1',
    fingerprint_digest: fingerprint.digest,
    scheduler
  };
}

async function readStdin() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 1048576) throw new Error('CONTROL_INPUT_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const raw = process.argv[2]
      ? fs.readFileSync(process.argv[2], 'utf8')
      : await readStdin();
    if (Buffer.byteLength(raw, 'utf8') > 1048576) throw new Error('CONTROL_INPUT_TOO_LARGE');
    process.stdout.write(JSON.stringify(evaluateSupervisorState(JSON.parse(raw))) + '\n');
  } catch (error) {
    process.stderr.write(String(error?.message || error) + '\n');
    process.exitCode = 2;
  }
}
