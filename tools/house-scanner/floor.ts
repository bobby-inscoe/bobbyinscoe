/**
 * Floor 2 or higher is above ground under every numbering convention, so it is
 * the only number that proves "not ground floor". Floor 1 may or may not be
 * ground level, so it stays unknown, as do missing and unparseable values.
 * Only an explicit marker (BV, bottenvåning) or 0 proves the ground floor.
 */
export function groundFloorOf(raw: unknown): boolean | null {
  const text =
    typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : '';
  const value = text.trim();
  if (/^(?:bv|bottenv[aå]ning)\b/i.test(value)) return true;
  const digits = /^(\d{1,3})(?![\d.,])/.exec(value);
  if (digits === null) return null;
  const floor = Number(digits[1]);
  if (floor === 0) return true;
  return floor >= 2 ? false : null;
}
