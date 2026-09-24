'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  APPLY_STEPS,
  APPLY_STEP_HINTS,
  APPLY_STEP_TITLES,
  STEP_FIELDS,
  SUBMERCHANT_TYPE_LABELS,
  WEEKDAY_LABELS,
  coachApplicationSchema,
  minutesToTime,
  timeToMinutes,
  type CoachApplicationInput,
} from '@/lib/coach/application';
import { GRADE_LABELS, STYLE_LABELS, TRACK_LABELS } from '@/lib/onboarding/client-state';
import { isValidTckn, isValidTrIban, isValidVkn } from '@/lib/coach/identifiers';
import { submitCoachApplication, uploadVerificationDocument } from '@/server/actions/coach-application';
import { ChoiceRow, NumberField, TextField } from '@/components/onboarding/controls';

/**
 * Coach application wizard.
 *
 * Five steps, validated one at a time. A single 40-field page is the reliable
 * way to lose applicants — but so is a wizard that only reveals a mistake on
 * the last screen, so each step validates its own fields before advancing.
 *
 * Payout details are typed last and submitted immediately. They are never
 * autosaved as a draft: the shorter the window in which a TCKN sits in
 * un-submitted state, the better. Everything before them is autosaved to
 * localStorage, so closing the tab on step 4 doesn't cost four steps of typing.
 */

type Errors = Partial<Record<string, string[]>>;

const EMPTY: CoachApplicationInput = {
  university: '',
  department: '',
  yksTrack: 'SAYISAL',
  // Must agree with `yksTrack` above. These defaulted apart, and because the
  // first step pre-selects Sayısal, a Sayısal coach never tapped the control
  // and `tracks` stayed empty — silently failing validation two steps later.
  tracks: ['SAYISAL'],
  yksRank: 0,
  yksYear: new Date().getFullYear() - 1,
  wasMezun: false,
  headline: '',
  bio: '',
  styles: [],
  subjects: [],
  supportedGrades: [],
  monthlyPriceMinor: 0,
  sessionsPerMonth: 4,
  minutesPerSession: 60,
  maxActiveStudents: 8,
  availability: [],
  submerchantType: 'PERSONAL',
  legalName: '',
  identityNumber: '',
  iban: '',
  address: '',
  city: '',
  phone: '',
  acceptedTerms: true,
};

/**
 * Which fields each step actually puts on screen.
 *
 * Kept next to the wizard rather than in the schema module, because it
 * describes this UI, not the data. It exists so a mismatch between "required
 * for this step" and "visible on this step" surfaces as a message instead of
 * an unresponsive button.
 */
const RENDERED_FIELDS: Record<string, string[]> = {
  kimlik: ['university', 'department', 'yksTrack', 'yksRank', 'yksYear', 'graduationYear'],
  yontem: ['headline', 'bio', 'styles', 'tracks', 'supportedGrades'],
  ucret: ['monthlyPriceMinor', 'sessionPriceMinor', 'maxActiveStudents', 'weeklyCapacityHours'],
  takvim: ['availability'],
  odeme: [
    'submerchantType', 'legalName', 'identityNumber', 'iban',
    'taxOffice', 'address', 'city', 'phone', 'acceptedTerms',
  ],
};

/** Never written to browser storage — see the note at the top of this file. */
const PAYOUT_FIELDS = RENDERED_FIELDS.odeme;

type Draft = { stepIndex: number; form: Partial<CoachApplicationInput> };

function withoutPayout(form: Partial<CoachApplicationInput>): Partial<CoachApplicationInput> {
  const safe: Record<string, unknown> = { ...form };
  for (const field of PAYOUT_FIELDS) delete safe[field];
  return safe as Partial<CoachApplicationInput>;
}

function readDraft(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    return { stepIndex: draft.stepIndex, form: withoutPayout(draft.form ?? {}) };
  } catch {
    // Private mode, blocked storage, or corrupted JSON: start fresh.
    return null;
  }
}

function writeDraft(key: string, draft: Draft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...draft, form: withoutPayout(draft.form) }));
  } catch {
    /* non-fatal — the form still works, it just won't survive a closed tab */
  }
}

function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* non-fatal */
  }
}

