import Link from 'next/link';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { getApplicationStatus } from '@/server/actions/coach-application';
import { AuthGateProvider } from '@/components/auth/AuthGate';
import { CoachApplicationForm } from '@/components/coach-apply/CoachApplicationForm';
import { CoachSignInPrompt } from '@/components/coach-apply/CoachSignInPrompt';
import { ApplicationStatusPanel } from '@/components/coach-apply/ApplicationStatusPanel';

/**
 * Coach application.
 *
 * Three states behind one URL, chosen on the server:
 *
 *   not signed in  → sign-in prompt
 *   no application → the form
 *   applied        → status panel
 *
 * ── Why sign-in comes first here, unlike the student funnel ──
 *
 * Students answer five harmless questions before we ask who they are, because
 * the answers are cheap to re-enter and the payoff (seeing matches) is
 * immediate. Coaches are the opposite: the form ends with a TCKN, an IBAN, and
 * two identity documents. Parking that in a guest cookie the way we park a
 * draft offer would mean holding financial identifiers for someone who has no
 * account and may never return — a KVKK liability with no upside.
 *
 * So the account comes first. It costs one extra step for a user who is already
 * committed enough to be filling in their bank details.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Koç ol — Kaktüs Koçluk',
  description:
    'YKS sıralamanı doğrula, kendi fiyatını belirle, öğrencilerini kendin seç. Komisyon yalnızca tamamlanan derslerden alınır.',
};

export default async function CoachApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ duzenle?: string }>;
}) {
  const [session, query] = await Promise.all([auth(), searchParams]);

  if (!session?.user?.id) {
    return (
      <AuthGateProvider authenticated={false}>
        <CoachSignInPrompt />
      </AuthGateProvider>
    );
  }

  const status = await getApplicationStatus();

  // Anything past DRAFT means the application is submitted and the coach should
  // see where it stands, not an empty form that would overwrite it.
  //
  // The one exception is a rejected coach who asked to edit: rejection is
  // usually an unreadable document, and sending them to a separate re-apply
  // URL would mean maintaining two copies of a long form.
  const reapplying = query.duzenle === '1' && status?.verificationStatus === 'REJECTED';
  if (status && status.verificationStatus !== 'DRAFT' && !reapplying) {
    return <ApplicationStatusPanel status={status} />;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
      <header>
        <Link href="/" className="text-sm text-muted transition-colors hover:text-cactus">
          Kaktüs Koçluk
        </Link>
        <h1 className="mt-6 max-w-measure font-display text-question font-semibold text-balance">
          Koç başvurusu
        </h1>
        <p className="mt-3 max-w-[54ch] leading-relaxed text-muted">
          Sıralamanı doğrulayıp profilini kurduktan sonra öğrenciler sana teklif göndermeye
          başlar. Fiyatını ve kaç öğrenci alacağını sen belirlersin.
        </p>
      </header>

      <CoachApplicationForm displayName={session.user.name ?? ''} />
    </main>
  );
}
