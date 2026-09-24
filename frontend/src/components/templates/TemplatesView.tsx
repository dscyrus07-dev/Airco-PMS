import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  LayoutTemplate,
  MapPin,
  Users,
  RefreshCw,
  Clock,
  Pause,
  Play,
  Copy,
  Archive,
  Eye,
  Pencil,
  Trash2,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import * as templatesApi from '../../api/templates';
import { WorkTemplate } from '../../api/types';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { TemplateWizard } from './TemplateWizard';
import { TemplateDetailDrawer } from './TemplateDetailDrawer';

const TYPE_LABELS: Record<string, string> = {
  task: 'Task', maintenance: 'Maintenance', inspection: 'Inspection',
  cleaning: 'Cleaning', checklist: 'Checklist', other: 'Other',
};

const STATUS_VARIANT: Record<string, 'sage' | 'orange' | 'neutral' | 'red'> = {
  active: 'sage', paused: 'orange', draft: 'neutral', archived: 'red',
};

function locationLabel(t: WorkTemplate): string {
  const loc = t.location || {};
  switch (loc.scope) {
    case 'zone': {
      const tgt = { rooms: 'All rooms', dorms: 'All dorms', beds: 'All beds', units: 'All units' }[loc.target || 'units'] || 'Zone';
      return `Zone · ${tgt}`;
    }
    case 'area': return 'Area';
    case 'rooms': return `${(loc.room_uids || []).length} room(s)`;
    case 'dorms': return `${(loc.dorm_uids || []).length} dorm(s)`;
    case 'beds': return `${(loc.bed_uids || []).length} bed(s)`;
    default: return 'Entire property';
  }
}

function assignmentLabel(t: WorkTemplate): string {
  const a = t.assignment || {};
  if (a.mode === 'automatic') return 'Zone Round-Robin';
  if (a.mode === 'individual') return 'Individual';
  if (a.mode === 'team') return `Team · ${a.team || ''}`;
  return 'Unassigned';
}

function scheduleLabel(t: WorkTemplate): string {
  const s = t.schedule || {};
  if (s.kind !== 'recurring') {
    return s.date ? `One time · ${s.date}${s.time ? ` ${s.time}` : ''}` : 'One time';
  }
  const time = s.time ? ` · ${s.time}` : '';
  switch (s.frequency) {
    case 'hourly': return `Every ${s.every || 1}h${s.start_time ? ` ${s.start_time}–${s.window_end || ''}` : ''}`;
    case 'daily': return `Every ${(s.every || 1) > 1 ? `${s.every} days` : 'day'}${time}`;
    case 'weekly': {
      const days = (s.weekdays || []).map((d) => 'MTWTFSS'[d] ?? '').join('');
      return `Weekly${days ? ` · ${days}` : ''}${time}`;
    }
    case 'monthly': return `Monthly${s.day_of_month ? ` · day ${s.day_of_month}` : s.relative_week ? ` · ${s.relative_week}` : ''}${time}`;
    case 'custom': return `Every ${s.every || 1} ${s.custom_unit || 'days'}`;
    default: return 'Recurring';
  }
}

function nextRunLabel(t: WorkTemplate): string {
  if (!t.next_run_at) return 'Not scheduled';
  const d = new Date(t.next_run_at);
  const diff = d.getTime() - Date.now();
  const days = Math.floor(diff / 86400000);
  const when =
    diff < 0 ? 'Due now'
    : diff < 3600000 ? `in ${Math.max(1, Math.round(diff / 60000))} min`
    : diff < 86400000 ? `today ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
    : days === 0 ? `tomorrow ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `Next run: ${when}`;
}

