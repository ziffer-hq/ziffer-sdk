/**
 * The consumer side of the engine's WebAssembly ABI (ACP-434 design record,
 * §1 D2–D6). The engine's decision path -- the grading fold, the receipt gate,
 * the quorum, the crypto -- runs INSIDE the module; this file only moves JSON
 * across linear memory. It decides nothing: a branch here that inspected a
 * Proposal would be a second definition of a grading rule outside the engine.
 *
 * # The ABI, as the record states it (D2)
 *
 *   exports: ziffer_abi_version() -> u32            // 1
 *            ziffer_alloc(len) -> ptr
 *            ziffer_free(ptr, len)
 *            ziffer_call(ptr, len) -> u64           // (out_ptr << 32) | out_len
 *   imports: env.ziffer_random(ptr, len) -> u32     // 0 on success
 *
 * The request goes into memory from `ziffer_alloc`, `ziffer_call` answers with a
 * packed pointer and length, and BOTH buffers are freed. The clock is never an
 * import (D4): every op that needs `now` takes it in the request.
 *
 * # Why the ABI is bound through guards and not a cast
 *
 * `instance.exports` is a map of untyped values. Asserting it into an interface
 * would be a claim about the module the compiler cannot check; `bindExports`
 * checks each export's kind and refuses by name, so a module built against a
 * different ABI fails at load with the missing export named rather than at the
 * first call with a TypeError.
 */

import { randomFillSync } from 'node:crypto';

import { isRecord } from './json.js';

/** The ABI version this loader speaks. D2: a change to the four exports bumps it. */
export const ABI_VERSION = 1;

/** The four exports and the memory, as plain functions -- what the tests fake. */
export interface RawAbi {
  /** The CURRENT buffer: a `memory.grow` detaches the previous one, so never cache it. */
  buffer(): ArrayBuffer;
  abiVersion(): number;
  alloc(len: number): number;
  free(ptr: number, len: number): void;
  call(ptr: number, len: number): bigint;
}

/** An engine refusal: a rule fired against an artifact (D5 `kind: refusal`). */
export interface RefusalError {
  kind: 'refusal';
  clause: string;
  message: string;
}

/** The caller's own malformed request (D5 `kind: request`). Carries no clause, by design. */
export interface RequestError {
  kind: 'request';
  message: string;
}

export type EngineResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: RefusalError | RequestError };

export class EngineLoadError extends Error {
  override readonly name: string;
  constructor(name: 'EngineAbiMismatch' | 'EngineExportMissing' | 'EngineImportUnexpected', message: string) {
    super(`${name}: ${message}`);
    this.name = name;
  }
}

export class EngineEnvelopeMalformed extends Error {
  override readonly name = 'EngineEnvelopeMalformed';
}

/** The single host import the record allows (D2), answered from the OS CSPRNG (D3). */
export const ALLOWED_IMPORTS: readonly { module: string; name: string }[] = [{ module: 'env', name: 'ziffer_random' }];

function fnExport(exports: Readonly<Record<string, unknown>>, name: string): (...args: number[]) => unknown {
  const f = exports[name];
  if (typeof f !== 'function') throw new EngineLoadError('EngineExportMissing', `the module exports no function ${name}`);
  return (...args: number[]): unknown => f(...args);
}

/** Bind a real instance's exports to the ABI, checking each one's kind. */
export function bindExports(exports: Readonly<Record<string, unknown>>): RawAbi {
  const memory = exports['memory'];
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new EngineLoadError('EngineExportMissing', 'the module exports no memory');
  }
  const version = fnExport(exports, 'ziffer_abi_version');
  const alloc = fnExport(exports, 'ziffer_alloc');
  const free = fnExport(exports, 'ziffer_free');
  const call = fnExport(exports, 'ziffer_call');
  const u32 = (v: unknown, what: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      throw new EngineEnvelopeMalformed(`${what} returned ${typeof v}, not an integer`);
    }
    return v >>> 0;
  };
  return {
    buffer: () => memory.buffer,
    abiVersion: () => u32(version(), 'ziffer_abi_version'),
    alloc: (len) => u32(alloc(len), 'ziffer_alloc'),
    free: (ptr, len) => {
      free(ptr, len);
    },
    call: (ptr, len) => {
      const packed = call(ptr, len);
      if (typeof packed !== 'bigint') throw new EngineEnvelopeMalformed(`ziffer_call returned ${typeof packed}, not a u64`);
      return packed;
    },
  };
}

