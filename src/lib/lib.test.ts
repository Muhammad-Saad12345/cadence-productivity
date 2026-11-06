import { describe, expect, it } from "vitest";
import { parseQuickAdd, describeRecurrence } from "./quick-add";
import { addDaysKey, dateKey, fromLocalInput, startOfWeekKey, toLocalInput, zonedToUtc, fmtWhen } from "./tz";

const TZ = "Asia/Karachi";
// Friday 6 Nov 2026, 17:00 in Karachi (12:00 UTC)
const NOW = new Date("2026-11-06T12:00:00Z");
const pkt = (s: string) => new Date(`${s}+05:00`).toISOString();

describe("timezone helpers", () => {
  it("round-trips datetime-local values in the profile timezone", () => {
    expect(fromLocalInput("2026-11-10T09:30", TZ)).toBe(pkt("2026-11-10T09:30:00"));
    expect(toLocalInput(pkt("2026-11-10T09:30:00"), TZ)).toBe("2026-11-10T09:30");
    expect(fromLocalInput("2026-03-08T02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z"); // DST gap
    expect(toLocalInput("2026-07-01T12:00:00Z", "Europe/London")).toBe("2026-07-01T13:00");
  });
  it("computes day keys and week starts", () => {
    expect(dateKey("2026-11-06T20:30:00Z", TZ)).toBe("2026-11-07");
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(startOfWeekKey("2026-11-08", 1)).toBe("2026-11-02"); // Sunday → Monday
    expect(startOfWeekKey("2026-11-08", 0)).toBe("2026-11-08");
    expect(zonedToUtc(2026, 11, 6, 0, 0, TZ).toISOString()).toBe("2026-11-05T19:00:00.000Z");
  });
  it("formats relative days", () => {
    expect(fmtWhen(pkt("2026-11-07T09:00:00"), TZ, NOW)).toBe("Tomorrow 9:00 AM");
    expect(fmtWhen(pkt("2026-11-06T18:15:00"), TZ, NOW)).toBe("Today 6:15 PM");
  });
});

describe("quick add parser", () => {
  it("parses a full sentence", () => {
    const r = parseQuickAdd("Submit DBMS report tomorrow 5pm !high #study #uni @Semester ~45m", TZ, NOW);
    expect(r.title).toBe("Submit DBMS report");
    expect(r.scheduledAt).toBe(pkt("2026-11-07T17:00:00"));
    expect(r.priority).toBe("high");
    expect(r.tags).toEqual(["study", "uni"]);
    expect(r.projectName).toBe("Semester");
    expect(r.estimateMinutes).toBe(45);
  });
  it("handles deadlines, weekdays, dates and relative times", () => {
    expect(parseQuickAdd("Pay rent by 1 dec !critical", TZ, NOW)).toMatchObject({
      title: "Pay rent", dueAt: pkt("2026-12-01T09:00:00"), scheduledAt: null, priority: "critical",
    });
    expect(parseQuickAdd("Gym monday 7:30am", TZ, NOW).scheduledAt).toBe(pkt("2026-11-09T07:30:00"));
    expect(parseQuickAdd("Call Ali in 2h", TZ, NOW).scheduledAt).toBe("2026-11-06T14:00:00.000Z");
    expect(parseQuickAdd("Standup 9:30", TZ, NOW).scheduledAt).toBe(pkt("2026-11-07T09:30:00")); // passed today → tomorrow
    expect(parseQuickAdd("Review jan 15", TZ, NOW).scheduledAt).toBe(pkt("2027-01-15T09:00:00")); // past month → next year
    expect(parseQuickAdd("Plain title", TZ, NOW)).toMatchObject({ title: "Plain title", scheduledAt: null, dueAt: null });
  });
  it("parses recurrence", () => {
    expect(parseQuickAdd("Standup every weekday 9am", TZ, NOW).recurrence).toEqual({ freq: "weekdays" });
    expect(parseQuickAdd("Gym every mon, wed and fri 6pm", TZ, NOW).recurrence).toEqual({ freq: "weekly", byweekday: [1, 3, 5] });
    expect(parseQuickAdd("Water plants every 3 days", TZ, NOW).recurrence).toEqual({ freq: "custom", interval: 3 });
    expect(parseQuickAdd("Rent monthly", TZ, NOW).recurrence).toEqual({ freq: "monthly" });
    expect(describeRecurrence({ freq: "weekly", byweekday: [1, 3] })).toBe("Weekly on Mon, Wed");
  });
});
