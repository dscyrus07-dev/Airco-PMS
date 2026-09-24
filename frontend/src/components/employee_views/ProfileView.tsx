import React, { useState } from 'react';
import { Building2, Layers, Mail, Pencil, Phone, User } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { getInitials } from '../../lib/utils';

export const ProfileView: React.FC = () => {
  const { currentUser, employeeRecord, zones, activeProperty, company, updateProfile } = useApp();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(currentUser?.name || '');
  const [phone, setPhone] = useState(currentUser?.phone || employeeRecord?.phone || '');
  const [email, setEmail] = useState(currentUser?.email || '');

  const assignedZone = zones.find((z) => z.zone_uid === employeeRecord?.zone_uid);
  const role = currentUser?.role || 'employee';

  const scopeLabel =
    role === 'super_admin'
      ? company?.name || '—'
      : role === 'property_manager'
      ? activeProperty?.name || currentUser?.property_uid || '—'
      : `${activeProperty?.name || '—'}${
          assignedZone ? ` · ${assignedZone.name}` : ' · No zone assigned'
        }`;

  const scopeCaption =
    role === 'super_admin' ? 'Company' : role === 'property_manager' ? 'Assigned Property' : 'Assigned Property / Zone';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProfile({ name: name.trim(), phone: phone.trim(), email: email.trim() });
      setEditing(false);
    } catch {
      // Error toast handled by the context layer — stay in edit mode
    }
  };

  const inputCls =
    'w-full px-3 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl sm:text-[28px] text-[#24221F] tracking-tight">
          Profile
        </h1>
        <p className="font-body text-sm text-[#6C675F] mt-0.5">
          Your account details and operational scope
        </p>
      </div>

      <Card className="p-6">
        {/* Identity header */}
        <div className="flex items-center gap-4 pb-5 border-b border-[#F2ECE3]">
          <div
            className="w-14 h-14 rounded-full text-white flex items-center justify-center font-bold text-xl shadow-sm shrink-0"
            style={{ backgroundColor: role === 'super_admin' ? '#24221F' : '#386641' }}
          >
            {getInitials(currentUser?.name || 'User')}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="font-display font-bold text-xl text-[#24221F] truncate">
                {currentUser?.name}
              </h2>
              <Badge variant="sage" size="sm" className="capitalize">
                {role.replace('_', ' ')}
              </Badge>
            </div>
            <p className="text-xs font-mono text-[#8C867C] mt-0.5">
              @{currentUser?.username} · {currentUser?.uid}
            </p>
          </div>
        </div>

        {/* Details / edit form */}
        {!editing ? (
          <div className="pt-5 space-y-1">
            {[
              { icon: <User className="w-4 h-4" />, label: 'Name', value: currentUser?.name },
              { icon: <User className="w-4 h-4" />, label: 'Username', value: currentUser?.username },
              { icon: <Phone className="w-4 h-4" />, label: 'Phone', value: currentUser?.phone || employeeRecord?.phone || '—' },
              { icon: <Mail className="w-4 h-4" />, label: 'Email', value: currentUser?.email },
              {
                icon: role === 'employee' ? <Layers className="w-4 h-4" /> : <Building2 className="w-4 h-4" />,
                label: scopeCaption,
                value: scopeLabel,
              },
            ].map((row, i) => (
              <div
                key={i}
                className="flex items-center gap-3 py-2.5 border-b border-[#F5F1EA] last:border-0"
              >
                <span className="text-[#8C867C]">{row.icon}</span>
                <span className="text-xs font-semibold text-[#736E65] uppercase tracking-wider w-44 shrink-0">
                  {row.label}
                </span>
                <span className="text-sm text-[#24221F] font-medium truncate">{row.value}</span>
              </div>
            ))}

            <div className="pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setName(currentUser?.name || '');
                  setPhone(currentUser?.phone || employeeRecord?.phone || '');
                  setEmail(currentUser?.email || '');
                  setEditing(true);
                }}
                className="gap-1.5"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit Details</span>
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSave} className="pt-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex items-center gap-2.5 pt-1">
              <Button type="submit" variant="primary" size="sm">
                Save Changes
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
};
