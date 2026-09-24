import Link from 'next/link';

/**
 * Landing.
 *
 * The hero is the promise that differentiates the product, stated plainly:
 * you pick the coach, you name the price. Not a stat block, not a gradient.
 * The two doors (student / coach) are the only decision on the page, because
 * the two audiences need completely different next screens.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-6 py-10 sm:px-8">
      {/* Returning students and coaches need a way back to their panel; /giris
          sends an already signed-in visitor straight through to it. */}
      <nav className="flex justify-end">
        <Link
          href="/giris?callbackUrl=/panel"
          className="text-sm text-muted transition-colors hover:text-cactus"
        >
          Giriş yap
        </Link>
      </nav>

      <div className="flex flex-1 flex-col justify-center py-16">
        <h1 className="max-w-measure font-display text-question font-semibold text-balance">
          Aradığın koçu bul.
        </h1>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/onboarding/alan"
            className="inline-flex items-center justify-center rounded-full bg-cactus px-7 py-3.5 text-base font-medium text-paper transition-colors hover:bg-cactus-deep"
          >
            Öğrenciyim, koç arıyorum
          </Link>
          <Link
            href="/koc-ol"
            className="inline-flex items-center justify-center rounded-full border border-stone px-7 py-3.5 text-base font-medium text-ink transition-colors hover:border-cactus hover:text-cactus"
          >
            Koç olmak istiyorum
          </Link>
        </div>
      </div>

      <footer className="border-t border-stone/60 pt-6 text-sm text-muted">
        Ödemeler koç ders tamamlandığını onaylayana kadar güvencede tutulur.
      </footer>
    </main>
  );
}
