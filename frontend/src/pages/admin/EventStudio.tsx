import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { EmptyState, Skeleton } from '@/components/data';
import { TrashIcon, UploadIcon, XIcon } from '@/components/event-icons';
import { CalendarIcon, CopyIcon, ExternalIcon, MapPinIcon, PlusIcon } from '@/components/icons';
import { Badge, Card, PageHeader } from '@/components/layout';
import { ConfirmDialog, Dialog } from '@/components/overlay';
import { toast } from '@/components/toast';
import { Alert, Button, cx, Field, SelectField, Spinner, TextareaField } from '@/components/ui';
import { ApiError } from '@/lib/api';
import {
  CATEGORY_LABEL,
  EVENT_STATUS_LABEL,
  EVENT_STATUS_TONE,
  eventApi,
  festApi,
  mediaApi,
  type Coordinator,
  type EventCategory,
  type EventDetail,
  type EventInput,
  type FestDetail,
} from '@/lib/ems-api';
import { fromLocalInput, toLocalInput } from '@/lib/format';
import { cardImage, isExternalImage, isImageUrl, MAX_UPLOAD_BYTES } from '@/lib/media';
import { canOnEvent, eventDepartmentsFor } from '@/lib/permissions';
import { invalidate, setQueryData, useQuery } from '@/lib/query';
import { useSubmit } from '@/lib/use-submit';
import { useAuth } from '@/store/auth';

// ── form model (strings for inputs) ⇄ API input ──────────────────────────────
interface Form {
  name: string;
  tagline: string;
  category: EventCategory;
  departmentId: string; // '' = fest-wide
  organizer: string;
  tags: string;
  description: string;
  rules: string;
  participation: 'INDIVIDUAL' | 'TEAM';
  teamMin: string;
  teamMax: string;
  priceType: 'FREE' | 'PAID';
  price: string; // rupees
  per: 'TEAM' | 'MEMBER';
  payOnline: boolean;
  payDesk: boolean;
  online: boolean;
  seatsTotal: string; // '' = no limit
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  venue: string;
  bannerUrl: string;
  coordinators: { name: string; phone: string; role: Coordinator['role'] }[];
  rpName: string;
  rpDesignation: string;
  rpOrganization: string;
  rpBio: string;
}

export const toForm = (e: EventDetail | undefined, defaultDept: string): Form => ({
  name: e?.name ?? '',
  tagline: e?.tagline ?? '',
  category: e?.category ?? 'TECHNICAL',
  departmentId: e ? (e.department?.id ?? '') : defaultDept,
  organizer: e?.organizer ?? '',
  tags: e?.tags.join(', ') ?? '',
  description: e?.description ?? '',
  rules: e?.rules.join('\n') ?? '',
  participation: e?.participation ?? 'INDIVIDUAL',
  teamMin: String(e?.teamMin ?? 2),
  teamMax: String(e?.teamMax ?? (e?.participation === 'TEAM' ? e.teamMax : 4)),
  priceType: e?.pricing.type ?? 'FREE',
  price: e && e.pricing.type === 'PAID' ? String(e.pricing.amountPaise / 100) : '',
  per: e?.pricing.per ?? 'TEAM',
  payOnline: e?.pricing.type === 'PAID' ? e.pricing.modes.includes('ONLINE') : true,
  payDesk: e?.pricing.type === 'PAID' ? e.pricing.modes.includes('OFFLINE') : false,
  online: e?.online ?? false,
  seatsTotal: e?.seatsTotal != null ? String(e.seatsTotal) : '',
  startsAt: toLocalInput(e?.startsAt),
  endsAt: toLocalInput(e?.endsAt),
  registrationOpensAt: toLocalInput(e?.registrationOpensAt),
  registrationClosesAt: toLocalInput(e?.registrationClosesAt),
  venue: e?.venue ?? '',
  bannerUrl: e?.bannerUrl ?? '',
  coordinators: e?.coordinators.map((c) => ({ name: c.name, phone: c.phone ?? '', role: c.role })) ?? [],
  rpName: e?.resourcePerson?.name ?? '',
  rpDesignation: e?.resourcePerson?.designation ?? '',
  rpOrganization: e?.resourcePerson?.organization ?? '',
  rpBio: e?.resourcePerson?.bio ?? '',
});

