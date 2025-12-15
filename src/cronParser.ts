/**
 * Full-featured cron expression parser supporting standard 5-field syntax
 */

export interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
  isLastDayOfMonth: boolean;
}

const MONTH_NAMES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const WEEKDAY_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

/**
 * Parse a cron expression into structured fields
 */
export function parseCronExpression(expression: string): CronFields {
  const trimmed = expression.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression: "${expression}". Expected 5 fields (minute hour day month weekday), got ${parts.length}`,
    );
  }

  const [minutePart, hourPart, dayPart, monthPart, weekdayPart] = parts;

  // Check for last day of month
  const isLastDayOfMonth = dayPart.toUpperCase() === "L";

  return {
    minute: parseField(minutePart, 0, 59, "minute"),
    hour: parseField(hourPart, 0, 23, "hour"),
    dayOfMonth: isLastDayOfMonth ? [] : parseField(dayPart, 1, 31, "day"),
    month: parseField(monthPart, 1, 12, "month", MONTH_NAMES),
    dayOfWeek: normalizeWeekdays(
      parseField(weekdayPart, 0, 7, "weekday", WEEKDAY_NAMES),
    ),
    isLastDayOfMonth,
  };
}

/**
 * Parse a single cron field
 */
function parseField(
  field: string,
  min: number,
  max: number,
  fieldName: string,
  nameMap?: Record<string, number>,
): number[] {
  const upper = field.toUpperCase();

  // Wildcard - all values
  if (upper === "*") {
    return range(min, max);
  }

  // List (comma-separated)
  if (upper.includes(",")) {
    const values = new Set<number>();
    for (const part of upper.split(",")) {
      const parsed = parseFieldPart(part.trim(), min, max, fieldName, nameMap);
      for (const val of parsed) {
        values.add(val);
      }
    }
    return Array.from(values).sort((a, b) => a - b);
  }

  // Single part (range, step, or value)
  return parseFieldPart(upper, min, max, fieldName, nameMap);
}

/**
 * Parse a single part of a field (no commas)
 */
function parseFieldPart(
  part: string,
  min: number,
  max: number,
  fieldName: string,
  nameMap?: Record<string, number>,
): number[] {
  // Step values (e.g., */5 or 1-10/2)
  if (part.includes("/")) {
    const [rangePart, stepPart] = part.split("/");
    const step = Number.parseInt(stepPart, 10);

    if (Number.isNaN(step) || step < 1) {
      throw new Error(
        `Invalid step value in ${fieldName} field: "${part}". Step must be a positive integer`,
      );
    }

    // Get base range
    let baseRange: number[];
    if (rangePart === "*") {
      baseRange = range(min, max);
    } else if (rangePart.includes("-")) {
      baseRange = parseRange(rangePart, min, max, fieldName, nameMap);
    } else {
      const start = parseValue(rangePart, min, max, fieldName, nameMap);
      baseRange = range(start, max);
    }

    // Apply step
    return baseRange.filter((_, index) => index % step === 0);
  }

  // Range (e.g., 1-5)
  if (part.includes("-")) {
    return parseRange(part, min, max, fieldName, nameMap);
  }

  // Single value
  const value = parseValue(part, min, max, fieldName, nameMap);
  return [value];
}

/**
 * Parse a range (e.g., "1-5" or "MON-FRI")
 */
function parseRange(
  rangePart: string,
  min: number,
  max: number,
  fieldName: string,
  nameMap?: Record<string, number>,
): number[] {
  const dashIndex = rangePart.indexOf("-");

  // Check for malformed ranges
  if (dashIndex === 0 || dashIndex === rangePart.length - 1) {
    throw new Error(
      `Invalid range in ${fieldName} field: "${rangePart}". Expected format: start-end`,
    );
  }

  const startStr = rangePart.substring(0, dashIndex);
  const endStr = rangePart.substring(dashIndex + 1);

  if (!startStr || !endStr) {
    throw new Error(
      `Invalid range in ${fieldName} field: "${rangePart}". Expected format: start-end`,
    );
  }

  const start = parseValue(startStr.trim(), min, max, fieldName, nameMap);
  const end = parseValue(endStr.trim(), min, max, fieldName, nameMap);

  if (start > end) {
    throw new Error(
      `Invalid range in ${fieldName} field: "${rangePart}". Start (${start}) must be <= end (${end})`,
    );
  }

  return range(start, end);
}

/**
 * Parse a single value (number or named value)
 */
function parseValue(
  value: string,
  min: number,
  max: number,
  fieldName: string,
  nameMap?: Record<string, number>,
): number {
  // Try named value first
  if (nameMap && value in nameMap) {
    return nameMap[value];
  }

  // Check if it looks like a malformed range (starts with -)
  if (value.startsWith("-")) {
    throw new Error(
      `Invalid value in ${fieldName} field: "${value}". Expected number${nameMap ? " or named value" : ""}`,
    );
  }

  // Parse as number
  const num = Number.parseInt(value, 10);

  if (Number.isNaN(num)) {
    throw new Error(
      `Invalid value in ${fieldName} field: "${value}". Expected number${nameMap ? " or named value" : ""}`,
    );
  }

  if (num < min || num > max) {
    throw new Error(
      `Value out of range in ${fieldName} field: ${num}. Must be between ${min} and ${max}`,
    );
  }

  return num;
}

/**
 * Generate array of numbers from start to end (inclusive)
 */
function range(start: number, end: number): number[] {
  const result: number[] = [];
  for (let i = start; i <= end; i++) {
    result.push(i);
  }
  return result;
}

/**
 * Normalize weekday values (7 → 0 for Sunday) and deduplicate
 */
function normalizeWeekdays(weekdays: number[]): number[] {
  const normalized = new Set(weekdays.map((d) => (d === 7 ? 0 : d)));
  return Array.from(normalized).sort((a, b) => a - b);
}

/**
 * Get the next occurrence of a cron schedule
 * @param cronFields Parsed cron expression fields
 * @param from Starting time (defaults to now)
 * @param useUTC If true, interpret cron fields in UTC instead of local time
 */
export function getNextCronOccurrence(
  cronFields: CronFields,
  from: Date = new Date(),
  useUTC = false,
): Date {
  // Start from next minute
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  // Maximum iterations to prevent infinite loops
  const MAX_ITERATIONS = 4 * 365 * 24 * 60; // 4 years in minutes
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Check if current time matches all fields
    if (matchesCronFields(next, cronFields, useUTC)) {
      return next;
    }

    // Advance to next minute
    next.setMinutes(next.getMinutes() + 1);
  }

  throw new Error(
    "Could not find next cron occurrence within 4 years. This likely indicates an impossible schedule.",
  );
}

/**
 * Check if a date matches cron fields
 */
function matchesCronFields(
  date: Date,
  fields: CronFields,
  useUTC = false,
): boolean {
  const minute = useUTC ? date.getUTCMinutes() : date.getMinutes();
  const hour = useUTC ? date.getUTCHours() : date.getHours();
  const day = useUTC ? date.getUTCDate() : date.getDate();
  const month = useUTC ? date.getUTCMonth() + 1 : date.getMonth() + 1; // JS months are 0-indexed
  const weekday = useUTC ? date.getUTCDay() : date.getDay();

  // Check minute
  if (!fields.minute.includes(minute)) {
    return false;
  }

  // Check hour
  if (!fields.hour.includes(hour)) {
    return false;
  }

  // Check month
  if (!fields.month.includes(month)) {
    return false;
  }

  // Check day of month (special handling for L - last day)
  const dayMatches = fields.isLastDayOfMonth
    ? isLastDayOfMonth(date, useUTC)
    : fields.dayOfMonth.length === 0 || fields.dayOfMonth.includes(day);

  // Check day of week
  const weekdayMatches =
    fields.dayOfWeek.length === 0 || fields.dayOfWeek.includes(weekday);

  // In cron, day-of-month and day-of-week are OR'd if both are SPECIFIED (not wildcards)
  // A wildcard produces all possible values, so we detect it by checking array length
  const dayIsSpecified =
    fields.isLastDayOfMonth ||
    (fields.dayOfMonth.length > 0 && fields.dayOfMonth.length < 31);
  const weekdayIsSpecified =
    fields.dayOfWeek.length > 0 && fields.dayOfWeek.length < 7;

  if (dayIsSpecified && weekdayIsSpecified) {
    // Both specified - match if EITHER matches (OR logic)
    return dayMatches || weekdayMatches;
  }

  // One or both are wildcards - match if BOTH match (AND logic)
  return dayMatches && weekdayMatches;
}

/**
 * Check if date is the last day of its month
 */
function isLastDayOfMonth(date: Date, useUTC = false): boolean {
  const nextDay = new Date(date);
  nextDay.setDate(date.getDate() + 1);

  if (useUTC) {
    return nextDay.getUTCMonth() !== date.getUTCMonth();
  }
  return nextDay.getMonth() !== date.getMonth();
}

/**
 * Get days in a month (handles leap years)
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

