import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, Search, RefreshCw, UserPlus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { PasswordInput } from '../auth/PasswordInput';
import { ApiError } from '../../api/client';
import * as hrApi from '../../api/hr';
import { DEPARTMENTS } from '../employees/CreateEmployeeModal';
import { Employee } from '../../types';
import { fmtDateIST, fmtDateTimeIST } from '../../lib/datetime';

const inputCls =
  'w-full px-3.5 py-2.5 bg-white border border-[#DDD7CB] rounded-[10px] font-body text-sm text-[#24221F] placeholder-[#B5AFA1] focus:outline-none focus:ring-[3px] focus:ring-[#386641]/15 focus:border-[#386641] transition-all';
const labelCls =
  'block font-body text-xs font-semibold text-[#555047] mb-1.5 uppercase tracking-wide';

const ACTION_LABELS: Record<string, string> = {
  employee_created: 'Employee Created',
  employee_updated: 'Employee Updated',
  employee_activated: 'Employee Activated',
  employee_deactivated: 'Employee Deactivated',
  employee_deleted: 'Employee Deleted',
  employee_assignment_changed: 'Zone/Area Assignment Changed',
};

type Tab = 'dashboard' | 'employees' | 'logs';

export const HrEmployeesView: React.FC = () => {
  const { addToast, currentPropertyZones } = useApp();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [dashboard, setDashboard] = useState<hrApi.HrDashboard | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logs, setLogs] = useState<hrApi.AuditLogItem[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [logAction, setLogAction] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try { setDashboard(await hrApi.hrDashboard()); } catch { /* keep prior */ }
  }, []);
  const loadEmployees = useCallback(async () => {
    try {
      const res = await hrApi.hrListEmployees({
        search: search || undefined,
        status: statusFilter || undefined,
        limit: 100,
      });
      setEmployees(res.items);
    } catch { /* keep prior */ }
  }, [search, statusFilter]);
  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrApi.hrEmployeeLogs({
        action: logAction || undefined, page: logsPage, limit: 50,
      });
      setLogs(res.items); setLogsTotal(res.total);
    } catch { /* keep prior */ } finally { setLoading(false); }
  }, [logAction, logsPage]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);
  useEffect(() => {
    const t = setTimeout(() => void loadEmployees(), 250);
    return () => clearTimeout(t);
  }, [loadEmployees]);
  useEffect(() => { void loadLogs(); }, [loadLogs]);

  const toggleActive = async (emp: Employee) => {
    if (busyUid) return;
    setBusyUid(emp.employee_uid);
    try {
      const fn = (emp.status || '').toLowerCase() === 'active'
        ? hrApi.hrDeactivateEmployee : hrApi.hrActivateEmployee;
      const updated = await fn(emp.employee_uid);
      setEmployees((prev) => prev.map((e) =>
        e.employee_uid === emp.employee_uid ? updated : e));
      addToast({
        type: 'success',
        title: `${emp.name} ${(emp.status || '').toLowerCase() === 'active' ? 'deactivated' : 'activated'}`,
      });
      void loadDashboard(); void loadLogs();
    } catch (err) {
      addToast({ type: 'error', title: 'Update failed',
        description: err instanceof ApiError ? err.message : undefined });
    } finally { setBusyUid(null); }
  };

  const kpi = useMemo(() => ({
    total: dashboard?.total_employees ?? 0,
    active: dashboard?.active_employees ?? 0,
    inactive: dashboard?.inactive_employees ?? 0,
    leave: dashboard?.on_leave ?? 0,
    depts: dashboard?.departments ?? 0,
    fresh: dashboard?.new_last_30d ?? 0,
  }), [dashboard]);

  const maxDept = Math.max(1, ...(dashboard?.by_department.map((d) => d.count) ?? [1]));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-[28px] text-[#24221F] tracking-tight">
            Employee Management
          </h1>
          <p className="font-body text-sm text-[#6C675F] mt-1">
            Workforce records for your property — assignments and pay remain
            under the property manager.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
          <UserPlus className="w-4 h-4 mr-1.5" /> Add Employee
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        {(['dashboard', 'employees', 'logs'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3.5 py-1.5 rounded-[8px] text-xs font-medium transition-all cursor-pointer capitalize ${
              tab === t
                ? 'bg-[#386641] text-white shadow-xs'
                : 'bg-white text-[#555047] border border-[#DDD7CB] hover:bg-[#F2ECE3]'}`}>
            {t === 'logs' ? 'Activity Logs' : t}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Total Employees', value: kpi.total },
              { label: 'Active', value: kpi.active },
              { label: 'Inactive', value: kpi.inactive },
              { label: 'On Leave', value: kpi.leave },
              { label: 'Departments', value: kpi.depts },
              { label: 'New (30d)', value: kpi.fresh },
            ].map((k) => (
              <Card key={k.label} className="p-4">
                <span className="block text-[11px] font-semibold text-[#8C867C] uppercase tracking-wide">
                  {k.label}
                </span>
                <span className="font-display font-bold text-2xl text-[#24221F]">{k.value}</span>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="font-display font-bold text-sm text-[#24221F] mb-3">
                Department Distribution
              </h3>
              {(dashboard?.by_department ?? []).length === 0 && (
                <p className="text-xs text-[#8C867C]">No departments recorded yet.</p>
              )}
              <div className="space-y-2.5">
                {(dashboard?.by_department ?? []).map((d) => (
                  <div key={d.department}>
                    <div className="flex justify-between text-xs font-body mb-1">
                      <span className="text-[#555047]">{d.department}</span>
                      <span className="font-semibold text-[#24221F]">{d.count}</span>
                    </div>
                    <div className="h-1.5 bg-[#F2ECE3] rounded-full overflow-hidden">
                      <div className="h-full bg-[#386641] rounded-full"
                        style={{ width: `${(d.count / maxDept) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="font-display font-bold text-sm text-[#24221F] mb-3">
                Recent Hires (30 days)
              </h3>
              {(dashboard?.recent_hires ?? []).length === 0 && (
                <p className="text-xs text-[#8C867C]">No new employees in the last 30 days.</p>
              )}
              <div className="divide-y divide-[#F2ECE3]">
                {(dashboard?.recent_hires ?? []).map((e) => (
                  <div key={e.employee_uid} className="py-2 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-[#24221F]">{e.name}</div>
                      <div className="text-xs text-[#8C867C]">{e.department || '—'}</div>
                    </div>
                    <div className="text-xs text-[#8C867C]">
                      {e.created_at ? fmtDateIST(e.created_at) : ''}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'employees' && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-[#ECE6DA] flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C867C]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, job title…" className={`${inputCls} pl-9`} />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className={`${inputCls} w-auto`}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
            </select>
            <button onClick={() => void loadEmployees()}
              className="p-2 text-[#6C675F] hover:text-[#386641] transition-colors cursor-pointer">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[#8C867C] border-b border-[#ECE6DA]">
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">Department</th>
                  <th className="px-4 py-3 font-semibold">Zone</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Joined</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F5F2EB]">
                {employees.map((e) => {
                  const zone = currentPropertyZones.find((z) => z.zone_uid === e.zone_uid);
                  const active = (e.status || '').toLowerCase() === 'active';
                  return (
                    <tr key={e.employee_uid} className="hover:bg-[#FAF8F5]">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#24221F]">{e.name}</div>
                        <div className="text-xs text-[#8C867C]">{e.job_title || e.email}</div>
                      </td>
                      <td className="px-4 py-3 text-[#555047]">{e.department || '—'}</td>
                      <td className="px-4 py-3 text-[#555047]">{zone?.name || (e.area_uid ? 'Area assignment' : '—')}</td>
                      <td className="px-4 py-3">
                        <Badge variant={active ? 'sage' : 'neutral'} size="sm">
                          {e.leave_status ? 'On Leave' : e.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-[#555047]">{e.joined_date || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => void toggleActive(e)}
                          disabled={busyUid === e.employee_uid}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-[8px] transition-colors cursor-pointer disabled:opacity-50 ${
                            active
                              ? 'text-[#A32A2A] hover:bg-[#FDE8E8]'
                              : 'text-[#386641] hover:bg-[#386641]/8'}`}>
                          {busyUid === e.employee_uid ? '…' : active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {employees.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-[#8C867C]">
                    No employees match this filter.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'logs' && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-[#ECE6DA] flex-wrap">
            <select value={logAction} onChange={(e) => { setLogAction(e.target.value); setLogsPage(1); }}
              className={`${inputCls} w-auto`}>
              <option value="">All actions</option>
              {Object.entries(ACTION_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="divide-y divide-[#F5F2EB]">
            {logs.map((l) => (
              <div key={l.event_uid} className="px-4 py-3 flex items-start gap-3">
                <div className="w-2 h-2 mt-1.5 rounded-full bg-[#386641] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-[#24221F]">
                      {ACTION_LABELS[l.action] || l.action.replaceAll('_', ' ')}
                    </span>
                    {l.entity_name && (
                      <Badge variant="neutral" size="sm">{l.entity_name}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-[#8C867C] mt-0.5">
                    by {l.actor_name || 'system'}
                    {l.detail?.fields ? ` — fields: ${(l.detail.fields as string[]).join(', ')}` : ''}
                  </div>
                </div>
                <div className="text-xs text-[#8C867C] shrink-0">
                  {l.created_at ? fmtDateTimeIST(l.created_at) : ''}
                </div>
              </div>
            ))}
            {logs.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-[#8C867C]">
                {loading ? 'Loading activity…' : 'No employee activity recorded yet.'}
              </div>
            )}
          </div>
          {logsTotal > 50 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#ECE6DA] text-xs text-[#6C675F]">
              <span>Page {logsPage} · {logsTotal} events</span>
              <div className="flex gap-2">
                <button disabled={logsPage <= 1} onClick={() => setLogsPage((p) => p - 1)}
                  className="px-3 py-1 border border-[#DDD7CB] rounded-[8px] disabled:opacity-40 cursor-pointer">Prev</button>
                <button disabled={logsPage * 50 >= logsTotal} onClick={() => setLogsPage((p) => p + 1)}
                  className="px-3 py-1 border border-[#DDD7CB] rounded-[8px] disabled:opacity-40 cursor-pointer">Next</button>
              </div>
            </div>
          )}
        </Card>
      )}

      <HrCreateEmployeeModal isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); void loadEmployees(); void loadDashboard(); void loadLogs(); }} />
    </div>
  );
};

// Compact create form — HR posts to /hr/employees which runs the same
// EmployeeService.create_employee as the PM flow (same validations,
// same transaction, same audit).
const HrCreateEmployeeModal: React.FC<{
  isOpen: boolean; onClose: () => void; onCreated: () => void;
}> = ({ isOpen, onClose, onCreated }) => {
  const { currentUser, currentPropertyZones, addToast } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [department, setDepartment] = useState(DEPARTMENTS[1]);
  const [zoneUid, setZoneUid] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await hrApi.hrCreateEmployee({
        property_uid: currentUser!.property_uid!,
        name: name.trim(), email: email.trim(), phone: phone.trim() || undefined,
        job_title: jobTitle.trim(), department,
        zone_uid: zoneUid || undefined, password,
      });
      addToast({ type: 'success', title: 'Employee created', description: name.trim() });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create employee.');
    } finally { setBusy(false); }
  };

  if (!isOpen) return null;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Employee" maxWidth="md">
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div role="alert" className="p-3 rounded-[10px] bg-[#FDE8E8] border border-[#F9C3C3] text-[#A32A2A] text-xs font-medium">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Full Name *</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Email *</label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Job Title *</label>
            <input required value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Department</label>
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className={inputCls}>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Zone</label>
            <select value={zoneUid} onChange={(e) => setZoneUid(e.target.value)} className={inputCls}>
              <option value="">Unassigned</option>
              {currentPropertyZones.map((z) => (
                <option key={z.zone_uid} value={z.zone_uid}>{z.name}</option>
              ))}
            </select>
          </div>
          <PasswordInput id="hr-emp-password" label="Password *" value={password}
            onChange={setPassword} autoComplete="new-password" />
          <PasswordInput id="hr-emp-confirm" label="Confirm Password *" value={confirm}
            onChange={setConfirm} autoComplete="new-password" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" isLoading={busy}>Create Employee</Button>
        </div>
      </form>
    </Modal>
  );
};
