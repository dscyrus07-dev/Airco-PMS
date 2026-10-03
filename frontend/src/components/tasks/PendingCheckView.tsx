import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClipboardCheck, RefreshCw, User, MapPin, Camera, CheckCircle2, Undo2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PendingCheckItem } from '../../api/types';
import { TaskCompletionImage, TaskCompletionSubmission } from '../../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { mediaUrl } from '../../api/client';
import { CompletionEvidenceLightbox, EvidenceImage } from './CompletionEvidenceLightbox';
import { fmtDateTimeIST } from '../../lib/datetime';

interface Props {
  onOpenTask: (uid: string, kind: 'task' | 'maintenance') => void;
}

const fmtSubmitted = fmtDateTimeIST;

/**
 * Pending Check — employee-submitted work awaiting Property Manager review.
 * Tasks in 'submitted' + maintenance tickets in 'resolved' — approve
 * completes the work (and releases the resource when nothing else blocks);
 * disapprove returns it to the employee with a required reason.
 */
export const PendingCheckView: React.FC<Props> = ({ onOpenTask }) => {
  const {
    activePropertyUid, addToast,
    approveTask, rejectTask, deleteTaskCompletionImage,
    closeMaintenanceTicket, disapproveMaintenanceTicket,
    pendingCheck, refreshPendingCheck,
  } = useApp();
  // Shared snapshot owned by AppContext — the TasksView badge is the 30s
  // poller; this view consumes the same data and only requests a refresh
  // (deduplicated) on mount and after approve/disapprove actions.
  const data = pendingCheck;
  const [loading, setLoading] = useState(pendingCheck === null);
  const [acting, setActing] = useState<string | null>(null);
  const [disapproveItem, setDisapproveItem] = useState<PendingCheckItem | null>(null);
  const [viewer, setViewer] = useState<{
    uid: string;
    title: string;
    images: EvidenceImage[];
    index: number;
  } | null>(null);
  const [reason, setReason] = useState('');
  const loadingRef = useRef(loading);
  useEffect(() => {
    if (data !== null && loadingRef.current) {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    if (!activePropertyUid) return;
    void refreshPendingCheck().finally(() => {
      if (loadingRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    });
  }, [activePropertyUid, refreshPendingCheck]);

  const approve = async (item: PendingCheckItem) => {
    setActing(item.uid);
    try {
      // context methods update task/ticket state AND re-fetch unit statuses
      // (approval releases the room/dorm/bed server-side)
      if (item.kind === 'task') await approveTask(item.uid);
      else await closeMaintenanceTicket(item.uid);
      await refreshPendingCheck();
    } finally {
      setActing(null);
    }
  };

  const submitDisapproval = async () => {
    if (!disapproveItem || reason.trim().length < 3) return;
    setActing(disapproveItem.uid);
    try {
      if (disapproveItem.kind === 'task')
        await rejectTask(disapproveItem.uid, reason.trim());
      else
        await disapproveMaintenanceTicket(disapproveItem.uid, reason.trim());
      setDisapproveItem(null);
      setReason('');
      await refreshPendingCheck();
    } finally {
      setActing(null);
    }
  };

  const items = data?.items || [];
  const attemptStatusBadge = (status?: string) => {
    if (status === 'approved') return 'sage';
    if (status === 'disapproved') return 'red';
    return 'orange';
  };
  const attemptStatusLabel = (status?: string) => {
    if (status === 'approved') return 'Approved';
    if (status === 'disapproved') return 'Disapproved';
    return 'Pending Review';
  };
  const attemptsFor = (item: PendingCheckItem): TaskCompletionSubmission[] => {
    if (item.completion_submissions?.length) {
      return [...item.completion_submissions].sort(
        (a, b) => b.attempt_number - a.attempt_number
      );
    }
    if (item.kind !== 'task' || item.photo_urls.length === 0) return [];
    return [{
      submission_uid: `${item.uid}-legacy`,
      task_uid: item.uid,
      attempt_number: 1,
      employee_name: item.employee,
      submitted_at: item.submitted_at,
      status: 'pending',
      images: item.photo_urls.map((url): TaskCompletionImage => ({
        image_uid: null,
        url,
      })),
    }];
  };

  const deleteEvidence = async (taskUid: string, image: EvidenceImage) => {
    if (!image.image_uid) return false;
    const updated = await deleteTaskCompletionImage(taskUid, image.image_uid);
    if (updated) {
      setViewer((current) => current && ({
        ...current,
        images: current.images.filter((i) => i.image_uid !== image.image_uid),
      }));
    }
    await refreshPendingCheck();
    return Boolean(updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#6C675F]">
          Employee-submitted work awaiting your review. Approval completes the
          work and releases the room when nothing else blocks it.
        </p>
        <Button variant="ghost" size="sm" onClick={() => void refreshPendingCheck()} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-[#6C675F]">Loading pending checks…</div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center">
          <ClipboardCheck className="w-10 h-10 mx-auto text-[#C7C0B3] mb-3" />
          <p className="text-sm font-semibold text-[#24221F]">Nothing awaiting review</p>
          <p className="text-xs text-[#6C675F] mt-1">Employee submissions will appear here for approval.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <div
              key={item.uid}
              className="bg-white border border-[#E4DFD5] rounded-[14px] p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={item.kind === 'maintenance' ? 'orange' : 'lavender'}>
                      {item.kind === 'maintenance' ? 'Maintenance' : 'Task'}
                    </Badge>
                    <h3 className="font-display font-semibold text-[15px] text-[#24221F] truncate">
                      {item.title}
                    </h3>
                    {item.ticket_number && (
                      <span className="text-[11px] text-[#8A857B] font-mono">{item.ticket_number}</span>
                    )}
                    <Badge variant="orange">Pending Check</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-4 flex-wrap text-xs text-[#6C675F]">
                    <span className="inline-flex items-center gap-1">
                      <User className="w-3.5 h-3.5" /> {item.employee || 'Unassigned'}
                    </span>
                    {item.room_number && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" /> {item.room_number}
                      </span>
                    )}
                    <span>Submitted {fmtSubmitted(item.submitted_at)}</span>
                    {item.photo_urls.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Camera className="w-3.5 h-3.5" /> {item.photo_urls.length} current photo{item.photo_urls.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {item.note && (
                    <p className="mt-2 text-xs text-[#555047] bg-[#FAF8F5] border border-[#EDE8DE] rounded-[8px] px-3 py-2">
                      “{item.note}”
                    </p>
                  )}
                  {item.kind === 'task' ? (
                    attemptsFor(item).length > 0 && (
                      <div className="mt-3 space-y-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8A857B]">
                          Completion Evidence
                        </p>
                        {attemptsFor(item).map((attempt) => (
                          <div
                            key={attempt.submission_uid}
                            className={`rounded-[10px] border p-3 ${
                              attempt.status === 'pending'
                                ? 'border-[#B7CFAA] bg-[#F7FAF4]'
                                : 'border-[#E4DFD5] bg-[#FAF8F5]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-[#24221F]">
                                  Attempt {attempt.attempt_number} · {attempt.images.length} image{attempt.images.length === 1 ? '' : 's'}
                                </p>
                                <p className="text-[11px] text-[#6C675F] mt-0.5">
                                  Submitted by {attempt.employee_name || 'Unknown'} · {fmtSubmitted(attempt.submitted_at)}
                                </p>
                                {attempt.reviewed_at && (
                                  <p className="text-[11px] text-[#6C675F] mt-0.5">
                                    Reviewed{attempt.reviewed_by_name ? ` by ${attempt.reviewed_by_name}` : ''} · {fmtSubmitted(attempt.reviewed_at)}
                                  </p>
                                )}
                              </div>
                              <Badge variant={attemptStatusBadge(attempt.status)} size="sm">
                                {attemptStatusLabel(attempt.status)}
                              </Badge>
                            </div>
                            {attempt.review_comment && (
                              <p className="mt-2 text-[11px] text-[#555047] bg-white border border-[#EDE8DE] rounded-[8px] px-2.5 py-1.5">
                                Review: {attempt.review_comment}
                              </p>
                            )}
                            <div className="mt-2 flex gap-2 flex-wrap">
                              {attempt.images.length === 0 ? (
                                <span className="text-[11px] text-[#8A857B]">No images remain in this submission</span>
                              ) : attempt.images.map((image, imageIndex) => (
                                <button
                                  key={image.image_uid || `${attempt.submission_uid}-${imageIndex}`}
                                  type="button"
                                  onClick={() => setViewer({
                                    uid: item.uid,
                                    title: `${item.title} — Attempt ${attempt.attempt_number}`,
                                    images: attempt.images,
                                    index: imageIndex,
                                  })}
                                  className="rounded-[8px] border border-[#E5E0D6] hover:border-[#8A9C72] focus:outline-none focus:ring-2 focus:ring-[#386641] cursor-zoom-in"
                                >
                                  <img
                                    src={mediaUrl(image.url)}
                                    alt={`Attempt ${attempt.attempt_number} evidence ${imageIndex + 1}`}
                                    className="w-14 h-14 rounded-[6px] object-cover"
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : item.photo_urls.length > 0 && (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      {item.photo_urls.map((url, imageIndex) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => setViewer({
                            uid: item.uid,
                            title: item.title,
                            images: item.photo_urls.map((u) => ({ url: u })),
                            index: imageIndex,
                          })}
                          className="rounded-[8px] border border-[#E5E0D6] hover:border-[#8A9C72] focus:outline-none focus:ring-2 focus:ring-[#386641] cursor-zoom-in"
                        >
                          <img
                            src={mediaUrl(url)}
                            alt="completion evidence"
                            className="w-14 h-14 rounded-[6px] object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="primary" size="sm"
                    isLoading={acting === item.uid}
                    onClick={() => void approve(item)}
                    className="gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => { setDisapproveItem(item); setReason(''); }}
                    className="gap-1.5 text-[#A32A2A] border-[#F0C4C4] hover:bg-[#FDE8E8]"
                  >
                    <Undo2 className="w-3.5 h-3.5" /> Disapprove
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onOpenTask(item.uid, item.kind)}>
                    View
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewer && (
        <CompletionEvidenceLightbox
          images={viewer.images}
          initialIndex={viewer.index}
          title={viewer.title}
          canDelete={items.find((item) => item.uid === viewer.uid)?.kind === 'task'}
          onClose={() => setViewer(null)}
          onDelete={(image) => deleteEvidence(viewer.uid, image)}
        />
      )}

      {/* Disapprove reason dialog */}
      {disapproveItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
             onClick={() => setDisapproveItem(null)}>
          <div className="bg-white rounded-[16px] shadow-xl w-full max-w-md p-5 space-y-4"
               onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-semibold text-[#24221F]">
              Disapprove — {disapproveItem.title}
            </h3>
            <p className="text-xs text-[#6C675F]">
              The work is returned to the employee. A reason is required.
            </p>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Bathroom was not completed — please redo."
              className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#386641]"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDisapproveItem(null)}>Cancel</Button>
              <Button
                variant="primary" size="sm"
                disabled={reason.trim().length < 3}
                isLoading={acting === disapproveItem.uid}
                onClick={() => void submitDisapproval()}
              >
                Submit Disapproval
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PendingCheckView;
