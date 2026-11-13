export function ordinal(n) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

export function duration(totalSeconds) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function hms(totalSeconds) {
  const s = Math.round(totalSeconds);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function hm(totalMinutes) {
  const m = Math.round(totalMinutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export function clockTime(secondsOfDay) {
  return hm(secondsOfDay / 60);
}
