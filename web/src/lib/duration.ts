// "6:00" -> 6, "25:00" -> 25, "1:05:00" -> 65 (minutes); calculate-ve.ipynb's to_minutes
export function toMinutes(s: string) {
  const parts = String(s).split(":").map(Number);
  return parts.reduce((sum, p, i) => sum + p * 60 ** (parts.length - 2 - i), 0);
}

export function isDuration(s: string) {
  return /^\d{1,3}(:[0-5]\d){1,2}$/.test(s.trim()) && toMinutes(s) > 0;
}
