# SyncedCron

[![Atmosphere](https://img.shields.io/badge/Atmosphere-anonyfox:synced--cron-blue?style=flat-square&logo=meteor)](https://atmospherejs.com/anonyfox/synced-cron)
[![GitHub](https://img.shields.io/badge/GitHub-Source-black?style=flat-square&logo=github)](https://github.com/Anonyfox/meteor-synced-cron)

Modern, type-safe cron scheduler for Meteor 3.x with synchronized execution across multiple server instances.

```bash
meteor add anonyfox:synced-cron
```

## Features

- **Multi-Instance Sync** — MongoDB unique index prevents duplicate job execution across servers
- **Full Cron Support** — 5-field cron expressions with `L` (last day) extension
- **Simple Intervals** — `every X minutes/hours/days` with optional alignment to clock boundaries
- **Per-Job Control** — Pause/resume individual jobs without affecting others
- **Health Checks** — Built-in monitoring for job health and metrics
- **TypeScript First** — Full type definitions included
- **UTC Support** — Run schedules in UTC to avoid DST surprises
- **Zero Dependencies** — Only uses Meteor core packages

## Quick Start

```typescript
import { SyncedCron } from "meteor/anonyfox:synced-cron";

const cron = new SyncedCron({
  collectionName: "cronHistory",
  utc: true, // Recommended for production
});

await cron.add({
  name: "cleanup-sessions",
  schedule: { every: 1, unit: "hours" },
  job: async (intendedAt) => {
    const count = await Sessions.removeAsync({ expired: true });
    return { removed: count };
  },
});

await cron.start();
```

## Schedule Formats

### Simple Intervals

```typescript
// Drift mode — interval from last execution
{ every: 5, unit: "minutes" }
{ every: 2, unit: "hours" }
{ every: 1, unit: "days" }

// Aligned mode — runs at fixed clock boundaries
{ every: 15, unit: "minutes", aligned: true } // :00, :15, :30, :45
{ every: 1, unit: "hours", aligned: true }    // Top of every hour
{ every: 6, unit: "hours", aligned: true }    // 00:00, 06:00, 12:00, 18:00
```

### Daily at Specific Time

```typescript
{
  at: "14:30";
} // Every day at 2:30 PM
{
  at: "09:00";
} // Every day at 9:00 AM
{
  at: "00:00";
} // Every day at midnight
```

### Cron Expressions

```typescript
{
  cron: "*/5 * * * *";
} // Every 5 minutes
{
  cron: "0 */6 * * *";
} // Every 6 hours at :00
{
  cron: "0 9 * * 1-5";
} // Weekdays at 9:00 AM
{
  cron: "0 0 1 * *";
} // First day of month at midnight
{
  cron: "0 0 L * *";
} // Last day of month at midnight
```

## Cron Syntax Reference

| Field   | Values        | Special Characters |
| ------- | ------------- | ------------------ |
| Minute  | 0-59          | `*` `,` `-` `/`    |
| Hour    | 0-23          | `*` `,` `-` `/`    |
| Day     | 1-31, `L`     | `*` `,` `-` `/`    |
| Month   | 1-12, JAN-DEC | `*` `,` `-` `/`    |
| Weekday | 0-7, SUN-SAT  | `*` `,` `-` `/`    |

**Special characters:**

- `*` — Any value
- `,` — List separator (`1,15` = 1st and 15th)
- `-` — Range (`MON-FRI` = Monday through Friday)
- `/` — Step (`*/15` = every 15)
- `L` — Last day of month (day field only)

> **Note:** Both `0` and `7` represent Sunday in the weekday field.

### Day-of-Month + Day-of-Week: OR Logic

When **both** day-of-month and day-of-week are specified (neither is `*`), the job runs if **either** matches:

```typescript
// Runs on the 15th OR on Mondays (not "15th that is a Monday")
{
  cron: "0 12 15 * 1";
}
```

This follows standard cron behavior. For AND logic, check the condition in your job:

```typescript
job: async (intendedAt) => {
  const isThe15th = intendedAt.getDate() === 15;
  const isMonday = intendedAt.getDay() === 1;
  if (!(isThe15th && isMonday)) return; // Skip
  // ... your logic
};
```

## Configuration

```typescript
new SyncedCron({
  // MongoDB collection for job history and synchronization
  collectionName: "cronHistory", // default: "cronHistory"

  // Time-to-live for history records in seconds
  // Minimum: 300 (5 min), null = keep forever
  collectionTTL: 172800, // default: 172800 (48 hours)

  // Logger with info/warn/error/debug methods
  logger: console, // default: console

  // Use UTC for all schedule calculations
  utc: false, // default: false (local time)
});
```

## UTC vs Local Time

| Mode         | Best For                              | DST Behavior          |
| ------------ | ------------------------------------- | --------------------- |
| `utc: true`  | System tasks, monitoring, API polling | ✅ No DST surprises   |
| `utc: false` | Human-facing schedules ("9 AM daily") | ⚠️ DST affects timing |

**DST Warning for Local Time:**

- **Spring Forward:** Jobs between 2:00–3:00 AM may be skipped (hour doesn't exist)
- **Fall Back:** Jobs between 1:00–2:00 AM may run twice (hour repeats)

**Recommendation:** Use `utc: true` for production services unless you specifically need local time semantics.

## API Reference

### Lifecycle

```typescript
await cron.start(); // Start scheduling all jobs
cron.pause(); // Pause all jobs (keeps definitions)
await cron.stop(); // Stop and remove all jobs
await cron.gracefulShutdown(ms); // Wait for running jobs, then stop
```

### Job Management

```typescript
// Add a job
await cron.add({
  name: "unique-job-name",
  schedule: { every: 1, unit: "hours" },
  job: async (intendedAt, jobName) => {
    // Your async or sync logic
    return { result: "data" }; // Optional return value
  },
  persist: true, // Store history in MongoDB (default: true)
  onError: async (error, intendedAt) => {
    // Custom error handling
  },
});

// Remove a job
await cron.remove("job-name");

// Get registered job names
const names = cron.getJobNames(); // ["job1", "job2"]
```

### Per-Job Pause/Resume

```typescript
cron.pauseJob("job-name"); // Pause one job
cron.resumeJob("job-name"); // Resume a paused job
const paused = cron.isJobPaused("job-name"); // Check pause state
```

### Monitoring

```typescript
// Status for one job
const status = await cron.getJobStatus("job-name");
// {
//   name: "job-name",
//   isScheduled: true,
//   isPaused: false,
//   nextRunAt: Date,
//   lastRun: { startedAt, finishedAt, success, duration, error? },
//   stats: { totalRuns, successCount, errorCount, averageDuration }
// }

// Status for all jobs
const statuses = await cron.getAllJobStatuses();

// Health check
const health = cron.healthCheck();
// { healthy, running, totalJobs, scheduledJobs, pausedJobs, runningJobs, issues, jobs }

// Metrics for monitoring systems
const metrics = cron.getMetrics();
// { isRunning, jobCount, runningJobCount, pausedJobCount, scheduledJobCount }

// Next scheduled run
const nextRun = cron.nextScheduledAt("job-name"); // Date | undefined
```

## How Synchronization Works

SyncedCron uses a MongoDB unique index on `{ intendedAt, name }` for coordination:

1. When a job's scheduled time arrives, **all instances** attempt to insert a history record
2. MongoDB's unique index ensures **only one insert succeeds**
3. The instance that succeeds executes the job; others silently skip
4. No leader election, no distributed locks, no external services

This works because MongoDB's unique constraint is atomic — exactly one insert will succeed.

## Error Handling

Jobs that throw errors are logged and recorded in history, but the schedule continues:

```typescript
await cron.add({
  name: "risky-job",
  schedule: { every: 1, unit: "hours" },
  job: async () => {
    throw new Error("Something went wrong");
  },
  onError: async (error, intendedAt) => {
    // Send alert, log to external service, etc.
    await alertService.notify({
      job: "risky-job",
      error: error.message,
      scheduledFor: intendedAt,
    });
  },
});
```

## Production Recipes

### Graceful Shutdown

```typescript
// Wait for running jobs before exiting
process.on("SIGTERM", async () => {
  console.log("Shutting down gracefully...");
  await cron.gracefulShutdown(30000); // 30 second timeout
  process.exit(0);
});
```

### Health Check Endpoint

```typescript
import { WebApp } from "meteor/webapp";

WebApp.connectHandlers.use("/health/cron", (req, res) => {
  const health = cron.healthCheck();
  res.writeHead(health.healthy ? 200 : 503, {
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(health));
});
```

### Job Timeouts

```typescript
import { SyncedCron, withTimeout } from "meteor/anonyfox:synced-cron";

await cron.add({
  name: "slow-operation",
  schedule: { every: 1, unit: "hours" },
  job: withTimeout(
    async () => {
      await verySlowOperation();
    },
    120000 // 2 minute timeout
  ),
});
```

### Custom Cron Parsing

```typescript
import {
  parseCronExpression,
  getNextCronOccurrence,
} from "meteor/anonyfox:synced-cron";

const fields = parseCronExpression("0 9 * * MON-FRI");
const nextRun = getNextCronOccurrence(fields, new Date(), true); // UTC
```

## TypeScript Support

Full type definitions are included. Key types:

```typescript
import type {
  SyncedCronOptions,
  JobConfig,
  JobStatus,
  Schedule,
  HealthCheckResult,
  CronMetrics,
} from "meteor/anonyfox:synced-cron";
```

## Requirements

- Meteor 3.3+
- MongoDB (included with Meteor)

---

<div align="center">

### Support

If this package helps your project, consider sponsoring its maintenance:

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-EA4AAA?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/Anonyfox)

---

**[Anonyfox](https://anonyfox.com) • [MIT License](LICENSE)**

</div>
