import { describe, expect, it } from "vitest";
import { WorkCalendar, DEFAULT_CALENDAR, allowedSubmissionDates, todayInDubai } from "@/lib/calendar";
import { computeDayStatus } from "@/lib/status";
import { normalizeHandle, normalizePostUrl, normalizeProfileUrl } from "@/lib/validation";
import { zonedTimeToUtc } from "@/lib/time";
import { csvCell } from "@/lib/csv";
import { detectColumns } from "@/lib/services/csv-import";

const cal = new WorkCalendar({ ...DEFAULT_CALENDAR, holidays: ["2026-10-14"] });

describe("Asia/Dubai time and the 7 PM cutoff", () => {
  it("7:00 PM Dubai is 15:00 UTC", () => {
    expect(zonedTimeToUtc("2026-10-12", "19:00").toISOString()).toBe("2026-10-12T15:00:00.000Z");
    expect(cal.cutoffAt("2026-10-12").toISOString()).toBe("2026-10-12T15:00:00.000Z");
  });
  it("uses the Dubai calendar date, not UTC", () => {
    // 21:30 UTC on the 11th is 01:30 on the 12th in Dubai.
    expect(todayInDubai(new Date("2026-10-11T21:30:00Z"))).toBe("2026-10-12");
  });
  it("cutoff boundary is inclusive at exactly 7:00 PM", () => {
    expect(cal.isPastCutoff("2026-10-12", new Date("2026-10-12T14:59:59Z"))).toBe(false);
    expect(cal.isPastCutoff("2026-10-12", new Date("2026-10-12T15:00:00Z"))).toBe(true);
  });
});

describe("working days", () => {
  it("skips weekends and holidays", () => {
    expect(cal.isWorkingDay("2026-10-10")).toBe(false); // Saturday
    expect(cal.isWorkingDay("2026-10-14")).toBe(false); // holiday
    expect(cal.previousWorkingDay("2026-10-12")).toBe("2026-10-09"); // Mon -> Fri
    expect(cal.previousWorkingDay("2026-10-15")).toBe("2026-10-13"); // skips holiday
  });
  it("allows today and the previous working day only", () => {
    const at = new Date("2026-10-12T08:00:00Z"); // Monday 12:00 Dubai
    expect(allowedSubmissionDates(cal, at, null)).toEqual({ today: "2026-10-12", previous: "2026-10-09" });
    // On a Saturday only Friday (previous working day) can be backfilled.
    expect(allowedSubmissionDates(cal, new Date("2026-10-10T08:00:00Z"), null)).toEqual({ today: null, previous: "2026-10-09" });
    // Nothing before the tracking start date.
    expect(allowedSubmissionDates(cal, at, "2026-10-12")).toEqual({ today: "2026-10-12", previous: null });
  });
});

describe("daily status rules", () => {
  const cutoffAt = new Date("2026-10-12T15:00:00Z");
  const before = new Date("2026-10-12T10:00:00Z");
  const after = new Date("2026-10-12T15:05:00Z");
  it("no submission before the cutoff is 'awaiting', not flagged", () => {
    expect(computeDayStatus({ record: null, resolved: false, cutoffAt, now: before })).toMatchObject({ status: "awaiting", followUpNeeded: false });
  });
  it("no submission after the cutoff is 'No update' with follow-up, never 'Not posted'", () => {
    const s = computeDayStatus({ record: null, resolved: false, cutoffAt, now: after });
    expect(s.status).toBe("no_update");
    expect(s.status).not.toBe("not_posted");
    expect(s.followUpNeeded).toBe(true);
  });
  it("a late submission keeps the missed-cutoff flag", () => {
    const s = computeDayStatus({ record: { status: "posted", submittedLate: true }, resolved: false, cutoffAt, now: after });
    expect(s).toMatchObject({ status: "posted", late: true, missedCutoff: true, followUpNeeded: false });
  });
  it("admin resolution clears the follow-up flag but keeps missed-cutoff", () => {
    expect(computeDayStatus({ record: null, resolved: true, cutoffAt, now: after })).toMatchObject({
      status: "resolved",
      missedCutoff: true,
      followUpNeeded: false,
    });
  });
});

describe("input validation", () => {
  it("normalises Instagram handles and profile links", () => {
    expect(normalizeHandle("@Demo.Agent_1")).toBe("demo.agent_1");
    expect(normalizeHandle("https://www.instagram.com/demo.agent/")).toBe("demo.agent");
    expect(normalizeHandle("bad handle!")).toBeNull();
    expect(normalizeProfileUrl("instagram.com/Demo.Agent")).toBe("https://www.instagram.com/demo.agent/");
    expect(normalizeProfileUrl("https://evil.example.com/demo")).toBeNull();
  });
  it("accepts only direct Instagram post/reel links", () => {
    expect(normalizePostUrl("https://www.instagram.com/reel/C0dE_123/?igsh=abc")).toBe("https://www.instagram.com/reel/C0dE_123/");
    expect(normalizePostUrl("https://instagram.com/p/ABC123")).toBe("https://www.instagram.com/p/ABC123/");
    expect(normalizePostUrl("https://www.instagram.com/demo.agent/")).toBeNull();
    expect(normalizePostUrl("https://instagram.com.evil.com/p/ABC")).toBeNull();
    expect(normalizePostUrl("javascript:alert(1)")).toBeNull();
  });
  it("neutralises spreadsheet formulas in CSV exports", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("a,b")).toBe('"a,b"');
  });
  it("maps Google Forms columns", () => {
    expect(detectColumns(["Timestamp", "Email Address", "Full Name", "Instagram handle", "Instagram profile link", "Designation"])).toEqual({
      timestamp: 0,
      email: 1,
      name: 2,
      handle: 3,
      url: 4,
      position: 5,
    });
  });
});
