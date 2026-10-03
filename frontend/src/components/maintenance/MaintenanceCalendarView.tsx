import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { maintenanceCalendar } from '../../api/maintenance';
import {
  MaintenanceCalendarDay,
  MaintenanceCalendarResponse,
} from '../../api/types';
import { OperationalCalendar } from '../ui/OperationalCalendar';
import { istDateKey } from '../../lib/datetime';

/**
 * Maintenance Calendar — one cell per operational day. Unlike tasks,
 * tickets persist across days: "carried" counts tickets raised earlier
 * still open during that day's window. Every date opens the daily
 * maintenance analysis page.
 */
export const MaintenanceCalendarView: React.FC = () => {
  const { activePropertyUid, navigate } = useApp();
  const [month, setMonth] = useState(() => istDateKey().slice(0, 7));
  const [data, setData] = useState<MaintenanceCalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    maintenanceCalendar(month, activePropertyUid || undefined)
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
        navigate(`/property/${activePropertyUid}/maintenance/history/${date}`)
      }
      renderDay={(_date, raw) => {
        const day = raw as MaintenanceCalendarDay;
        const finished = day.closed + day.resolved;
        return (
          <div className="mt-1.5 space-y-1">
            <span className="block text-[11px] font-semibold text-[#48443D]">
              {day.raised > 0 && `${day.raised} raised`}
              {day.raised > 0 && day.carried > 0 && ' · '}
              {day.carried > 0 && `${day.carried} carried`}
            </span>
            <span className="flex items-center gap-1">
              {finished > 0 && (
                <span
                  className="h-1.5 rounded-full bg-[#386641]"
                  style={{ width: `${Math.max(6, finished * 6)}px` }}
                  title={`${finished} resolved/closed`}
                />
              )}
              {day.cancelled > 0 && (
                <span
                  className="h-1.5 rounded-full bg-[#C53B3B]"
                  style={{ width: `${Math.max(6, day.cancelled * 6)}px` }}
                  title={`${day.cancelled} cancelled`}
                />
              )}
            </span>
          </div>
        );
      }}
      legend={
        <>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-1.5 rounded-full bg-[#386641]" /> Resolved / closed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-1.5 rounded-full bg-[#C53B3B]" /> Cancelled
          </span>
          <span className="ml-auto">carried = raised earlier, still open</span>
        </>
      }
    />
  );
};

export default MaintenanceCalendarView;
