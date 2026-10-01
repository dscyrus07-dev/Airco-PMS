import React from 'react';
import { Loader2 } from 'lucide-react';

interface OccupancyToggleProps {
  /** Authoritative operational status from the server. */
  status: string;
  /** Occupancy axis — open occupancy record (`is_occupied` from the API).
   *  This is NOT `status === 'occupied'`: a unit under cleaning or
   *  maintenance can still hold an active occupant. */
  isOccupied?: boolean;
  /** An occupancy command is in flight — both segments locked. */
  busy?: boolean;
  compact?: boolean;
  /** Switch to Occupied — caller opens the check-in modal (guest name required). */
  onCheckIn: () => void;
  /** Switch to Un-occupied — caller opens the checkout confirmation. */
  onCheckOut: () => void;
}

/**
 * Two-segment Occupied / Un-occupied control.
 *
 * "Occupied" is an OCCUPANCY statement (`is_occupied` — an open occupancy
 * record), independent of the operational `status` — an occupied unit can
 * legitimately be under cleaning or maintenance. Check-in is only offered
 * from AVAILABLE + unoccupied; check-out only while occupied. The backend
 * remains the authority — this control only invokes occupancy commands.
 */
export const OccupancyToggle: React.FC<OccupancyToggleProps> = ({
  status,
  isOccupied,
  busy = false,
  compact = false,
  onCheckIn,
  onCheckOut,
}) => {
  // occupancy axis first — fall back to the legacy projection only when
  // the axis wasn't serialized
  const occupied = isOccupied ?? status === 'occupied';
  const canCheckIn = status === 'available' && !occupied && !busy;
  const canCheckOut = occupied && !busy;

  const seg = (active: boolean, enabled: boolean) =>
    compact
      ? `px-1.5 py-0.5 text-[9px] font-semibold transition-colors ${
          active
            ? 'bg-[#2563EB] text-white'
            : 'bg-white text-[#555047]'
        } ${enabled ? 'cursor-pointer hover:bg-[#EBF3EC]' : 'cursor-not-allowed opacity-60'}`
      : `px-2.5 py-1 text-[11px] font-semibold transition-colors ${
          active
            ? 'bg-[#2563EB] text-white'
            : 'bg-white text-[#555047]'
        } ${enabled ? 'cursor-pointer hover:bg-[#EBF3EC]' : 'cursor-not-allowed opacity-60'}`;

  return (
    <span
      className="inline-flex rounded-[7px] border border-[#DDD7CB] overflow-hidden divide-x divide-[#DDD7CB] bg-white"
      role="group"
      aria-label="Occupancy"
      title={
        busy
          ? 'Working…'
          : occupied
            ? 'Occupied — switch to Un-occupied to check out'
            : canCheckIn
              ? 'Un-occupied — switch to Occupied to check in a guest'
              : `Un-occupied (${status}) — check-in available only when Available`
      }
    >
      <button
        type="button"
        aria-pressed={occupied}
        disabled={!canCheckIn}
        onClick={(e) => {
          e.stopPropagation();
          if (canCheckIn) onCheckIn();
        }}
        className={seg(occupied, canCheckIn)}
      >
        {busy && !occupied ? (
          <Loader2 className="w-2.5 h-2.5 animate-spin inline" />
        ) : (
          'Occupied'
        )}
      </button>
      <button
        type="button"
        aria-pressed={!occupied}
        disabled={!canCheckOut}
        onClick={(e) => {
          e.stopPropagation();
          if (canCheckOut) onCheckOut();
        }}
        className={seg(!occupied, canCheckOut)}
      >
        {busy && occupied ? (
          <Loader2 className="w-2.5 h-2.5 animate-spin inline" />
        ) : (
          'Un-occupied'
        )}
      </button>
    </span>
  );
};
