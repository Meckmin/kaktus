import { describe, expect, it } from 'vitest';
import { isDisposableEmail, isValidEmail, normalizeEmail, suggestEmail } from '@/lib/email-address';
import { checkSignInEmail, domainAcceptsMail, type Resolver } from '@/server/services/email-check';

describe('email address checks', () => {
  it('normalizes and validates', () => {
    expect(normalizeEmail('  Elif.Yilmaz@GMAIL.com ')).toBe('elif.yilmaz@gmail.com');
    for (const ok of ['elif@gmail.com', 'e.y+kaktus@ogr.hacettepe.edu.tr', 'a@b.co']) {
      expect(isValidEmail(ok)).toBe(true);
    }
    for (const bad of ['elif', 'elif@', '@gmail.com', 'elif@gmail', 'elif@@gmail.com', 'el if@gmail.com', 'elif@gmail..com']) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });

  it('suggests the inbox a typo meant, and leaves real domains alone', () => {
    expect(suggestEmail('elif@gmial.com')).toBe('elif@gmail.com');
    expect(suggestEmail('elif@gmail.con')).toBe('elif@gmail.com');
    expect(suggestEmail('elif@gmail.com.tr')).toBe('elif@gmail.com');
    expect(suggestEmail('elif@hotmial.com')).toBe('elif@hotmail.com');
    expect(suggestEmail('elif@hotmail.cmo')).toBe('elif@hotmail.com');
    expect(suggestEmail('elif@outlok.com')).toBe('elif@outlook.com');
    expect(suggestEmail('elif@yaho.com')).toBe('elif@yahoo.com');

    expect(suggestEmail('elif@gmail.com')).toBeNull();
    expect(suggestEmail('elif@hotmail.com.tr')).toBeNull();
    expect(suggestEmail('elif@ogr.hacettepe.edu.tr')).toBeNull();
    expect(suggestEmail('elif@firma.com')).toBeNull();
  });

  it('recognizes throwaway inboxes', () => {
    expect(isDisposableEmail('x@mailinator.com')).toBe(true);
    expect(isDisposableEmail('x@yopmail.com')).toBe(true);
    expect(isDisposableEmail('x@gmail.com')).toBe(false);
  });
});

describe('sign-in email gate', () => {
  const notFound = () => Promise.reject(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }));
  const resolver = (mx: Resolver['resolveMx'], a: Resolver['resolve4'] = notFound): Resolver => ({
    resolveMx: mx,
    resolve4: a,
  });
  // The cache is module-wide; a fresh domain per case keeps them independent.
  let n = 0;
  const fresh = (base = 'example-mail.net') => `d${++n}-${Date.now()}.${base}`;

  it('accepts a domain with a mail server, or with only an A record', async () => {
    expect(await domainAcceptsMail(fresh(), resolver(async () => [{ exchange: 'mx.test', priority: 10 }]))).toBe(true);
    expect(await domainAcceptsMail(fresh(), resolver(notFound, async () => ['1.2.3.4']))).toBe(true);
  });

  it('rejects a domain that does not exist, or says it takes no mail', async () => {
    expect(await domainAcceptsMail(fresh(), resolver(notFound))).toBe(false);
    expect(await domainAcceptsMail(fresh(), resolver(async () => [{ exchange: '.', priority: 0 }]))).toBe(false);
  });

  it('lets the address through when DNS itself is failing', async () => {
    const broken = () => Promise.reject(Object.assign(new Error('servfail'), { code: 'ESERVFAIL' }));
    expect(await domainAcceptsMail(fresh(), resolver(broken))).toBe(true);
  });

  it('turns a typo on a dead domain into a suggestion', async () => {
    const result = await checkSignInEmail('Elif@gmial.com', resolver(notFound));
    expect(result).toEqual({
      ok: false,
      message: 'Bu adrese e-posta gidemiyor. Yazımı kontrol et.',
      suggestion: 'elif@gmial.com'.replace('gmial', 'gmail'),
    });
  });

  it('refuses throwaway inboxes and malformed input before any lookup', async () => {
    const never = () => Promise.reject(new Error('should not be called'));
    expect((await checkSignInEmail('x@mailinator.com', resolver(never))).ok).toBe(false);
    expect((await checkSignInEmail('not-an-email', resolver(never))).ok).toBe(false);
  });

  it('passes seed accounts without a lookup outside production', async () => {
    const never = () => Promise.reject(new Error('should not be called'));
    expect(await checkSignInEmail('koc.e2e@test.kaktus.dev', resolver(never))).toEqual({
      ok: true,
      email: 'koc.e2e@test.kaktus.dev',
    });
  });
});
