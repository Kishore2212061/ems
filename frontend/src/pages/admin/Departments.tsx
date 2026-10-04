import { useState } from 'react';
import { DataList, EmptyState } from '@/components/data';
import { BuildingIcon, PlusIcon } from '@/components/icons';
import { Badge, Card, PageHeader } from '@/components/layout';
import { Dialog } from '@/components/overlay';
import { toast } from '@/components/toast';
import { Alert, Button, Field, SelectField } from '@/components/ui';
import { deptApi, type Department } from '@/lib/ems-api';
import { can } from '@/lib/permissions';
import { invalidate, useQuery } from '@/lib/query';
import { useSubmit } from '@/lib/use-submit';
import { useAuth } from '@/store/auth';

const EMPTY = { code: '', name: '', associationName: '', active: 'true', sortOrder: '100' };

function DepartmentDialog({ dept, onClose }: { dept: Department | 'new' | null; onClose: () => void }) {
  const editing = dept && dept !== 'new' ? dept : null;
  const [v, setV] = useState(EMPTY);
  const [seed, setSeed] = useState<typeof dept>(null);
  const { loading, error, fields, setFields, run } = useSubmit();

  if (dept !== seed) {
    setSeed(dept);
    setV(editing ? { code: editing.code, name: editing.name, associationName: editing.associationName ?? '', active: String(editing.active), sortOrder: String(editing.sortOrder) } : EMPTY);
    setFields({});
  }

  async function save() {
    const e: Record<string, string> = {};
    if (!/^[A-Za-z0-9]{2,10}$/.test(v.code.trim())) e.code = 'Use 2–10 letters or digits, e.g. CSE';
    if (v.name.trim().length < 2) e.name = 'Enter the department name';
    if (Object.keys(e).length) return setFields(e);
    const body = { code: v.code.trim().toUpperCase(), name: v.name.trim(), associationName: v.associationName.trim() || null, active: v.active === 'true', sortOrder: Number(v.sortOrder) || 100 };
    const r = await run(() => (editing ? deptApi.update(editing.id, body) : deptApi.create(body)));
    if (r) {
      invalidate('admin:departments');
      invalidate('admin:fests'); // renamed codes show up in fest lists
      toast.success(editing ? 'Department updated' : 'Department added');
      onClose();
    }
  }

  const bind = (k: keyof typeof EMPTY) => ({ value: v[k], onChange: (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value })), error: fields[k] });

  return (
    <Dialog
      open={!!dept}
      onClose={onClose}
      title={editing ? `Edit ${editing.code}` : 'Add department'}
      description={editing ? 'Renaming updates every fest that includes it.' : 'Departments can then be attached to fests.'}
      footer={
        <>
          <Button size="sm" block={false} variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" block={false} loading={loading} onClick={save}>{editing ? 'Save' : 'Add department'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-[7rem_1fr] gap-4">
          <Field label="Code" placeholder="CSE" maxLength={10} {...bind('code')} />
          <Field label="Name" placeholder="Computer Science & Engineering" maxLength={80} {...bind('name')} />
        </div>
        <Field label="Association name" placeholder="CSE Association" maxLength={120} {...bind('associationName')} />
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Status" {...bind('active')}>
            <option value="true">Active</option>
            <option value="false">Hidden</option>
          </SelectField>
          <Field label="Sort order" type="number" inputMode="numeric" {...bind('sortOrder')} />
        </div>
      </div>
    </Dialog>
  );
}

export default function Departments() {
  const user = useAuth((s) => s.user);
  const manage = can(user, 'department.manage');
  const { data, loading } = useQuery('admin:departments', deptApi.listAll);
  const [editing, setEditing] = useState<Department | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Departments"
        description="The college's associations. Fests pick from this list."
        actions={manage && <Button size="sm" block={false} onClick={() => setEditing('new')}><PlusIcon className="size-4" /> Add department</Button>}
      />
      <Card padded={false}>
        <DataList
          loading={loading}
          rows={data ?? []}
          rowKey={(d) => d.id}
          onRowClick={manage ? setEditing : undefined}
          empty={<EmptyState compact icon={BuildingIcon} title="No departments yet" />}
          columns={[
            { key: 'code', header: 'Code', primary: true, render: (d) => d.code },
            { key: 'name', header: 'Name', render: (d) => d.name },
            { key: 'assoc', header: 'Association', render: (d) => d.associationName ?? '—', hideOnMobile: true },
            { key: 'status', header: 'Status', render: (d) => (d.active ? <Badge tone="success" dot>Active</Badge> : <Badge>Hidden</Badge>) },
          ]}
        />
      </Card>
      <DepartmentDialog dept={editing} onClose={() => setEditing(null)} />
    </>
  );
}
