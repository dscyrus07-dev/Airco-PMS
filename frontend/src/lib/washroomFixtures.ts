/**
 * Washroom fixture helpers — everything here derives from REAL
 * `washroom_fixtures` records returned by the API. No seeded or generated
 * data: fixture identity, status, last-cleaned and last-maintenance come
 * straight from the database via `Washroom.fixtures`.
 */
import {
  Bath,
  Box,
  Droplet,
  Droplets,
  Fan,
  Frame,
  ShowerHead,
  Toilet,
  Waves,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import { Washroom, WashroomFixture } from '../types';
import { fmtTimeIST, fmtDateIST, parseIso, isSameISTDay, istDateKey, istDateKeyOffset } from './datetime';

export type FixtureStatus = WashroomFixture['status'];

const BUILTIN_META: Record<
  string,
  { icon: LucideIcon; plural: string; singular: string }
> = {
  shower: { icon: ShowerHead, plural: 'Showers', singular: 'Shower' },
  stall: { icon: Toilet, plural: 'Stalls', singular: 'Stall' },
  urinal: { icon: Droplet, plural: 'Urinals', singular: 'Urinal' },
  sink: { icon: Droplets, plural: 'Sinks', singular: 'Sink' },
  mirror: { icon: Frame, plural: 'Mirrors', singular: 'Mirror' },
  bath_tub: { icon: Bath, plural: 'Bath Tubs', singular: 'Bath Tub' },
  jacuzzi: { icon: Waves, plural: 'Jacuzzis', singular: 'Jacuzzi' },
};

/** Order fixture sections render in the schematic/overview. */
export const FIXTURE_ORDER = [
  'shower',
  'stall',
  'urinal',
  'sink',
  'mirror',
  'bath_tub',
  'jacuzzi',
];

/** Name-based icon heuristics for custom fixture types. */
function customIcon(label: string): LucideIcon {
  const l = label.toLowerCase();
  if (l.includes('dryer')) return Wind;
  if (l.includes('fan') || l.includes('vent')) return Fan;
  if (l.includes('dispenser') || l.includes('soap') || l.includes('sanit'))
    return Droplet;
  return Box;
}

function pluralize(singular: string): string {
  return singular.endsWith('s') ? singular : `${singular}s`;
}

export function fixtureMeta(
  kind: string,
  isCustom: boolean
): { icon: LucideIcon; plural: string; singular: string } {
  if (!isCustom && BUILTIN_META[kind]) return BUILTIN_META[kind];
  return {
    icon: customIcon(kind),
    plural: pluralize(kind),
    singular: kind,
  };
}

export function isCustomKind(kind: string): boolean {
  return !FIXTURE_ORDER.includes(kind);
}

// Canonical fixture states (spec §10): operational | maintenance | inactive.
// 'needs_cleaning' is task-driven — flag a fixture via Assign Task instead.
export const FIXTURE_STATUS_LABEL: Record<FixtureStatus, string> = {
  operational: 'Operational',
  maintenance: 'Maintenance',
  inactive: 'Inactive',
};

export const FIXTURE_STATUS_DOT: Record<FixtureStatus, string> = {
  operational: 'bg-[#386641]',
  maintenance: 'bg-[#C53B3B]',
  inactive: 'bg-[#8C867C]',
};

export const FIXTURE_STATUS_TEXT: Record<FixtureStatus, string> = {
  operational: 'text-[#2E6038]',
  maintenance: 'text-[#A32A2A]',
  inactive: 'text-[#736E65]',
};

export const FIXTURE_CONDITION: Record<FixtureStatus, string> = {
  operational: 'Good',
  maintenance: 'Under repair',
  inactive: 'Decommissioned',
};

const KIND_TYPE_LABEL: Record<string, string> = {
  shower: 'Shower Unit',
  stall: 'Toilet Stall',
  urinal: 'Urinal Fixture',
  sink: 'Sink Unit',
  mirror: 'Mirror Panel',
  bath_tub: 'Bath Tub',
  jacuzzi: 'Jacuzzi Unit',
};

export function fixtureTypeLabel(f: WashroomFixture): string {
  return KIND_TYPE_LABEL[f.fixture_type] || f.fixture_type;
}

/** Fixture counts for display — from real records (covers custom types too). */
export function fixtureCountsFor(
  w: Pick<Washroom, 'fixtures'>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of w.fixtures || []) {
    counts[f.fixture_type] = (counts[f.fixture_type] || 0) + 1;
  }
  return counts;
}

export interface FixtureGroup {
  kind: string;
  isCustom: boolean;
  fixtures: WashroomFixture[];
}

/** Group real fixture records by type, ordered for display. */
export function buildFixtureGroups(
  fixtures: WashroomFixture[]
): FixtureGroup[] {
  const byKind = new Map<string, WashroomFixture[]>();
  for (const f of fixtures || []) {
    const list = byKind.get(f.fixture_type) || [];
    list.push(f);
    byKind.set(f.fixture_type, list);
  }
  return [...byKind.keys()]
    .sort((a, b) => {
      const ai = FIXTURE_ORDER.indexOf(a);
      const bi = FIXTURE_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map((kind) => ({
      kind,
      isCustom: isCustomKind(kind),
      fixtures: byKind
        .get(kind)!
        .sort((a, b) => a.fixture_number - b.fixture_number),
    }));
}

export interface FixtureSummary {
  total: number;
  operational: number;
  maintenance: number;
  inactive: number;
}

export function summarize(fixtures: WashroomFixture[]): FixtureSummary {
  const s: FixtureSummary = {
    total: fixtures.length,
    operational: 0,
    maintenance: 0,
    inactive: 0,
  };
  for (const f of fixtures) {
    if (f.status === 'operational') s.operational++;
    else if (f.status === 'maintenance') s.maintenance++;
    else s.inactive++;
  }
  return s;
}

/** Format an ISO timestamp the way the app displays dates — e.g.
 *  "29 Sep · 10:32 am" — always IST, 12-hour. */
export function fmtTimestamp(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return '—';
  const time = fmtTimeIST(d);
  if (isSameISTDay(d)) return `Today · ${time}`;
  if (istDateKey(d) === istDateKeyOffset(-1)) return `Yesterday · ${time}`;
  return `${fmtDateIST(d)} · ${time}`;
}
