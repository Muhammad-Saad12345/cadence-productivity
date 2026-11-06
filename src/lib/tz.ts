// Timezone helpers built on Intl only. All persisted timestamps are UTC (timestamptz);
// everything the user sees or types is wall-clock time in their profile timezone.

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  isoDow: number; // 1=Mon … 7=Sun
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
    dtfCache.set(tz, f);
  }
  return f;
}
const DOW: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function zonedParts(date: Date | string | number, tz: string): ZonedParts {
  const parts = dtf(tz).formatToParts(new Date(date));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    year: +get("year"), month: +get("month"), day: +get("day"),
    hour: +get("hour") % 24, minute: +get("minute"), second: +get("second"),
    isoDow: DOW[get("weekday")],
  };
}

/** Offset (ms) of tz from UTC at the given instant. */
function offsetMs(instant: number, tz: string) {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Wall-clock time in tz → UTC Date. Handles DST gaps/overlaps the same way as Postgres. */
export function zonedToUtc(year: number, month: number, day: number, hour = 0, minute = 0, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const ts1 = guess - offsetMs(guess, tz);
  const ts2 = guess - offsetMs(ts1, tz);
  const p = zonedParts(ts2, tz);
  // Inside a DST gap no wall time matches; like Postgres, fall back to the pre-transition offset.
  return new Date(p.hour === hour && p.minute === minute ? ts2 : ts1);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" for the instant in tz. */
export function dateKey(date: Date | string | number, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
export const todayKey = (tz: string, now: Date = new Date()) => dateKey(now, tz);

export function parseKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}
export function addDaysKey(key: string, n: number): string {
  const { y, m, d } = parseKey(key);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function isoDowOfKey(key: string): number {
  const { y, m, d } = parseKey(key);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}
/** Start of week containing key; weekStartsOn 0=Sun,1=Mon… */
export function startOfWeekKey(key: string, weekStartsOn = 1): string {
  const js = isoDowOfKey(key) % 7; // 0=Sun
  const diff = (js - weekStartsOn + 7) % 7;
  return addDaysKey(key, -diff);
}
export function startOfMonthKey(key: string) {
  return key.slice(0, 8) + "01";
}
export function daysInMonth(key: string) {
  const { y, m } = parseKey(key);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function addMonthsKey(key: string, n: number) {
  const { y, m } = parseKey(key);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
}

/** UTC instant of local midnight starting the day `key` in tz. */
export function startOfDayUtc(key: string, tz: string): Date {
  const { y, m, d } = parseKey(key);
  return zonedToUtc(y, m, d, 0, 0, tz);
}

/** Value for <input type="datetime-local"> */
export function toLocalInput(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const p = zonedParts(iso, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
/** From <input type="datetime-local"> (interpreted in tz) → ISO UTC string. */
export function fromLocalInput(value: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz).toISOString();
}

export function fmtTime(iso: string | Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function fmtDate(iso: string | Date, tz: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts }).format(new Date(iso));
}
export function fmtKey(key: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  const { y, m, d } = parseKey(key);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** "Today 3:00 PM", "Tomorrow 9:00 AM", "Yesterday …", "Mon 17 Nov, 9:00 AM" */
export function fmtWhen(iso: string, tz: string, now: Date = new Date()): string {
  const k = dateKey(iso, tz);
  const today = todayKey(tz, now);
  const time = fmtTime(iso, tz);
  if (k === today) return `Today ${time}`;
  if (k === addDaysKey(today, 1)) return `Tomorrow ${time}`;
  if (k === addDaysKey(today, -1)) return `Yesterday ${time}`;
  const sameYear = k.slice(0, 4) === today.slice(0, 4);
  return `${fmtDate(iso, tz, sameYear ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })}, ${time}`;
}

export function fmtDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function greeting(tz: string, now = new Date()) {
  const h = zonedParts(now, tz).hour;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function listTimezones(): string[] {
  try {
    const v = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (v?.length) return v.includes("UTC") ? v : ["UTC", ...v];
  } catch {
    /* older browsers */
  }
  return ["Asia/Karachi", "UTC", "Asia/Dubai", "Asia/Kolkata", "Europe/London", "America/New_York"];
}
