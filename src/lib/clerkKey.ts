/**
 * Build-time shape check for NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (TF-022).
 *
 * A malformed key (stray quotes from a paste, a trailing space, a truncated
 * value) makes Clerk build its script URL with an empty host, and sign-in
 * silently breaks at runtime. next.config.ts calls publishableKeyProblem and
 * fails the build instead. ClerkClientProvider is unchanged: its no-key
 * branch renders without ClerkProvider, and the hooks the Sidebar and pages
 * call would throw without it, so a bad key must not be treated as missing.
 *
 * Mirrors Clerk's own check (@clerk/shared keys: isPublishableKey): prefix
 * pk_live_ or pk_test_, exactly three parts when split on "_", and the third
 * part base64-decodes to a string that ends in "$", has no other "$" and
 * contains a ".". Reasons name the problem, never the value.
 */

const LIVE_PREFIX = 'pk_live_';
const TEST_PREFIX = 'pk_test_';

/** Base64 to text, the way Clerk's isomorphicAtob does it (atob when the
 *  runtime has it, Buffer otherwise). Throws on input atob rejects. */
function decodeBase64(encoded: string): string {
  if (typeof atob === 'function') return atob(encoded);
  return Buffer.from(encoded, 'base64').toString();
}

/**
 * Returns a short reason the key is malformed, or null when it has the shape
 * Clerk accepts. An empty string is a problem too; callers that allow an
 * unset variable check for emptiness first.
 */
export function publishableKeyProblem(key: string): string | null {
  if (key === '') return 'is empty';
  if (/^[\s'"`]|[\s'"`]$/.test(key)) return 'starts or ends with a quote or space';
  if (key.startsWith('sk_')) {
    return 'looks like a secret key; never put a secret key in a NEXT_PUBLIC_ variable';
  }
  if (!key.startsWith(LIVE_PREFIX) && !key.startsWith(TEST_PREFIX)) {
    return 'does not start with pk_live_ or pk_test_';
  }
  const parts = key.split('_');
  if (parts.length !== 3) return 'does not split into exactly three parts on underscores';
  const encoded = parts[2];
  if (!encoded) return 'has nothing after the prefix';

  let decoded: string;
  try {
    decoded = decodeBase64(encoded);
  } catch {
    return 'does not decode to a host';
  }
  if (!decoded.endsWith('$')) return 'does not decode to a host (the decoded value does not end with $)';
  const host = decoded.slice(0, -1);
  if (host.includes('$')) return 'does not decode to a host (the decoded value has more than one $)';
  if (!host.includes('.')) return 'does not decode to a host (the decoded value has no dot)';
  return null;
}
