'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import { TermsNotice } from '@/components/legal/TermsNotice';

/**
 * The auth gate.
 *
 * Opens when a guest tries to *act* — view a full profile, message a coach, or
 * send an offer. Browsing and matching stay open.
 *
 * The important part is what happens around it. The student's answers are
 * already on the server, keyed by an httpOnly cookie; the `signIn` event claims
 * that session into a StudentProfile. So the modal makes a promise the backend
 * actually keeps — and `callbackUrl` returns them to the exact coach they
 * clicked, not to a generic dashboard.
 */

interface GateIntent {
  /** What they were trying to do, shown in the modal so it reads as a step. */
  action: string;
  /** Where to return after sign-in. */
  returnTo: string;
  /** Replaces the default line, which assumes a student who just did onboarding. */
  note?: string;
}

interface AuthGateValue {
  require: (intent: GateIntent) => void;
}

const AuthGateContext = createContext<AuthGateValue | null>(null);

export function useAuthGate(): AuthGateValue {
  const value = useContext(AuthGateContext);
  if (!value) throw new Error('useAuthGate must be used inside <AuthGateProvider>');
  return value;
}

export function AuthGateProvider({
  children,
  authenticated,
}: {
  children: React.ReactNode;
  authenticated: boolean;
}) {
  const [intent, setIntent] = useState<GateIntent | null>(null);

  const require = useCallback(
    (next: GateIntent) => {
      if (authenticated) {
        window.location.href = next.returnTo;
        return;
      }
      setIntent(next);
    },
    [authenticated],
  );

  return (
    <AuthGateContext.Provider value={{ require }}>
      {children}
      {intent && <AuthGateModal intent={intent} onClose={() => setIntent(null)} />}
    </AuthGateContext.Provider>
  );
}

function AuthGateModal({ intent, onClose }: { intent: GateIntent; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Through a ref, so the effect below runs once per open rather than on every
  // parent render — re-running it would yank focus back to the close button
  // mid-typing (the same bug OfferComposer had).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Focus management and Escape. A modal that traps neither is unusable by
  // keyboard and invisible to a screen reader.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, a[href]',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, []);

  const sendLink = async () => {
    if (!email.includes('@')) return;
    setSending(true);
    try {
      await signIn('resend', { email, callbackUrl: intent.returnTo, redirect: false });
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-ink/40 p-0 backdrop-blur-[2px] sm:place-items-center sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-gate-title"
        className="w-full max-w-md rounded-t-2xl bg-paper p-7 shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="auth-gate-title" className="font-display text-2xl font-semibold leading-tight">
            {sent ? 'E-postana bak' : `${intent.action} için hesap gerekiyor`}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="-m-2 rounded-full p-2 text-muted transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        {sent ? (
          <p className="mt-3 leading-relaxed text-muted">
            <span className="font-medium text-ink">{email}</span> adresine giriş bağlantısı
            gönderdik. Bağlantıya tıkladığında kaldığın yerden devam edeceksin.
          </p>
        ) : (
          <>
            <p className="mt-3 leading-relaxed text-muted">
              {intent.note ??
                'Cevapladığın beş soru kayıtlı. Giriş yaptığında profilin otomatik oluşur ve tam buraya geri dönersin.'}
            </p>

            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={() => signIn('google', { callbackUrl: intent.returnTo })}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-stone bg-white px-5 py-3.5 font-medium transition-colors hover:border-cactus"
              >
                <GoogleMark />
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
          </>
        )}
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
