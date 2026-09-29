import { tool } from './tool.js';

/** A mail server: read the inbox, send mail. Built for read_email+send_email. */
export const MAIL = [
  tool('Claude Code', 'gmail', 'list_messages', 'Lists messages in the inbox.', ['query', 'maxResults']),
  tool('Claude Code', 'gmail', 'read_email', 'Returns the body of one email.', ['messageId']),
  tool('Claude Code', 'gmail', 'send_email', 'Sends an email to the given recipients.', ['to', 'subject', 'body']),
];
