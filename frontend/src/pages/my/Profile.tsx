import { useState, type ChangeEvent, type FormEvent } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { BuildingIcon, MailIcon, UserIcon } from '@/components/icons';
import { Card, PageHeader } from '@/components/layout';
import { toast } from '@/components/toast';
import { Alert, Button, Field } from '@/components/ui';
import { meApi } from '@/lib/ems-api';
import { useSubmit } from '@/lib/use-submit';
import { rules, sanitizePhone, validate } from '@/lib/validate';
import { useAuth } from '@/store/auth';
import { useMyNav } from '@/lib/nav';

export default function Profile() {
  const nav = useMyNav();
  const user = useAuth((s) => s.user)!;
  const setUser = useAuth((s) => s.setUser);
  const [form, setForm] = useState({ fullName: user.fullName, phone: user.phone ?? '', college: user.college ?? '' });
  const { loading, error, fields, setFields, clearField, run } = useSubmit();
  const dirty = form.fullName !== user.fullName || form.phone !== (user.phone ?? '') || form.college !== (user.college ?? '');

  async function save(e: FormEvent) {
    e.preventDefault();
    const errs = validate(form, { fullName: rules.fullName, phone: rules.phone, college: rules.college });
    if (Object.keys(errs).length) return setFields(errs as Record<string, string>);
    const updated = await run(() => meApi.updateProfile(form));
    if (updated) {
      setUser({ ...user, ...updated });
      toast.success('Profile saved');
    }
  }

  const bind = (k: keyof typeof form, t: (v: string) => string = (v) => v) => ({
    value: form[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [k]: t(e.target.value) }));
      clearField(k);
    },
    error: fields[k],
  });

  return (
    <div className="min-h-dvh bg-page">
      <AppHeader nav={nav} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-5 sm:py-10">
        <PageHeader title="Profile" description="This is how organisers see you on registrations and certificates." />
        <Card>
          <form onSubmit={save} className="space-y-5" noValidate>
            {error && <Alert>{error}</Alert>}
            <Field label="Email address" icon={MailIcon} value={user.email} disabled hint={<span className="text-xs text-subtle">Can&apos;t be changed</span>} />
            <Field label="Full name" icon={UserIcon} autoComplete="name" maxLength={80} {...bind('fullName')} />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Mobile number" type="tel" inputMode="numeric" prefix="+91" autoComplete="tel-national" {...bind('phone', sanitizePhone)} />
              <Field label="College" icon={BuildingIcon} autoComplete="organization" maxLength={120} {...bind('college')} />
            </div>
            <div className="flex justify-end pt-1">
              <Button type="submit" block={false} loading={loading} disabled={!dirty}>
                Save changes
              </Button>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
