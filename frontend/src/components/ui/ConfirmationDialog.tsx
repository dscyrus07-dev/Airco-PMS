import React, { useEffect, useState } from 'react';
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
  title?: string;
  warningTitle?: string;
  promptMessage?: string;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'destructive';
  /** Require an exact typed value before the confirm button is enabled. */
  confirmationText?: string;
  isLoading?: boolean;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  entityType,
  entityName,
  impactMessage,
  title,
  warningTitle = 'This action cannot be undone.',
  promptMessage,
  confirmLabel,
  confirmVariant = 'destructive',
  confirmationText,
  isLoading = false,
}) => {
  const [typedConfirmation, setTypedConfirmation] = useState('');

  useEffect(() => {
    if (isOpen) setTypedConfirmation('');
  }, [isOpen, entityName]);

  const confirmationMatches =
    !confirmationText || typedConfirmation.trim() === confirmationText;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title || `Delete ${entityType}?`}
      maxWidth="sm"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3.5 bg-[#FDE8E8] border border-[#F9C3C3] rounded-[14px] text-[#8C2323]">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm font-body">
            <p className="font-semibold">{warningTitle}</p>
            <p className="mt-1 text-xs opacity-90">{impactMessage}</p>
          </div>
        </div>

        <p className="text-sm text-[#544F47] font-body">
          {promptMessage || (
            <>
              Are you sure you want to permanently delete{' '}
              <strong className="text-[#24221F] font-semibold">{entityName}</strong>?
            </>
          )}
        </p>

        {confirmationText && (
          <div>
            <label className="block text-xs font-semibold text-[#544F47] mb-1.5">
              Type <span className="font-mono">{confirmationText}</span> to confirm
            </label>
            <input
              type="text"
              value={typedConfirmation}
              onChange={(e) => setTypedConfirmation(e.target.value)}
              autoComplete="off"
              className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#C53B3B]/20 focus:border-[#C53B3B]"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#F0EBE2]">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={() => {
              onConfirm();
              onClose();
            }}
            isLoading={isLoading}
            disabled={!confirmationMatches}
          >
            {confirmLabel || `Delete ${entityType}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
