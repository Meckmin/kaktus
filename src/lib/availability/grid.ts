/**
 * Shared shape for the coach availability editor.
 *
 * The editor works in whole-hour cells (a 09:00 cell means "bookable 09:00 to
 * 10:00"), because that is the booking granularity everywhere else in the
 * product. On save the cells are merged into contiguous `[startMinute,
 * endMinute)` ranges — one `AvailabilityRule` row per run — so a coach free
 * 09:00–13:00 is one row, not four. On load the ranges are expanded back to
 * cells for the grid.
 */

export const GRID_START_HOUR = 7;
/** Exclusive: the last selectable cell starts at GRID_END_HOUR - 1. */
export const GRID_END_HOUR = 23;

export const GRID_HOURS: number[] = Array.from(
  { length: GRID_END_HOUR - GRID_START_HOUR },
  (_, i) => GRID_START_HOUR + i,
);

export interface Cell {
  /** 0 = Sunday … 6 = Saturday, matching `AvailabilityRule.weekday`. */
  weekday: number;
  /** Local hour, 0–23. */
  hour: number;
}

export interface WeekdayRange {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

const key = (c: Cell) => `${c.weekday}:${c.hour}`;

export function cellKey(weekday: number, hour: number): string {
  return `${weekday}:${hour}`;
}

/** Merge selected hour cells into contiguous per-weekday minute ranges. */
export function cellsToRanges(cells: Cell[]): WeekdayRange[] {
  const byWeekday = new Map<number, number[]>();
  for (const cell of cells) {
    if (cell.hour < GRID_START_HOUR || cell.hour >= GRID_END_HOUR) continue;
    const hours = byWeekday.get(cell.weekday) ?? [];
    if (!hours.includes(cell.hour)) hours.push(cell.hour);
    byWeekday.set(cell.weekday, hours);
  }

  const ranges: WeekdayRange[] = [];
  for (const [weekday, hours] of byWeekday) {
    hours.sort((a, b) => a - b);
    let runStart = hours[0];
    let prev = hours[0];
    for (let i = 1; i <= hours.length; i++) {
      const h = hours[i];
      if (h === prev + 1) {
        prev = h;
        continue;
      }
      ranges.push({ weekday, startMinute: runStart * 60, endMinute: (prev + 1) * 60 });
      runStart = h;
      prev = h;
    }
  }
  return ranges.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
}

/** Expand stored ranges back into the set of selected hour cells. */
export function rangesToCells(
  ranges: Array<{ weekday: number; startMinute: number; endMinute: number }>,
): Set<string> {
  const cells = new Set<string>();
  for (const range of ranges) {
    const from = Math.max(GRID_START_HOUR, Math.floor(range.startMinute / 60));
    const to = Math.min(GRID_END_HOUR, Math.ceil(range.endMinute / 60));
    for (let h = from; h < to; h++) cells.add(cellKey(range.weekday, h));
  }
  return cells;
}

export { key as cellKeyOf };
