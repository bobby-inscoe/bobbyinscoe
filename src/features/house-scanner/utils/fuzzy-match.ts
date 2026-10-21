// Lowercase and drop accents, so "Linnegatan" finds "Linnégatan" and "Molndal" finds "Mölndal".
const fold = (text: string) =>
  text.toLocaleLowerCase('sv-SE').normalize('NFD').replace(/\p{M}/gu, '');
const words = (text: string) =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length];
}

// shortcut: typo budget by length only, so a short word never matches loosely; upgrade if real queries miss.
function tokenMatches(token: string, word: string): boolean {
  if (word.includes(token)) return true;
  if (token.length < 4 || /\d/.test(token)) return false;
  const allowed = token.length >= 8 ? 2 : 1;
  // A typo anywhere in the word, or in the typed start of a longer one.
  return (
    distance(token, word) <= allowed ||
    distance(token, word.slice(0, token.length)) <= allowed
  );
}

/** Every word of the query must match a word of the text, allowing a typo in longer words. */
export function fuzzyMatches(text: string, query: string): boolean {
  const tokens = words(query);
  const candidates = words(text);
  return tokens.every((token) =>
    candidates.some((word) => tokenMatches(token, word)),
  );
}
