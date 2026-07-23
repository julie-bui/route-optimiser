export function roundUpToFiveMinutes(date: Date): Date {
  const ms = 5 * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

export function roundUpMinutesToFive(minutes: number): number {
  return Math.ceil(minutes / 5) * 5;
}

export function formatRoundedTime(isoString: string): string {
  const date = new Date(isoString);
  const rounded = roundUpToFiveMinutes(date);
  return rounded.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
