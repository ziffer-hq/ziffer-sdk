/**
 * The RFC 3339 UTC instant, ported from the engine's ONE parser
 * (`crates/acp-core/src/instant.rs::Timestamp`, WE-5's grammar).
 *
 * Strict, not permissive: exactly `YYYY-MM-DDTHH:MM:SSZ` and nothing else.
 * Offsets, fractional seconds and lowercase `z` are refused rather than
 * normalised -- a permissive decoder silently folding two spellings into one
 * value is the encoding-split defect, and here it would decide when a receipt
 * stops being valid. The day is checked against the ACTUAL month length
 * (2026-02-31 used to parse in the engine and rolled forward to 2026-03-03:
 * two spellings of one instant) and leap seconds are refused because the
 * reference `datetime` refuses them.
 *
 * `fixtures/instant-type-vectors.json` is the engine's shared corpus for this
 * grammar -- the file instant.rs, the Python reference and the schema pattern
 * all answer -- mirrored byte-identically; the test here makes this file its
 * FOURTH consumer, so a spelling that tells any two implementations apart
 * turns something red.
 *
 * This module is a parser only. The engine also renders; a verifier writes no
 * instants, and an unused renderer would be untested surface.
 */

/** Seconds since the Unix epoch for a WE-5 instant, or null when refused. */
export function parseInstant(s: string): number | null {
  if (s.length !== 20) return null;
  if (
    s.charCodeAt(4) !== 0x2d || // -
    s.charCodeAt(7) !== 0x2d || // -
    s.charCodeAt(10) !== 0x54 || // T
    s.charCodeAt(13) !== 0x3a || // :
    s.charCodeAt(16) !== 0x3a || // :
    s.charCodeAt(19) !== 0x5a // Z
  ) {
    return null;
  }
  const n = (from: number, to: number): number | null => {
    let v = 0;
    for (let i = from; i < to; i += 1) {
      const c = s.charCodeAt(i);
      if (c < 0x30 || c > 0x39) return null;
      v = v * 10 + (c - 0x30);
    }
    return v;
  };
  const y = n(0, 4);
  const mo = n(5, 7);
  const d = n(8, 10);
  const h = n(11, 13);
  const mi = n(14, 16);
  const sec = n(17, 19);
  if (y === null || mo === null || d === null || h === null || mi === null || sec === null) {
    return null;
  }
  // sec stops at 59: no leap second, matching the reference's datetime.
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || sec > 59) {
    return null;
  }
  return daysFromCivil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + sec;
}

/**
 * How many days a month actually has. The century rule is the part that gets
 * written wrong: 2000 IS a leap year (divisible by 400), 2100 is not
 * (divisible by 100 but not 400). Both are in the mirrored corpus.
 */
function daysInMonth(y: number, m: number): number {
  switch (m) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
    default:
      return 0;
  }
}

/**
 * Days since 1970-01-01 for a proleptic Gregorian date -- Howard Hinnant's
 * `days_from_civil`, the same algorithm instant.rs uses, so the two cannot
 * disagree on exactly the dates the /100 and /400 rules cover.
 *
 * `Math.trunc` where Rust integer division truncates: `/` alone would carry
 * fractions into every later term.
 */
function daysFromCivil(yIn: number, m: number, d: number): number {
  const y = m <= 2 ? yIn - 1 : yIn;
  const era = Math.trunc((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.trunc((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.trunc(yoe / 4) - Math.trunc(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}
