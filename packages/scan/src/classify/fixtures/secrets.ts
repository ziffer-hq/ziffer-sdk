import { tool } from './tool.js';

/** A secret store and a webhook. Built for read_secret+egress. */
export const SECRETS = [
  tool('Claude Desktop', 'vault', 'read_secret', 'Returns the secret stored at a path.', ['path']),
  tool('Claude Desktop', 'hooks', 'trigger_webhook', 'Triggers a webhook with a JSON payload.', ['url', 'payload']),
];
