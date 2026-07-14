const englishDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(value: string): string {
  return englishDateFormatter.format(new Date(value));
}
