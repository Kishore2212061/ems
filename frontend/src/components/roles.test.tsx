import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Route, Router, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { ParticipantOnly } from '@/App';
import { useAuth, type User, type UserRole } from '@/store/auth';
import { RoleSwitcher, UserMenu } from './AppHeader';

const PARTICIPANT: UserRole = { role: 'PARTICIPANT', scopeType: 'ORG', scopeId: null, scopeLabel: null };
const SUPER_ADMIN: UserRole = { role: 'SUPER_ADMIN', scopeType: 'ORG', scopeId: null, scopeLabel: null };
const CSE_ADMIN: UserRole = { role: 'ADMIN', scopeType: 'DEPARTMENT', scopeId: 'd1', scopeLabel: 'CSE' };

const signIn = (...roles: UserRole[]) =>
  useAuth.getState().setUser({
    id: 'u1',
    email: 'sa@test.local',
    fullName: 'Super Admin',
    phone: null,
    college: null,
    status: 'ACTIVE',
    emailVerified: true,
    createdAt: '2026-10-03T00:00:00.000Z',
    roles,
  } satisfies User);

function mount(path: string, header?: ReactNode) {
  const loc = memoryLocation({ path, record: true });
  render(
    <Router hook={loc.hook}>
      {header}
      <Switch>
        <Route path="/dashboard">
          <ParticipantOnly>
            <p>participant dashboard</p>
          </ParticipantOnly>
        </Route>
        <Route path="/admin">
          <p>admin console</p>
        </Route>
      </Switch>
    </Router>,
  );
  return loc;
}

const openAccountMenu = () => userEvent.click(screen.getByRole('button', { name: 'Account menu' }));

beforeEach(() => localStorage.clear());

describe('role contexts', () => {
  it('staff contexts never see the participant dashboard (redirected to their own home)', () => {
    signIn(PARTICIPANT, SUPER_ADMIN); // defaults to the most privileged role
    const loc = mount('/dashboard');
    expect(screen.getByText('admin console')).toBeTruthy();
    expect(screen.queryByText('participant dashboard')).toBeNull();
    expect(loc.history.at(-1)).toBe('/admin');
  });

  it('switches between every held role in the same session from the account menu', async () => {
    signIn(PARTICIPANT, CSE_ADMIN, SUPER_ADMIN);
    const loc = mount('/admin', <UserMenu />);

    await openAccountMenu();
    const options = screen.getAllByRole('menuitemradio');
    expect(options.map((o) => o.textContent)).toEqual(['Super AdminAdmin console', 'Admin · CSEAdmin console', 'ParticipantMy dashboard']);
    expect(options[0].getAttribute('aria-checked')).toBe('true');

    await userEvent.click(screen.getByRole('menuitemradio', { name: /Participant/ }));
    expect(screen.getByText('participant dashboard')).toBeTruthy();
    expect(loc.history.at(-1)).toBe('/dashboard');
    expect(useAuth.getState().activeRole).toBe('PARTICIPANT:');
    expect(localStorage.getItem('ems_role_u1')).toBe('PARTICIPANT:'); // survives a reload

    await openAccountMenu();
    await userEvent.click(screen.getByRole('menuitemradio', { name: /CSE/ }));
    expect(screen.getByText('admin console')).toBeTruthy();
    expect(useAuth.getState().activeRole).toBe('ADMIN:d1');
  });

  it('the header pill offers the same switch', async () => {
    signIn(PARTICIPANT, SUPER_ADMIN);
    mount('/admin', <RoleSwitcher />);
    await userEvent.click(screen.getByRole('button', { name: /Active role: Super Admin/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Participant/ }));
    expect(screen.getByText('participant dashboard')).toBeTruthy();
  });

  it('a participant-only account has nothing to switch', async () => {
    signIn(PARTICIPANT);
    mount('/dashboard', <RoleSwitcher />);
    expect(screen.getByText('participant dashboard')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Active role/ })).toBeNull();
    render(
      <Router hook={memoryLocation({ path: '/dashboard' }).hook}>
        <UserMenu />
      </Router>,
    );
    await openAccountMenu();
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
  });
});
