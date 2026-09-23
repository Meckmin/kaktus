import Link from 'next/link';
import type { getApplicationStatus } from '@/server/actions/coach-application';

type Status = NonNullable<Awaited<ReturnType<typeof getApplicationStatus>>>;

/**
 * What a coach sees after applying.
 *
 * The job of this screen is to remove the urge to email support. It answers the
 * three questions people actually have — what happens next, how long, and what
 * do I do meanwhile — and it says them for each state rather than showing one
 * generic "pending" spinner.
 *
 * Rejection is handled with the same care as approval. A rejected coach is
 * usually a fixable document problem, not a bad person, and the copy says so
 * along with the specific reason the reviewer left.
 */
export function ApplicationStatusPanel({ status }: { status: Status }) {
  const view = VIEWS[status.verificationStatus] ?? VIEWS.PENDING;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 sm:px-8">
      <p className="text-sm text-muted">
        Başvurun {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' }).format(status.createdAt)}{' '}
        tarihinde alındı
      </p>

      <h1 className="mt-4 max-w-measure font-display text-question font-semibold text-balance">
        {view.title}
      </h1>
      <p className="mt-4 max-w-[54ch] text-lg leading-relaxed text-muted">{view.body}</p>

      {status.verificationNote && (
        <div className="mt-6 rounded-xl border border-dust/60 bg-dust/10 px-5 py-4">
          <p className="text-sm font-medium">İnceleme ekibinin notu</p>
          <p className="mt-1 leading-relaxed">{status.verificationNote}</p>
        </div>
      )}

      {view.steps.length > 0 && (
        <ol className="mt-8 space-y-px overflow-hidden rounded-2xl border border-stone/70 bg-stone/60">
          {view.steps.map((step, index) => (
            <li key={step.title} className="bg-paper px-5 py-4">
              <div className="flex items-baseline gap-3">
                <span
                  aria-hidden
                  className={[
                    'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                    step.done ? 'bg-cactus text-paper' : 'border border-stone text-muted',
                  ].join(' ')}
                >
                  {step.done ? '✓' : index + 1}
                </span>
                <div>
                  <p className="font-medium leading-snug">{step.title}</p>
                  <p className="mt-0.5 text-sm leading-snug text-muted">{step.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {status.documents.length > 0 && (
        <p className="mt-6 text-sm text-muted">
          {status.documents.length} belge yüklendi. Belgelerin yalnızca doğrulama ekibi
          tarafından görülür ve doğrulama tamamlandıktan sonra silinir.
        </p>
      )}

      <div className="mt-10 flex flex-wrap gap-3">
        {view.primary && (
          <Link
            href={view.primary.href}
            className="rounded-full bg-cactus px-6 py-3 font-medium text-paper transition-colors hover:bg-cactus-deep"
          >
            {view.primary.label}
          </Link>
        )}
        <Link
          href="/"
          className="rounded-full border border-stone px-6 py-3 font-medium transition-colors hover:border-cactus hover:text-cactus"
        >
          Ana sayfaya dön
        </Link>
      </div>
    </main>
  );
}

interface StatusView {
  title: string;
  body: string;
  steps: Array<{ title: string; detail: string; done: boolean }>;
  primary?: { label: string; href: string };
}

const REVIEW_STEPS = (stage: number) => [
  {
    title: 'Başvuru alındı',
    detail: 'Profilin ve belgelerin kaydedildi.',
    done: stage >= 1,
  },
  {
    title: 'Belge doğrulama',
    detail: 'ÖSYM sonuç belgen ve öğrenci belgen kontrol ediliyor. Genelde 2 iş günü sürer.',
    done: stage >= 2,
  },
  {
    title: 'Profil yayında',
    detail: 'Öğrenciler seni eşleşme listesinde görmeye ve teklif göndermeye başlar.',
    done: stage >= 3,
  },
];

const VIEWS: Record<string, StatusView> = {
  PENDING: {
    title: 'Başvurun sırada',
    body: 'Belgelerini inceleyeceğiz. Sonucu e-posta ile bildireceğiz; ortalama iki iş günü sürüyor. Bu sırada yapman gereken bir şey yok.',
    steps: REVIEW_STEPS(1),
  },
  IN_REVIEW: {
    title: 'Belgelerin inceleniyor',
    body: 'Doğrulama ekibi başvurunu açtı. Ek bir belge gerekirse e-posta ile isteyeceğiz.',
    steps: REVIEW_STEPS(2),
  },
  APPROVED: {
    title: 'Profilin yayında',
    body: 'Artık eşleşme listesinde görünüyorsun. Takvimini güncel tutman gelen teklif sayısını en çok artıran şey.',
    steps: REVIEW_STEPS(3),
    primary: { label: 'Panelime git', href: '/panel' },
  },
  REJECTED: {
    title: 'Başvuruna şimdilik devam edemiyoruz',
    body: 'Çoğu durumda sorun belgenin okunaklı olmaması ya da eksik bir sayfa. Aşağıdaki notu okuyup tekrar başvurabilirsin.',
    steps: [],
    primary: { label: 'Yeniden başvur', href: '/koc-ol?duzenle=1' },
  },
  SUSPENDED: {
    title: 'Profilin askıya alındı',
    body: 'Hesabın şu anda öğrencilere görünmüyor. Nedenini ve nasıl devam edebileceğini aşağıda bulabilirsin.',
    steps: [],
  },
};
