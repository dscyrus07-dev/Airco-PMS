import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

export interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  entityType: string; // e.g. "Property", "Zone", "Room", "Dorm", "Employee"
  entityName: string; // e.g. "Zone A — Ground Floor"
  impactMessage: string; // e.g. "Deleting this zone will un-assign all 4 rooms and 7 employees. They will not be deleted."
  isLoading?: boolean;
  title?: string; // overrides the default "Delete {entityType}?"
  confirmLabel?: string; // overrides the default "Delete {entityType}"
  question?: string; // overrides the default "permanently delete" line
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  entityType,
  entityName,
  impactMessage,
  isLoading = false,
  title,
  confirmLabel,
  question,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title ?? `Delete ${entityType}?`}
      maxWidth="sm"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3.5 bg-[#FDE8E8] border border-[#F9C3C3] rounded-[14px] text-[#8C2323]">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm font-body">
            <p className="font-semibold">This action cannot be undone.</p>
            <p className="mt-1 text-xs opacity-90">{impactMessage}</p>
          </div>
        </div>

        <p className="text-sm text-[#544F47] font-body">
          {question ?? 'Are you sure you want to permanently delete'}{' '}
          <strong className="text-[#24221F] font-semibold">{entityName}</strong>?
        </p>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#F0EBE2]">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            isLoading={isLoading}
          >
            {confirmLabel ?? `Delete ${entityType}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
