/**
 * Nothing is started without the person's say-so (ACP-440).
 *
 * Starting an MCP server runs a program from a config file this tool did not
 * write. Before ANY spawn the exact list -- client, server, command and
 * arguments, credentials redacted -- is printed, and the answer `y` is required on stdin. `--yes`
 * skips the question for a person who has read the list another way. With no
 * terminal to ask on and no `--yes`, the run refuses by name (`NotInteractive`)
 * and starts nothing: a piped or CI invocation that silently started every
 * server it found would be the one case where the question mattered most.
 */

import { createInterface } from 'node:readline/promises';

import { clientsPhrase, configuredPhrase, distinct, type StartGroup } from '../discovery/group.js';
import { redactArgv, redactEnv, redactText } from '../redact/index.js';
import type { ServerEntry } from './client.js';

export class SpawnRefused extends Error {
  override readonly name: 'NotInteractive' | 'SpawnDeclined';
  constructor(name: 'NotInteractive' | 'SpawnDeclined', message: string) {
    super(`${name}: ${message}`);
    this.name = name;
  }
}

export interface ConfirmIo {
  yes: boolean;
  isTTY: boolean;
  input: NodeJS.ReadableStream;
  /** Where the list and the question go -- stderr, so `--json` stdout stays clean. */
  write: (text: string) => void;
}

function shown(arg: string): string {
  return /^[A-Za-z0-9_./:=@%+,[\]-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

function argvOf(e: ServerEntry): string {
  return [...redactEnv(e.env), ...redactArgv([e.command, ...e.args])].map(shown).join(' ');
}

function isGroups(items: readonly ServerEntry[] | readonly StartGroup[]): items is readonly StartGroup[] {
  return items.every((i) => 'signature' in i);
}

function header(n: number): string {
  return `${n} tool server${n === 1 ? '' : 's'} will be started to list their tools:`;
}

/**
 * One line per server: client, name, then the command line as it will run --
 * the environment the configuration declares first, shell-style, every value
 * `[redacted]`, then the command and its arguments with any credential in them
 * `[redacted]` (ACP-449: the first real run printed two API keys here). The
 * server itself is started with the real values.
 *
 * Given START GROUPS (ACP-454), one line per program started: its name (every
 * name it has across clients), the command line of the entry that is started,
 * and where it is configured -- the one client, or "configured in 7 AI agent
 * clients: ..." -- and the count is of programs, not of entries. Given plain
 * entries, one line per entry, as `--ci` starts them.
 */
export function describe(items: readonly ServerEntry[] | readonly StartGroup[]): string {
  if (isGroups(items)) {
    const names = items.map((g) => distinct(g.entries.map((e) => redactText(e.name))).join(', '));
    const nw = Math.max(0, ...names.map((n) => n.length));
    const lines = items.map((g, i) => {
      const clients = g.entries.map((e) => redactText(e.client));
      const where =
        clientsPhrase(clients) ??
        [clients[0] ?? '', configuredPhrase(g.first.configured_in)].filter((w) => w !== undefined && w !== '').join(', ');
      return `  ${(names[i] ?? '').padEnd(nw)}  ${argvOf(g.first)}  (${where})`;
    });
    return `${header(items.length)}\n${lines.join('\n')}\n`;
  }
  // Client and server in aligned columns (ACP-454): the first real run's list
  // of nineteen read as one ragged block.
  const clients = items.map((e) => redactText(e.client));
  const names = items.map((e) => redactText(e.name));
  const cw = Math.max(0, ...clients.map((c) => c.length));
  const nw = Math.max(0, ...names.map((n) => n.length));
  const lines = items.map((e, i) => {
    const where = configuredPhrase(e.configured_in);
    return `  ${(clients[i] ?? '').padEnd(cw)}  ${(names[i] ?? '').padEnd(nw)}  ${argvOf(e)}${where === undefined ? '' : `  (${where})`}`;
  });
  return `${header(items.length)}\n${lines.join('\n')}\n`;
}

/** Resolves when the spawn is approved; throws `SpawnRefused` otherwise. Spawns nothing itself. */
export async function confirmSpawn(entries: readonly ServerEntry[] | readonly StartGroup[], io: ConfirmIo): Promise<void> {
  if (entries.length === 0) return;
  io.write(describe(entries));
  if (io.yes) return;
  if (!io.isTTY) {
    throw new SpawnRefused('NotInteractive', 'no terminal to ask on; re-run with --yes to start the servers listed above');
  }
  const rl = createInterface({ input: io.input, terminal: false });
  try {
    io.write('Start them? [y/N] ');
    const answer = (await rl.question('')).trim().toLowerCase();
    if (answer !== 'y') throw new SpawnRefused('SpawnDeclined', 'nothing was started');
  } finally {
    rl.close();
  }
}
