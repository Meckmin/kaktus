/**
 * Anti-disintermediation filter.
 *
 * Naive regex loses immediately. Real evasion in Turkish chat looks like:
 *   "sıfır beş üç iki ..."     → number words
 *   "0 5 3 2 . 1 1 1 ..."      → separator injection
 *   "insta: kaktus_._koc"      → punctuation inside handles
 *   "wp'den yazar mısın"       → abbreviation, no keyword
 *   "ıg" / "İG" / homoglyphs   → Turkish casing traps and Cyrillic lookalikes
 *
 * So: normalise aggressively first, THEN detect, and score rather than
 * pattern-match to a boolean. Masking is visible to both parties on purpose —
 * people route around filters they don't understand and comply with ones they
 * do.
 *
 * The original text is never destroyed; the caller stores it encrypted for
 * dispute evidence. Only the redacted body is broadcast.
 */

export type ViolationKind =
  | 'PHONE_NUMBER'
  | 'EMAIL'
  | 'IBAN'
  | 'SOCIAL_HANDLE'
  | 'EXTERNAL_LINK'
  | 'PAYMENT_KEYWORD'
  | 'CIRCUMVENTION_INTENT';

export type ModerationAction = 'ALLOW' | 'MASK' | 'BLOCK';

export interface Finding {
  kind: ViolationKind;
  detector: string;
  severity: number;
  /** Already-redacted excerpt, safe to store and show an admin. */
  excerpt: string;
}

export interface ModerationResult {
  action: ModerationAction;
  riskScore: number;
  redacted: string;
  findings: Finding[];
  /** Turkish notice rendered under the message bubble. Empty when ALLOW. */
  notice: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────────────────────────

const HOMOGLYPHS: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ѕ: 's',
  ᴀ: 'a', ɡ: 'g', ｇ: 'g', '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
};

const LEET: Record<string, string> = {
  '4': 'a', '3': 'e', '1': 'i', '0': 'o', '5': 's', '7': 't', '@': 'a', '$': 's',
};

const TR_NUMBER_WORDS: Record<string, string> = {
  sifir: '0', sıfır: '0', bir: '1', iki: '2', uc: '3', üç: '3', dort: '4', dört: '4',
  bes: '5', beş: '5', alti: '6', altı: '6', yedi: '7', sekiz: '8', dokuz: '9',
};

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060]/g;

/** Lowercases correctly for Turkish (İ→i, I→ı) before any ASCII matching. */
function trLower(text: string): string {
  return text.replace(/İ/g, 'i').replace(/I/g, 'ı').toLocaleLowerCase('tr');
}

function foldHomoglyphs(text: string): string {
  return [...text].map((ch) => HOMOGLYPHS[ch] ?? ch).join('');
}

/**
 * Word-boundary assertions for Turkish.
 *
 * JavaScript's `\b` only knows [A-Za-z0-9_], so `\büç\b` never matches and
 * `\bınsta\b` never matches — silently disabling the detectors that exist to
 * catch Turkish evasion. Lookarounds over the real alphabet instead.
 */
const TR_WORD = 'a-zçğıöşü0-9';
const LB = `(?<![${TR_WORD}])`;
const RB = `(?![${TR_WORD}])`;

/** Replaces spelled-out Turkish digits with numerals. */
function digitizeWords(text: string): string {
  return text.replace(
    new RegExp(`${LB}[a-zçğıöşü]+${RB}`, 'g'),
    (word) => TR_NUMBER_WORDS[word] ?? word,
  );
}

/**
 * Collapses separators that appear *between digits*, so "0 5 3-2.1 1 1" becomes
 * "0532111". Deliberately does not touch separators between letters, which
 * would mangle ordinary prose.
 */
