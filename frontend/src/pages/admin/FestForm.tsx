import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { CalendarIcon, MailIcon, MapPinIcon } from '@/components/icons';
import { Card } from '@/components/layout';
import { Alert, Button, Field, SelectField, TextareaField } from '@/components/ui';
import { FEST_TYPE_LABEL, type Department, type FestDetail, type FestInput, type FestType } from '@/lib/ems-api';
import { fromLocalInput, toLocalInput } from '@/lib/format';
import { DepartmentPicker } from './shared';

export interface FestFormValue {
  name: string;
  editionYear: string;
  type: FestType;
  tagline: string;
  description: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  bannerUrl: string;
  contactEmail: string;
  departmentIds: string[];
}

export const festToForm = (f?: FestDetail): FestFormValue => ({
  name: f?.name ?? '',
  editionYear: String(f?.editionYear ?? new Date().getFullYear()),
  type: f?.type ?? 'TECHNICAL',
  tagline: f?.tagline ?? '',
  description: f?.description ?? '',
  startsAt: toLocalInput(f?.startsAt),
  endsAt: toLocalInput(f?.endsAt),
  venue: f?.venue ?? '',
  bannerUrl: f?.bannerUrl ?? '',
  contactEmail: f?.contactEmail ?? '',
  departmentIds: f?.departments.map((d) => d.id) ?? [],
});

export function formToInput(v: FestFormValue): FestInput & { name: string; editionYear: number } {
  return {
    name: v.name.trim(),
    editionYear: Number(v.editionYear),
    type: v.type,
    tagline: v.tagline.trim() || null,
    description: v.description.trim() || null,
    startsAt: fromLocalInput(v.startsAt),
    endsAt: fromLocalInput(v.endsAt),
    venue: v.venue.trim() || null,
    bannerUrl: v.bannerUrl.trim() || null,
    contactEmail: v.contactEmail.trim() || null,
    departmentIds: v.departmentIds,
  };
}

export function validateFest(v: FestFormValue) {
  const e: Record<string, string> = {};
  if (v.name.trim().length < 3) e.name = 'Enter the fest name';
  const y = Number(v.editionYear);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) e.editionYear = 'Enter a year like 2026';
  if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) e.endsAt = 'End must be after start';
  if (v.bannerUrl && !/^https:\/\//.test(v.bannerUrl)) e.bannerUrl = 'Use an https:// image URL';
  if (v.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.contactEmail)) e.contactEmail = 'Enter a valid email';
  return e;
}

const Section = ({ title, description, children }: { title: string; description?: string; children: ReactNode }) => (
  <Card title={title} description={description}>
    <div className="space-y-5">{children}</div>
  </Card>
);

/** Shared by "New fest" and the Details tab. */
export function FestForm({
  initial,
  departments,
  showDepartments = true,
  submitLabel,
  loading,
  error,
  fields,
  onSubmit,
  disabled,
}: {
  initial: FestFormValue;
  departments: Department[];
  showDepartments?: boolean;
  submitLabel: string;
  loading: boolean;
  error: ReactNode;
  fields: Record<string, string>;
  onSubmit: (v: FestFormValue) => void;
  disabled?: boolean;
}) {
  const [v, setV] = useState(initial);
  const [local, setLocal] = useState<Record<string, string>>({});
  const err = (k: string) => local[k] ?? fields[k];
  const bind = (k: keyof FestFormValue) => ({
    value: v[k] as string,
    disabled,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setV((s) => ({ ...s, [k]: e.target.value }));
      setLocal((l) => ({ ...l, [k]: '' }));
    },
    error: err(k) || undefined,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validateFest(v);
    setLocal(errs);
    if (Object.keys(errs).length === 0) onSubmit(v);
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {error && <Alert>{error}</Alert>}
      <Section title="Basics">
        <Field label="Fest name" placeholder="NEC Tech Fest '26" maxLength={120} {...bind('name')} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Edition year" type="number" inputMode="numeric" min={2000} max={2100} {...bind('editionYear')} />
          <SelectField label="Type" {...bind('type')}>
            {Object.entries(FEST_TYPE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </SelectField>
        </div>
        <Field label="Tagline" placeholder="A national level technical symposium" maxLength={160} {...bind('tagline')} />
        <TextareaField label="About" placeholder="What the fest is about, who can take part, highlights…" maxLength={5000} rows={5} {...bind('description')} />
      </Section>

      <Section title="Schedule & venue" description="Shown in India Standard Time.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Starts" type="datetime-local" icon={CalendarIcon} {...bind('startsAt')} />
          <Field label="Ends" type="datetime-local" icon={CalendarIcon} {...bind('endsAt')} />
        </div>
        <Field label="Venue" icon={MapPinIcon} placeholder="National Engineering College, Kovilpatti" maxLength={160} {...bind('venue')} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Contact email" type="email" icon={MailIcon} placeholder="techfest@nec.edu.in" {...bind('contactEmail')} />
          <Field label="Banner image URL" type="url" placeholder="https://…" {...bind('bannerUrl')} />
        </div>
      </Section>

      {showDepartments && (
        <Section title="Departments" description="Which associations take part. You can change this later.">
          <DepartmentPicker departments={departments} value={v.departmentIds} onChange={(update) => setV((s) => ({ ...s, departmentIds: update(s.departmentIds) }))} disabled={disabled} />
        </Section>
      )}

      {!disabled && (
        <div className="sticky bottom-20 z-10 flex justify-end lg:bottom-4">
          <Button type="submit" block={false} loading={loading} className="shadow-xl">
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