const opt = (v: string) => v.trim() || null;

export function toInput(f: Form): EventInput {
  const team = f.participation === 'TEAM';
  return {
    name: f.name.trim(),
    tagline: opt(f.tagline),
    category: f.category,
    departmentId: f.departmentId || null,
    organizer: opt(f.organizer),
    tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
    description: f.description.trim(),
    rules: f.rules.split('\n').map((r) => r.trim()).filter(Boolean),
    participation: f.participation,
    teamMin: team ? Number(f.teamMin) : 1,
    teamMax: team ? Number(f.teamMax) : 1,
    pricing: {
      type: f.priceType,
      amountPaise: f.priceType === 'PAID' ? Math.round(Number(f.price) * 100) : 0,
      per: team ? f.per : 'MEMBER',
      // Canonical order, so an untouched form never looks changed.
      modes: f.priceType === 'PAID' ? [...(f.payOnline ? (['ONLINE'] as const) : []), ...(f.payDesk ? (['OFFLINE'] as const) : [])] : [],
    },
    online: f.online,
    seatsTotal: f.seatsTotal.trim() ? Number(f.seatsTotal) : null,
    startsAt: fromLocalInput(f.startsAt),
    endsAt: fromLocalInput(f.endsAt),
    registrationOpensAt: fromLocalInput(f.registrationOpensAt),
    registrationClosesAt: fromLocalInput(f.registrationClosesAt),
    venue: opt(f.venue),
    bannerUrl: opt(f.bannerUrl),
    coordinators: f.coordinators.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), phone: opt(c.phone), role: c.role })),
    resourcePerson: f.rpName.trim() ? { name: f.rpName.trim(), designation: opt(f.rpDesignation), organization: opt(f.rpOrganization), bio: opt(f.rpBio) } : null,
  };
}

/** Only what changed, so a save never rewrites fields someone else may be editing. */
export function changes(before: EventInput, after: EventInput): EventInput {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(after) as (keyof EventInput)[]) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = after[k];
  return out as EventInput;
}

function validate(f: Form) {
  const e: Record<string, string> = {};
  if (f.name.trim().length < 3) e.name = 'Enter the event name';
  const min = Number(f.teamMin);
  const max = Number(f.teamMax);
  if (f.participation === 'TEAM') {
    if (!Number.isInteger(min) || min < 1 || min > 20) e.teamMin = 'Between 1 and 20';
    if (!Number.isInteger(max) || max < 1 || max > 20) e.teamMax = 'Between 1 and 20';
    else if (max < min) e.teamMax = 'At least the minimum';
  }
  if (f.priceType === 'PAID' && !(Number(f.price) >= 1)) e.price = 'Enter a price of at least ₹1';
  if (f.priceType === 'PAID' && !f.payOnline && !f.payDesk) e.modes = 'Choose at least one way to pay';
  if (f.seatsTotal.trim() && !(Number.isInteger(Number(f.seatsTotal)) && Number(f.seatsTotal) >= 1)) e.seatsTotal = 'Enter a whole number, or leave empty for no limit';
  if (f.startsAt && f.endsAt && f.endsAt < f.startsAt) e.endsAt = 'End must be after start';
  if (f.registrationClosesAt && f.startsAt && f.registrationClosesAt > f.startsAt) e.registrationClosesAt = 'Must close before the event starts';
  if (f.registrationOpensAt && f.registrationClosesAt && f.registrationClosesAt <= f.registrationOpensAt) e.registrationClosesAt = 'Must close after it opens';
  if (f.bannerUrl.trim() && !isImageUrl(f.bannerUrl.trim())) e.bannerUrl = 'Use an https:// image URL';
  f.coordinators.forEach((c, i) => {
    if (c.phone.trim() && !/^[6-9]\d{9}$/.test(c.phone.trim())) e[`coordinators.${i}.phone`] = 'Enter a 10-digit mobile number';
  });
  return e;
}

