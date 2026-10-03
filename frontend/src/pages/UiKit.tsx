import { useState } from 'react';
import { DataList, EmptyState, Skeleton, StatTile, type Column } from '@/components/data';
import { CalendarIcon, MailIcon, ShieldIcon, TicketIcon } from '@/components/icons';
import { Badge, Card, PageHeader, Tabs } from '@/components/layout';
import { ConfirmDialog, Dialog } from '@/components/overlay';
import { ThemeToggle } from '@/components/ThemeToggle';
import { toast } from '@/components/toast';
import { Alert, Button, Field, PasswordField } from '@/components/ui';

/** Dev-only gallery (/__ui): every shared component in one place, for checking both themes and 320 px. */

interface Fest {
  id: string;
  name: string;
  year: number;
  status: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED';
  depts: number;
}
const FESTS: Fest[] = [
  { id: '1', name: "NEC Tech Fest '25", year: 2025, status: 'PUBLISHED', depts: 9 },
  { id: '2', name: 'Spandana Cultural Fest', year: 2025, status: 'DRAFT', depts: 4 },
  { id: '3', name: 'National Hackathon', year: 2025, status: 'SUSPENDED', depts: 2 },
];
const STATUS_TONE = { DRAFT: 'neutral', PUBLISHED: 'success', SUSPENDED: 'warning' } as const;
const COLUMNS: Column<Fest>[] = [
  { key: 'name', header: 'Fest', primary: true, render: (f) => f.name },
  { key: 'year', header: 'Edition', render: (f) => f.year },
  { key: 'depts', header: 'Departments', render: (f) => f.depts, align: 'right' },
  { key: 'status', header: 'Status', render: (f) => <Badge tone={STATUS_TONE[f.status]} dot>{f.status.toLowerCase()}</Badge> },
];

export default function UiKit() {
  const [tab, setTab] = useState<'all' | 'live' | 'draft'>('all');
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <div className="min-h-dvh bg-page">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-10">
        <PageHeader
          title="UI kit"
          description="Shared components. Check every change here in dark + light and at 320 px."
          back={{ href: '/', label: 'Back to app' }}
          actions={
            <>
              <ThemeToggle />
              <Button size="sm" block={false} onClick={() => setDialog(true)}>
                Open dialog
              </Button>
            </>
          }
        />

        <div className="space-y-6">
          <Card title="Buttons">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" block={false}>Primary</Button>
              <Button size="sm" block={false} variant="secondary">Secondary</Button>
              <Button size="sm" block={false} variant="danger">Danger</Button>
              <Button size="sm" block={false} variant="ghost">Ghost</Button>
              <Button size="sm" block={false} loading>Saving</Button>
            </div>
          </Card>

          <Card title="Badges & alerts">
            <div className="flex flex-wrap gap-2">
              {(['neutral', 'brand', 'success', 'warning', 'danger', 'info'] as const).map((t) => (
                <Badge key={t} tone={t} dot>
                  {t}
                </Badge>
              ))}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Alert>Payment failed. Try again.</Alert>
              <Alert tone="success">Event published.</Alert>
              <Alert tone="info">Registrations open tomorrow.</Alert>
            </div>
          </Card>

          <section className="grid grid-cols-3 gap-3 sm:gap-4">
            <StatTile label="Registrations" value={128} icon={CalendarIcon} delta={{ value: '+12%', positive: true }} />
            <StatTile label="Tickets" value={96} icon={TicketIcon} tint="info" />
            <StatTile label="Checked in" value={0} icon={ShieldIcon} tint="success" loading={loading} />
          </section>

          <Card
            title="Fests"
            description="DataList: table on desktop, cards on phones."
            padded={false}
            actions={
              <Button size="sm" block={false} variant="secondary" onClick={() => setLoading((l) => !l)}>
                Toggle loading
              </Button>
            }
          >
            <div className="px-5 pt-3 sm:px-6">
              <Tabs
                label="Filter fests"
                value={tab}
                onChange={setTab}
                items={[
                  { value: 'all', label: 'All', count: 3 },
                  { value: 'live', label: 'Live', count: 1 },
                  { value: 'draft', label: 'Drafts', count: 1 },
                ]}
              />
            </div>
            <DataList
              columns={COLUMNS}
              rows={tab === 'all' ? FESTS : FESTS.filter((f) => (tab === 'live' ? f.status === 'PUBLISHED' : f.status === 'DRAFT'))}
              rowKey={(f) => f.id}
              loading={loading}
              onRowClick={(f) => toast.info(`Opened ${f.name}`)}
            />
          </Card>

          <Card title="Empty & skeleton">
            <div className="grid gap-6 sm:grid-cols-2">
              <EmptyState
                icon={TicketIcon}
                title="No registrations yet"
                description="Browse events and book your spot."
                action={<Button size="sm" block={false}>Browse events</Button>}
                compact
              />
              <div className="space-y-3">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-24" />
              </div>
            </div>
          </Card>

          <Card title="Form fields">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Email address" icon={MailIcon} placeholder="you@college.edu" />
              <Field label="With error" icon={MailIcon} defaultValue="bad@" error="Enter a valid email address" />
              <PasswordField label="Password" placeholder="Create a password" showStrength value="Abcdefg1" onChange={() => {}} />
            </div>
          </Card>

          <Card title="Toasts & confirm">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" block={false} variant="secondary" onClick={() => toast.success('Event saved')}>Success toast</Button>
              <Button size="sm" block={false} variant="secondary" onClick={() => toast.error('Could not save. Try again.')}>Error toast</Button>
              <Button size="sm" block={false} variant="danger" onClick={() => setConfirm(true)}>Cancel event…</Button>
            </div>
          </Card>
        </div>
      </main>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Invite a coordinator"
        description="They'll get an email link to set up their account."
        footer={
          <>
            <Button size="sm" block={false} variant="secondary" onClick={() => setDialog(false)}>Cancel</Button>
            <Button size="sm" block={false} onClick={() => { setDialog(false); toast.success('Invite sent'); }}>Send invite</Button>
          </>
        }
      >
        <Field label="Email address" icon={MailIcon} placeholder="faculty@nec.edu.in" />
      </Dialog>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => new Promise((r) => setTimeout(r, 600)).then(() => void toast.success('Event cancelled'))}
        title="Cancel Blind Coding Challenge?"
        message="All 42 paid registrations will be refunded automatically. This can't be undone."
        confirmLabel="Cancel event"
        tone="danger"
        requireText="Blind Coding Challenge"
      />
    </div>
  );
}
