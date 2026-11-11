/**
 * Shortens text to at most `maxChars` characters by cutting from the middle.
 * An email address keeps its start and its whole domain
 * ("georgealb…@example.com"); the domain is never cut, so a very long domain
 * may give a result longer than maxChars. Anything else keeps its start and
 * its end. Pure.
 */
export function middleEllipsis(text: string, maxChars: number): string {
  const s = typeof text === 'string' ? text : '';
  const max = Number.isFinite(maxChars) ? Math.floor(maxChars) : s.length;
  if (s.length <= max) return s;
  const at = s.lastIndexOf('@');
  if (at > 0 && at < s.length - 1) {
    const domain = s.slice(at);
    // At least one character of the name, so it still reads as an address.
    const keep = Math.max(1, max - 1 - domain.length);
    return `${s.slice(0, keep)}…${domain}`;
  }
  if (max <= 1) return '…';
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${s.slice(0, head)}…${tail > 0 ? s.slice(s.length - tail) : ''}`;
}
