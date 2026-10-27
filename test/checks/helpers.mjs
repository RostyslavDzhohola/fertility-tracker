// Shared test helpers (not a test file: node --test only picks up *.test.mjs here).

// Remove inline code spans (GitHub renders nothing inside them), leaving the text GitHub would parse.
export const outsideCodeSpans = (md) => md.replace(/(`+) [^\n]*? \1/g, "");
