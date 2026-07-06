const FIELD_PATTERN = /^[\d*,/-]+$/;

/** Validate standard 5-field cron: minute hour day-of-month month day-of-week */
export function validateCronExpression(cron: string): void {
  const trimmed = cron.trim();
  if (!trimmed) {
    throw new Error("cron expression is required");
  }
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("cron must have exactly 5 fields (minute hour day-of-month month day-of-week)");
  }
  for (const field of fields) {
    if (!field || !FIELD_PATTERN.test(field)) {
      throw new Error(`invalid cron field: ${field}`);
    }
  }
}

/** True when minute field is exactly 0 or 30 (peak load times). */
export function cronUsesPeakMinute(cron: string): boolean {
  const minute = cron.trim().split(/\s+/)[0] ?? "";
  return minute === "0" || minute === "30";
}
