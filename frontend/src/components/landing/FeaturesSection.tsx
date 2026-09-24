import React from 'react';
import {
  Building2,
  Users,
  CheckSquare,
  BedDouble,
  LayoutDashboard,
  ShieldCheck,
} from 'lucide-react';

const FEATURES = [
  {
    icon: Building2,
    title: 'Property Management',
    description:
      'Manage multiple properties, zones, rooms and operational structures from a centralized workspace.',
  },
  {
    icon: Users,
    title: 'Workforce Management',
    description:
      'Manage employees, departments, managers, assignments and organizational structure.',
  },
  {
    icon: CheckSquare,
    title: 'Task Management',
    description:
      'Create, assign, monitor and review operational tasks across teams and properties.',
  },
  {
    icon: BedDouble,
    title: 'Room Operations',
    description:
      'Track rooms, beds, cleaning status, maintenance and operational requirements.',
  },
  {
    icon: LayoutDashboard,
    title: 'Centralized Operations',
    description:
      'Bring property-level information and daily operations into one system.',
  },
  {
    icon: ShieldCheck,
    title: 'Role-Based Access',
    description:
      'Give each user access to the information and functionality relevant to their role.',
  },
];

export const FeaturesSection: React.FC = () => {
  return (
    <section id="features" className="px-4 sm:px-6 py-14 scroll-mt-20">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-xl">
          <p className="text-[11px] font-semibold text-[#386641] uppercase tracking-[0.18em] font-body">
            What it does
          </p>
          <h2 className="font-display font-bold text-2xl sm:text-3xl text-[#24221F] tracking-tight mt-3">
            Built for the operational layer of hospitality
          </h2>
          <p className="font-body text-sm text-[#6C675F] mt-2 leading-relaxed">
            Everything that keeps a property running — structured, visible and assignable
            in one place.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="bg-white rounded-[14px] border border-[#EAE5DC] p-5 hover:border-[#D5CFC3] transition-colors"
            >
              <div className="w-9 h-9 rounded-[10px] bg-[#EBF3EC] text-[#386641] flex items-center justify-center mb-3.5">
                <feature.icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
              </div>
              <h3 className="font-display font-semibold text-[15px] text-[#24221F]">
                {feature.title}
              </h3>
              <p className="font-body text-[13px] text-[#6C675F] leading-relaxed mt-1.5">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
