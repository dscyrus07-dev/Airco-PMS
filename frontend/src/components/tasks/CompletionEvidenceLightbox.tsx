import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon, Trash2, X } from 'lucide-react';
import { mediaUrl } from '../../api/client';
import { Button } from '../ui/Button';

export interface EvidenceImage {
  image_uid?: string | null;
  url: string;
}

interface Props {
  images: EvidenceImage[];
  initialIndex?: number;
  title?: string;
  canDelete?: boolean;
  onClose: () => void;
  onDelete?: (image: EvidenceImage) => Promise<boolean>;
}

export const CompletionEvidenceLightbox: React.FC<Props> = ({
  images,
  initialIndex = 0,
  title = 'Completion Evidence',
  canDelete = false,
  onClose,
  onDelete,
}) => {
  const [index, setIndex] = useState(initialIndex);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setIndex(Math.min(initialIndex, Math.max(images.length - 1, 0)));
    setConfirmingDelete(false);
  }, [initialIndex]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(images.length - 1, 0)));
  }, [images.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (confirmingDelete) return;
      if (e.key === 'ArrowLeft' && images.length > 1) {
        setIndex((i) => (i - 1 + images.length) % images.length);
      }
      if (e.key === 'ArrowRight' && images.length > 1) {
        setIndex((i) => (i + 1) % images.length);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmingDelete, images.length, onClose]);

  if (images.length === 0) return null;

  const current = images[index];
  const hasMany = images.length > 1;
  const canDeleteCurrent = Boolean(canDelete && current.image_uid && onDelete);

  const confirmDelete = async () => {
    if (!current.image_uid || !onDelete) return;
    setDeleting(true);
    try {
      const deleted = await onDelete(current);
      if (!deleted) return;
      setConfirmingDelete(false);
      if (images.length <= 1) onClose();
      else setIndex(Math.min(index, images.length - 2));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-[#171511]/80 backdrop-blur-sm p-4 sm:p-8 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl bg-[#24221F] border border-white/10 rounded-[18px] shadow-2xl text-white overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <ImageIcon className="w-4 h-4 text-[#CFC8BB] shrink-0" />
            <h2 className="font-display font-semibold text-lg truncate">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close image preview"
            className="w-9 h-9 rounded-full flex items-center justify-center text-[#D8D1C4] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative bg-black/35 flex items-center justify-center min-h-[320px] max-h-[64vh] p-4">
          <img
            src={mediaUrl(current.url)}
            alt={`Completion evidence ${index + 1}`}
            className="max-h-[58vh] max-w-full object-contain rounded-[10px] shadow-lg"
          />
          {hasMany && (
            <>
              <button
                type="button"
                onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
                aria-label="Previous image"
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/75 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setIndex((i) => (i + 1) % images.length)}
                aria-label="Next image"
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/75 transition-colors cursor-pointer"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>

        {hasMany && (
          <div className="flex gap-2 px-5 pt-4 overflow-x-auto">
            {images.map((image, i) => (
              <button
                key={image.image_uid || image.url}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`View image ${i + 1}`}
                className={`w-16 h-16 rounded-[10px] overflow-hidden border-2 shrink-0 cursor-pointer transition-colors ${
                  i === index ? 'border-[#9FBF88]' : 'border-white/15 hover:border-white/35'
                }`}
              >
                <img
                  src={mediaUrl(image.url)}
                  alt={`Evidence thumbnail ${i + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <span className="text-sm text-[#D8D1C4]">
            Image {index + 1} of {images.length}
          </span>
          {canDeleteCurrent && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmingDelete(true)}
              className="gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Image
            </Button>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <div
          className="fixed inset-0 z-[80] bg-black/55 flex items-center justify-center p-4"
          onClick={(e) => {
            e.stopPropagation();
            if (!deleting) setConfirmingDelete(false);
          }}
        >
          <div
            className="w-full max-w-sm bg-white rounded-[16px] p-5 shadow-2xl text-[#24221F]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display font-semibold text-base">Delete this image?</h3>
            <p className="text-sm text-[#6C675F] mt-2">
              This completion image will be permanently removed from this task.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <Button
                variant="ghost"
                size="sm"
                disabled={deleting}
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                isLoading={deleting}
                onClick={() => void confirmDelete()}
              >
                Delete Image
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompletionEvidenceLightbox;
