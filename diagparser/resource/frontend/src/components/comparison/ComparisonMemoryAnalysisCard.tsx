import type { ParsedData } from '../../types';
import { ChartContainer } from '../ChartContainer';

interface ComparisonMemoryAnalysisCardProps {
  beforeData: ParsedData;
  afterData: ParsedData;
}

interface MemoryValues {
  totalVm: number;
  totalVmStr: string;
  backendGB: number;
  cgroupLimit: number;
  cgroupLimitStr: string;
  jekGB: number;
  maxJobs: number;
  jekTotal: number;
  availableForJEK: number;
  jekHeadroom: number;
  status: 'ok' | 'info' | 'warning' | 'critical';
}

function parseMemoryValues(data: ParsedData): MemoryValues | null {
  const totalVmStr = data.memoryInfo?.total || '';
  const backendStr = data.javaMemorySettings?.BACKEND || '0g';
  const jekStr = data.javaMemorySettings?.JEK || '0g';
  const maxActivitiesRaw = data.maxRunningActivities?.['Max Running Activities'];
  const maxActivitiesPerJobRaw = data.maxRunningActivities?.['Max Running Activities Per Job'];
  const cgroupLimitStr = String(data.cgroupSettings?.['Memory Limit'] || '0');

  const totalVm = parseInt(totalVmStr.replace(/[^0-9]/g, '')) || 0;
  const backendGB = parseInt(backendStr.replace(/[^0-9]/g, '')) || 0;
  const jekGB = parseInt(jekStr.replace(/[^0-9]/g, '')) || 0;
  const cgroupLimit = parseInt(cgroupLimitStr.replace(/[^0-9]/g, '')) || 0;
  const maxActivities = typeof maxActivitiesRaw === 'number' ? maxActivitiesRaw : 0;
  const maxActivitiesPerJob = typeof maxActivitiesPerJobRaw === 'number' && maxActivitiesPerJobRaw > 0 ? maxActivitiesPerJobRaw : 1;

  if (totalVm === 0 || cgroupLimit === 0) return null;

  const maxJobs = Math.ceil(maxActivities / maxActivitiesPerJob);
  const jekTotal = jekGB * maxJobs;
  const availableForJEK = totalVm - backendGB - cgroupLimit;
  const jekHeadroom = availableForJEK - jekTotal;

  const status = availableForJEK < 0 ? 'critical'
    : jekHeadroom < 0 ? 'critical'
    : jekHeadroom < 4 ? 'warning'
    : jekHeadroom < 10 ? 'info'
    : 'ok';

  return {
    totalVm,
    totalVmStr,
    backendGB,
    cgroupLimit,
    cgroupLimitStr,
    jekGB,
    maxJobs,
    jekTotal,
    availableForJEK,
    jekHeadroom,
    status,
  };
}

function DeltaIndicator({ before, after, lowerIsBetter = false }: { before: number; after: number; lowerIsBetter?: boolean }) {
  const delta = after - before;
  if (delta === 0) return null;

  const isImprovement = lowerIsBetter ? delta < 0 : delta > 0;
  const color = isImprovement ? 'var(--neon-green)' : 'var(--neon-red)';
  const sign = delta > 0 ? '+' : '';

  return (
    <span className="ml-1 text-xs font-mono" style={{ color }}>
      ({sign}{delta})
    </span>
  );
}

function StatusDot({ status }: { status: 'ok' | 'info' | 'warning' | 'critical' }) {
  const colors = { ok: 'var(--neon-green)', info: 'var(--neon-yellow)', warning: 'var(--neon-yellow)', critical: 'var(--neon-red)' };
  return (
    <span
      className="inline-block w-2 h-2 rounded-full ml-1"
      style={{ backgroundColor: colors[status] }}
    />
  );
}

