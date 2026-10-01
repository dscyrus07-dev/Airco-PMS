import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Minus, Plus, Trash2 } from 'lucide-react';
import {
  Bath,
  Droplet,
  Droplets,
  Frame,
  ShowerHead,
  Toilet,
  Waves,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Washroom, WashroomResourceType } from '../../types';

export const WASHROOM_TYPES: { value: WashroomResourceType; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unisex', label: 'Unisex' },
];

// Washroom operational status is resource state — moved via commands/tasks,
// never editable from this form (spec §12).

export interface WashroomCreateDefaults {
  name?: string;
  zone_uid?: string;
  /** Create as a dorm-owned attached washroom (independent config) */
  dorm_uid?: string;
}

interface WashroomModalProps {
  isOpen: boolean;
  onClose: () => void;
  washroom?: Washroom | null;
  /** Prefill for create mode (e.g. declared-facility → real resource) */
  defaults?: WashroomCreateDefaults;
}

export const WashroomModal: React.FC<WashroomModalProps> = ({
  isOpen,
  onClose,
  washroom,
  defaults,
}) => {
  const {
    createWashroom,
    updateWashroom,
    currentPropertyZones,
    currentPropertyDorms,
    currentPropertyWashrooms,
  } = useApp();
  const attachedDorm = defaults?.dorm_uid
    ? currentPropertyDorms.find((d) => d.dorm_uid === defaults.dorm_uid) ?? null
    : null;
  // Editing an existing dorm-owned washroom → name stays dorm-derived
  const ownerDorm =
    attachedDorm ??
    (washroom?.dorm_uid
      ? currentPropertyDorms.find((d) => d.dorm_uid === washroom.dorm_uid) ?? null
      : null);
  const derivedName = ownerDorm ? `${ownerDorm.name} - Washroom` : null;

  const [name, setName] = useState(washroom?.name || defaults?.name || '');
  const [washroomType, setWashroomType] = useState<WashroomResourceType>(
    washroom?.washroom_type || 'unisex'
  );
  const [zoneUid, setZoneUid] = useState(
    washroom?.zone_uid || defaults?.zone_uid || ''
  );
  const [stallCount, setStallCount] = useState(washroom?.stall_count ?? 0);
  const [urinalCount, setUrinalCount] = useState(washroom?.urinal_count ?? 0);
  const [showerCount, setShowerCount] = useState(washroom?.shower_count ?? 0);
  const [sinkCount, setSinkCount] = useState(washroom?.sink_count ?? 0);
  const [mirrorCount, setMirrorCount] = useState(washroom?.mirror_count ?? 0);
  const [bathTubCount, setBathTubCount] = useState(washroom?.bath_tub_count ?? 0);
  const [jacuzziCount, setJacuzziCount] = useState(washroom?.jacuzzi_count ?? 0);
  const [customFixtures, setCustomFixtures] = useState<Record<string, number>>(
    { ...(washroom?.custom_fixtures || {}) }
  );
  const [newFixtureLabel, setNewFixtureLabel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEdit = Boolean(washroom);

  useEffect(() => {
    if (!isOpen) return;
    setName(washroom?.name || defaults?.name || '');
    setWashroomType(washroom?.washroom_type || 'unisex');
    setZoneUid(washroom?.zone_uid || defaults?.zone_uid || '');
    setStallCount(washroom?.stall_count ?? 0);
    setUrinalCount(washroom?.urinal_count ?? 0);
    setShowerCount(washroom?.shower_count ?? 0);
    setSinkCount(washroom?.sink_count ?? 0);
    setMirrorCount(washroom?.mirror_count ?? 0);
    setBathTubCount(washroom?.bath_tub_count ?? 0);
    setJacuzziCount(washroom?.jacuzzi_count ?? 0);
    setCustomFixtures({ ...(washroom?.custom_fixtures || {}) });
    setNewFixtureLabel('');
  }, [isOpen, washroom, defaults]);

  const nameTaken = useMemo(() => {
    if (derivedName) return false; // server-side derives + validates
    const n = name.trim().toLowerCase();
    return (
      n !== '' &&
      currentPropertyWashrooms.some(
        (w) =>
          w.washroom_uid !== washroom?.washroom_uid &&
          w.name.trim().toLowerCase() === n
      )
    );
  }, [name, currentPropertyWashrooms, washroom?.washroom_uid, derivedName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!derivedName && !name.trim()) || nameTaken || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const custom: Record<string, number> = {};
      for (const [label, n] of Object.entries(customFixtures)) {
        const l = label.trim();
        if (l && n > 0) custom[l] = n;
      }
      const base = {
        // dorm-owned → the backend derives the name; send the derived
        // value anyway (it is locked server-side)
        name: derivedName ?? name.trim(),
        washroom_type: washroomType,
        stall_count: stallCount,
        urinal_count: urinalCount,
        shower_count: showerCount,
        sink_count: sinkCount,
        mirror_count: mirrorCount,
        bath_tub_count: bathTubCount,
        jacuzzi_count: jacuzziCount,
        custom_fixtures: Object.keys(custom).length ? custom : {},
      };
      if (washroom) {
        await updateWashroom(washroom.washroom_uid, {
          ...base,
          zone_uid: zoneUid || null,
        });
      } else {
        await createWashroom({
          ...base,
          // dorm-owned attached washrooms take the dorm's zone automatically
          zone_uid: defaults?.dorm_uid ? null : zoneUid || null,
          dorm_uid: defaults?.dorm_uid ?? null,
        });
      }
      setName('');
      setZoneUid('');
      setStallCount(0);
      setUrinalCount(0);
      setShowerCount(0);
      setWashroomType('unisex');
      onClose();
    } catch {
      // Context already raises the field/API error toast.
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        isEdit
          ? 'Edit Washroom'
          : attachedDorm
          ? `Configure Washroom — ${attachedDorm.name}`
          : 'Create Washroom'
      }
      description={
        attachedDorm
          ? `Attach an independently-configured washroom to ${attachedDorm.name}`
          : 'Add a washroom as a property resource and assign it to a zone'
      }
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-3 p-3 rounded-[12px] bg-[#EFF6FA] border border-[#D7E7F1]">
          <div className="w-10 h-10 rounded-[10px] bg-white text-[#2D5D7B] flex items-center justify-center border border-[#C9DEE9]">
            <Bath className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#24221F]">Washroom Resource</p>
            <p className="text-xs text-[#6C675F]">
              Washrooms can be zoned, allocated for work, and receive maintenance.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
            Washroom Name{derivedName ? '' : ' / Number *'}
          </label>
          {derivedName ? (
            <>
              <div className="px-3.5 py-2 bg-[#EBF3EC] border border-[#CBE0CF] rounded-[10px] text-sm font-semibold text-[#244E2C]">
                {derivedName}
              </div>
              <p className="text-[10px] text-[#8C867C] mt-1">
                Automatically generated from the dorm name — updates
                automatically if the dorm is renamed.
              </p>
            </>
          ) : (
            <>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. W-001 or Male Washroom - Ground Floor"
                className={`w-full px-3.5 py-2 bg-[#FAF8F5] border rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 ${
                  nameTaken
                    ? 'border-[#E5A3A3] focus:ring-[#C53B3B]'
                    : 'border-[#DDD7CB] focus:ring-[#386641]'
                }`}
              />
              {nameTaken && (
                <p className="text-[11px] text-[#A82828] font-body mt-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  A washroom named "{name.trim()}" already exists in this property.
                </p>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Washroom Type *
            </label>
            <select
              value={washroomType}
              onChange={(e) => setWashroomType(e.target.value as WashroomResourceType)}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            >
              {WASHROOM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            {attachedDorm ? (
              <>
                <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
                  Attached To
                </label>
                <div className="px-3.5 py-2 bg-[#EBF3EC] border border-[#CBE0CF] rounded-[10px] text-sm font-medium text-[#244E2C]">
                  {attachedDorm.name}
                  <span className="block text-[10px] text-[#5F7F65] font-normal">
                    Zone inherits from the dorm · independent configuration
                  </span>
                </div>
              </>
            ) : (
              <>
                <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
                  Assign to Zone
                </label>
                <select
                  value={zoneUid}
                  onChange={(e) => setZoneUid(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
                >
                  <option value="">(Unallocated)</option>
                  {currentPropertyZones.map((z) => (
                    <option key={z.zone_uid} value={z.zone_uid}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-[#8C867C] uppercase tracking-wider mb-2 font-body">
            Fixture Inventory
          </p>
          <div className="space-y-2">
            {(
              [
                { label: 'Showers', icon: ShowerHead, value: showerCount, setter: setShowerCount },
                { label: 'Stalls', icon: Toilet, value: stallCount, setter: setStallCount },
                { label: 'Urinals', icon: Droplet, value: urinalCount, setter: setUrinalCount },
                { label: 'Sinks', icon: Droplets, value: sinkCount, setter: setSinkCount },
                { label: 'Mirrors', icon: Frame, value: mirrorCount, setter: setMirrorCount },
                { label: 'Bath Tubs', icon: Bath, value: bathTubCount, setter: setBathTubCount },
                { label: 'Jacuzzis', icon: Waves, value: jacuzziCount, setter: setJacuzziCount },
              ] as const
            ).map(({ label, icon: Icon, value, setter }) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-[10px] border border-[#EAE5DC] bg-[#FAF8F5] px-3 py-1.5"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-[#24221F]">
                  <Icon className="w-4 h-4 text-[#6C675F]" />
                  {label}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setter(Math.max(0, value - 1))}
                    disabled={value <= 0}
                    className="w-7 h-7 rounded-[7px] border border-[#DDD7CB] bg-white text-[#555047] hover:border-[#386641] hover:text-[#386641] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer flex items-center justify-center"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-8 text-center text-sm font-bold text-[#24221F]">
                    {value}
                  </span>
                  <button
                    type="button"
                    onClick={() => setter(Math.min(200, value + 1))}
                    disabled={value >= 200}
                    className="w-7 h-7 rounded-[7px] border border-[#DDD7CB] bg-white text-[#555047] hover:border-[#386641] hover:text-[#386641] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer flex items-center justify-center"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {/* Custom fixture types */}
            {Object.entries(customFixtures).map(([label, n]) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-[10px] border border-[#EAE5DC] bg-[#FAF8F5] px-3 py-1.5"
              >
                <span className="text-sm font-medium text-[#24221F] truncate">
                  {label}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setCustomFixtures((prev) => {
                        const next = { ...prev };
                        if (n <= 1) delete next[label];
                        else next[label] = n - 1;
                        return next;
                      })
                    }
                    className="w-7 h-7 rounded-[7px] border border-[#DDD7CB] bg-white text-[#555047] hover:border-[#386641] hover:text-[#386641] transition-colors cursor-pointer flex items-center justify-center"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-8 text-center text-sm font-bold text-[#24221F]">
                    {n}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setCustomFixtures((prev) => ({
                        ...prev,
                        [label]: Math.min(200, n + 1),
                      }))
                    }
                    className="w-7 h-7 rounded-[7px] border border-[#DDD7CB] bg-white text-[#555047] hover:border-[#386641] hover:text-[#386641] transition-colors cursor-pointer flex items-center justify-center"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCustomFixtures((prev) => {
                        const next = { ...prev };
                        delete next[label];
                        return next;
                      })
                    }
                    className="w-7 h-7 rounded-[7px] text-[#A59F95] hover:text-[#C53B3B] hover:bg-[#FDE8E8] transition-colors cursor-pointer flex items-center justify-center"
                    title={`Remove ${label}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {/* Add a custom fixture type */}
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newFixtureLabel}
                onChange={(e) => setNewFixtureLabel(e.target.value)}
                placeholder="Custom fixture, e.g. Hand Dryer"
                className="flex-1 px-3 py-1.5 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
              />
              <button
                type="button"
                disabled={!newFixtureLabel.trim()}
                onClick={() => {
                  const l = newFixtureLabel.trim();
                  if (!l) return;
                  setCustomFixtures((prev) => ({ ...prev, [l]: prev[l] || 1 }));
                  setNewFixtureLabel('');
                }}
                className="px-2.5 py-1.5 rounded-[8px] text-xs font-semibold bg-[#EBF3EC] text-[#244E2C] hover:bg-[#DCEBDE] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Fixture Type
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#F0ECE4]">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={nameTaken} isLoading={isSubmitting}>
            {isEdit ? 'Save Washroom' : 'Create Washroom'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
