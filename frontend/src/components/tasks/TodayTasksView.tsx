import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Clock, AlertTriangle, Zap, ChevronRight, RefreshCw,
  CalendarCheck, UserCheck, Play, CheckCircle2, Timer,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import * as tasksApi from '../../api/tasks';
import { TodayTaskItem, TodayTasksResponse } from '../../api/types';
import { Badge } from '../ui/Badge';

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
};

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso.slice(11, 16) || '—'
    : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function hourKey(iso?: string): string {
  if (!iso) return 'Unscheduled';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Unscheduled';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    // Poll for generation transitions — generated work moves
    // pending_generation → generated automatically; 30s is plenty
    pollRef.current = setInterval(() => void load(true), 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

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

  const timeline = useMemo(() => {
    const groups = new Map<string, TodayTaskItem[]>();
    for (const i of filtered) {
      const k = hourKey(i.scheduled_at);
      groups.set(k, [...(groups.get(k) || []), i]);
    }
    return [...groups.entries()];
  }, [filtered]);

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
            {data ? new Date(data.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
          </p>
        </div>
        {summary && (
          <div className="flex flex-wrap gap-1.5">
            {[
              ['Planned', summary.total_planned], ['Generated', summary.generated],
              ['Pending', summary.pending_generation], ['Assigned', summary.assigned],
              ['In Progress', summary.in_progress], ['Completed', summary.completed],
              ['Overdue', summary.overdue],
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

      {/* Timeline */}
      {loading ? (
        <p className="text-sm text-[#8C867C] py-12 text-center">Loading today's schedule…</p>
      ) : timeline.length === 0 ? (
        <div className="py-16 text-center">
          <CalendarCheck className="w-10 h-10 text-[#D5CFC3] mx-auto mb-3" />
          <p className="text-sm font-medium text-[#6C675F]">No work scheduled for today</p>
          <p className="text-xs text-[#8C867C] mt-1">
            There are currently no scheduled or generated tasks for this property.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {timeline.map(([hour, items]) => (
            <div key={hour}>
              <div className="flex items-center gap-3 mb-2.5">
                <span className="text-[11px] font-bold text-[#8C867C] tracking-wider">{hour}</span>
                <div className="flex-1 h-px bg-[#EAE5DC]" />
                <span className="text-[10px] text-[#B5AEA2]">{items.length} item{items.length > 1 ? 's' : ''}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {items.map((item) => {
                  const pending = item.generation_state === 'pending_generation';
                  const gen = GEN_BADGE[item.generation_state] || GEN_BADGE.generated;
                  return (
                    <div
                      key={item.occurrence_key || item.task_uid}
                      className={`rounded-[12px] border p-3.5 flex flex-col gap-2 transition-all ${
                        pending
                          ? 'bg-[#FDFCF9] border-dashed border-[#D9D3C7]'
                          : 'bg-white border-[#EAE5DC] hover:border-[#D5CFC3] hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-[14px] text-[#24221F] leading-tight">{item.title}</p>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant={gen.variant} size="sm">{gen.label}</Badge>
                          {item.work_status && (
                            <Badge variant={WORK_BADGE[item.work_status] || 'neutral'} size="sm">
                              {item.work_status.replace(/_/g, ' ')}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-[12px] text-[#58534C]">
                        {item.target_label || item.room_number || 'Property-wide'}
                        {item.zone_name ? ` · ${item.zone_name}` : ''}
                      </p>
                      <p className="flex items-center gap-1.5 text-[11.5px] text-[#8C867C]">
                        <Clock className="w-3 h-3" /> Today · {fmtTime(item.scheduled_at)}
                      </p>
                      {pending ? (
                        <p className="text-[11.5px] text-[#8C867C]">
                          {item.allocation_method === 'zone_round_robin'
                            ? 'Automatic · Zone Round Robin'
                            : item.assignment_mode === 'individual' ? 'Individual assignment' : item.assignment_mode}
                          {item.template_name ? ` · via ${item.template_name}` : ''}
                        </p>
                      ) : (
                        <p className="text-[11.5px] text-[#58534C]">
                          {item.assignee ? `Assigned to ${item.assignee}` : 'Unassigned'}
                          {item.ticket_number ? ` · ${item.ticket_number}` : ''}
                        </p>
                      )}
                      <div className="flex justify-end pt-1.5 border-t border-[#F0ECE4] mt-auto">
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
                            Open Task <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TodayTasksView;
