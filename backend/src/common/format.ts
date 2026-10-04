/** Text for emails, always in college time (the server's own timezone doesn't matter). */
const TZ = 'Asia/Kolkata';
const fmtDay = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const fmtTime = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const time = (d: Date) => fmtTime.format(d).toUpperCase();

/** "Fri, 12 Mar, 9:30 AM – 12:30 PM" (or across days). */
export const whenText = (s: Date, e: Date | null) =>
  !e ? `${fmtDay.format(s)}, ${time(s)}` : fmtDay.format(s) === fmtDay.format(e) ? `${fmtDay.format(s)}, ${time(s)} – ${time(e)}` : `${fmtDay.format(s)} ${time(s)} – ${fmtDay.format(e)} ${time(e)}`;

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** "Asha Raman" → "A. R." (public pages never show full names). */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => `${w[0].toUpperCase()}.`)
    .join(' ');
