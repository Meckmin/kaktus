'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailyCall } from '@daily-co/daily-js';
import { joinState, joinWindow } from '@/lib/meetings/rules';
import { describeFatal } from '@/lib/meetings/errors';
import { joinMeeting, meetingPresence, reportMeetingError } from '@/server/actions/meetings';
import { WeeklyPlanner } from '@/components/planner/WeeklyPlanner';
import type { StudyTaskView } from '@/lib/planner/task-schema';

/**
 * The call screen: video on the left, the week's plan on the right, so the
 * plan is built *during* the conversation instead of in another tab.
 *
 * The video is Daily Prebuilt, driven through daily-js rather than a bare
 * iframe, so the page knows what is happening inside it: whether the other
 * person is there, when someone leaves, why a join failed, and when the
 * camera was refused. Nothing connects until "Görüşmeye gir" is pressed — the
 * browser's camera prompt should follow a deliberate click, not a page load.
 */

type Phase = 'idle' | 'connecting' | 'in-call' | 'left' | 'failed';

const PRESENCE_POLL_MS = 15_000;

const THEME = {
  colors: {
    accent: '#1E6B4B',
    accentText: '#F5F7F3',
    background: '#F5F7F3',
    backgroundAccent: '#E9ECE6',
    baseText: '#12211C',
    border: '#C6CCC2',
    mainAreaBg: '#12211C',
    mainAreaBgAccent: '#1F332B',
    mainAreaText: '#F5F7F3',
    supportiveText: '#5C6B63',
  },
};

const clock = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

