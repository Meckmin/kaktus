'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { MeetingBookingView, MeetingInviteView, MeetingsView } from '@/server/queries/meetings';
import {
  MEETING_DURATIONS,
  dateToIstanbulLocal,
  joinState,
} from '@/lib/meetings/rules';
import {
  answerMeetingInvite,
  sendMeetingInvite,
  setExternalMeetingLink,
  withdrawMeetingInvite,
} from '@/server/actions/meetings';

/**
 * Meetings for one coach–student pair: upcoming sessions with a "Görüşmeye
 * gir" button that opens at the right time, plus the invite flow — the coach
 * proposes a new time for a session or an extra meeting, the student accepts
 * or declines.
 */

const when = (date: Date) =>
  new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

export function MeetingsPanel({ meetings, conversationId }: { meetings: MeetingsView; conversationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState<{ bookingId: string | null } | null>(null);
  // Re-render every 30 s so "Görüşmeye gir" enables itself when the time comes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const isCoach = meetings.viewerRole === 'COACH';

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.message ?? 'İşlem tamamlanamadı.');
        return;
      }
      after?.();
      router.refresh();
    });
  };

  const hasAnything = meetings.bookings.length > 0 || meetings.extraInvites.length > 0;
  if (!hasAnything && !meetings.activeEngagementId) return null;

  return (
    <section className="mb-6 rounded-2xl border border-stone/70 bg-paper p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Görüşmeler</h2>
        <Link href={`/panel/program/${conversationId}`} className="text-sm text-cactus hover:text-cactus-deep">
          Haftalık program
        </Link>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-bloom-pale px-4 py-2.5 text-sm">
          {error}
        </p>
      )}

      {meetings.bookings.length === 0 && meetings.extraInvites.length === 0 && (
        <p className="mt-3 text-sm text-muted">Planlanmış görüşme yok.</p>
      )}

      <ul className="mt-3 space-y-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60">
        {meetings.bookings.map((booking) => (
          <BookingRow
            key={booking.id}
            booking={booking}
            isCoach={isCoach}
            now={now}
            pending={pending}
            onReschedule={() => setInviting({ bookingId: booking.id })}
            onAnswer={(inviteId, accept) => run(() => answerMeetingInvite(inviteId, accept))}
            onWithdraw={(inviteId) => run(() => withdrawMeetingInvite(inviteId))}
            onSetLink={(url) => run(() => setExternalMeetingLink(booking.id, url))}
          />
        ))}
        {meetings.extraInvites.map((invite) => (
          <li key={invite.id} className="bg-paper px-4 py-3">
            <InviteLine
              invite={invite}
              label="Ek görüşme daveti"
              isCoach={isCoach}
              pending={pending}
              onAnswer={(accept) => run(() => answerMeetingInvite(invite.id, accept))}
              onWithdraw={() => run(() => withdrawMeetingInvite(invite.id))}
            />
          </li>
        ))}
      </ul>

      {isCoach && meetings.activeEngagementId && !inviting && (
        <button
          type="button"
          onClick={() => setInviting({ bookingId: null })}
          className="mt-4 rounded-full border border-stone px-4 py-2 text-sm font-medium hover:border-cactus hover:text-cactus"
        >
          Ek görüşme daveti gönder
        </button>
      )}

      {isCoach && meetings.activeEngagementId && inviting && (
        <InviteForm
          title={inviting.bookingId ? 'Yeni saat öner' : 'Ek görüşme daveti'}
          initial={meetings.bookings.find((b) => b.id === inviting.bookingId)}
          pending={pending}
          onCancel={() => setInviting(null)}
          onSubmit={(startsAtLocal, durationMinutes, message) =>
            run(
              () =>
                sendMeetingInvite({
                  engagementId: meetings.activeEngagementId!,
                  bookingId: inviting.bookingId,
                  startsAtLocal,
                  durationMinutes,
                  message,
                }),
              () => setInviting(null),
            )
          }
        />
      )}
    </section>
  );
}

