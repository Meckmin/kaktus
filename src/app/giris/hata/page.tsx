import Link from 'next/link';

/**
 * Auth.js error landing.
 *
 * Its error codes are opaque to a normal person, so they are translated rather
 * than displayed. `Verification` in particular means an expired or reused magic
 * link, which is common and entirely recoverable — the copy says so instead of
 * implying the account is broken.
 */
const MESSAGES: Record<string, { title: string; body: string }> = {
  Verification: {
    title: 'Bu bağlantının süresi dolmuş',
    body: 'Giriş bağlantıları 24 saat geçerlidir ve yalnızca bir kez kullanılabilir. Yeni bir bağlantı isteyebilirsin.',
  },
  OAuthAccountNotLinked: {
    title: 'Bu e-posta başka bir yöntemle kayıtlı',
    body: 'Daha önce bu e-posta ile e-posta bağlantısı kullanarak giriş yapmışsın. Aynı yöntemle devam et.',
  },
  AccessDenied: {
    title: 'Girişe izin verilmedi',
    body: 'Hesabın askıya alınmış olabilir. Destek ekibiyle iletişime geçebilirsin.',
  },
  Default: {
    title: 'Giriş yapılamadı',
    body: 'Beklenmeyen bir sorun oldu. Tekrar denersen genelde düzeliyor.',
  },
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = MESSAGES[error ?? 'Default'] ?? MESSAGES.Default;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <h1 className="font-display text-3xl font-semibold leading-tight text-balance">
        {message.title}
      </h1>
      <p className="mt-4 leading-relaxed text-muted">{message.body}</p>
      <Link
        href="/giris"
        className="mt-8 self-start rounded-full bg-cactus px-6 py-3 font-medium text-paper hover:bg-cactus-deep"
      >
        Tekrar dene
      </Link>
    </main>
  );
}
