import { prisma } from '@/lib/db';
import { addDays, dateToDay, dayToDate } from '@/lib/planner/week';
import {
  studyTaskInputSchema,
  type StudyTaskInput,
  type StudyTaskView,
} from '@/lib/planner/task-schema';

/**
 * The weekly study plan a coach and student build together.
 *
 * Tasks belong to the coach–student pair (Conversation), so the plan carries
 * across renewals. Access requires that the pair has had a paid program —
 * the planner is part of what the student is paying for, not something to
 * hand out during negotiation.
 */

export class PlannerError extends Error {
  constructor(
    readonly userMessage: string,
    readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID',
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(userMessage);
    this.name = 'PlannerError';
  }
}

export interface PlannerAccess {
  conversationId: string;
  role: 'COACH' | 'STUDENT';
  userId: string;
  counterpartyName: string;
}

export async function plannerAccess(conversationId: string, userId: string): Promise<PlannerAccess> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      coachProfileId: true,
      studentProfileId: true,
      coach: { select: { userId: true, user: { select: { name: true } } } },
      student: { select: { userId: true, user: { select: { name: true } } } },
    },
  });
  if (!conversation) throw new PlannerError('Program bulunamadı.', 'NOT_FOUND');
  const isCoach = conversation.coach.userId === userId;
  const isStudent = conversation.student.userId === userId;
  if (!isCoach && !isStudent) throw new PlannerError('Program bulunamadı.', 'NOT_FOUND');

  const paid = await prisma.engagement.count({
    where: { coachProfileId: conversation.coachProfileId, studentProfileId: conversation.studentProfileId },
  });
  if (paid === 0) {
    throw new PlannerError('Haftalık program, ödemesi yapılmış bir program başladığında açılır.', 'FORBIDDEN');
  }

  return {
    conversationId,
    role: isCoach ? 'COACH' : 'STUDENT',
    userId,
    counterpartyName: isCoach
      ? (conversation.student.user.name ?? 'Öğrenci')
      : (conversation.coach.user.name ?? 'Koç'),
  };
}

type TaskRow = Awaited<ReturnType<typeof prisma.studyTask.findFirstOrThrow>>;

function toView(task: TaskRow, access: PlannerAccess): StudyTaskView {
  return {
    id: task.id,
    day: dateToDay(task.day),
    examPart: task.examPart,
    subject: task.subject,
    topic: task.topic,
    kind: task.kind,
    resource: task.resource,
    description: task.description,
    quantity: task.quantity,
    unit: task.unit,
    done: Boolean(task.completedAt),
    editable: access.role === 'COACH' || task.createdById === access.userId,
  };
}

export async function listWeek(access: PlannerAccess, monday: string): Promise<StudyTaskView[]> {
  const tasks = await prisma.studyTask.findMany({
    where: {
      conversationId: access.conversationId,
      day: { gte: dayToDate(monday), lte: dayToDate(addDays(monday, 6)) },
    },
    orderBy: [{ day: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
  });
  return tasks.map((task) => toView(task, access));
}

function parse(input: StudyTaskInput) {
  const parsed = studyTaskInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PlannerError(
      'Görevde eksik ya da hatalı alan var.',
      'INVALID',
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
    );
  }
  return parsed.data;
}

export async function addTask(access: PlannerAccess, input: StudyTaskInput): Promise<StudyTaskView> {
  const data = parse(input);
  const position = await prisma.studyTask.count({
    where: { conversationId: access.conversationId, day: dayToDate(data.day) },
  });
  const task = await prisma.studyTask.create({
    data: { ...data, day: dayToDate(data.day), position, conversationId: access.conversationId, createdById: access.userId },
  });
  return toView(task, access);
}

async function loadOwn(access: PlannerAccess, taskId: string) {
  const task = await prisma.studyTask.findUnique({ where: { id: taskId } });
  if (!task || task.conversationId !== access.conversationId) {
    throw new PlannerError('Görev bulunamadı.', 'NOT_FOUND');
  }
  return task;
}

function assertEditable(access: PlannerAccess, task: TaskRow) {
  if (access.role !== 'COACH' && task.createdById !== access.userId) {
    throw new PlannerError('Koçunun eklediği görevleri yalnızca koçun değiştirebilir.', 'FORBIDDEN');
  }
}

export async function updateTask(access: PlannerAccess, taskId: string, input: StudyTaskInput) {
  const task = await loadOwn(access, taskId);
  assertEditable(access, task);
  const data = parse(input);
  const updated = await prisma.studyTask.update({
    where: { id: task.id },
    data: { ...data, day: dayToDate(data.day) },
  });
  return toView(updated, access);
}

export async function deleteTask(access: PlannerAccess, taskId: string) {
  const task = await loadOwn(access, taskId);
  assertEditable(access, task);
  await prisma.studyTask.delete({ where: { id: task.id } });
}

/** Either side can tick a task off — the student does the work, the coach may record it in a call. */
export async function setTaskDone(access: PlannerAccess, taskId: string, done: boolean) {
  const task = await loadOwn(access, taskId);
  const updated = await prisma.studyTask.update({
    where: { id: task.id },
    data: { completedAt: done ? (task.completedAt ?? new Date()) : null },
  });
  return toView(updated, access);
}

/** Copies one week's tasks into the next, unticked — the usual starting point for a new week. */
export async function copyWeekForward(access: PlannerAccess, fromMonday: string): Promise<number> {
  if (access.role !== 'COACH') {
    throw new PlannerError('Haftayı yalnızca koç kopyalayabilir.', 'FORBIDDEN');
  }
  const tasks = await prisma.studyTask.findMany({
    where: {
      conversationId: access.conversationId,
      day: { gte: dayToDate(fromMonday), lte: dayToDate(addDays(fromMonday, 6)) },
    },
  });
  if (tasks.length === 0) return 0;
  await prisma.studyTask.createMany({
    data: tasks.map((t) => ({
      conversationId: t.conversationId,
      day: dayToDate(addDays(dateToDay(t.day), 7)),
      position: t.position,
      examPart: t.examPart,
      subject: t.subject,
      topic: t.topic,
      kind: t.kind,
      resource: t.resource,
      description: t.description,
      quantity: t.quantity,
      unit: t.unit,
      createdById: access.userId,
    })),
  });
  return tasks.length;
}
