import Link from 'next/link';

/**
 * 404, in Turkish. Also what someone sees when they open a conversation or
 * program that isn't theirs — so it points back to the panel, not only home.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm text-muted">404</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Bu sayfa bulunamadı.</h1>
      <p className="mt-3 text-muted">
        Bağlantı eskimiş ya da bu sayfaya erişimin yok. Paneline dönüp oradan devam edebilirsin.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/panel"
          className="rounded-full bg-cactus px-6 py-3 font-medium text-paper transition-colors hover:bg-cactus-deep"
        >
          Panelime dön
        </Link>
        <Link
          href="/"
          className="rounded-full border border-stone px-6 py-3 font-medium transition-colors hover:border-cactus hover:text-cactus"
        >
          Ana sayfa
        </Link>
      </div>
    </main>
  );
}
