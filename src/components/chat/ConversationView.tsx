'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ConversationView, MilestoneEntry, TimelineEntry } from '@/server/queries/conversation';
import { OFFER_STATUS_TR } from '@/lib/offers/state-machine';
import { formatTry } from '@/lib/onboarding/client-state';
import { computeBreakdown } from '@/lib/offers/draft';
import {
  acceptOffer,
  counterOffer,
  declineOffer,
  payForOffer,
  sendMessage,
} from '@/server/actions/negotiation';
import {
  completeMilestone,
  raiseDispute,
  releaseMilestoneToCoach,
  requestCancellation,
} from '@/server/actions/milestones';
import { submitReviewAction } from '@/server/actions/reviews';

/**
 * The negotiation screen.
 *
 * Messages and offers share one timeline. The offer being discussed sits in the
 * conversation, in the place it was sent, rather than in a side panel — because
 * "can we do 2.700?" is meaningless three scroll-lengths away from the 3.000
 * it refers to.
 *
 * Refresh is a poll, not a socket. Live updates would be better and are the
 * obvious upgrade, but a ten-second poll is a fifth of the code and nobody in a
 * coaching negotiation is typing fast enough to notice the difference.
 */
const POLL_INTERVAL_MS = 10_000;

type DisputeState =
  | { kind: 'CANCEL' }
  | { kind: 'DISPUTE'; milestoneId?: string; milestoneLabel?: string };

