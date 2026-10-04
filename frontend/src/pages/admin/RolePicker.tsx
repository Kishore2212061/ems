import { SelectField } from '@/components/ui';
import { SCOPE_LABEL, VALID_SCOPES, type RoleGrant } from '@/lib/ems-api';
import { ROLE_LABEL, type Role, type ScopeType } from '@/store/auth';
import { useScopeOptions } from './shared';

/**
 * Role → scope type → specific fest/department. Options are limited to what the current user
 * may grant (`roles`) and to the fests/departments they can see (the API scope-filters fests).
 */
export function RolePicker({
  value,
  onChange,
  roles,
  allowedDepartmentIds,
  errors = {},
}: {
  value: RoleGrant;
  onChange: (g: RoleGrant) => void;
  roles: Role[];
  /** For department-scoped inviters: only their own departments. */
  allowedDepartmentIds?: string[];
  errors?: Record<string, string>;
}) {
  const { fests, departments } = useScopeOptions();
  const scopes = VALID_SCOPES[value.role].filter((s) => s !== 'LOCAL_EVENT');
  const depts = allowedDepartmentIds ? departments.filter((d) => allowedDepartmentIds.includes(d.id)) : departments;
  const options = value.scopeType === 'GLOBAL_EVENT' ? fests.map((f) => ({ id: f.id, label: f.name })) : value.scopeType === 'DEPARTMENT' ? depts.map((d) => ({ id: d.id, label: `${d.code} · ${d.name}` })) : [];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        label="Role"
        value={value.role}
        error={errors.role}
        onChange={(e) => {
          const role = e.target.value as Role;
          const scopeType = VALID_SCOPES[role][0];
          onChange({ role, scopeType, scopeId: null });
        }}
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Access"
        value={value.scopeType}
        error={errors.scopeType}
        onChange={(e) => onChange({ ...value, scopeType: e.target.value as ScopeType, scopeId: null })}
      >
        {scopes.map((s) => (
          <option key={s} value={s}>
            {SCOPE_LABEL[s]}
          </option>
        ))}
      </SelectField>
      {value.scopeType !== 'ORG' && (
        <SelectField
          className="sm:col-span-2"
          label={value.scopeType === 'GLOBAL_EVENT' ? 'Fest' : 'Department'}
          value={value.scopeId ?? ''}
          error={errors.scopeId}
          onChange={(e) => onChange({ ...value, scopeId: e.target.value || null })}
        >
          <option value="">Choose…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </SelectField>
      )}
    </div>
  );
}
