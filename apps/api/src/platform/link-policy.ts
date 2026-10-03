import { domainToUnicode } from 'node:url';
import { inArray } from 'drizzle-orm';
import { blockedDomains } from '../db/schema.js';
import type { Executor } from './database.js';

/**
 * Rules for links people put on their profiles (website, links). The platform owns the
 * `blocked_domains` table: moderators fill it, sign-up checks email domains against it and
 * profile links are checked here.
 */

const LATIN_LABEL = /^[\p{Script=Latin}0-9-]+$/u;
const CYRILLIC_LABEL = /^[\p{Script=Cyrillic}0-9-]+$/u;
const HAS_CYRILLIC = /\p{Script=Cyrillic}/u;

/** `a.b.example.com` → `a.b.example.com`, `b.example.com`, `example.com`, `com`. */
function suffixes(host: string): string[] {
  const labels = host.split('.');
  return labels.map((_, index) => labels.slice(index).join('.'));
}

function canonicalHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, '');
}

/**
 * True when the host or any parent domain is blocked. Both the punycode and the Unicode
 * spelling are checked, whichever form a moderator entered.
 */
export async function isBlockedDomain(db: Executor, host: string): Promise<boolean> {
  const ascii = canonicalHost(host);
  if (!ascii) return false;
  const candidates = [...new Set([...suffixes(ascii), ...suffixes(domainToUnicode(ascii))])];
  const rows = await db
    .select({ domain: blockedDomains.domain })
    .from(blockedDomains)
    .where(inArray(blockedDomains.domain, candidates.filter(Boolean)));
  return rows.length > 0;
}

/**
 * The host to show next to a link. Unicode only when it cannot impersonate another name:
 * every label is a single script (Latin, or Cyrillic, plus digits and hyphens), and Cyrillic
 * labels sit under a Cyrillic top-level domain (`пример.рф`), which rules out whole-script
 * look-alikes such as `аррӏе.com`. Anything else is shown as punycode (`xn--...`).
 */
export function displayHost(url: string): string {
  const ascii = canonicalHost(new URL(url).hostname);
  const unicode = domainToUnicode(ascii);
  if (!unicode) return ascii;
  const labels = unicode.split('.');
  const tld = labels.at(-1) ?? '';
  const singleScript = labels.every(
    (label) => LATIN_LABEL.test(label) || CYRILLIC_LABEL.test(label),
  );
  const cyrillicAllowed = !HAS_CYRILLIC.test(unicode) || CYRILLIC_LABEL.test(tld);
  return singleScript && cyrillicAllowed ? unicode : ascii;
}
