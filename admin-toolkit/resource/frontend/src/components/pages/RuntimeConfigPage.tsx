import { useMemo } from 'react';
import { useDiag } from '../../context/DiagContext';
import { DataTable } from '../index';
import { PluginsTable } from '../PluginsTable';

interface TabDef {
  id: string;
  label: string;
  dataKey: string;
  title: string;
  sortNumeric?: boolean;
}

const ALL_TABS: TabDef[] = [
  { id: 'java-memory', label: 'Java Memory', dataKey: 'javaMemoryLimits', title: 'Java Memory Settings' },
  { id: 'spark', label: 'Spark Settings', dataKey: 'sparkSettings', title: 'Spark Settings' },
  { id: 'max-running', label: 'Max Running Activities', dataKey: 'maxRunningActivities', title: 'Max Running Activities', sortNumeric: true },
  { id: 'enabled', label: 'Enabled Settings', dataKey: 'enabledSettings', title: 'Enabled Settings' },
  { id: 'resource-limits', label: 'Resource Limits', dataKey: 'resourceLimits', title: 'Resource Limits' },
  { id: 'auth', label: 'Auth Settings', dataKey: 'authSettings', title: 'Authentication Settings' },
  { id: 'security-defaults', label: 'Security & Defaults', dataKey: 'securityDefaults', title: 'Security & Defaults' },
  { id: 'cgroups', label: 'CGroups Config', dataKey: 'cgroupSettings', title: 'CGroups Config' },
  { id: 'users-projects', label: 'Users by Projects', dataKey: 'usersByProjects', title: 'Users by Projects' },
  { id: 'system-limits', label: 'System Limits', dataKey: 'systemLimits', title: 'System Limits' },
  { id: 'container', label: 'Container Settings', dataKey: 'containerSettings', title: 'Container Settings' },
  { id: 'integration', label: 'Integration Settings', dataKey: 'integrationSettings', title: 'Integration Settings' },
  { id: 'proxy', label: 'Proxy Config', dataKey: 'proxySettings', title: 'Proxy Config' },
  { id: 'user-stats', label: 'User Statistics', dataKey: 'userStats', title: 'User Statistics', sortNumeric: true },
];

export function RuntimeConfigPage() {
  const { state } = useDiag();
  const { parsedData } = state;

  const availableTabs = useMemo(() => {
    return ALL_TABS.filter((tab) => {
      const data = parsedData[tab.dataKey as keyof typeof parsedData];
      return data && typeof data === 'object' && Object.keys(data).length > 0;
    });
  }, [parsedData]);

  const hasPlugins = (parsedData.plugins?.length ?? 0) > 0;

  if (availableTabs.length === 0 && !hasPlugins) {
    return (
      <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-[var(--text-secondary)]">No configuration data available.</p>
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
      <div className="mt-6">
        <PluginsTable />
      </div>
    </div>
  );
}
