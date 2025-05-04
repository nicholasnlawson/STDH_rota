/**
 * Utility for working with English bank holidays
 */

export interface BankHoliday {
  title: string;
  date: string; // ISO format YYYY-MM-DD
}

/**
 * Calculate UK bank holidays for a given year
 * This includes the main public holidays in England:
 * - New Year's Day (or substitute)
 * - Good Friday
 * - Easter Monday
 * - Early May Bank Holiday (first Monday in May)
 * - Spring Bank Holiday (last Monday in May)
 * - Summer Bank Holiday (last Monday in August)
 * - Christmas Day (or substitute)
 * - Boxing Day (or substitute)
 */
export function getEnglishBankHolidays(year: number): BankHoliday[] {
  const holidays: BankHoliday[] = [];
  
  // New Year's Day (or substitute)
  const newYearsDay = new Date(year, 0, 1); // Jan 1
  if (newYearsDay.getDay() === 0) { // If on Sunday
    holidays.push({
      title: "New Year's Day (substitute)",
      date: `${year}-01-02` // Next Monday
    });
  } else if (newYearsDay.getDay() === 6) { // If on Saturday
    holidays.push({
      title: "New Year's Day (substitute)",
      date: `${year}-01-03` // Next Monday
    });
  } else {
    holidays.push({
      title: "New Year's Day",
      date: `${year}-01-${newYearsDay.getDate().toString().padStart(2, '0')}`
    });
  }
  
  // Easter holidays (Good Friday and Easter Monday)
  const easterDates = calculateEasterDates(year);
  holidays.push({
    title: "Good Friday",
    date: easterDates.goodFriday
  });
  holidays.push({
    title: "Easter Monday",
    date: easterDates.easterMonday
  });
  
  // Early May Bank Holiday (first Monday in May)
  holidays.push({
    title: "Early May Bank Holiday",
    date: getFirstMondayOfMonth(year, 4) // May is month 4 (0-indexed)
  });
  
  // Spring Bank Holiday (last Monday in May)
  holidays.push({
    title: "Spring Bank Holiday",
    date: getLastMondayOfMonth(year, 4) // May is month 4 (0-indexed)
  });
  
  // Summer Bank Holiday (last Monday in August)
  holidays.push({
    title: "Summer Bank Holiday",
    date: getLastMondayOfMonth(year, 7) // August is month 7 (0-indexed)
  });
  
  // Christmas Day (or substitute)
  const christmasDay = new Date(year, 11, 25); // Dec 25
  if (christmasDay.getDay() === 0) { // If on Sunday
    holidays.push({
      title: "Christmas Day (substitute)",
      date: `${year}-12-27` // Tuesday after Boxing Day
    });
  } else if (christmasDay.getDay() === 6) { // If on Saturday
    holidays.push({
      title: "Christmas Day (substitute)",
      date: `${year}-12-27` // Monday after Boxing Day
    });
  } else {
    holidays.push({
      title: "Christmas Day",
      date: `${year}-12-25`
    });
  }
  
  // Boxing Day (or substitute)
  const boxingDay = new Date(year, 11, 26); // Dec 26
  if (boxingDay.getDay() === 0) { // If on Sunday
    holidays.push({
      title: "Boxing Day (substitute)",
      date: `${year}-12-28` // Tuesday after Christmas
    });
  } else if (boxingDay.getDay() === 6) { // If on Saturday
    holidays.push({
      title: "Boxing Day (substitute)",
      date: `${year}-12-28` // Monday after Christmas
    });
  } else {
    holidays.push({
      title: "Boxing Day",
      date: `${year}-12-26`
    });
  }
  
  return holidays;
}

/**
 * Get bank holidays for a specific date range
 */
export function getBankHolidaysInRange(startDate: Date, endDate: Date): BankHoliday[] {
  // Get years covered by the date range
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  
  let allHolidays: BankHoliday[] = [];
  
  // Get holidays for each year in the range
  for (let year = startYear; year <= endYear; year++) {
    allHolidays = [...allHolidays, ...getEnglishBankHolidays(year)];
  }
  
  // Filter to only include holidays within the date range
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];
  
  return allHolidays.filter(holiday => {
    return holiday.date >= startStr && holiday.date <= endStr;
  });
}

/**
 * Checks if a specific date is a bank holiday
 */
export function isBankHoliday(date: Date): BankHoliday | null {
  const year = date.getFullYear();
  const holidays = getEnglishBankHolidays(year);
  
  const dateStr = date.toISOString().split('T')[0];
  const holiday = holidays.find(h => h.date === dateStr);
  
  return holiday || null;
}

/**
 * Calculate Easter dates for a specific year
 * Uses the Butcher's algorithm
 */
function calculateEasterDates(year: number): { easterSunday: string, goodFriday: string, easterMonday: string } {
  // Butcher's algorithm
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  
  // Create Easter Sunday date
  const easterSunday = new Date(year, month - 1, day);
  
  // Create Good Friday (Easter Sunday - 2 days)
  const goodFriday = new Date(easterSunday);
  goodFriday.setDate(easterSunday.getDate() - 2);
  
  // Create Easter Monday (Easter Sunday + 1 day)
  const easterMonday = new Date(easterSunday);
  easterMonday.setDate(easterSunday.getDate() + 1);
  
  // Format as ISO dates
  const formatDate = (d: Date) => {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  
  return {
    easterSunday: formatDate(easterSunday),
    goodFriday: formatDate(goodFriday),
    easterMonday: formatDate(easterMonday)
  };
}

/**
 * Get the first Monday of a specific month
 */
function getFirstMondayOfMonth(year: number, month: number): string {
  const date = new Date(year, month, 1);
  
  // Find the first Monday
  while (date.getDay() !== 1) { // 1 is Monday
    date.setDate(date.getDate() + 1);
  }
  
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Get the last Monday of a specific month
 */
function getLastMondayOfMonth(year: number, month: number): string {
  // Start from the last day of the month
  const date = new Date(year, month + 1, 0);
  
  // Find the last Monday
  while (date.getDay() !== 1) { // 1 is Monday
    date.setDate(date.getDate() - 1);
  }
  
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
