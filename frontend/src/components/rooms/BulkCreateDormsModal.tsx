import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { DORM_TYPES, WASHROOM_TYPES } from './CreateDormModal';
import { ApiError } from '../../api/client';
import { DormType, WashroomType } from '../../types';
import { zoneSupportsUnits } from '../../lib/zoneUtils';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';

interface BulkCreateDormsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_ROWS = 50; // matches the backend DormBulkCreateRequest limit
const MAX_BEDS = 200; // matches DormCreateRequest bed_count ceiling

interface DormRow {
  key: number;
  name: string;
  bedCount: string;
  dormType: DormType;
  washroom: WashroomType;
  zoneUid: string;
  areaSqft: string;
  description: string;
}

type RowField = 'name' | 'bedCount' | 'areaSqft';
type RowErrors = Partial<Record<RowField, string>>;

const inputCls =
  'w-full px-2.5 py-1.5 bg-[#FAF8F5] border rounded-[8px] text-sm text-[#24221F] focus:outline-none focus:ring-2';
const okBorder = 'border-[#DDD7CB] focus:ring-[#386641]';
const badBorder = 'border-[#E5A3A3] focus:ring-[#C53B3B]';

export const BulkCreateDormsModal: React.FC<BulkCreateDormsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { bulkCreateDorms, currentPropertyDorms, currentPropertyZones } = useApp();

  const nextKey = useRef(1);
  const newRow = (): DormRow => ({
    key: nextKey.current++,
    name: '',
    bedCount: '',
    dormType: 'Mixed Dorm',
    washroom: 'Attached Washroom',
    zoneUid: '',
    areaSqft: '',
    description: '',
  });

  const [rows, setRows] = useState<DormRow[]>(() => [{ key: 0, name: '', bedCount: '', dormType: 'Mixed Dorm', washroom: 'Attached Washroom', zoneUid: '', areaSqft: '', description: '' }]);
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const zoneOptions = currentPropertyZones.filter((z) => zoneSupportsUnits(z));

  const existingNames = useMemo(
    () => new Set(currentPropertyDorms.map((d) => d.name.trim().toLowerCase())),
    [currentPropertyDorms]
  );

  // Live per-row validation — conflicts surface instantly, required-field
  // errors surface on the first submit attempt.
  const rowErrors = useMemo(() => {
    const firstRowOfName = new Map<string, number>();
    for (const r of rows) {
      const k = r.name.trim().toLowerCase();
      if (k && !firstRowOfName.has(k)) firstRowOfName.set(k, r.key);
    }
    const map: Record<number, RowErrors> = {};
    for (const r of rows) {
      const errs: RowErrors = {};
      const nm = r.name.trim();
      if (!nm) {
        errs.name = 'Dorm Name is required';
      } else if (existingNames.has(nm.toLowerCase())) {
        errs.name = 'Name already exists';
      } else if (firstRowOfName.get(nm.toLowerCase()) !== r.key) {
        errs.name = 'Duplicate in this list';
      }
      const beds = r.bedCount.trim();
      if (!beds) {
        errs.bedCount = 'Number of Beds is required';
      } else if (!/^\d+$/.test(beds) || parseInt(beds) < 1) {
        errs.bedCount = 'Must be a whole number ≥ 1';
      } else if (parseInt(beds) > MAX_BEDS) {
        errs.bedCount = `Max ${MAX_BEDS} beds`;
      }
      const area = r.areaSqft.trim();
      if (area && (!/^\d+$/.test(area) || parseInt(area) <= 0)) {
        errs.areaSqft = 'Invalid area';
      }
      if (Object.keys(errs).length > 0) map[r.key] = errs;
    }
    return map;
  }, [rows, existingNames]);

  const allValid = Object.keys(rowErrors).length === 0;

  // Show a field error instantly once it holds a bad value; "required"
  // errors wait for the submit attempt so empty rows don't shout.
  const visibleError = (row: DormRow, field: RowField): string | undefined => {
    const err = rowErrors[row.key]?.[field];
    if (!err) return undefined;
    if (attempted) return err;
    const raw = field === 'name' ? row.name : field === 'bedCount' ? row.bedCount : row.areaSqft;
    return raw.trim() ? err : undefined;
  };

  const updateRow = (key: number, patch: Partial<DormRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (key: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  };

  const reset = () => {
    nextKey.current = 1;
    setRows([{ key: 0, name: '', bedCount: '', dormType: 'Mixed Dorm', washroom: 'Attached Washroom', zoneUid: '', areaSqft: '', description: '' }]);
    setAttempted(false);
    setSubmitError(null);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    setAttempted(true);
    setSubmitError(null);
    if (!allValid || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await bulkCreateDorms({
        dorms: rows.map((r) => ({
          name: r.name.trim(),
          dorm_type: r.dormType,
          washroom: r.washroom,
          bed_count: parseInt(r.bedCount),
          zone_uid: r.zoneUid || null,
          area_sqft: r.areaSqft.trim() ? parseInt(r.areaSqft) : undefined,
          description: r.description.trim() || undefined,
        })),
      });
      reset();
      onClose();
    } catch (err) {
      // Context also raises an error toast — this pins row feedback inline
      setSubmitError(err instanceof ApiError ? err.message : 'Could not create the dorms.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Bulk Dorm Creation"
      description="Add multiple dormitories at once — each row generates its beds automatically."
      maxWidth="xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[#8C867C] font-body">
            {rows.length} dorm{rows.length === 1 ? '' : 's'} · up to {MAX_ROWS} per batch
          </span>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSubmit}
              isLoading={isSubmitting}
            >
              Create {rows.length} Dorm{rows.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {submitError && (
          <div className="flex items-start gap-2 p-3 rounded-[10px] bg-[#FDE8E8] border border-[#F9C3C3] text-xs text-[#A82828] font-body">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        {/* Line-item table — sticky header, horizontal scroll on narrow screens */}
        <div className="rounded-[12px] border border-[#E4DFD5] overflow-hidden">
          <div className="overflow-x-auto">
            <div className="max-h-[48vh] overflow-y-auto">
              <table className="min-w-[1000px] w-full text-left border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#F4F0E8] text-[10px] font-semibold uppercase tracking-wider text-[#736E65]">
                    <th className="px-2.5 py-2.5 w-8 bg-[#F4F0E8]">#</th>
                    <th className="px-2.5 py-2.5 min-w-[170px] bg-[#F4F0E8]">Dorm Name *</th>
                    <th className="px-2.5 py-2.5 w-[86px] bg-[#F4F0E8]">Beds *</th>
                    <th className="px-2.5 py-2.5 min-w-[130px] bg-[#F4F0E8]">Dorm Type</th>
                    <th className="px-2.5 py-2.5 min-w-[150px] bg-[#F4F0E8]">Washroom</th>
                    <th className="px-2.5 py-2.5 min-w-[130px] bg-[#F4F0E8]">Zone</th>
                    <th className="px-2.5 py-2.5 w-[96px] bg-[#F4F0E8]">Area (Sq Ft)</th>
                    <th className="px-2.5 py-2.5 min-w-[170px] bg-[#F4F0E8]">Description</th>
                    <th className="px-2 py-2.5 w-9 bg-[#F4F0E8]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0ECE4]">
                  {rows.map((row, i) => {
                    const nameErr = visibleError(row, 'name');
                    const bedErr = visibleError(row, 'bedCount');
                    const areaErr = visibleError(row, 'areaSqft');
                    return (
                      <tr key={row.key} className="align-top">
                        <td className="px-2.5 py-2.5 text-xs text-[#8C867C] font-mono pt-3.5">
                          {i + 1}
                        </td>
                        <td className="px-2.5 py-2">
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) => updateRow(row.key, { name: e.target.value })}
                            placeholder="e.g. Male Dorm 1"
                            className={`${inputCls} ${nameErr ? badBorder : okBorder}`}
                          />
                          {nameErr && (
                            <p className="text-[10px] text-[#A82828] font-body mt-1">{nameErr}</p>
                          )}
                        </td>
                        <td className="px-2.5 py-2">
                          <input
                            type="number"
                            min={1}
                            max={MAX_BEDS}
                            value={row.bedCount}
                            onChange={(e) => updateRow(row.key, { bedCount: e.target.value })}
                            placeholder="8"
                            className={`${inputCls} ${bedErr ? badBorder : okBorder}`}
                          />
                          {bedErr && (
                            <p className="text-[10px] text-[#A82828] font-body mt-1">{bedErr}</p>
                          )}
                        </td>
                        <td className="px-2.5 py-2">
                          <select
                            value={row.dormType}
                            onChange={(e) => updateRow(row.key, { dormType: e.target.value as DormType })}
                            className={`${inputCls} ${okBorder}`}
                          >
                            {DORM_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2.5 py-2">
                          <select
                            value={row.washroom}
                            onChange={(e) => updateRow(row.key, { washroom: e.target.value as WashroomType })}
                            className={`${inputCls} ${okBorder}`}
                          >
                            {WASHROOM_TYPES.map((w) => (
                              <option key={w} value={w}>
                                {w}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2.5 py-2">
                          <select
                            value={row.zoneUid}
                            onChange={(e) => updateRow(row.key, { zoneUid: e.target.value })}
                            className={`${inputCls} ${okBorder}`}
                          >
                            <option value="">(Unallocated)</option>
                            {zoneOptions.map((z) => (
                              <option key={z.zone_uid} value={z.zone_uid}>
                                {z.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2.5 py-2">
                          <input
                            type="number"
                            min={1}
                            value={row.areaSqft}
                            onChange={(e) => updateRow(row.key, { areaSqft: e.target.value })}
                            placeholder="450"
                            className={`${inputCls} ${areaErr ? badBorder : okBorder}`}
                          />
                          {areaErr && (
                            <p className="text-[10px] text-[#A82828] font-body mt-1">{areaErr}</p>
                          )}
                        </td>
                        <td className="px-2.5 py-2">
                          <input
                            type="text"
                            value={row.description}
                            onChange={(e) => updateRow(row.key, { description: e.target.value })}
                            placeholder="e.g. 8-bed male dorm"
                            className={`${inputCls} ${okBorder}`}
                          />
                        </td>
                        <td className="px-2 py-2.5 pt-3">
                          <button
                            type="button"
                            onClick={() => removeRow(row.key)}
                            disabled={rows.length <= 1}
                            title={rows.length <= 1 ? 'At least one dorm is required' : 'Remove this dorm'}
                            className="text-[#999388] hover:text-[#C53B3B] p-1 rounded-[6px] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((prev) => [...prev, newRow()])}
            disabled={rows.length >= MAX_ROWS}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            <span>Add Another Dorm</span>
          </Button>
          {attempted && !allValid && (
            <p className="text-[11px] text-[#A82828] font-body mt-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Fix the highlighted fields before creating.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};
