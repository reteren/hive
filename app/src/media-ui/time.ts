export function formatMediaTime(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = hours > 0 ? totalMinutes % 60 : totalMinutes;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
