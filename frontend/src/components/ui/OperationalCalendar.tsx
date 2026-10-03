import React, { ReactNode, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from './Card';
import { Skeleton } from './Skeleton';
import { istDateKey } from '../../lib/datetime';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface OperationalCalendarProps {
  month: string;                       // 'YYYY-MM' currently displayed
  onMonthChange: (month: string) => void;
  /** date-keyed day stats, rendered inside each cell */
  days: Map<string, unknown>;
  renderDay: (date: string, day: unknown) => ReactNode;
  today: string;                       // current operational-day key
  operationalDayStart?: string;        // 'HH:MM' IST — shown in the subtitle
  loading?: boolean;
  error?: string | null;
  onSelect: (date: string) => void;
  legend?: ReactNode;
}

/**
 * Shared month-grid calendar for operational-day surfaces (tasks,
 * maintenance). Day cells are keyed by the backend's operational-day
 * date — never the browser's local day.
 */
export const OperationalCalendar: React.FC<OperationalCalendarProps> = ({
  month, onMonthChange, days, renderDay, today, operationalDayStart,
  loading, error, onSelect, legend,
}) => {
  const { year, mon, cells } = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const offset = (first.getDay() + 6) % 7; // Monday-first grid
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = Array(offset).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${month}-${String(d).padStart(2, '0')}`);
    }
    return { year: y, mon: m, cells };
  }, [month]);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, mon - 1 + delta, 1);
    onMonthChange(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    );
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between pb-4 border-b border-[#F4EFEB] mb-4">
        <div>
          <h3 className="font-display font-semibold text-[17px] text-[#24221F] tracking-tight">
            {MONTH_NAMES[mon - 1]} {year}
          </h3>
          <p className="text-xs text-[#8A857B] mt-0.5">
            Operational days start at {operationalDayStart || '—'} IST
            — select a date for its full analysis
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => shiftMonth(-1)}
            className="p-2 rounded-[9px] hover:bg-[#F0EDE6] text-[#6C675F] transition-colors cursor-pointer"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => onMonthChange(istDateKey().slice(0, 7))}
            className="px-3 py-1.5 text-[12px] font-semibold rounded-[9px] hover:bg-[#F0EDE6] text-[#575249] transition-colors cursor-pointer"
          >
            Today
          </button>
          <button
            onClick={() => shiftMonth(1)}
            className="p-2 rounded-[9px] hover:bg-[#F0EDE6] text-[#6C675F] transition-colors cursor-pointer"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-[#A32A2A] bg-[#FDE8E8] rounded-[10px] px-4 py-3 mb-4">
          {error}
        </p>
      )}

      {loading ? (
        <Skeleton className="h-[420px] w-full rounded-[12px]" />
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="text-center text-[11px] font-semibold uppercase tracking-wide text-[#A39E93] py-1"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((date, i) => {
              if (!date) return <div key={`e${i}`} />;
              const day = days.get(date);
              const isToday = date === today;
              return (
                <button
                  key={date}
                  onClick={() => onSelect(date)}
                  className={`min-h-[78px] text-left p-2 rounded-[10px] border transition-all cursor-pointer group ${
                    isToday
                      ? 'border-[#386641] bg-[#F4F8F4] ring-1 ring-[#386641]/20'
                      : 'border-[#EDE8DF] hover:border-[#CFC8BA] hover:bg-[#FBF9F4]'
                  }`}
                >
                  <span
                    className={`text-[13px] font-semibold ${
                      isToday
                        ? 'text-[#386641]'
                        : 'text-[#575249] group-hover:text-[#24221F]'
                    }`}
                  >
                    {Number(date.slice(8))}
                  </span>
                  {day !== undefined ? (
                    renderDay(date, day)
                  ) : (
                    <span className="block mt-1.5 text-[11px] text-[#C9C3B7]">—</span>
                  )}
                </button>
              );
            })}
          </div>
          {legend && (
            <div className="flex items-center gap-4 mt-4 pt-3 border-t border-[#F4EFEB] text-[11px] text-[#8A857B]">
              {legend}
            </div>
          )}
        </>
      )}
    </Card>
  );
};

export default OperationalCalendar;
