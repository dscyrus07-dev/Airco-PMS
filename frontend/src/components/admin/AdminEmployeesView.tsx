import React, { useState } from 'react';
import { Users, Building2, Layers, Search, Mail, Phone } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { getInitials } from '../../lib/utils';

export const AdminEmployeesView: React.FC = () => {
  const {
    employees,
    companyProperties: properties,
    company,
    zones,
    setActivePropertyUid,
    navigate,
  } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProperty, setSelectedProperty] = useState('all');

  // Scope the roster to the active organization
  const companyEmployees = employees.filter((e) => e.company_uid === company?.company_uid);

  const filteredEmployees = companyEmployees.filter((emp) => {
    if (selectedProperty !== 'all' && emp.property_uid !== selectedProperty) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = emp.name.toLowerCase().includes(q);
      const matchEmail = emp.email.toLowerCase().includes(q);
      const matchId = emp.employee_uid.toLowerCase().includes(q);
      const matchTitle = emp.job_title.toLowerCase().includes(q);
      if (!matchName && !matchEmail && !matchId && !matchTitle) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-display font-bold text-2xl sm:text-[28px] text-[#24221F] tracking-tight">
            Organization-Wide Staff Directory
          </h1>
          <Badge variant="sage" size="md">
            {companyEmployees.length} Total
          </Badge>
        </div>
        <p className="font-body text-sm text-[#6C675F] mt-1">
          Complete personnel roster across all physical properties and regional zones
        </p>
      </div>

      {/* Search & Filter Bar */}
      <div className="p-4 rounded-[14px] bg-[#FAF8F5] border border-[#EAE5DC] flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#8C867C] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, ID, job title, or email..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
          />
        </div>

        <div className="flex items-center gap-2 sm:w-64">
          <Building2 className="w-4 h-4 text-[#736E65]" />
          <select
            value={selectedProperty}
            onChange={(e) => setSelectedProperty(e.target.value)}
            className="w-full bg-white border border-[#DDD7CB] rounded-[10px] px-3 py-2 text-xs text-[#24221F] focus:outline-none"
          >
            <option value="all">All Properties ({properties.length})</option>
            {properties.map((p) => (
              <option key={p.property_uid} value={p.property_uid}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredEmployees.map((emp) => {
          const prop = properties.find((p) => p.property_uid === emp.property_uid);
          const zone = zones.find((z) => z.zone_uid === emp.zone_uid);

          return (
            <Card key={emp.employee_uid} className="p-4 hover:border-[#D0C8BB]">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full text-white flex items-center justify-center font-bold text-sm shrink-0"
                    style={{ backgroundColor: emp.avatar_color || '#386641' }}
                  >
                    {getInitials(emp.name)}
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm text-[#24221F] leading-tight">
                      {emp.name}
                    </h4>
                    <p className="text-xs text-[#6C675F] font-body mt-0.5">{emp.job_title}</p>
                  </div>
                </div>

                <span className="font-mono text-[11px] text-[#736E65] px-1.5 py-0.5 rounded bg-[#FAF8F5] border border-[#EAE5DC]">
                  {emp.employee_uid}
                </span>
              </div>

              {/* Property & Zone Badges */}
              <div className="space-y-1.5 mb-3 text-xs">
                <div
                  onClick={() => {
                    if (prop) {
                      setActivePropertyUid(prop.property_uid);
                      navigate(`/property/${prop.property_uid}/employees`);
                    }
                  }}
                  className="flex items-center gap-1.5 text-[#386641] hover:underline cursor-pointer"
                >
                  <Building2 className="w-3.5 h-3.5" />
                  <span className="font-medium">{prop?.name || 'Property'}</span>
                </div>

                <div className="flex items-center gap-1.5 text-[#6C675F]">
                  <Layers className="w-3.5 h-3.5 text-[#8C867C]" />
                  <span>
                    {zone ? `${zone.name} (${zone.floor})` : 'Unallocated Staff Pool'}
                  </span>
                </div>
              </div>

              <div className="pt-2.5 border-t border-[#F2ECE3] flex items-center justify-between text-xs text-[#736E65]">
                <span className="font-medium text-[#48443E]">{emp.department}</span>
                <span className="capitalize">{emp.status}</span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
