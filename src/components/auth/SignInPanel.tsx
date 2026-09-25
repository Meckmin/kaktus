'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { TermsNotice } from '@/components/legal/TermsNotice';

/**
 * The sign-in controls, extracted so both the modal and the standalone page
 * use one implementation. Two copies of an auth form is two places to get the
 * callback URL wrong.
 */
export function SignInPanel({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <p className="mt-8 rounded-xl border border-stone/70 bg-paper px-5 py-4 leading-relaxed">
        <span className="font-medium">{email}</span> adresine giriş bağlantısı gönderdik.
        Bağlantıya tıkladığında kaldığın yerden devam edeceksin.
      </p>
    );
  }

  const sendLink = async () => {
    if (!email.includes('@')) return;
    setSending(true);
    try {
      await signIn('resend', { email, callbackUrl, redirect: false });
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-8 space-y-3">
      <button
        type="button"
        onClick={() => signIn('google', { callbackUrl })}
        className="w-full rounded-xl border border-stone bg-white px-5 py-3.5 font-medium transition-colors hover:border-cactus"
      >
        Google ile devam et
      </button>

      <div className="flex items-center gap-3 py-1 text-sm text-muted">
        <span className="h-px flex-1 bg-stone/70" />
        ya da
        <span className="h-px flex-1 bg-stone/70" />
      </div>

      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && sendLink()}
        placeholder="ornek@eposta.com"
        className="w-full rounded-xl border border-stone bg-white px-4 py-3.5 outline-none placeholder:text-stone focus:border-cactus"
      />
      <button
        type="button"
        onClick={sendLink}
        disabled={sending || !email.includes('@')}
        className="w-full rounded-xl bg-cactus px-5 py-3.5 font-medium text-paper transition-colors hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
      >
        {sending ? 'Gönderiliyor' : 'Giriş bağlantısı gönder'}
      </button>
      <TermsNotice />
    </div>
  );
}