export function ComparisonMemoryAnalysisCard({ beforeData, afterData }: ComparisonMemoryAnalysisCardProps) {
  const before = parseMemoryValues(beforeData);
  const after = parseMemoryValues(afterData);

  if (!before && !after) return null;

  const statusColors = { ok: 'var(--neon-green)', info: 'var(--neon-yellow)', warning: 'var(--neon-yellow)', critical: 'var(--neon-red)' };

  const headroomDelta = (after?.jekHeadroom ?? 0) - (before?.jekHeadroom ?? 0);
  const hasChange = before && after && headroomDelta !== 0;
  const overallDirection = headroomDelta > 0 ? 'improvement' : headroomDelta < 0 ? 'regression' : 'neutral';

  return (
    <ChartContainer
      title="Memory Analysis"
      headerExtra={hasChange ? (
        <span className={`text-sm font-mono ${overallDirection === 'improvement' ? 'text-[var(--neon-green)]' : 'text-[var(--neon-red)]'}`}>
          {headroomDelta > 0 ? '+' : ''}{headroomDelta} GB headroom
        </span>
      ) : undefined}
    >
      <div className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--text-muted)] text-xs">
                <th className="text-left font-normal pb-2">Metric</th>
                <th className="text-right font-normal pb-2">Before</th>
                <th className="text-right font-normal pb-2">After</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-[var(--text-secondary)] py-1">VM Total</td>
                <td className="text-right font-mono text-[var(--text-muted)]">{before?.totalVmStr || '—'}</td>
                <td className="text-right font-mono text-[var(--text-primary)]">
                  {after?.totalVmStr || '—'}
                  {before && after && <DeltaIndicator before={before.totalVm} after={after.totalVm} />}
                </td>
              </tr>
              <tr>
                <td className="text-[var(--text-secondary)] py-1 pl-2">Backend (Xmx)</td>
                <td className="text-right font-mono text-[var(--neon-cyan)] opacity-60">
                  {before ? `- ${before.backendGB} GB` : '—'}
                </td>
                <td className="text-right font-mono text-[var(--neon-cyan)]">
                  {after ? `- ${after.backendGB} GB` : '—'}
                  {before && after && <DeltaIndicator before={before.backendGB} after={after.backendGB} lowerIsBetter />}
                </td>
              </tr>
              <tr>
                <td className="text-[var(--text-secondary)] py-1 pl-2">Workloads CGroup</td>
                <td className="text-right font-mono text-[var(--neon-cyan)] opacity-60">
                  {before ? `- ${before.cgroupLimitStr}` : '—'}
                </td>
                <td className="text-right font-mono text-[var(--neon-cyan)]">
                  {after ? `- ${after.cgroupLimitStr}` : '—'}
                  {before && after && <DeltaIndicator before={before.cgroupLimit} after={after.cgroupLimit} lowerIsBetter />}
                </td>
              </tr>
              <tr className="border-t border-[var(--border-color)]">
                <td className="text-[var(--text-secondary)] pt-2">Available for JEK</td>
                <td className="text-right font-mono pt-2 opacity-60" style={{ color: before && before.availableForJEK <= 0 ? 'var(--neon-red)' : 'var(--text-muted)' }}>
                  {before ? `${before.availableForJEK} GB` : '—'}
                </td>
                <td className="text-right font-mono pt-2" style={{ color: after && after.availableForJEK <= 0 ? 'var(--neon-red)' : 'var(--text-primary)' }}>
                  {after ? `${after.availableForJEK} GB` : '—'}
                  {before && after && <DeltaIndicator before={before.availableForJEK} after={after.availableForJEK} />}
                </td>
              </tr>
              <tr>
                <td className="text-[var(--text-secondary)] py-1 pl-2">JEK × Max Jobs</td>
                <td className="text-right font-mono text-[var(--neon-cyan)] opacity-60">
                  {before ? `- ${before.jekTotal} GB` : '—'}
                </td>
                <td className="text-right font-mono text-[var(--neon-cyan)]">
                  {after ? `- ${after.jekTotal} GB` : '—'}
                  {before && after && <DeltaIndicator before={before.jekTotal} after={after.jekTotal} lowerIsBetter />}
                </td>
              </tr>
              <tr className="border-t border-[var(--border-color)]">
                <td className="font-medium pt-2" style={{ color: after ? statusColors[after.status] : 'var(--text-primary)' }}>
                  Headroom
                </td>
                <td className="text-right font-mono pt-2 opacity-60" style={{ color: before ? statusColors[before.status] : 'var(--text-muted)' }}>
                  {before ? `${before.jekHeadroom} GB` : '—'}
                  {before && <StatusDot status={before.status} />}
                </td>
                <td className="text-right font-mono font-bold pt-2" style={{ color: after ? statusColors[after.status] : 'var(--text-primary)' }}>
                  {after ? `${after.jekHeadroom} GB` : '—'}
                  {after && <StatusDot status={after.status} />}
                  {before && after && <DeltaIndicator before={before.jekHeadroom} after={after.jekHeadroom} />}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Warnings */}
        {(before?.status === 'critical' || before?.status === 'warning' || after?.status === 'critical' || after?.status === 'warning') && (
          <div className="mt-2 flex gap-2 text-xs">
            {before && (before.status === 'critical' || before.status === 'warning') && (
              <div className="flex-1 p-2 rounded opacity-60" style={{ backgroundColor: `color-mix(in srgb, ${statusColors[before.status]} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${statusColors[before.status]} 30%, transparent)`, color: statusColors[before.status] }}>
                {before.status === 'critical'
                  ? (before.availableForJEK < 0 ? `Before: Overcommitted by ${Math.abs(before.availableForJEK)}GB` : `Before: JEK over by ${Math.abs(before.jekHeadroom)}GB`)
                  : `Before: ${before.jekHeadroom}GB headroom`}
              </div>
            )}
            {after && (after.status === 'critical' || after.status === 'warning') && (
              <div className="flex-1 p-2 rounded" style={{ backgroundColor: `color-mix(in srgb, ${statusColors[after.status]} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${statusColors[after.status]} 30%, transparent)`, color: statusColors[after.status] }}>
                {after.status === 'critical'
                  ? (after.availableForJEK < 0 ? `After: Overcommitted by ${Math.abs(after.availableForJEK)}GB` : `After: JEK over by ${Math.abs(after.jekHeadroom)}GB`)
                  : `After: ${after.jekHeadroom}GB headroom`}
              </div>
            )}
          </div>
        )}

        {/* Status change summary */}
        {before && after && before.status !== after.status && (
          <div className="mt-3 pt-3 border-t border-[var(--border-color)] opacity-30">
            <div className="flex items-center justify-center text-xs">
              <span className={after.status === 'ok' ? 'text-[var(--neon-green)]' : after.status === 'critical' ? 'text-[var(--neon-red)]' : 'text-[var(--neon-yellow)]'}>
                Memory: {before.status} → {after.status}
              </span>
            </div>
          </div>
        )}
      </div>
    </ChartContainer>
  );
}
