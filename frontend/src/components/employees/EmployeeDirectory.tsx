import React, { useState } from 'react';
import {
  Search,
  Filter,
  Mail,
  Phone,
  Layers,
  Calendar,
  MoreVertical,
  UserCheck,
  UserX,
  Edit,
  Shield,
  Trash2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { DEPARTMENTS } from './CreateEmployeeModal';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { Employee } from '../../types';
import { getInitials } from '../../lib/utils';

export const EmployeeDirectory: React.FC = () => {
  const {
    currentPropertyEmployees,
    currentPropertyZones,
    currentPropertyAreas,
    updateEmployee,
    deactivateEmployee,
    assignEmployeeToZone,
    assignEmployeeToArea,
    navigate,
    activePropertyUid,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedZone, setSelectedZone] = useState('all');
  const [selectedDept, setSelectedDept] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  const [activeMenuEmpUid, setActiveMenuEmpUid] = useState<string | null>(null);
  const [empToDeactivate, setEmpToDeactivate] = useState<Employee | null>(null);

  // Edit employee modal state
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [editName, setEditName] = useState('');
  const [editJobTitle, setEditJobTitle] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editPhone, setEditPhone] = useState('');

  // Filtering
  const filteredEmployees = currentPropertyEmployees.filter((emp) => {
    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = emp.name.toLowerCase().includes(q);
      const matchEmail = emp.email.toLowerCase().includes(q);
      const matchId = emp.employee_uid.toLowerCase().includes(q);
      const matchRole = emp.job_title.toLowerCase().includes(q);
      if (!matchName && !matchEmail && !matchId && !matchRole) return false;
    }

    // Zone filter
    if (selectedZone !== 'all') {
      if (selectedZone === 'unallocated' && (emp.zone_uid || emp.area_uid)) return false;
      if (selectedZone !== 'unallocated' && emp.zone_uid !== selectedZone) return false;
    }

    // Department filter
    if (selectedDept !== 'all' && emp.department !== selectedDept) return false;

    // Status filter
    if (selectedStatus !== 'all' && emp.status !== selectedStatus) return false;

    return true;
  });

  const handleStartEdit = (emp: Employee) => {
    setEditingEmp(emp);
    setEditName(emp.name);
    setEditJobTitle(emp.job_title);
    setEditDept(emp.department);
    setEditPhone(emp.phone);
    setActiveMenuEmpUid(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp || !editName.trim()) return;
    try {
      await updateEmployee(editingEmp.employee_uid, {
        name: editName.trim(),
        job_title: editJobTitle.trim(),
        department: editDept as any,
        phone: editPhone.trim(),
      });
      setEditingEmp(null);
    } catch {
      // Error toast handled by the context layer — keep dialog open
    }
  };

  return (
    <div className="space-y-5">
      {/* Search and Filter Controls */}
      <div className="p-4 rounded-[14px] bg-[#FAF8F5] border border-[#EAE5DC] space-y-3">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-[#8C867C] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, employee ID (e.g. EMP-001), job title, or email..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] placeholder:text-[#9F998F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641]"
          />
        </div>

        {/* Filter Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-[#736E65] font-medium shrink-0">Zone:</span>
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="w-full bg-white border border-[#DDD7CB] rounded-[8px] px-2.5 py-1.5 text-xs text-[#24221F] focus:outline-none"
            >
              <option value="all">All Zones</option>
              <option value="unallocated">Unallocated Pool</option>
              {currentPropertyZones.map((z) => (
                <option key={z.zone_uid} value={z.zone_uid}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[#736E65] font-medium shrink-0">Dept:</span>
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="w-full bg-white border border-[#DDD7CB] rounded-[8px] px-2.5 py-1.5 text-xs text-[#24221F] focus:outline-none"
            >
              <option value="all">All Departments</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[#736E65] font-medium shrink-0">Status:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full bg-white border border-[#DDD7CB] rounded-[8px] px-2.5 py-1.5 text-xs text-[#24221F] focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Staff</option>
              <option value="inactive">Inactive / Past</option>
            </select>
          </div>
        </div>
      </div>

      {/* Employees Grid */}
      {filteredEmployees.length === 0 ? (
        <Card className="p-10 text-center border-dashed">
          <p className="font-semibold text-sm text-[#24221F]">No employees found</p>
          <p className="text-xs text-[#6C675F] mt-1">
            Try adjusting your search query or clear active filters.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredEmployees.map((emp) => {
            const zone = currentPropertyZones.find((z) => z.zone_uid === emp.zone_uid);
            const isMenuOpen = activeMenuEmpUid === emp.employee_uid;

            return (
              <Card
                key={emp.employee_uid}
                className="p-4 flex flex-col justify-between hover:border-[#D0C8BB] relative"
              >
                <div>
                  {/* Top Bar: Initials avatar + Actions Kebab */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs"
                        style={{ backgroundColor: emp.avatar_color || '#386641' }}
                      >
                        {getInitials(emp.name)}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="font-semibold text-sm text-[#24221F] leading-tight">
                            {emp.name}
                          </h4>
                          {(emp.status === 'Off Duty' || (emp.status as string) === 'inactive') && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#FDE8E8] text-[#A82828] font-medium">
                              Inactive
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#6C675F] font-body mt-0.5">
                          {emp.job_title}
                        </p>
                      </div>
                    </div>

                    {/* Kebab Menu */}
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuEmpUid(isMenuOpen ? null : emp.employee_uid);
                        }}
                        className="p-1 text-[#8C867C] hover:text-[#24221F] hover:bg-[#F2ECE3] rounded-[6px] transition-colors cursor-pointer"
                        aria-label="Actions"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {isMenuOpen && (
                        <div
                          className="absolute right-0 top-7 z-30 w-40 bg-white border border-[#E4DFD5] rounded-[10px] shadow-lg py-1 animate-in fade-in"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => handleStartEdit(emp)}
                            className="w-full px-3 py-1.5 text-xs text-[#24221F] hover:bg-[#F6F3EE] flex items-center gap-2 text-left cursor-pointer"
                          >
                            <Edit className="w-3.5 h-3.5 text-[#736E65]" />
                            <span>Edit Details</span>
                          </button>
                          <div className="my-1 border-t border-[#F0ECE4]" />
                          {(emp.status === 'Active' || (emp.status as string) === 'active') && (
                            <button
                              onClick={() => {
                                setEmpToDeactivate(emp);
                                setActiveMenuEmpUid(null);
                              }}
                              className="w-full px-3 py-1.5 text-xs text-[#C53B3B] hover:bg-[#FDE8E8] flex items-center gap-2 text-left cursor-pointer"
                            >
                              <UserX className="w-3.5 h-3.5" />
                              <span>Deactivate Staff</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ID & Department Tag */}
                  <div className="flex items-center justify-between text-xs mb-3">
                    <span className="font-mono text-[11px] text-[#736E65] px-1.5 py-0.5 rounded bg-[#FAF8F5] border border-[#EAE5DC]">
                      {emp.employee_uid}
                    </span>
                    <span className="text-[11px] font-medium text-[#48443E] bg-[#F2ECE3] px-2 py-0.5 rounded-full truncate max-w-[170px]">
                      {emp.department}
                    </span>
                  </div>

                  {/* Contact Info */}
                  <div className="space-y-1 text-xs text-[#6C675F] font-body mb-3">
                    <div className="flex items-center gap-2 truncate">
                      <Mail className="w-3.5 h-3.5 text-[#9E988E] shrink-0" />
                      <span className="truncate">{emp.email}</span>
                    </div>
                    {emp.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-[#9E988E] shrink-0" />
                        <span>{emp.phone}</span>
                      </div>
                    )}
                  </div>

                  {/* Zone / Area Assignment Dropdown */}
                  <div className="mb-2">
                    <label className="block text-[10px] font-semibold text-[#8C867C] uppercase tracking-wider mb-1 font-body">
                      Assigned Zone / Area
                    </label>
                    <select
                      value={emp.area_uid ? `area:${emp.area_uid}` : emp.zone_uid || ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v.startsWith('area:')) {
                          assignEmployeeToArea(emp.employee_uid, v.slice(5));
                        } else {
                          assignEmployeeToZone(emp.employee_uid, v || null);
                        }
                      }}
                      className="w-full bg-[#FAF8F5] border border-[#DDD7CB] rounded-[8px] px-2.5 py-1 text-xs text-[#24221F] focus:outline-none"
                    >
                      <option value="">(Unallocated Pool)</option>
                      {currentPropertyAreas.map((a) => (
                        <option key={a.area_uid} value={`area:${a.area_uid}`}>
                          {a.name} — whole area
                        </option>
                      ))}
                      {currentPropertyZones.map((z) => (
                        <option key={z.zone_uid} value={z.zone_uid}>
                          {z.name} ({z.floor})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Footer: Leave Balance / Status */}
                <div className="pt-2.5 border-t border-[#F2ECE3] flex items-center justify-between text-xs text-[#6C675F]">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#8C867C]" />
                    <span>
                      Leave balance: <strong>{emp.leave_balance_days ?? '—'}</strong> days
                    </span>
                  </div>

                  {emp.status === 'On Leave' || emp.leave_status ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF3E8] text-[#8C3F03]">
                      On Leave
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#EBF3EC] text-[#2E6038]">
                      Active On Duty
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit Employee Modal */}
      {editingEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1D1B18]/40">
          <div className="w-full max-w-md bg-white border border-[#E4DFD5] rounded-[18px] p-6 shadow-xl">
            <h3 className="font-display font-bold text-lg text-[#24221F] mb-4">
              Edit Employee Details
            </h3>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                  Job Title
                </label>
                <input
                  type="text"
                  required
                  value={editJobTitle}
                  onChange={(e) => setEditJobTitle(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                  Department
                </label>
                <select
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
                />
              </div>
              <div className="flex justify-end gap-2.5 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingEmp(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deactivate Employee Confirmation */}
      {empToDeactivate && (
        <ConfirmationDialog
          isOpen={!!empToDeactivate}
          onClose={() => setEmpToDeactivate(null)}
          onConfirm={() => deactivateEmployee(empToDeactivate.employee_uid)}
          entityType="Employee"
          entityName={empToDeactivate.name}
          impactMessage={`Deactivating ${empToDeactivate.name} will unassign them from their zone, preserve their task history, and move them to inactive status.`}
        />
      )}
    </div>
  );
};
