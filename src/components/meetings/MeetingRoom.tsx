'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { joinState } from '@/lib/meetings/rules';
import { joinMeeting } from '@/server/actions/meetings';
import { WeeklyPlanner } from '@/components/planner/WeeklyPlanner';
import type { StudyTaskView } from '@/lib/planner/task-schema';

/**
 * The call screen: video on the left, the week's plan on the right, so the
 * plan is built *during* the conversation instead of in another tab.
 *
 * Nothing connects until "Görüşmeye gir" is pressed — the browser's camera and
 * microphone prompt should follow a deliberate click, not a page load.
 */
export function MeetingRoom({
  bookingId,
  startsAt,
  endsAt,
  counterpartyName,
  conversationId,
  role,
  monday,
  tasks,
}: {
  bookingId: string;
  startsAt: Date;
  endsAt: Date;
  counterpartyName: string;
  conversationId: string;
  role: 'COACH' | 'STUDENT';
  monday: string;
  tasks: StudyTaskView[];
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const state = joinState(startsAt, endsAt, new Date(now));

  const join = () => {
    setError(null);
    startTransition(async () => {
      const result = await joinMeeting(bookingId);
      if (result.ok) {
        setUrl(result.url);
        return;
      }
      setError(result.message);
      setFallbackUrl(result.fallbackUrl);
    });
  };

  const time = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(startsAt);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div>
        {url ? (
          <iframe
            src={url}
            title={`${counterpartyName} ile görüşme`}
            allow="camera; microphone; fullscreen; display-capture; autoplay; speaker-selection"
            className="h-[70dvh] min-h-[420px] w-full rounded-2xl border border-stone/70 bg-ink"
          />
        ) : (
          <div className="flex h-[70dvh] min-h-[420px] flex-col items-center justify-center rounded-2xl border border-stone/70 bg-paper px-6 text-center">
            <p className="font-display text-xl font-semibold">{counterpartyName} ile görüşme</p>
            <p className="mt-1 text-sm text-muted">{time}</p>

            {state === 'OPEN' ? (
              <button
                type="button"
                disabled={pending}
                onClick={join}
                className="mt-6 rounded-full bg-cactus px-6 py-3 font-medium text-paper hover:bg-cactus-deep disabled:bg-stone"
              >
                {pending ? 'Bağlanıyor…' : 'Görüşmeye gir'}
              </button>
            ) : state === 'TOO_EARLY' ? (
              <p className="mt-6 text-sm text-muted">Görüşme odası, görüşme saatinden 10 dakika önce açılır.</p>
            ) : (
              <p className="mt-6 text-sm text-muted">Bu görüşmenin süresi doldu.</p>
            )}

            {state === 'OPEN' && !error && (
              <p className="mt-3 max-w-sm text-xs text-muted">
                Tarayıcın kamera ve mikrofon izni isteyecek. Görüşme kaydedilmez.
              </p>
            )}

            {error && (
              <p role="alert" className="mt-4 max-w-sm rounded-lg bg-bloom-pale px-4 py-2.5 text-sm">
                {error}
              </p>
            )}
            {fallbackUrl && (
              <a
                href={fallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 rounded-full border border-stone px-5 py-2.5 text-sm font-medium hover:border-cactus hover:text-cactus"
              >
                Harici bağlantıyla katıl
              </a>
            )}
          </div>
        )}
        <Link href={`/panel/sohbet/${conversationId}`} className="mt-3 inline-block text-sm text-muted hover:text-cactus">
          Sohbete dön
        </Link>
      </div>

      <aside className="rounded-2xl border border-stone/70 bg-paper p-4">
        <h2 className="font-display text-lg font-semibold">Bu haftanın programı</h2>
        <p className="mt-0.5 text-xs text-muted">Değişiklikler karşı tarafta birkaç saniye içinde görünür.</p>
        <div className="mt-3">
          <WeeklyPlanner conversationId={conversationId} role={role} initialMonday={monday} initialTasks={tasks} live />
        </div>
      </aside>
    </div>
  );
}
