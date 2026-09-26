'use client';

import { useEffect, useState } from 'react';
import { isValidEmail, normalizeEmail, suggestEmail } from '@/lib/email-address';
import { requestSignInLink } from '@/server/actions/sign-in';

/**
 * The email half of sign-in, shared by the /giris page and the auth gate
 * dialog.
 *
 * A likely typo ("gmial.com") stops the first press and asks — a link sent to
 * the wrong address is a student waiting for nothing, and a typo'd domain can
 * belong to someone else entirely.
 */

const RESEND_COOLDOWN_S = 60;

export function EmailLinkForm({
  callbackUrl,
  onSentChange,
}: {
  callbackUrl: string;
  onSentChange?: (sent: boolean) => void;
}) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverSuggestion, setServerSuggestion] = useState<string | null>(null);
  const [confirmedAsIs, setConfirmedAsIs] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  // Suggest only once they've finished typing — "gmail.co" is a typo only if they stop there.
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const normalized = normalizeEmail(email);
  const typo = serverSuggestion ?? (confirmedAsIs === normalized ? null : suggestEmail(normalized));
  const valid = isValidEmail(normalized);

  const send = async (address: string) => {
    setError(null);
    setServerSuggestion(null);
    setSending(true);
    try {
      const result = await requestSignInLink(address, callbackUrl);
      if (result.ok) {
        setSentTo(address);
        setCooldown(RESEND_COOLDOWN_S);
        onSentChange?.(true);
      } else {
        setError(result.message);
        setServerSuggestion(result.suggestion ?? null);
      }
    } catch {
      setError('Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene.');
    } finally {
      setSending(false);
    }
  };

  const submit = () => {
    if (sending) return;
    setTouched(true);
    if (!valid) {
      setError('Geçerli bir e-posta adresi yaz (ör. elif@gmail.com).');
      return;
    }
    if (typo) return; // the suggestion box below asks first (touched is now true)
    void send(normalized);
  };

  const useSuggestion = (address: string) => {
    setEmail(address);
    setServerSuggestion(null);
    setError(null);
  };

  if (sentTo) {
    return (
      <div className="rounded-xl border border-stone/70 bg-paper px-5 py-4 leading-relaxed">
        <p>
          <span className="font-medium">{sentTo}</span> adresine giriş bağlantısı gönderdik. Bağlantıya
          tıkladığında kaldığın yerden devam edeceksin.
        </p>
        <p className="mt-2 text-sm text-muted">
          Birkaç dakika içinde gelmezse Spam / Gereksiz klasörüne, Gmail’de “Promosyonlar” sekmesine de bak.
          Bağlantı 24 saat geçerli ve tek kullanımlık.
        </p>
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-bloom-pale px-3 py-2 text-sm">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <button
            type="button"
            disabled={cooldown > 0 || sending}
            onClick={() => void send(sentTo)}
            className="text-cactus hover:text-cactus-deep disabled:text-muted"
          >
            {sending ? 'Gönderiliyor' : cooldown > 0 ? `Tekrar gönder (${cooldown} sn)` : 'Tekrar gönder'}
          </button>
          <button
            type="button"
            onClick={() => {
              setSentTo(null);
              setError(null);
              onSentChange?.(false);
            }}
            className="text-muted hover:text-ink"
          >
            Farklı adres kullan
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        aria-label="E-posta adresin"
        aria-invalid={Boolean(error)}
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          setError(null);
          setServerSuggestion(null);
          setTouched(false);
        }}
        onBlur={() => setTouched(true)}
        onKeyDown={(event) => event.key === 'Enter' && submit()}
        placeholder="ornek@eposta.com"
        className="w-full rounded-xl border border-stone bg-white px-4 py-3.5 outline-none placeholder:text-stone focus:border-cactus"
      />

      {typo && valid && (touched || serverSuggestion) && (
        <div className="rounded-lg border border-dust/60 bg-dust/10 px-3.5 py-2.5 text-sm">
          <p>
            <span className="font-medium">{typo}</span> mı demek istedin?
          </p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            <button type="button" onClick={() => useSuggestion(typo)} className="font-medium text-cactus hover:text-cactus-deep">
              Evet, düzelt
            </button>
            {!serverSuggestion && (
              <button
                type="button"
                onClick={() => {
                  setConfirmedAsIs(normalized);
                  void send(normalized);
                }}
                className="text-muted hover:text-ink"
              >
                Hayır, {normalized} doğru
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-bloom-pale px-3.5 py-2.5 text-sm">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={sending || !normalized.includes('@')}
        className="w-full rounded-xl bg-cactus px-5 py-3.5 font-medium text-paper transition-colors hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
      >
        {sending ? 'Gönderiliyor' : 'Giriş bağlantısı gönder'}
      </button>
    </div>
  );
}
