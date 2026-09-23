import Link from 'next/link';
import { notFound } from 'next/navigation';

/**
 * Payment outcome pages.
 *
 * One dynamic route rather than four near-identical files. The payment callback
 * redirects here after reconciling with Iyzico, so these are the last thing a
 * student sees after handing over their card — and until now they were a 404,
 * which is the worst possible ending to a successful payment.
 *
 * `beklemede` and `inceleniyor` deliberately do not say "failed". A pending 3DS
 * or a fraud review is not a failure, and telling a student it failed is how you
 * get a duplicate payment from someone who panics and pays again.
 */

const STATES = {
  basarili: {
    title: 'Ödemen alındı',
    body: 'Paran Kaktüs’te güvencede. Koçuna bildirildi; dersler yapıldıkça haftalık dilimler hâlinde aktarılacak.',
    detail:
      'Koç derse gelmezse ya da program başlamazsa panelinden iade talep edebilirsin.',
    tone: 'good',
    cta: { href: '/panel', label: 'Panelime git' },
  },
  beklemede: {
    title: 'Ödemen doğrulanıyor',
    body: 'Bankan işlemi onaylıyor. Bu genelde birkaç saniye sürer, bazen birkaç dakika.',
    detail:
      'Bu sayfayı kapatabilirsin — sonuç netleştiğinde e-posta göndereceğiz. Lütfen tekrar ödeme yapma.',
    tone: 'wait',
    cta: { href: '/panel', label: 'Panelime git' },
  },
  inceleniyor: {
    title: 'Ödemen kontrol ediliyor',
    body: 'İşlem tamamlandı ancak kayıtlarımızda doğrulanması gereken bir ayrıntı var. Ekibimiz bakıyor.',
    detail:
      'Paran güvende. 24 saat içinde sana döneceğiz; bu sırada yeniden ödeme yapmana gerek yok.',
    tone: 'wait',
    cta: { href: '/panel', label: 'Panelime git' },
  },
  hata: {
    title: 'Ödeme tamamlanamadı',
    body: 'Banka işlemi onaylamadı. Kartından herhangi bir tutar çekilmedi.',
    detail:
      'En sık nedenler: yetersiz bakiye, internetten alışverişe kapalı kart ya da yanlış 3D şifresi. Başka bir kartla tekrar deneyebilirsin.',
    tone: 'bad',
    cta: { href: '/panel', label: 'Tekliflerime dön' },
  },
} as const;

export function generateStaticParams() {
  return Object.keys(STATES).map((durum) => ({ durum }));
}

export default async function PaymentOutcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ durum: string }>;
  searchParams: Promise<{ teklif?: string; neden?: string }>;
}) {
  const [{ durum }, query] = await Promise.all([params, searchParams]);
  const state = STATES[durum as keyof typeof STATES];
  if (!state) notFound();

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-12">
      <span
        aria-hidden
        className={[
          'h-1 w-12 rounded-full',
          state.tone === 'good' ? 'bg-cactus' : state.tone === 'bad' ? 'bg-bloom' : 'bg-dust',
        ].join(' ')}
      />
      <h1 className="mt-6 font-display text-question font-semibold leading-tight text-balance">
        {state.title}
      </h1>
      <p className="mt-4 text-lg leading-relaxed">{state.body}</p>
      <p className="mt-3 leading-relaxed text-muted">{state.detail}</p>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href={query.teklif ? `/panel/teklifler/${query.teklif}` : state.cta.href}
          className="rounded-full bg-cactus px-6 py-3 font-medium text-paper hover:bg-cactus-deep"
        >
          {state.cta.label}
        </Link>
        <Link
          href="/"
          className="rounded-full border border-stone px-6 py-3 font-medium hover:border-cactus hover:text-cactus"
        >
          Ana sayfa
        </Link>
      </div>
    </main>
  );
}
