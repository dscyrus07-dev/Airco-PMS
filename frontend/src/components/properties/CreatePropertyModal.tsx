import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { PasswordInput } from '../auth/PasswordInput';
import { ApiError } from '../../api/client';

interface CreatePropertyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreatePropertyModal: React.FC<CreatePropertyModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { createProperty } = useApp();

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');

  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPhone, setManagerPhone] = useState('');
  const [managerUsername, setManagerUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [managerPassword, setManagerPassword] = useState('');
  const [managerConfirmPassword, setManagerConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // "Siddharth Rawat" → "siddharth.rawat"; falls back to the email local part
  const suggestUsername = (nameVal: string, emailVal: string) =>
    (nameVal.trim() || emailVal.split('@')[0])
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '');

  const handleManagerName = (v: string) => {
    setManagerName(v);
    if (!usernameTouched) setManagerUsername(suggestUsername(v, managerEmail));
  };

  const handleManagerEmail = (v: string) => {
    setManagerEmail(v);
    setEmailError(null);
    if (!usernameTouched) setManagerUsername(suggestUsername(managerName, v));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return; // prevent duplicate submissions
    if (!name.trim() || !managerName.trim() || !managerEmail.trim()) return;

    // Credential validation — duplicates are enforced by the backend (409)
    let valid = true;
    setPasswordError(null);
    setConfirmError(null);
    setEmailError(null);
    setUsernameError(null);

    // Blank → the backend auto-generates a unique username from name/email
    const username = managerUsername.trim() || undefined;
    if (managerPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      valid = false;
    }
    if (managerConfirmPassword !== managerPassword) {
      setConfirmError('Passwords do not match.');
      valid = false;
    }
    if (!valid) return;

    setIsSubmitting(true);
    try {
      // POST /properties — creates the property AND its scoped manager account
      await createProperty({
        name: name.trim(),
        location: location.trim() || `${city.trim()}, ${state.trim()}`,
        city: city.trim(),
        state: state.trim(),
        manager: {
          name: managerName.trim(),
          email: managerEmail.trim(),
          phone: managerPhone.trim() || undefined,
          username,
          password: managerPassword,
        },
      });

      onClose();
      // Reset form
      setName('');
      setLocation('');
      setCity('');
      setState('');
      setManagerName('');
      setManagerEmail('');
      setManagerPhone('');
      setManagerUsername('');
      setUsernameTouched(false);
      setManagerPassword('');
      setManagerConfirmPassword('');
    } catch (err) {
      if (err instanceof ApiError && (err.field === 'email' || err.field === 'manager.email')) {
        setEmailError(err.message);
      } else if (
        err instanceof ApiError &&
        (err.field === 'username' || err.field === 'manager.username')
      ) {
        setUsernameError(err.message);
      }
      // Generic failures are already toasted by the context
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create New Property"
      description="Create a physical property and its dedicated scoped Property Manager account."
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Physical Property Information */}
        <div>
          <h4 className="text-xs font-semibold text-[#8C867C] uppercase tracking-wider mb-3 font-body">
            Property Details
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
                Property Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Zostel Rishikesh Tapovan"
                className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] placeholder:text-[#9F998F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
                Address / Neighborhood
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Badrinath Road, Near Laxman Jhula"
                className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] placeholder:text-[#9F998F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
                City *
              </label>
              <input
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Rishikesh"
                className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] placeholder:text-[#9F998F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
                State / Province *
              </label>
              <input
                type="text"
                required
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="e.g. Uttarakhand"
                className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] placeholder:text-[#9F998F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641]"
              />
            </div>
          </div>
        </div>

        {/* Dedicated Property Manager Account */}
        <div className="pt-3 border-t border-[#F0ECE4]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-[#8C867C] uppercase tracking-wider font-body">
              Assigned Property Manager Account
            </h4>
            <span className="text-[11px] text-[#386641] bg-[#EBF3EC] px-2 py-0.5 rounded-full font-medium">
              Scoped strictly to this property
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
                Manager Full Name *
              </label>
              <input
                type="text"
                required
                value={managerName}
                onChange={(e) => handleManagerName(e.target.value)}
                placeholder="e.g. Siddharth Rawat"
                className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] placeholder:text-[#9F998F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
                Manager Work Email *
              </label>
              <input
                type="email"
                required
                value={managerEmail}
                onChange={(e) => handleManagerEmail(e.target.value)}
                placeholder="siddharth.rawat@zostel.com"
                aria-invalid={!!emailError}
                className={`w-full px-3.5 py-2 bg-[#FAF8F5] border rounded-[10px] text-sm text-[#24221F] placeholder:text-[#9F998F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641] ${
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
                value={managerPhone}
                onChange={(e) => setManagerPhone(e.target.value)}
                placeholder="+91 98000 22334"
                className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] placeholder:text-[#9F998F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
                Manager Login Username
              </label>
              <input
                type="text"
                value={managerUsername}
                onChange={(e) => {
                  setManagerUsername(e.target.value);
                  setUsernameTouched(true);
                  setUsernameError(null);
                }}
                placeholder="auto-generated from name"
                aria-invalid={!!usernameError}
                className={`w-full px-3.5 py-2 bg-[#FAF8F5] border rounded-[10px] text-sm text-[#24221F] placeholder:text-[#9F998F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641] ${
                  usernameError ? 'border-[#D96C6C]' : 'border-[#DDD7CB]'
                }`}
              />
              {usernameError && (
                <p className="text-[11px] text-[#A32A2A] font-medium mt-1">{usernameError}</p>
              )}
            </div>

            <PasswordInput
              id="pm-password"
              label="Password"
              value={managerPassword}
              onChange={(v) => {
                setManagerPassword(v);
                setPasswordError(null);
              }}
              placeholder="Create a password"
              error={passwordError || undefined}
              autoComplete="new-password"
            />
            <PasswordInput
              id="pm-confirm-password"
              label="Confirm Password"
              value={managerConfirmPassword}
              onChange={(v) => {
                setManagerConfirmPassword(v);
                setConfirmError(null);
              }}
              placeholder="Confirm the password"
              error={confirmError || undefined}
              autoComplete="new-password"
            />
          </div>
          <p className="text-[11px] text-[#8C867C] mt-2 font-body">
            The manager uses this email/username and password to sign in — scoped only to this property.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#F0ECE4]">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Create Property & Manager
          </Button>
        </div>
      </form>
    </Modal>
  );
};
