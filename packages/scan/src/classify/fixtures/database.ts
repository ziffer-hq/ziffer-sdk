import { tool } from './tool.js';

/** A database reader and a chat sender. Built for read_database+external_send. */
export const DATABASE = [
  tool('GitHub Copilot', 'postgres', 'query', 'Runs a read-only SELECT and returns rows.', ['sql']),
  tool('GitHub Copilot', 'slack', 'send_message', 'Sends a message to a channel.', ['channel', 'text']),
];
