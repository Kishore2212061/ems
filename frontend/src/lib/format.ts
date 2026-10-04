// Display formatting. Everything is shown in the college's timezone, whatever the device says.
const TZ = 'Asia/Kolkata';

const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: TZ });
const dayYear = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const dateTime = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });

export const fmtDate = (iso?: string | null) => (iso ? dayYear.format(new Date(iso)) : '—');
export const fmtDateTime = (iso?: string | null) => (iso ? dateTime.format(new Date(iso)) : '—');

/** "14 – 15 Mar 2027", "28 Feb – 2 Mar 2027" or "Dates TBA". */
export function fmtRange(start?: string | null, end?: string | null) {
  if (!start) return 'Dates TBA';
  const s = new Date(start);
  const e = end ? new Date(end) : s;
  const same = dayYear.format(s) === dayYear.format(e);
  if (same) return dayYear.format(s);
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  return sameMonth ? `${s.toLocaleString('en-IN', { day: 'numeric', timeZone: TZ })} – ${dayYear.format(e)}` : `${day.format(s)} – ${dayYear.format(e)}`;
}

const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const clock = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const time = (d: Date) => clock.format(d).toUpperCase();

/** "Fri, 14 Mar · 1:30 PM", "Fri, 14 Mar · 10:00 AM – 12:30 PM", across days: "Fri, 14 Mar 2:00 PM – Sat, 15 Mar 5:15 PM". */
export function fmtWhen(start?: string | null, end?: string | null) {
  if (!start) return 'Time TBA';
  const s = new Date(start);
  if (!end) return `${weekday.format(s)} · ${time(s)}`;
  const e = new Date(end);
  return weekday.format(s) === weekday.format(e) ? `${weekday.format(s)} · ${time(s)} – ${time(e)}` : `${weekday.format(s)} ${time(s)} – ${weekday.format(e)} ${time(e)}`;
}

const wd = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: TZ });

/** "Fri, 12 Mar" for a college-time calendar day ("2027-03-12"). */
export const fmtDay = (day: string) => weekday.format(new Date(`${day}T12:00:00+05:30`));
/** "9:30 AM" */
export const fmtTime = (iso: string) => time(new Date(iso));

/** For lists already grouped by day: "9:30 AM – 12:30 PM", "9:30 AM", across days "9:00 AM – Sat 5:00 PM". */
export function fmtTimeRange(start?: string | null, end?: string | null) {
  if (!start) return 'Time TBA';
  const s = new Date(start);
  if (!end) return time(s);
  const e = new Date(end);
  return weekday.format(s) === weekday.format(e) ? `${time(s)} – ${time(e)}` : `${time(s)} – ${wd.format(e)} ${time(e)}`;
}

/** "9:41" left of a countdown. */
export const fmtCountdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}

/** <input type="datetime-local"> ⇄ ISO (the input works in the device's local time). */
export function toLocalInput(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/** Very small UA → "Chrome on Windows" for the sessions list (no UA-parser library). */
export function describeDevice(ua?: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  return `${browser} on ${os}`;
}
