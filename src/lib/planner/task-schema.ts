import { z } from 'zod';
import { isIsoDate } from './week';

/**
 * A study task as the planner form submits it. Shared by the form (instant
 * feedback) and the server (the check that counts). No node imports.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const studyTaskInputSchema = z
  .object({
    day: z.string().refine(isIsoDate, 'Geçerli bir gün seç'),
    examPart: z.enum(['TYT', 'AYT', 'YDT']).nullable().optional().transform((v) => v ?? null),
    subject: optionalText(60),
    topic: optionalText(120),
    kind: z.enum(['KONU_ANLATIMI', 'SORU_BANKASI', 'BRANS_DENEMESI', 'GENEL_DENEME', 'TEKRAR', 'DIGER']),
    resource: optionalText(160),
    description: optionalText(1000),
    quantity: z.number().int().min(1).max(10_000).nullable().optional().transform((v) => v ?? null),
    unit: z
      .enum(['SORU', 'TEST', 'DAKIKA', 'SAYFA', 'VIDEO'])
      .nullable()
      .optional()
      .transform((v) => v ?? null),
  })
  // A task needs to say *something*: which subject, which resource, or a note.
  .refine((t) => Boolean(t.subject || t.resource || t.description), {
    message: 'Ders, kaynak ya da açıklamadan en az birini yaz',
    path: ['description'],
  })
  .refine((t) => t.quantity == null || t.unit != null, {
    message: 'Miktar için bir birim seç',
    path: ['unit'],
  });

export type StudyTaskInput = z.input<typeof studyTaskInputSchema>;
export type StudyTaskData = z.output<typeof studyTaskInputSchema>;

/** What the planner renders — dates as "YYYY-MM-DD", no Date objects. */
export interface StudyTaskView {
  id: string;
  day: string;
  examPart: 'TYT' | 'AYT' | 'YDT' | null;
  subject: string | null;
  topic: string | null;
  kind: StudyTaskData['kind'];
  resource: string | null;
  description: string | null;
  quantity: number | null;
  unit: StudyTaskData['unit'];
  done: boolean;
  /** Whether the viewer may edit or delete it (coach: any; student: their own). */
  editable: boolean;
}
