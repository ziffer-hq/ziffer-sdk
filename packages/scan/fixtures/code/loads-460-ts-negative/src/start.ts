// The README is read and printed to the console: it reaches no model, and it has no skill shape.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

console.log(readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8'));
