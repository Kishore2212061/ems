import { useMemo } from 'react';
import { useAuth } from '@/store/auth';
import { regApi } from './ems-api';
import { invalidate, useQuery } from './query';
import { scheduleOf } from './schedule';

export const MY_REGISTRATIONS = 'my:registrations';

/**
 * Everything I'm registered for (as leader or teammate), shared by the catalogue badges, the event
 * page, the dashboard and My registrations: one small request, cached. Guests make no request.
 */
export function useMyRegistrations() {
  const authed = useAuth((s) => s.status === 'authed');
  const q = useQuery(authed ? MY_REGISTRATIONS : null, regApi.mine, { staleMs: 30_000 });
  const items = q.data?.items;
  const schedule = useMemo(() => scheduleOf(items ?? []), [items]);
  return { ...q, items: items ?? [], schedule, authed };
}

/** After registering or cancelling: refetch my list and the event pages/seat counts on screen. */
export function refreshAfterRegistrationChange() {
  invalidate(MY_REGISTRATIONS);
  invalidate('public:event:');
  invalidate('my:registration:');
}
