import { useMemo } from 'react';
import { useDiag } from '../../context/DiagContext';
import { DataTable } from '../index';

interface TabDef {
  id: string;
  label: string;
  dataKey: string;
  title: string;
  sortNumeric?: boolean;
}

const ALL_TABS: TabDef[] = [
  { id: 'auth', label: 'Auth Settings', dataKey: 'authSettings', title: 'Authentication Settings' },
  { id: 'cgroups', label: 'CGroups Config', dataKey: 'cgroupSettings', title: 'CGroups Config' },
  { id: 'users-projects', label: 'Users by Projects', dataKey: 'usersByProjects', title: 'Users by Projects' },
  { id: 'system-limits', label: 'System Limits', dataKey: 'systemLimits', title: 'System Limits' },
];

export function SecurityConfigPage() {
  const { state } = useDiag();
  const { parsedData } = state;

  const availableTabs = useMemo(() => {
    return ALL_TABS.filter((tab) => {
      const data = parsedData[tab.dataKey as keyof typeof parsedData];
      return data && typeof data === 'object' && Object.keys(data).length > 0;
    });
  }, [parsedData]);

  if (availableTabs.length === 0) {
    return (
      <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-[var(--text-secondary)]">No security configuration data available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {availableTabs.map((tab) => (
          <DataTable
            key={tab.id}
            id={`${tab.dataKey}-table`}
            title={tab.title}
            data={parsedData[tab.dataKey as keyof typeof parsedData] as Record<string, string | number>}
            sortNumeric={tab.sortNumeric}
          />
        ))}
      </div>
    </div>
  );
}