export function ConversationView({ conversation }: { conversation: ConversationView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disputeState, setDisputeState] = useState<DisputeState | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [conversation.timeline.length]);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.message ?? 'İşlem tamamlanamadı.');
      else router.refresh();
    });
  };

  return (
    <div className="flex min-h-[70dvh] flex-col">
      {conversation.engagement && (
        <MilestonesPanel
          engagement={conversation.engagement}
          viewerRole={conversation.viewerRole}
          pending={pending}
          onRefresh={() => router.refresh()}
          onDispute={(milestoneId, milestoneLabel) =>
            setDisputeState({ kind: 'DISPUTE', milestoneId, milestoneLabel })
          }
          onRequestCancellation={() => setDisputeState({ kind: 'CANCEL' })}
        />
      )}

      {conversation.engagement &&
        conversation.engagement.reviewEligibility &&
        conversation.viewerRole === 'STUDENT' && (
          <ReviewPanel
            engagementId={conversation.engagement.id}
            counterpartyName={conversation.counterpartyName}
            reviewed={conversation.engagement.reviewed}
            incomplete={conversation.engagement.reviewEligibility === 'INCOMPLETE'}
            onSubmitted={() => router.refresh()}
          />
        )}

      <ol className="flex-1 space-y-4">
        {conversation.timeline.map((entry) =>
          entry.kind === 'message' ? (
            <MessageBubble key={entry.id} entry={entry} />
          ) : (
            <OfferBlock
              key={entry.id}
              entry={entry}
              viewerRole={conversation.viewerRole}
              pending={pending}
              onAccept={() => run(() => acceptOffer(entry.id))}
              onDecline={() => run(() => declineOffer(entry.id))}
              onCounter={(priceMinor, note) => run(() => counterOffer(entry.id, { priceMinor, note }))}
              onPay={() => run(async () => {
                const result = await payForOffer(entry.id);
                if (!result.ok) return result;
                // Iyzico returns a script that renders its own hosted form.
                const holder = document.getElementById('iyzico-checkout');
                if (holder) {
                  holder.innerHTML = result.checkoutFormContent;
                  holder
                    .querySelectorAll('script')
                    .forEach((old) => {
                      const script = document.createElement('script');
                      script.textContent = old.textContent;
                      old.replaceWith(script);
                    });
                }
                return { ok: true };
              })}
            />
          ),
        )}
        <div ref={bottomRef} />
      </ol>

      <div id="iyzico-checkout" className="mt-6 empty:hidden" />

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-bloom-pale px-4 py-3 text-sm">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 rounded-lg border border-dust/60 bg-dust/10 px-4 py-3 text-sm leading-relaxed">
          {notice}
        </p>
      )}

      <Composer
        conversationId={conversation.id}
        onNotice={setNotice}
        onSent={() => router.refresh()}
      />

      {disputeState && conversation.engagement && (
        <DisputeModal
          mode={disputeState.kind}
          offerId={conversation.engagement.offerId}
          milestoneId={disputeState.kind === 'DISPUTE' ? disputeState.milestoneId : undefined}
          milestoneLabel={
            disputeState.kind === 'DISPUTE' ? disputeState.milestoneLabel : undefined
          }
          onClose={() => setDisputeState(null)}
          onDone={(message) => {
            setDisputeState(null);
            setNotice(message);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function MessageBubble({ entry }: { entry: Extract<TimelineEntry, { kind: 'message' }> }) {
  return (
    <li className={entry.mine ? 'flex justify-end' : 'flex justify-start'}>
      <div className="max-w-[85%] sm:max-w-[70%]">
        <div
          className={[
            'rounded-2xl px-4 py-2.5 leading-relaxed',
            entry.mine ? 'bg-cactus text-paper' : 'border border-stone/70 bg-paper',
          ].join(' ')}
        >
          {entry.body}
        </div>
        {entry.systemNotice && (
          <p className="mt-1.5 rounded-lg border border-dust/60 bg-dust/10 px-3 py-2 text-xs leading-relaxed text-muted">
            {entry.systemNotice}
          </p>
        )}
        <time
          dateTime={entry.at.toISOString()}
          className={['mt-1 block text-xs text-muted', entry.mine ? 'text-right' : ''].join(' ')}
        >
          {new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(entry.at)}
        </time>
      </div>
    </li>
  );
}

function OfferBlock({
  entry,
  viewerRole,
  pending,
  onAccept,
  onDecline,
  onCounter,
  onPay,
}: {
  entry: Extract<TimelineEntry, { kind: 'offer' }>;
  viewerRole: 'STUDENT' | 'COACH';
  pending: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCounter: (priceMinor: number, note?: string) => void;
  onPay: () => void;
}) {
  const [countering, setCountering] = useState(false);
  const [price, setPrice] = useState(String(Math.round(entry.priceMinor / 100)));
  const [note, setNote] = useState('');

  const breakdown = computeBreakdown(entry.priceMinor, entry.commissionBps);
  const canAccept = entry.actions.includes('ACCEPT');
  const canCounter = entry.actions.includes('COUNTER');
  const canCancel = entry.actions.includes('CANCEL');
  const canPay = viewerRole === 'STUDENT' && entry.status === 'ACCEPTED';

  return (
    <li>
      <article
        className={[
          'rounded-2xl border p-5',
          entry.superseded
            ? 'border-stone/50 bg-limestone/60 opacity-60'
            : entry.status === 'PAID_IN_ESCROW' || entry.status === 'ACTIVE'
              ? 'border-cactus/50 bg-cactus-pale/40'
              : 'border-cactus/40 bg-paper',
        ].join(' ')}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-sm text-muted">
              {entry.mine ? 'Senin teklifin' : 'Sana gelen teklif'}
              {entry.superseded && ' · yerine yenisi geldi'}
            </p>
            <h3 className="mt-0.5 font-display text-lg font-semibold">{entry.title}</h3>
          </div>
          <p className="font-display text-2xl font-semibold tabular-nums">
            {formatTry(entry.priceMinor)}
          </p>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Pair label="Seans" value={`${entry.sessions} × ${entry.minutesPerSession} dk`} />
          <Pair
            label="Başlangıç"
            value={new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(entry.startDate)}
          />
          <Pair
            label={viewerRole === 'COACH' ? 'Sana geçecek' : 'Koça giden'}
            value={formatTry(breakdown.coachReceivesMinor)}
          />
          <Pair label="Kaktüs payı" value={formatTry(breakdown.platformFeeMinor)} />
        </dl>

        {entry.notes && <p className="mt-4 leading-relaxed">{entry.notes}</p>}

        <p className="mt-4 inline-block rounded-full border border-stone px-3 py-1 text-sm">
          {OFFER_STATUS_TR[entry.status] ?? entry.status}
        </p>

        {!entry.superseded && (canAccept || canCounter || canCancel || canPay) && (
          <div className="mt-5 flex flex-wrap gap-2">
            {canPay && (
              <button
                type="button"
                onClick={onPay}
                disabled={pending}
                className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep disabled:bg-stone"
              >
                Ödemeyi yap
              </button>
            )}
            {canAccept && (
              <button
                type="button"
                onClick={onAccept}
                disabled={pending}
                className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep disabled:bg-stone"
              >
                Kabul et
              </button>
            )}
            {canCounter && (
              <button
                type="button"
                onClick={() => setCountering((v) => !v)}
                disabled={pending}
                className="rounded-full border border-stone px-5 py-2.5 text-sm font-medium hover:border-cactus hover:text-cactus"
              >
                Karşı teklif ver
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={onDecline}
                disabled={pending}
                className="rounded-full px-4 py-2.5 text-sm text-muted hover:text-ink"
              >
                {entry.mine ? 'Teklifi geri çek' : 'Reddet'}
              </button>
            )}
          </div>
        )}

        {countering && (
          <div className="mt-5 border-t border-stone/60 pt-5">
            <label className="block text-sm font-medium">Karşı teklifin</label>
            <div className="mt-2 flex items-baseline gap-2 rounded-xl border border-stone bg-limestone px-4 py-2.5 focus-within:border-cactus">
              <input
                type="text"
                inputMode="numeric"
                value={price}
                onChange={(event) => setPrice(event.target.value.replace(/\D/g, ''))}
                className="w-full bg-transparent font-display text-xl font-semibold tabular-nums outline-none"
                aria-label="Karşı teklif tutarı"
              />
              <span className="text-sm text-muted">₺</span>
            </div>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 1000))}
              rows={2}
              placeholder="Neden bu tutar? Kısaca yaz."
              className="mt-2 w-full resize-none rounded-xl border border-stone bg-limestone px-4 py-2.5 text-sm outline-none focus:border-cactus"
            />
            <button
              type="button"
              disabled={pending || !price}
              onClick={() => {
                onCounter(Number.parseInt(price, 10) * 100, note || undefined);
                setCountering(false);
              }}
              className="mt-3 rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep disabled:bg-stone"
            >
              Karşı teklifi gönder
            </button>
          </div>
        )}
      </article>
    </li>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function Composer({
  conversationId,
  onNotice,
  onSent,
}: {
  conversationId: string;
  onNotice: (notice: string | null) => void;
  onSent: () => void;
}) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    onNotice(null);
    try {
      const result = await sendMessage(conversationId, body);
      if (result.ok) {
        setBody('');
        if (result.masked) onNotice(result.notice);
        onSent();
      } else if (result.blocked) {
        // Deliberately keeps the text in the box. Clearing it would make the
        // user retype a long message to remove one phone number.
        onNotice(result.notice);
      } else {
        onNotice(result.message);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sticky bottom-0 mt-6 border-t border-stone/70 bg-limestone/95 py-4 backdrop-blur">
      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Mesaj yaz…"
          className="w-full resize-none rounded-xl border border-stone bg-paper px-4 py-3 outline-none placeholder:text-stone focus:border-cactus"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !body.trim()}
          className="shrink-0 rounded-full bg-cactus px-5 py-3 font-medium text-paper hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
        >
          Gönder
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Telefon, IBAN ve sosyal medya bilgileri otomatik gizlenir. Anlaşmanı Kaktüs üzerinden
        yaparsan ödemen güvence altında olur.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Milestones — once an offer is paid, this is where the money actually moves.
// ─────────────────────────────────────────────────────────────────────────────

const MILESTONE_TR: Record<MilestoneEntry['status'], string> = {
  SCHEDULED: 'Planlandı',
  IN_PROGRESS: 'Devam ediyor',
  PENDING_CONFIRMATION: 'Onay bekliyor',
  RELEASED: 'Aktarıldı',
  DISPUTED: 'İtiraz sürecinde',
  REFUNDED: 'İade edildi',
};

/** "3 gün 5 saat" until the given instant, or null once it has passed. */
function remainingLabel(date: Date | null, now: number): string | null {
  if (!date) return null;
  const ms = date.getTime() - now;
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  if (days > 0) return `${days} gün ${restHours} saat`;
  if (hours > 0) return `${hours} saat`;
  return `${Math.max(1, Math.floor(ms / 60_000))} dakika`;
}

function MilestonesPanel({
  engagement,
  viewerRole,
  pending,
  onRefresh,
  onDispute,
  onRequestCancellation,
}: {
  engagement: NonNullable<ConversationView['engagement']>;
  viewerRole: 'STUDENT' | 'COACH';
  pending: boolean;
  onRefresh: () => void;
  onDispute: (milestoneId: string, milestoneLabel: string) => void;
  onRequestCancellation: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const now = Date.now();

  const act = (id: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusyId(id);
    setRowError(null);
    void fn().then((result) => {
      setBusyId(null);
      if (result.ok) onRefresh();
      else setRowError({ id, message: result.message });
    });
  };

  const canDispute = viewerRole === 'STUDENT' && engagement.status === 'ACTIVE';

  return (
    <section className="mb-6 rounded-2xl border border-stone/70 bg-limestone/60 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Ödeme dilimleri</h2>
        {canDispute && (
          <button
            type="button"
            onClick={onRequestCancellation}
            className="text-sm font-medium text-muted transition-colors hover:text-bloom"
          >
            İptal talebi
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">
        {viewerRole === 'COACH'
          ? 'Her dersten sonra o dilimi işaretle. Öğrenci onaylayınca ya da 5 gün geçince ücret sana aktarılır.'
          : 'Her dilim bir derse karşılık gelir. Koç dersi işaretleyince onaylayıp ücreti aktarabilirsin; 5 gün içinde işlem yapmazsan ücret otomatik aktarılır.'}
      </p>

      <ul className="mt-3 space-y-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60">
        {engagement.milestones.map((m) => {
          const label = `${m.index + 1}. dilim`;
          const remaining = remainingLabel(m.autoReleaseAt, now);
          const isBusy = pending && busyId === m.id;

          return (
            <li key={m.id} className="bg-paper px-5 py-4">
              <div className="flex items-baseline justify-between gap-4">
                <span>
                  {label}
                  <span className="ml-2 text-sm text-muted">
                    {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(
                      m.periodStart,
                    )}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block tabular-nums">{formatTry(m.amountMinor)}</span>
                  <span className="mt-0.5 block text-sm text-muted">{MILESTONE_TR[m.status]}</span>
                </span>
              </div>

              {m.status === 'PENDING_CONFIRMATION' && (
                <p className="mt-2 text-sm text-muted">
                  {remaining
                    ? `Otomatik aktarıma kalan süre: ${remaining}`
                    : 'Otomatik aktarım sırada.'}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {viewerRole === 'COACH' &&
                  (m.status === 'SCHEDULED' || m.status === 'IN_PROGRESS') &&
                  now < m.completableAt.getTime() && (
                    <p className="text-sm text-muted">
                      Ders bitince işaretleyebilirsin ·{' '}
                      {new Intl.DateTimeFormat('tr-TR', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(m.completableAt)}
                    </p>
                  )}

                {viewerRole === 'COACH' &&
                  (m.status === 'SCHEDULED' || m.status === 'IN_PROGRESS') &&
                  now >= m.completableAt.getTime() && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => act(m.id, () => completeMilestone(m.id))}
                      className="rounded-full bg-cactus px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
                    >
                      {isBusy ? 'İşleniyor' : 'Tamamlandı olarak işaretle'}
                    </button>
                  )}

                {viewerRole === 'STUDENT' && m.status === 'PENDING_CONFIRMATION' && (
                  <>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => act(m.id, () => releaseMilestoneToCoach(m.id))}
                      className="rounded-full bg-cactus px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
                    >
                      {isBusy ? 'İşleniyor' : 'Onayla ve ücreti aktar'}
                    </button>
                    {canDispute && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDispute(m.id, label)}
                        className="rounded-full px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-bloom"
                      >
                        Sorun bildir
                      </button>
                    )}
                  </>
                )}

                {canDispute && (m.status === 'SCHEDULED' || m.status === 'IN_PROGRESS') && (
                  <button
                    type="button"
                    onClick={() => onDispute(m.id, label)}
                    className="rounded-full px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-bloom"
                  >
                    Sorun bildir
                  </button>
                )}
              </div>

              {rowError?.id === m.id && (
                <p role="alert" className="mt-2 rounded-lg bg-bloom-pale px-3 py-2 text-sm text-ink">
                  {rowError.message}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Review — shown to the student once, after the engagement completes.
// ─────────────────────────────────────────────────────────────────────────────

function ReviewPanel({
  engagementId,
  counterpartyName,
  reviewed,
  incomplete,
  onSubmitted,
}: {
  engagementId: string;
  counterpartyName: string;
  reviewed: boolean;
  /** The program ended early; the review will carry a label saying so. */
  incomplete: boolean;
  onSubmitted: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [netGain, setNetGain] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(reviewed);

  if (done) {
    return (
      <section className="mb-6 rounded-2xl border border-stone/70 bg-limestone/60 p-5">
        <p className="text-sm leading-relaxed text-muted">
          {counterpartyName} ile ilgili değerlendirmeni gönderdin. Teşekkürler!
        </p>
      </section>
    );
  }

  const submit = () => {
    if (rating === 0 || submitting) return;
    setError(null);
    setSubmitting(true);
    const trimmedGain = netGain.trim();
    const netGainReported = trimmedGain ? Number.parseFloat(trimmedGain) : undefined;
    void submitReviewAction(engagementId, {
      rating,
      body: body.trim() || undefined,
      netGainReported,
    }).then((result) => {
      setSubmitting(false);
      if (result.ok) {
        setDone(true);
        onSubmitted();
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <section className="mb-6 rounded-2xl border border-cactus/40 bg-cactus-pale/30 p-5">
      <h2 className="font-display text-lg font-semibold">
        {counterpartyName} ile ilgili deneyimini değerlendir
      </h2>
      <p className="mt-1 text-sm text-muted">
        {incomplete
          ? 'Program yarıda kaldı. Yaşadıklarını dürüstçe yazman diğer öğrencilere yardımcı olur; değerlendirmen profilde “Program yarıda kaldı” etiketiyle görünür.'
          : 'Programın tamamlandı. Değerlendirmen diğer öğrencilere yardımcı olur.'}
      </p>

      <div className="mt-4 flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={`${n} yıldız`}
            className={[
              'text-3xl leading-none transition-colors',
              n <= rating ? 'text-cactus' : 'text-stone',
            ].join(' ')}
          >
            ★
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 2000))}
        rows={3}
        placeholder="Deneyimini kısaca anlat (opsiyonel)."
        className="mt-3 w-full resize-none rounded-xl border border-stone bg-paper px-4 py-3 text-sm outline-none placeholder:text-stone focus:border-cactus"
      />

      <label className="mt-3 flex max-w-xs items-center gap-2 rounded-xl border border-stone bg-paper px-4 py-2.5 focus-within:border-cactus">
        <span className="shrink-0 text-sm text-muted">Net artışı (opsiyonel)</span>
        <input
          type="text"
          inputMode="decimal"
          value={netGain}
          onChange={(e) => setNetGain(e.target.value.replace(/[^0-9.-]/g, ''))}
          className="w-full bg-transparent text-right text-sm outline-none"
          aria-label="Net artışı"
        />
      </label>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-bloom-pale px-3.5 py-2.5 text-sm text-ink">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={rating === 0 || submitting}
        onClick={submit}
        className="mt-4 rounded-full bg-cactus px-6 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
      >
        {submitting ? 'Gönderiliyor' : 'Değerlendirmeyi gönder'}
      </button>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispute / cancellation modal
// ─────────────────────────────────────────────────────────────────────────────

type DisputeReasonValue = 'COACH_NO_SHOW' | 'QUALITY' | 'SCOPE_NOT_DELIVERED' | 'UNRESPONSIVE' | 'OTHER';

const DISPUTE_REASONS: Array<{ value: DisputeReasonValue; label: string }> = [
  { value: 'COACH_NO_SHOW', label: 'Koç derse gelmedi' },
  { value: 'QUALITY', label: 'Ders kalitesi yetersizdi' },
  { value: 'SCOPE_NOT_DELIVERED', label: 'Söz verilen kapsam sağlanmadı' },
  { value: 'UNRESPONSIVE', label: 'Koç mesajlara dönmüyor' },
  { value: 'OTHER', label: 'Diğer' },
];

function DisputeModal({
  mode,
  offerId,
  milestoneId,
  milestoneLabel,
  onClose,
  onDone,
}: {
  mode: 'CANCEL' | 'DISPUTE';
  offerId: string;
  milestoneId?: string;
  milestoneLabel?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState<DisputeReasonValue>(DISPUTE_REASONS[0].value);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isCancel = mode === 'CANCEL';
  const detailOk = isCancel || detail.trim().length >= 10;

  const submit = () => {
    setError(null);
    setSubmitting(true);
    const action = isCancel
      ? requestCancellation(offerId, detail)
      : raiseDispute({ offerId, milestoneId, reason, detail });
    void action.then((result) => {
      setSubmitting(false);
      if (result.ok) onDone(result.message);
      else setError(result.message);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-ink/40 p-0 backdrop-blur-[2px] sm:place-items-center sm:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispute-title"
        className="w-full max-w-md rounded-t-2xl bg-paper p-7 shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="dispute-title" className="font-display text-2xl font-semibold leading-tight">
            {isCancel ? 'İptal talebi' : milestoneLabel ? `${milestoneLabel} için sorun bildir` : 'Sorun bildir'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="-m-2 rounded-full p-2 text-muted transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-muted">
          {isCancel
            ? 'Ödeme öncesinde teklif iptal edilir. Ödeme yapıldıysa talebin bir uzmana iletilir ve para incelenene kadar Kaktüs’te tutulur.'
            : 'İlgili dilimler dondurulur ve ekibimiz inceler. Aktarılmış dilimler geri alınmaz.'}
        </p>

        {!isCancel && (
          <fieldset className="mt-5">
            <legend className="text-sm font-medium">Sebep</legend>
            <div className="mt-2 space-y-1.5">
              {DISPUTE_REASONS.map((r) => (
                <label key={r.value} className="flex items-center gap-2.5 text-sm">
                  <input
                    type="radio"
                    name="dispute-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="accent-cactus"
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="mt-5 block">
          <span className="text-sm font-medium">
            {isCancel ? 'Kısa açıklama (opsiyonel)' : 'Ne oldu? (en az 10 karakter)'}
          </span>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value.slice(0, 2000))}
            rows={4}
            placeholder={
              isCancel
                ? 'Programı neden iptal etmek istediğini yazabilirsin.'
                : 'Yaşanan sorunu olabildiğince somut anlat; kanıt varsa mesajlaşmada paylaş.'
            }
            className="mt-2 w-full resize-none rounded-xl border border-stone bg-white px-4 py-3 text-sm outline-none placeholder:text-stone focus:border-cactus"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-bloom-pale px-3.5 py-2.5 text-sm text-ink">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !detailOk}
            className="rounded-full bg-cactus px-6 py-3 font-medium text-paper transition-colors hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
          >
            {submitting ? 'Gönderiliyor' : isCancel ? 'İptal talebini gönder' : 'Bildirimi gönder'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-3 text-sm font-medium text-muted hover:text-ink"
          >
            Vazgeç
          </button>
        </div>
      </div>
    </div>
  );
}
