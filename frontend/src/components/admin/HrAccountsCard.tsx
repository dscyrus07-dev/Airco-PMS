import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { PasswordInput } from '../auth/PasswordInput';
import { ApiError } from '../../api/client';
import * as hrApi from '../../api/hr';

const inputCls =
  'w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]';
const labelCls =
  'block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1';

/**
 * Super Admin → HR accounts — creates HUMAN_RESOURCE logins scoped to a
 * single company property via POST /admin/hr.
 */
export const HrAccountsCard: React.FC<{ properties: { property_uid: string; name: string }[] }> = ({
  properties,
}) => {
  const { addToast } = useApp();
  const [accounts, setAccounts] = useState<hrApi.HrAccount[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', property_uid: '', password: '', confirm: '',
  });

  const load = useCallback(async () => {
    try {
      const res = await hrApi.listHrAccounts();
      setAccounts(res.items);
    } catch { /* keep prior */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    if (!form.property_uid) { setError('Select a property.'); return; }
    setBusy(true);
    try {
      const acc = await hrApi.createHrAccount({
        property_uid: form.property_uid, name: form.name.trim(),
        email: form.email.trim(), phone: form.phone.trim() || undefined,
        password: form.password,
      });
      setAccounts((prev) => [acc, ...prev]);
      addToast({ type: 'success', title: 'HR account created', description: acc.email });
      setOpen(false);
      setForm({ name: '', email: '', phone: '', property_uid: '', password: '', confirm: '' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create HR account.');
    } finally { setBusy(false); }
  };

  const toggle = async (acc: hrApi.HrAccount) => {
    if (busyUid) return;
    setBusyUid(acc.user_uid);
    try {
      const updated = await hrApi.toggleHrAccount(acc.user_uid);
      setAccounts((prev) => prev.map((a) => a.user_uid === acc.user_uid ? updated : a));
      addToast({
        type: 'success',
        title: `${acc.name} ${updated.is_active ? 'activated' : 'deactivated'}`,
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Update failed',
        description: err instanceof ApiError ? err.message : undefined });
    } finally { setBusyUid(null); }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-[#386641]" />
          <h3 className="font-display font-bold text-base text-[#24221F]">
            Human Resource Accounts
          </h3>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <UserPlus className="w-3.5 h-3.5 mr-1 text-[#386641]" />
          <span>Add HR</span>
        </Button>
      </div>

      <div className="divide-y divide-[#F2ECE3]">
        {accounts.length === 0 && (
          <p className="text-xs text-[#8C867C] py-3">
            No HR accounts yet — create one to give property staff a dedicated
            workforce-management login.
          </p>
        )}
        {accounts.map((a) => (
          <div key={a.user_uid} className="py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#24221F] truncate">{a.name}</div>
              <div className="text-xs text-[#8C867C] truncate">
                {a.email}{a.property_name ? ` · ${a.property_name}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                a.is_active ? 'bg-[#E8F0E3] text-[#386641]' : 'bg-[#FDE8E8] text-[#A32A2A]'}`}>
                {a.is_active ? 'Active' : 'Inactive'}
              </span>
              <button onClick={() => void toggle(a)} disabled={busyUid === a.user_uid}
                className={`text-xs font-semibold px-3 py-1.5 rounded-[8px] transition-colors cursor-pointer disabled:opacity-50 ${
                  a.is_active
                    ? 'text-[#A32A2A] hover:bg-[#FDE8E8]'
                    : 'text-[#386641] hover:bg-[#386641]/8'}`}>
                {busyUid === a.user_uid ? '…' : a.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Add Human Resource" maxWidth="md">
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div role="alert" className="p-3 rounded-[10px] bg-[#FDE8E8] border border-[#F9C3C3] text-[#A32A2A] text-xs font-medium">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Full Name *</label>
              <input required className={inputCls} value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Email *</label>
              <input required type="email" className={inputCls} value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input className={inputCls} value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Property *</label>
              <select required className={inputCls} value={form.property_uid}
                onChange={(e) => setForm((f) => ({ ...f, property_uid: e.target.value }))}>
                <option value="">Select property…</option>
                {properties.map((p) => (
                  <option key={p.property_uid} value={p.property_uid}>{p.name}</option>
                ))}
              </select>
            </div>
            <PasswordInput id="hr-password" label="Password *" value={form.password}
              onChange={(v) => setForm((f) => ({ ...f, password: v }))} autoComplete="new-password" />
            <PasswordInput id="hr-confirm" label="Confirm Password *" value={form.confirm}
              onChange={(v) => setForm((f) => ({ ...f, confirm: v }))} autoComplete="new-password" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" isLoading={busy}>Create HR Account</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
};
