import { useEffect } from 'react';
import { Redirect } from 'wouter';
import { AppHeader } from '@/components/AppHeader';
import { EmptyState } from '@/components/data';
import { ScanIcon } from '@/components/icons';
import { Badge, Card, PageHeader } from '@/components/layout';
import { useMyNav } from '@/lib/nav';
import { activeRoleName, currentHome, roleKey, roleTitle, useAuth } from '@/store/auth';

/** Scanner home. The camera scanner lands with check-in (Module 8); for now it lists the assignments. */
export default function ScanHome() {
  const user = useAuth((s) => s.user)!;
  const active = useAuth((s) => s.activeRole);
  const setActive = useAuth((s) => s.setActiveRole);
  const nav = useMyNav();
  const assignments = user.roles.filter((r) => r.role === 'SCANNER');
  const first = assignments[0] ? roleKey(assignments[0]) : null;

  // Opened /scan from a bookmark in another role context → switch to the scanner role.
  useEffect(() => {
    if (first && activeRoleName(active) !== 'SCANNER') setActive(first);
  }, [active, first, setActive]);

  if (!first) return <Redirect to={currentHome()} replace />;

  return (
    <div className="min-h-dvh bg-page">
      <AppHeader nav={nav} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-5 sm:py-10">
        <PageHeader title="Ticket scanner" description="Scan participants' QR passes at the event entrance." />
        <Card>
          <EmptyState
            icon={ScanIcon}
            title="Scanning opens with check-in"
            description="The camera scanner arrives with event check-in. You're assigned to:"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {assignments.map((r) => (
                  <Badge key={roleKey(r)} tone="brand">
                    {roleTitle(r)}
                  </Badge>
                ))}
              </div>
            }
          />
        </Card>
      </main>
    </div>
  );
}