/** Parse D5's response envelope. Anything outside its three shapes is refused by name. */
export function parseEnvelope(text: string): EngineResponse {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new EngineEnvelopeMalformed('the response is not JSON');
  }
  if (!isRecord(v)) throw new EngineEnvelopeMalformed('the response is not an object');
  if (v['ok'] === true) {
    if (!('result' in v)) throw new EngineEnvelopeMalformed('ok:true carries no result');
    return { ok: true, result: v['result'] };
  }
  if (v['ok'] !== false) throw new EngineEnvelopeMalformed('"ok" is neither true nor false');
  const e = v['error'];
  if (!isRecord(e)) throw new EngineEnvelopeMalformed('ok:false carries no error object');
  const message = e['message'];
  if (typeof message !== 'string') throw new EngineEnvelopeMalformed('the error carries no message');
  if (e['kind'] === 'refusal') {
    const clause = e['clause'];
    if (typeof clause !== 'string' || clause === '') {
      throw new EngineEnvelopeMalformed('a refusal carries no clause');
    }
    return { ok: false, error: { kind: 'refusal', clause, message } };
  }
  if (e['kind'] === 'request') {
    // D5: a request failure carries NO clause, so a caller can never mistake
    // its own mistake for a rule firing. A clause here is a malformed envelope.
    if ('clause' in e) throw new EngineEnvelopeMalformed('a request error carries a clause');
    return { ok: false, error: { kind: 'request', message } };
  }
  throw new EngineEnvelopeMalformed('error.kind is neither "refusal" nor "request" (D5: there is no third kind)');
}

export interface Engine {
  /** `{"op": op, ...request}` through the ABI. */
  call(op: string, request: Record<string, unknown>): Promise<EngineResponse>;
  /**
   * A request whose body is JSON TEXT, sent byte for byte with the op spliced
   * in front. Needed wherever the request carries numbers whose spelling is
   * signed (a receipt's `1000.0`): JavaScript has one number type, so a
   * parse-and-stringify turns `1000.0` into `1000` and every signature over the
   * body refuses. The engine's own Node driver found this on its first run.
   */
  callRaw(op: string, objectText: string): Promise<EngineResponse>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** The engine over a bound ABI. Asserts the ABI version first, refusing by name. */
export function createEngine(abi: RawAbi): Engine {
  const version = abi.abiVersion();
  if (version !== ABI_VERSION) {
    throw new EngineLoadError('EngineAbiMismatch', `the module speaks ABI ${version}; this package speaks ${ABI_VERSION}`);
  }
  const callText = (text: string): EngineResponse => {
    const input = encoder.encode(text);
    const inPtr = abi.alloc(input.length);
    let freedIn = false;
    try {
      new Uint8Array(abi.buffer(), inPtr, input.length).set(input);
      const packed = BigInt.asUintN(64, abi.call(inPtr, input.length));
      const outPtr = Number(packed >> 32n);
      const outLen = Number(packed & 0xffffffffn);
      // Read BEFORE freeing: the view is over memory the module may reuse.
      let out: string;
      try {
        out = decoder.decode(new Uint8Array(abi.buffer(), outPtr, outLen));
      } finally {
        abi.free(outPtr, outLen);
      }
      abi.free(inPtr, input.length);
      freedIn = true;
      return parseEnvelope(out);
    } finally {
      if (!freedIn) abi.free(inPtr, input.length);
    }
  };
  return {
    call: async (op, request) => callText(JSON.stringify({ ...request, op })),
    callRaw: async (op, objectText) => {
      const body = objectText.trimStart();
      if (!body.startsWith('{')) throw new TypeError('callRaw: the request text is not a JSON object');
      const rest = body.slice(1).trimStart();
      return callText(`{"op":${JSON.stringify(op)}${rest.startsWith('}') ? '' : ','}${rest}`);
    },
  };
}

/**
 * Instantiate the module and return the engine. The import list is checked
 * against D2's one allowed import BEFORE instantiation: a hidden host import is
 * an I/O door, and this package promises nothing leaves the machine.
 */
export async function loadEngine(wasmBytes: Uint8Array): Promise<Engine> {
  const module = await WebAssembly.compile(wasmBytes);
  for (const imp of WebAssembly.Module.imports(module)) {
    if (!ALLOWED_IMPORTS.some((a) => a.module === imp.module && a.name === imp.name)) {
      throw new EngineLoadError('EngineImportUnexpected', `the module imports ${imp.module}.${imp.name}`);
    }
  }
  let abi: RawAbi | undefined;
  const instance = await WebAssembly.instantiate(module, {
    env: {
      // D3: 0 on success, non-zero on failure; the module refuses on non-zero
      // rather than falling back to anything weaker.
      ziffer_random(ptr: number, len: number): number {
        if (abi === undefined) return 1;
        try {
          randomFillSync(new Uint8Array(abi.buffer(), ptr, len));
          return 0;
        } catch {
          return 1;
        }
      },
    },
  });
  abi = bindExports(instance.exports);
  return createEngine(abi);
}
