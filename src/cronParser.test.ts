/**
 * Comprehensive tests for cron expression parser
 * Covers all operators, edge cases, and error conditions
 */

import { expect } from "chai";
import { Meteor } from "meteor/meteor";
import {
  getDaysInMonth,
  getNextCronOccurrence,
  parseCronExpression,
} from "./cronParser";

if (Meteor.isServer) {
  describe("cronParser", () => {
    describe("parseCronExpression", () => {
      describe("Basic validation", () => {
        it("should reject expressions with wrong number of fields", () => {
          expect(() => parseCronExpression("* *")).to.throw(/Expected 5 fields/);
          expect(() => parseCronExpression("* * * *")).to.throw(
            /Expected 5 fields/,
          );
          expect(() => parseCronExpression("* * * * * *")).to.throw(
            /Expected 5 fields/,
          );
        });

        it("should parse wildcard expression", () => {
          const fields = parseCronExpression("* * * * *");
          expect(fields.minute).to.have.lengthOf(60);
          expect(fields.hour).to.have.lengthOf(24);
          expect(fields.dayOfMonth).to.have.lengthOf(31);
          expect(fields.month).to.have.lengthOf(12);
          expect(fields.dayOfWeek).to.have.lengthOf(7); // 0-6 (7 is normalized to 0)
        });

        it("should handle extra whitespace", () => {
          const fields = parseCronExpression("  0   0   *   *   *  ");
          expect(fields.minute).to.deep.equal([0]);
          expect(fields.hour).to.deep.equal([0]);
        });
      });

      describe("Minute field", () => {
        it("should parse single minute", () => {
          const fields = parseCronExpression("15 * * * *");
          expect(fields.minute).to.deep.equal([15]);
        });

        it("should parse minute range", () => {
          const fields = parseCronExpression("10-20 * * * *");
          expect(fields.minute).to.deep.equal([
            10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
          ]);
        });

        it("should parse minute list", () => {
          const fields = parseCronExpression("0,15,30,45 * * * *");
          expect(fields.minute).to.deep.equal([0, 15, 30, 45]);
        });

        it("should parse minute step from wildcard", () => {
          const fields = parseCronExpression("*/5 * * * *");
          // Every 5 minutes: 0, 5, 10, 15, ..., 55
          expect(fields.minute).to.deep.equal([
            0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
          ]);
        });

        it("should parse minute step from range", () => {
          const fields = parseCronExpression("10-30/5 * * * *");
          expect(fields.minute).to.deep.equal([10, 15, 20, 25, 30]);
        });

        it("should parse minute step from value", () => {
          const fields = parseCronExpression("10/15 * * * *");
          // Starting from 10, every 15th value: 10, 25, 40, 55
          expect(fields.minute).to.deep.equal([10, 25, 40, 55]);
        });

        it("should reject invalid minute values", () => {
          expect(() => parseCronExpression("60 * * * *")).to.throw(
            /out of range/,
          );
          expect(() => parseCronExpression("-1 * * * *")).to.throw(/Invalid/);
        });

        it("should reject invalid minute step", () => {
          expect(() => parseCronExpression("*/0 * * * *")).to.throw(
            /Invalid step/,
          );
          expect(() => parseCronExpression("*/-1 * * * *")).to.throw(
            /Invalid step/,
          );
        });
      });

      describe("Hour field", () => {
        it("should parse single hour", () => {
          const fields = parseCronExpression("* 9 * * *");
          expect(fields.hour).to.deep.equal([9]);
        });

        it("should parse hour range", () => {
          const fields = parseCronExpression("* 9-17 * * *");
          expect(fields.hour).to.deep.equal([9, 10, 11, 12, 13, 14, 15, 16, 17]);
        });

        it("should parse hour list", () => {
          const fields = parseCronExpression("* 0,6,12,18 * * *");
          expect(fields.hour).to.deep.equal([0, 6, 12, 18]);
        });

        it("should parse hour step", () => {
          const fields = parseCronExpression("* */6 * * *");
          expect(fields.hour).to.deep.equal([0, 6, 12, 18]);
        });

        it("should reject invalid hour values", () => {
          expect(() => parseCronExpression("* 24 * * *")).to.throw(
            /out of range/,
          );
          expect(() => parseCronExpression("* -1 * * *")).to.throw(/Invalid/);
        });
      });

      describe("Day of month field", () => {
        it("should parse single day", () => {
          const fields = parseCronExpression("* * 15 * *");
          expect(fields.dayOfMonth).to.deep.equal([15]);
        });

        it("should parse day range", () => {
          const fields = parseCronExpression("* * 1-7 * *");
          expect(fields.dayOfMonth).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);
        });

        it("should parse day list", () => {
          const fields = parseCronExpression("* * 1,15,30 * *");
          expect(fields.dayOfMonth).to.deep.equal([1, 15, 30]);
        });

        it("should parse day step", () => {
          const fields = parseCronExpression("* * */5 * *");
          expect(fields.dayOfMonth).to.deep.equal([1, 6, 11, 16, 21, 26, 31]);
        });

        it("should parse L (last day of month)", () => {
          const fields = parseCronExpression("* * L * *");
          expect(fields.isLastDayOfMonth).to.equal(true);
          expect(fields.dayOfMonth).to.deep.equal([]);
        });

        it("should parse lowercase l as last day", () => {
          const fields = parseCronExpression("* * l * *");
          expect(fields.isLastDayOfMonth).to.equal(true);
        });

        it("should reject invalid day values", () => {
          expect(() => parseCronExpression("* * 0 * *")).to.throw(
            /out of range/,
          );
          expect(() => parseCronExpression("* * 32 * *")).to.throw(
            /out of range/,
          );
        });
      });

      describe("Month field", () => {
        it("should parse single month", () => {
          const fields = parseCronExpression("* * * 6 *");
          expect(fields.month).to.deep.equal([6]);
        });

        it("should parse month range", () => {
          const fields = parseCronExpression("* * * 6-9 *");
          expect(fields.month).to.deep.equal([6, 7, 8, 9]);
        });

        it("should parse month list", () => {
          const fields = parseCronExpression("* * * 1,4,7,10 *");
          expect(fields.month).to.deep.equal([1, 4, 7, 10]);
        });

        it("should parse month step", () => {
          const fields = parseCronExpression("* * * */3 *");
          expect(fields.month).to.deep.equal([1, 4, 7, 10]);
        });

        it("should parse named months", () => {
          const fields = parseCronExpression("* * * JAN *");
          expect(fields.month).to.deep.equal([1]);
        });

        it("should parse named month range", () => {
          const fields = parseCronExpression("* * * JAN-MAR *");
          expect(fields.month).to.deep.equal([1, 2, 3]);
        });

        it("should parse named month list", () => {
          const fields = parseCronExpression("* * * JAN,APR,JUL,OCT *");
          expect(fields.month).to.deep.equal([1, 4, 7, 10]);
        });

        it("should parse mixed case month names", () => {
          const fields = parseCronExpression("* * * jan,Feb,MAR *");
          expect(fields.month).to.deep.equal([1, 2, 3]);
        });

        it("should reject invalid month values", () => {
          expect(() => parseCronExpression("* * * 0 *")).to.throw(
            /out of range/,
          );
          expect(() => parseCronExpression("* * * 13 *")).to.throw(
            /out of range/,
          );
        });

        it("should reject invalid month names", () => {
          expect(() => parseCronExpression("* * * INVALID *")).to.throw(
            /Invalid value/,
          );
        });
      });

      describe("Day of week field", () => {
        it("should parse single weekday", () => {
          const fields = parseCronExpression("* * * * 1");
          expect(fields.dayOfWeek).to.deep.equal([1]);
        });

        it("should parse weekday range", () => {
          const fields = parseCronExpression("* * * * 1-5");
          expect(fields.dayOfWeek).to.deep.equal([1, 2, 3, 4, 5]);
        });

        it("should parse weekday list", () => {
          const fields = parseCronExpression("* * * * 0,6");
          expect(fields.dayOfWeek).to.deep.equal([0, 6]);
        });

        it("should parse weekday step", () => {
          const fields = parseCronExpression("* * * * */2");
          expect(fields.dayOfWeek).to.deep.equal([0, 2, 4, 6]);
        });

        it("should parse named weekdays", () => {
          const fields = parseCronExpression("* * * * MON");
          expect(fields.dayOfWeek).to.deep.equal([1]);
        });

        it("should parse named weekday range", () => {
          const fields = parseCronExpression("* * * * MON-FRI");
          expect(fields.dayOfWeek).to.deep.equal([1, 2, 3, 4, 5]);
        });

        it("should parse named weekday list", () => {
          const fields = parseCronExpression("* * * * SUN,SAT");
          expect(fields.dayOfWeek).to.deep.equal([0, 6]);
        });

        it("should normalize 7 to 0 (both mean Sunday)", () => {
          const fields = parseCronExpression("* * * * 7");
          expect(fields.dayOfWeek).to.deep.equal([0]);
        });

        it("should normalize mixed 0 and 7", () => {
          const fields = parseCronExpression("* * * * 0,7");
          expect(fields.dayOfWeek).to.deep.equal([0]);
        });

        it("should reject invalid weekday values", () => {
          expect(() => parseCronExpression("* * * * 8")).to.throw(
            /out of range/,
          );
          expect(() => parseCronExpression("* * * * -1")).to.throw(/Invalid/);
        });
      });

      describe("Complex expressions", () => {
        it("should parse complex list with ranges", () => {
          const fields = parseCronExpression("0,15,30,45 9-17 * * MON-FRI");
          expect(fields.minute).to.deep.equal([0, 15, 30, 45]);
          expect(fields.hour).to.deep.equal([9, 10, 11, 12, 13, 14, 15, 16, 17]);
          expect(fields.dayOfWeek).to.deep.equal([1, 2, 3, 4, 5]);
        });

        it("should deduplicate values in lists", () => {
          const fields = parseCronExpression("0,0,0 * * * *");
          expect(fields.minute).to.deep.equal([0]);
        });

        it("should sort list values", () => {
          const fields = parseCronExpression("45,0,30,15 * * * *");
          expect(fields.minute).to.deep.equal([0, 15, 30, 45]);
        });
      });

      describe("Error handling", () => {
        it("should reject invalid range (start > end)", () => {
          expect(() => parseCronExpression("20-10 * * * *")).to.throw(
            /Start.*must be <= end/,
          );
        });

        it("should reject malformed range", () => {
          expect(() => parseCronExpression("10- * * * *")).to.throw(
            /Invalid range/,
          );
          expect(() => parseCronExpression("-10 * * * *")).to.throw(
            /Invalid range/,
          );
        });

        it("should reject malformed step", () => {
          expect(() => parseCronExpression("*/ * * * *")).to.throw(
            /Invalid step/,
          );
          expect(() => parseCronExpression("*/abc * * * *")).to.throw(
            /Invalid step/,
          );
        });

        it("should reject non-numeric values where expected", () => {
          expect(() => parseCronExpression("abc * * * *")).to.throw(
            /Invalid value/,
          );
        });
      });
    });

    describe("getNextCronOccurrence", () => {
      describe("Every minute patterns", () => {
        it("should find next minute for * * * * *", () => {
          const fields = parseCronExpression("* * * * *");
          const from = new Date("2025-01-15T10:30:45.123Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCMinutes()).to.equal(31);
          expect(next.getSeconds()).to.equal(0);
          expect(next.getMilliseconds()).to.equal(0);
        });
      });

      describe("Specific minute patterns", () => {
        it("should find next occurrence at specific minute", () => {
          const fields = parseCronExpression("30 * * * *");
          const from = new Date("2025-01-15T10:20:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCHours()).to.equal(10);
          expect(next.getUTCMinutes()).to.equal(30);
        });

        it("should skip to next hour if minute has passed", () => {
          const fields = parseCronExpression("30 * * * *");
          const from = new Date("2025-01-15T10:35:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCHours()).to.equal(11);
          expect(next.getUTCMinutes()).to.equal(30);
        });
      });

      describe("Every N minutes patterns", () => {
        it("should find next occurrence for */5 pattern", () => {
          const fields = parseCronExpression("*/5 * * * *");
          const from = new Date("2025-01-15T10:22:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCMinutes()).to.equal(25);
        });

        it("should find next occurrence for */15 pattern", () => {
          const fields = parseCronExpression("*/15 * * * *");
          const from = new Date("2025-01-15T10:22:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCMinutes()).to.equal(30);
        });
      });

      describe("Specific hour patterns", () => {
        it("should find next occurrence at specific hour", () => {
          const fields = parseCronExpression("0 9 * * *");
          const from = new Date("2025-01-15T08:00:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCHours()).to.equal(9);
          expect(next.getUTCMinutes()).to.equal(0);
        });

        it("should skip to next day if hour has passed", () => {
          const fields = parseCronExpression("0 9 * * *");
          const from = new Date("2025-01-15T10:00:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCDate()).to.equal(16);
          expect(next.getUTCHours()).to.equal(9);
        });
      });

      describe("Multiple hours patterns", () => {
        it("should find next occurrence in hour list", () => {
          const fields = parseCronExpression("0 6,12,18 * * *");
          const from = new Date("2025-01-15T08:00:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCHours()).to.equal(12);
        });

        it("should wrap to next day after last hour", () => {
          const fields = parseCronExpression("0 6,12,18 * * *");
          const from = new Date("2025-01-15T19:00:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCDate()).to.equal(16);
          expect(next.getUTCHours()).to.equal(6);
        });
      });

      describe("Weekday patterns", () => {
        it("should find next Monday", () => {
          const fields = parseCronExpression("0 9 * * MON");
          const from = new Date("2025-01-15T10:00:00Z"); // Wednesday
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCDay()).to.equal(1); // Monday
          expect(next.getUTCHours()).to.equal(9);
        });

        it("should find next weekday in MON-FRI range", () => {
          const fields = parseCronExpression("0 9 * * MON-FRI");
          const from = new Date("2025-01-18T10:00:00Z"); // Saturday
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCDay()).to.equal(1); // Monday
          expect(next.getUTCDate()).to.equal(20);
        });

        it("should find weekend day", () => {
          const fields = parseCronExpression("0 9 * * SAT,SUN");
          const from = new Date("2025-01-15T10:00:00Z"); // Wednesday
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCDay()).to.equal(6); // Saturday
          expect(next.getUTCDate()).to.equal(18);
        });
      });

      describe("Last day of month", () => {
        it("should find last day of current month", () => {
          const fields = parseCronExpression("0 9 L * *");
          const from = new Date("2025-01-15T10:00:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCDate()).to.equal(31);
          expect(next.getUTCMonth()).to.equal(0); // January
        });

        it("should find last day of February (non-leap year)", () => {
          const fields = parseCronExpression("0 9 L * *");
          const from = new Date("2025-02-01T10:00:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCDate()).to.equal(28);
          expect(next.getUTCMonth()).to.equal(1); // February
        });

        it("should find last day of February (leap year)", () => {
          const fields = parseCronExpression("0 9 L * *");
          const from = new Date("2024-02-01T10:00:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCDate()).to.equal(29);
          expect(next.getUTCMonth()).to.equal(1); // February
        });

        it("should wrap to next month after last day", () => {
          const fields = parseCronExpression("0 9 L * *");
          const from = new Date("2025-01-31T10:00:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCDate()).to.equal(28);
          expect(next.getUTCMonth()).to.equal(1); // February
        });
      });

      describe("Month patterns", () => {
        it("should find next occurrence in specific month", () => {
          const fields = parseCronExpression("0 9 1 6 *");
          const from = new Date("2025-01-15T10:00:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCMonth()).to.equal(5); // June (0-indexed)
          expect(next.getUTCDate()).to.equal(1);
        });

        it("should find next occurrence in month range", () => {
          const fields = parseCronExpression("0 9 1 6-8 *");
          const from = new Date("2025-05-15T10:00:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCMonth()).to.equal(5); // June
          expect(next.getUTCDate()).to.equal(1);
        });

        it("should wrap to next year after December", () => {
          const fields = parseCronExpression("0 9 1 1 *");
          const from = new Date("2025-12-15T10:00:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCFullYear()).to.equal(2026);
          expect(next.getUTCMonth()).to.equal(0); // January
        });
      });

      describe("Day OR Weekday logic", () => {
        it("should match if either day OR weekday matches", () => {
          // 15th of month OR Monday (whichever comes first)
          const fields = parseCronExpression("0 9 15 * MON");
          const from = new Date("2025-01-10T10:00:00Z"); // Friday

          const next = getNextCronOccurrence(fields, from, true);

          // Should match Monday (Jan 13) before 15th (Wed)
          expect(next.getUTCDay()).to.equal(1); // Monday
          expect(next.getUTCDate()).to.equal(13);
        });

        it("should match day of month when specified", () => {
          const fields = parseCronExpression("0 9 20 * MON");
          const from = new Date("2025-01-16T10:00:00Z");

          const next = getNextCronOccurrence(fields, from, true);

          // Should match Monday Jan 20 (both day and weekday match)
          expect(next.getUTCDate()).to.equal(20);
          expect(next.getUTCDay()).to.equal(1);
        });
      });

      describe("Edge cases", () => {
        it("should handle end of year boundary", () => {
          const fields = parseCronExpression("0 0 1 1 *");
          const from = new Date("2025-12-31T23:30:00Z");
          const next = getNextCronOccurrence(fields, from, true);

          expect(next.getUTCFullYear()).to.equal(2026);
          expect(next.getUTCMonth()).to.equal(0);
          expect(next.getUTCDate()).to.equal(1);
        });

        it("should handle month with 30 days", () => {
          const fields = parseCronExpression("0 9 31 * *");
          const from = new Date("2025-04-15T10:00:00Z"); // April has 30 days
          const next = getNextCronOccurrence(fields, from, true);

          // Should skip to May 31
          expect(next.getUTCMonth()).to.equal(4); // May
          expect(next.getUTCDate()).to.equal(31);
        });

        it("should throw on impossible schedule", () => {
          // February 30th never exists
          const fields = parseCronExpression("0 9 30 2 *");
          const from = new Date("2025-02-01T10:00:00Z");

          // Should throw within reasonable time
          expect(() => getNextCronOccurrence(fields, from, true)).to.throw(
            /Could not find next cron occurrence/,
          );
        });
      });
    });

    describe("getDaysInMonth", () => {
      it("should return correct days for each month", () => {
        expect(getDaysInMonth(2025, 1)).to.equal(31); // January
        expect(getDaysInMonth(2025, 2)).to.equal(28); // February (non-leap)
        expect(getDaysInMonth(2025, 3)).to.equal(31); // March
        expect(getDaysInMonth(2025, 4)).to.equal(30); // April
        expect(getDaysInMonth(2025, 5)).to.equal(31); // May
        expect(getDaysInMonth(2025, 6)).to.equal(30); // June
        expect(getDaysInMonth(2025, 7)).to.equal(31); // July
        expect(getDaysInMonth(2025, 8)).to.equal(31); // August
        expect(getDaysInMonth(2025, 9)).to.equal(30); // September
        expect(getDaysInMonth(2025, 10)).to.equal(31); // October
        expect(getDaysInMonth(2025, 11)).to.equal(30); // November
        expect(getDaysInMonth(2025, 12)).to.equal(31); // December
      });

      it("should handle leap years", () => {
        expect(getDaysInMonth(2024, 2)).to.equal(29); // 2024 is leap year
        expect(getDaysInMonth(2000, 2)).to.equal(29); // 2000 is leap year
        expect(getDaysInMonth(1900, 2)).to.equal(28); // 1900 is NOT leap year
      });
    });
  });
}