function BookingRow({
  booking,
  isCoach,
  now,
  pending,
  onReschedule,
  onAnswer,
  onWithdraw,
  onSetLink,
}: {
  booking: MeetingBookingView;
  isCoach: boolean;
  now: number;
  pending: boolean;
  onReschedule: () => void;
  onAnswer: (inviteId: string, accept: boolean) => void;
  onWithdraw: (inviteId: string) => void;
  onSetLink: (url: string) => void;
}) {
  const state = joinState(booking.startsAt, booking.endsAt, new Date(now));
  const [editingLink, setEditingLink] = useState(false);
  const [link, setLink] = useState(booking.meetingUrl ?? '');

  return (
    <li className="bg-paper px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium tabular-nums">{when(booking.startsAt)}</p>
          <p className="text-sm text-muted">
            {minutesBetween(booking.startsAt, booking.endsAt)} dk · {booking.billed ? 'Program dersi' : 'Ek görüşme'}
          </p>
        </div>

        {state === 'ENDED' ? (
          <span className="text-sm text-muted">Görüşme bitti</span>
        ) : state === 'OPEN' ? (
          <Link
            href={`/panel/gorusme/${booking.id}`}
            className="rounded-full bg-cactus px-4 py-2 text-sm font-medium text-paper hover:bg-cactus-deep"
          >
            Görüşmeye gir
          </Link>
        ) : (
          <span
            className="rounded-full border border-stone px-4 py-2 text-sm text-muted"
            title="Görüşme saatinden 10 dakika önce açılır"
          >
            Görüşmeye gir
          </span>
        )}
      </div>

      {booking.pendingInvite && (
        <div className="mt-3 rounded-lg bg-limestone px-3 py-2.5">
          <InviteLine
            invite={booking.pendingInvite}
            label="Yeni saat önerisi"
            isCoach={isCoach}
            pending={pending}
            onAnswer={(accept) => onAnswer(booking.pendingInvite!.id, accept)}
            onWithdraw={() => onWithdraw(booking.pendingInvite!.id)}
          />
        </div>
      )}

      {isCoach && state === 'TOO_EARLY' && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <button type="button" onClick={onReschedule} className="text-cactus hover:text-cactus-deep">
            Saati değiştir
          </button>
          <button
            type="button"
            onClick={() => setEditingLink((open) => !open)}
            className="text-muted hover:text-cactus"
          >
            {booking.meetingUrl ? 'Harici bağlantıyı düzenle' : 'Harici bağlantı ekle'}
          </button>
        </div>
      )}

      {!isCoach && booking.meetingUrl && state !== 'ENDED' && (
        <p className="mt-2 text-sm text-muted">
          Uygulama içi görüşme açılmazsa koçunun eklediği{' '}
          <a href={booking.meetingUrl} target="_blank" rel="noopener noreferrer" className="text-cactus underline">
            harici bağlantıyı
          </a>{' '}
          kullanabilirsin.
        </p>
      )}

      {isCoach && editingLink && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://zoom.us/j/… ya da https://meet.google.com/…"
            className="min-w-0 flex-1 rounded-xl border border-stone bg-limestone px-3 py-2 text-sm outline-none focus:border-cactus"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              onSetLink(link);
              setEditingLink(false);
            }}
            className="rounded-full bg-cactus px-4 py-2 text-sm font-medium text-paper hover:bg-cactus-deep disabled:bg-stone"
          >
            Kaydet
          </button>
        </div>
      )}
    </li>
  );
}

function InviteLine({
  invite,
  label,
  isCoach,
  pending,
  onAnswer,
  onWithdraw,
}: {
  invite: MeetingInviteView;
  label: string;
  isCoach: boolean;
  pending: boolean;
  onAnswer: (accept: boolean) => void;
  onWithdraw: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm">
          <span className="text-muted">{label}: </span>
          <span className="font-medium tabular-nums">{when(invite.startsAt)}</span>
          <span className="text-muted"> · {minutesBetween(invite.startsAt, invite.endsAt)} dk</span>
        </p>
        {invite.message && <p className="mt-0.5 text-sm text-muted">“{invite.message}”</p>}
        {isCoach && <p className="mt-0.5 text-xs text-muted">Öğrencinin yanıtı bekleniyor</p>}
      </div>
      <div className="flex gap-2">
        {isCoach ? (
          <button type="button" disabled={pending} onClick={onWithdraw} className="text-sm text-muted hover:text-bloom">
            Geri çek
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => onAnswer(true)}
              className="rounded-full bg-cactus px-4 py-1.5 text-sm font-medium text-paper hover:bg-cactus-deep disabled:bg-stone"
            >
              Kabul et
            </button>
            <button type="button" disabled={pending} onClick={() => onAnswer(false)} className="text-sm text-muted hover:text-bloom">
              Uygun değilim
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function InviteForm({
  title,
  initial,
  pending,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial?: MeetingBookingView;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (startsAtLocal: string, durationMinutes: number, message: string) => void;
}) {
  const [startsAtLocal, setStartsAtLocal] = useState(initial ? dateToIstanbulLocal(initial.startsAt) : '');
  const [duration, setDuration] = useState<number>(
    initial ? minutesBetween(initial.startsAt, initial.endsAt) : 60,
  );
  const [message, setMessage] = useState('');

  return (
    <div className="mt-4 border-t border-stone/60 pt-4">
      <h3 className="font-medium">{title}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block text-sm">
          <span className="font-medium">Tarih ve saat</span>
          <input
            type="datetime-local"
            value={startsAtLocal}
            onChange={(event) => setStartsAtLocal(event.target.value)}
            className="mt-1 w-full rounded-xl border border-stone bg-limestone px-3 py-2 outline-none focus:border-cactus"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Süre</span>
          <select
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            className="mt-1 w-full rounded-xl border border-stone bg-limestone px-3 py-2 outline-none focus:border-cactus"
          >
            {MEETING_DURATIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} dk
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value.slice(0, 500))}
        rows={2}
        placeholder="Kısa bir not (isteğe bağlı): bu hafta denemeni konuşalım…"
        className="mt-3 w-full resize-none rounded-xl border border-stone bg-limestone px-3 py-2 text-sm outline-none focus:border-cactus"
      />
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          disabled={pending || !startsAtLocal}
          onClick={() => onSubmit(startsAtLocal, duration, message)}
          className="rounded-full bg-cactus px-4 py-2 text-sm font-medium text-paper hover:bg-cactus-deep disabled:bg-stone"
        >
          Daveti gönder
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-muted hover:text-cactus">
          Vazgeç
        </button>
      </div>
    </div>
  );
}
