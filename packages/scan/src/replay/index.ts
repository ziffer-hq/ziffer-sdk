/** The replay module (ACP-435): the eight harness cases, twice each, through the engine; and the ninth, the scan's own (ACP-451). */

export { loadReplayData, parseBundle, parseCases, parseWords, replayDataDir } from './data.js';
export type { Grammar, HarnessBundle, IntendedCall, OwnSource, OwnTool, PlainWords, ReplayCase, ReplayData } from './data.js';
export { NotInGrammar, canonText, proposalHash, toProposal } from './proposal.js';
export {
  KeyNotDiscarded,
  NOT_EVIDENCE_BECAUSE,
  ReplayBroken,
  UNSIGNED_DEMO_LINE,
  WITHOUT_POLICY,
  replay,
  receiptText,
  verifierBundle,
  verifyCaseText,
} from './replay.js';
export type { DemoEnvelope, ReplayOptions, ReplayOutcome, ReplayResult, ReplayRow, ReplayRun } from './replay.js';
export { renderReplay, wrap } from './render.js';
export { GeneratedPolicyUnreadable, generatedReplayData } from './generated.js';
export { OWN_ABSENT_REASON, OWN_FILE, OWN_LABEL, hasOwnCase, selectOwn } from './own.js';
export type { OwnAbsent, OwnCase } from './own.js';
