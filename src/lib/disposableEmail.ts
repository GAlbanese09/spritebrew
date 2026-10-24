/**
 * Static blocklist of common disposable / throwaway email domains.
 *
 * Curated for the most-abused services we've seen across signup-bonus farming.
 * Not exhaustive — disposable providers ship new domains constantly. This is a
 * cheap first line of defense; bot-protection (Turnstile) and lifetime caps
 * carry the rest of the load.
 *
 * To add a domain: append (lowercase) and ship, or add it to the private KV
 * list below without a deploy (private-config 005). This static set is the
 * base and is never replaced by the KV list, only extended.
 */

const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  // Mailinator family
  'mailinator.com',
  'mailinator2.com',
  'mailinator.net',
  'mailinater.com',
  'mailnator.com',
  'reallymymail.com',
  'binkmail.com',
  'bobmail.info',
  'chammy.info',
  'devnullmail.com',
  'letthemeatspam.com',
  'mailin8r.com',
  'mailinator.us',
  'mailinator.org',
  'notmailinator.com',
  'reconmail.com',
  'safetymail.info',
  'sogetthis.com',
  'spamhereplease.com',
  'streetwisemail.com',
  'suremail.info',
  'thisisnotmyrealemail.com',
  'tradermail.info',
  'veryrealemail.com',
  'zippymail.info',

  // Guerrilla Mail family
  'guerrillamail.com',
  'guerrillamail.biz',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'sharklasers.com',
  'grr.la',
  'pokemail.net',
  'spam4.me',

  // 10MinuteMail / temp-mail family
  '10minutemail.com',
  '10minutemail.net',
  '10minutemail.us',
  '10minutemail.co.uk',
  '20minutemail.com',
  '30minutemail.com',
  '60minutemail.com',
  'dispostable.com',
  'tempmail.com',
  'tempmail.org',
  'tempmail.net',
  'tempmail.de',
  'tempmail.us',
  'tempmail.email',
  'temp-mail.org',
  'temp-mail.io',
  'temp-mail.ru',
  'temp-mail.com',
  'tempmailaddress.com',
  'tempmail-plus.com',
  'tmpmail.org',
  'tmpmail.net',
  'tmpeml.com',
  'tmail.ws',
  'temporarymail.com',
  'temporary-email.com',
  'temporaryemail.net',
  'temporaryforwarding.com',
  'temporaryinbox.com',

  // YOPmail / minute-mail
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'cool.fr.nf',
  'jetable.fr.nf',
  'nospam.ze.tc',
  'nomail.xl.cx',
  'mega.zik.dj',
  'speed.1s.fr',
  'courriel.fr.nf',
  'moncourrier.fr.nf',
  'monemail.fr.nf',
  'monmail.fr.nf',

  // Throwaway / fake / trash
  'throwawaymail.com',
  'throwawaymail.pp.ua',
  'trashmail.com',
  'trashmail.net',
  'trashmail.de',
  'trashmail.io',
  'trashmail.ws',
  'trash-mail.com',
  'trash-mail.de',
  'trash-mail.at',
  'fakemail.net',
  'fakeinbox.com',
  'fake-mail.fr',
  'fakemailgenerator.com',
  'fakemailz.com',
  'getnada.com',
  'maildrop.cc',
  'mailcatch.com',
  'mailnesia.com',
  'mailfreeonline.com',
  'mailshell.com',
  'mailtemp.info',
  'mailtothis.com',
  'mailtrash.net',
  'mailtothis.com',
  'spambox.us',
  'spambox.me',
  'spamgourmet.com',
  'spamavert.com',
  'spamfree24.org',
  'spamfree24.com',
  'spam.la',
  'spamspot.com',
  'spamthis.co.uk',
  'binka.me',
  'discard.email',
  'discardmail.com',
  'discardmail.de',
  'wegwerfmail.de',
  'wegwerfmail.net',
  'wegwerfmail.org',
  'einrot.com',
  'einrot.de',

  // Burner / private-email-ish
  'burnermail.io',
  'burnerapp.io',
  'spamex.com',
  'anonbox.net',
  'anonymbox.com',
  'anonymousmail.org',
  'incognitomail.com',
  'incognitomail.net',
  'incognitomail.org',
  'mytemp.email',
  'my10minutemail.com',
  'my-tempmail.com',
  'shieldemail.com',

  // Misc throwaways still seen in the wild
  'mohmal.com',
  'mailpoof.com',
  'emailondeck.com',
  'emailfake.com',
  'email-fake.com',
  'fakermail.com',
  'fakeemailgenerator.com',
  'getairmail.com',
  'inboxbear.com',
  'inboxkitten.com',
  'inboxalias.com',
  'instant-mail.de',
  'instantemailaddress.com',
  'jourrapide.com',
  'mailcuk.com',
  'mailtemp.info',
  'mvrht.net',
  'mt2015.com',
  'mt2016.com',
  'mytrashmail.com',
  'nwldx.com',
  'objectmail.com',
  'quickemail.info',
  'rcpt.at',
  'rhyta.com',
  'rmqkr.net',
  'sendspamhere.com',
  'sneakemail.com',
  'spamavert.com',
  'spambog.com',
  'spambog.de',
  'spambog.ru',
  'spamfighter.cf',
  'spamfighter.ga',
  'spamfighter.gq',
  'spamfighter.ml',
  'spamfighter.tk',
  'spammotel.com',
  'superrito.com',
  'teleworm.com',
  'teleworm.us',
  'tempemail.co',
  'tempinbox.com',
  'tempinbox.co.uk',
  'tempmailo.com',
  'tempr.email',
  'thrma.com',
  'tmail.com',
  'tmail.io',
  'tmail.ws',
  'toomail.biz',
  'wuwuwa.com',
  'yopmail.gq',
  'yougotgoated.com',
  'zoaxe.com',
  'zoemail.org',

  // Recently popular throwaway services
  'mail.tm',
  'cuvox.de',
  'dayrep.com',
  'fleckens.hu',
  'gustr.com',
  'armyspy.com',
  'rhyta.com',
  'mailnull.com',
  'protonmail.beer',
  'guerrillamailx.com',
  'sneakmail.de',
  '7tags.com',
  'mintemail.com',
  'pjjkp.com',
  'xagloo.com',
  'consumerriot.com',
  'crazymailing.com',
  'h8s.org',
  'mailbox80.com',
  'omnievents.org',
  'one-time.email',
  'onlinerg.com',
  'smashmail.de',
  'spamthisplease.com',
  'w-asertun.ru',
  'whatpaas.com',
  'yapped.net',
  'zetmail.com',
  'mail-temp.com',
  'tmail2.com',
  'tmail3.com',
  'tempemails.io',
]);

