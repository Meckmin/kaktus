import Link from 'next/link';

export default function VerifyRequestPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <h1 className="font-display text-3xl font-semibold leading-tight text-balance">
        E-postana bak
      </h1>
      <p className="mt-4 leading-relaxed text-muted">
        Giriş bağlantısını gönderdik. Bağlantı 24 saat geçerli ve yalnızca bir kez kullanılabilir.
      </p>
      <p className="mt-4 leading-relaxed text-muted">
        Gelen kutunda yoksa spam klasörüne bak. Bağlantıyı farklı bir tarayıcıda açsan da giriş
        yapabilirsin.
      </p>
      <Link href="/" className="mt-8 text-cactus hover:text-cactus-deep">
        Ana sayfaya dön
      </Link>
    </main>
  );
}
