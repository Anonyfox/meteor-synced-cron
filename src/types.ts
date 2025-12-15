/**
 * Type definitions for SyncedCron package
 */

/**
 * Standard logger interface compatible with console, winston, pino, etc.
 */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Configuration options for SyncedCron instance
 */
export interface SyncedCronOptions {
  /**
   * Name of MongoDB collection to use for job history and synchronization
   * @default 'cronHistory'
   */
  collectionName?: string;

  /**
   * TTL in seconds for job history records. Set to null to disable expiry.
   * Minimum value is 300 seconds (5 minutes) for safety.
   * @default 172800 (48 hours)
   */
  collectionTTL?: number | null;

  /**
   * Logger instance for outputting job information
   * @default console
   */
  logger?: Logger;

  /**
   * Use UTC time for schedule evaluation
   * @default false (uses local time)
   */
  utc?: boolean;
}

/**
 * Simple schedule definition for common use cases
 */
export type SimpleSchedule =
  | {
      every: number;
      unit: "seconds" | "minutes" | "hours" | "days";
      /** If true, aligns to fixed boundaries (e.g., every hour at :00) */
      aligned?: boolean;
    }
  | {
      cron: string;
    }
  | {
      at: string; // HH:MM format for daily execution
    };

/**
 * Schedule definition
 */
export type Schedule = SimpleSchedule;

/**
 * Job configuration
 */
export interface JobConfig<TResult = unknown> {
  /**
   * Unique name for the job
   */
  name: string;

  /**
   * Schedule definition
   */
  schedule: Schedule;

  /**
   * Job function to execute. Can be sync or async.
   * @param intendedAt - The precise time this job was scheduled to run
   * @param jobName - Name of the job (for convenience)
   * @returns Optional result that will be stored in job history
   */
  job: (intendedAt: Date, jobName: string) => Promise<TResult> | TResult;

  /**
   * Whether to persist job execution history to the database
   * @default true
   */
  persist?: boolean;

  /**
   * Optional error handler called when job execution fails
   */
  onError?: (error: Error, intendedAt: Date) => void | Promise<void>;
}

/**
 * MongoDB document structure for job history
 */
export interface JobHistory {
  _id?: string;
  name: string;
  intendedAt: Date;
  startedAt: Date;
  finishedAt?: Date;
  result?: unknown;
  error?: string;
}

/**
 * Internal job entry with scheduling metadata
 */
export interface JobEntry<TResult = unknown> {
  name: string;
  schedule: Schedule;
  job: (intendedAt: Date, jobName: string) => Promise<TResult> | TResult;
  persist: boolean;
  onError?: (error: Error, intendedAt: Date) => void | Promise<void>;
  timer?: Timer;
  paused?: boolean;
}

/**
 * Timer interface for Later.js integration
 */
export interface Timer {
  clear(): void;
}

/**
 * Job execution statistics
 */
export interface JobStats {
  totalRuns: number;
  successCount: number;
  errorCount: number;
  averageDuration?: number;
}

/**
 * Job status information for monitoring
 */
export interface JobStatus {
  name: string;
  isScheduled: boolean;
  isPaused: boolean;
  nextRunAt?: Date;
  lastRun?: {
    startedAt: Date;
    finishedAt?: Date;
    success: boolean;
    duration?: number;
    error?: string;
  };
  stats: JobStats;
}

/**
 * Custom error types for better error handling
 */
export class CronError extends Error {
  constructor(
    message: string,
    public readonly jobName: string,
  ) {
    super(message);
    this.name = "CronError";
  }
}

export class JobExecutionError extends CronError {
  constructor(
    jobName: string,
    public readonly originalError: Error,
    public readonly intendedAt: Date,
  ) {
    super(`Job "${jobName}" failed: ${originalError.message}`, jobName);
    this.name = "JobExecutionError";
  }
}

export class JobAlreadyExistsError extends CronError {
  constructor(jobName: string) {
    super(`Job "${jobName}" already exists`, jobName);
    this.name = "JobAlreadyExistsError";
  }
}

export class JobNotFoundError extends CronError {
  constructor(jobName: string) {
    super(`Job "${jobName}" not found`, jobName);
    this.name = "JobNotFoundError";
  }
}

export class CronNotStartedError extends Error {
  constructor() {
    super("SyncedCron has not been started yet");
    this.name = "CronNotStartedError";
  }
}