// ── The private extra list ──
//
// KV `config:disposable_domains_extra`: a JSON array of lowercase domains,
// kept out of the public repo. Read at most once a minute per isolate. Missing,
// bad JSON or a failed read means no extra domains, and each of those three is
// logged once per isolate.

export const EXTRA_DOMAINS_KEY = 'config:disposable_domains_extra';
const EXTRA_CACHE_MS = 60_000;

interface KVGet {
  get(key: string): Promise<string | null>;
}

let extraCache: { at: number; domains: ReadonlySet<string> } | null = null;
const extraLogged = new Set<string>();

function logExtraOnce(kind: 'missing' | 'bad_json' | 'read_failed'): void {
  if (extraLogged.has(kind)) return;
  extraLogged.add(kind);
  console.log(JSON.stringify({ source: 'disposable-email', event: 'extra_domains_none', why: kind }));
}

/** The KV extra domains, cached for 60 s in this isolate. Never throws. */
export async function loadExtraDomains(kv: KVGet | null | undefined): Promise<ReadonlySet<string>> {
  if (!kv) return new Set();
  const now = Date.now();
  if (extraCache && now - extraCache.at < EXTRA_CACHE_MS) return extraCache.domains;
  let domains: ReadonlySet<string> = new Set();
  try {
    const raw = await kv.get(EXTRA_DOMAINS_KEY);
    if (raw === null) {
      logExtraOnce('missing');
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
      if (!Array.isArray(parsed)) {
        logExtraOnce('bad_json');
      } else {
        domains = new Set(
          parsed
            .filter((d): d is string => typeof d === 'string')
            .map((d) => d.trim().toLowerCase())
            .filter((d) => d.length > 0)
        );
      }
    }
  } catch {
    logExtraOnce('read_failed');
  }
  extraCache = { at: now, domains };
  return domains;
}

/** Test only: forget the cache and the logged kinds. */
export function resetExtraDomainsCache(): void {
  extraCache = null;
  extraLogged.clear();
}

/**
 * Returns true if `email` belongs to a known disposable provider: the static
 * set, or the extra domains when given. Lowercased domain match.
 */
export function isDisposableEmail(email: string, extra?: ReadonlySet<string>): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return DISPOSABLE_DOMAINS.has(domain) || (extra?.has(domain) ?? false);
}
