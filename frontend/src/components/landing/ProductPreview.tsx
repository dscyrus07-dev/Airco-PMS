import React from 'react';
import {
  Bed,
  Building2,
  CheckSquare,
  Layers,
  Users,
} from 'lucide-react';

/**
 * A coded replica of the product interface — property cards, task rows,
 * status chips and zone structure in the app's real design language.
 */
export const ProductPreview: React.FC = () => {
  return (
    <div
      className="rounded-[18px] bg-white border border-[#E4DFD5] shadow-[0_20px_60px_rgba(30,25,15,0.10)] overflow-hidden"
      aria-hidden="true"
    >
      {/* Fake window chrome */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-[#F0ECE4] bg-[#FAF8F5]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#E5B8B8]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#EDD9B8]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#C9DBC9]" />
        <div className="ml-3 flex-1 max-w-xs bg-white border border-[#EDE8DF] rounded-[7px] px-2.5 py-1 text-[10px] text-[#8C867C] font-mono truncate">
          managementtool.app/property/PROP-001/zones
        </div>
      </div>

      {/* App header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#F0ECE4]">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-[7px] bg-[#386641] text-white flex items-center justify-center font-display font-bold text-[10px]">
            MT
          </span>
          <span className="font-display font-semibold text-xs text-[#24221F]">Management Tool</span>
          <span className="text-[#C4BDB0]">|</span>
          <span className="text-[11px] text-[#6C675F] font-medium">Zostel Varanasi</span>
        </div>
        <div className="hidden sm:flex items-center gap-1">
          {['Zones', 'Employees', 'Rooms', 'Tasks'].map((item, i) => (
            <span
              key={item}
              className={`px-2.5 py-1 rounded-[7px] text-[10px] font-medium ${
                i === 0 ? 'bg-[#EBF3EC] text-[#244E2C]' : 'text-[#736E65]'
              }`}
            >
              {item}
            </span>
          ))}
          <span className="w-6 h-6 rounded-full bg-[#386641] text-white text-[9px] font-bold flex items-center justify-center ml-1.5">
            RS
          </span>
        </div>
      </div>

      <div className="p-4 sm:p-5 bg-[#FAF8F5]">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {/* Property card */}
          <div className="bg-white rounded-[14px] border border-[#EAE5DC] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#F4F0E8] text-[#555047] border border-[#E2DDD5]">
                PROP-001
              </span>
              <span className="text-[9px] font-semibold text-[#2E6038] bg-[#EBF3EC] px-1.5 py-0.5 rounded-full border border-[#CFE4D1]">
                Active
              </span>
            </div>
            <p className="font-display font-bold text-sm text-[#24221F]">Zostel Varanasi</p>
            <p className="text-[10px] text-[#6C675F] mt-0.5">Varanasi, Uttar Pradesh</p>
            <div className="mt-3 p-2 rounded-[8px] bg-[#FAF8F5] border border-[#EAE5DC] text-[10px] text-[#45413B] flex items-center justify-between">
              <span className="inline-flex items-center gap-1">
                <Layers className="w-3 h-3 text-[#386641]" /> <strong>5</strong>&nbsp;Zones
              </span>
              <span className="inline-flex items-center gap-1">
                <Building2 className="w-3 h-3 text-[#2563EB]" /> <strong>10</strong>&nbsp;Rooms
              </span>
              <span className="inline-flex items-center gap-1">
                <Bed className="w-3 h-3 text-[#C8681A]" /> <strong>38</strong>&nbsp;Beds
              </span>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-[#3E6B48] text-white text-[8px] font-bold flex items-center justify-center">
                AM
              </span>
              <div>
                <p className="text-[10px] font-medium text-[#24221F] leading-tight">Arjun Mathur</p>
                <p className="text-[9px] text-[#8C867C] leading-tight">Property Manager</p>
              </div>
            </div>
          </div>

          {/* Zone board mini */}
          <div className="bg-white rounded-[14px] border border-[#EAE5DC] p-4">
            <p className="text-[10px] font-semibold text-[#736E65] uppercase tracking-wider mb-2.5">
              Zone Board — Zone A
            </p>
            <div className="space-y-2">
              {[
                { initials: 'VS', name: 'Vikram Sharma', role: 'Front Desk Lead', color: '#386641' },
                { initials: 'AV', name: 'Amit Verma', role: 'Housekeeping', color: '#B0621F' },
                { initials: 'KS', name: 'Karan Singhania', role: 'Security', color: '#554388' },
              ].map((emp) => (
                <div
                  key={emp.initials}
                  className="flex items-center gap-2 p-1.5 rounded-[9px] bg-[#FAF8F5] border border-[#EDE8DF]"
                >
                  <span
                    className="w-6 h-6 rounded-full text-white text-[8px] font-bold flex items-center justify-center shrink-0"
                    style={{ backgroundColor: emp.color }}
                  >
                    {emp.initials}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium text-[#24221F] truncate">{emp.name}</p>
                    <p className="text-[9px] text-[#8C867C] truncate">{emp.role}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-1 text-[9px] text-[#736E65]">
              <Users className="w-3 h-3" />
              <span>3 staff assigned · drag to reassign zones</span>
            </div>
          </div>

          {/* Tasks mini list */}
          <div className="bg-white rounded-[14px] border border-[#EAE5DC] p-4">
            <p className="text-[10px] font-semibold text-[#736E65] uppercase tracking-wider mb-2.5">
              Open Tasks
            </p>
            <div className="space-y-2">
              {[
                { title: 'Afternoon check-in luggage tags', status: 'In Progress', cls: 'bg-[#FEF3E8] text-[#8C3F03] border-[#FCD9BD]' },
                { title: 'Deep clean Courtyard Café restroom', status: 'Pending', cls: 'bg-[#FDF6EC] text-[#8A5A14] border-[#EFDDBE]' },
                { title: 'Verify bed readiness — Ganga Dorm', status: 'In Progress', cls: 'bg-[#FEF3E8] text-[#8C3F03] border-[#FCD9BD]' },
                { title: 'Rooftop yoga mats restock', status: 'Done', cls: 'bg-[#EBF3EC] text-[#244E2C] border-[#CFE4D1]' },
              ].map((task) => (
                <div
                  key={task.title}
                  className="flex items-center justify-between gap-2 p-1.5 rounded-[9px] bg-[#FAF8F5] border border-[#EDE8DF]"
                >
                  <span className="text-[10px] font-medium text-[#24221F] truncate">
                    {task.title}
                  </span>
                  <span
                    className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${task.cls}`}
                  >
                    {task.status}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-1 text-[9px] text-[#736E65]">
              <CheckSquare className="w-3 h-3" />
              <span>Fixed · Repetitive · Automated rules</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
