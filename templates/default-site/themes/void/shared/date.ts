const englishDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const englishMonthDayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatDate(value: string): string {
  return englishDateFormatter.format(new Date(value));
}

export function formatMonthDay(value: string): string {
  return englishMonthDayFormatter.format(new Date(value));
}

export function yearOf(value: string): number {
  return new Date(value).getUTCFullYear();
}