export function CoachApplicationForm({
  displayName,
  draftKey,
  initialDocuments = [],
}: {
  displayName: string;
  /** Per-user localStorage key, so a shared browser never mixes two drafts. */
  draftKey: string;
  /** Documents already uploaded to this DRAFT profile in an earlier visit. */
  initialDocuments?: Array<{ id: string; filename: string }>;
}) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<CoachApplicationInput>({ ...EMPTY, legalName: displayName });
  const [errors, setErrors] = useState<Errors>({});
  const [stepBlocked, setStepBlocked] = useState<string | null>(null);
  const [documents, setDocuments] = useState(initialDocuments);
  const [restored, setRestored] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [pending, startTransition] = useTransition();

  // Restore after mount rather than in the initial state: localStorage doesn't
  // exist during server rendering, and reading it there would mismatch hydration.
  useEffect(() => {
    const draft = readDraft(draftKey);
    if (draft) {
      setForm((current) => ({ ...current, ...draft.form }));
      setStepIndex(Math.min(Math.max(0, draft.stepIndex || 0), APPLY_STEPS.length - 1));
    }
    setRestored(true);
  }, [draftKey]);

  useEffect(() => {
    if (restored) writeDraft(draftKey, { stepIndex, form });
  }, [restored, draftKey, stepIndex, form]);

  // Each step starts at its heading, not wherever the previous step's
  // "Devam et" button happened to leave the scroll position.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
  }, [stepIndex]);

  const step = APPLY_STEPS[stepIndex];
  const isLast = stepIndex === APPLY_STEPS.length - 1;
  const set = (patch: Partial<CoachApplicationInput>) =>
    setForm((current) => ({ ...current, ...patch }));

  /**
   * Validates only the current step's fields, so early steps aren't blocked.
   *
   * The `stepBlocked` fallback matters more than it looks. Previously, if a
   * required field was listed for a step but had no control rendered on that
   * step, validation failed and the Devam button did nothing at all — no
   * message, no highlight, no way for the user to work out what was wrong.
   * That is exactly what happened with `tracks`. Now an unrenderable error
   * still produces a visible message naming the field, so the failure mode is
   * "confusing message" rather than "dead button".
   */
  const validateStep = (): boolean => {
    const result = coachApplicationSchema.safeParse({ ...form, acceptedTerms: true });
    if (result.success) {
      setErrors({});
      setStepBlocked(null);
      return true;
    }
    const all = result.error.flatten().fieldErrors as Errors;
    const relevant: Errors = {};
    for (const field of STEP_FIELDS[step]) {
      if (all[field as string]) relevant[field as string] = all[field as string];
    }
    setErrors(relevant);

    const fields = Object.keys(relevant);
    if (fields.length === 0) {
      setStepBlocked(null);
      return true;
    }

    // If none of the failing fields is visible on this step, say so out loud.
    const invisible = fields.filter((field) => !RENDERED_FIELDS[step].includes(field));
    setStepBlocked(
      invisible.length > 0
        ? `Bu adımda görünmeyen bir alan eksik (${invisible.join(', ')}). Lütfen bize bildir.`
        : null,
    );
    return false;
  };

  const next = () => {
    if (!validateStep()) return;
    setStepIndex((i) => Math.min(i + 1, APPLY_STEPS.length - 1));
  };

  const submit = () => {
    if (!validateStep()) return;
    if (!accepted) {
      setErrors({ acceptedTerms: ['Devam etmek için sözleşmeyi onaylaman gerekiyor'] });
      return;
    }
    setSubmitError(null);
    startTransition(async () => {
      const result = await submitCoachApplication({ ...form, acceptedTerms: true });
      if (result.ok) {
        clearDraft(draftKey);
        router.push('/koc-ol/tesekkurler');
        return;
      }
      setSubmitError(result.message);
      if (result.fieldErrors) setErrors(result.fieldErrors);
    });
  };

  const onUpload = async (file: File) => {
    setUploadError(null);
    const data = new FormData();
    data.set('file', file);
    data.set('type', 'YKS_RESULT');
    const result = await uploadVerificationDocument(data);
    if (result.ok) {
      setDocuments((current) => [...current, { id: result.documentId, filename: result.filename }]);
    } else {
      setUploadError(result.message);
    }
  };

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_15rem] lg:gap-16">
      <div>
        <nav className="flex items-center gap-3 text-sm text-muted">
          {stepIndex > 0 && (
            <>
              <button
                type="button"
                onClick={() => setStepIndex((i) => i - 1)}
                className="rounded-full px-2 py-1 hover:text-cactus"
              >
                Geri
              </button>
              <span aria-hidden className="text-stone">/</span>
            </>
          )}
          <span>
            {stepIndex + 1}/{APPLY_STEPS.length}
          </span>
        </nav>

        <h1 className="mt-6 max-w-measure font-display text-question font-semibold text-balance">
          {APPLY_STEP_TITLES[step]}
        </h1>
        {APPLY_STEP_HINTS[step] && (
          <p className="mt-3 max-w-[52ch] leading-relaxed text-muted">{APPLY_STEP_HINTS[step]}</p>
        )}

        <div className="mt-8 space-y-8">
          {step === 'kimlik' && (
            <CredentialsStep
              form={form}
              set={set}
              errors={errors}
              documents={documents}
              uploadError={uploadError}
              onUpload={onUpload}
            />
          )}
          {step === 'yontem' && <MethodStep form={form} set={set} errors={errors} />}
          {step === 'ucret' && <PricingStep form={form} set={set} errors={errors} />}
          {step === 'takvim' && <AvailabilityStep form={form} set={set} errors={errors} />}
          {step === 'odeme' && (
            <PayoutStep
              form={form}
              set={set}
              errors={errors}
              accepted={accepted}
              setAccepted={setAccepted}
            />
          )}
        </div>

        {submitError && (
          <p role="alert" className="mt-6 rounded-lg bg-bloom-pale px-4 py-3 text-sm">
            {submitError}
          </p>
        )}

        {stepBlocked && (
          <p role="alert" className="mt-6 rounded-lg bg-bloom-pale px-4 py-3 text-sm">
            {stepBlocked}
          </p>
        )}

        <div className="mt-10 flex items-center gap-4">
          <button
            type="button"
            onClick={isLast ? submit : next}
            disabled={pending}
            className="rounded-full bg-cactus px-7 py-3.5 font-medium text-paper transition-colors hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
          >
            {pending ? 'Gönderiliyor' : isLast ? 'Başvuruyu gönder' : 'Devam et'}
          </button>
          {Object.keys(errors).length > 0 && !stepBlocked && (
            <p className="text-sm text-muted">
              Yukarıda işaretlenen alanları tamamla.
            </p>
          )}
        </div>
      </div>

      <aside className="lg:sticky lg:top-10">
        <ol className="space-y-px overflow-hidden rounded-xl border border-stone/70 bg-paper text-sm">
          {APPLY_STEPS.map((slug, index) => (
            <li
              key={slug}
              className={[
                'px-4 py-3',
                index > 0 ? 'border-t border-stone/60' : '',
                index === stepIndex ? 'bg-cactus-pale/50 font-medium' : '',
                index < stepIndex ? 'text-muted' : index > stepIndex ? 'text-stone' : '',
              ].join(' ')}
            >
              {APPLY_STEP_TITLES[slug]}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Ödeme bilgilerin şifrelenerek saklanır ve yalnızca ödeme kuruluşuna iletilir.
          Öğrenciler hiçbir zaman görmez.
        </p>
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function FieldError({ errors, field }: { errors: Errors; field: string }) {
  const message = errors[field]?.[0];
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 text-sm text-bloom">
      {message}
    </p>
  );
}

type StepProps = {
  form: CoachApplicationInput;
  set: (patch: Partial<CoachApplicationInput>) => void;
  errors: Errors;
};

function CredentialsStep({
  form,
  set,
  errors,
  documents,
  uploadError,
  onUpload,
}: StepProps & {
  documents: Array<{ id: string; filename: string }>;
  uploadError: string | null;
  onUpload: (file: File) => void;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <TextField
            label="Üniversite"
            value={form.university}
            onChange={(v) => set({ university: v ?? '' })}
            placeholder="Boğaziçi Üniversitesi"
          />
          <FieldError errors={errors} field="university" />
        </div>
        <div>
          <TextField
            label="Bölüm"
            value={form.department}
            onChange={(v) => set({ department: v ?? '' })}
            placeholder="Elektrik-Elektronik Mühendisliği"
          />
          <FieldError errors={errors} field="department" />
        </div>
      </div>

      <fieldset>
        <legend className="mb-3 font-medium">Alan</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(TRACK_LABELS) as Array<keyof typeof TRACK_LABELS>).map((track) => (
            <ChoiceRow
              key={track}
              label={TRACK_LABELS[track].full}
              selected={form.yksTrack === track}
              onSelect={() => set({ yksTrack: track, tracks: [track] })}
            />
          ))}
        </div>
        <FieldError errors={errors} field="yksTrack" />
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <NumberField
            label="YKS sıralaman"
            value={form.yksRank || null}
            onChange={(v) => set({ yksRank: v ? Math.round(v) : 0 })}
            placeholder="3100"
          />
          <FieldError errors={errors} field="yksRank" />
        </div>
        <NumberField
          label="Sınav yılı"
          value={form.yksYear}
          onChange={(v) => set({ yksYear: v ? Math.round(v) : new Date().getFullYear() })}
        />
          <FieldError errors={errors} field="yksYear" />
        <NumberField
          label="Mezuniyet yılı"
          hint="İstersen boş bırak"
          value={form.graduationYear ?? null}
          onChange={(v) => set({ graduationYear: v ? Math.round(v) : null })}
        />
      </div>

      {/* The trajectory is the strongest matching signal in the product, so it
          is asked for directly rather than inferred from the ranking alone —
          TYT and AYT separately, same as the student side of onboarding. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="TYT başlangıç netin"
          hint="Hazırlığa başlarken"
          max={120}
          value={form.ownBaselineTytNet ?? null}
          onChange={(v) => set({ ownBaselineTytNet: v })}
          suffix="net"
        />
        <NumberField
          label="TYT sınavdaki netin"
          max={120}
          value={form.ownFinalTytNet ?? null}
          onChange={(v) => set({ ownFinalTytNet: v })}
          suffix="net"
        />
        <NumberField
          label="AYT başlangıç netin"
          hint="Hazırlığa başlarken"
          max={80}
          value={form.ownBaselineAytNet ?? null}
          onChange={(v) => set({ ownBaselineAytNet: v })}
          suffix="net"
        />
        <NumberField
          label="AYT sınavdaki netin"
          max={80}
          value={form.ownFinalAytNet ?? null}
          onChange={(v) => set({ ownFinalAytNet: v })}
          suffix="net"
        />
      </div>

      <ChoiceRow
        multi
        label="Mezun yılında hazırlandım"
        hint="Mezun öğrencilerle eşleşmende belirgin fark yaratıyor"
        selected={Boolean(form.wasMezun)}
        onSelect={() => set({ wasMezun: !form.wasMezun })}
      />

      <div>
        <p className="font-medium">ÖSYM sonuç belgen</p>
        <p className="mt-0.5 text-sm text-muted">
          PDF ya da ekran görüntüsü. Yalnızca inceleme ekibi görür, profilinde yayınlanmaz.
        </p>
        <label className="mt-3 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-stone bg-paper px-5 py-6 text-sm text-muted transition-colors hover:border-cactus hover:text-cactus">
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.target.value = '';
            }}
          />
          Dosya seç (en fazla 8 MB)
        </label>

        {uploadError && (
          <p role="alert" className="mt-2 text-sm text-bloom">
            {uploadError}
          </p>
        )}
        {documents.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-sm">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center gap-2 text-cactus-deep">
                <span aria-hidden>✓</span>
                {doc.filename} yüklendi
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function MethodStep({ form, set, errors }: StepProps) {
  return (
    <>
      <div>
        <TextField
          label="Tek cümlelik tanıtım"
          value={form.headline}
          onChange={(v) => set({ headline: v ?? '' })}
          placeholder="Mezun yılında 60 binden ilk 5 bine çıktım, aynı yolu tarif ediyorum"
        />
        <FieldError errors={errors} field="headline" />
      </div>

      <div>
        <label className="block">
          <span className="font-medium">Koçluk yaklaşımın</span>
          <span className="mt-0.5 block text-sm text-muted">Öğrencilerinle nasıl çalışırsın?</span>
          <textarea
            value={form.bio}
            onChange={(event) => set({ bio: event.target.value })}
            rows={7}
            className="mt-2 w-full resize-none rounded-xl border border-stone bg-paper px-4 py-3 leading-relaxed outline-none focus:border-cactus"
          />
        </label>
        <div className="mt-1.5 flex justify-between text-sm">
          <FieldError errors={errors} field="bio" />
          <span className={form.bio.length < 120 ? 'text-muted' : 'text-cactus'}>
            {form.bio.length} / 120
          </span>
        </div>
      </div>

      <fieldset>
        <legend className="mb-3 font-medium">Hangi alanlarda koçluk yapabilirsin?</legend>
        <p className="mb-3 text-sm text-muted">
          Kendi girdiğin alan zaten işaretlendi. Birden fazla alanda koçluk yapabiliyorsan
          ekleyebilirsin.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(TRACK_LABELS) as Array<keyof typeof TRACK_LABELS>).map((track) => {
            const selected = (form.tracks ?? []).includes(track);
            return (
              <ChoiceRow
                key={track}
                multi
                label={TRACK_LABELS[track].full}
                hint={TRACK_LABELS[track].hint}
                selected={selected}
                onSelect={() =>
                  set({
                    tracks: selected
                      ? (form.tracks ?? []).filter((t) => t !== track)
                      : [...(form.tracks ?? []), track],
                  })
                }
              />
            );
          })}
        </div>
        <FieldError errors={errors} field="tracks" />
      </fieldset>

      <fieldset>
        <legend className="mb-3 font-medium">Çalışma tarzın</legend>
        <div className="grid gap-2">
          {(Object.keys(STYLE_LABELS) as Array<keyof typeof STYLE_LABELS>).map((style) => (
            <ChoiceRow
              key={style}
              multi
              label={STYLE_LABELS[style].short}
              hint={STYLE_LABELS[style].hint}
              selected={(form.styles ?? []).includes(style)}
              onSelect={() =>
                set({
                  styles: (form.styles ?? []).includes(style)
                    ? (form.styles ?? []).filter((s) => s !== style)
                    : [...(form.styles ?? []), style],
                })
              }
            />
          ))}
        </div>
        <FieldError errors={errors} field="styles" />
      </fieldset>

      <fieldset>
        <legend className="mb-3 font-medium">Hangi seviyedeki öğrencilerle çalışırsın?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(GRADE_LABELS) as Array<keyof typeof GRADE_LABELS>).map((grade) => (
            <ChoiceRow
              key={grade}
              multi
              label={GRADE_LABELS[grade].short}
              selected={(form.supportedGrades ?? []).includes(grade)}
              onSelect={() =>
                set({
                  supportedGrades: (form.supportedGrades ?? []).includes(grade)
                    ? (form.supportedGrades ?? []).filter((g) => g !== grade)
                    : [...(form.supportedGrades ?? []), grade],
                })
              }
            />
          ))}
        </div>
        <FieldError errors={errors} field="supportedGrades" />
      </fieldset>

      <div>
        <p className="font-medium">Hedef öğrenci profilin</p>
        <p className="mt-0.5 text-sm text-muted">
          Eşleşmede kullanılır. En iyi olduğun aralığı yaz; her öğrenciye uygunum demek
          eşleşme puanını yükseltmiyor.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Şu anki sıralaması (üst sınır)"
            value={form.targetRankFrom ?? null}
            onChange={(v) => set({ targetRankFrom: v ? Math.round(v) : null })}
            placeholder="60000"
          />
          <NumberField
            label="Ulaştırabileceğin sıralama"
            value={form.targetRankTo ?? null}
            onChange={(v) => set({ targetRankTo: v ? Math.round(v) : null })}
            placeholder="5000"
          />
        </div>
      </div>
    </>
  );
}

function PricingStep({ form, set, errors }: StepProps) {
  const monthlyLira = form.monthlyPriceMinor ? Math.round(form.monthlyPriceMinor / 100) : 0;
  const perSession =
    monthlyLira && form.sessionsPerMonth
      ? Math.round(monthlyLira / (form.sessionsPerMonth || 1))
      : 0;

  return (
    <>
      <div>
        <NumberField
          label="Aylık program ücreti"
          hint="Öğrenciden alınacak toplam tutar"
          value={monthlyLira || null}
          onChange={(v) => set({ monthlyPriceMinor: v ? Math.round(v) * 100 : 0 })}
          suffix="₺ / ay"
          placeholder="4000"
        />
        <FieldError errors={errors} field="monthlyPriceMinor" />
        {perSession > 0 && (
          <p className="mt-2 text-sm text-muted">
            Seans başına yaklaşık {perSession.toLocaleString('tr-TR')} ₺. Kaktüs hizmet payı
            %18; bu tutardan sonra sana kalan aylık{' '}
            <span className="font-medium text-ink">
              {Math.round(monthlyLira * 0.82).toLocaleString('tr-TR')} ₺
            </span>
            .
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Ayda kaç görüşme"
          value={form.sessionsPerMonth}
          onChange={(v) => set({ sessionsPerMonth: v ? Math.round(v) : 4 })}
        />
        <NumberField
          label="Görüşme süresi"
          value={form.minutesPerSession}
          onChange={(v) => set({ minutesPerSession: v ? Math.round(v) : 60 })}
          suffix="dakika"
        />
      </div>

      <NumberField
        label="Tanışma seansı ücreti"
        hint="Boş bırakırsan aylık ücretten hesaplanır"
        value={form.sessionPriceMinor ? Math.round(form.sessionPriceMinor / 100) : null}
        onChange={(v) => set({ sessionPriceMinor: v ? Math.round(v) * 100 : null })}
        suffix="₺ / seans"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <NumberField
            label="Aynı anda kaç öğrenci"
            hint="Kontenjan dolunca profilin listelenmeye devam eder ama uyarı görünür"
            value={form.maxActiveStudents}
            onChange={(v) => set({ maxActiveStudents: v ? Math.round(v) : 8 })}
          />
          <FieldError errors={errors} field="maxActiveStudents" />
        </div>
        <NumberField
          label="Haftalık ayırabileceğin süre"
          value={form.weeklyCapacityHours ?? null}
          onChange={(v) => set({ weeklyCapacityHours: v ? Math.round(v) : null })}
          suffix="saat"
        />
      </div>
    </>
  );
}

function AvailabilityStep({ form, set, errors }: StepProps) {
  const windows = form.availability ?? [];

  const setDay = (weekday: number, patch: { start?: string; end?: string } | null) => {
    const others = windows.filter((w) => w.weekday !== weekday);
    if (!patch) return set({ availability: others });

    const existing = windows.find((w) => w.weekday === weekday);
    const start = timeToMinutes(patch.start ?? minutesToTime(existing?.startMinute ?? 1080));
    const end = timeToMinutes(patch.end ?? minutesToTime(existing?.endMinute ?? 1260));
    if (end <= start) return;
    set({
      availability: [...others, { weekday, startMinute: start, endMinute: end }].sort(
        (a, b) => a.weekday - b.weekday,
      ),
    });
  };

  return (
    <>
      <p className="max-w-[52ch] leading-relaxed text-muted">
        Öğrenciler bu saatlerden seans seçer. Ortak müsaitlik eşleşme puanının %15'i buradan
        geliyor, sonradan değiştirebilirsin.
      </p>

      <div className="space-y-2">
        {WEEKDAY_LABELS.map((label, weekday) => {
          const window = windows.find((w) => w.weekday === weekday);
          const active = Boolean(window);
          return (
            <div
              key={weekday}
              className={[
                'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
                active ? 'border-cactus bg-cactus-pale/50' : 'border-stone bg-paper',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => setDay(weekday, active ? null : {})}
                aria-pressed={active}
                className="flex min-w-28 items-center gap-2.5 text-left font-medium"
              >
                <span
                  aria-hidden
                  className={[
                    'grid size-5 place-items-center rounded-[5px] border',
                    active ? 'border-cactus bg-cactus' : 'border-stone',
                  ].join(' ')}
                >
                  {active && <span className="text-[11px] leading-none text-paper">✓</span>}
                </span>
                {label}
              </button>

              {active && window && (
                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="time"
                    value={minutesToTime(window.startMinute)}
                    onChange={(e) => setDay(weekday, { start: e.target.value })}
                    className="rounded-lg border border-stone bg-paper px-2.5 py-1.5 tabular-nums outline-none focus:border-cactus"
                  />
                  <span className="text-muted">–</span>
                  <input
                    type="time"
                    value={minutesToTime(window.endMinute)}
                    onChange={(e) => setDay(weekday, { end: e.target.value })}
                    className="rounded-lg border border-stone bg-paper px-2.5 py-1.5 tabular-nums outline-none focus:border-cactus"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <FieldError errors={errors} field="availability" />
    </>
  );
}

function PayoutStep({
  form,
  set,
  errors,
  accepted,
  setAccepted,
}: StepProps & { accepted: boolean; setAccepted: (v: boolean) => void }) {
  const personal = form.submerchantType === 'PERSONAL';
  const identityOk = form.identityNumber
    ? personal
      ? isValidTckn(form.identityNumber)
      : isValidVkn(form.identityNumber)
    : null;
  const ibanOk = form.iban.replace(/\s/g, '').length >= 26 ? isValidTrIban(form.iban) : null;

  return (
    <>
      <p className="max-w-[52ch] rounded-xl border border-stone/70 bg-paper px-4 py-3 text-sm leading-relaxed text-muted">
        Bu bilgiler ödeme kuruluşu Iyzico'da alt üye işyeri kaydın için gerekli. Şifrelenerek
        saklanır, öğrencilerle paylaşılmaz ve profilinde görünmez.
      </p>

      <fieldset>
        <legend className="mb-3 font-medium">Kayıt tipin</legend>
        <div className="grid gap-2">
          {Object.entries(SUBMERCHANT_TYPE_LABELS).map(([value, meta]) => (
            <ChoiceRow
              key={value}
              label={meta.label}
              hint={meta.hint}
              selected={form.submerchantType === value}
              onSelect={() => set({ submerchantType: value as never })}
            />
          ))}
        </div>
        <FieldError errors={errors} field="submerchantType" />
      </fieldset>

      <div>
        <TextField
          label={personal ? 'Ad soyad' : 'Şirket unvanı'}
          value={form.legalName}
          onChange={(v) => set({ legalName: v ?? '' })}
        />
        <FieldError errors={errors} field="legalName" />
      </div>

      <div>
        <TextField
          label={personal ? 'TC kimlik numarası' : 'Vergi numarası'}
          hint={personal ? '11 hane' : '10 hane'}
          value={form.identityNumber}
          onChange={(v) => set({ identityNumber: (v ?? '').replace(/\D/g, '') })}
        />
        {identityOk === false && (
          <p className="mt-1.5 text-sm text-bloom">Numara geçersiz görünüyor.</p>
        )}
        {identityOk === true && <p className="mt-1.5 text-sm text-cactus">Numara geçerli.</p>}
        <FieldError errors={errors} field="identityNumber" />
      </div>

      {!personal && (
        <TextField
          label="Vergi dairesi"
          value={form.taxOffice ?? null}
          onChange={(v) => set({ taxOffice: v })}
        />
      )}

      <div>
        <TextField
          label="IBAN"
          hint="Ödemeler bu hesaba aktarılır"
          value={form.iban}
          onChange={(v) => set({ iban: (v ?? '').toUpperCase() })}
          placeholder="TR00 0000 0000 0000 0000 0000 00"
        />
        {ibanOk === false && (
          <p className="mt-1.5 text-sm text-bloom">IBAN doğrulanamadı, tekrar kontrol et.</p>
        )}
        {ibanOk === true && <p className="mt-1.5 text-sm text-cactus">IBAN geçerli.</p>}
        <FieldError errors={errors} field="iban" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <TextField label="Şehir" value={form.city} onChange={(v) => set({ city: v ?? '' })} />
          <FieldError errors={errors} field="city" />
        </div>
        <div>
          <TextField
            label="Telefon"
            value={form.phone}
            onChange={(v) => set({ phone: v ?? '' })}
            placeholder="+90 5xx xxx xx xx"
          />
          <FieldError errors={errors} field="phone" />
        </div>
      </div>

      <div>
        <TextField
          label="Adres"
          value={form.address}
          onChange={(v) => set({ address: v ?? '' })}
        />
        <FieldError errors={errors} field="address" />
      </div>

      <div>
        <ChoiceRow
          multi
          label="Aracı hizmet sözleşmesini okudum ve kabul ediyorum"
          hint="Kaktüs %18 hizmet payı alır; ödemeler dersler tamamlandıkça aktarılır."
          selected={accepted}
          onSelect={() => setAccepted(!accepted)}
        />
        <FieldError errors={errors} field="acceptedTerms" />
      </div>
    </>
  );
}
