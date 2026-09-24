import React from 'react';
import {
  ArrowDown,
  BedDouble,
  Building,
  Building2,
  CheckSquare,
  Layers,
  Users,
} from 'lucide-react';

const LAYERS = [
  { icon: Building, label: 'Company', detail: 'Zostel Hospitality Networks', tag: 'COMP-101' },
  { icon: Building2, label: 'Properties', detail: '3 properties · Varanasi, Jaipur, Manali', tag: 'PROP-001' },
  { icon: Layers, label: 'Zones', detail: 'Guest stays, common areas, back-of-house', tag: 'ZONE-001' },
  { icon: BedDouble, label: 'Rooms / Dorms', detail: '10 rooms · 4 dorms · 38 beds', tag: 'ROOM-201' },
  { icon: Users, label: 'Employees', detail: '11 staff assigned across zones', tag: 'EMP-001' },
  { icon: CheckSquare, label: 'Tasks & Operations', detail: 'Fixed, repetitive and automated work', tag: 'TASK-001' },
];

/**
 * The operational hierarchy rendered as connected layers — the same way the
 * product itself models the physical property structure.
 */
export const OperationsSection: React.FC = () => {
  return (
    <section id="operations" className="px-4 sm:px-6 py-14 scroll-mt-20">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-[11px] font-semibold text-[#386641] uppercase tracking-[0.18em] font-body">
              How it connects
            </p>
            <h2 className="font-display font-bold text-2xl sm:text-3xl text-[#24221F] tracking-tight mt-3">
              The whole operation, one connected structure
            </h2>
            <p className="font-body text-sm text-[#6C675F] leading-relaxed mt-3">
              Every layer of the physical property maps to a layer in the workspace —
              so you can always tell where something is, who's responsible for it,
              what state it's in, and what to do next.
            </p>
            <ul className="mt-5 space-y-2.5">
              {[
                'Immutable IDs link every entity — nothing is tied to editable names',
                'Zones adapt to their purpose: guest stays hold beds, common areas hold staff and tasks',
                'Room and bed status changes automatically spawn housekeeping tasks',
              ].map((point) => (
                <li
                  key={point}
                  className="flex items-start gap-2.5 text-[13px] text-[#45413B] font-body"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#386641] mt-[7px] shrink-0" />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* Connected layer stack */}
          <div className="relative">
            <div className="space-y-0">
              {LAYERS.map((layer, i) => (
                <React.Fragment key={layer.label}>
                  <div className="flex items-center gap-3.5 bg-white rounded-[12px] border border-[#EAE5DC] px-4 py-3">
                    <div
                      className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${
                        i === 0
                          ? 'bg-[#386641] text-white'
                          : 'bg-[#EBF3EC] text-[#386641]'
                      }`}
                    >
                      <layer.icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display font-semibold text-sm text-[#24221F]">
                        {layer.label}
                      </p>
                      <p className="text-[11px] text-[#8C867C] truncate">{layer.detail}</p>
                    </div>
                    <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#F4F0E8] text-[#555047] border border-[#E2DDD5] shrink-0">
                      {layer.tag}
                    </span>
                  </div>
                  {i < LAYERS.length - 1 && (
                    <div className="flex justify-center py-0.5" aria-hidden="true">
                      <ArrowDown className="w-3.5 h-3.5 text-[#B8B0A2]" />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
