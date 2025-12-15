/**
 * Job executor with timeout support and error handling
 */

import { Meteor } from "meteor/meteor";

export interface ExecutionResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: Error;
  duration: number;
  timedOut: boolean;
}

export interface ExecutorOptions {
  /**
   * Maximum execution time in milliseconds
   * @default undefined (no timeout)
   */
  timeout?: number;

  /**
   * Called when job execution times out
   */
  onTimeout?: (duration: number) => void;
}

/**
 * Execute a job with timeout and error handling
 * @param job The job function to execute
 * @param intendedAt The intended execution time
 * @param jobName The job name (for error context)
 * @param options Execution options
 */
export async function executeWithTimeout<T>(
  job: (intendedAt: Date, jobName: string) => Promise<T> | T,
  intendedAt: Date,
  jobName: string,
  options: ExecutorOptions = {},
): Promise<ExecutionResult<T>> {
  const { timeout, onTimeout } = options;
  const startTime = Date.now();

  try {
    let result: T;

    if (timeout && timeout > 0) {
      // Execute with timeout
      result = await executeWithTimeoutLimit(
        () => Promise.resolve(job(intendedAt, jobName)),
        timeout,
        jobName,
      );
    } else {
      // Execute without timeout
      result = await Promise.resolve(job(intendedAt, jobName));
    }

    const duration = Date.now() - startTime;
    return {
      success: true,
      result,
      duration,
      timedOut: false,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const err = error instanceof Error ? error : new Error(String(error));

    // Check if it was a timeout
    if (err.message.includes("timed out")) {
      if (onTimeout) {
        onTimeout(duration);
      }
      return {
        success: false,
        error: err,
        duration,
        timedOut: true,
      };
    }

    return {
      success: false,
      error: err,
      duration,
      timedOut: false,
    };
  }
}

/**
 * Execute a promise with a timeout limit
 */
async function executeWithTimeoutLimit<T>(
  fn: () => Promise<T>,
  timeout: number,
  jobName: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let completed = false;

    const timeoutId = Meteor.setTimeout(() => {
      if (!completed) {
        completed = true;
        reject(new Error(`Job "${jobName}" timed out after ${timeout}ms`));
      }
    }, timeout);

    fn()
      .then((result) => {
        if (!completed) {
          completed = true;
          Meteor.clearTimeout(timeoutId);
          resolve(result);
        }
      })
      .catch((error) => {
        if (!completed) {
          completed = true;
          Meteor.clearTimeout(timeoutId);
          reject(error);
        }
      });
  });
}

/**
 * Create a job wrapper that enforces timeout
 */
export function withTimeout<T>(
  job: (intendedAt: Date, jobName: string) => Promise<T> | T,
  timeout: number,
): (intendedAt: Date, jobName: string) => Promise<T> {
  return async (intendedAt: Date, jobName: string): Promise<T> => {
    return executeWithTimeoutLimit(
      () => Promise.resolve(job(intendedAt, jobName)),
      timeout,
      jobName,
    );
  };
}

