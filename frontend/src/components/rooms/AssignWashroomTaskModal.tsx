import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { fixtureMeta, isCustomKind } from '../../lib/washroomFixtures';
import { TaskPriority, WashroomFixture } from '../../types';

interface AssignWashroomTaskModalProps {
  washroomName: string;
  washroomUid: string | null;
  fixtures: WashroomFixture[];
  /** Pre-selected fixture when opened from a fixture menu — null = whole washroom */
  presetFixture: WashroomFixture | null;
  /** Multi-select mode — one task is created per selected fixture */
  presetFixtures?: WashroomFixture[];
  /** Called after tasks are successfully created */
  onSuccess?: () => void;
  onClose: () => void;
}

const TASK_TYPES = ['Cleaning', 'Inspection', 'Repair', 'Restocking', 'Other'];
const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

const inputCls =
  'w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]';
const labelCls =
  'block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body';

export const AssignWashroomTaskModal: React.FC<AssignWashroomTaskModalProps> = ({
  washroomName,
  washroomUid,
  fixtures,
  presetFixture,
  presetFixtures,
  onSuccess,
  onClose,
}) => {
  const { createTask, currentPropertyEmployees, addToast } = useApp();
  const bulkTargets =
    presetFixtures && presetFixtures.length > 1 ? presetFixtures : null;

  const [scope, setScope] = useState<'washroom' | 'fixture'>(
    presetFixture || bulkTargets ? 'fixture' : 'washroom'
  );
  const [fixtureId, setFixtureId] = useState<string>(
    presetFixture?.fixture_uid ?? fixtures[0]?.fixture_uid ?? ''
  );
  const [taskType, setTaskType] = useState('Cleaning');
  const [employeeUid, setEmployeeUid] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedFixture = fixtures.find((f) => f.fixture_uid === fixtureId) || null;
  const targetFixtures = bulkTargets ?? (selectedFixture ? [selectedFixture] : []);
  const canSubmit =
    washroomUid !== null && (scope === 'washroom' || targetFixtures.length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const targets = scope === 'washroom' ? [null] : targetFixtures;
      const scopeLabel = bulkTargets
        ? `${bulkTargets.length} fixtures`
        : selectedFixture?.label ?? 'Entire washroom';
      for (const f of targets) {
        await createTask({
          title: `${taskType} — ${washroomName}${f ? ` (${f.label})` : ''}`,
          task_type: 'fixed',
          washroom_uid: washroomUid,
          washroom_fixture_uid: f?.fixture_uid,
          employee_uid: employeeUid || undefined,
          priority,
          due_date: dueDate || undefined,
          description:
            [
              `Scope: ${f?.label ?? scopeLabel}`,
              notes.trim() || null,
            ]
              .filter(Boolean)
              .join('\n'),
        });
      }
      addToast({
        type: 'success',
        title: 'Task Assigned',
        description: `${taskType} on ${scopeLabel.toLowerCase()} scheduled.`,
      });
      onSuccess?.();
      onClose();
    } catch {
      // toast handled by context
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Assign Task"
      description={`${washroomName} — cleaning, inspection or restocking work`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Task scope */}
        <div>
          <label className={labelCls}>Task Scope</label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { v: 'washroom', label: 'Entire Washroom' },
                { v: 'fixture', label: 'Specific Fixture' },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setScope(o.v)}
                className={`px-3 py-2 rounded-[10px] border text-sm font-medium transition-colors cursor-pointer ${
                  scope === o.v
                    ? 'border-[#386641] bg-[#EBF3EC] text-[#244E2C]'
                    : 'border-[#DDD7CB] bg-[#FAF8F5] text-[#555047] hover:border-[#B9B2A4]'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {scope === 'fixture' &&
          (bulkTargets ? (
            <div>
              <label className={labelCls}>Selected Fixtures</label>
              <div className="px-3.5 py-2 bg-[#EBF3EC] border border-[#CBE0CF] rounded-[10px] text-sm font-medium text-[#244E2C]">
                {bulkTargets.length} fixtures —{' '}
                {bulkTargets.map((f) => f.label).join(', ')}
              </div>
              <p className="text-[10px] text-[#8C867C] mt-1">
                One task is created for each selected fixture.
              </p>
            </div>
          ) : (
            <div>
              <label className={labelCls}>Select Fixture</label>
              <select
                value={fixtureId}
                onChange={(e) => setFixtureId(e.target.value)}
                className={inputCls}
              >
                {fixtures.map((f) => {
                  const meta = fixtureMeta(f.fixture_type, isCustomKind(f.fixture_type));
                  return (
                    <option key={f.fixture_uid} value={f.fixture_uid}>
                      {f.label} — {meta.plural}
                    </option>
                  );
                })}
              </select>
            </div>
          ))}

        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label className={labelCls}>Task Type</label>
            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value)}
              className={inputCls}
            >
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className={inputCls}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p} className="capitalize">
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label className={labelCls}>Assign To</label>
            <select
              value={employeeUid}
              onChange={(e) => setEmployeeUid(e.target.value)}
              className={inputCls}
            >
              <option value="">(Unassigned)</option>
              {currentPropertyEmployees.map((emp) => (
                <option key={emp.employee_uid} value={emp.employee_uid}>
                  {emp.name} — {emp.job_title || emp.department}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Notes</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Cleaning instructions, supplies needed..."
            className={inputCls}
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#F0ECE4]">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit} isLoading={isSubmitting}>
            Assign Task
          </Button>
        </div>
      </form>
    </Modal>
  );
};
