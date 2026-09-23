import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getApplicationStatus } from '@/server/actions/coach-application';
import { ApplicationStatusPanel } from '@/components/coach-apply/ApplicationStatusPanel';

/**
 * Where the coach application form lands after a successful submit.
 *
 * Renders the same status panel as /koc-ol so a coach who bookmarks either URL
 * sees a consistent picture, rather than a one-off "thanks" page that goes
 * stale the moment their application is approved.
 */
export const dynamic = 'force-dynamic';

export default async function ApplicationSubmittedPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/giris?callbackUrl=/koc-ol');

  const status = await getApplicationStatus();
  if (!status || status.verificationStatus === 'DRAFT') redirect('/koc-ol');

  return <ApplicationStatusPanel status={status} />;
}