function collapseDigitSeparators(text: string): string {
  let previous = '';
  let current = text;
  // Repeat: one pass only removes every other separator in "0 5 3 2".
  while (current !== previous) {
    previous = current;
    current = current.replace(/(\d)[\s._\-()/*+,'"|]+(\d)/g, '$1$2');
  }
  return current;
}

function deLeet(text: string): string {
  return [...text].map((ch) => LEET[ch] ?? ch).join('');
}

export interface NormalizedText {
  /** Turkish-lowercased, homoglyph-folded, zero-width stripped. */
  base: string;
  /** base + digit words + collapsed digit separators. For IBAN detection. */
  numeric: string;
  /**
   * `numeric` with IBANs blanked out. Phone detectors run against this,
   * because a TR IBAN contains a '5' followed by nine digits and would
   * otherwise be reported as a phone number — right verdict, wrong label,
   * and the wrong redaction placeholder shown to the user.
   */
  numericSansIban: string;
  /** base with punctuation stripped and leet folded. For keyword detection. */
  alpha: string;
}

const IBAN_PATTERN = /\btr\d{24}\b/g;

export function normalize(input: string): NormalizedText {
  const cleaned = input.normalize('NFKC').replace(ZERO_WIDTH, '');
  const base = foldHomoglyphs(trLower(cleaned));
  const numeric = collapseDigitSeparators(digitizeWords(base));
  const numericSansIban = numeric.replace(IBAN_PATTERN, (m) => ' '.repeat(m.length));
  const alpha = deLeet(base).replace(/[^a-zçğıöşü0-9\s]/g, '');
  return { base, numeric, numericSansIban, alpha };
}

// ─────────────────────────────────────────────────────────────────────────────
// Detectors
// ─────────────────────────────────────────────────────────────────────────────

const DETECTORS: Array<{
  name: string;
  kind: ViolationKind;
  severity: number;
  /** Which normalized form to run against. */
  field: keyof NormalizedText;
  pattern: RegExp;
}> = [
  {
    name: 'tr_mobile',
    kind: 'PHONE_NUMBER',
    severity: 45,
    field: 'numericSansIban',
    // +905xxxxxxxxx / 05xxxxxxxxx / 5xxxxxxxxx
    pattern: /(?:\+?90)?0?5\d{9}/g,
  },
  {
    name: 'long_digit_run',
    kind: 'PHONE_NUMBER',
    severity: 25,
    field: 'numericSansIban',
    // 10+ digits that aren't a plausible net score or year.
    pattern: /\b\d{10,}\b/g,
  },
  {
    name: 'iban_tr',
    kind: 'IBAN',
    severity: 60,
    field: 'numeric',
    pattern: /\btr\d{24}\b/g,
  },
  {
    name: 'email',
    kind: 'EMAIL',
    severity: 40,
    field: 'base',
    pattern: /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9.-]+\.[a-z]{2,}/g,
  },
  {
    name: 'messaging_shortlink',
    kind: 'SOCIAL_HANDLE',
    severity: 55,
    field: 'base',
    pattern: /\b(?:wa\.me|t\.me|api\.whatsapp\.com|ig\.me|m\.me|discord\.gg)\S*/g,
  },
  {
    name: 'platform_name',
    kind: 'SOCIAL_HANDLE',
    severity: 30,
    field: 'alpha',
    pattern: new RegExp(
      `${LB}(whatsapp|whatsap|watsap|wp|wpp|telegram|instagram|insta|ınstagram|ınsta|ig|ıg|dm|discord|snapchat|snap|skype)`,
      'g',
    ),
  },
  {
    name: 'handle_token',
    kind: 'SOCIAL_HANDLE',
    severity: 35,
    field: 'base',
    pattern: /(?:^|\s)@[a-z0-9._]{3,30}\b/g,
  },
  {
    name: 'external_link',
    kind: 'EXTERNAL_LINK',
    severity: 30,
    field: 'base',
    pattern: /\b(?:https?:\/\/|www\.)[^\s]+/g,
  },
  {
    // Two-letter abbreviations need a closing boundary or they match inside
    // ordinary words. Longer platform names deliberately do not, because
    // Turkish agglutination produces "instagramdan", "telegrama", "wp'den".
    name: 'platform_abbreviation',
    kind: 'SOCIAL_HANDLE',
    severity: 30,
    field: 'alpha',
    pattern: new RegExp(`${LB}(ig|ıg|dm)${RB}`, 'g'),
  },
  {
    name: 'payment_vocabulary',
    kind: 'PAYMENT_KEYWORD',
    severity: 40,
    field: 'alpha',
    pattern: new RegExp(
      `${LB}(iban|havale|eft|papara|ininal|hesap\\s?numaram|hesabıma|kart\\s?numaram|elden|nakit|kapıda)`,
      'g',
    ),
  },
  {
    name: 'circumvention_intent',
    kind: 'CIRCUMVENTION_INTENT',
    severity: 50,
    field: 'alpha',
    pattern: new RegExp(
      `${LB}(komisyonsuz|komisyon\\s?vermeden|site\\s?dışında|siteden\\s?çıkalım|platform\\s?dışı|dışarıdan\\s?anlaşalım|buradan\\s?çıkalım|direkt\\s?bana|aramızda\\s?halledelim)`,
      'g',
    ),
  },
];

/**
 * A whitelist that prevents the most common false positive: students quoting
 * ranks, nets, and years. "480 bin sıralama" must never be read as a phone
 * number, and a filter that eats exam talk in an exam-prep product is worse
 * than no filter.
 */
const BENIGN_NUMERIC = new RegExp(
  `${LB}(?:19|20)\\d{2}${RB}|\\d{1,3}(?:[.,]\\d{1,2})?\\s*net|\\d{1,6}\\s*(?:bin|k)?\\s*(?:sıralama|sıra)`,
);

// ─────────────────────────────────────────────────────────────────────────────
// Scoring & masking
// ─────────────────────────────────────────────────────────────────────────────

export const THRESHOLDS = {
  mask: 25,
  block: 70,
  /** Conversation-level cumulative score that flags for admin review. */
  flagConversation: 150,
} as const;

function maskExcerpt(raw: string): string {
  if (raw.length <= 4) return '*'.repeat(raw.length);
  return `${raw.slice(0, 2)}${'*'.repeat(Math.min(raw.length - 4, 8))}${raw.slice(-2)}`;
}

/**
 * Redacts in the ORIGINAL string by locating the offending substrings there.
 * Normalisation changes offsets, so we re-run the detector against the raw text
 * with a tolerant pattern rather than trying to map indices back — simpler and
 * far less likely to corrupt the message.
 */
function redactOriginal(original: string, findings: Finding[]): string {
  let out = original;

  if (findings.some((f) => f.kind === 'PHONE_NUMBER')) {
    // Any run of >=10 digits allowing separators between them.
    out = out.replace(/(?:\+?90[\s.-]*)?0?[\s.-]*5(?:[\s.\-()]*\d){9}/g, '[numara gizlendi]');
    out = out.replace(/\b(?:\d[\s.\-]?){10,}\b/g, '[numara gizlendi]');
  }
  if (findings.some((f) => f.kind === 'IBAN')) {
    out = out.replace(/\bTR[\s]?(?:\d[\s]?){24}\b/gi, '[IBAN gizlendi]');
  }
  if (findings.some((f) => f.kind === 'EMAIL')) {
    out = out.replace(
      /[a-zA-Z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      '[e-posta gizlendi]',
    );
  }
  if (findings.some((f) => f.kind === 'SOCIAL_HANDLE' || f.kind === 'EXTERNAL_LINK')) {
    out = out.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[bağlantı gizlendi]');
    out = out.replace(/(^|\s)@[a-zA-Z0-9._]{3,30}\b/g, '$1[kullanıcı adı gizlendi]');
  }

  return out;
}

const NOTICES: Record<ModerationAction, string> = {
  ALLOW: '',
  MASK:
    'İletişim bilgileri gizlendi. Ödemeler Kaktüs üzerinden yapıldığında paran ders ' +
    'tamamlanana kadar güvencede tutulur; platform dışına çıkarsan bu koruma geçerli olmaz.',
  BLOCK:
    'Bu mesaj gönderilemedi. Telefon, IBAN veya dış platform bilgisi paylaşmak kurallara ' +
    'aykırı. Anlaşmanı Kaktüs üzerinden yaparsan ödemen güvence altında olur ve ' +
    'sorun çıkarsa iade talep edebilirsin.',
};

/**
 * Main entry point. Pure and synchronous — call it on every outbound message.
 *
 * @param text        raw message body as typed
 * @param priorRisk   cumulative conversation risk, used to escalate repeat
 *                    offenders faster than first-timers
 */
export function moderateMessage(text: string, priorRisk = 0): ModerationResult {
  const normalized = normalize(text);
  const findings: Finding[] = [];

  for (const detector of DETECTORS) {
    const haystack = normalized[detector.field];
    const matches = haystack.match(detector.pattern);
    if (!matches) continue;

    for (const match of matches) {
      // Suppress exam-vocabulary false positives on numeric detectors.
      if (
        (detector.kind === 'PHONE_NUMBER' || detector.kind === 'IBAN') &&
        BENIGN_NUMERIC.test(normalized.base) &&
        detector.name === 'long_digit_run'
      ) {
        continue;
      }
      findings.push({
        kind: detector.kind,
        detector: detector.name,
        severity: detector.severity,
        excerpt: maskExcerpt(match.trim()),
      });
    }
  }

  // Deduplicate: one hit per detector, so a repeated word doesn't inflate risk.
  const deduped = [...new Map(findings.map((f) => [f.detector, f])).values()];

  // Combined signals are worse than the sum of their parts: a handle plus a
  // "let's talk outside" is a real attempt, while either alone is often noise.
  let riskScore = deduped.reduce((sum, f) => sum + f.severity, 0);
  const kinds = new Set(deduped.map((f) => f.kind));
  if (kinds.has('CIRCUMVENTION_INTENT') && kinds.size > 1) riskScore = Math.round(riskScore * 1.5);
  if (kinds.has('PAYMENT_KEYWORD') && kinds.has('IBAN')) riskScore += 30;

  // Repeat offenders escalate faster.
  const escalation = priorRisk >= THRESHOLDS.flagConversation ? 20 : 0;
  const effective = riskScore + escalation;

  const action: ModerationAction =
    effective >= THRESHOLDS.block ? 'BLOCK' : effective >= THRESHOLDS.mask ? 'MASK' : 'ALLOW';

  return {
    action,
    riskScore,
    redacted: action === 'ALLOW' ? text : redactOriginal(text, deduped),
    findings: deduped,
    notice: NOTICES[action],
  };
}
