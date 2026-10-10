/**
 * Publish-time helpers for the YouTube panel: the schedule the upload skill uses (one
 * batch per day at a fixed evening time) built in the user's own timezone, with the offset
 * written into the ISO string so YouTube schedules the same wall-clock moment.
 */

const pad = (value: number) => String(value).padStart(2, "0");

export function isoWithOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

// "YYYY-MM-DD" for tomorrow in local time — the skill's default: the next evening.
export function tomorrowLocalDate(now: Date = new Date()): string {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
}

// Chapters are spread `perDay` a day from `startDate` at `time`; the first chapter gets
// the first slot, so a 10-a-day plan lands 1–10 on the start date, 11–20 the next, etc.
export function distributeSchedule(
  orders: number[],
  startDate: string,
  time: string,
  perDay: number
): Record<number, string> {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch || perDay < 1) return {};
  const [, year, month, day] = dateMatch.map(Number);
  const [, hour, minute] = timeMatch.map(Number);
  const schedule: Record<number, string> = {};
  [...orders]
    .sort((a, b) => a - b)
    .forEach((order, index) => {
      const date = new Date(year, month - 1, day + Math.floor(index / perDay), hour, minute);
      schedule[order] = isoWithOffset(date);
    });
  return schedule;
}

// ISO (with or without an offset) → the value an <input type="datetime-local"> wants.
export function localInputValue(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isoFromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return isoWithOffset(date);
}

export function formatPublishAt(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}
