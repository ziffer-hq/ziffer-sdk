/**
 * `@ziffer-io/scan` -- the library surface (ACP-433).
 *
 * The shared types and every module: the engine loader and its operations,
 * the MCP client and its confirmation, discovery, the draft classifier, the
 * bundle generator, the replay, the report, and the command line itself (the
 * `ziffer-scan` binary is `run` over the process).
 */

export type {
  CatalogTool,
  Classification,
  ControlRef,
  Finding,
  FindingKind,
  InstructionHit,
  ScanResult,
  SkillRead,
} from './types.js';

export { ABI_VERSION, createEngine, EngineEnvelopeMalformed, EngineLoadError, loadEngine, parseEnvelope } from './wasm/loader.js';
export type { Engine, EngineResponse, RawAbi, RefusalError, RequestError } from './wasm/loader.js';
export * as engineOps from './wasm/ops.js';
export { EngineWasmAbsent, locateWasm } from './wasm/locate.js';
export { DEFAULT_TIMEOUT_MS, listServerTools } from './mcp/client.js';
export type { ListOutcome, ServerEntry } from './mcp/client.js';
export { confirmSpawn, SpawnRefused } from './mcp/confirm.js';
export type { ConfirmIo } from './mcp/confirm.js';

export { run, parseArgs, HELP, DEFAULT_OUT, UsageError, refusalLine, processContext } from './cli.js';
export type { CliContext, CliIo, Command, ParsedArgs } from './cli.js';
export { packageEnginePin, packageVersion } from './package-info.js';
// Where ONE run writes beside its policy folder (ziffer-tools.json, ziffer-scan.json,
// the HTML report and the archive): `@ziffer-io/mcp` reads a run back through it
// rather than restating the file names (ACP-455).
export { outputPaths } from './code/run.js';
export * from './discovery/index.js';
export { classify, ClassifyDataInvalid, instructionHits, instructionPhrase, PAIR_IDS, pairsAmong, POISONED_IDS } from './classify/index.js';
export type { ToolPair } from './classify/index.js';
export { readSkills } from './skills/index.js';
export type { ClassifyOutput } from './classify/index.js';
export {
  BundleDirectoryOccupied,
  BundleEngineFailed,
  BundleMemberAltered,
  BundleVerifyRefused,
  DEVELOPER,
  SIDECAR,
  SUITE,
  generateBundle,
  listBundle,
  policyMembers,
  validateMembers,
  writeBundle,
} from './bundle/generate.js';
export type { BundleFile, GenerateOptions, GeneratedBundle, ToolRef } from './bundle/generate.js';
export { BundleMemberInvalid, BundleSchemaAbsent, MEMBER_SCHEMAS, validateMember } from './bundle/schemas.js';
export { assignNames, normaliseName, NAME_PATTERN } from './bundle/names.js';
export type { NameCollision, NameMap, NamedItem } from './bundle/names.js';
export * from './replay/index.js';
export * from './report/index.js';
