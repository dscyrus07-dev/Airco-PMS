import { Zone, ZoneType } from '../types';

export const ZONE_TYPE_OPTIONS: { value: ZoneType; label: string; hint: string }[] = [
  { value: 'stay', label: 'Guest Stay', hint: 'Rooms, dorms & beds' },
  { value: 'common', label: 'Common Area', hint: 'Lobby, lounge, co-working' },
  { value: 'dining', label: 'Dining / F&B', hint: 'Café, kitchen, restaurant' },
  { value: 'amenities', label: 'Amenities', hint: 'Gym, pool, spa, yoga deck' },
  { value: 'outdoor', label: 'Outdoor', hint: 'Garden, terrace, parking' },
  { value: 'back_of_house', label: 'Back of House', hint: 'Staff, storage, laundry' },
];

export const ZONE_TYPE_LABELS: Record<ZoneType, string> = ZONE_TYPE_OPTIONS.reduce(
  (acc, o) => ({ ...acc, [o.value]: o.label }),
  {} as Record<ZoneType, string>
);

/** Whether a zone can contain rooms/dorms/beds. Missing type = legacy stay zone. */
export const zoneSupportsUnits = (zone?: Pick<Zone, 'zone_type'> | null): boolean =>
  !zone?.zone_type || zone.zone_type === 'stay';
