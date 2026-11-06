// Natural-language quick add:
//   "Submit DBMS report tomorrow 5pm !high #study @Uni every weekday ~45m"
//   "Pay rent by 1 dec !critical"   "Call Ali in 2h"   "Standup every weekday 9:30am"
import type { Priority, Recurrence } from "./types";
import { addDaysKey, isoDowOfKey, parseKey, todayKey, zonedParts, zonedToUtc } from "./tz";

export interface QuickAddResult {
  title: string;
  scheduledAt: string | null;
  dueAt: string | null;
  priority: Priority | null;
  tags: string[];
  projectName: string | null;
  estimateMinutes: number | null;
  recurrence: Recurrence | null;
  chips: { kind: string; label: string }[];
}

const DAY_NAMES: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const PRIO: Record<string, Priority> = {
  critical: "critical", crit: "critical", c: "critical", p1: "critical", urgent: "critical",
  high: "high", h: "high", p2: "high", medium: "medium", med: "medium", m: "medium", p3: "medium",
  low: "low", l: "low", p4: "low",
};
const DAY_RE = Object.keys(DAY_NAMES).sort((a, b) => b.length - a.length).join("|");
const MON_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const TIME_RE = String.raw`(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm)|([01]?\d|2[0-3]):([0-5]\d)|noon|midnight)`;

function parseTime(m: string): { h: number; mi: number } | null {
  const s = m.trim().toLowerCase();
  if (s === "noon") return { h: 12, mi: 0 };
  if (s === "midnight") return { h: 0, mi: 0 };
  let r = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(s);
  if (r) {
    let h = +r[1] % 12;
    if (r[3] === "pm") h += 12;
    return { h, mi: r[2] ? +r[2] : 0 };
  }
  r = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (r) return { h: +r[1], mi: +r[2] };
  return null;
}

