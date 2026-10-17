// Time zone helpers. Instants are unix seconds; wall-clock values belong to the place's time zone (IANA name from
// Open-Meteo), never the server's or the browser's.

export type WallParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string) {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric", weekday: "short",
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function wallParts(t: number, tz: string): WallParts & { second: number } {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(t * 1000))) p[type] = value;
  return {
    year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second,
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

// offset of the zone from UTC at instant t, in seconds
function offsetAt(t: number, tz: string) {
  const p = wallParts(t, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - t;
}

// wall-clock time in tz -> instant; for times skipped by DST this lands an hour later, like most libraries
export function zonedToInstant(year: number, month: number, day: number, hour: number, minute: number, tz: string) {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  let t = asUtc - offsetAt(asUtc, tz);
  t = asUtc - offsetAt(t, tz);
  return t;
}

// "YYYY-MM-DDTHH:mm" (also accepts a space) as local time in tz
export function parseLocal(s: string, tz: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return zonedToInstant(y, mo, d, h, mi, tz);
}

export function toLocalInput(t: number, tz: string) {
  const p = wallParts(t, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function startOfLocalDay(t: number, tz: string) {
  const p = wallParts(t, tz);
  return zonedToInstant(p.year, p.month, p.day, 0, 0, tz);
}

export function localDateKey(t: number, tz: string) {
  const p = wallParts(t, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export const pad = (n: number) => String(n).padStart(2, "0");

// "Sat 17 Oct 20:00"
export function fmtDayTime(t: number, tz: string) {
  const p = wallParts(t, tz);
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} ${pad(p.hour)}:${pad(p.minute)}`;
}

// "Sat 17 Oct"
export function fmtDay(t: number, tz: string) {
  const p = wallParts(t, tz);
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}`;
}

export function fmtWeekday(t: number, tz: string) {
  return WEEKDAYS[wallParts(t, tz).weekday];
}

export function fmtTime(t: number, tz: string) {
  const p = wallParts(t, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
