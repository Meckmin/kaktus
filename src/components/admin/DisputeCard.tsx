'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resolveDisputeAction } from '@/server/actions/admin';
import { formatTry } from '@/lib/onboarding/client-state';

interface Dispute {
  id: string;
  reason: string;
  detail: string;
  status: string;
  createdAt: string;
  openedByRole: string;
  engagement: {
    id: string;
    totalMinor: number;
    startDate: string;
    coach: { user: { name: string | null } };
    student: { user: { name: string | null } };
    milestones: Array<{ index: number; status: string; amountMinor: number }>;
    bookings: Array<{ id: string; status: string; startsAt: string; videoRoomName: string | null }>;
  };
}

type Presence = { joinedAt: string; minutes: number } | null;
/** Per in-app video session: who joined, or 'unavailable' when Daily couldn't be asked. */
export type SessionAttendance = { coach: Presence; student: Presence } | 'unavailable';

const when = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const clock = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

function describePresence(who: string, p: Presence) {
  return p ? `${who} ${p.minutes} dk (${clock.format(new Date(p.joinedAt))}’de girdi)` : `${who} katılmadı`;
}

const REASON_TR: Record<string, string> = {
  COACH_NO_SHOW: 'Koç seansa gelmedi',
  STUDENT_NO_SHOW: 'Öğrenci seansa gelmedi',
  QUALITY: 'Hizmet kalitesi',
  SCOPE_NOT_DELIVERED: 'Anlaşılan kapsam verilmedi',
  UNRESPONSIVE: 'Karşı taraf yanıt vermiyor',
  OTHER: 'Diğer',
};

