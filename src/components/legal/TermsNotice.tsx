/**
 * The line under every sign-in button. Account creation records acceptance of
 * the terms (see auth.ts → events.createUser), so the terms must be linked
 * right where that happens.
 */
export function TermsNotice() {
  return (
    <p className="text-xs leading-relaxed text-muted">
      Devam ederek{' '}
      <a href="/yasal/kullanim-kosullari" target="_blank" className="underline hover:text-cactus">
        Kullanım Koşulları
      </a>
      ’nı kabul etmiş ve{' '}
      <a href="/yasal/aydinlatma-metni" target="_blank" className="underline hover:text-cactus">
        KVKK Aydınlatma Metni
      </a>
      ’ni okumuş olursun. 18 yaşından küçüksen velinin bilgisi dahilinde devam et.
    </p>
  );
}
