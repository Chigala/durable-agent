import { describe, it, expect } from "vitest";
import { parseDuration, formatDuration, isValidDuration } from "./duration.js";

describe("parseDuration", () => {
  it("parses milliseconds", () => {
    expect(parseDuration("100ms")).toBe(100);
    expect(parseDuration("500ms")).toBe(500);
  });

  it("parses seconds", () => {
    expect(parseDuration("1s")).toBe(1000);
    expect(parseDuration("30s")).toBe(30000);
  });

  it("parses minutes", () => {
    expect(parseDuration("1m")).toBe(60000);
    expect(parseDuration("30m")).toBe(1800000);
  });

  it("parses hours", () => {
    expect(parseDuration("1h")).toBe(3600000);
    expect(parseDuration("24h")).toBe(86400000);
  });

  it("parses days", () => {
    expect(parseDuration("1d")).toBe(86400000);
    expect(parseDuration("7d")).toBe(604800000);
  });

  it("parses weeks", () => {
    expect(parseDuration("1w")).toBe(604800000);
    expect(parseDuration("2w")).toBe(1209600000);
  });

  it("parses months", () => {
    expect(parseDuration("1mo")).toBe(2592000000);
  });

  it("parses years", () => {
    expect(parseDuration("1y")).toBe(31536000000);
  });

  it("handles decimal values", () => {
    expect(parseDuration("1.5h")).toBe(5400000);
    expect(parseDuration("0.5d")).toBe(43200000);
  });

  it("is case insensitive", () => {
    expect(parseDuration("1H")).toBe(3600000);
    expect(parseDuration("1D")).toBe(86400000);
  });

  it("trims whitespace", () => {
    expect(parseDuration("  1h  ")).toBe(3600000);
  });

  it("throws on invalid format", () => {
    expect(() => parseDuration("")).toThrow("Invalid duration format");
    expect(() => parseDuration("abc")).toThrow("Invalid duration format");
    expect(() => parseDuration("1")).toThrow("Invalid duration format");
    expect(() => parseDuration("1x")).toThrow("Invalid duration format");
    expect(() => parseDuration("-1h")).toThrow("Invalid duration format");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(100)).toBe("100ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(30000)).toBe("30s");
  });

  it("formats minutes", () => {
    expect(formatDuration(60000)).toBe("1m");
    expect(formatDuration(1800000)).toBe("30m");
  });

  it("formats minutes with remaining seconds", () => {
    expect(formatDuration(90000)).toBe("1m 30s");
  });

  it("formats hours", () => {
    expect(formatDuration(3600000)).toBe("1h");
    expect(formatDuration(7200000)).toBe("2h");
  });

  it("formats hours with remaining minutes", () => {
    expect(formatDuration(5400000)).toBe("1h 30m");
  });

  it("formats days", () => {
    expect(formatDuration(86400000)).toBe("1d");
  });

  it("formats days with remaining hours", () => {
    expect(formatDuration(129600000)).toBe("1d 12h");
  });
});

describe("isValidDuration", () => {
  it("returns true for valid durations", () => {
    expect(isValidDuration("1ms")).toBe(true);
    expect(isValidDuration("1s")).toBe(true);
    expect(isValidDuration("1m")).toBe(true);
    expect(isValidDuration("1h")).toBe(true);
    expect(isValidDuration("1d")).toBe(true);
    expect(isValidDuration("1w")).toBe(true);
    expect(isValidDuration("1mo")).toBe(true);
    expect(isValidDuration("1y")).toBe(true);
    expect(isValidDuration("1.5h")).toBe(true);
  });

  it("returns false for invalid durations", () => {
    expect(isValidDuration("")).toBe(false);
    expect(isValidDuration("abc")).toBe(false);
    expect(isValidDuration("1")).toBe(false);
    expect(isValidDuration("1x")).toBe(false);
    expect(isValidDuration("-1h")).toBe(false);
  });
});
