import { MaintenancePriority, MaintenanceStatus } from '../types';

/** Extendable option list — add a row to surface a new type in the UI. */
export const MAINTENANCE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'electrical', label: 'Electrical' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'civil', label: 'Civil' },
  { value: 'carpentry', label: 'Carpentry' },
  { value: 'hvac', label: 'HVAC / AC' },
  { value: 'painting', label: 'Painting' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'appliance', label: 'Appliance' },
  { value: 'internet', label: 'Internet / Network' },
  { value: 'water_drainage', label: 'Water / Drainage' },
  { value: 'cleaning_equipment', label: 'Cleaning Equipment' },
  { value: 'safety_security', label: 'Safety / Security' },
  { value: 'other', label: 'Other' },
];

export const PRIORITY_LABELS: Record<MaintenancePriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const MAINTENANCE_ACTIVE_STATUSES: MaintenanceStatus[] = [
  'open',
  'assigned',
  'in_progress',
  'on_hold',
];

export const isActiveTicket = (status: MaintenanceStatus): boolean =>
  MAINTENANCE_ACTIVE_STATUSES.includes(status);

/** Common issues per maintenance type — `other` always falls back to free text. */
export const MAINTENANCE_ISSUE_OPTIONS: Record<string, string[]> = {
  electrical: [
    'Light not working', 'Fan not working', 'Switch/socket broken',
    'Power outlet dead', 'Fuse/MCB tripping', 'Geyser not heating', 'Wiring sparking',
  ],
  plumbing: [
    'Tap leaking', 'Pipe burst/leak', 'Toilet flush not working',
    'Washbasin clogged', 'Shower not working', 'No hot water', 'Water pressure low',
  ],
  civil: [
    'Wall crack/damage', 'Ceiling leak', 'Door/window broken',
    'Tile damaged', 'Paint peeling', 'Structural damage',
  ],
  carpentry: [
    'Door hinge broken', 'Lock not working', 'Wardrobe damaged',
    'Bed frame broken', 'Drawer stuck', 'Window latch broken',
  ],
  hvac: [
    'AC not cooling', 'AC leaking water', 'AC making noise',
    'Remote not working', 'Filter needs cleaning', 'Thermostat issue',
  ],
  painting: [
    'Wall needs repainting', 'Paint peeling', 'Damp/stain marks', 'Ceiling repaint',
  ],
  furniture: [
    'Chair broken', 'Table damaged', 'Bunk bed loose',
    'Mattress damaged', 'Curtain rod broken', 'Mirror cracked',
  ],
  appliance: [
    'TV not working', 'Fridge not cooling', 'Washing machine broken',
    'Microwave not working', 'Water purifier issue',
  ],
  internet: [
    'WiFi not working', 'Slow internet', 'Router needs restart',
    'No network in room', 'LAN port dead',
  ],
  water_drainage: [
    'Drainage blocked', 'Water logging', 'Gutter overflow', 'Sewage smell',
  ],
  cleaning_equipment: [
    'Vacuum not working', 'Mop/trolley broken', 'Cleaning supplies needed',
  ],
  safety_security: [
    'Lock/latch insecure', 'CCTV not working', 'Fire extinguisher expired',
    'Smoke detector issue', 'Door access issue',
  ],
  other: [],
};
