import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'wouter';
import { AlertIcon, ArrowLeftIcon, CheckIcon, ScanIcon, SearchIcon } from '@/components/icons';
import { Button, cx, Spinner } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { adminPayApi, checkinApi, rupees, type LookupHit, type ScanOutcome } from '@/lib/ems-api';
import { useQuery } from '@/lib/query';
import { createFrameReader, deviceId, type FrameReader } from '@/lib/qr-scan';

type Flash = ScanOutcome | { result: 'OFFLINE'; message: string };

const LOOK: Record<Flash['result'], { title: string; bg: string; ok?: boolean }> = {
  OK: { title: 'Admitted', bg: 'bg-emerald-600 text-white', ok: true },
  PAYMENT_DUE: { title: 'Payment due', bg: 'bg-amber-400 text-amber-950' },
  ALREADY_USED: { title: 'Already checked in', bg: 'bg-amber-400 text-amber-950' },
  WRONG_EVENT: { title: 'Wrong event', bg: 'bg-red-600 text-white' },
  INVALID_TICKET: { title: 'Not a valid ticket', bg: 'bg-red-600 text-white' },
  VOID_TICKET: { title: 'Ticket cancelled', bg: 'bg-red-600 text-white' },
  NOT_YET_OPEN: { title: 'Check-in not open yet', bg: 'bg-red-600 text-white' },
  OFFLINE: { title: 'No connection', bg: 'bg-slate-700 text-white' },
};

/**
 * Gate scanner for one event. Always dark (glare, battery). Camera → QR → server decides
 * (signature, event, payment, used) → a full-screen colour flash with the holder's name, so a
 * volunteer can glance and wave people through. Valid entries clear themselves after 1.5 s.
 */
