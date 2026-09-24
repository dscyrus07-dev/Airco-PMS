import React, { useEffect, useState } from 'react';
import { X, Play, Pause, Archive, Zap, RefreshCw } from 'lucide-react';
import * as templatesApi from '../../api/templates';
import { WorkTemplate, WorkTemplateGeneratedWork } from '../../api/types';
import { useApp } from '../../context/AppContext';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

const TYPE_LABELS: Record<string, string> = {
  task: 'Task', maintenance: 'Maintenance', inspection: 'Inspection',
  cleaning: 'Cleaning', checklist: 'Checklist', other: 'Other',
};

interface Props {
  template: WorkTemplate;
  onClose: () => void;
  onChanged: (t: WorkTemplate) => void;
}

export const TemplateDetailDrawer: React.FC<Props> = ({ template, onClose, onChanged }) => {
  const { addToast } = useApp();
  const [work, setWork] = useState<WorkTemplateGeneratedWork | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    templatesApi.templateGeneratedWork(template.template_uid)
      .then(setWork)
      .catch(() => {});
  }, [template.template_uid]);

  const act = async (action: 'pause' | 'resume' | 'activate' | 'archive') => {
    try {
      const t = await templatesApi.templateAction(template.template_uid, action);
      onChanged(t);
      addToast({ type: 'success', title: `Template ${action}d` });
    } catch (err) {
      addToast({ type: 'error', title: 'Action failed', description: err instanceof Error ? err.message : '' });
    }
  };

  const runNow = async () => {
    setGenerating(true);
    try {
      const stats = await templatesApi.generateDue();
      addToast({
        type: stats.generated ? 'success' : 'info',
        title: 'Scheduler tick complete',
        description: `${stats.generated} work item(s) generated.`,
      });
      const res = await templatesApi.templateGeneratedWork(template.template_uid);
      setWork(res);
    } catch (err) {
      addToast({ type: 'error', title: 'Generation failed', description: err instanceof Error ? err.message : '' });
    } finally {
      setGenerating(false);
    }
  };

  const allWork = [
    ...(work?.tasks || []).map((t) => ({
      number: t.ticket_number, title: t.title, status: t.status,
      assignee: t.assigned_to_name, kind: 'task' as const,
    })),
    ...(work?.maintenance || []).map((t) => ({
      number: t.ticket_number, title: t.issue, status: t.status,
      assignee: t.assigned_to_name, kind: 'maintenance' as const,
    })),
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-md bg-white h-full shadow-xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-[#EAE5DC] px-5 py-4 flex items-start justify-between z-10">
          <div>
            <p className="font-display font-bold text-lg text-[#24221F]">{template.name}</p>
            <p className="text-xs text-[#8C867C] mt-0.5">
              {TYPE_LABELS[template.template_type]} · v{template.version} · by {template.created_by_name || '—'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={template.status === 'active' ? 'sage' : template.status === 'paused' ? 'orange' : 'neutral'}>
              {template.status}
            </Badge>
            <button onClick={onClose} className="p-1.5 text-[#8C867C] hover:bg-[#F5F2EB] rounded-[8px] cursor-pointer">
              <X className="w-4.5 h-4.5 w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {template.description && (
            <p className="text-sm text-[#58534C]">{template.description}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {template.status === 'active' ? (
              <Button variant="outline" size="sm" onClick={() => void act('pause')}>
                <Pause className="w-3.5 h-3.5" /> Pause
              </Button>
            ) : template.status !== 'archived' ? (
              <Button variant="outline" size="sm" onClick={() => void act('activate')}>
                <Play className="w-3.5 h-3.5" /> Activate
              </Button>
            ) : null}
            {template.status !== 'archived' && (
              <Button variant="outline" size="sm" onClick={() => void act('archive')}>
                <Archive className="w-3.5 h-3.5" /> Archive
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void runNow()} disabled={generating}>
              <Zap className="w-3.5 h-3.5" /> {generating ? 'Running…' : 'Run Scheduler'}
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Generated', String(template.generated_count)],
              ['Next run', template.next_run_at ? new Date(template.next_run_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'],
              ['Checklist', `${template.checklist?.length || 0} items`],
            ].map(([k, v]) => (
              <div key={k} className="bg-[#FAF8F5] border border-[#EAE5DC] rounded-[10px] px-3 py-2.5 text-center">
                <p className="text-sm font-semibold text-[#24221F]">{v}</p>
                <p className="text-[10px] text-[#8C867C] uppercase tracking-wider mt-0.5">{k}</p>
              </div>
            ))}
          </div>

          {/* Config summary */}
          <section>
            <h3 className="text-[11px] font-semibold text-[#8C867C] uppercase tracking-wider mb-2">Configuration</h3>
            <div className="space-y-1.5 text-[13px] text-[#35322E]">
              <p>Assignment: {template.assignment?.mode === 'automatic' ? `Auto (${template.assignment.method?.replace(/_/g, ' ')})` : template.assignment?.mode}</p>
              <p>Location: {template.location?.scope}{template.location?.target ? ` · ${template.location.target}` : ''}</p>
              <p>Schedule: {template.schedule?.kind === 'recurring' ? `Recurring · ${template.schedule.frequency}` : `One time · ${template.schedule?.date || ''}`}</p>
              <p>Priority: {template.priority} · Duration: {template.duration_minutes ? `${template.duration_minutes}m` : '—'}</p>
            </div>
          </section>

          {/* Checklist */}
          {!!template.checklist?.length && (
            <section>
              <h3 className="text-[11px] font-semibold text-[#8C867C] uppercase tracking-wider mb-2">Checklist</h3>
              <ul className="space-y-1">
                {template.checklist.map((c, i) => (
                  <li key={i} className="flex items-center gap-2 text-[13px] text-[#35322E]">
                    <span className={`w-1.5 h-1.5 rounded-full ${c.required ? 'bg-[#386641]' : 'bg-[#C8C1B4]'}`} />
                    {c.title}
                    {!c.required && <span className="text-[10px] text-[#A59F95]">(optional)</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Generated work */}
          <section>
            <h3 className="text-[11px] font-semibold text-[#8C867C] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3" /> Generated Work
            </h3>
            {allWork.length === 0 ? (
              <p className="text-xs text-[#A59F95] py-3">Nothing generated yet.</p>
            ) : (
              <div className="space-y-1.5">
                {allWork.slice(0, 30).map((w) => (
                  <div key={w.number} className="flex items-center gap-2.5 px-3 py-2 bg-[#FAF8F5] border border-[#EAE5DC] rounded-[9px]">
                    <span className="font-mono text-xs font-semibold text-[#24221F]">{w.number}</span>
                    <span className="flex-1 text-xs text-[#58534C] truncate">{w.title}</span>
                    <span className="text-[10px] text-[#8C867C]">{w.assignee || 'unassigned'}</span>
                    <Badge size="sm" variant={['completed', 'closed', 'resolved'].includes(w.status) ? 'sage' : w.status === 'overdue' ? 'red' : 'orange'}>
                      {w.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default TemplateDetailDrawer;