/** API error keys → form field names. */
const fieldKey = (k: string) => (k === 'pricing.amountPaise' ? 'price' : k === 'pricing.modes' ? 'modes' : k);

const MISSING: Record<string, string> = { startsAt: 'a start time', venue: 'a venue (or mark it online)', description: 'a description' };
function explain(e: unknown) {
  if (e instanceof ApiError && e.code === 'PUBLISH_REQUIREMENTS') {
    const missing = ((e.details as { missing?: string[] })?.missing ?? []).map((m) => MISSING[m] ?? m);
    return new Error(`Add ${missing.join(', ')} first.`);
  }
  return e;
}

function Segmented<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-line bg-surface-2 p-1">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={cx('h-9 rounded-lg px-4 text-sm font-semibold transition-colors', value === v ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const Section = ({ title, description, children }: { title: string; description?: string; children: ReactNode }) => (
  <Card title={title} description={description}>
    <div className="space-y-5">{children}</div>
  </Card>
);

type Action = 'publish' | 'suspend' | 'reactivate' | 'complete' | 'cancel' | 'delete' | null;

export default function EventStudio() {
  const { festId, eventId } = useParams<{ festId: string; eventId: string }>();
  const isNew = eventId === 'new';
  const [, navigate] = useLocation();
  const user = useAuth((s) => s.user);
  const fest = useQuery(`admin:fest:${festId}`, () => festApi.get(festId));
  const key = `admin:event:${eventId}`;
  const ev = useQuery(isNew ? null : key, () => eventApi.get(eventId));

  if (fest.error || ev.error) {
    const err = fest.error ?? ev.error!;
    return (
      <Card>
        <EmptyState
          icon={CalendarIcon}
          title={err.status === 404 ? 'Not found' : "Couldn't load this event"}
          description={err.status === 404 ? 'It may have been deleted, or it is outside your scope.' : err.message}
          action={<Link href={`/admin/events/${festId}`} className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Back to the fest</Link>}
        />
      </Card>
    );
  }
  if (!fest.data || (!isNew && !ev.data)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  const allowed = eventDepartmentsFor(user, festId, fest.data.departments.map((d) => d.id));
  return (
    <Studio
      key={ev.data?.version ?? 'new'}
      fest={fest.data}
      event={ev.data}
      allowed={allowed}
      canEdit={isNew ? allowed.length > 0 : canOnEvent(user, 'local_event.manage', festId, ev.data!.department?.id ?? null)}
      canPublish={!isNew && canOnEvent(user, 'local_event.publish', festId, ev.data!.department?.id ?? null)}
      canCancel={!isNew && canOnEvent(user, 'local_event.cancel', festId, ev.data!.department?.id ?? null)}
      onSaved={(next, created) => {
        setQueryData(`admin:event:${next.id}`, next);
        invalidate(`admin:events:${festId}`);
        invalidate('public:');
        if (created) navigate(`/admin/events/${festId}/local/${next.id}`, { replace: true });
      }}
      onReload={() => ev.refetch()}
    />
  );
}

function Studio({
  fest,
  event: e,
  allowed,
  canEdit,
  canPublish,
  canCancel,
  onSaved,
  onReload,
}: {
  fest: FestDetail;
  event?: EventDetail;
  allowed: (string | null)[];
  canEdit: boolean;
  canPublish: boolean;
  canCancel: boolean;
  onSaved: (e: EventDetail, created?: boolean) => void;
  onReload: () => void;
}) {
  const [, navigate] = useLocation();
  // New events default to the user's (first) department; fest-wide only if that's all they can do.
  const defaultDept = (allowed.find((d) => d !== null) as string | undefined) ?? '';
  const initial = useMemo(() => toForm(e, defaultDept), [e, defaultDept]);
  const [form, setForm] = useState<Form>(initial);
  const [stale, setStale] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState('');
  const save = useSubmit();
  const [uploading, setUploading] = useState(false);

  /** A pasted image link is compressed right away, so the preview (and the save) use the small copy. */
  async function importLink(raw: string) {
    const url = raw.trim();
    if (!isExternalImage(url) || uploading) return;
    setUploading(true);
    try {
      const r = await mediaApi.importPoster(url);
      setForm((f) => (f.bannerUrl.trim() === url ? { ...f, bannerUrl: r.url } : f)); // unless they typed something else meanwhile
      save.clearField('bannerUrl');
      toast.success('Image imported and compressed');
    } catch (err) {
      const msg = err instanceof ApiError ? (err.details?.fields?.url ?? err.message) : "Couldn't import that image";
      save.setFields({ ...save.fields, bannerUrl: msg });
    } finally {
      setUploading(false);
    }
  }

  async function onFile(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = ''; // picking the same file again should still fire
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return void toast.error('Images must be under 10 MB');
    setUploading(true);
    try {
      const { url } = await mediaApi.uploadPoster(file);
      setForm((f) => ({ ...f, bannerUrl: url }));
      save.clearField('bannerUrl');
      toast.success(e ? 'Image uploaded. Save to use it.' : 'Image uploaded');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const closed = e?.status === 'CANCELLED' || e?.status === 'COMPLETED' || fest.status === 'COMPLETED' || fest.status === 'CANCELLED';
  const readOnly = !canEdit || closed;
  const before = useMemo(() => toInput(initial), [initial]);
  const diff = changes(before, toInput(form));
  const dirty = Object.keys(diff).length > 0;
  const team = form.participation === 'TEAM';
  const taken = (e?.seatsConfirmed ?? 0) + (e?.seatsHeld ?? 0);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    save.clearField(k);
  };
  const bind = (k: keyof Form) => ({
    value: form[k] as string,
    onChange: (ev: { target: { value: string } }) => set(k, ev.target.value as never),
    error: save.fields[k],
    disabled: readOnly,
  });

  async function submit(ev?: FormEvent) {
    ev?.preventDefault();
    const errs = validate(form);
    if (Object.keys(errs).length) {
      save.setFields(errs);
      toast.error('Fix the highlighted fields');
      return;
    }
    const r = await save.run(async () => {
      try {
        return e ? await eventApi.update(e.id, { ...diff, version: e.version! }) : await eventApi.create(fest.id, toInput(form));
      } catch (err) {
        if (err instanceof ApiError && err.code === 'STALE_VERSION') setStale(true);
        if (err instanceof ApiError && err.details?.fields) {
          // Map API keys onto form fields so the message lands next to the right input.
          throw new ApiError(err.status, err.code, err.message, { fields: Object.fromEntries(Object.entries(err.details.fields as Record<string, string>).map(([k, v]) => [fieldKey(k), v])) });
        }
        throw explain(err);
      }
    });
    if (r) {
      toast.success(e ? 'Changes saved' : 'Draft created');
      onSaved(r, !e);
    } else toast.error("Couldn't save. Check the messages on the form.");
  }

  const run = async (fn: () => Promise<EventDetail>, msg: string) => {
    try {
      const next = await fn();
      toast.success(msg);
      onSaved(next);
    } catch (err) {
      throw explain(err);
    }
  };

  const deptOptions = fest.departments.filter((d) => allowed.includes(d.id) || d.id === e?.department?.id);
  const status = e?.status ?? 'DRAFT';
  const publicHref = e && fest.status !== 'DRAFT' && status !== 'DRAFT' ? `/events/${fest.slug}/${e.slug}` : null;

  return (
    <form onSubmit={submit} noValidate className="pb-24">
      <PageHeader
        back={{ href: `/admin/events/${fest.id}`, label: fest.name }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {e ? e.name : 'New event'}
            {e && (
              <Badge tone={EVENT_STATUS_TONE[status]} dot>
                {EVENT_STATUS_LABEL[status]}
              </Badge>
            )}
          </span>
        }
        description={e ? `/${fest.slug}/${e.slug}` : 'Starts as a draft. Nothing is public until you publish it.'}
        actions={
          e && (
            <>
              {publicHref && (
                <a href={publicHref} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-fg">
                  <ExternalIcon className="size-4" /> View
                </a>
              )}
              {canEdit && !closed && (
                <Button size="sm" block={false} variant="secondary" onClick={async () => {
                  try {
                    const copy = await eventApi.clone(e.id);
                    invalidate(`admin:events:${fest.id}`);
                    toast.success('Duplicated as a draft');
                    navigate(`/admin/events/${fest.id}/local/${copy.id}`);
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}>
                  <CopyIcon className="size-4" /> Duplicate
                </Button>
              )}
              {canEdit && status === 'DRAFT' && !e.publishedAt && (
                <Button size="sm" block={false} variant="ghost" onClick={() => setAction('delete')} aria-label="Delete draft">
                  <TrashIcon className="size-4" />
                </Button>
              )}
              {canCancel && ['DRAFT', 'PUBLISHED', 'SUSPENDED'].includes(status) && !(status === 'DRAFT' && !e.publishedAt) && (
                <Button size="sm" block={false} variant="secondary" onClick={() => { setReason(''); setAction('cancel'); }}>
                  Cancel event
                </Button>
              )}
              {canPublish && status === 'PUBLISHED' && (
                <Button size="sm" block={false} variant="secondary" onClick={() => { setReason(''); setAction('suspend'); }}>
                  Pause
                </Button>
              )}
              {canPublish && (status === 'PUBLISHED' || status === 'SUSPENDED') && (
                <Button size="sm" block={false} variant="secondary" onClick={() => setAction('complete')}>
                  Mark completed
                </Button>
              )}
              {canPublish && status === 'SUSPENDED' && <Button size="sm" block={false} onClick={() => setAction('reactivate')}>Resume</Button>}
              {canPublish && status === 'DRAFT' && !closed && (
                <Button size="sm" block={false} onClick={() => setAction('publish')} disabled={dirty} title={dirty ? 'Save your changes first' : undefined}>
                  Publish
                </Button>
              )}
            </>
          )
        }
      />

      <div className="space-y-6">
        {stale && (
          <Alert>
            Someone else saved this event while you were editing.{' '}
            <button type="button" className="font-semibold underline" onClick={() => { setStale(false); onReload(); }}>
              Load the latest version
            </button>
          </Alert>
        )}
        {e?.statusReason && (status === 'SUSPENDED' || status === 'CANCELLED') && <Alert tone="info">{status === 'SUSPENDED' ? 'Paused' : 'Cancelled'}: {e.statusReason}</Alert>}
        {closed && e && <Alert tone="info">This event is {status === 'CANCELLED' ? 'cancelled' : fest.status === 'COMPLETED' || status === 'COMPLETED' ? 'over' : 'closed'}, so it can no longer be edited.</Alert>}
        {!canEdit && !closed && <Alert tone="info">You can view this event but not edit it.</Alert>}
        {save.error && <Alert>{save.error}</Alert>}

        <Section title="Basics">
          <Field label="Event name" maxLength={120} placeholder="e.g. Blind Coding" {...bind('name')} />
          <Field label="Tagline" maxLength={160} placeholder="One line that sells it" {...bind('tagline')} />
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField label="Category" {...bind('category')}>
              {(Object.keys(CATEGORY_LABEL) as EventCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </SelectField>
            <SelectField label="Run by" {...bind('departmentId')} disabled={readOnly || (deptOptions.length + (allowed.includes(null) ? 1 : 0) < 2)}>
              {(allowed.includes(null) || (e && !e.department)) && <option value="">Whole fest (no department)</option>}
              {deptOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} · {d.name}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Co-hosting club (optional)" maxLength={80} placeholder="e.g. IEEE CS" {...bind('organizer')} />
            <Field label="Tags" maxLength={300} placeholder="Coding, Problem solving" hint={<span className="text-xs text-subtle">Comma separated, up to 8</span>} {...bind('tags')} />
          </div>
        </Section>

        <Section title="Schedule & venue" description="Times are in IST.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Starts" type="datetime-local" {...bind('startsAt')} />
            <Field label="Ends (optional)" type="datetime-local" {...bind('endsAt')} />
          </div>
          <Field label="Venue" icon={MapPinIcon} maxLength={160} placeholder="e.g. UG III / IT" {...bind('venue')} />
          <label className="flex items-center gap-3 text-sm font-medium text-fg-2">
            <input type="checkbox" checked={form.online} disabled={readOnly} onChange={(ev) => set('online', ev.target.checked)} className="size-4 accent-indigo-600" />
            Can be attended online
          </label>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Registration opens (optional)" type="datetime-local" {...bind('registrationOpensAt')} />
            <Field label="Registration closes (optional)" type="datetime-local" {...bind('registrationClosesAt')} />
          </div>
        </Section>

        <Section title="Participation & seats">
          <Segmented<Form['participation']> label="Participation" value={form.participation} disabled={readOnly} onChange={(v) => set('participation', v)} options={[['INDIVIDUAL', 'Individual'], ['TEAM', 'Team']]} />
          {team && (
            <div className="grid grid-cols-2 gap-5 sm:max-w-sm">
              <Field label="Min members" type="number" inputMode="numeric" min={1} max={20} {...bind('teamMin')} />
              <Field label="Max members" type="number" inputMode="numeric" min={1} max={20} {...bind('teamMax')} />
            </div>
          )}
          <Field
            label={team ? 'Seats (teams)' : 'Seats'}
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="No limit"
            className="sm:max-w-xs"
            hint={taken > 0 ? <span className="text-xs text-subtle">{taken} already taken</span> : undefined}
            {...bind('seatsTotal')}
          />
        </Section>

        <Section title="Entry fee">
          <Segmented<Form['priceType']> label="Entry fee" value={form.priceType} disabled={readOnly} onChange={(v) => set('priceType', v)} options={[['FREE', 'Free'], ['PAID', 'Paid']]} />
          {form.priceType === 'PAID' && (
            <div className="grid gap-5 sm:max-w-md sm:grid-cols-2">
              <Field label="Price" type="number" inputMode="decimal" min={1} prefix="₹" {...bind('price')} />
              {team && (
                <SelectField label="Charged" {...bind('per')}>
                  <option value="TEAM">Per team</option>
                  <option value="MEMBER">Per member</option>
                </SelectField>
              )}
            </div>
          )}
          {form.priceType === 'PAID' && (
            <fieldset>
              <legend className="text-sm font-semibold text-fg-2">How can people pay?</legend>
              <div className="mt-2 flex flex-col gap-2.5 sm:flex-row sm:gap-6">
                {(
                  [
                    ['payOnline', 'Online, while registering'],
                    ['payDesk', 'At the registration desk'],
                  ] as const
                ).map(([k, text]) => (
                  <label key={k} className="flex items-center gap-3 text-sm font-medium text-fg-2">
                    <input
                      type="checkbox"
                      checked={form[k]}
                      disabled={readOnly}
                      onChange={(ev) => {
                        set(k, ev.target.checked);
                        save.clearField('modes');
                      }}
                      className="size-4 accent-indigo-600"
                    />
                    {text}
                  </label>
                ))}
              </div>
              {save.fields.modes && <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{save.fields.modes}</p>}
            </fieldset>
          )}
          {e && (e.priceVersion ?? 0) > 0 && <p className="text-xs text-subtle">Price changed {e.priceVersion} time(s). People who registered earlier keep the price they saw.</p>}
        </Section>

        <Section title="Description & rules" description="Shown as plain text on the event page.">
          <TextareaField label="About the event" rows={6} maxLength={5000} placeholder="What happens, who it's for, what to bring" {...bind('description')} />
          <TextareaField label="Rules & format" rows={6} placeholder={'Round 1: Online quiz (15 minutes)\nRound 2: …'} hint={<span className="text-xs text-subtle">One rule per line</span>} {...bind('rules')} />
        </Section>

        <Section title="Coordinators" description="Listed on the event page; phone numbers become tap-to-call.">
          {form.coordinators.length === 0 && <p className="text-sm text-muted">No coordinators yet.</p>}
          {form.coordinators.map((c, i) => (
            <div key={i} className="grid items-start gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_11rem_9rem_auto]">
              <Field label="Name" value={c.name} disabled={readOnly} maxLength={120} onChange={(ev) => set('coordinators', form.coordinators.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))} />
              <Field label="Mobile" type="tel" inputMode="numeric" prefix="+91" value={c.phone} disabled={readOnly} error={save.fields[`coordinators.${i}.phone`]} onChange={(ev) => set('coordinators', form.coordinators.map((x, j) => (j === i ? { ...x, phone: ev.target.value.replace(/\D/g, '').slice(0, 10) } : x)))} />
              <SelectField label="Role" value={c.role} disabled={readOnly} onChange={(ev) => set('coordinators', form.coordinators.map((x, j) => (j === i ? { ...x, role: ev.target.value as Coordinator['role'] } : x)))}>
                <option value="FACULTY">Faculty</option>
                <option value="STUDENT">Student</option>
              </SelectField>
              {!readOnly && (
                <button type="button" onClick={() => set('coordinators', form.coordinators.filter((_, j) => j !== i))} aria-label={`Remove ${c.name || 'coordinator'}`} className="grid size-10 place-items-center self-end rounded-lg text-subtle hover:bg-surface-2 hover:text-red-600 sm:mb-1">
                  <XIcon className="size-4" />
                </button>
              )}
            </div>
          ))}
          {!readOnly && form.coordinators.length < 10 && (
            <Button size="sm" block={false} variant="secondary" onClick={() => set('coordinators', [...form.coordinators, { name: '', phone: '', role: 'STUDENT' }])}>
              <PlusIcon className="size-4" /> Add coordinator
            </Button>
          )}
        </Section>

        {(form.category === 'WORKSHOP' || form.rpName) && (
          <Section title="Resource person" description="The speaker or trainer for a workshop.">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Name" maxLength={80} {...bind('rpName')} />
              <Field label="Designation" maxLength={120} {...bind('rpDesignation')} />
            </div>
            <Field label="Organisation" maxLength={120} {...bind('rpOrganization')} />
            <TextareaField label="Short bio" rows={3} maxLength={1500} {...bind('rpBio')} />
          </Section>
        )}

        <Section title="Poster" description="Upload the poster or paste a link to it. Either way it's resized, so cards stay fast (~20 KB each).">
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-3">
              <label className={cx('inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-fg-2 hover:border-line-strong', uploading && 'pointer-events-none opacity-60')}>
                {uploading ? <Spinner /> : <UploadIcon className="size-4" />}
                {uploading ? 'Uploading…' : form.bannerUrl ? 'Replace image' : 'Upload image'}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" disabled={uploading} onChange={onFile} />
              </label>
              {form.bannerUrl && (
                <Button size="sm" block={false} variant="ghost" onClick={() => set('bannerUrl', '')}>
                  Remove
                </Button>
              )}
              <span className="text-xs text-subtle">JPG, PNG or WebP · up to 10 MB</span>
            </div>
          )}
          <Field
            label="…or paste an image link"
            maxLength={500}
            placeholder="https://…"
            {...bind('bannerUrl')}
            onBlur={(ev) => void importLink(ev.target.value)}
            onPaste={(ev) => {
              const pasted = ev.clipboardData.getData('text');
              if (isExternalImage(pasted.trim())) setTimeout(() => void importLink(pasted), 0); // after the value lands
            }}
          />
          {uploading && isExternalImage(form.bannerUrl.trim()) && <p className="text-xs text-subtle">Importing and compressing the image…</p>}
          {isImageUrl(form.bannerUrl.trim()) && (
            <div className="grid gap-3 sm:grid-cols-[16rem_1fr] sm:items-center">
              <img src={cardImage(form.bannerUrl.trim()) ?? ''} alt="Card preview" className="aspect-[16/10] w-full rounded-xl border border-line object-cover" />
              <p className="text-sm text-muted">How it appears on the event card. People can open the full poster from the event page.</p>
            </div>
          )}
        </Section>
      </div>

      {/* Sticky save bar: above the phone tab bar, beside the desktop sidebar. */}
      {!readOnly && (dirty || !e) && (
        <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface/95 lg:bottom-0 lg:left-64">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p className="flex items-center gap-2 text-sm font-medium text-fg-2">
              <span className="size-2 rounded-full bg-amber-500" />
              {e ? 'Unsaved changes' : 'New draft'}
            </p>
            <div className="flex gap-2">
              {e && (
                <Button size="sm" block={false} variant="ghost" onClick={() => { setForm(initial); save.setFields({}); }}>
                  Discard
                </Button>
              )}
              <Button size="sm" block={false} type="submit" loading={save.loading}>
                {e ? 'Save changes' : 'Create draft'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {e && (
        <>
          <ConfirmDialog
            open={action === 'publish'}
            onClose={() => setAction(null)}
            title={`Publish ${e.name}?`}
            message={fest.status === 'DRAFT' ? 'It goes live when the fest is published.' : 'It appears on the fest page immediately.'}
            confirmLabel="Publish"
            onConfirm={() => run(() => eventApi.publish(e.id), `${e.name} is live`)}
          />
          <ConfirmDialog open={action === 'reactivate'} onClose={() => setAction(null)} title="Resume registrations?" message="The pause notice is removed and the event is live again." confirmLabel="Resume" onConfirm={() => run(() => eventApi.reactivate(e.id), 'Event resumed')} />
          <ConfirmDialog open={action === 'complete'} onClose={() => setAction(null)} title="Mark as completed?" message="Use this after the event has taken place. It can't be edited afterwards." confirmLabel="Mark completed" onConfirm={() => run(() => eventApi.complete(e.id), 'Marked completed')} />
          <ConfirmDialog
            open={action === 'delete'}
            onClose={() => setAction(null)}
            title="Delete this draft?"
            message="It was never published, so nobody has registered. This can't be undone."
            confirmLabel="Delete draft"
            tone="danger"
            onConfirm={async () => {
              await eventApi.remove(e.id);
              invalidate(`admin:events:${fest.id}`);
              toast.success('Draft deleted');
              navigate(`/admin/events/${fest.id}`, { replace: true });
            }}
          />
          <Dialog
            open={action === 'suspend' || action === 'cancel'}
            onClose={() => setAction(null)}
            title={action === 'cancel' ? 'Cancel this event' : 'Pause registrations'}
            description={action === 'cancel' ? 'Registrants will be notified and refunded (refunds arrive with payments). The reason is shown publicly.' : 'New registrations stop; existing ones stay valid. The reason is shown publicly.'}
            footer={
              <>
                <Button size="sm" block={false} variant="secondary" onClick={() => setAction(null)}>
                  Back
                </Button>
                <Button
                  size="sm"
                  block={false}
                  variant="danger"
                  disabled={reason.trim().length < 3}
                  onClick={async () => {
                    try {
                      await run(() => (action === 'cancel' ? eventApi.cancel(e.id, reason.trim()) : eventApi.suspend(e.id, reason.trim())), action === 'cancel' ? 'Event cancelled' : 'Registrations paused');
                      setAction(null);
                    } catch (err) {
                      toast.error((err as Error).message);
                    }
                  }}
                >
                  {action === 'cancel' ? 'Cancel event' : 'Pause'}
                </Button>
              </>
            }
          >
            <TextareaField label="Reason" rows={3} maxLength={300} placeholder={action === 'cancel' ? 'e.g. Speaker unavailable' : 'e.g. Lab maintenance, back tomorrow'} value={reason} onChange={(ev) => setReason(ev.target.value)} />
          </Dialog>
        </>
      )}
    </form>
  );
}
