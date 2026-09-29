/**
 * `@ziffer-io/mcp` — a local stdio MCP server so a coding agent can integrate the
 * Ziffer SDK against our real documentation and drive a live decision loop
 * while testing (ACP-197, section 6b).
 *
 * The executable is `bin.ts` (`npx @ziffer-io/mcp`). This module exports the
 * pieces so the server can be embedded, and so the tests import the same
 * surface a consumer would.
 *
 * What this server is NOT: a gate. It routes questions and makes Ziffer-side
 * calls at development time. The line that enforces anything is the `verify`
 * call in the developer's own handler — `docs/onboarding/sdk.md` section 6
 * item 3 says exactly that, and `README.md` repeats it, because it is the
 * claim most easily mistaken in the other direction.
 */

// The trust anchor reader lives in @ziffer-io/verify (one reader, not two);
// re-exported so this package's surface is unchanged.
export { loadTrustAnchor, AnchorError } from '@ziffer-io/verify';
export { zifferClientFactory } from './client.js';
export { anchorConfig, apiConfig, ConfigError, VARS, type AnchorConfig, type ApiConfig, type Env } from './config.js';
export { asLanguage, integrationGuide, LANGUAGES, type Language } from './guide.js';
export {
  checkIntegrationTool,
  formatSites,
  maskPython,
  maskTypescript,
  MAX_FILES,
  MAX_FILE_BYTES,
  SKIPPED,
  type Site,
  type SiteStatus,
  type Walked,
} from './integration-check.js';
export {
  IGNORED_KEYWORDS,
  IMPLEMENTED_KEYWORDS,
  lintFindings,
  lintProposal,
  PROPOSAL_SCHEMA,
  SCHEMA_KEYWORDS,
  SCHEMA_ROOT,
  SchemaUnsupported,
} from './proposal-lint.js';
export {
  getStarted,
  STARTED_INSTALLS,
  STARTED_SPAN_LIST,
  STARTED_START_HERE,
  TOOL_ORDER,
} from './started.js';
export { createDefaultServer, createServer, SERVER_INFO, TOOL_NAMES, type ServerDeps } from './server.js';
export {
  checkDecision,
  explainReceipt,
  getDecision,
  getIntegrationGuide,
  isSandboxName,
  listDecisions,
  propose,
  SANDBOX_SUFFIX,
  sandboxStatus,
  type ClientFactory,
  type DecisionClient,
  type DecisionListItem,
  type DecisionPage,
  type FeedbackClient,
  type FeedbackMessage,
  type FeedbackStored,
  type ZifferSurface,
  type DecisionRecord,
  type ExplainArgs,
  type GetDecisionArgs,
  type ListArgs,
  type SandboxArgs,
  type SubmittedDecision,
  type ToolOutcome,
} from './tools.js';
