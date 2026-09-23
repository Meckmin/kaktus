'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approveCoach, rejectCoach, viewDocument } from '@/server/actions/admin';
import { formatTry } from '@/lib/onboarding/client-state';

interface ReviewCoach {
  id: string;
  slug: string;
  headline: string;
  university: string;
  department: string;
  yksRank: number;
  yksYear: number;
  yksTrack: string;
  ownBaselineNet: number | null;
  ownFinalNet: number | null;
  createdAt: string;
  user: { name: string | null; email: string | null };
  documents: Array<{ id: string; type: string; mimeType: string; sizeBytes: number }>;
  pricingTiers: Array<{ name: string; priceMinor: number }>;
}

const DOC_LABELS: Record<string, string> = {
  YKS_RESULT: 'ÖSYM sonuç belgesi',
  YKS_PLACEMENT: 'Yerleştirme belgesi',
  STUDENT_CERTIFICATE: 'Öğrenci belgesi',
  IDENTITY: 'Kimlik',
  DIPLOMA: 'Diploma',
};

export function CoachReviewCard({ coach }: { coach: ReviewCoach }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (documentId: string) => {
    const result = await viewDocument(documentId);
    if (result.ok) window.open(result.url, '_blank', 'noopener');
    else setError(result.message);
  };

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.message ?? 'İşlem başarısız.');
      else router.refresh();
    });
  };

  return (
    <article className="rounded-2xl border border-stone/70 bg-paper p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">{coach.user.name ?? 'İsimsiz'}</h2>
          <p className="text-sm text-muted">{coach.user.email}</p>
        </div>
        <p className="text-sm text-muted">
          {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(coach.createdAt))}
        </p>
      </div>

      <p className="mt-3 leading-snug">{coach.headline}</p>

      {/* The claim to check, isolated and stated once. A reviewer comparing a
          document against a number should not have to hunt for the number. */}
      <dl className="mt-4 grid gap-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60 sm:grid-cols-2">
        <Fact label="Beyan edilen sıralama" value={`${coach.yksRank.toLocaleString('tr-TR')}. (${coach.yksYear})`} strong />
        <Fact label="Alan" value={coach.yksTrack} />
        <Fact label="Okul" value={`${coach.university} · ${coach.department}`} />
        <Fact
          label="Kendi net çıkışı"
          value={
            coach.ownBaselineNet != null && coach.ownFinalNet != null
              ? `${Math.round(coach.ownBaselineNet)} → ${Math.round(coach.ownFinalNet)}`
              : 'Belirtilmemiş'
          }
        />
      </dl>

      <div className="mt-4">
        <p className="text-sm font-medium">Belgeler</p>
        {coach.documents.length === 0 ? (
          <p className="mt-1 text-sm text-bloom">Belge yüklenmemiş — onaylama.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {coach.documents.map((document) => (
              <li key={document.id}>
                <button
                  type="button"
                  onClick={() => open(document.id)}
                  className="rounded-full border border-stone px-4 py-2 text-sm hover:border-cactus hover:text-cactus"
                >
                  {DOC_LABELS[document.type] ?? document.type} ·{' '}
                  {Math.round(document.sizeBytes / 1024)} KB
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {coach.pricingTiers.length > 0 && (
        <p className="mt-4 text-sm text-muted">
          {coach.pricingTiers.map((tier) => `${tier.name}: ${formatTry(tier.priceMinor)}`).join(' · ')}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-bloom-pale px-4 py-2.5 text-sm">
          {error}
        </p>
      )}

      {rejecting ? (
        <div className="mt-5 border-t border-stone/60 pt-5">
          <label className="block text-sm font-medium">
            Gerekçe — koç bunu görecek
          </label>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="ÖSYM belgesindeki sıralama beyan edilenden farklı. Doğru belgeyle tekrar başvurabilirsin."
            className="mt-2 w-full resize-none rounded-xl border border-stone bg-limestone px-4 py-3 text-sm outline-none focus:border-cactus"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending || note.trim().length < 10}
              onClick={() => act(() => rejectCoach({ coachProfileId: coach.id, note }))}
              className="rounded-full bg-bloom px-5 py-2.5 text-sm font-medium text-paper disabled:bg-stone disabled:text-muted"
            >
              Reddet
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-full px-4 py-2.5 text-sm text-muted hover:text-ink"
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending || coach.documents.length === 0}
            onClick={() => act(() => approveCoach({ coachProfileId: coach.id }))}
            className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
          >
            Onayla ve yayına al
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setRejecting(true)}
            className="rounded-full border border-stone px-5 py-2.5 text-sm font-medium hover:border-bloom hover:text-bloom"
          >
            Reddet
          </button>
        </div>
      )}
    </article>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="bg-paper px-4 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`mt-0.5 ${strong ? 'font-display text-lg font-semibold' : 'font-medium'}`}>
        {value}
      </dd>
    </div>
  );
}
