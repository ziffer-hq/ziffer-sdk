import { tool } from './tool.js';

/** A browser and a shell. Built for untrusted_fetch+irreversible. */
export const BROWSER_SHELL = [
  tool('Cursor', 'browser', 'browser_navigate', 'Navigates the browser to a URL and returns the page text.', ['url']),
  tool('Cursor', 'shell', 'run_command', 'Runs a shell command on this machine.', ['command']),
];
