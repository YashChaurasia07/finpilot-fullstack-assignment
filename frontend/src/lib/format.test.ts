import { describe, expect, it } from 'vitest';
import { daysBetween, formatDate, formatINR, formatNumber, formatPct, pnlClass, todayISO, tomorrowISO } from './format';
import { humanize } from './options';

describe('formatINR', () => {
  it('uses Indian digit grouping and two decimals', () => {
    expect(formatINR('263088.49')).toBe('₹2,63,088.49');
    expect(formatINR('15234000.5')).toBe('₹1,52,34,000.50');
    expect(formatINR(0)).toBe('₹0.00');
  });

  it('shows an explicit sign for gains and losses when asked', () => {
    expect(formatINR('27329.10', { signed: true })).toBe('+₹27,329.10');
    expect(formatINR('-2221.18', { signed: true })).toBe('-₹2,221.18');
    expect(formatINR('0.00', { signed: true })).toBe('₹0.00');
  });

  it.each([[null], [undefined], [''], ['abc'], [NaN]])('shows a dash instead of "NaN" for %j', (v) => {
    expect(formatINR(v as never)).toBe('—');
  });
});

describe('numbers and percentages', () => {
  it('formats quantities without trailing zeros noise', () => {
    expect(formatNumber('40.6140')).toBe('40.614');
    expect(formatNumber('1234567.5')).toBe('12,34,567.5');
    expect(formatNumber(null)).toBe('—');
  });
  it('formats percentages with an optional sign', () => {
    expect(formatPct('76.47')).toBe('76.47%');
    expect(formatPct('11.59', { signed: true })).toBe('+11.59%');
    expect(formatPct('-2.28', { signed: true })).toBe('-2.28%');
    expect(formatPct(25)).toBe('25.0%');
    expect(formatPct(null)).toBe('—');
  });
});

describe('dates', () => {
  it('formats a calendar date and never shifts the day, whatever the viewer’s timezone', () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        expect(formatDate('2026-09-18')).toBe('18 Sep 2026');
        expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
        expect(formatDate('2024-02-29')).toBe('29 Feb 2024');
      }
    } finally {
      process.env.TZ = original;
    }
  });

  it.each([[null], [undefined], [''], ['soon'], ['2026-13-45']])('shows a dash for %j', (v) => {
    expect(formatDate(v as never)).toBe('—');
  });

  it('counts whole days between two dates, across month ends and leap days', () => {
    expect(daysBetween('2026-09-18', '2026-10-31')).toBe(43);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-09-18')).toBe(-43);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2); // a DST change in some zones must not skew it
  });

  it('builds local today/tomorrow strings', () => {
    expect(todayISO(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
    expect(tomorrowISO(new Date(2026, 11, 31, 23, 59))).toBe('2027-01-01');
    expect(tomorrowISO(new Date(2028, 1, 28))).toBe('2028-02-29');
  });
});

describe('pnlClass', () => {
  it('is green for gains, red for losses, neutral for zero or unknown', () => {
    expect(pnlClass('1.00')).toContain('emerald');
    expect(pnlClass('-1.00')).toContain('rose');
    expect(pnlClass('0.00')).toContain('slate');
    expect(pnlClass(null)).toContain('slate');
  });
});

describe('humanize', () => {
  it.each([
    ['HOME_PURCHASE', 'Home purchase'],
    ['SETTLED', 'Settled'],
    ['ETF', 'ETF'],
    ['GSEC', 'G-Sec'],
    ['HNI', 'HNI'],
    ['Mass', 'Mass'],
    ['Conservative', 'Conservative'],
  ])('%s -> %s', (input, expected) => expect(humanize(input)).toBe(expected));
});
