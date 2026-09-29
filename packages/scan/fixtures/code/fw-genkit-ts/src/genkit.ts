import { genkit } from 'genkit';

export const ai = genkit({ plugins: [] });

// The application re-exports genkit's `z` for its own modules.
export { z } from 'genkit';
