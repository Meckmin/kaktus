'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import {
  CURRICULUM,
  TASK_KIND_LABELS,
  TASK_UNIT_LABELS,
  type ExamPartCode,
  type TaskKindCode,
  type TaskUnitCode,
} from '@/lib/planner/curriculum';
import { addDays, dayLabel, istanbulToday, mondayOf, weekDays } from '@/lib/planner/week';
import { studyTaskInputSchema, type StudyTaskInput, type StudyTaskView } from '@/lib/planner/task-schema';
import {
  addStudyTask,
  copyPlannerWeek,
  editStudyTask,
  loadPlannerWeek,
  markStudyTask,
  removeStudyTask,
} from '@/server/actions/planner';

/**
 * The weekly study plan. Days across, tasks down; either side can add, the
 * student ticks things off. In a meeting (`live`) it re-fetches every few
 * seconds so both people see the same plan as it's being built, and switches
 * to one day at a time to fit beside the video.
 */

const KIND_STYLES: Record<TaskKindCode, string> = {
  KONU_ANLATIMI: 'bg-cactus-pale text-cactus-deep',
  SORU_BANKASI: 'bg-dust/25 text-ink',
  BRANS_DENEMESI: 'bg-bloom-pale text-bloom',
  GENEL_DENEME: 'bg-bloom text-paper',
  TEKRAR: 'bg-limestone text-ink',
  DIGER: 'bg-stone/40 text-ink',
};

const LIVE_REFRESH_MS = 5_000;

type Editing = { day: string; task?: StudyTaskView } | null;

