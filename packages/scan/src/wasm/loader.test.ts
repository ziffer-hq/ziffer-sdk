import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEngine, EngineEnvelopeMalformed, EngineLoadError, parseEnvelope } from './loader.js';
import type { RawAbi } from './loader.js';
import { keygen } from './ops.js';

/**
 * A typed fake of the four exports over a plain ArrayBuffer. It answers every
 * call with a fixed response text, records every alloc and free, and echoes
 * the request it read so the test sees exactly what crossed the boundary.
 */
function fakeAbi(response: string | ((request: string) => string), version = 1) {
  const memory = new ArrayBuffer(1 << 16);
  let next = 8;
  const allocs: { ptr: number; len: number }[] = [];
  const frees: { ptr: number; len: number }[] = [];
  const requests: string[] = [];
  const abi: RawAbi = {
    buffer: () => memory,
    abiVersion: () => version,
    alloc: (len) => {
      const ptr = next;
      next += len + 8;
      allocs.push({ ptr, len });
      return ptr;
    },
    free: (ptr, len) => {
      frees.push({ ptr, len });
    },
    call: (ptr, len) => {
      const req = new TextDecoder().decode(new Uint8Array(memory, ptr, len));
      requests.push(req);
      const text = typeof response === 'string' ? response : response(req);
      const bytes = new TextEncoder().encode(text);
      const out = abi.alloc(bytes.length);
      new Uint8Array(memory, out, bytes.length).set(bytes);
      return (BigInt(out) << 32n) | BigInt(bytes.length);
    },
  };
  return { abi, allocs, frees, requests };
}

test('ok:false with kind refusal surfaces the clause', async () => {
  const f = fakeAbi('{"ok":false,"error":{"kind":"refusal","clause":"PR-1","message":"no envelope"}}');
  const r = await createEngine(f.abi).call('grade', {});
  assert.deepEqual(r, { ok: false, error: { kind: 'refusal', clause: 'PR-1', message: 'no envelope' } });
});

test('kind request carries no clause, and a request error that claims one is refused', async () => {
  const f = fakeAbi('{"ok":false,"error":{"kind":"request","message":"unknown op"}}');
  const r = await createEngine(f.abi).call('nope', {});
  assert.deepEqual(r, { ok: false, error: { kind: 'request', message: 'unknown op' } });
  assert.throws(
    () => parseEnvelope('{"ok":false,"error":{"kind":"request","clause":"PR-1","message":"x"}}'),
    EngineEnvelopeMalformed,
  );
  assert.throws(() => parseEnvelope('{"ok":false,"error":{"kind":"other","message":"x"}}'), /no third kind/);
  assert.throws(() => parseEnvelope('{"ok":false,"error":{"kind":"refusal","message":"x"}}'), /no clause/);
});

test('an ABI version mismatch refuses by name', () => {
  const f = fakeAbi('{"ok":true,"result":{}}', 2);
  assert.throws(
    () => createEngine(f.abi),
    (e: unknown) => e instanceof EngineLoadError && e.name === 'EngineAbiMismatch' && /ABI 2/.test(e.message),
  );
});

test('both buffers are freed exactly once, with the lengths they were allocated at', async () => {
  const f = fakeAbi('{"ok":true,"result":{"x":1}}');
  const r = await createEngine(f.abi).call('grade', { a: 1 });
  assert.equal(r.ok, true);
  assert.equal(f.allocs.length, 2);
  assert.deepEqual([...f.frees].sort((a, b) => a.ptr - b.ptr), [...f.allocs].sort((a, b) => a.ptr - b.ptr));
});

test('both buffers are freed even when the response is malformed', async () => {
  const f = fakeAbi('not json');
  await assert.rejects(createEngine(f.abi).call('grade', {}), EngineEnvelopeMalformed);
  assert.equal(f.frees.length, 2);
  assert.deepEqual([...f.frees].sort((a, b) => a.ptr - b.ptr), [...f.allocs].sort((a, b) => a.ptr - b.ptr));
});

test('the op is sent beside the request fields', async () => {
  const f = fakeAbi('{"ok":true,"result":{}}');
  await createEngine(f.abi).call('grade', { proposal: { a: 1 } });
  assert.deepEqual(JSON.parse(f.requests[0] ?? ''), { proposal: { a: 1 }, op: 'grade' });
});

test('callRaw keeps a signed number spelling byte for byte', async () => {
  const f = fakeAbi('{"ok":true,"result":{}}');
  await createEngine(f.abi).callRaw('verify', '{"amount": 1000.0}');
  assert.equal(f.requests[0], '{"op":"verify","amount": 1000.0}');
  await createEngine(f.abi).callRaw('verify', '{}');
  assert.equal(f.requests[1], '{"op":"verify"}');
});

test('a typed wrapper refuses a result outside the record by name', async () => {
  const f = fakeAbi('{"ok":true,"result":{"handle":1,"fingerprint":"sha256:ab","classical_pub_hex":"00","pq_pub_hex":"00","tier":"T3","seeded":false}}');
  await assert.rejects(keygen(createEngine(f.abi)), /EngineResultMalformed|keygen\.tier/);
});
