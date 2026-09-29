import { tool } from './tool.js';

/** A filesystem and a file-sharing server. Built for read_file+share_file. */
export const FILES_SHARE = [
  tool('Windsurf', 'filesystem', 'read_file', 'Reads a file from disk.', ['path']),
  tool('Windsurf', 'drive', 'share_document', 'Shares a document with an email address.', ['documentId', 'email']),
];