export const TemplatesView: React.FC = () => {
  const { activePropertyUid, addToast } = useApp();
  const [items, setItems] = useState<WorkTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<WorkTemplate | null>(null);
  const [detail, setDetail] = useState<WorkTemplate | null>(null);

  const load = useCallback(async () => {
    if (!activePropertyUid) return;
    try {
      const res = await templatesApi.listTemplates({ property_uid: activePropertyUid });
      setItems(res.items);
    } catch {
      addToast({ type: 'error', title: 'Could not load templates' });
    } finally {
      setLoading(false);
    }
  }, [activePropertyUid, addToast]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () =>
      items.filter((t) => {
        if (statusFilter && t.status !== statusFilter) return false;
        if (typeFilter && t.template_type !== typeFilter) return false;
        if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [items, statusFilter, typeFilter, search]
  );

  const act = async (t: WorkTemplate, action: 'pause' | 'resume' | 'activate' | 'archive' | 'duplicate') => {
    try {
      await templatesApi.templateAction(t.template_uid, action);
      addToast({ type: 'success', title: `Template ${action === 'resume' || action === 'activate' ? 'activated' : action + 'd'}` });
      await load();
    } catch (err) {
      addToast({ type: 'error', title: 'Action failed', description: err instanceof Error ? err.message : '' });
    }
  };

  const remove = async (t: WorkTemplate) => {
    try {
      await templatesApi.deleteTemplate(t.template_uid);
      addToast({ type: 'success', title: 'Template deleted' });
      await load();
    } catch (err) {
      addToast({ type: 'error', title: 'Delete failed', description: err instanceof Error ? err.message : 'Pause or archive it first.' });
    }
  };

  const upsert = (t: WorkTemplate) => {
    setItems((prev) => {
      const i = prev.findIndex((x) => x.template_uid === t.template_uid);
      if (i === -1) return [t, ...prev];
      const next = [...prev];
      next[i] = t;
      return next;
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#24221F] tracking-tight flex items-center gap-2.5">
            Work Templates
            <span className="text-xs font-semibold text-[#8C867C] bg-[#F0EDE6] px-2 py-0.5 rounded-full">
              {items.length}
            </span>
          </h1>
          <p className="text-sm text-[#8C867C] mt-0.5">
            Reusable operational definitions — the scheduler generates real work from them automatically.
          </p>
        </div>
        <Button variant="primary" onClick={() => { setEditTemplate(null); setWizardOpen(true); }}>
          <Plus className="w-4 h-4" /> Create Template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A59F95]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-[#E2DCD0] rounded-[10px] focus:outline-none focus:ring-[3px] focus:ring-[#386641]/15 focus:border-[#386641]"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-white border border-[#E2DCD0] rounded-[10px] cursor-pointer"
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <div className="flex items-center gap-1 bg-[#F0EDE6] rounded-[10px] p-1">
          {['', 'active', 'paused', 'draft', 'archived'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-[8px] transition-colors cursor-pointer ${
                statusFilter === s ? 'bg-white text-[#24221F] shadow-sm' : 'text-[#6C675F] hover:text-[#24221F]'
              }`}
            >
              {s === '' ? 'All' : s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Cards */}
      {loading ? (
        <p className="text-sm text-[#8C867C] py-12 text-center">Loading templates…</p>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <LayoutTemplate className="w-10 h-10 text-[#D5CFC3] mx-auto mb-3" />
          <p className="text-sm font-medium text-[#6C675F]">No templates yet</p>
          <p className="text-xs text-[#8C867C] mt-1">
            Create a template once — the scheduler generates the actual work automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <div
              key={t.template_uid}
              className="bg-white rounded-[14px] border border-[#EAE5DC] p-4.5 p-4 flex flex-col gap-3 hover:border-[#D5CFC3] hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-[15px] text-[#24221F] truncate">{t.name}</p>
                  <p className="text-xs text-[#8C867C] mt-0.5">
                    {TYPE_LABELS[t.template_type] || t.template_type}
                    {t.category ? ` · ${t.category}` : ''} · v{t.version}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[t.status] || 'gray'} size="sm">
                  {t.status}
                </Badge>
              </div>

              <div className="space-y-1.5 text-[12.5px] text-[#58534C]">
                <p className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-[#A59F95]" /> {locationLabel(t)}
                </p>
                <p className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-[#A59F95]" /> {assignmentLabel(t)}
                </p>
                <p className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-[#A59F95]" /> {scheduleLabel(t)}
                </p>
                <p className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-[#A59F95]" />
                  {t.status === 'active' ? nextRunLabel(t) : `${t.generated_count} generated`}
                </p>
              </div>

              <div className="flex items-center gap-1.5 pt-2 border-t border-[#F0ECE4] mt-auto">
                <button
                  onClick={() => setDetail(t)}
                  className="px-2.5 py-1.5 text-xs font-medium text-[#386641] hover:bg-[#EBF3EC] rounded-[8px] inline-flex items-center gap-1 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" /> View
                </button>
                <button
                  onClick={() => { setEditTemplate(t); setWizardOpen(true); }}
                  className="px-2.5 py-1.5 text-xs font-medium text-[#58534C] hover:bg-[#F5F2EB] rounded-[8px] inline-flex items-center gap-1 cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                <div className="flex-1" />
                {t.status === 'active' && (
                  <button onClick={() => void act(t, 'pause')} title="Pause"
                    className="p-1.5 text-[#8C867C] hover:text-[#B45309] hover:bg-[#FDF6EC] rounded-[8px] cursor-pointer">
                    <Pause className="w-3.5 h-3.5" />
                  </button>
                )}
                {(t.status === 'paused' || t.status === 'draft') && (
                  <button onClick={() => void act(t, 'activate')} title="Activate"
                    className="p-1.5 text-[#8C867C] hover:text-[#386641] hover:bg-[#EBF3EC] rounded-[8px] cursor-pointer">
                    <Play className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={() => void act(t, 'duplicate')} title="Duplicate"
                  className="p-1.5 text-[#8C867C] hover:text-[#24221F] hover:bg-[#F5F2EB] rounded-[8px] cursor-pointer">
                  <Copy className="w-3.5 h-3.5" />
                </button>
                {t.status !== 'archived' ? (
                  <button onClick={() => void act(t, 'archive')} title="Archive"
                    className="p-1.5 text-[#8C867C] hover:text-[#B91C1C] hover:bg-[#FDE8E8] rounded-[8px] cursor-pointer">
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button onClick={() => void remove(t)} title="Delete"
                    className="p-1.5 text-[#8C867C] hover:text-[#B91C1C] hover:bg-[#FDE8E8] rounded-[8px] cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Wizard */}
      {wizardOpen && (
        <TemplateWizard
          editTemplate={editTemplate}
          onClose={() => setWizardOpen(false)}
          onSaved={(t) => { upsert(t); setWizardOpen(false); }}
        />
      )}

      {/* Detail */}
      {detail && (
        <TemplateDetailDrawer
          template={detail}
          onClose={() => setDetail(null)}
          onChanged={(t) => { upsert(t); setDetail(t); }}
        />
      )}
    </div>
  );
};

export default TemplatesView;
