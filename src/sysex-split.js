// sysex-split.js
// Canonical tokenizer for Orville ASCII dump lines. Splits on spaces outside
// quotes and strips the quote characters, so a quoted multi-word field
// (e.g. a preset name) stays one token. Zero dependencies on purpose: this is
// a leaf module so the parser and the test fixture decoder can both import it
// without pulling in the wider module graph.

export function splitLine(line) {
  const parts = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (const char of line) {
    if ((char === "'" || char === '"') && !inQuote) {
      inQuote = true;
      quoteChar = char;
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else if (char === quoteChar && inQuote) {
      inQuote = false;
      parts.push(current.trim()); // Strip extra spaces
      current = '';
    } else if (char === ' ' && !inQuote) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
