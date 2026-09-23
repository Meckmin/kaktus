'use client';

import { useAuthGate } from '@/components/auth/AuthGate';

/**
 * Sign-in wall for the coach flow.
 *
 * Sells the proposition before asking for the account, and says plainly why the
 * account is required first — "we are about to ask for your bank details" is a
 * better reason than an unexplained wall, and coaches are adults who will
 * accept a reason.
 */
export function CoachSignInPrompt() {
  const { require } = useAuthGate();
  const open = () => require({ action: 'Koç başvurusu yapmak', returnTo: '/koc-ol' });

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:px-8">
      <h1 className="max-w-measure font-display text-question font-semibold text-balance">
        Kendi öğrencini seç, kendi fiyatını koy.
      </h1>
      <p className="mt-5 max-w-[54ch] text-lg leading-relaxed text-muted">
        Kaktüs bir kurs değil. Paket dayatmıyoruz, öğrenci yönlendirmiyoruz. Sen profilini
        kurarsın, öğrenciler sana teklif gönderir, şartları birlikte belirlersiniz.
      </p>

      <dl className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-stone/70 bg-stone/60 sm:grid-cols-3">
        <Fact term="Komisyon" detail="%18" note="Yalnızca tamamlanan derslerden" />
        <Fact term="Ödeme" note="Ders yapıldıkça haftalık aktarım" detail="Güvenceli" />
        <Fact term="Fiyat" detail="Sen belirlersin" note="Alt sınır yok" />
      </dl>

      <div className="mt-10">
        <button
          type="button"
          onClick={open}
          className="rounded-full bg-cactus px-7 py-3.5 font-medium text-paper transition-colors hover:bg-cactus-deep"
        >
          Başvuruya başla
        </button>
        <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-muted">
          Başvuruda ÖSYM belgeni ve ödeme bilgilerini isteyeceğiz, bu yüzden önce hesap açman
          gerekiyor. Belgelerin yalnızca doğrulama ekibi tarafından görülür.
        </p>
      </div>
    </main>
  );
}

function Fact({ term, detail, note }: { term: string; detail: string; note: string }) {
  return (
    <div className="bg-paper px-5 py-4">
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="mt-1 font-display text-xl font-semibold">{detail}</dd>
      <dd className="mt-0.5 text-sm leading-snug text-muted">{note}</dd>
    </div>
  );
}
