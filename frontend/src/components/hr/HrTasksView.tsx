import React, { useCallback, useEffect, useState } from 'react';
import { CheckSquare, Search, ChevronDown } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import * as hrApi from '../../api/hr';
import { fmtDateTimeIST } from '../../lib/datetime';

const inputCls =
  'w-full px-3.5 py-2.5 bg-white border border-[#DDD7CB] rounded-[10px] font-body text-sm text-[#24221F] placeholder-[#B5AFA1] focus:outline-none focus:ring-[3px] focus:ring-[#386641]/15 focus:border-[#386641] transition-all';

const STATUS_OPTIONS = [
  '', 'pending', 'assigned', 'in_progress', 'submitted',
  'completed', 'overdue', 'cancelled', 'scheduled',
];

const EVENT_LABELS: Record<string, string> = {
  allocated: 'Employee Assigned',
  reassigned: 'Reassigned',
  started: 'Work Started',
  completed: 'Work Completed',
  edited: 'Details Edited',
  redo_requested: 'Redo Requested',
  auto_generated: 'Template Generated',
  employee_removed: 'Assignee Removed',
};

type Tab = 'dashboard' | 'logs';

export const HrTasksView: React.FC = () => {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [dash, setDash] = useState<hrApi.HrTasksDashboard | null>(null);
  const [tasks, setTasks] = useState<hrApi.HrTaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<hrApi.TaskTimeline | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDash = useCallback(async () => {
    try { setDash(await hrApi.hrTasksDashboard()); } catch { /* keep prior */ }
  }, []);
  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrApi.hrListTasks({
        status: status || undefined, search: search || undefined,
        page, limit: 50,
      });
      setTasks(res.items); setTotal(res.total);
    } catch { /* keep prior */ } finally { setLoading(false); }
  }, [status, search, page]);

  useEffect(() => { void loadDash(); }, [loadDash]);
  useEffect(() => {
    const t = setTimeout(() => void loadTasks(), 250);
    return () => clearTimeout(t);
  }, [loadTasks]);

  const toggleTimeline = async (uid: string) => {
    if (openUid === uid) { setOpenUid(null); setTimeline(null); return; }
    setOpenUid(uid); setTimeline(null);
    try { setTimeline(await hrApi.hrTaskTimeline(uid)); } catch { /* keep null */ }
  };

  const kpis = [
    { label: 'Total Tasks', value: dash?.total ?? 0 },
    { label: 'Open', value: dash?.open ?? 0 },
    { label: 'In Progress', value: dash?.by_status?.in_progress ?? 0 },
    { label: 'Completed', value: dash?.completed ?? 0 },
    { label: 'Overdue', value: dash?.overdue ?? 0 },
    { label: 'Cancelled', value: dash?.cancelled ?? 0 },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display font-bold text-2xl sm:text-[28px] text-[#24221F] tracking-tight">
          Task Management
        </h1>
        <p className="font-body text-sm text-[#6C675F] mt-1">
          Read-only view of generated work and allocation outcomes — assignment
          remains fully automatic via the central allocation engine.
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        {(['dashboard', 'logs'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3.5 py-1.5 rounded-[8px] text-xs font-medium transition-all cursor-pointer capitalize ${
              tab === t
                ? 'bg-[#386641] text-white shadow-xs'
                : 'bg-white text-[#555047] border border-[#DDD7CB] hover:bg-[#F2ECE3]'}`}>
            {t === 'logs' ? 'Task Log' : 'Dashboard'}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {kpis.map((k) => (
              <Card key={k.label} className="p-4">
                <span className="block text-[11px] font-semibold text-[#8C867C] uppercase tracking-wide">
                  {k.label}
                </span>
                <span className="font-display font-bold text-2xl text-[#24221F]">{k.value}</span>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="font-display font-bold text-sm text-[#24221F] mb-3">
                Tasks by Employee
              </h3>
              {(dash?.by_employee ?? []).length === 0 && (
                <p className="text-xs text-[#8C867C]">No assigned tasks yet.</p>
              )}
              <div className="space-y-2">
                {(dash?.by_employee ?? []).map((r) => (
                  <div key={r.employee} className="flex items-center justify-between text-sm">
                    <span className="text-[#555047]">{r.employee}</span>
                    <Badge variant="neutral" size="sm">{r.count}</Badge>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="font-display font-bold text-sm text-[#24221F] mb-3">
                Status Breakdown
              </h3>
              <div className="space-y-2">
                {Object.entries(dash?.by_status ?? {}).map(([s, c]) => (
                  <div key={s} className="flex items-center justify-between text-sm">
                    <span className="text-[#555047] capitalize">{s.replace('_', ' ')}</span>
                    <Badge variant="neutral" size="sm">{c}</Badge>
                  </div>
                ))}
                {Object.keys(dash?.by_status ?? {}).length === 0 && (
                  <p className="text-xs text-[#8C867C]">No tasks recorded yet.</p>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-[#ECE6DA] flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C867C]" />
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search task title…" className={`${inputCls} pl-9`} />
            </div>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className={`${inputCls} w-auto capitalize`}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.slice(1).map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div className="divide-y divide-[#F5F2EB]">
            {tasks.map((t) => (
              <div key={t.task_uid}>
                <button onClick={() => void toggleTimeline(t.task_uid)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[#FAF8F5] text-left cursor-pointer">
                  <ChevronDown className={`w-4 h-4 text-[#8C867C] transition-transform ${openUid === t.task_uid ? 'rotate-180' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-[#8C867C]">{t.ticket_number}</span>
                      <span className="text-sm font-semibold text-[#24221F] truncate">{t.title}</span>
                      <Badge variant={t.status === 'completed' ? 'sage' : 'neutral'} size="sm">
                        {t.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="text-xs text-[#8C867C] mt-0.5">
                      {t.room_number ? `Room ${t.room_number}` : t.dorm_name || '—'}
                      {t.assigned_to_name ? ` · ${t.assigned_to_name}` : ' · Unassigned'}
                      {t.allocation_method ? ` · ${t.allocation_method.replace('_', ' ')}` : ''}
                    </div>
                  </div>
                  <div className="text-xs text-[#8C867C] shrink-0">
                    {t.created_at ? fmtDateTimeIST(t.created_at) : ''}
                  </div>
                </button>
                {openUid === t.task_uid && (
                  <div className="px-10 pb-4">
                    {!timeline ? (
                      <p className="text-xs text-[#8C867C]">Loading timeline…</p>
                    ) : timeline.events.length === 0 ? (
                      <p className="text-xs text-[#8C867C]">No recorded events.</p>
                    ) : (
                      <ol className="space-y-1.5 border-l-2 border-[#ECE6DA] pl-4">
                        {timeline.events.map((e, i) => (
                          <li key={i} className="relative">
                            <div className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-[#386641]" />
                            <div className="text-xs font-semibold text-[#24221F]">
                              {EVENT_LABELS[e.type] || e.type.replaceAll('_', ' ')}
                            </div>
                            <div className="text-[11px] text-[#8C867C]">
                              {e.actor_name || 'System'}
                              {e.at ? ` · ${fmtDateTimeIST(e.at)}` : ''}
                              {e.note ? ` — ${e.note}` : ''}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            ))}
            {tasks.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-[#8C867C]">
                {loading ? 'Loading tasks…' : 'No tasks match this filter.'}
              </div>
            )}
          </div>
          {total > 50 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#ECE6DA] text-xs text-[#6C675F]">
              <span>Page {page} · {total} tasks</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1 border border-[#DDD7CB] rounded-[8px] disabled:opacity-40 cursor-pointer">Prev</button>
                <button disabled={page * 50 >= total} onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1 border border-[#DDD7CB] rounded-[8px] disabled:opacity-40 cursor-pointer">Next</button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