export function parseQuickAdd(input: string, tz: string, now: Date = new Date()): QuickAddResult {
  let s = ` ${input.trim()} `;
  const chips: QuickAddResult["chips"] = [];
  const res: QuickAddResult = {
    title: "", scheduledAt: null, dueAt: null, priority: null, tags: [], projectName: null,
    estimateMinutes: null, recurrence: null, chips,
  };
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const m = re.exec(s);
    if (m) {
      fn(m);
      s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
    }
    return !!m;
  };

  // Priority
  take(/\s!(critical|crit|urgent|high|medium|med|low|p[1-4]|[chml])(?=\s)/i, (m) => {
    res.priority = PRIO[m[1].toLowerCase()];
    chips.push({ kind: "priority", label: res.priority });
  });
  // Tags (#tag), project (@Project Name-ish single token)
  while (take(/\s#([\p{L}\p{N}_-]{1,40})(?=\s)/u, (m) => res.tags.push(m[1].toLowerCase()))) { /* collect */ }
  res.tags.forEach((t) => chips.push({ kind: "tag", label: `#${t}` }));
  take(/\s@([\p{L}\p{N}_-]{1,60})(?=\s)/u, (m) => {
    res.projectName = m[1].replace(/[_-]/g, " ");
    chips.push({ kind: "project", label: res.projectName });
  });
  // Estimate: ~45m, ~1h30m, for 2h
  take(/\s(?:~|for\s+)(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?(?=\s)/i, (m) => {
    const mins = (m[1] ? +m[1] * 60 : 0) + (m[2] ? +m[2] : 0);
    if (mins > 0) {
      res.estimateMinutes = mins;
      chips.push({ kind: "estimate", label: `~${mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`}` });
    }
  });

  // Recurrence
  const recurrence = (r: Recurrence, label: string) => {
    res.recurrence = r;
    chips.push({ kind: "repeat", label });
  };
  [
    () => take(/\s(?:every\s+weekday|weekdays|every\s+work\s*day)(?=\s)/i, () => recurrence({ freq: "weekdays" }, "Every weekday")),
    () => take(new RegExp(String.raw`\severy\s+((?:${DAY_RE})(?:\s*(?:,|and|&)\s*(?:${DAY_RE}))*)(?=\s)`, "i"), (m) => {
      const days = [...new Set(m[1].toLowerCase().split(/\s*(?:,|and|&)\s*/).map((d) => DAY_NAMES[d.trim()]))].sort();
      recurrence({ freq: "weekly", byweekday: days }, `Every ${m[1]}`);
    }),
    () => take(/\severy\s+(\d+)\s+days?(?=\s)/i, (m) => recurrence({ freq: "custom", interval: +m[1] }, `Every ${m[1]} days`)),
    () => take(/\s(?:every\s+day|daily)(?=\s)/i, () => recurrence({ freq: "daily" }, "Daily")),
    () => take(/\s(?:every\s+week|weekly)(?=\s)/i, () => recurrence({ freq: "weekly" }, "Weekly")),
    () => take(/\s(?:every\s+month|monthly)(?=\s)/i, () => recurrence({ freq: "monthly" }, "Monthly")),
  ].some((f) => f());

  // Date & time
  const today = todayKey(tz, now);
  let isDeadline = false;
  let day: string | null = null;
  let time: { h: number; mi: number } | null = null;
  let instant: Date | null = null;

  take(/\s(?:by|due)(?=\s)/i, () => (isDeadline = true));

  take(/\sin\s+(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)(?=\s)/i, (m) => {
    const n = +m[1];
    const unit = m[2].toLowerCase()[0];
    if (unit === "d") day = addDaysKey(today, n);
    else instant = new Date(now.getTime() + n * (unit === "h" ? 3600_000 : 60_000));
  });
  if (!instant) {
    [
      () => take(/\s(today|tonight|tomorrow|tmrw|tmr)(?=\s)/i, (m) => {
        const w = m[1].toLowerCase();
        day = w === "today" || w === "tonight" ? today : addDaysKey(today, 1);
        if (w === "tonight") time = { h: 20, mi: 0 };
      }),
      () => take(new RegExp(String.raw`\s(?:next\s+|on\s+)?(${DAY_RE})(?=\s)`, "i"), (m) => {
        const want = DAY_NAMES[m[1].toLowerCase()];
        const cur = isoDowOfKey(today);
        let diff = (want - cur + 7) % 7;
        if (diff === 0) diff = 7;
        day = addDaysKey(today, diff);
      }),
      () => take(new RegExp(String.raw`\s(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(${MON_RE})(?:\s+(\d{4}))?(?=\s)`, "i"), (m) => {
        day = pickYear(+m[1], MONTHS[m[2].toLowerCase()], m[3] ? +m[3] : null, today);
      }),
      () => take(new RegExp(String.raw`\s(?:on\s+)?(${MON_RE})\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?=\s)`, "i"), (m) => {
        day = pickYear(+m[2], MONTHS[m[1].toLowerCase()], m[3] ? +m[3] : null, today);
      }),
      () => take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/, (m) => {
        day = `${m[1]}-${m[2]}-${m[3]}`;
      }),
    ].some((f) => f());

    take(new RegExp(String.raw`\s(?:at\s+|@)?${TIME_RE}(?=\s)`, "i"), (m) => {
      time = parseTime(m[0].replace(/^\s*(at\s+|@)?/i, ""));
    });
  }

  if (!instant && (day || time)) {
    let k = (day ?? today) as string;
    const t = (time ?? { h: 9, mi: 0 }) as { h: number; mi: number };
    if (!day && time) {
      // bare time already passed today → tomorrow
      const p = zonedParts(now, tz);
      if (t.h * 60 + t.mi <= p.hour * 60 + p.minute) k = addDaysKey(today, 1);
    }
    const { y, m, d } = parseKey(k);
    instant = zonedToUtc(y, m, d, t.h, t.mi, tz);
  }
  if (instant) {
    const iso = (instant as Date).toISOString();
    if (isDeadline) res.dueAt = iso;
    else res.scheduledAt = iso;
    chips.push({ kind: isDeadline ? "due" : "when", label: iso });
  }

  res.title = s.replace(/\s+/g, " ").trim();
  return res;
}

function pickYear(d: number, m: number, y: number | null, today: string): string {
  const { y: ty } = parseKey(today);
  const pad = (n: number) => String(n).padStart(2, "0");
  let key = `${y ?? ty}-${pad(m)}-${pad(d)}`;
  if (!y && key < today) key = `${ty + 1}-${pad(m)}-${pad(d)}`;
  return key;
}

export function describeRecurrence(r: Recurrence | null | undefined): string | null {
  if (!r) return null;
  const n = r.interval && r.interval > 1 ? r.interval : 1;
  const names = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  switch (r.freq) {
    case "daily": return n > 1 ? `Every ${n} days` : "Daily";
    case "weekdays": return "Weekdays";
    case "weekly": return r.byweekday?.length ? `Weekly on ${r.byweekday.map((d) => names[d]).join(", ")}` : n > 1 ? `Every ${n} weeks` : "Weekly";
    case "monthly": return n > 1 ? `Every ${n} months` : "Monthly";
    case "custom": return r.byweekday?.length ? `On ${r.byweekday.map((d) => names[d]).join(", ")}` : `Every ${n} days`;
  }
}
