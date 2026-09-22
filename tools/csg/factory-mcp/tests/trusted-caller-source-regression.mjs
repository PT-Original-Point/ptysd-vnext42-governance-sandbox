import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  certificateSha256,
  loadTrustedCallers,
  resolveTrustedMtlsCaller,
  createBrokerCallerAttestation,
  verifyBrokerCallerAttestationForTest,
} from '../src/trusted-caller.mjs';

const H=(c)=>'sha256:'+c.repeat(64);
const cert=Buffer.from('synthetic-test-certificate-der');
const certDigest=certificateSha256(cert);
const caller=(extra={})=>({
  caller_id:'GOV-TUNNEL-001',
  project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
  certificate_sha256:certDigest,
  principal_type:'PROJECT_DEDICATED_TUNNEL',
  tunnel_binding_id:'GOVERNANCE-CONNECTOR-001',
  identity_generation:1,
  enabled:true,
  ...extra,
});
const config=(extra={})=>({
  schema:'v49.factory-mcp.trusted-callers.v1',
  binding_mode:'PER_PROJECT_DEDICATED_TUNNEL',
  identity_generation:1,
  callers:[caller()],
  ...extra,
});

test('mTLS caller is explicitly a dedicated tunnel principal, not an ambient project claim',()=>{
  const root=mkdtempSync(join(tmpdir(),'ptysd-caller-'));
  try{
    const p=join(root,'trusted-callers.json');
    writeFileSync(p,JSON.stringify(config()));
    const cfg=loadTrustedCallers(p);
    const id=resolveTrustedMtlsCaller(cert,cfg);
    assert.equal(id.project_id,'CHATGPT_GLOBAL_SKILL_GOVERNANCE');
    assert.equal(id.principal_type,'PROJECT_DEDICATED_TUNNEL');
    assert.equal(id.tunnel_binding_id,'GOVERNANCE-CONNECTOR-001');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('one tunnel binding cannot be assigned to multiple projects',()=>{
  const root=mkdtempSync(join(tmpdir(),'ptysd-caller-'));
  try{
    const p=join(root,'trusted-callers.json');
    const cfg=config({callers:[
      caller(),
      caller({
        caller_id:'OTHER-TUNNEL-001',
        project_id:'OTHER_PROJECT',
        certificate_sha256:H('b'),
        tunnel_binding_id:'GOVERNANCE-CONNECTOR-001',
      }),
    ]});
    writeFileSync(p,JSON.stringify(cfg));
    assert.throws(()=>loadTrustedCallers(p),/TRUSTED_CALLER_TUNNEL_BINDING_DUPLICATE/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('caller revocation is visible on fresh config read without server restart semantics',()=>{
  const root=mkdtempSync(join(tmpdir(),'ptysd-caller-'));
  try{
    const p=join(root,'trusted-callers.json');
    writeFileSync(p,JSON.stringify(config()));
    assert.equal(resolveTrustedMtlsCaller(cert,loadTrustedCallers(p)).caller_id,'GOV-TUNNEL-001');

    writeFileSync(p,JSON.stringify({
      ...config(),
      identity_generation:2,
      callers:[caller({identity_generation:2,enabled:false})],
    }));
    const rotated=loadTrustedCallers(p);
    assert.equal(rotated.identity_generation,2);
    assert.throws(()=>resolveTrustedMtlsCaller(cert,rotated),/TRUSTED_CALLER_CERT_UNKNOWN/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('HMAC caller attestation binds request id and authorization generation state',()=>{
  const root=mkdtempSync(join(tmpdir(),'ptysd-caller-'));
  try{
    const cfgPath=join(root,'trusted-callers.json');
    const keyPath=join(root,'attestation-keyring.json');
    const keyHex='ab'.repeat(32);
    const keyring={
      schema:'v49.factory-mcp.caller-attestation-keyring.v1',
      keyring_generation:1,
      current:{key_id:'BROKER-HMAC-001',key_generation:1,key_hex:keyHex},
      previous:[],
    };
    writeFileSync(cfgPath,JSON.stringify(config()));
    writeFileSync(keyPath,JSON.stringify(keyring));
    const identity=resolveTrustedMtlsCaller(cert,loadTrustedCallers(cfgPath));
    const executionFence={
      control_oid:'a'.repeat(40),
      checkpoint_digest:H('c'),
      execution_fence:{
        project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
        mission_revision:'M1',
        mission_hash:H('d'),
        authorization_envelope_digest:H('e'),
        authorization_generation:7,
        authorization_state_digest:H('f'),
        operation_kind:'HOST_POWERSHELL',
        operation_id:'OP-001',
        run_id:'RUN-001',
        task_id:'TASK-001',
        attempt_id:'ATTEMPT-001',
        attempt_epoch:3,
        script_sha256:H('1'),
        timeout_seconds:30,
      },
    };
    const args={runId:'RUN-001',taskId:'TASK-001',attemptId:'ATTEMPT-001',attemptEpoch:3,timeoutSeconds:30};
    const requestId='12'.repeat(16);
    const envelope=createBrokerCallerAttestation({
      callerIdentity:identity,executionFence,args,requestId,keyringPath:keyPath,
      now:new Date('2026-09-21T12:00:00Z'),ttlSeconds:30,
    });
    const claims=verifyBrokerCallerAttestationForTest(envelope,keyring,new Date('2026-09-21T12:00:01Z'));
    assert.equal(claims.request_id,requestId);
    assert.equal(claims.authorization_generation,7);
    assert.equal(claims.authorization_state_digest,H('f'));
    assert.equal(claims.principal_type,'PROJECT_DEDICATED_TUNNEL');
    assert.equal(claims.tunnel_binding_id,'GOVERNANCE-CONNECTOR-001');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('HTTP entrypoint fresh-reads trusted caller config per request',()=>{
  const http=readFileSync(new URL('../src/http-main.mjs',import.meta.url),'utf8');
  const occurrence=(http.match(/loadTrustedCallers\(cfg\.trusted_callers_path\)/g)??[]).length;
  assert.ok(occurrence>=3,'expected startup, health, and per-request trusted caller reads');
  assert.match(http,/const trustedCallers = loadTrustedCallers\(cfg\.trusted_callers_path\);\s*const callerIdentity = resolveTrustedMtlsCaller/);
});


test('HTTPS MCP is modern-only and authInfo is supplied by the Node adapter path',()=>{
  const http=readFileSync(new URL('../src/http-main.mjs',import.meta.url),'utf8');
  assert.match(http,/legacy:\s*'reject'/);
  assert.match(http,/maxRequestBodySize:\s*1024 \* 1024/);
  assert.match(http,/req\.auth\s*=\s*\{/);
  assert.match(http,/identityFromAuthInfo\(ctx\.authInfo\)/);
  const nodeHandlerBlock=http.slice(http.indexOf('const nodeHandler = toNodeHandler'),http.indexOf('function writeHealth'));
  assert.doesNotMatch(nodeHandlerBlock,/maxRequestBodySize/);
});
