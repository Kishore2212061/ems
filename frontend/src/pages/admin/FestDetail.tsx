import { useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { EmptyState, Skeleton } from '@/components/data';
import { FestBanner } from '@/components/FestCard';
import { CalendarIcon, CopyIcon, ExternalIcon } from '@/components/icons';
import { Badge, Card, PageHeader, Tabs } from '@/components/layout';
import { ConfirmDialog, Dialog } from '@/components/overlay';
import { toast } from '@/components/toast';
import { Alert, Button, Field, TextareaField } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { auditApi, festApi, FEST_STATUS_LABEL, FEST_STATUS_TONE, type FestDetail as Fest } from '@/lib/ems-api';
import { fmtDateTime, fmtRange, timeAgo } from '@/lib/format';
import { can, canOnFest, isSuperAdmin } from '@/lib/permissions';
import { invalidate, setQueryData, useQuery } from '@/lib/query';
import { useSubmit } from '@/lib/use-submit';
import { useAuth } from '@/store/auth';
import { FestForm, festToForm, formToInput } from './FestForm';
import { FestEvents } from './FestEvents';
import { AUDIT_TEXT, DepartmentPicker, useScopeOptions } from './shared';

type Tab = 'events' | 'details' | 'departments' | 'activity';
type Action = 'publish' | 'complete' | 'reactivate' | 'suspend' | 'clone' | 'cancel' | null;

const MISSING: Record<string, string> = { departments: 'at least one department', startsAt: 'a start date', endsAt: 'an end date', events: 'at least one published event' };

/** Turn API errors into messages a person can act on. */
function explain(e: unknown) {
  if (e instanceof ApiError && e.code === 'PUBLISH_REQUIREMENTS') {
    const missing = ((e.details as { missing?: string[] })?.missing ?? []).map((m) => MISSING[m] ?? m);
    return new Error(`Add ${missing.join(', ')} before publishing.`);
  }
  return e;
}

function Activity({ festId }: { festId: string }) {
  const { data, loading } = useQuery(`admin:audit:global_event:${festId}`, () => auditApi.forEntity('global_event', festId));
  if (loading) return <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>;
  if (!data?.items.length) return <EmptyState compact title="No activity yet" />;
  return (
    <ol className="divide-y divide-line">
      {data.items.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
          <p className="text-sm text-fg-2">
            <span className="font-semibold text-fg">{a.actorName}</span> {AUDIT_TEXT[a.action] ?? a.action}
            {a.action === 'global_event.suspended' && typeof a.after?.suspend_reason === 'string' && <span className="text-muted"> — “{a.after.suspend_reason}”</span>}
          </p>
          <time className="shrink-0 text-xs text-subtle" title={fmtDateTime(a.at)}>
            {timeAgo(a.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

export default function FestDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const user = useAuth((s) => s.user);
  const key = `admin:fest:${id}`;
  const { data: f, loading, error, refetch } = useQuery(key, () => festApi.get(id));
  const { departments } = useScopeOptions();
  const [tab, setTab] = useState<Tab>(can(user, 'local_event.read') ? 'events' : 'details');
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [cloneYear, setCloneYear] = useState('');
  const [deptIds, setDeptIds] = useState<string[] | null>(null);
  const save = useSubmit();
  const deptSave = useSubmit();
  const [stale, setStale] = useState(false);

  // Per-fest: a department admin can view a fest their department joins, but not edit it.
  const canEdit = canOnFest(user, 'global_event.update', id);
  const canPublish = canOnFest(user, 'global_event.publish', id);
  const canClone = can(user, 'global_event.create');

  /** Store the server's copy and refresh lists that show this fest. */
  const apply = (next: Fest, msg?: string) => {
    setQueryData(key, next);
    invalidate('admin:fests');
    invalidate(`admin:audit:global_event:${id}`);
    invalidate('public:');
    if (msg) toast.success(msg);
  };

  const run = async (fn: () => Promise<Fest>, msg: string) => {
    try {
      apply(await fn(), msg);
    } catch (e) {
      throw explain(e);
    }
  };

  if (error) {
    return (
      <Card>
        <EmptyState icon={CalendarIcon} title={error.status === 404 ? 'Fest not found' : "Couldn't load this fest"} description={error.status === 404 ? 'It may have been removed, or it is outside your scope.' : error.message} action={<Link href="/admin/events" className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Back to fests</Link>} />
      </Card>
    );
  }
  if (loading || !f) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const isPublic = f.status === 'PUBLISHED' || f.status === 'SUSPENDED' || f.status === 'COMPLETED';
  const selectedDepts = deptIds ?? f.departments.map((d) => d.id);

  return (
    <>
      <PageHeader
        back={{ href: '/admin/events', label: 'Fests' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {f.name}
            <Badge tone={FEST_STATUS_TONE[f.status]} dot>
              {FEST_STATUS_LABEL[f.status]}
            </Badge>
          </span>
        }
        description={`${fmtRange(f.startsAt, f.endsAt)} · /${f.slug}`}
        actions={
          <>
            {isPublic && (
              <a href={`/events/${f.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-fg">
                <ExternalIcon className="size-4" /> View public page
              </a>
            )}
            {canClone && (
              <Button size="sm" block={false} variant="secondary" onClick={() => { setCloneYear(String(f.editionYear + 1)); setAction('clone'); }}>
                <CopyIcon className="size-4" /> Clone
              </Button>
            )}
            {canPublish && f.status === 'DRAFT' && <Button size="sm" block={false} onClick={() => setAction('publish')}>Publish</Button>}
            {canPublish && f.status === 'PUBLISHED' && (
              <Button size="sm" block={false} variant="secondary" onClick={() => { setReason(''); setAction('suspend'); }}>
                Suspend
              </Button>
            )}
            {canPublish && f.status === 'SUSPENDED' && <Button size="sm" block={false} onClick={() => setAction('reactivate')}>Reactivate</Button>}
            {canPublish && (f.status === 'PUBLISHED' || f.status === 'SUSPENDED') && (
              <Button size="sm" block={false} variant="secondary" onClick={() => setAction('complete')}>
                Mark completed
              </Button>
            )}
            {isSuperAdmin(user) && (f.status === 'DRAFT' || f.status === 'PUBLISHED' || f.status === 'SUSPENDED') && (
              <Button size="sm" block={false} variant="ghost" className="text-red-600 hover:text-red-700 dark:text-red-400" onClick={() => { setReason(''); setTyped(''); setAction('cancel'); }}>
                Cancel fest
              </Button>
            )}
          </>
        }
      />

      {f.status === 'SUSPENDED' && f.suspendReason && (
        <div className="mb-6">
          <Alert tone="info">Registrations paused: {f.suspendReason}</Alert>
        </div>
      )}

      <div className="mb-6 overflow-hidden rounded-2xl border border-line">
        <FestBanner fest={f} className="h-28 sm:h-36" />
      </div>

      <div className="mb-6">
        <Tabs<Tab>
          label="Fest sections"
          value={tab}
          onChange={setTab}
          items={[
            ...(can(user, 'local_event.read') ? [{ value: 'events' as const, label: 'Events' }] : []),
            { value: 'details', label: 'Details' },
            { value: 'departments', label: 'Departments', count: f.departments.length },
            ...(isSuperAdmin(user) ? [{ value: 'activity' as const, label: 'Activity' }] : []),
          ]}
        />
      </div>

      {tab === 'events' && <FestEvents fest={f} />}

      {tab === 'details' &&
        (stale ? (
          <Alert>
            Someone else saved this fest while you were editing.{' '}
            <button type="button" className="font-semibold underline" onClick={() => { setStale(false); refetch(); }}>
              Load the latest version
            </button>
          </Alert>
        ) : (
          <FestForm
            key={f.version}
            initial={festToForm(f)}
            departments={departments}
            showDepartments={false}
            submitLabel="Save changes"
            disabled={!canEdit}
            loading={save.loading}
            error={save.error}
            fields={save.fields}
            onSubmit={async (v) => {
              const { departmentIds: _ignored, ...input } = formToInput(v);
              const r = await save.run(async () => {
                try {
                  return await festApi.update(f.id, { ...input, version: f.version! });
                } catch (e) {
                  if (e instanceof ApiError && e.code === 'STALE_VERSION') setStale(true);
                  throw e;
                }
              });
              if (r) apply(r, 'Changes saved');
            }}
          />
        ))}

      {tab === 'departments' && (
        <Card title="Participating departments" description="Each department runs its own events under this fest.">
          {deptSave.error && <div className="mb-4"><Alert>{deptSave.error}</Alert></div>}
          <DepartmentPicker departments={departments} value={selectedDepts} onChange={(update) => setDeptIds((prev) => update(prev ?? f.departments.map((d) => d.id)))} disabled={!canEdit} />
          {canEdit && (
            <div className="mt-6 flex justify-end">
              <Button
                block={false}
                size="sm"
                loading={deptSave.loading}
                disabled={!deptIds}
                onClick={async () => {
                  const r = await deptSave.run(() => festApi.setDepartments(f.id, selectedDepts, f.version!));
                  if (r) {
                    setDeptIds(null);
                    apply(r, 'Departments updated');
                  }
                }}
              >
                Save departments
              </Button>
            </div>
          )}
        </Card>
      )}

      {tab === 'activity' && (
        <Card padded={false} title="Activity" description="Every change, who made it and when.">
          <Activity festId={f.id} />
        </Card>
      )}

      {/* lifecycle dialogs */}
      <ConfirmDialog
        open={action === 'publish'}
        onClose={() => setAction(null)}
        title={`Publish ${f.name}?`}
        message="It appears on the public site immediately. You can suspend it later if needed."
        confirmLabel="Publish"
        onConfirm={() => run(() => festApi.publish(f.id), `${f.name} is live`)}
      />
      <ConfirmDialog
        open={action === 'reactivate'}
        onClose={() => setAction(null)}
        title="Reopen registrations?"
        message="The suspension notice is removed and the fest is live again."
        confirmLabel="Reactivate"
        onConfirm={() => run(() => festApi.reactivate(f.id), 'Fest reactivated')}
      />
      <ConfirmDialog
        open={action === 'complete'}
        onClose={() => setAction(null)}
        title="Mark as completed?"
        message="Use this after the fest has ended. It moves to past editions and unlocks certificates later."
        confirmLabel="Mark completed"
        onConfirm={() => run(() => festApi.complete(f.id), 'Marked completed')}
      />
      <Dialog
        open={action === 'suspend'}
        onClose={() => setAction(null)}
        title="Suspend registrations"
        description="New registrations stop. Existing tickets stay valid. The reason is shown publicly."
        footer={
          <>
            <Button size="sm" block={false} variant="secondary" onClick={() => setAction(null)}>Cancel</Button>
            <Button
              size="sm"
              block={false}
              variant="danger"
              disabled={reason.trim().length < 3}
              onClick={async () => {
                try {
                  await run(() => festApi.suspend(f.id, reason.trim()), 'Registrations suspended');
                  setAction(null);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Suspend
            </Button>
          </>
        }
      >
        <TextareaField label="Reason" rows={3} maxLength={300} placeholder="e.g. Venue maintenance — back on Monday" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Dialog>
      <Dialog
        open={action === 'cancel'}
        onClose={() => setAction(null)}
        size="sm"
        title={`Cancel ${f.name}?`}
        description="Every event in this fest is cancelled: registrations end, tickets stop working, and every paid entry is refunded (online automatically; cash listed for the desk). This can't be undone."
        footer={
          <>
            <Button size="sm" block={false} variant="secondary" onClick={() => setAction(null)}>Keep the fest</Button>
            <Button
              size="sm"
              block={false}
              variant="danger"
              disabled={reason.trim().length < 3 || typed.trim() !== f.name}
              onClick={async () => {
                try {
                  const out = await festApi.cancel(f.id, reason.trim());
                  setQueryData(`admin:fest:${f.id}`, out);
                  invalidate('admin:events:');
                  invalidate('admin:fests');
                  toast.success(`Fest cancelled: ${out.eventsCancelled} events cancelled, refunds started`);
                  setAction(null);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Cancel fest
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextareaField label="Reason (shown to participants)" rows={3} maxLength={300} placeholder="e.g. Cyclone warning: the college is closed" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Field label={`Type "${f.name}" to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      </Dialog>
      <Dialog
        open={action === 'clone'}
        onClose={() => setAction(null)}
        title="Clone as a new edition"
        description="Copies details, departments and events (as drafts) into a new edition, with every date moved to the new year."
        footer={
          <>
            <Button size="sm" block={false} variant="secondary" onClick={() => setAction(null)}>Cancel</Button>
            <Button
              size="sm"
              block={false}
              onClick={async () => {
                try {
                  const copy = await festApi.clone(f.id, Number(cloneYear));
                  invalidate('admin:fests');
                  setAction(null);
                  toast.success(`${copy.name} created`);
                  navigate(`/admin/events/${copy.id}`);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Create draft
            </Button>
          </>
        }
      >
        <Field label="New edition year" type="number" inputMode="numeric" value={cloneYear} onChange={(e) => setCloneYear(e.target.value)} />
      </Dialog>
    </>
  );
}
