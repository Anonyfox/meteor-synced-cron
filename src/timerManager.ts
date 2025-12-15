/**
 * Robust timer manager with circuit breakers and hang prevention
 * Wraps Meteor.setTimeout with safety features to prevent infinite loops
 */

import { Meteor } from "meteor/meteor";

export interface Timer {
  clear(): void;
}

export interface TimerOptions {
  /**
   * Maximum number of consecutive scheduling failures before circuit breaks
   * @default 3
   */
  maxConsecutiveFailures?: number;

  /**
   * Callback when circuit breaker trips
   */
  onCircuitBreak?: (error: Error) => void;

  /**
   * Callback for each scheduling attempt (for monitoring)
   */
  onSchedule?: (nextRunAt: Date) => void;

  /**
   * Callback for errors during scheduling (useful for logging)
   */
  onError?: (error: Error) => void;
}

const MAX_SETTIMEOUT_DELAY = 2147483647; // Maximum safe setTimeout delay (24.8 days)
const MIN_RECOMMENDED_DELAY = 1000; // Minimum recommended delay for production (1 second)

/**
 * Schedule a recurring job with safety features
 * @param getNextTime Function that calculates next run time
 * @param execute Function to execute on each occurrence
 * @param options Timer safety options
 */
export function scheduleRecurring(
  getNextTime: (from: Date) => Date,
  execute: (intendedAt: Date) => void,
  options: TimerOptions = {},
): Timer {
  const {
    maxConsecutiveFailures = 3,
    onCircuitBreak,
    onSchedule,
    onError,
  } = options;

  let done = false;
  let currentTimer: number | undefined;
  let consecutiveFailures = 0;

  function scheduleNext() {
    if (done) return;

    try {
      const now = new Date();
      const nextRun = getNextTime(now);

      // Validate next run time
      if (!(nextRun instanceof Date) || Number.isNaN(nextRun.getTime())) {
        throw new Error("getNextTime returned invalid date");
      }

      if (nextRun <= now) {
        throw new Error(
          `getNextTime returned past/present time: ${nextRun.toISOString()} (now: ${now.toISOString()})`,
        );
      }

      const delay = nextRun.getTime() - now.getTime();

      // Cap at max setTimeout value (handle very long delays by rescheduling)
      const actualDelay = Math.min(delay, MAX_SETTIMEOUT_DELAY);
      const needsReschedule = actualDelay < delay;

      // Reset failure counter on successful scheduling
      consecutiveFailures = 0;

      // Notify monitoring
      if (onSchedule) {
        onSchedule(nextRun);
      }

      // Schedule the next execution
      currentTimer = Meteor.setTimeout(() => {
        if (done) return;

        if (needsReschedule) {
          // Delay was capped - reschedule without executing
          scheduleNext();
          return;
        }

        // Normalize intended time (remove milliseconds)
        const intendedAt = new Date(nextRun);
        intendedAt.setMilliseconds(0);

        try {
          // Execute the job
          execute(intendedAt);
        } catch (executeError) {
          // Log execution errors but don't break the schedule
          if (onError) {
            onError(
              executeError instanceof Error
                ? executeError
                : new Error(String(executeError)),
            );
          }
        }

        // Schedule next occurrence
        scheduleNext();
      }, actualDelay);
    } catch (error) {
      consecutiveFailures++;

      const err = error instanceof Error ? error : new Error(String(error));

      if (onError) {
        onError(err);
      }

      if (consecutiveFailures >= maxConsecutiveFailures) {
        // Circuit breaker trips
        done = true;
        const circuitError = new Error(
          `Timer circuit breaker tripped after ${maxConsecutiveFailures} consecutive failures. Last error: ${err.message}`,
        );

        if (onCircuitBreak) {
          onCircuitBreak(circuitError);
        }
        return; // Stop scheduling
      }

      // Exponential backoff before retry (10ms base for faster testing)
      const backoffDelay = Math.min(10 * 2 ** (consecutiveFailures - 1), 60000);

      currentTimer = Meteor.setTimeout(() => {
        if (!done) {
          scheduleNext();
        }
      }, backoffDelay);
    }
  }

  // Start scheduling
  scheduleNext();

  return {
    clear: () => {
      done = true;
      if (currentTimer !== undefined) {
        Meteor.clearTimeout(currentTimer);
        currentTimer = undefined;
      }
    },
  };
}

/**
 * Schedule a one-time execution with safety features
 * @param delay Delay in milliseconds
 * @param execute Function to execute
 */
export function scheduleOnce(delay: number, execute: () => void): Timer {
  if (delay < 0) {
    throw new Error(`Invalid delay: ${delay}ms. Must be non-negative`);
  }

  if (delay > MAX_SETTIMEOUT_DELAY) {
    throw new Error(
      `Delay too large: ${delay}ms. Maximum: ${MAX_SETTIMEOUT_DELAY}ms (${MAX_SETTIMEOUT_DELAY / 1000 / 60 / 60 / 24} days)`,
    );
  }

  let done = false;
  const timer = Meteor.setTimeout(() => {
    if (!done) {
      try {
        execute();
      } catch (error) {
        console.error(
          "Timer execution error:",
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }, delay);

  return {
    clear: () => {
      done = true;
      Meteor.clearTimeout(timer);
    },
  };
}

/**
 * Get maximum safe setTimeout delay
 */
export function getMaxDelay(): number {
  return MAX_SETTIMEOUT_DELAY;
}

/**
 * Get minimum recommended delay for production use
 */
export function getMinDelay(): number {
  return MIN_RECOMMENDED_DELAY;
}

