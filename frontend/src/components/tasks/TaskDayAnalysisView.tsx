import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, UserCheck, Users, Layers } from 'lucide-react';
import { taskDayAnalysis } from '../../api/tasks';
import { DayAnalysisResponse } from '../../api/types';
import { Card } from '../ui/Card';
import { BackButton } from '../ui/BackButton';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { fmtTimeIST, fmtDateLongIST } from '../../lib/datetime';
import { TASK_STATUS_LABELS } from '../../lib/taskUtils';
import { TaskStatus } from '../../types';

const inputCard =
  'bg-[#FFFFFF] border border-[#EAE5DC] rounded-[14px] px-4 py-3 flex flex-col gap-1';

function Stat({
  label, value, hint,
}: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className={inputCard}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#A39E93]">
        {label}
      </span>
      <span className="font-display text-2xl font-bold text-[#24221F] leading-none">
        {value}
      </span>
      {hint && <span className="text-[11px] text-[#8A857B]">{hint}</span>}
    </div>
  );
}

const STATUS_VARIANT: Record<string, 'sage' | 'orange' | 'red' | 'lavender' | 'neutral'> = {
  pending: 'neutral', assigned: 'lavender', in_progress: 'orange',
  submitted: 'sage', reopened: 'orange', completed: 'sage',
  cancelled: 'neutral', abandoned: 'red', overdue: 'red', scheduled: 'lavender',
};

/**
 * Daily Task Analysis — everything that happened on one operational day.
 * Route: /property/:propertyUid/tasks/history/:date
 * All figures come from the backend aggregation — no derived frontend math
 * beyond display formatting (IST).
 */
