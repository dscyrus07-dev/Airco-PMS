import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Clock, ChevronRight, OctagonX, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { usePolling } from '../../hooks/usePolling';
import * as tasksApi from '../../api/tasks';
import { AbandonedTaskItem, TodayTasksResponse } from '../../api/types';
import { Badge } from '../ui/Badge';
import { fmtTimeIST, fmtDateLongIST } from '../../lib/datetime';

const inputCls =
  'px-3 py-2 text-sm bg-white border border-[#E2DCD0] rounded-[10px] focus:outline-none focus:ring-[3px] focus:ring-[#386641]/15 focus:border-[#386641]';

const fmtTime = fmtTimeIST;

const REASON: Record<string, { label: string; variant: 'sage' | 'orange' | 'red' | 'lavender' | 'neutral' }> = {
  NEXT_SCHEDULED_OCCURRENCE: { label: 'occurrence expired', variant: 'orange' },
  SYSTEM_DAILY_ROLLOVER: { label: 'daily rollover', variant: 'neutral' },
};

const reasonLabel = (r?: string) =>
  REASON[r || '']?.label ?? (r ? r.replace(/_/g, ' ').toLowerCase() : 'abandoned');

interface Props {
  onOpenTask: (taskUid: string) => void;
}

/**
 * Today's Abandoned — every task that was abandoned today (by the
 * occurrence-expiry sweep, the daily rollover, or manually), keyed off
 * abandoned_at rather than created/due date so stale work abandoned
 * today still shows up here.
 */
export const AbandonedTodayView: React.FC<Props> = ({ onOpenTask }) => {
  const { activePropertyUid, currentPropertyZones, addToast } = useApp();
  const [data, setData] = useState<TodayTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('all');

  const load = useCallback(async (quiet = false) => {
    if (!activePropertyUid) return;
    if (!quiet) setLoading(true);
    try {
      const res = await tasksApi.tasksToday(activePropertyUid);
      setData(res);
    } catch {
      if (!quiet) addToast({ type: 'error', title: "Could not load today's abandoned tasks" });
    } finally {
      setLoading(false);
    }
  }, [activePropertyUid, addToast]);

  useEffect(() => {
    void load();
  }, [load]);
  usePolling(() => load(true), 10000, true, 'AbandonedTodayView');

  const rows = useMemo(() => {
    const items = data?.abandoned_today || [];
    return items.filter((i) => {
      if (search && !`${i.title} ${i.ticket_number || ''} ${i.assignee || ''} ${i.room_number || ''}`
        .toLowerCase().includes(search.toLowerCase())) return false;
      if (zoneFilter && i.zone_name !== zoneFilter) return false;
      if (reasonFilter !== 'all' && (i.abandoned_reason || '') !== reasonFilter) return false;
      return true;
    });
  }, [data, search, zoneFilter, reasonFilter]);

  const count = data?.abandoned_today?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* Header + count */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-xl text-[#24221F]">Today's Abandoned</h2>
          <p className="text-sm text-[#8C867C]">
            {data ? fmtDateLongIST(data.abandoned_day || data.date) : ''}
          </p>
        </div>
        <span className={`px-2.5 py-1.5 rounded-[9px] text-[11px] font-semibold border ${
          count > 0
            ? 'bg-[#FDE8E8] border-[#F5C8C8] text-[#B91C1C]'
            : 'bg-white border-[#EAE5DC] text-[#58534C]'
        }`}>
          Abandoned <span className="text-[#24221F]">{count}</span>
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#A59F95]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…" className={`${inputCls} w-full pl-8`} />
        </div>
        <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} className={`${inputCls} cursor-pointer`}>
          <option value="">All zones</option>
          {currentPropertyZones.map((z) => <option key={z.zone_uid} value={z.name}>{z.name}</option>)}
        </select>
        <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} className={`${inputCls} cursor-pointer`}>
          <option value="all">All reasons</option>
          <option value="NEXT_SCHEDULED_OCCURRENCE">Occurrence expired</option>
          <option value="SYSTEM_DAILY_ROLLOVER">Daily rollover</option>
        </select>
        <button onClick={() => void load()} className="p-2 text-[#8C867C] hover:bg-[#F5F2EB] rounded-[9px] cursor-pointer" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-sm text-[#8C867C] py-12 text-center">Loading abandoned tasks…</p>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center">
          <OctagonX className="w-10 h-10 text-[#D5CFC3] mx-auto mb-3" />
          <p className="text-sm font-medium text-[#6C675F]">Nothing abandoned today</p>
          <p className="text-xs text-[#8C867C] mt-1">
            Tasks abandoned by the expiry sweep, daily rollover, or manually will appear here.
          </p>
        </div>
      ) : (
        <div className="rounded-[12px] border border-[#EAE5DC] bg-white overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-[#EAE5DC] text-[10.5px] uppercase tracking-wider text-[#8C867C]">
                <th className="px-3.5 py-2.5 font-semibold">Abandoned At</th>
                <th className="px-3.5 py-2.5 font-semibold">Task</th>
                <th className="px-3.5 py-2.5 font-semibold">Target</th>
                <th className="px-3.5 py-2.5 font-semibold">Zone</th>
                <th className="px-3.5 py-2.5 font-semibold">Assignee</th>
                <th className="px-3.5 py-2.5 font-semibold">Occurrence</th>
                <th className="px-3.5 py-2.5 font-semibold">Reason</th>
                <th className="px-3.5 py-2.5 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.task_uid} className="border-b border-[#F0ECE4] last:border-0 bg-[#FDF6EC]">
                  <td className="px-3.5 py-2.5 whitespace-nowrap text-[12px] text-[#58534C]">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-[#A59F95]" /> {fmtTime(item.abandoned_at)}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <p className="font-semibold text-[13px] text-[#24221F] leading-tight">{item.title}</p>
                    {item.ticket_number && (
                      <p className="text-[10.5px] text-[#8C867C]">{item.ticket_number}</p>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 text-[12px] text-[#58534C]">
                    {item.target_label || 'Property-wide'}
                  </td>
                  <td className="px-3.5 py-2.5 text-[12px] text-[#58534C] whitespace-nowrap">
                    {item.zone_name || '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-[12px] text-[#58534C] whitespace-nowrap">
                    {item.assignee || 'Unassigned'}
                  </td>
                  <td className="px-3.5 py-2.5 text-[12px] text-[#58534C] whitespace-nowrap">
                    {item.scheduled_for ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-[#A59F95]" /> {fmtTime(item.scheduled_for)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3.5 py-2.5 whitespace-nowrap">
                    <Badge variant={REASON[item.abandoned_reason || '']?.variant ?? 'neutral'} size="sm">
                      {reasonLabel(item.abandoned_reason)}
                    </Badge>
                    {item.abandoned_from_status && (
                      <p className="text-[10.5px] text-[#8C867C] mt-0.5">
                        was {item.abandoned_from_status.replace(/_/g, ' ')}
                      </p>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => onOpenTask(item.task_uid)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-[#386641] hover:bg-[#EBF3EC] rounded-[8px] inline-flex items-center gap-1 cursor-pointer"
                    >
                      Open <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AbandonedTodayView;
