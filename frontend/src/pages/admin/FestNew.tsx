import { useLocation } from 'wouter';
import { PageHeader } from '@/components/layout';
import { toast } from '@/components/toast';
import { festApi } from '@/lib/ems-api';
import { invalidate } from '@/lib/query';
import { useSubmit } from '@/lib/use-submit';
import { FestForm, festToForm, formToInput } from './FestForm';
import { useScopeOptions } from './shared';

export default function FestNew() {
  const [, navigate] = useLocation();
  const { departments } = useScopeOptions();
  const { loading, error, fields, run } = useSubmit();

  return (
    <>
      <PageHeader title="New fest" description="Starts as a draft. Nothing is public until you publish." back={{ href: '/admin/events', label: 'Fests' }} />
      <FestForm
        initial={festToForm()}
        departments={departments}
        submitLabel="Create draft"
        loading={loading}
        error={error}
        fields={fields}
        onSubmit={async (v) => {
          const f = await run(() => festApi.create(formToInput(v)));
          if (f) {
            invalidate('admin:fests');
            toast.success(`${f.name} created as a draft`);
            navigate(`/admin/events/${f.id}`, { replace: true });
          }
        }}
      />
    </>
  );
}