export const TaskDayAnalysisView: React.FC = () => {
  const { date = '', propertyUid = '' } = useParams();
  const [data, setData] = useState<DayAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    taskDayAnalysis(date, propertyUid || undefined)
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && setError(e?.message || 'Failed to load analysis.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date, propertyUid]);

  const dayLabel = useMemo(() => {
    const d = date ? new Date(`${date}T12:00:00`) : null;
    return d && !isNaN(d.getTime()) ? fmtDateLongIST(d) : date;
  }, [date]);

  const s = data?.summary;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="mb-2">
            <BackButton
              to={`/property/${propertyUid}/tasks`}
              label="Back to Tasks"
            />
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-[28px] text-[#24221F] tracking-tight">
            Task Analysis — {dayLabel}
          </h1>
          <p className="font-body text-sm text-[#6C675F] mt-1">
            Operational day {date} · starts {data?.operational_day_start || '—'} IST
            {data?.is_today ? ' · in progress' : ''}
          </p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-[#A32A2A] bg-[#FDE8E8] rounded-[10px] px-4 py-3">
          {error}
        </p>
      )}

      {loading || !data || !s ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-[14px]" />
          ))}
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <Stat label="Generated" value={s.generated} />
            <Stat label="Allocated" value={s.allocated} />
            <Stat label="Completed" value={s.completed} />
            <Stat label="Abandoned" value={s.abandoned} />
            <Stat label="Active" value={s.active} />
            <Stat label="Completion" value={`${s.completion_rate}%`} />
            <Stat label="Employees" value={s.employees_involved} />
            <Stat label="Resources" value={s.resources_processed} />
          </div>

          {s.generated === 0 && (
            <Card className="py-10 text-center text-sm text-[#8A857B]">
              No task activity on this operational day.
            </Card>
          )}

          {/* Detailed task breakdown */}
          {data.tasks.length > 0 && (
            <Card>
              <h3 className="font-display font-semibold text-[15px] text-[#24221F] mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#386641]" /> Task breakdown
              </h3>
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[#A39E93] border-b border-[#F0EDE6]">
                      <th className="py-2 pr-3 font-semibold">Task</th>
                      <th className="py-2 pr-3 font-semibold">Resource</th>
                      <th className="py-2 pr-3 font-semibold">Zone / Area</th>
                      <th className="py-2 pr-3 font-semibold">Category</th>
                      <th className="py-2 pr-3 font-semibold">Assigned → Worked</th>
                      <th className="py-2 pr-3 font-semibold">Lifecycle (IST)</th>
                      <th className="py-2 pr-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tasks.map((t) => (
                      <tr key={t.task_uid} className="border-b border-[#F7F4EE] align-top">
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-[#24221F]">{t.title}</div>
                          <div className="text-[11px] text-[#A39E93]">
                            {t.ticket_number || '—'}
                            {t.template_name ? ` · ${t.template_name}` : ''}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-[#575249]">{t.resource || '—'}</td>
                        <td className="py-2.5 pr-3 text-[#575249]">
                          {[t.zone_name, t.area_name].filter(Boolean).join(' / ') || '—'}
                        </td>
                        <td className="py-2.5 pr-3 text-[#575249]">{t.category}</td>
                        <td className="py-2.5 pr-3 text-[#575249]">
                          {t.assigned_employee || '—'}
                          {t.actual_worker && t.actual_worker !== t.assigned_employee && (
                            <span className="text-[#8A857B]"> → {t.actual_worker}</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-[11px] leading-5 text-[#6C675F] whitespace-nowrap">
                          {t.scheduled_for && (
                            <div className="text-[#386641]">
                              Occ {fmtTimeIST(t.scheduled_for)}
                              {t.expires_at ? ` → ${fmtTimeIST(t.expires_at)}` : ''}
                            </div>
                          )}
                          <div>Gen {fmtTimeIST(t.generated_at)}</div>
                          {t.allocated_at && <div>Alloc {fmtTimeIST(t.allocated_at)}</div>}
                          {t.started_at && <div>Start {fmtTimeIST(t.started_at)}</div>}
                          {t.completed_at && <div>Done {fmtTimeIST(t.completed_at)}</div>}
                          {t.abandoned_at && (
                            <div className="text-[#A32A2A]">
                              Abandoned {fmtTimeIST(t.abandoned_at)}
                              {t.abandoned_from_status ? ` (was ${t.abandoned_from_status})` : ''}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge variant={STATUS_VARIANT[t.status] || 'neutral'} size="sm">
                            {TASK_STATUS_LABELS[t.status as TaskStatus] || t.status}
                          </Badge>
                          {t.auto_abandoned && (
                            <div className="text-[10px] text-[#8A857B] mt-1">
                              {t.abandoned_reason === 'NEXT_SCHEDULED_OCCURRENCE'
                                ? 'occurrence expired' : 'daily rollover'}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Employee performance */}
          {data.employees.length > 0 && (
            <Card>
              <h3 className="font-display font-semibold text-[15px] text-[#24221F] mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#386641]" /> Employees
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {data.employees.map((e) => (
                  <div
                    key={e.employee_uid}
                    className="border border-[#EDE8DF] rounded-[12px] p-3.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[13px] text-[#24221F]">
                        {e.employee || 'Former employee'}
                      </span>
                      <span className="text-[11px] font-semibold text-[#386641]">
                        {e.completion_rate}%
                      </span>
                    </div>
                    <div className="text-[11px] text-[#8A857B] mt-0.5">
                      {[...e.zones, ...e.areas].join(' · ') || '—'}
                    </div>
                    <div className="flex gap-3 mt-2 text-[12px] text-[#575249]">
                      <span><b>{e.allocated}</b> allocated</span>
                      <span><b>{e.completed}</b> done</span>
                      {e.abandoned > 0 && (
                        <span className="text-[#A32A2A]"><b>{e.abandoned}</b> abandoned</span>
                      )}
                      {e.active > 0 && (
                        <span className="text-[#9A6A07]"><b>{e.active}</b> active</span>
                      )}
                    </div>
                    {e.work.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-[11px] text-[#8A857B] leading-4 max-h-20 overflow-y-auto">
                        {e.work.map((w, i) => <li key={i}>· {w}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Zone / Area / Category aggregates */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {(
              [
                { title: 'By Zone', rows: data.zones.map((r) => ({ ...r, name: r.zone })), icon: Layers },
                { title: 'By Area', rows: data.areas.map((r) => ({ ...r, name: r.area })), icon: Layers },
                { title: 'By Category', rows: data.categories.map((r) => ({ ...r, name: r.category })), icon: UserCheck },
              ]
            ).map(({ title, rows, icon: Icon }) =>
              rows.length > 0 && (
                <Card key={title}>
                  <h3 className="font-display font-semibold text-[15px] text-[#24221F] mb-3 flex items-center gap-2">
                    <Icon className="w-4 h-4 text-[#386641]" /> {title}
                  </h3>
                  <div className="space-y-2">
                    {rows.map((r) => (
                      <div
                        key={r.name}
                        className="flex items-center justify-between gap-3 border-b border-[#F4EFEB] last:border-0 pb-2 last:pb-0"
                      >
                        <div>
                          <div className="text-[13px] font-semibold text-[#24221F]">{r.name}</div>
                          <div className="text-[11px] text-[#8A857B]">
                            {r.generated} gen · {r.allocated} alloc · {r.completed} done
                            {r.abandoned > 0 ? ` · ${r.abandoned} abandoned` : ''}
                          </div>
                        </div>
                        <span className="text-[12px] font-semibold text-[#386641]">
                          {r.completion_rate}%
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default TaskDayAnalysisView;
