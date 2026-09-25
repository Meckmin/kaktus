'use server';

import { auth } from '@/lib/auth';
import { isIsoDate, mondayOf } from '@/lib/planner/week';
import type { StudyTaskInput, StudyTaskView } from '@/lib/planner/task-schema';
import {
  PlannerError,
  addTask,
  copyWeekForward,
  deleteTask,
  listWeek,
  plannerAccess,
  setTaskDone,
  updateTask,
} from '@/server/services/planner-service';

/** Planner server actions: authenticate, check access, translate errors. */

export type PlannerResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

async function access(conversationId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new PlannerError('Önce giriş yapman gerekiyor.', 'FORBIDDEN');
  return plannerAccess(conversationId, session.user.id);
}

function failure(error: unknown): { ok: false; message: string; fieldErrors?: Record<string, string[]> } {
  if (error instanceof PlannerError) {
    return { ok: false, message: error.userMessage, fieldErrors: error.fieldErrors };
  }
  console.error('[planner]', error);
  return { ok: false, message: 'İşlem tamamlanamadı.' };
}

/** Used by the planner's live refresh during a call. */
export async function loadPlannerWeek(
  conversationId: string,
  day: string,
): Promise<PlannerResult<StudyTaskView[]>> {
  if (!isIsoDate(day)) return { ok: false, message: 'Geçersiz hafta.' };
  try {
    return { ok: true, data: await listWeek(await access(conversationId), mondayOf(day)) };
  } catch (error) {
    return failure(error);
  }
}

export async function addStudyTask(
  conversationId: string,
  input: StudyTaskInput,
): Promise<PlannerResult<StudyTaskView>> {
  try {
    return { ok: true, data: await addTask(await access(conversationId), input) };
  } catch (error) {
    return failure(error);
  }
}

export async function editStudyTask(
  conversationId: string,
  taskId: string,
  input: StudyTaskInput,
): Promise<PlannerResult<StudyTaskView>> {
  try {
    return { ok: true, data: await updateTask(await access(conversationId), taskId, input) };
  } catch (error) {
    return failure(error);
  }
}

export async function removeStudyTask(conversationId: string, taskId: string): Promise<PlannerResult> {
  try {
    await deleteTask(await access(conversationId), taskId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function markStudyTask(
  conversationId: string,
  taskId: string,
  done: boolean,
): Promise<PlannerResult<StudyTaskView>> {
  try {
    return { ok: true, data: await setTaskDone(await access(conversationId), taskId, done) };
  } catch (error) {
    return failure(error);
  }
}

export async function copyPlannerWeek(conversationId: string, day: string): Promise<PlannerResult<number>> {
  if (!isIsoDate(day)) return { ok: false, message: 'Geçersiz hafta.' };
  try {
    return { ok: true, data: await copyWeekForward(await access(conversationId), mondayOf(day)) };
  } catch (error) {
    return failure(error);
  }
}
