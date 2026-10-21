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

// Typed letters in order, with gaps: "blc" and "bcony" both fit "balcony".
function isSubsequence(token: string, word: string): boolean {
  let at = 0;
  for (const letter of word) if (letter === token[at]) at++;
  return at === token.length;
}

// shortcut: loose on purpose (a typo budget by length, plus skipped letters); tighten if unrelated homes start matching.
function tokenMatches(token: string, word: string): boolean {
  if (word.includes(token)) return true;
  if (token.length < 3 || /\d/.test(token)) return false;
  // Skipped letters must keep the word's first letter, so "blc" cannot match "cabin".
  if (token[0] === word[0] && isSubsequence(token, word)) return true;
  if (token.length < 4) return false;
  const allowed = token.length >= 9 ? 3 : token.length >= 6 ? 2 : 1;
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
