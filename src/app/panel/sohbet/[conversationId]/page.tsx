import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getConversation } from '@/server/queries/conversation';
import { ConversationView } from '@/components/chat/ConversationView';
import { getMeetings } from '@/server/queries/meetings';
import { MeetingsPanel } from '@/components/meetings/MeetingsPanel';

export const dynamic = 'force-dynamic';

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/giris?callbackUrl=/panel/sohbet/${conversationId}`);

  // Returns null for a stranger as well as for a missing row, and both render
  // as 404. Distinguishing them would confirm that a given conversation exists.
  const [conversation, meetings] = await Promise.all([
    getConversation(conversationId),
    getMeetings(conversationId),
  ]);
  if (!conversation) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 sm:px-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <Link href="/panel" className="text-sm text-muted transition-colors hover:text-cactus">
            Panele dön
          </Link>
          <h1 className="mt-3 font-display text-2xl font-semibold">
            {conversation.counterpartyName}
          </h1>
        </div>
        {conversation.viewerRole === 'STUDENT' && (
          <Link
            href={`/koc/${conversation.coachSlug}`}
            className="text-sm text-cactus hover:text-cactus-deep"
          >
            Profili gör
          </Link>
        )}
      </header>

      {conversation.flagged && (
        <p className="mt-4 rounded-lg border border-dust/60 bg-dust/10 px-4 py-3 text-sm leading-relaxed">
          Bu sohbet, platform dışına çıkma girişimi nedeniyle incelemeye alındı. Anlaşmanı Kaktüs
          üzerinden tamamlarsan ödemen güvence altında kalır.
        </p>
      )}

      <div className="mt-6">
        {meetings && <MeetingsPanel meetings={meetings} conversationId={conversationId} />}
        <ConversationView conversation={conversation} />
      </div>
    </main>
  );
}
