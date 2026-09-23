import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { SignInPanel } from '@/components/auth/SignInPanel';

/**
 * Standalone sign-in.
 *
 * Auth.js is configured to send people here — on a session error, on a fresh
 * magic-link click, whenever it needs a sign-in surface. Without this route
 * every one of those paths 404s, which is invisible in development because the
 * modal handles the happy path.
 */
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  const { callbackUrl } = await searchParams;
  if (session?.user?.id) redirect(callbackUrl ?? '/');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="font-display text-lg font-semibold tracking-tight">
        Kaktüs Koçluk
      </Link>
      <h1 className="mt-8 font-display text-3xl font-semibold leading-tight text-balance">
        Giriş yap
      </h1>
      <p className="mt-3 leading-relaxed text-muted">
        Hesabın yoksa ilk girişinde otomatik oluşturulur. Cevapladığın sorular hesabına taşınır.
      </p>
      <SignInPanel callbackUrl={callbackUrl ?? '/'} />
    </main>
  );
}
