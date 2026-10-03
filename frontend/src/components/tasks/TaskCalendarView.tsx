import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { taskCalendar } from '../../api/tasks';
import { TaskCalendarDay, TaskCalendarResponse } from '../../api/types';
import { OperationalCalendar } from '../ui/OperationalCalendar';
import { istDateKey } from '../../lib/datetime';

/**
 * Task Calendar — one cell per operational day of the month. Dates with
 * task activity carry a colored summary strip (completed / active /
 * abandoned); every date is clickable and opens the daily analysis page.
 * The calendar key is the IST operational day, never the browser day.
 */
export const TaskCalendarView: React.FC = () => {
  const { activePropertyUid, navigate } = useApp();
  const [month, setMonth] = useState(() => istDateKey().slice(0, 7)); // YYYY-MM IST
  const [data, setData] = useState<TaskCalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    taskCalendar(month, activePropertyUid || undefined)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Failed to load calendar.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, activePropertyUid]);

  const byDate = useMemo(() => {
    const m = new Map<string, unknown>();
    for (const d of data?.days || []) m.set(d.date, d);
    return m;
  }, [data]);

  return (
    <OperationalCalendar
      month={month}
      onMonthChange={setMonth}
      days={byDate}
      today={data?.today || ''}
      operationalDayStart={data?.operational_day_start}
      loading={loading}
      error={error}
      onSelect={(date) =>
        navigate(`/property/${activePropertyUid}/tasks/history/${date}`)
      }
      renderDay={(_date, raw) => {
        const day = raw as TaskCalendarDay;
        return (
          <div className="mt-1.5 space-y-1">
            <span className="block text-[11px] font-semibold text-[#48443D]">
              {day.generated} task{day.generated === 1 ? '' : 's'}
            </span>
            <span className="flex items-center gap-1">
              {day.completed > 0 && (
                <span
                  className="h-1.5 rounded-full bg-[#386641]"
                  style={{ width: `${Math.max(6, day.completed * 6)}px` }}
                  title={`${day.completed} completed`}
                />
              )}
              {day.active > 0 && (
                <span
                  className="h-1.5 rounded-full bg-[#D6A017]"
                  style={{ width: `${Math.max(6, day.active * 6)}px` }}
                  title={`${day.active} active`}
                />
              )}
              {day.abandoned > 0 && (
                <span
                  className="h-1.5 rounded-full bg-[#C53B3B]"
                  style={{ width: `${Math.max(6, day.abandoned * 6)}px` }}
                  title={`${day.abandoned} abandoned`}
                />
              )}
            </span>
          </div>
        );
      }}
      legend={
        <>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-1.5 rounded-full bg-[#386641]" /> Completed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-1.5 rounded-full bg-[#D6A017]" /> Still active
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-1.5 rounded-full bg-[#C53B3B]" /> Abandoned
          </span>
        </>
      }
    />
  );
};

export default TaskCalendarView;
