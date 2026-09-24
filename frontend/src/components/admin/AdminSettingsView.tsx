import React, { useState } from 'react';
import { Building2, Database, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ApiError } from '../../api/client';

export const AdminSettingsView: React.FC = () => {
  const {
    company,
    companyProperties,
    employees,
    zones,
    rooms,
    dorms,
    updateCompanyDetails,
    retryLoad,
    addToast,
  } = useApp();

  // Organization-scoped stats (zones/rooms/dorms/staff inherit scope via property)
  const companyPropertyUids = new Set(companyProperties.map((p) => p.property_uid));
  const companyZones = zones.filter((z) => companyPropertyUids.has(z.property_uid));
  const companyRooms = rooms.filter((r) => companyPropertyUids.has(r.property_uid));
  const companyDorms = dorms.filter((d) => companyPropertyUids.has(d.property_uid));
  const companyEmployees = employees.filter((e) => e.company_uid === company?.company_uid);

  const [legalName, setLegalName] = useState(company?.legal_name || company?.name || '');
  const [brandName, setBrandName] = useState(company?.brand_name || '');
  const [email, setEmail] = useState(company?.email || '');
  const [phone, setPhone] = useState(company?.phone || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateCompanyDetails({
        legal_name: legalName.trim(),
        brand_name: brandName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });
      addToast({
        type: 'success',
        title: 'Settings Saved',
        description: 'Organization details updated successfully.',
      });
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : 'Could not save organization settings.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Header */}
      <div>
        <h1 className="font-display font-bold text-2xl sm:text-[28px] text-[#24221F] tracking-tight">
          Organization Settings
        </h1>
        <p className="font-body text-sm text-[#6C675F] mt-0.5">
          Legal corporate identity and administrative system configuration
        </p>
      </div>

      {/* Organization Info Form */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="w-4 h-4 text-[#386641]" />
          <h3 className="font-display font-bold text-base text-[#24221F]">
            Organization & Brand Identity
          </h3>
        </div>

        {saveError && (
          <div
            role="alert"
            className="mb-4 p-3 rounded-[10px] bg-[#FDE8E8] border border-[#F9C3C3] text-[#A32A2A] text-xs font-medium"
          >
            {saveError}
          </div>
        )}

        <form onSubmit={handleSaveCompany} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                Legal Entity Name
              </label>
              <input
                type="text"
                required
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                Hospitality Brand Name
              </label>
              <input
                type="text"
                required
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                Operations Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                Corporate Phone
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
              />
            </div>
          </div>

          <div className="flex justify-end pt-3">
            <Button type="submit" variant="primary" isLoading={isSaving}>
              Save Organization Info
            </Button>
          </div>
        </form>
      </Card>

      {/* Data Overview & Sync */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-4 h-4 text-[#C8681A]" />
          <h3 className="font-display font-bold text-base text-[#24221F]">
            Workspace Data
          </h3>
        </div>
        <p className="text-xs text-[#6C675F] font-body mb-4">
          Live operational data synced from the operations API across all company properties.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-5">
          <div className="p-3 bg-[#FAF8F5] rounded-[10px] border border-[#EAE5DC]">
            <span className="text-[#8C867C] block font-semibold">Properties</span>
            <span className="font-display font-bold text-lg text-[#24221F]">{companyProperties.length}</span>
          </div>
          <div className="p-3 bg-[#FAF8F5] rounded-[10px] border border-[#EAE5DC]">
            <span className="text-[#8C867C] block font-semibold">Zones</span>
            <span className="font-display font-bold text-lg text-[#24221F]">{companyZones.length}</span>
          </div>
          <div className="p-3 bg-[#FAF8F5] rounded-[10px] border border-[#EAE5DC]">
            <span className="text-[#8C867C] block font-semibold">Rooms & Dorms</span>
            <span className="font-display font-bold text-lg text-[#24221F]">
              {companyRooms.length + companyDorms.length}
            </span>
          </div>
          <div className="p-3 bg-[#FAF8F5] rounded-[10px] border border-[#EAE5DC]">
            <span className="text-[#8C867C] block font-semibold">Staff Count</span>
            <span className="font-display font-bold text-lg text-[#24221F]">{companyEmployees.length}</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-[#F2ECE3]">
          <div>
            <h4 className="font-semibold text-xs text-[#24221F]">Reload Workspace Data</h4>
            <p className="text-[11px] text-[#736E65]">
              Re-fetch all properties, zones, rooms, and staff from the server.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={retryLoad}>
            <RefreshCw className="w-3.5 h-3.5 mr-1 text-[#386641]" />
            <span>Refresh Data</span>
          </Button>
        </div>
      </Card>
    </div>
  );
};
