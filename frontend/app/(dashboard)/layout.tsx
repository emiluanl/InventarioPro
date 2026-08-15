import type { JSX } from 'react';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return <DashboardShell>{children}</DashboardShell>;
}
