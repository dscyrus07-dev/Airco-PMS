import React from 'react';
import { Building, Check, ShieldCheck, UserCog, UserRound } from 'lucide-react';

const ROLES = [
  {
    icon: ShieldCheck,
    title: 'Super Admin',
    scope: 'Entire company',
    points: [
      'Company-wide visibility across every property',
      'Manage properties, managers and employees',
      'Organization settings and role control',
    ],
    accent: 'bg-[#386641] text-white',
    chip: 'bg-[#EBF3EC] text-[#244E2C] border-[#CFE4D1]',
  },
  {
    icon: UserCog,
    title: 'Property Manager',
    scope: 'One assigned property',
    points: [
      'Zones, rooms, dorms and beds within the property',
      'Employee allocation via visual zone boards',
      'Task creation, automation rules and review',
    ],
    accent: 'bg-[#B0621F] text-white',
    chip: 'bg-[#FDF6EC] text-[#8A5A14] border-[#EFDDBE]',
  },
  {
    icon: UserRound,
    title: 'Employee',
    scope: 'Assigned work only',
    points: [
      'Focused view of tasks assigned to them',
      'Start and complete work with photo evidence',
      'Profile and zone context — nothing else',
    ],
    accent: 'bg-[#554388] text-white',
    chip: 'bg-[#EFF0FA] text-[#3F4C8C] border-[#D5DAF0]',
  },
];

export const RolesSection: React.FC = () => {
  return (
    <section id="about" className="px-4 sm:px-6 py-14 scroll-mt-20">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-xl">
          <p className="text-[11px] font-semibold text-[#386641] uppercase tracking-[0.18em] font-body">
            Role-based access
          </p>
          <h2 className="font-display font-bold text-2xl sm:text-3xl text-[#24221F] tracking-tight mt-3">
            A different workspace for every role
          </h2>
          <p className="font-body text-sm text-[#6C675F] mt-2 leading-relaxed">
            Each user sees exactly the scope they operate — never the admin interface
            with things hidden.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          {ROLES.map((role) => (
            <div
              key={role.title}
              className="bg-white rounded-[14px] border border-[#EAE5DC] p-5"
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className={`w-9 h-9 rounded-[10px] flex items-center justify-center ${role.accent}`}
                >
                  <role.icon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-display font-semibold text-[15px] text-[#24221F] leading-tight">
                    {role.title}
                  </h3>
                  <span
                    className={`inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-full border mt-1 ${role.chip}`}
                  >
                    {role.scope}
                  </span>
                </div>
              </div>
              <ul className="space-y-2">
                {role.points.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-2 text-[12.5px] text-[#45413B] font-body"
                  >
                    <Check className="w-3.5 h-3.5 text-[#386641] mt-0.5 shrink-0" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-2 text-[11px] text-[#8C867C] font-body">
          <Building className="w-3.5 h-3.5" />
          <span>Permissions are enforced per role — URLs cannot be used to reach another workspace.</span>
        </div>
      </div>
    </section>
  );
};
