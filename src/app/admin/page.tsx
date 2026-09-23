import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { CoachReviewCard } from '@/components/admin/CoachReviewCard';

/**
 * Verification queue.
 *
 * The whole product's credibility rests on this screen. A coach's claimed
 * ranking is the strongest signal in the matching system, so a single approved
 * fake poisons the thing that makes Kaktüs worth using.
 *
 * It is deliberately plain and deliberately manual. For the first dozen coaches
 * a human should read every document; what to automate will be obvious after
 * doing that twenty times, and guessing now would automate the wrong thing.
 */
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/giris?callbackUrl=/admin');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { roles: true },
  });
  // 404 rather than 403: the admin area should not confirm it exists.
  if (!user?.roles.includes('ADMIN')) redirect('/panel');

  const [pending, openDisputes, flagged] = await Promise.all([
    prisma.coachProfile.findMany({
      where: { verificationStatus: { in: ['PENDING', 'IN_REVIEW'] } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        slug: true,
        headline: true,
        university: true,
        department: true,
        yksRank: true,
        yksYear: true,
        yksTrack: true,
        ownBaselineTytNet: true,
        ownFinalTytNet: true,
        ownBaselineAytNet: true,
        ownFinalAytNet: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        documents: { select: { id: true, type: true, mimeType: true, sizeBytes: true } },
        pricingTiers: { select: { name: true, priceMinor: true } },
      },
    }),
    prisma.dispute.count({
      where: { status: { in: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'] } },
    }),
    prisma.conversation.count({ where: { flaggedAt: { not: null } } }),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
      <div className="flex items-baseline justify-between gap-4">
        <Link href="/panel" className="text-sm text-muted hover:text-cactus">
          Panele dön
        </Link>
        <Link href="/admin/itirazlar" className="text-sm text-cactus hover:text-cactus-deep">
          İtirazlar {openDisputes > 0 && `(${openDisputes})`}
        </Link>
      </div>

      <h1 className="mt-6 font-display text-question font-semibold">Doğrulama kuyruğu</h1>
      <p className="mt-3 max-w-[54ch] leading-relaxed text-muted">
        Sıralama beyanı eşleştirmedeki en ağırlıklı sinyal. Belgeyle beyan birebir uyuşmuyorsa
        onaylama — gerekçeyi yaz, koç düzeltip tekrar başvurabilir.
      </p>

      {flagged > 0 && (
        <p className="mt-6 rounded-lg border border-dust/60 bg-dust/10 px-4 py-3 text-sm">
          {flagged} sohbet platform dışına çıkma girişimi nedeniyle işaretlendi.
        </p>
      )}

      {pending.length === 0 ? (
        <p className="mt-10 rounded-xl border border-stone/70 bg-paper px-5 py-5 text-muted">
          Bekleyen başvuru yok.
        </p>
      ) : (
        <div className="mt-8 space-y-4">
          {pending.map((coach) => (
            <CoachReviewCard key={coach.id} coach={JSON.parse(JSON.stringify(coach))} />
          ))}
        </div>
      )}
    </main>
  );
}
