/**
 * Simple interval-based scheduling (every N seconds/minutes/hours/days)
 * Supports both drift mode (interval from execution) and aligned mode (fixed intervals)
 */

export type TimeUnit = "seconds" | "minutes" | "hours" | "days";

export interface IntervalSchedule {
  every: number;
  unit: TimeUnit;
  /**
   * Aligned mode: schedules run at fixed intervals (e.g., every hour at :00)
   * Drift mode: schedules run N units after previous execution
   * @default false (drift mode)
   */
  aligned?: boolean;
}

export interface DailySchedule {
  /**
   * Time in HH:MM format (e.g., "14:30" for 2:30 PM)
   */
  at: string;
}

export type SimpleSchedule = IntervalSchedule | DailySchedule;

/**
 * Get the next scheduled time for a simple interval
 */
export function getNextIntervalTime(
  schedule: SimpleSchedule,
  from: Date = new Date(),
  useUTC = false,
): Date {
  if ("at" in schedule) {
    return getNextDailyTime(schedule.at, from, useUTC);
  }

  return getNextIntervalOccurrence(schedule, from, useUTC);
}

/**
 * Calculate next occurrence for interval schedules
 */
function getNextIntervalOccurrence(
  schedule: IntervalSchedule,
  from: Date,
  useUTC: boolean,
): Date {
  const { every, unit, aligned = false } = schedule;

  if (aligned) {
    return getAlignedInterval(every, unit, from, useUTC);
  }

  return getDriftInterval(every, unit, from);
}

/**
 * Drift mode: simply add N units to current time
 */
function getDriftInterval(every: number, unit: TimeUnit, from: Date): Date {
  const ms = from.getTime();
  const interval = getIntervalMs(every, unit);
  return new Date(ms + interval);
}

/**
 * Aligned mode: round to next fixed interval boundary
 * Examples:
 * - every 15 minutes aligned: :00, :15, :30, :45
 * - every 1 hour aligned: top of every hour
 * - every 6 hours aligned: 00:00, 06:00, 12:00, 18:00
 */
function getAlignedInterval(
  every: number,
  unit: TimeUnit,
  from: Date,
  useUTC: boolean,
): Date {
  const next = new Date(from);

  // Always align seconds and milliseconds to 0
  next.setSeconds(0, 0);

  switch (unit) {
    case "seconds": {
      // For seconds, just add the interval (no meaningful alignment)
      const currentSec = useUTC ? next.getUTCSeconds() : next.getSeconds();
      const alignedSec = Math.ceil((currentSec + 1) / every) * every;
      if (useUTC) {
        next.setUTCSeconds(alignedSec);
      } else {
        next.setSeconds(alignedSec);
      }
      return next;
    }

    case "minutes": {
      const currentMin = useUTC ? next.getUTCMinutes() : next.getMinutes();
      const alignedMin = Math.ceil((currentMin + 1) / every) * every;

      if (alignedMin >= 60) {
        // Roll over to next hour
        if (useUTC) {
          next.setUTCHours(next.getUTCHours() + 1);
          next.setUTCMinutes(alignedMin % 60);
        } else {
          next.setHours(next.getHours() + 1);
          next.setMinutes(alignedMin % 60);
        }
      } else {
        if (useUTC) {
          next.setUTCMinutes(alignedMin);
        } else {
          next.setMinutes(alignedMin);
        }
      }
      return next;
    }

    case "hours": {
      // Align to hour boundaries
      if (useUTC) {
        next.setUTCMinutes(0);
        const currentHour = next.getUTCHours();
        const alignedHour = Math.ceil((currentHour + 1) / every) * every;
        if (alignedHour >= 24) {
          next.setUTCDate(next.getUTCDate() + 1);
          next.setUTCHours(alignedHour % 24);
        } else {
          next.setUTCHours(alignedHour);
        }
      } else {
        next.setMinutes(0);
        const currentHour = next.getHours();
        const alignedHour = Math.ceil((currentHour + 1) / every) * every;
        if (alignedHour >= 24) {
          next.setDate(next.getDate() + 1);
          next.setHours(alignedHour % 24);
        } else {
          next.setHours(alignedHour);
        }
      }
      return next;
    }

    case "days": {
      // Align to midnight
      if (useUTC) {
        next.setUTCHours(0, 0, 0, 0);
        next.setUTCDate(next.getUTCDate() + every);
      } else {
        next.setHours(0, 0, 0, 0);
        next.setDate(next.getDate() + every);
      }
      return next;
    }
  }
}

/**
 * Calculate next daily occurrence at specific time (HH:MM)
 */
function getNextDailyTime(at: string, from: Date, useUTC: boolean): Date {
  const match = at.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid 'at' format: ${at}. Expected HH:MM`);
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);

  if (hour < 0 || hour > 23) {
    throw new Error(`Invalid hour: ${hour}. Must be 0-23`);
  }
  if (minute < 0 || minute > 59) {
    throw new Error(`Invalid minute: ${minute}. Must be 0-59`);
  }

  const next = new Date(from);

  if (useUTC) {
    next.setUTCHours(hour, minute, 0, 0);
    // If time has passed today, schedule for tomorrow
    if (next <= from) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
  } else {
    next.setHours(hour, minute, 0, 0);
    // If time has passed today, schedule for tomorrow
    if (next <= from) {
      next.setDate(next.getDate() + 1);
    }
  }

  return next;
}

/**
 * Convert interval to milliseconds
 */
function getIntervalMs(every: number, unit: TimeUnit): number {
  switch (unit) {
    case "seconds":
      return every * 1000;
    case "minutes":
      return every * 60 * 1000;
    case "hours":
      return every * 60 * 60 * 1000;
    case "days":
      return every * 24 * 60 * 60 * 1000;
  }
}

