/**
 * Email address checks that need no network: shape, common typos, and
 * throwaway inboxes. Shared by the sign-in form (instant feedback) and the
 * server (the actual gate). Ownership is proven by the magic link itself; the
 * point here is to catch the address that will never receive it, before the
 * student sits waiting for an email that went to "gmial.com".
 */

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Deliberately loose on the local part (RFC 5322 allows far more than anyone
// types) and strict on the domain: at least one dot and a real-looking TLD.
const EMAIL_RE = /^[^\s@"(),:;<>[\]\\]+@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email) && !email.includes('..');
}

/** The inboxes Turkish students actually use, most common first. */
const POPULAR_DOMAINS = [
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'yahoo.com',
  'yandex.com',
  'windowslive.com',
  'live.com',
  'msn.com',
  'hotmail.com.tr',
  'outlook.com.tr',
  'yandex.com.tr',
  'protonmail.com',
  'proton.me',
];

/** Mistakes that aren't a typo distance away, or that edit distance gets wrong. */
const KNOWN_TYPOS: Record<string, string> = {
  'gmail.com.tr': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmil.com': 'gmail.com',
  'googlemail.com.tr': 'googlemail.com',
  'hotmail.co': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'icloud.co': 'icloud.com',
  'iclod.com': 'icloud.com',
  'yahoo.co': 'yahoo.com',
};

/** Edit distance where swapping two neighbours ("gmial") is one edit, not two. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * "elif@gmial.com" → "elif@gmail.com". Null when the domain looks intended —
 * including any domain we don't know, which is most school and work addresses.
 */
export function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (POPULAR_DOMAINS.includes(domain)) return null;

  const known = KNOWN_TYPOS[domain];
  if (known) return `${local}@${known}`;

  // Common TLD slips on an otherwise-right name: gmail.con, hotmail.cmo.
  const tldFixed = domain.replace(/\.(con|cmo|ocm|comm|om|vom|xom)$/, '.com');
  if (tldFixed !== domain && POPULAR_DOMAINS.includes(tldFixed)) return `${local}@${tldFixed}`;

  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of POPULAR_DOMAINS) {
    const distance = editDistance(domain, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  // One slip for short names, two for long ones — beyond that it's probably a
  // different, real domain (a school's, a company's).
  const allowed = domain.length >= 10 ? 2 : 1;
  return best && bestDistance > 0 && bestDistance <= allowed ? `${local}@${best}` : null;
}

/**
 * Throwaway inbox services. Not exhaustive — it doesn't need to be: it turns
 * away the casual "10 minute mail" sign-up, which is all a list can do.
 */
const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'grr.la',
  'harakirimail.com',
  'mail.tm',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailinator.net',
  'mailnesia.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'spamgourmet.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempail.com',
  'tempmail.com',
  'tempmail.net',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@').pop() ?? '';
  return DISPOSABLE_DOMAINS.has(domain) || [...DISPOSABLE_DOMAINS].some((d) => domain.endsWith(`.${d}`));
}
