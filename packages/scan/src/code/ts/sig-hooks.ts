/**
 * Coding-assistant hooks (record §3.20): not the application's tools, but the HOST's
 * own interception points for the tools a coding assistant calls in this repository
 * (a shell, file edits, MCP). Each is reported as an interception point already
 * present -- or absent -- never as a tool:
 *
 * - Claude Code, `.claude/settings.json` / `settings.local.json`: `hooks.PreToolUse`
 *   (and `PermissionRequest`) run before a call and can refuse it (K1); a blocking hook
 *   "takes precedence over all permission rules".
 * - Cursor, `.cursor/hooks.json`: `preToolUse`, `beforeShellExecution`,
 *   `beforeMCPExecution`, `beforeReadFile` can deny; a malformed response blocks (K1).
 * - Devin Desktop (formerly Windsurf), `.devin/hooks.json` / `.windsurf/hooks.json`:
 *   `pre_run_command`, `pre_mcp_tool_use`, `pre_write_code`, `pre_read_code` block with
 *   exit code 2 (K1).
 * - `.mcp.json`, `.cursor/mcp.json`: MCP servers the assistant can call; their tools are
 *   listed at runtime.
 *
 * The contract has no field for an interception point that is not a tool, so each file
 * says its sentence in the honesty lines (`not_seen`).
 */

import { readFileSync } from 'node:fs';
import { basename, dirname, relative } from 'node:path';
import ts from 'typescript';

import { note, type ExtractContext } from './common.js';
import { getProp, propValue, propertyNameText, stringValue } from './util.js';

interface Host {
  name: string;
  /** Events that run BEFORE the assistant's action and can refuse it. */
  before: readonly string[];
}

const CLAUDE: Host = { name: 'Claude Code', before: ['PreToolUse', 'PermissionRequest'] };
const CURSOR: Host = { name: 'Cursor', before: ['preToolUse', 'beforeShellExecution', 'beforeMCPExecution', 'beforeReadFile'] };
const DEVIN: Host = { name: 'Devin Desktop (formerly Windsurf)', before: ['pre_run_command', 'pre_mcp_tool_use', 'pre_write_code', 'pre_read_code'] };

function hostOf(file: string): Host | undefined {
  const parent = basename(dirname(file));
  if (parent === '.claude') return CLAUDE;
  if (parent === '.cursor' && basename(file) === 'hooks.json') return CURSOR;
  if ((parent === '.devin' || parent === '.windsurf') && basename(file) === 'hooks.json') return DEVIN;
  return undefined;
}

function jsonTop(file: string): { top: ts.ObjectLiteralExpression; sf: ts.SourceFile } | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSON);
  const st = sf.statements[0];
  return st !== undefined && ts.isExpressionStatement(st) && ts.isObjectLiteralExpression(st.expression) ? { top: st.expression, sf } : undefined;
}

function lineOf(sf: ts.SourceFile, n: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
}

function list(xs: string[], max = 3): string {
  return xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`;
}

/** Claude Code's `matcher` strings under one event: which tools the hook is for. */
function matchers(entries: ts.Node | undefined): string[] {
  if (entries === undefined || !ts.isArrayLiteralExpression(entries)) return [];
  const out: string[] = [];
  for (const el of entries.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue;
    const m = stringValue(propValue(getProp(el, 'matcher')));
    out.push(m === undefined || m === '' || m === '*' ? 'every tool' : `"${m}"`);
  }
  return [...new Set(out)];
}

function hooksSentence(rel: string, host: Host, sf: ts.SourceFile, top: ts.ObjectLiteralExpression): string {
  const hooksNode = propValue(getProp(top, 'hooks'));
  const hooks = hooksNode !== undefined && ts.isObjectLiteralExpression(hooksNode) ? hooksNode : undefined;
  let permissions = '';
  const perm = propValue(getProp(top, 'permissions'));
  if (host === CLAUDE && perm !== undefined && ts.isObjectLiteralExpression(perm)) {
    const allow = propValue(getProp(perm, 'allow'));
    const rules = allow !== undefined && ts.isArrayLiteralExpression(allow) ? allow.elements.map((e) => stringValue(e)).filter((x): x is string => x !== undefined) : [];
    // The tool each rule names, never the rule as written: a rule can hold a whole command line.
    const tools = [...new Set(rules.map((r) => (r.includes('(') ? r.slice(0, r.indexOf('(')) : r).trim()).filter((t) => /^[A-Za-z_][\w-]*$/.test(t)))];
    if (rules.length > 0) permissions = ` Its permission rules let ${rules.length} tool pattern(s) run without asking${tools.length > 0 ? `, on ${list(tools, 5)}` : ''}.`;
  }
  const events = hooks === undefined ? [] : hooks.properties.map((p) => (ts.isSpreadAssignment(p) ? undefined : propertyNameText(p.name))).filter((x): x is string => x !== undefined);
  const before = events.filter((e) => host.before.includes(e));
  if (hooks === undefined || events.length === 0) {
    return `${rel} (${host.name}) registers no hook: nothing checks the coding assistant's tool calls in this repository before they run, beyond the host's own permission prompts.${permissions}`;
  }
  if (before.length === 0) {
    return `${rel}:${lineOf(sf, hooks)} (${host.name}) registers hooks only around or after the coding assistant's actions (${list(events)}): none runs before a tool call, so nothing there can refuse one.${permissions}`;
  }
  const parts = before.map((e) => {
    const p = getProp(hooks, e);
    const ms = host === CLAUDE ? matchers(propValue(p)) : [];
    return `${e}${ms.length > 0 ? ` for ${list(ms)}` : ''} at line ${p === undefined ? '?' : lineOf(sf, p)}`;
  });
  return `${rel} (${host.name}) registers hooks that run before the coding assistant's actions and can refuse them (${parts.join('; ')}): an interception point already present (K1). They govern the assistant working in this repository, not the application's own model; a ZIFFER check can be called from one.${permissions}`;
}

function mcpSentence(rel: string, top: ts.ObjectLiteralExpression): string | undefined {
  const servers = propValue(getProp(top, 'mcpServers'));
  if (servers === undefined || !ts.isObjectLiteralExpression(servers)) return undefined;
  const names = servers.properties.map((p) => (ts.isSpreadAssignment(p) ? undefined : propertyNameText(p.name))).filter((x): x is string => x !== undefined);
  if (names.length === 0) return undefined;
  return `${rel} configures ${names.length} MCP server(s) for a coding assistant (${list(names)}): their tools are reachable from the assistant and are listed at runtime, not here.`;
}

/** After the pass: one honesty line per coding-assistant file in the tree. */
export function assistantFiles(ctx: Pick<ExtractContext, 'root' | 'facts'>, files: readonly string[]): void {
  for (const file of [...files].sort()) {
    const rel = relative(ctx.root, file).split('\\').join('/');
    const parsed = jsonTop(file);
    if (parsed === undefined) continue;
    const host = hostOf(file);
    const at = { file: rel, line: 1, col: 1 };
    // The kind travels with the note (ACP-464): a report places it with the coding assistants, not the application.
    if (host !== undefined) note(ctx.facts, `coding-assistant-hooks:${rel}`, hooksSentence(rel, host, parsed.sf, parsed.top), at, 'assistant-config');
    else {
      const s = mcpSentence(rel, parsed.top);
      if (s !== undefined) note(ctx.facts, `coding-assistant-hooks:${rel}`, s, at, 'assistant-config');
    }
  }
}