export function WeeklyPlanner({
  conversationId,
  role,
  initialMonday,
  initialTasks,
  live = false,
}: {
  conversationId: string;
  role: 'COACH' | 'STUDENT';
  initialMonday: string;
  initialTasks: StudyTaskView[];
  live?: boolean;
}) {
  const [monday, setMonday] = useState(initialMonday);
  const [tasks, setTasks] = useState(initialTasks);
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const today = istanbulToday();
  const days = weekDays(monday);
  const [focusDay, setFocusDay] = useState(() => (days.includes(today) ? today : monday));

  const refresh = useCallback(
    async (week: string) => {
      const result = await loadPlannerWeek(conversationId, week);
      if (result.ok) setTasks(result.data);
      else setError(result.message);
    },
    [conversationId],
  );

  const goTo = (week: string) => {
    setError(null);
    setEditing(null);
    setMonday(week);
    setFocusDay(weekDays(week).includes(today) ? today : week);
    if (!live) {
      const url = new URL(window.location.href);
      url.searchParams.set('hafta', week);
      window.history.replaceState(null, '', url);
    }
    startTransition(() => refresh(week));
  };

  // During a call both sides edit the same week; poll so each sees the other.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (!editing) void refresh(monday);
    }, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, monday, editing, refresh]);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.message ?? 'İşlem tamamlanamadı.');
        return;
      }
      after?.();
      await refresh(monday);
    });
  };

  const summary = useMemo(() => {
    const done = tasks.filter((t) => t.done).length;
    const questions = tasks.filter((t) => t.unit === 'SORU').reduce((n, t) => n + (t.quantity ?? 0), 0);
    const minutes = tasks.filter((t) => t.unit === 'DAKIKA').reduce((n, t) => n + (t.quantity ?? 0), 0);
    return { total: tasks.length, done, questions, minutes };
  }, [tasks]);

  // In a call only the focused day renders; in the week grid every day does,
  // but below md the others are hidden behind the day tabs.
  const visibleDays = live ? [focusDay] : days;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 text-sm">
          <button type="button" onClick={() => goTo(addDays(monday, -7))} className="rounded-full px-3 py-1.5 hover:bg-limestone">
            ← Önceki
          </button>
          <button
            type="button"
            onClick={() => goTo(mondayOf(today))}
            className="rounded-full px-3 py-1.5 font-medium hover:bg-limestone"
          >
            {dayLabel(monday).date} – {dayLabel(addDays(monday, 6)).date}
          </button>
          <button type="button" onClick={() => goTo(addDays(monday, 7))} className="rounded-full px-3 py-1.5 hover:bg-limestone">
            Sonraki →
          </button>
        </div>
        <p className="text-sm text-muted tabular-nums">
          {summary.done}/{summary.total} görev
          {summary.questions > 0 && ` · ${summary.questions.toLocaleString('tr-TR')} soru`}
          {summary.minutes > 0 && ` · ${summary.minutes.toLocaleString('tr-TR')} dk`}
        </p>
      </div>

      {role === 'COACH' && !live && summary.total > 0 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => copyPlannerWeek(conversationId, monday), () => goTo(addDays(monday, 7)))}
          className="mt-2 text-sm text-cactus hover:text-cactus-deep"
        >
          Bu haftayı sonraki haftaya kopyala
        </button>
      )}

      {/* Day tabs: always in a call, and on phones, where seven stacked days
          would bury today under a long scroll. */}
      <div className={['mt-3 flex gap-1 overflow-x-auto', live ? '' : 'md:hidden'].join(' ')}>
        {days.map((day) => {
          const label = dayLabel(day);
          const count = tasks.filter((t) => t.day === day).length;
          return (
            <button
              key={day}
              type="button"
              onClick={() => {
                setFocusDay(day);
                setEditing(null);
              }}
              className={[
                'shrink-0 rounded-lg px-2.5 py-1.5 text-xs',
                day === focusDay
                  ? 'bg-cactus text-paper'
                  : day === today
                    ? 'bg-cactus-pale text-ink'
                    : 'bg-limestone text-ink hover:bg-stone/40',
              ].join(' ')}
            >
              {label.short} {count > 0 && <span className="tabular-nums">· {count}</span>}
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-bloom-pale px-4 py-2.5 text-sm">
          {error}
        </p>
      )}

      <div className={live ? 'mt-3' : 'mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-7'}>
        {visibleDays.map((day) => {
          const label = dayLabel(day);
          const dayTasks = tasks.filter((t) => t.day === day);
          return (
            <div
              key={day}
              className={[
                'min-h-40 flex-col rounded-xl border p-3',
                live || day === focusDay ? 'flex' : 'hidden md:flex',
                day === today ? 'border-cactus/60 bg-cactus-pale/30' : 'border-stone/70 bg-paper',
              ].join(' ')}
            >
              <p className="text-sm">
                <span className="font-medium">{label.weekday}</span>{' '}
                <span className="text-muted">{label.date}</span>
              </p>

              <ul className="mt-2 flex-1 space-y-2">
                {dayTasks.map((task) =>
                  live && editing?.task?.id === task.id ? (
                    <li key={task.id}>
                      <TaskForm
                        day={day}
                        initial={task}
                        pending={pending}
                        onCancel={() => setEditing(null)}
                        onSubmit={(input) =>
                          run(() => editStudyTask(conversationId, task.id, input), () => setEditing(null))
                        }
                      />
                    </li>
                  ) : (
                    <TaskCard
                      key={task.id}
                      task={task}
                      showAuthor={role === 'COACH'}
                      pending={pending}
                      onToggle={() => run(() => markStudyTask(conversationId, task.id, !task.done))}
                      onEdit={() => setEditing({ day, task })}
                      onDelete={() => run(() => removeStudyTask(conversationId, task.id))}
                    />
                  ),
                )}
              </ul>

              {live && editing && !editing.task && editing.day === day ? (
                <TaskForm
                  day={day}
                  pending={pending}
                  onCancel={() => setEditing(null)}
                  onSubmit={(input) => run(() => addStudyTask(conversationId, input), () => setEditing(null))}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing({ day })}
                  className="mt-2 rounded-lg border border-dashed border-stone px-2 py-1.5 text-sm text-muted hover:border-cactus hover:text-cactus"
                >
                  + Görev ekle
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* In the week grid a day column is too narrow for the form, so it opens
          as a dialog; in a call (one day at a time) it stays inline. */}
      {!live && editing && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6"
          onClick={(event) => event.target === event.currentTarget && setEditing(null)}
        >
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-t-2xl bg-paper p-5 shadow-xl sm:rounded-2xl">
            <h2 className="font-display text-lg font-semibold">
              {editing.task ? 'Görevi düzenle' : 'Görev ekle'}
              <span className="ml-2 text-sm font-normal text-muted">
                {dayLabel(editing.day).weekday} {dayLabel(editing.day).date}
              </span>
            </h2>
            <TaskForm
              day={editing.day}
              initial={editing.task}
              pending={pending}
              onCancel={() => setEditing(null)}
              onSubmit={(input) =>
                run(
                  () =>
                    editing.task
                      ? editStudyTask(conversationId, editing.task.id, input)
                      : addStudyTask(conversationId, input),
                  () => setEditing(null),
                )
              }
            />
          </div>
        </div>
      )}
    </section>
  );
}

function TaskCard({
  task,
  showAuthor,
  pending,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: StudyTaskView;
  showAuthor: boolean;
  pending: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const heading = [task.examPart, task.subject].filter(Boolean).join(' ');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <li className={['rounded-lg border border-stone/60 bg-paper p-2.5 text-sm', task.done ? 'opacity-60' : ''].join(' ')}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={task.done}
          disabled={pending}
          onChange={onToggle}
          aria-label="Yapıldı"
          className="mt-0.5 size-4 shrink-0 accent-cactus"
        />
        <div className="min-w-0 flex-1">
          <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_STYLES[task.kind]}`}>
            {TASK_KIND_LABELS[task.kind]}
          </span>
          {showAuthor && task.addedByStudent && <span className="ml-1.5 text-[11px] text-muted">Öğrenci ekledi</span>}
          {heading && <p className={`mt-1 font-medium ${task.done ? 'line-through' : ''}`}>{heading}</p>}
          {task.topic && <p className="text-muted">{task.topic}</p>}
          {task.resource && <p className="text-muted">{task.resource}</p>}
          {task.quantity != null && task.unit && (
            <p className="tabular-nums">
              {task.quantity.toLocaleString('tr-TR')} {TASK_UNIT_LABELS[task.unit]}
            </p>
          )}
          {task.description && <p className="mt-1 whitespace-pre-line text-muted">{task.description}</p>}
          {task.editable && (
            <div className="mt-1.5 flex gap-3 text-xs">
              {confirmingDelete ? (
                <>
                  <button type="button" disabled={pending} onClick={onDelete} className="font-medium text-bloom">
                    Evet, sil
                  </button>
                  <button type="button" onClick={() => setConfirmingDelete(false)} className="text-muted hover:text-ink">
                    Vazgeç
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={onEdit} className="text-muted hover:text-cactus">
                    Düzenle
                  </button>
                  <button type="button" onClick={() => setConfirmingDelete(true)} className="text-muted hover:text-bloom">
                    Sil
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

const OTHER_TOPIC = '__diger__';

function TaskForm({
  day,
  initial,
  pending,
  onCancel,
  onSubmit,
}: {
  day: string;
  initial?: StudyTaskView;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: StudyTaskInput) => void;
}) {
  const [examPart, setExamPart] = useState<ExamPartCode | null>(initial?.examPart ?? 'TYT');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [topic, setTopic] = useState(initial?.topic ?? '');
  const [kind, setKind] = useState<TaskKindCode>(initial?.kind ?? 'SORU_BANKASI');
  const [resource, setResource] = useState(initial?.resource ?? '');
  const [quantity, setQuantity] = useState(initial?.quantity ? String(initial.quantity) : '');
  const [unit, setUnit] = useState<TaskUnitCode | ''>(initial?.unit ?? 'SORU');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const subjects = examPart ? CURRICULUM[examPart] : [];
  const topics = subjects.find((s) => s.name === subject)?.topics ?? [];
  const topicIsListed = topics.includes(topic);
  const [customTopic, setCustomTopic] = useState(Boolean(topic) && !topicIsListed);

  const submit = () => {
    const input: StudyTaskInput = {
      day,
      examPart,
      subject: subject || null,
      topic: topic || null,
      kind,
      resource: resource || null,
      description: description || null,
      quantity: quantity ? Number.parseInt(quantity, 10) : null,
      unit: quantity ? (unit || null) : null,
    };
    const parsed = studyTaskInputSchema.safeParse(input);
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setErrors(Object.fromEntries(Object.entries(flat).map(([k, v]) => [k, v?.[0]])));
      return;
    }
    onSubmit(input);
  };

  const field = 'w-full rounded-lg border border-stone bg-limestone px-2 py-1.5 text-sm outline-none focus:border-cactus';

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-cactus/40 bg-paper p-2.5">
      <div className="flex gap-1">
        {(['TYT', 'AYT', 'YDT'] as const).map((part) => (
          <button
            key={part}
            type="button"
            onClick={() => {
              setExamPart(part);
              setSubject('');
              setTopic('');
              setCustomTopic(false);
            }}
            className={[
              'flex-1 rounded-md py-1 text-xs font-medium',
              examPart === part ? 'bg-cactus text-paper' : 'bg-limestone text-ink',
            ].join(' ')}
          >
            {part}
          </button>
        ))}
      </div>

      <select
        value={subject}
        onChange={(event) => {
          setSubject(event.target.value);
          setTopic('');
          setCustomTopic(false);
        }}
        className={field}
        aria-label="Ders"
      >
        <option value="">Ders seç</option>
        {subjects.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>

      {subject && !customTopic && topics.length > 0 ? (
        <select
          value={topicIsListed ? topic : ''}
          onChange={(event) => {
            if (event.target.value === OTHER_TOPIC) {
              setCustomTopic(true);
              setTopic('');
            } else setTopic(event.target.value);
          }}
          className={field}
          aria-label="Konu"
        >
          <option value="">Konu (isteğe bağlı)</option>
          {topics.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value={OTHER_TOPIC}>Başka bir konu yaz…</option>
        </select>
      ) : (
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="Konu (isteğe bağlı)"
          className={field}
          aria-label="Konu"
        />
      )}

      <select value={kind} onChange={(event) => setKind(event.target.value as TaskKindCode)} className={field} aria-label="Tür">
        {Object.entries(TASK_KIND_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <input
        value={resource}
        onChange={(event) => setResource(event.target.value)}
        placeholder="Kaynak: kitap, playlist… (isteğe bağlı)"
        className={field}
        aria-label="Kaynak"
      />

      <div className="flex gap-2">
        <input
          value={quantity}
          onChange={(event) => setQuantity(event.target.value.replace(/\D/g, '').slice(0, 5))}
          inputMode="numeric"
          placeholder="Miktar"
          className={`${field} w-24`}
          aria-label="Miktar"
        />
        <select value={unit} onChange={(event) => setUnit(event.target.value as TaskUnitCode)} className={field} aria-label="Birim">
          {Object.entries(TASK_UNIT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {errors.unit && <p className="text-xs text-bloom">{errors.unit}</p>}

      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value.slice(0, 1000))}
        rows={2}
        placeholder="Açıklama: “Türev 1–4. testler, yanlışları işaretle”"
        className={`${field} resize-none`}
        aria-label="Açıklama"
      />
      {errors.description && <p className="text-xs text-bloom">{errors.description}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-full bg-cactus px-3 py-1.5 text-xs font-medium text-paper hover:bg-cactus-deep disabled:bg-stone"
        >
          {initial ? 'Kaydet' : 'Ekle'}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-muted hover:text-cactus">
          Vazgeç
        </button>
      </div>
    </div>
  );
}
