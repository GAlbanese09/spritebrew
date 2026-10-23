/**
 * SpriteBrew admins, server side only (private-config 001). The Clerk user ids
 * live in the `ADMIN_USER_IDS` secret (comma-separated, production and
 * preview), never in the code or the browser bundle. Grants: queue-path
 * routing, free-tier cap bypass, cost visibility, the admin smoke routes.
 *
 * Fails closed: an unset, empty or unreadable secret means no admins.
 * Never import this from a client component; the client learns only its own
 * `isAdmin` boolean, from /api/token-balance.
 */

/** Parse a comma list: trim each entry, drop empties, dedupe. */
export function adminIdsFrom(raw: unknown): readonly string[] {
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

/** Is this user a SpriteBrew admin? Reads the secret on every call. */
export function isAdminUserServer(userId: string | null | undefined): boolean {
  if (!userId) return false;
  let raw: unknown;
  try {
    raw = (process.env as Record<string, unknown>).ADMIN_USER_IDS;
  } catch {
    return false;
  }
  return adminIdsFrom(raw).includes(userId);
}
