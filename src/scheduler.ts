/**
 * Unified scheduling utilities - bridges SyncedCron with the specialized parsers
 *
 * This module routes schedules to the appropriate parser (cron or interval)
 * and handles UTC/local time configuration.
 */

import { Meteor } from "meteor/meteor";
import { getNextCronOccurrence, parseCronExpression } from "./cronParser";
import { getNextIntervalTime } from "./intervalScheduler";
import type { Schedule, SimpleSchedule, Timer } from "./types";

export interface ScheduleOptions {
  /**
   * Use UTC for all time calculations
   * @default false (local time)
   */
  utc?: boolean;
}

/**
 * Calculate next run time for any schedule type
 */
export function getNextScheduledTime(
  schedule: SimpleSchedule,
  options: ScheduleOptions = {},
): Date {
  const { utc = false } = options;
  const now = new Date();

  if ("every" in schedule) {
    // Interval schedule - use intervalScheduler
    return getNextIntervalTime(
      {
        every: schedule.every,
        unit: schedule.unit,
        aligned: schedule.aligned,
      },
      now,
      utc,
    );
  }

  if ("cron" in schedule) {
    // Cron expression - use cronParser
    const fields = parseCronExpression(schedule.cron);
    return getNextCronOccurrence(fields, now, utc);
  }

  if ("at" in schedule) {
    // Daily at specific time - use intervalScheduler
    return getNextIntervalTime({ at: schedule.at }, now, utc);
  }

  throw new Error("Invalid schedule format");
}

/**
 * Schedule a job to run according to the schedule
 */
export function scheduleJob(
  schedule: Schedule,
  fn: (intendedAt: Date) => void,
  options: ScheduleOptions = {},
): Timer {
  let done = false;
  let currentTimer: number | undefined;

  function scheduleNext() {
    if (done) return;

    try {
      const nextRun = getNextScheduledTime(schedule, options);
      const now = Date.now();
      const delay = nextRun.getTime() - now;

      if (delay <= 0) {
        // Edge case: schedule returned past/present time
        // This can happen at DST boundaries - retry with fresh calculation
        Meteor.setTimeout(() => {
          if (!done) scheduleNext();
        }, 100);
        return;
      }

      // Cap at max setTimeout value (~24.8 days)
      const maxDelay = 2147483647;
      const actualDelay = Math.min(delay, maxDelay);
      const needsReschedule = actualDelay < delay;

      currentTimer = Meteor.setTimeout(() => {
        if (done) return;

        if (needsReschedule) {
          // Delay was capped - reschedule without executing
          scheduleNext();
          return;
        }

        // Normalize the intended run time (remove milliseconds)
        const intendedAt = new Date(nextRun);
        intendedAt.setMilliseconds(0);

        try {
          // Execute the job
          fn(intendedAt);
        } catch (e) {
          // Log execution errors but don't break the schedule
          console.error("Job execution error:", e);
        }

        // Schedule next run
        scheduleNext();
      }, actualDelay);
    } catch (e) {
      console.error("Error scheduling job:", e);
      // Don't give up immediately - retry after a delay
      Meteor.setTimeout(() => {
        if (!done) scheduleNext();
      }, 5000);
    }
  }

  scheduleNext();

  return {
    clear: () => {
      done = true;
      if (currentTimer !== undefined) {
        Meteor.clearTimeout(currentTimer);
      }
    },
  };
}

