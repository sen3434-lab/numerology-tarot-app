// Numerology calculation: birth date -> a single card number, for both the
// solar (외적/external) and lunar (내적/internal) reading of a profile.
//
// A profile's birth_date is entered in ONE calendar (is_lunar says which);
// the other calendar's date is derived via korean-lunar-calendar, not asked
// for separately.
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

function fmtYmd({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// birthDate: 'YYYY-MM-DD' as entered, in whichever calendar isLunar says.
// Returns { solar: {year,month,day}, lunar: {year,month,day,intercalation} }
// or null if the date is invalid / outside the library's supported range
// (1000-01-01 ~ 2050-12-31 lunar, roughly 1000-1000~2050 solar).
function convertDate(birthDate, isLunar, isIntercalation) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const calendar = new KoreanLunarCalendar();
  const ok = isLunar
    ? calendar.setLunarDate(y, m, d, !!isIntercalation)
    : calendar.setSolarDate(y, m, d);
  if (!ok) return null;
  return { solar: calendar.getSolarCalendar(), lunar: calendar.getLunarCalendar() };
}

// Both numbers at once, respecting the caller's tier. profile is
// { birth_date, is_lunar, is_intercalation }. Returns
// { externalNumber, internalNumber } — both null if the date can't be
// converted (outside supported range).
export function computeProfileNumbers(profile, isPaid) {
  const max = isPaid ? PAID_MAX : FREE_MAX;
  const converted = convertDate(profile.birth_date, profile.is_lunar, profile.is_intercalation);
  if (!converted) return { externalNumber: null, internalNumber: null };

  return {
    externalNumber: reduceToMax(digitSum(fmtYmd(converted.solar)), max),
    internalNumber: reduceToMax(digitSum(fmtYmd(converted.lunar)), max),
  };
}

// External (양력) number only — used for the main compatibility reading.
export function computeExternalNumber(profile, isPaid) {
  return computeProfileNumbers(profile, isPaid).externalNumber;
}

// Internal (음력) number only — used for the 속궁합 (intimacy) reading,
// shown only for 본인-연인 pairs.
export function computeInternalNumber(profile, isPaid) {
  return computeProfileNumbers(profile, isPaid).internalNumber;
}
