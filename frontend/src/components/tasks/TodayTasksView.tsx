import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Clock, AlertTriangle, Zap, ChevronRight, RefreshCw,
  CalendarCheck, UserCheck, Play, CheckCircle2, Timer,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { usePolling } from '../../hooks/usePolling';
import * as tasksApi from '../../api/tasks';
import { TodayTaskItem, TodayTasksResponse } from '../../api/types';
import { Badge } from '../ui/Badge';
import { fmtTimeIST, fmtDateLongIST } from '../../lib/datetime';

const inputCls =
  'px-3 py-2 text-sm bg-white border border-[#E2DCD0] rounded-[10px] focus:outline-none focus:ring-[3px] focus:ring-[#386641]/15 focus:border-[#386641]';

const GEN_BADGE: Record<string, { label: string; variant: 'sage' | 'orange' | 'red' | 'neutral' }> = {
  generated: { label: 'Generated', variant: 'sage' },
  pending_generation: { label: 'Scheduled', variant: 'orange' },
  generation_failed: { label: 'Failed', variant: 'red' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

const WORK_BADGE: Record<string, 'sage' | 'orange' | 'red' | 'lavender' | 'neutral'> = {
  assigned: 'lavender', pending: 'neutral', in_progress: 'orange',
  completed: 'sage', submitted: 'sage', overdue: 'red',
  unassigned: 'neutral', reopened: 'orange', cancelled: 'neutral',
  abandoned: 'neutral',
};

const fmtTime = fmtTimeIST;


interface Props {
  onOpenTask: (taskUid: string) => void;
}

export const TodayTasksView: React.FC<Props> = ({ onOpenTask }) => {
  const { activePropertyUid, currentPropertyZones, currentPropertyEmployees, addToast } = useApp();
  const [data, setData] = useState<TodayTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [scope, setScope] = useState<'all' | 'unassigned'>('all');
  const load = useCallback(async (quiet = false) => {
    if (!activePropertyUid) return;
    if (!quiet) setLoading(true);
    try {
      const res = await tasksApi.tasksToday(activePropertyUid);
      setData(res);
    } catch {
      if (!quiet) addToast({ type: 'error', title: 'Could not load today\'s tasks' });
    } finally {
      setLoading(false);
    }
  }, [activePropertyUid, addToast]);

  useEffect(() => {
    void load();
  }, [load]);
  // Poll for generation transitions — generated work moves
  // pending_generation → generated automatically; 10s keeps the
  // Today list live without requiring a browser refresh. Pauses in a
  // hidden tab and never overlaps an in-flight request.
  usePolling(() => load(true), 10000, true, 'TodayTasksView');

  const generate = async (item: TodayTaskItem) => {
    if (!item.template_uid || !item.occurrence_key) return;
    setGenerating(item.occurrence_key);
    try {
      await tasksApi.generateOccurrence(item.template_uid, item.occurrence_key);
      addToast({ type: 'success', title: 'Task generated', description: item.title });
      await load(true);
    } catch (err) {
      addToast({ type: 'error', title: 'Generation failed', description: err instanceof Error ? err.message : '' });
    } finally {
      setGenerating(null);
    }
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.items.filter((i) => {
      // finished work belongs in Task History, not today's schedule
      if (['completed', 'cancelled', 'abandoned'].includes(i.work_status || '')) return false;
      if (search && !`${i.title} ${i.ticket_number || ''} ${i.assignee || ''} ${i.room_number || ''}`
        .toLowerCase().includes(search.toLowerCase())) return false;
      if (zoneFilter && i.zone_name !== zoneFilter) return false;
      if (sourceFilter === 'template' && i.source !== 'template') return false;
      if (sourceFilter === 'manual' && i.source !== 'manual' && i.source !== 'one_time') return false;
      if (sourceFilter === 'pending' && i.generation_state !== 'pending_generation') return false;
      if (sourceFilter === 'generated' && i.generation_state !== 'generated') return false;
      if (scope === 'unassigned' && (i.assignee || i.generation_state !== 'generated')) return false;
      return true;
    });
  }, [data, search, zoneFilter, sourceFilter, scope]);

  const rows = useMemo(() => {
    // Chronological day schedule — the next pending occurrence sits on
    // top, not the farthest-future one. Generated work lands before its
    // successor occurrences naturally since it generated earlier.
    const t = (i: TodayTaskItem) => {
      const d = i.scheduled_at ? new Date(i.scheduled_at).getTime() : NaN;
      return isNaN(d) ? Number.MAX_SAFE_INTEGER : d;
    };
    return [...filtered].sort((a, b) => t(a) - t(b));
  }, [filtered]);

  // Row aging tint — generated = green baseline; open task stale >1h yellow,
  // >3h red (red wins over yellow wins over green). Age is measured from the
  // item's scheduled time.
  const rowTint = (i: TodayTaskItem): string => {
    if (i.generation_state !== 'generated') return '';
    const open = !i.work_status
      || !['completed', 'cancelled', 'abandoned'].includes(i.work_status);
    if (open && i.scheduled_at) {
      const hrs = (Date.now() - new Date(i.scheduled_at).getTime()) / 3.6e6;
      if (hrs > 3) return 'bg-[#FDE8E8]';
      if (hrs > 1) return 'bg-[#FDF3DC]';
    }
    return 'bg-[#EDF6EF]';
  };

  const summary = data?.summary;
  const attention = summary
    ? [
        { n: summary.overdue, l: 'Overdue', icon: AlertTriangle, tone: 'text-[#B91C1C] bg-[#FDE8E8] border-[#F5C8C8]' },
        { n: summary.pending_generation, l: 'Pending Generation', icon: Timer, tone: 'text-[#B45309] bg-[#FDF6EC] border-[#F0DFC0]' },
        { n: summary.unassigned, l: 'Unassigned', icon: UserCheck, tone: 'text-[#6C675F] bg-[#F5F2EB] border-[#E2DCD0]' },
      ].filter((x) => x.n > 0)
    : [];

  return (
    <div className="space-y-4">
      {/* Header + summary */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-xl text-[#24221F]">Today's Tasks</h2>
          <p className="text-sm text-[#8C867C]">
            {data ? fmtDateLongIST(data.date) : ''}
          </p>
        </div>
        {summary && (
          <div className="flex flex-wrap gap-1.5">
            {[
              ['Planned', summary.total_planned], ['Generated', summary.generated],
              ['Pending', summary.pending_generation], ['Assigned', summary.assigned],
              ['In Progress', summary.in_progress], ['Completed', summary.completed],
              ['Abandoned', summary.abandoned], ['Overdue', summary.overdue],
            ].map(([l, n]) => (
              <span key={l as string} className={`px-2.5 py-1.5 rounded-[9px] text-[11px] font-semibold border ${
                l === 'Overdue' && (n as number) > 0
                  ? 'bg-[#FDE8E8] border-[#F5C8C8] text-[#B91C1C]'
                  : 'bg-white border-[#EAE5DC] text-[#58534C]'
              }`}>
                {l} <span className="text-[#24221F]">{n}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Needs attention */}
      {attention.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attention.map((a) => {
            const Icon = a.icon;
            return (
              <button key={a.l}
                onClick={() => {
                  if (a.l === 'Pending Generation') setSourceFilter('pending');
                  else if (a.l === 'Unassigned') setScope('unassigned');
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-[10px] border text-xs font-semibold cursor-pointer ${a.tone}`}>
                <Icon className="w-3.5 h-3.5" /> {a.n} {a.l}
              </button>
            );
          })}
        </div>
      )}

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
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={`${inputCls} cursor-pointer`}>
          <option value="all">All sources</option>
          <option value="generated">Generated</option>
          <option value="pending">Pending generation</option>
          <option value="template">Template</option>
          <option value="manual">Manual / One-time</option>
        </select>
        <div className="flex items-center gap-1 bg-[#F0EDE6] rounded-[10px] p-1">
          {(['all', 'unassigned'] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-[8px] cursor-pointer ${
                scope === s ? 'bg-white text-[#24221F] shadow-sm' : 'text-[#6C675F]'
              }`}>
              {s === 'all' ? 'All Tasks' : 'Unassigned'}
            </button>
          ))}
        </div>
        <button onClick={() => void load()} className="p-2 text-[#8C867C] hover:bg-[#F5F2EB] rounded-[9px] cursor-pointer" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-sm text-[#8C867C] py-12 text-center">Loading today's schedule…</p>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center">
          <CalendarCheck className="w-10 h-10 text-[#D5CFC3] mx-auto mb-3" />
          <p className="text-sm font-medium text-[#6C675F]">No work scheduled for today</p>
          <p className="text-xs text-[#8C867C] mt-1">
            There are currently no scheduled or generated tasks for this property.
          </p>
        </div>
      ) : (
        <div className="rounded-[12px] border border-[#EAE5DC] bg-white overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-[#EAE5DC] text-[10.5px] uppercase tracking-wider text-[#8C867C]">
                <th className="px-3.5 py-2.5 font-semibold">Time</th>
                <th className="px-3.5 py-2.5 font-semibold">Task</th>
                <th className="px-3.5 py-2.5 font-semibold">Target</th>
                <th className="px-3.5 py-2.5 font-semibold">Zone</th>
                <th className="px-3.5 py-2.5 font-semibold">Assignee</th>
                <th className="px-3.5 py-2.5 font-semibold">Generation</th>
                <th className="px-3.5 py-2.5 font-semibold">Status</th>
                <th className="px-3.5 py-2.5 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const pending = item.generation_state === 'pending_generation';
                const gen = GEN_BADGE[item.generation_state] || GEN_BADGE.generated;
                return (
                  <tr
                    key={item.occurrence_key || item.task_uid}
                    className={`border-b border-[#F0ECE4] last:border-0 ${rowTint(item)}`}
                  >
                    <td className="px-3.5 py-2.5 whitespace-nowrap text-[12px] text-[#58534C]">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-[#A59F95]" /> {fmtTime(item.scheduled_at)}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5">
                      <p className="font-semibold text-[13px] text-[#24221F] leading-tight">{item.title}</p>
                      {item.ticket_number && (
                        <p className="text-[10.5px] text-[#8C867C]">{item.ticket_number}</p>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 text-[12px] text-[#58534C]">
                      {item.target_label || item.room_number || 'Property-wide'}
                    </td>
                    <td className="px-3.5 py-2.5 text-[12px] text-[#58534C] whitespace-nowrap">
                      {item.zone_name || '—'}
                    </td>
                    <td className="px-3.5 py-2.5 text-[12px] whitespace-nowrap">
                      {pending ? (
                        <span className="text-[#8C867C]">
                          {item.allocation_method === 'zone_round_robin'
                            ? 'Auto · Round Robin'
                            : item.assignment_mode === 'individual' ? 'Individual' : item.assignment_mode || '—'}
                        </span>
                      ) : (
                        <span className="text-[#58534C]">{item.assignee || 'Unassigned'}</span>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      <Badge variant={gen.variant} size="sm">{gen.label}</Badge>
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      {item.work_status ? (
                        <Badge variant={WORK_BADGE[item.work_status] || 'neutral'} size="sm">
                          {item.work_status.replace(/_/g, ' ')}
                        </Badge>
                      ) : '—'}
                    </td>
                    <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                      {pending ? (
                        <button
                          onClick={() => void generate(item)}
                          disabled={generating === item.occurrence_key}
                          className="px-2.5 py-1.5 text-xs font-semibold text-[#386641] hover:bg-[#EBF3EC] rounded-[8px] inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          {generating === item.occurrence_key ? 'Generating…' : 'Generate Now'}
                        </button>
                      ) : (
                        <button
                          onClick={() => item.task_uid && onOpenTask(item.task_uid)}
                          className="px-2.5 py-1.5 text-xs font-semibold text-[#386641] hover:bg-[#EBF3EC] rounded-[8px] inline-flex items-center gap-1 cursor-pointer"
                        >
                          Open <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TodayTasksView;
