import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { FormField } from './FormField';
import { PasswordInput } from './PasswordInput';
import { ApiError } from '../../api/client';

type FieldKey =
  | 'company_name'
  | 'brand_name'
  | 'address'
  | 'pin_code'
  | 'email'
  | 'phone'
  | 'password'
  | 'confirm_password';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_RE = /^\d{6}$/; // Indian PIN code format
const PHONE_RE = /^\+?[0-9][0-9\s-]{7,14}$/;

export const Signup: React.FC = () => {
  const { navigate, registerCompanyAccount, isAuthenticated, currentUser } = useApp();

  const [form, setForm] = useState<Record<FieldKey, string>>({
    company_name: '',
    brand_name: '',
    address: '',
    pin_code: '',
    email: '',
    phone: '',
    password: '',
    confirm_password: '',
  });
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Already signed in → skip registration
  if (isAuthenticated && currentUser) {
    if (currentUser.role === 'super_admin') return <Navigate to="/admin/properties" replace />;
    if (currentUser.role === 'property_manager')
      return <Navigate to={`/property/${currentUser.property_uid}/zones`} replace />;
    return <Navigate to="/employee/tasks" replace />;
  }

  const set = (key: FieldKey) => (value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const next: Partial<Record<FieldKey, string>> = {};

    if (!form.company_name.trim()) next.company_name = 'Company name is required.';
    if (!form.brand_name.trim()) next.brand_name = 'Brand name is required.';
    if (!form.address.trim()) next.address = 'Company address is required.';
    if (!PIN_RE.test(form.pin_code.trim()))
      next.pin_code = 'Enter a valid 6-digit PIN code.';
    if (!EMAIL_RE.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (!PHONE_RE.test(form.phone.trim()))
      next.phone = 'Enter a valid phone number (8–15 digits).';
    if (form.password.length < 8) next.password = 'Password must be at least 8 characters.';
    if (form.confirm_password !== form.password)
      next.confirm_password = 'Passwords do not match.';

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return; // prevent duplicate submissions
    setFormError(null);
    if (!validate()) return;

    setIsLoading(true);
    try {
      await registerCompanyAccount({
        company_name: form.company_name,
        brand_name: form.brand_name,
        address: form.address,
        pin_code: form.pin_code,
        email: form.email,
        phone: form.phone,
        password: form.password,
        confirm_password: form.confirm_password,
      });
      // registerCompanyAccount navigates to the Super Admin workspace on success
    } catch (err) {
      if (err instanceof ApiError && err.field) {
        setErrors({ [err.field as FieldKey]: err.message });
      } else {
        setFormError(
          err instanceof ApiError
            ? err.message
            : 'Something went wrong during registration. Please try again.'
        );
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        {/* Title */}
        <div className="text-center mb-7">
          <div className="inline-flex w-12 h-12 rounded-[14px] bg-[#386641] text-white items-center justify-center font-display font-bold text-xl mb-3 shadow-xs">
            MT
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-[28px] text-[#24221F] tracking-tight">
            Create your company account
          </h1>
          <p className="font-body text-sm text-[#6C675F] mt-1.5">
            Set up your organization and create your management workspace.
          </p>
        </div>

        <Card className="p-6 sm:p-8 shadow-[0_4px_24px_rgba(0,0,0,0.04)] border-[#E5E0D6]">
          {formError && (
            <div
              role="alert"
              className="mb-5 p-3 rounded-[10px] bg-[#FDE8E8] border border-[#F9C3C3] text-[#A32A2A] text-xs font-medium"
            >
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate={false}>
            {/* Two-column structured layout → single column on mobile */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              {/* Company Information */}
              <div className="space-y-4">
                <p className="text-[11px] font-semibold text-[#8C867C] uppercase tracking-widest border-b border-[#F0ECE4] pb-2">
                  Company Information
                </p>
                <FormField
                  id="signup-company-name"
                  label="Company Name"
                  value={form.company_name}
                  onChange={set('company_name')}
                  placeholder="Enter company name"
                  error={errors.company_name}
                  autoComplete="organization"
                />
                <FormField
                  id="signup-brand-name"
                  label="Brand Name"
                  value={form.brand_name}
                  onChange={set('brand_name')}
                  placeholder="Enter brand name"
                  error={errors.brand_name}
                />
                <FormField
                  id="signup-address"
                  label="Address"
                  value={form.address}
                  onChange={set('address')}
                  placeholder="Enter company address"
                  error={errors.address}
                  textarea
                  autoComplete="street-address"
                />
                <FormField
                  id="signup-pin"
                  label="PIN Code"
                  value={form.pin_code}
                  onChange={set('pin_code')}
                  placeholder="Enter PIN code"
                  error={errors.pin_code}
                  autoComplete="postal-code"
                />
              </div>

              {/* Account Information */}
              <div className="space-y-4">
                <p className="text-[11px] font-semibold text-[#8C867C] uppercase tracking-widest border-b border-[#F0ECE4] pb-2">
                  Account Information
                </p>
                <FormField
                  id="signup-email"
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  placeholder="Enter company email"
                  error={errors.email}
                  autoComplete="email"
                />
                <FormField
                  id="signup-phone"
                  label="Phone Number"
                  type="tel"
                  value={form.phone}
                  onChange={set('phone')}
                  placeholder="Enter phone number"
                  error={errors.phone}
                  autoComplete="tel"
                />
                <PasswordInput
                  id="signup-password"
                  label="Password"
                  value={form.password}
                  onChange={set('password')}
                  placeholder="Create a password"
                  error={errors.password}
                  autoComplete="new-password"
                />
                <PasswordInput
                  id="signup-confirm"
                  label="Confirm Password"
                  value={form.confirm_password}
                  onChange={set('confirm_password')}
                  placeholder="Confirm your password"
                  error={errors.confirm_password}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <p className="text-[11px] text-[#8C867C] font-body mt-5">
              The registering account becomes the company's Super Admin with full access.
            </p>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-3 font-semibold"
              isLoading={isLoading}
              disabled={isLoading}
            >
              Create Account
            </Button>
          </form>
        </Card>

        {/* Switch to Login */}
        <p className="text-center text-sm text-[#6C675F] mt-5 font-body">
          Already have an account?{' '}
          <button
            onClick={() => navigate('/login')}
            className="text-[#386641] font-medium hover:underline cursor-pointer"
          >
            Login
          </button>
        </p>
      </div>
    </div>
  );
};
