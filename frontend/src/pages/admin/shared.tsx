import { deptApi, festApi, type Department, type FestSummary } from '@/lib/ems-api';
import { useQuery } from '@/lib/query';

/** Fests (scope-filtered by the API) + departments, for scope pickers. */
export function useScopeOptions() {
  const fests = useQuery('admin:fests:all', () => festApi.list());
  const depts = useQuery('admin:departments', deptApi.listAll);
  return {
    fests: (fests.data?.items ?? []) as FestSummary[],
    departments: (depts.data ?? []).filter((d) => d.active) as Department[],
    loading: fests.loading || depts.loading,
  };
}

export { useDebounced } from '@/lib/use-debounced';

/** Human sentence for an audit action. */
export const AUDIT_TEXT: Record<string, string> = {
  'global_event.created': 'created the fest',
  'global_event.updated': 'edited details',
  'global_event.departments_set': 'changed departments',
  'global_event.published': 'published the fest',
  'global_event.suspended': 'suspended registrations',
  'global_event.completed': 'marked it completed',
  'global_event.cloned': 'cloned it from a previous edition',
  'local_event.imported': 'imported events from a seed file',
};

/**
 * Department chip multi-select. `onChange` receives an updater (not a value) so rapid clicks
 * build on each other instead of each starting from a stale render.
 */
export function DepartmentPicker({ departments, value, onChange, disabled }: { departments: Department[]; value: string[]; onChange: (update: (prev: string[]) => string[]) => void; disabled?: boolean }) {
  const toggle = (id: string) => onChange((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Departments">
      {departments.map((d) => {
        const on = value.includes(d.id);
        return (
          <button
            key={d.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => toggle(d.id)}
            title={d.name}
            className={
              'inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold transition disabled:opacity-60 ' +
              (on ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' : 'border-line bg-surface text-fg-2 hover:border-line-strong')
            }
          >
            <span className={'size-2 rounded-full ' + (on ? 'bg-indigo-500' : 'bg-line-strong')} />
            {d.code}
          </button>
        );
      })}
    </div>
  );
}