export default function ScanEvent() {
  const { eventId } = useParams<{ eventId: string }>();
  const summary = useQuery(`gate:summary:${eventId}`, () => checkinApi.summary(eventId), { staleMs: 10_000 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'denied' | 'unavailable'>('off');
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const last = useRef<{ value: string; at: number } | null>(null);
  const reader = useRef<FrameReader | null>(null);
  const device = useRef(deviceId());

  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);

  const submit = useCallback(
    async (body: { qr?: string; code?: string }) => {
      setBusy(true);
      try {
        const out = await checkinApi.scan(eventId, { ...body, deviceId: device.current });
        navigator.vibrate?.(out.result === 'OK' ? 80 : [200, 100, 200]);
        setFlash(out);
        if (out.result === 'OK') summary.refetch();
      } catch (e) {
        setFlash(
          e instanceof ApiError && e.status === 0
            ? { result: 'OFFLINE', message: 'Scans need the internet to check the ticket. Check Wi-Fi or mobile data, then scan again.' }
            : { result: 'INVALID_TICKET', message: e instanceof ApiError ? e.message : 'Something went wrong' },
        );
      } finally {
        setBusy(false);
      }
    },
    // summary.refetch is stable enough for this page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventId],
  );

  // Valid entries clear themselves so the next person can step up.
  useEffect(() => {
    if (flash?.result !== 'OK') return;
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [flash]);

  async function startCamera() {
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      reader.current = (await createFrameReader()).read;
      setCamera('on');
    } catch (e) {
      setCamera((e as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
    }
  }

  // Stop the camera when leaving the page.
  useEffect(
    () => () => {
      const s = videoRef.current?.srcObject as MediaStream | null;
      s?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  // Read frames ~6 times a second while nothing is on screen. The same QR is ignored for 4 s
  // after its result, so a pass held in front of the camera isn't scanned twice.
  useEffect(() => {
    if (camera !== 'on' || flash || busy) return;
    let stop = false;
    const tick = async () => {
      if (stop || !reader.current || !videoRef.current) return;
      const value = await reader.current(videoRef.current).catch(() => null);
      if (stop) return;
      if (value && !(last.current?.value === value && Date.now() - last.current.at < 4000)) {
        last.current = { value, at: Date.now() };
        void submit({ qr: value });
        return;
      }
      setTimeout(tick, 160);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [camera, flash, busy, submit]);

  const s = summary.data;

  return (
    <div className="dark min-h-dvh bg-black text-fg">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <Link href="/scan" aria-label="Back to events" className="grid size-10 place-items-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white">
          <ArrowLeftIcon className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-white">{s?.event.name ?? 'Check-in'}</p>
          <p className="truncate text-xs text-white/60">{s?.event.venue ?? ' '}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold tabular-nums text-white">
            {s?.checkedIn ?? '–'}
            <span className="text-sm font-medium text-white/50">/{s?.expected ?? '–'}</span>
          </p>
          <p className="text-[11px] text-white/50">checked in</p>
        </div>
      </header>

      {!online && <p className="bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950">Offline: scans need the internet to check tickets</p>}

      <main className="mx-auto max-w-md px-4 py-4">
        <div className="relative aspect-square overflow-hidden rounded-3xl bg-white/5">
          <video ref={videoRef} playsInline muted className={cx('size-full object-cover', camera !== 'on' && 'invisible')} />
          {camera === 'on' ? (
            // Framing guide
            <div aria-hidden className="pointer-events-none absolute inset-[18%] rounded-3xl border-4 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/.35)]" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
              <ScanIcon className="size-12 text-white/40" />
              {camera === 'denied' ? (
                <p className="text-sm text-white/70">Camera access was blocked. Allow the camera for this site in your browser settings, or enter codes below.</p>
              ) : camera === 'unavailable' ? (
                <p className="text-sm text-white/70">No camera available here. Enter ticket codes below instead.</p>
              ) : (
                <Button block={false} className="h-14 px-8 text-base" onClick={startCamera} loading={camera === 'starting'}>
                  Start scanning
                </Button>
              )}
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-black/40">
              <Spinner className="size-8 text-white" />
            </div>
          )}
        </div>

        <ManualEntry eventId={eventId} onAdmit={(code) => submit({ code })} />

        {s && (
          <p className="mt-6 text-center text-xs text-white/50">
            Your shift: {s.shift.admitted} admitted · {s.shift.scans} scans{s.shift.cashCount > 0 && ` · ${rupees(s.shift.cashPaise)} collected`}
            {s.paymentDue > 0 && ` · ${s.paymentDue} still to pay at the desk`}
          </p>
        )}
      </main>

      {flash && <FlashScreen flash={flash} onClose={() => setFlash(null)} onCollected={(code) => submit({ code })} />}
    </div>
  );
}

function FlashScreen({ flash, onClose, onCollected }: { flash: Flash; onClose: () => void; onCollected: (ticketCode: string) => void }) {
  const look = LOOK[flash.result];
  const holder = 'holder' in flash ? flash.holder : undefined;
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = 'amountPaise' in flash ? flash.amountPaise : undefined;

  async function collect() {
    if (!holder || !amount) return;
    setCollecting(true);
    setError(null);
    try {
      await adminPayApi.collect(holder.registrationCode, amount);
    } catch (e) {
      // Already recorded (e.g. a retry after a network blip) is fine: admit.
      if (!(e instanceof ApiError && e.code === 'ALREADY_PAID')) {
        setError(e instanceof ApiError ? e.message : 'Could not record the payment');
        setCollecting(false);
        return;
      }
    }
    onCollected(holder.ticketCode);
  }

  return (
    <div role="alertdialog" aria-live="assertive" aria-label={look.title} className={cx('fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 p-8 text-center', look.bg)} onClick={look.ok ? onClose : undefined}>
      <span className="grid size-24 place-items-center rounded-full bg-black/10">{look.ok ? <CheckIcon className="size-14" /> : <AlertIcon className="size-14" />}</span>
      <div>
        <p className="text-sm font-bold uppercase tracking-[.2em] opacity-80">{look.title}</p>
        {holder && <p className="mt-2 text-3xl font-bold leading-tight">{holder.name}</p>}
        <p className="mx-auto mt-3 max-w-xs text-base font-medium opacity-90">{flash.message}</p>
        {holder && <p className="mt-2 font-mono text-sm opacity-70">{holder.ticketCode}</p>}
        {error && <p className="mx-auto mt-3 max-w-xs rounded-xl bg-black/15 px-3 py-2 text-sm font-semibold">{error}</p>}
      </div>
      {!look.ok && (
        <div className="flex w-full max-w-xs flex-col gap-3">
          {flash.result === 'PAYMENT_DUE' && amount ? (
            <button type="button" onClick={collect} disabled={collecting} className="h-14 rounded-2xl bg-amber-950 text-lg font-bold text-amber-50 disabled:opacity-60">
              {collecting ? 'Recording…' : `${rupees(amount)} received: admit`}
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="h-14 rounded-2xl bg-black/15 text-lg font-bold">
            {flash.result === 'PAYMENT_DUE' ? 'Not paid: next' : 'Next'}
          </button>
        </div>
      )}
    </div>
  );
}

/** When a QR won't scan: type a ticket code, or find the person by email / phone / registration code. */
function ManualEntry({ eventId, onAdmit }: { eventId: string; onAdmit: (ticketCode: string) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<LookupHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function find(ev: React.FormEvent) {
    ev.preventDefault();
    const term = q.trim();
    if (term.length < 3) return;
    if (/^TCK-[A-Z0-9]{4}-[A-Z0-9]{2}$/i.test(term)) {
      onAdmit(term.toUpperCase());
      setQ('');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setHits((await checkinApi.lookup(eventId, term)).items);
    } catch (e) {
      setHits(null);
      setError(e instanceof ApiError ? e.message : 'Lookup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5">
      <form onSubmit={find} className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Ticket code, email or phone</span>
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-white/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ticket code, email or phone"
            autoCapitalize="characters"
            className="h-14 w-full rounded-2xl border border-white/10 bg-white/5 pl-11 pr-3 text-base text-white placeholder:text-white/40 focus:border-indigo-400 focus:outline-none"
          />
        </label>
        <button type="submit" disabled={busy} className="h-14 shrink-0 rounded-2xl bg-white/10 px-5 font-semibold text-white hover:bg-white/15 disabled:opacity-60">
          {busy ? <Spinner className="size-5" /> : 'Find'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      {hits && (
        <ul className="mt-3 divide-y divide-white/10 rounded-2xl border border-white/10">
          {hits.length === 0 && <li className="p-4 text-sm text-white/60">Nobody found for this event.</li>}
          {hits.map((h) => (
            <li key={h.code} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">{h.holder}</p>
                <p className="truncate font-mono text-xs text-white/50">
                  {h.code} · {h.registrationCode}
                </p>
              </div>
              {h.status === 'USED' ? (
                <span className="text-xs font-semibold text-amber-300">Checked in</span>
              ) : h.status === 'VOID' ? (
                <span className="text-xs font-semibold text-red-300">Cancelled</span>
              ) : (
                <button type="button" onClick={() => onAdmit(h.code)} className="h-11 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white">
                  {h.status === 'PAYMENT_PENDING' ? 'Check' : 'Admit'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
