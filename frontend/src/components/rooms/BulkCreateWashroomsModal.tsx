import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ApiError } from '../../api/client';
import { WashroomResourceType } from '../../types';
import { WASHROOM_TYPES } from './WashroomModal';

interface BulkCreateWashroomsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_ROWS = 50;

interface WashroomRow {
  key: number;
  name: string;
  washroomType: WashroomResourceType;
  stallCount: number;
  urinalCount: number;
  showerCount: number;
  zoneUid: string;
}

const inputCls =
  'w-full px-2.5 py-1.5 bg-[#FAF8F5] border rounded-[8px] text-sm text-[#24221F] focus:outline-none focus:ring-2';
const okBorder = 'border-[#DDD7CB] focus:ring-[#386641]';
const badBorder = 'border-[#E5A3A3] focus:ring-[#C53B3B]';

const emptyRow = (key: number): WashroomRow => ({
  key,
  name: '',
  washroomType: 'unisex',
  stallCount: 0,
  urinalCount: 0,
  showerCount: 0,
  zoneUid: '',
});

export const BulkCreateWashroomsModal: React.FC<
  BulkCreateWashroomsModalProps
> = ({ isOpen, onClose }) => {
  const { bulkCreateWashrooms, currentPropertyWashrooms, currentPropertyZones } =
    useApp();

  const nextKey = useRef(1);
  const [rows, setRows] = useState<WashroomRow[]>(() => [emptyRow(0)]);
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const existingNames = useMemo(
    () => new Set(currentPropertyWashrooms.map((w) => w.name.trim().toLowerCase())),
    [currentPropertyWashrooms]
  );

  const rowErrors = useMemo(() => {
    const firstRowOfName = new Map<string, number>();
    for (const r of rows) {
      const k = r.name.trim().toLowerCase();
      if (k && !firstRowOfName.has(k)) firstRowOfName.set(k, r.key);
    }
    const map: Record<number, string> = {};
    for (const r of rows) {
      const name = r.name.trim();
      if (!name) map[r.key] = 'Washroom Name is required';
      else if (existingNames.has(name.toLowerCase())) map[r.key] = 'Name already exists';
      else if (firstRowOfName.get(name.toLowerCase()) !== r.key) {
        map[r.key] = 'Duplicate in this list';
      }
    }
    return map;
  }, [rows, existingNames]);

  const allValid = Object.keys(rowErrors).length === 0;

  const updateRow = (key: number, patch: Partial<WashroomRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const reset = () => {
    nextKey.current = 1;
    setRows([emptyRow(0)]);
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
      await bulkCreateWashrooms({
        washrooms: rows.map((r) => ({
          name: r.name.trim(),
          washroom_type: r.washroomType,
          stall_count: r.stallCount,
          urinal_count: r.urinalCount,
          shower_count: r.showerCount,
          zone_uid: r.zoneUid || null,
        })),
      });
      reset();
      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : 'Could not create the washrooms.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Bulk Create Washrooms"
      description="Create multiple washroom resources and assign each one to a zone."
      maxWidth="xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[#8C867C] font-body">
            {rows.length} washroom{rows.length === 1 ? '' : 's'} · up to {MAX_ROWS} per batch
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
              Create {rows.length} Washroom{rows.length === 1 ? '' : 's'}
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

        <div className="rounded-[12px] border border-[#E4DFD5] overflow-hidden">
          <div className="overflow-x-auto">
            <div className="max-h-[48vh] overflow-y-auto">
              <table className="min-w-[940px] w-full text-left border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#F4F0E8] text-[10px] font-semibold uppercase tracking-wider text-[#736E65]">
                    <th className="px-2.5 py-2.5 w-8 bg-[#F4F0E8]">#</th>
                    <th className="px-2.5 py-2.5 min-w-[220px] bg-[#F4F0E8]">Washroom Name *</th>
                    <th className="px-2.5 py-2.5 min-w-[140px] bg-[#F4F0E8]">Type *</th>
                    <th className="px-2 py-2.5 w-[74px] bg-[#F4F0E8]">Stalls</th>
                    <th className="px-2 py-2.5 w-[74px] bg-[#F4F0E8]">Urinals</th>
                    <th className="px-2 py-2.5 w-[74px] bg-[#F4F0E8]">Showers</th>
                    <th className="px-2.5 py-2.5 min-w-[180px] bg-[#F4F0E8]">Assign to Zone</th>
                    <th className="px-2 py-2.5 w-9 bg-[#F4F0E8]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0ECE4]">
                  {rows.map((row, i) => {
                    const nameErr = rowErrors[row.key];
                    const visibleErr =
                      nameErr && (attempted || row.name.trim()) ? nameErr : undefined;
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
                            placeholder="e.g. W-001"
                            className={`${inputCls} ${visibleErr ? badBorder : okBorder}`}
                          />
                          {visibleErr && (
                            <p className="text-[10px] text-[#A82828] font-body mt-1">
                              {visibleErr}
                            </p>
                          )}
                        </td>
                        <td className="px-2.5 py-2">
                          <select
                            value={row.washroomType}
                            onChange={(e) =>
                              updateRow(row.key, {
                                washroomType: e.target.value as WashroomResourceType,
                              })
                            }
                            className={`${inputCls} ${okBorder}`}
                          >
                            {WASHROOM_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        {([
                          ['stallCount', row.stallCount],
                          ['urinalCount', row.urinalCount],
                          ['showerCount', row.showerCount],
                        ] as const).map(([field, value]) => (
                          <td key={field} className="px-2 py-2">
                            <input
                              type="number"
                              min={0}
                              max={200}
                              value={value}
                              onChange={(e) =>
                                updateRow(row.key, {
                                  [field]: Math.min(
                                    200,
                                    Math.max(0, Number(e.target.value) || 0)
                                  ),
                                })
                              }
                              className={`${inputCls} ${okBorder}`}
                            />
                          </td>
                        ))}
                        <td className="px-2.5 py-2">
                          <select
                            value={row.zoneUid}
                            onChange={(e) => updateRow(row.key, { zoneUid: e.target.value })}
                            className={`${inputCls} ${okBorder}`}
                          >
                            <option value="">(Unallocated)</option>
                            {currentPropertyZones.map((z) => (
                              <option key={z.zone_uid} value={z.zone_uid}>
                                {z.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              setRows((prev) =>
                                prev.length > 1
                                  ? prev.filter((r) => r.key !== row.key)
                                  : prev
                              )
                            }
                            disabled={rows.length === 1}
                            className="p-1.5 text-[#A59F95] hover:text-[#C53B3B] hover:bg-[#FDE8E8] rounded-[7px] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                            title="Remove row"
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

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length >= MAX_ROWS}
          onClick={() => setRows((prev) => [...prev, emptyRow(nextKey.current++)])}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add Washroom Row
        </Button>
      </div>
    </Modal>
  );
};
