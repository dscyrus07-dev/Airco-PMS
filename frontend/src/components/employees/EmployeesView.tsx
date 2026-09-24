import React, { useState } from 'react';
import { LayoutGrid, List, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { ZoneBoard } from './ZoneBoard';
import { EmployeeDirectory } from './EmployeeDirectory';
import { CreateEmployeeModal } from './CreateEmployeeModal';

// Compact metric pill — quiet statistics, not dashboard cards
const MetricPill: React.FC<{
  value: number;
  label: string;
  tone?: 'default' | 'warn';
}> = ({ value, label, tone = 'default' }) => (
  <div
    className={`flex items-baseline gap-1.5 px-3 py-1.5 rounded-[8px] ${
      tone === 'warn' ? 'bg-[#FFF3E4]' : 'bg-[#F1EEE7]'
    }`}
  >
    <span
      className={`font-display text-lg font-bold leading-none tabular-nums ${
        tone === 'warn' ? 'text-[#C98232]' : 'text-[#17221B]'
      }`}
    >
      {String(value).padStart(2, '0')}
    </span>
    <span
      className={`text-[10px] font-medium uppercase tracking-wider ${
        tone === 'warn' ? 'text-[#C98232]' : 'text-[#8A918C]'
      }`}
    >
      {label}
    </span>
  </div>
);

export const EmployeesView: React.FC = () => {
  const { currentPropertyEmployees, currentPropertyUnallocatedEmployees, activeProperty } =
    useApp();

  const [activeTab, setActiveTab] = useState<'board' | 'directory'>('board');
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const assignedCount = currentPropertyEmployees.length -
    currentPropertyUnallocatedEmployees.length;

  return (
    <div className="space-y-5">
      {/* Header — title hierarchy + primary action */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-[#17221B] tracking-tight leading-tight">
            Property Team & Zone Staffing
          </h1>
          <p className="font-body text-sm text-[#66706A] mt-1">
            Physical zone assignments, staff roster, and team scheduling for{' '}
            <span className="text-[#17221B] font-medium">{activeProperty?.name}</span>
          </p>

          {/* Compact staffing summary */}
          <div className="flex items-center gap-2 mt-3">
            <MetricPill value={currentPropertyEmployees.length} label="Staff" />
            <MetricPill value={assignedCount} label="Assigned" />
            <MetricPill
              value={currentPropertyUnallocatedEmployees.length}
              label="Unallocated"
              tone={currentPropertyUnallocatedEmployees.length > 0 ? 'warn' : 'default'}
            />
          </div>
        </div>

        <Button
          variant="primary"
          onClick={() => setCreateModalOpen(true)}
          className="self-start gap-2 !bg-[#2F6B45] hover:!bg-[#245538] !rounded-[8px]"
        >
          <Plus className="w-4 h-4" />
          <span>Add Staff Member</span>
        </Button>
      </div>

      {/* Segmented control + exception chip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-[10px] bg-[#EDEAE2] w-fit">
          <button
            onClick={() => setActiveTab('board')}
            className={`px-4 py-1.5 rounded-[8px] text-xs font-semibold transition-all duration-150 cursor-pointer inline-flex items-center gap-2 ${
              activeTab === 'board'
                ? 'bg-white text-[#17221B] shadow-[0_1px_2px_rgba(20,30,24,0.10)]'
                : 'text-[#66706A] hover:text-[#17221B]'
            }`}
          >
            <LayoutGrid
              className={`w-3.5 h-3.5 ${activeTab === 'board' ? 'text-[#2F6B45]' : ''}`}
            />
            <span>Zone Board</span>
          </button>
          <button
            onClick={() => setActiveTab('directory')}
            className={`px-4 py-1.5 rounded-[8px] text-xs font-semibold transition-all duration-150 cursor-pointer inline-flex items-center gap-2 ${
              activeTab === 'directory'
                ? 'bg-white text-[#17221B] shadow-[0_1px_2px_rgba(20,30,24,0.10)]'
                : 'text-[#66706A] hover:text-[#17221B]'
            }`}
          >
            <List
              className={`w-3.5 h-3.5 ${activeTab === 'directory' ? 'text-[#2F6B45]' : ''}`}
            />
            <span>Staff Directory</span>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-[5px] ${
                activeTab === 'directory'
                  ? 'bg-[#E7F0E9] text-[#2F6B45]'
                  : 'bg-[#E3DED2] text-[#66706A]'
              }`}
            >
              {currentPropertyEmployees.length}
            </span>
          </button>
        </div>

        {currentPropertyUnallocatedEmployees.length > 0 && (
          <div className="text-[11px] font-medium text-[#C98232] bg-[#FFF3E4] px-2.5 py-1 rounded-[8px] inline-flex items-center gap-1.5 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-[#C98232]" />
            <span>
              {currentPropertyUnallocatedEmployees.length} staff unallocated to physical zones
            </span>
          </div>
        )}
      </div>

      {/* Tab Views */}
      {activeTab === 'board' ? (
        <ZoneBoard onOpenCreateModal={() => setCreateModalOpen(true)} />
      ) : (
        <EmployeeDirectory />
      )}

      {/* Add Employee Modal */}
      <CreateEmployeeModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />
    </div>
  );
};
