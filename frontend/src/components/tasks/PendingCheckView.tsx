import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClipboardCheck, RefreshCw, User, MapPin, Camera, CheckCircle2, Undo2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import * as tasksApi from '../../api/tasks';
import * as maintenanceApi from '../../api/maintenance';
import { PendingCheckItem, PendingCheckResponse } from '../../api/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { mediaUrl } from '../../api/client';

interface Props {
  onOpenTask: (uid: string, kind: 'task' | 'maintenance') => void;
  onCountChange?: (count: number) => void;
}

function fmtSubmitted(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

/**
 * Pending Check — employee-submitted work awaiting Property Manager review.
 * Tasks in 'submitted' + maintenance tickets in 'resolved' — approve
 * completes the work (and releases the resource when nothing else blocks);
 * disapprove returns it to the employee with a required reason.
 */
export const PendingCheckView: React.FC<Props> = ({ onOpenTask, onCountChange }) => {
  const { activePropertyUid, addToast } = useApp();
  const [data, setData] = useState<PendingCheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [disapproveItem, setDisapproveItem] = useState<PendingCheckItem | null>(null);
  const [reason, setReason] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!activePropertyUid) return;
    if (!quiet) setLoading(true);
    try {
      const res = await tasksApi.pendingCheck(activePropertyUid);
      setData(res);
      onCountChange?.(res.count);
    } catch {
      if (!quiet) addToast({ type: 'error', title: 'Could not load pending checks' });
    } finally {
      setLoading(false);
    }
  }, [activePropertyUid, addToast, onCountChange]);

  useEffect(() => {
    void load();
    pollRef.current = setInterval(() => void load(true), 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const approve = async (item: PendingCheckItem) => {
    setActing(item.uid);
    try {
      if (item.kind === 'task') await tasksApi.approveTask(item.uid);
      else await maintenanceApi.closeMaintenanceTicket(item.uid);
      addToast({ type: 'success', title: 'Approved', description: `${item.title} marked completed.` });
      await load(true);
    } catch (e) {
      addToast({ type: 'error', title: 'Approval failed' });
    } finally {
      setActing(null);
    }
  };

  const submitDisapproval = async () => {
    if (!disapproveItem || reason.trim().length < 3) return;
    setActing(disapproveItem.uid);
    try {
      if (disapproveItem.kind === 'task')
        await tasksApi.rejectTask(disapproveItem.uid, reason.trim());
      else
        await maintenanceApi.disapproveMaintenanceTicket(disapproveItem.uid, reason.trim());
      addToast({ type: 'info', title: 'Returned for correction' });
      setDisapproveItem(null);
      setReason('');
      await load(true);
    } catch (e) {
      addToast({ type: 'error', title: 'Disapproval failed' });
    } finally {
      setActing(null);
    }
  };

  const items = data?.items || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#6C675F]">
          Employee-submitted work awaiting your review. Approval completes the
          work and releases the room when nothing else blocks it.
        </p>
        <Button variant="ghost" size="sm" onClick={() => void load()} className="gap-1.5">
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
                        <Camera className="w-3.5 h-3.5" /> {item.photo_urls.length} photo{item.photo_urls.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {item.note && (
                    <p className="mt-2 text-xs text-[#555047] bg-[#FAF8F5] border border-[#EDE8DE] rounded-[8px] px-3 py-2">
                      “{item.note}”
                    </p>
                  )}
                  {item.photo_urls.length > 0 && (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      {item.photo_urls.slice(0, 4).map((u) => (
                        <a key={u} href={mediaUrl(u)} target="_blank" rel="noreferrer">
                          <img
                            src={mediaUrl(u)}
                            alt="completion evidence"
                            className="w-14 h-14 rounded-[8px] object-cover border border-[#E5E0D6]"
                          />
                        </a>
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
