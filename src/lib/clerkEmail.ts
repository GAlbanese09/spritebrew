// The user's primary email, read server-side from Clerk's Backend API with
// CLERK_SECRET_KEY (never a client-supplied address). Shared by the email-list
// route and the opening's disposable-email check (private-config 005).
//
// Returns null when there is no secret, the call fails, answers non-2xx, has
// no email, or takes longer than the timeout (3 s by default).

interface ClerkUser {
  primary_email_address_id?: string;
  email_addresses?: Array<{ id: string; email_address: string }>;
}

export const CLERK_EMAIL_TIMEOUT_MS = 3000;

export async function fetchClerkPrimaryEmail(
  userId: string,
  timeoutMs: number = CLERK_EMAIL_TIMEOUT_MS
): Promise<string | null> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const user = (await res.json()) as ClerkUser;
    const primary = user.email_addresses?.find(
      (e) => e.id === user.primary_email_address_id
    );
    return primary?.email_address ?? user.email_addresses?.[0]?.email_address ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
