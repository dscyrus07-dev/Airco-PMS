import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { PasswordInput } from '../auth/PasswordInput';
import { ApiError } from '../../api/client';

interface CreateEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DEPARTMENTS = [
  'Front Desk Operations',
  'Housekeeping & Cleanliness',
  'Maintenance & Engineering',
  'Food & Beverage',
  'Guest Experience & Community',
  'Security & Safety',
  'Accounts & Administration',
];

export const CreateEmployeeModal: React.FC<CreateEmployeeModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { createEmployee, currentPropertyZones } = useApp();

  const [name, setName] = useState('');
  const [jobTitle, setJobTitle] = useState('Front Desk Associate');
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [zoneUid, setZoneUid] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return; // prevent duplicate submissions

    // Validation — required fields, credential rules, duplicates
    if (!name.trim() || !email.trim()) return;

    let valid = true;
    setPasswordError(null);
    setConfirmError(null);
    setEmailError(null);

    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      valid = false;
    }
    if (confirmPassword !== password) {
      setConfirmError('Passwords do not match.');
      valid = false;
    }
    if (!valid) return;

    setIsSubmitting(true);
    try {
      // POST /employees — creates the staff record and its login credential
      await createEmployee({
        name: name.trim(),
        job_title: jobTitle.trim(),
        department: department as any,
        email: email.trim(),
        phone: phone.trim() || undefined,
        password,
        zone_uid: zoneUid ? zoneUid : null,
        start_date: startDate,
      });

      setName('');
      setEmail('');
      setPhone('');
      setZoneUid('');
      setPassword('');
      setConfirmPassword('');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && (err.field === 'email' || err.field === 'username')) {
        setEmailError(err.message);
      }
      // Context already surfaced a generic error toast for non-field failures
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Property Staff Member"
      description="Register an operational employee. Auto-generates an immutable Employee ID."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
            Full Name *
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Anjali Nair"
            className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Job Title / Designation *
            </label>
            <input
              type="text"
              required
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Head Housekeeper"
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Department *
            </label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            >
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Work Email *
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError(null);
              }}
              placeholder="anjali.nair@zostel.com"
              aria-invalid={!!emailError}
              className={`w-full px-3.5 py-2 bg-[#FAF8F5] border rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641] ${
                emailError ? 'border-[#D96C6C]' : 'border-[#DDD7CB]'
              }`}
            />
            {emailError && (
              <p className="text-[11px] text-[#A32A2A] font-medium mt-1">{emailError}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Initial Zone Allocation
            </label>
            <select
              value={zoneUid}
              onChange={(e) => setZoneUid(e.target.value)}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            >
              <option value="">(Unallocated Pool)</option>
              {currentPropertyZones.map((z) => (
                <option key={z.zone_uid} value={z.zone_uid}>
                  {z.name} ({z.floor})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Joining Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            />
          </div>
        </div>

        {/* Login credentials — the employee signs in with these */}
        <div className="pt-2 border-t border-[#F2ECE3]">
          <p className="text-[11px] font-semibold text-[#8C867C] uppercase tracking-widest mb-3">
            Staff Login Credentials
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <PasswordInput
              id="emp-password"
              label="Password"
              value={password}
              onChange={(v) => {
                setPassword(v);
                setPasswordError(null);
              }}
              placeholder="Create a password"
              error={passwordError || undefined}
              autoComplete="new-password"
            />
            <PasswordInput
              id="emp-confirm-password"
              label="Confirm Password"
              value={confirmPassword}
              onChange={(v) => {
                setConfirmPassword(v);
                setConfirmError(null);
              }}
              placeholder="Confirm the password"
              error={confirmError || undefined}
              autoComplete="new-password"
            />
          </div>
          <p className="text-[11px] text-[#8C867C] mt-2 font-body">
            The employee uses their work email and this password to sign in to their workspace.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#F0ECE4]">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Add Staff Member
          </Button>
        </div>
      </form>
    </Modal>
  );
};
