/**
 * SyncedCron - A modern, type-safe cron scheduler for Meteor 3.x
 *
 * Provides synchronized job execution across multiple server instances using
 * MongoDB's unique indexes for atomic lock acquisition.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { SyncedCron } from "meteor/anonyfox:synced-cron";
 *
 * const cron = new SyncedCron({
 *   collectionName: "jobs",
 *   logger: console,
 * });
 *
 * await cron.add({
 *   name: "cleanup",
 *   schedule: { every: 1, unit: "hours" },
 *   job: async () => {
 *     // Your job logic
 *   }
 * });
 *
 * await cron.start();
 * ```
 *
 * ## Schedule Formats
 *
 * - Interval: `{ every: 5, unit: "minutes" }`
 * - Aligned: `{ every: 1, unit: "hours", aligned: true }` (runs at :00)
 * - Daily: `{ at: "14:30" }`
 * - Cron: `{ cron: "0 9 * * MON-FRI" }`
 *
 * ## Features
 *
 * - Full 5-field cron support (minute/hour/day/month/weekday)
 * - Multi-instance synchronization via MongoDB unique index
 * - Per-job pause/resume
 * - Job timeouts
 * - Health checks and metrics
 * - Circuit breaker protection
 * - UTC and local time support
 *
 * @module synced-cron
 */

// Schedule utilities for building custom schedulers
export {
  type CronFields,
  getNextCronOccurrence,
  parseCronExpression,
} from "./cronParser";
export {
  type DailySchedule,
  getNextIntervalTime,
  type IntervalSchedule,
} from "./intervalScheduler";
// Job executor for advanced use cases
export {
  type ExecutionResult,
  executeWithTimeout,
  withTimeout,
} from "./jobExecutor";
// Main class
export {
  type CronMetrics,
  type HealthCheckResult,
  SyncedCron,
} from "./SyncedCron";
// Timer utilities for advanced use cases
export {
  getMaxDelay,
  getMinDelay,
  scheduleOnce,
  scheduleRecurring,
  type Timer,
  type TimerOptions,
} from "./timerManager";
// Public types for job configuration
export type {
  JobConfig,
  JobStats,
  JobStatus,
  Logger,
  Schedule,
  SimpleSchedule,
  SyncedCronOptions,
} from "./types";
// Error types for error handling
export {
  CronError,
  CronNotStartedError,
  JobAlreadyExistsError,
  JobExecutionError,
  JobNotFoundError,
} from "./types";
