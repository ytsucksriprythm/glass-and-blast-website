'use client';

import { AdminSidebar, adminNavItems, type AdminNavKey } from './AdminNav';
import { useStaffProfile } from './StaffSession';

export default function AdminRecordShell({ active, children }: {
  active: AdminNavKey;
  children: React.ReactNode;
}) {
  const profile = useStaffProfile();
  return (
    <div className="flex min-h-[100svh] bg-navy-900">
      {profile && <AdminSidebar active={active} items={adminNavItems()} />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
