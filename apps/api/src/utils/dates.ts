/** Plain "YYYY-MM-DD" UTC date strings — matches how `dailyStats.day` (a Postgres `date` column) round-trips through drizzle. */

export function todayUTCDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysUTC(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function daysBetweenUTC(a: string, b: string): number {
  const msA = new Date(`${a}T00:00:00.000Z`).getTime();
  const msB = new Date(`${b}T00:00:00.000Z`).getTime();
  return Math.round((msB - msA) / 86_400_000);
}
