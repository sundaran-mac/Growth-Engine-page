/** Escapes `%`, `_` and `\` so user text is matched literally inside ILIKE. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