export function MeetingRoom({
  bookingId,
  startsAt,
  endsAt,
  status,
  counterpartyName,
  conversationId,
  role,
  monday,
  tasks,
}: {
  bookingId: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  counterpartyName: string;
  conversationId: string;
  role: 'COACH' | 'STUDENT';
  monday: string;
  tasks: StudyTaskView[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [counterpartIn, setCounterpartIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [deviceProblem, setDeviceProblem] = useState(false);
  const [busy, setBusy] = useState(false);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  // A cancelled or already-settled session has no room, whatever the clock says.
  const state = status === 'SCHEDULED' ? joinState(startsAt, endsAt, new Date(now)) : 'ENDED';
  const { closesAt } = joinWindow(startsAt, endsAt);

  const teardown = useCallback(async () => {
    const call = callRef.current;
    callRef.current = null;
    setCounterpartIn(false);
    if (call) await call.destroy().catch(() => {});
  }, []);

  // Leaving the page (back to the chat, closing the tab) ends the call.
  useEffect(() => () => void teardown(), [teardown]);

  // Before joining, say whether the other person is already waiting.
  useEffect(() => {
    if (phase === 'in-call' || phase === 'connecting' || state !== 'OPEN') return;
    let cancelled = false;
    const poll = async () => {
      const result = await meetingPresence(bookingId).catch(() => ({ counterpartPresent: false }));
      if (!cancelled) setCounterpartIn(result.counterpartPresent);
    };
    void poll();
    const timer = setInterval(poll, PRESENCE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [bookingId, phase, state]);

  const join = async () => {
    setError(null);
    setFallbackUrl(null);
    setNotice(null);
    setDeviceProblem(false);
    setBusy(true);
    await teardown();

    const result = await joinMeeting(bookingId).catch(() => null);
    setBusy(false);
    if (!result || !result.ok) {
      setError(result?.message ?? 'Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.');
      setFallbackUrl(result && !result.ok ? result.fallbackUrl : null);
      setPhase('failed');
      return;
    }

    const { default: Daily } = await import('@daily-co/daily-js');
    if (!Daily.supportedBrowser().supported) {
      setError('Bu tarayıcı görüntülü görüşmeyi desteklemiyor. Chrome, Safari, Edge ya da Firefox’un güncel sürümünü kullan.');
      setPhase('failed');
      return;
    }
    if (!containerRef.current) return;

    setPhase('connecting');
    const call = Daily.createFrame(containerRef.current, {
      iframeStyle: { width: '100%', height: '100%', border: '0', borderRadius: '16px' },
      showLeaveButton: true,
      showFullscreenButton: true,
      lang: 'tr',
      theme: THEME,
    });
    callRef.current = call;

    const countOthers = () => {
      const others = Object.values(call.participants()).filter((p) => !p.local).length;
      setCounterpartIn(others > 0);
    };

    call
      .on('joined-meeting', () => {
        setPhase('in-call');
        countOthers();
      })
      .on('participant-joined', (event) => {
        countOthers();
        if (event && !event.participant.local) setNotice(`${counterpartyName} görüşmeye katıldı.`);
      })
      .on('participant-left', (event) => {
        countOthers();
        if (event && !event.participant.local) setNotice(`${counterpartyName} görüşmeden ayrıldı.`);
      })
      .on('camera-error', () => setDeviceProblem(true))
      .on('left-meeting', () => {
        void teardown();
        setPhase((current) => (current === 'failed' ? current : 'left'));
      })
      .on('error', (event) => {
        if (event) {
          setError(describeFatal(event));
          void reportMeetingError(bookingId, event.error?.type ?? 'unknown', event.errorMsg ?? '');
        }
        // If the coach added a Zoom/Meet link, that's the way in now.
        setFallbackUrl(result.fallbackUrl);
        setPhase('failed');
        void teardown();
      });

    // Resolves only after the prejoin screen (device check) is passed, so
    // don't wait on it; failures arrive through the 'error' event as well.
    call.join({ url: result.roomUrl, token: result.token }).catch(() => {});
  };

  const live = phase === 'connecting' || phase === 'in-call';
  const minutesLeft = Math.ceil((endsAt.getTime() - now) / 60_000);
  const day = new Intl.DateTimeFormat('tr-TR', {
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
        {phase === 'in-call' && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm" aria-live="polite">
            <span className="flex items-center gap-2">
              <span
                className={['size-2 rounded-full', counterpartIn ? 'bg-cactus' : 'bg-stone'].join(' ')}
                aria-hidden
              />
              {counterpartIn ? `${counterpartyName} görüşmede` : `${counterpartyName} henüz katılmadı`}
            </span>
            <span className="text-muted tabular-nums">
              {minutesLeft > 5
                ? `${clock.format(endsAt)}’e kadar`
                : minutesLeft > 0
                  ? `Planlanan bitişe ${minutesLeft} dk`
                  : `Planlanan süre doldu · oda ${clock.format(closesAt)}’te kapanır`}
            </span>
          </div>
        )}
        {notice && phase === 'in-call' && <p className="sr-only" aria-live="assertive">{notice}</p>}
        {deviceProblem && live && (
          <p className="mb-2 rounded-lg border border-dust/60 bg-dust/10 px-3.5 py-2.5 text-sm leading-relaxed">
            Kamera ya da mikrofona erişilemedi. Adres çubuğundaki kilit simgesinden izin verip tekrar dene — ya
            da kamerasız devam et.
          </p>
        )}

        {/* The Daily iframe mounts here; kept in the DOM so it survives re-renders. */}
        <div
          ref={containerRef}
          className={[
            'h-[70dvh] min-h-[420px] w-full overflow-hidden rounded-2xl border border-stone/70 bg-ink',
            live ? '' : 'hidden',
          ].join(' ')}
        />

        {!live && (
          <div className="flex h-[70dvh] min-h-[420px] flex-col items-center justify-center rounded-2xl border border-stone/70 bg-paper px-6 text-center">
            <p className="font-display text-xl font-semibold">{counterpartyName} ile görüşme</p>
            <p className="mt-1 text-sm text-muted">{day}</p>

            {phase === 'left' && <p className="mt-6 font-medium">Görüşmeden ayrıldın.</p>}

            {state === 'OPEN' ? (
              <>
                {counterpartIn && (
                  <p className="mt-6 flex items-center gap-2 text-sm">
                    <span className="size-2 rounded-full bg-cactus" aria-hidden />
                    {counterpartyName} odada, seni bekliyor.
                  </p>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void join()}
                  className="mt-6 rounded-full bg-cactus px-6 py-3 font-medium text-paper hover:bg-cactus-deep disabled:bg-stone"
                >
                  {busy ? 'Bağlanıyor…' : phase === 'left' ? 'Tekrar katıl' : phase === 'failed' ? 'Tekrar dene' : 'Görüşmeye gir'}
                </button>
                {phase === 'idle' && (
                  <p className="mt-3 max-w-sm text-xs leading-relaxed text-muted">
                    Önce kamera ve mikrofonunu deneyebileceğin bir ekran açılır; tarayıcın izin isteyecek. Görüşme
                    kaydedilmez.
                  </p>
                )}
              </>
            ) : state === 'TOO_EARLY' ? (
              <p className="mt-6 text-sm text-muted">
                Görüşme odası {clock.format(joinWindow(startsAt, endsAt).opensAt)}’de açılır (görüşmeden 10 dakika
                önce). Bu sayfayı açık bırakabilirsin.
              </p>
            ) : (
              <p className="mt-6 text-sm text-muted">
                {status.startsWith('CANCELLED')
                  ? 'Bu görüşme iptal edildi.'
                  : status === 'SCHEDULED'
                    ? 'Bu görüşmenin süresi doldu.'
                    : 'Bu görüşme kapandı.'}
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