export function DisputeCard({
  dispute,
  attendance = {},
}: {
  dispute: Dispute;
  attendance?: Record<string, SessionAttendance>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<'RELEASE' | 'REFUND' | 'SPLIT' | null>(null);
  const [note, setNote] = useState('');
  const [share, setShare] = useState('');
  const [error, setError] = useState<string | null>(null);

  const frozen = dispute.engagement.milestones
    .filter((m) => m.status === 'DISPUTED')
    .reduce((sum, m) => sum + m.amountMinor, 0);
  const released = dispute.engagement.milestones
    .filter((m) => m.status === 'RELEASED')
    .reduce((sum, m) => sum + m.amountMinor, 0);

  const noShows = dispute.engagement.bookings.filter((b) => b.status === 'NO_SHOW_COACH').length;
  // Releasing a milestone marks its bookings COMPLETED even when their date
  // hasn't come yet, so "held" must also mean "in the past". Sessions approved
  // ahead of time are counted separately — that's evidence in its own right.
  const now = Date.now();
  const completedBookings = dispute.engagement.bookings.filter((b) => b.status === 'COMPLETED');
  const completed = completedBookings.filter((b) => new Date(b.startsAt).getTime() <= now).length;
  const approvedEarly = completedBookings.length - completed;
  const ageDays = Math.floor(
    (Date.now() - new Date(dispute.createdAt).getTime()) / 86_400_000,
  );

  const submit = () => {
    if (!outcome) return;
    setError(null);
    startTransition(async () => {
      const result = await resolveDisputeAction({
        disputeId: dispute.id,
        outcome,
        note,
        coachShareMinor: outcome === 'SPLIT' ? Number.parseInt(share || '0', 10) * 100 : undefined,
      });
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };

  return (
    <article className="rounded-2xl border border-stone/70 bg-paper p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">
          {REASON_TR[dispute.reason] ?? dispute.reason}
        </h2>
        <p className="text-sm text-muted">
          {ageDays === 0 ? 'bugün açıldı' : `${ageDays} gündür açık`}
        </p>
      </div>

      <p className="mt-1 text-sm text-muted">
        {dispute.engagement.student.user.name ?? 'Öğrenci'} ↔{' '}
        {dispute.engagement.coach.user.name ?? 'Koç'} ·{' '}
        {dispute.openedByRole === 'STUDENT' ? 'öğrenci açtı' : 'koç açtı'}
      </p>

      <p className="mt-4 rounded-lg border border-stone/60 bg-limestone px-4 py-3 leading-relaxed">
        {dispute.detail}
      </p>

      {/* The evidence a decision actually turns on, surfaced instead of buried:
          how much is still frozen, what was already paid out, and whether any
          session was reported as a no-show. */}
      <dl className="mt-4 grid gap-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60 sm:grid-cols-4">
        <Fact label="Donmuş tutar" value={formatTry(frozen)} strong />
        <Fact label="Aktarılmış" value={formatTry(released)} />
        <Fact
          label="Yapılan seans"
          value={String(completed)}
          note={approvedEarly > 0 ? `${approvedEarly} seans tarihi gelmeden onaylanmış` : undefined}
        />
        <Fact label="Gelinmeyen" value={String(noShows)} />
      </dl>

      {Object.keys(attendance).length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium">Uygulama içi görüşme kayıtları</h3>
          <ul className="mt-2 divide-y divide-stone/60 rounded-xl border border-stone/70 text-sm">
            {dispute.engagement.bookings
              .filter((b) => attendance[b.id])
              .map((b) => {
                const record = attendance[b.id];
                return (
                  <li key={b.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                    <span className="tabular-nums">{when.format(new Date(b.startsAt))}</span>
                    <span className="text-muted">
                      {record === 'unavailable'
                        ? 'Kayıt alınamadı'
                        : `${describePresence('Koç', record.coach)} · ${describePresence('Öğrenci', record.student)}`}
                    </span>
                  </li>
                );
              })}
          </ul>
          <p className="mt-1.5 text-xs text-muted">
            Daily’nin oturum kayıtlarından. Harici bağlantıyla (Zoom, Meet) yapılan görüşmeler burada görünmez.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-bloom-pale px-4 py-2.5 text-sm">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {(
          [
            ['RELEASE', 'Koça aktar'],
            ['SPLIT', 'Paylaştır'],
            ['REFUND', 'Öğrenciye iade et'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setOutcome(outcome === value ? null : value)}
            className={[
              'rounded-full border px-5 py-2.5 text-sm font-medium transition-colors',
              outcome === value
                ? 'border-cactus bg-cactus text-paper'
                : 'border-stone hover:border-cactus hover:text-cactus',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {outcome && (
        <div className="mt-5 border-t border-stone/60 pt-5">
          {outcome === 'SPLIT' && (
            <label className="mb-3 block">
              <span className="text-sm font-medium">
                Koça kalacak tutar (en fazla {formatTry(frozen)})
              </span>
              <span className="mt-1.5 flex items-baseline gap-2 rounded-xl border border-stone bg-limestone px-4 py-2.5 focus-within:border-cactus">
                <input
                  type="text"
                  inputMode="numeric"
                  value={share}
                  onChange={(event) => setShare(event.target.value.replace(/\D/g, ''))}
                  className="w-full bg-transparent font-display text-xl font-semibold tabular-nums outline-none"
                />
                <span className="text-sm text-muted">₺</span>
              </span>
            </label>
          )}

          <label className="block text-sm font-medium">Kararın ve gerekçesi</label>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="İki tarafın da okuyabileceği şekilde yaz."
            className="mt-2 w-full resize-none rounded-xl border border-stone bg-limestone px-4 py-3 text-sm outline-none focus:border-cactus"
          />
          <button
            type="button"
            disabled={pending || note.trim().length < 5}
            onClick={submit}
            className="mt-3 rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
          >
            {pending ? 'Uygulanıyor' : 'Kararı uygula'}
          </button>
        </div>
      )}
    </article>
  );
}

function Fact({
  label,
  value,
  strong,
  note,
}: {
  label: string;
  value: string;
  strong?: boolean;
  note?: string;
}) {
  return (
    <div className="bg-paper px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 tabular-nums ${strong ? 'font-display text-lg font-semibold' : 'font-medium'}`}>
        {value}
      </dd>
      {note && <dd className="mt-0.5 text-xs text-bloom">{note}</dd>}
    </div>
  );
}
