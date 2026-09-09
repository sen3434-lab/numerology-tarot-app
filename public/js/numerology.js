// Numerology calculation: birth date -> a single card number, for both the
// solar (외적/external) and lunar (내적/internal) reading of a profile.
//
// Free tier: digits are reduced all the way down, capped at 9, matching
// Major Arcana cards 0-9. Paid tier: reduction stops as soon as the value
// is 21 or below, matching the full Major Arcana range 0-21. (0 itself
// only ever surfaces if a future mapping rule folds a specific reduced
// value onto The Fool - left as a hook for ozma to decide, not guessed here.)
export const FREE_MAX = 9;
export const PAID_MAX = 21;

import KoreanLunarCalendar from 'https://esm.sh/korean-lunar-calendar@0.4.0';

function digitSum(numStr) {
  return numStr
    .split('')
    .filter((c) => c >= '0' && c <= '9')
    .reduce((sum, c) => sum + Number(c), 0);
}

function reduceToMax(n, max) {
  let value = n;
  while (value > max) {
    value = digitSum(String(value));
  }
  return value;
}

// birthDate: 'YYYY-MM-DD' (solar). Returns an integer 1..max.
export function getExternalNumber(birthDate, maxAllowed) {
  const sum = digitSum(birthDate);
  return reduceToMax(sum, maxAllowed);
}

// birthDate: 'YYYY-MM-DD' (solar). Converts to the Korean lunar calendar
// date and reduces that instead. Returns null if the date falls outside
// the conversion library's supported range (1391-01-01 ~ 2050-12-31).
export function getInternalNumber(birthDate, maxAllowed) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const calendar = new KoreanLunarCalendar();
  const ok = calendar.setSolarDate(y, m, d);
  if (ok === false) return null;

  const lunar = calendar.getLunarCalendar();
  if (!lunar) return null;

  const lunarStr = `${lunar.year}-${String(lunar.month).padStart(2, '0')}-${String(lunar.day).padStart(2, '0')}`;
  const sum = digitSum(lunarStr);
  return reduceToMax(sum, maxAllowed);
}

// Convenience: both numbers at once, respecting the caller's tier.
export function computeProfileNumbers(birthDate, isPaid) {
  const max = isPaid ? PAID_MAX : FREE_MAX;
  return {
    externalNumber: getExternalNumber(birthDate, max),
    internalNumber: getInternalNumber(birthDate, max),
  };
}
