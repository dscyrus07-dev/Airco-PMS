import React, { useEffect, useState } from 'react';
import {
  Building,
  Layers,
  Users,
  BedDouble,
  Settings,
  LogOut,
  User,
  CheckSquare,
  Wrench,
  Menu,
  X,
  ChevronRight,
  ArrowLeft,
  Building2,
  Clock,
  LayoutTemplate,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getInitials } from '../../lib/utils';

/** Live clock pinned to Indian Standard Time, 12-hour format. */
const ISTClock: React.FC = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(now);
  return (
    <div
      className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-[9px] bg-[#F7F5F0] border border-[#EAE5DC] text-[#58534C]"
      title="Indian Standard Time"
    >
      <Clock className="w-3.5 h-3.5 text-[#386641]" />
      <span className="text-[12.5px] font-semibold tabular-nums tracking-tight">
        {time.replace(/\s+/g, ' ')}
      </span>
      <span className="text-[10px] font-medium text-[#8C867C]">IST</span>
    </div>
  );
};

export const Header: React.FC = () => {
  const {
    currentUser,
    currentRole,
    activeProperty,
    activePropertyUid,
    currentPath,
    navigate,
    logout,
  } = useApp();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Check if viewing within a property scope
  const isInsideProperty =
    currentPath.startsWith('/property/') ||
    (currentRole === 'property_manager' && !currentPath.startsWith('/login') && !currentPath.startsWith('/signup'));

  const isSuperAdminInsideProperty = currentRole === 'super_admin' && isInsideProperty;

  // Navigation Items per role / context
  let navItems: { label: string; path: string; icon: React.ReactNode }[] = [];

  if (currentRole === 'employee') {
    navItems = [
      { label: 'My Tasks', path: '/employee/tasks', icon: <CheckSquare className="w-4 h-4" /> },
      { label: 'Profile', path: '/employee/profile', icon: <User className="w-4 h-4" /> },
    ];
  } else if (isInsideProperty) {
    // Property Manager OR Super Admin inside property
    navItems = [
      { label: 'Zones', path: `/property/${activePropertyUid}/zones`, icon: <Layers className="w-4 h-4" /> },
      { label: 'Employees', path: `/property/${activePropertyUid}/employees`, icon: <Users className="w-4 h-4" /> },
      { label: 'Rooms', path: `/property/${activePropertyUid}/rooms`, icon: <BedDouble className="w-4 h-4" /> },
      { label: 'Tasks', path: `/property/${activePropertyUid}/tasks`, icon: <CheckSquare className="w-4 h-4" /> },
      { label: 'Templates', path: `/property/${activePropertyUid}/templates`, icon: <LayoutTemplate className="w-4 h-4" /> },
      { label: 'Maintenance', path: `/property/${activePropertyUid}/maintenance`, icon: <Wrench className="w-4 h-4" /> },
      { label: 'Profile', path: `/property/${activePropertyUid}/profile`, icon: <User className="w-4 h-4" /> },
    ];
  } else {
    // Super Admin top-level view
    navItems = [
      { label: 'Properties', path: '/admin/properties', icon: <Building className="w-4 h-4" /> },
      { label: 'Employees', path: '/admin/employees', icon: <Users className="w-4 h-4" /> },
      { label: 'Settings', path: '/admin/settings', icon: <Settings className="w-4 h-4" /> },
    ];
  }

  const handleNavClick = (path: string) => {
    navigate(path);
    setMobileMenuOpen(false);
  };

  return (
    <header className="bg-[#FFFFFF] border-b border-[#EAE5DC] sticky top-0 z-40">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand & Property Context */}
          <div className="flex items-center gap-3">
            {isSuperAdminInsideProperty && (
              <button
                onClick={() => navigate('/admin/properties')}
                className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-[#6C675F] hover:text-[#24221F] bg-[#F5F2EB] hover:bg-[#EAE5DC] px-2.5 py-1.5 rounded-[8px] transition-colors cursor-pointer mr-1"
                title="Back to All Properties"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>All Properties</span>
              </button>
            )}

            <div
              className="flex items-center gap-2 cursor-pointer select-none"
              onClick={() => {
                if (currentRole === 'super_admin') navigate('/admin/properties');
                else if (currentRole === 'property_manager') navigate(`/property/${activePropertyUid}/zones`);
                else navigate('/employee/tasks');
              }}
            >
              <div className="w-8 h-8 rounded-[10px] bg-[#386641] flex items-center justify-center text-white font-display font-bold text-sm tracking-tight shadow-xs">
                MT
              </div>
              <div className="flex flex-col">
                <span className="font-display font-bold text-[16px] text-[#24221F] leading-tight tracking-tight">
                  Management Tool
                </span>
                {isInsideProperty && activeProperty && (
                  <span className="text-[11px] font-medium text-[#386641] flex items-center gap-1">
                    <span className="text-[#A59F95] font-normal">|</span>
                    <Building2 className="w-3 h-3 text-[#386641]" />
                    <span className="truncate max-w-[160px] sm:max-w-[220px]">{activeProperty.name}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center space-x-1 lg:space-x-2">
            {navItems.map((item) => {
              const isActive =
                currentPath === item.path ||
                (item.path.includes('/zones') && currentPath.includes('/zones')) ||
                (item.path.includes('/employees') && currentPath.includes('/employees')) ||
                (item.path.includes('/rooms') && currentPath.includes('/rooms')) ||
                (item.path.includes('/profile') && currentPath.includes('/profile')) ||
                (item.path.includes('/maintenance') && currentPath.includes('/maintenance')) ||
                (item.path.includes('/templates') && currentPath.includes('/templates')) ||
                (item.path.includes('/tasks') && currentPath.includes('/tasks'));

              return (
                <button
                  key={item.path}
                  onClick={() => handleNavClick(item.path)}
                  className={`px-3.5 py-1.5 rounded-[10px] text-[13.5px] font-medium transition-all cursor-pointer inline-flex items-center gap-2 ${
                    isActive
                      ? 'bg-[#EBF3EC] text-[#244E2C] font-semibold border border-[#CEE4D1]'
                      : 'text-[#58534C] hover:text-[#24221F] hover:bg-[#F6F3EE] border border-transparent'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* User Profile & Logout */}
          <div className="hidden md:flex items-center gap-3">
            {currentUser && (
              <div className="flex items-center gap-2.5 pl-3 border-l border-[#EAE5DC]">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shadow-xs"
                  style={{ backgroundColor: currentUser.role === 'super_admin' ? '#24221F' : '#386641' }}
                >
                  {getInitials(currentUser.name)}
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-[13px] font-medium text-[#24221F] leading-tight">
                    {currentUser.name}
                  </span>
                  <span className="text-[11px] text-[#736E65] capitalize">
                    {currentUser.role.replace('_', ' ')}
                  </span>
                </div>
              </div>
            )}

            <button
              onClick={logout}
              className="p-2 text-[#736E65] hover:text-[#B91C1C] hover:bg-[#FDE8E8] rounded-[10px] transition-colors cursor-pointer"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
            <ISTClock />
          </div>

          {/* Mobile Menu Button */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-[8px] text-[#58534C] hover:bg-[#F5F2EB] cursor-pointer"
              aria-label="Toggle navigation"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[#EAE5DC] bg-[#FFFFFF] px-4 pt-3 pb-5 space-y-2 animate-in slide-in-from-top-2">
          {isSuperAdminInsideProperty && (
            <button
              onClick={() => {
                navigate('/admin/properties');
                setMobileMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-[#386641] bg-[#EBF3EC] rounded-[10px] mb-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to All Properties</span>
            </button>
          )}

          {navItems.map((item) => (
            <button
              key={item.path}
              onClick={() => handleNavClick(item.path)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-[10px] text-sm font-medium text-[#35322E] hover:bg-[#F5F2EB] text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                {item.icon}
                <span>{item.label}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-[#A59F95]" />
            </button>
          ))}

          <div className="pt-3 border-t border-[#F0ECE4] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#386641] text-white flex items-center justify-center text-xs font-semibold">
                {getInitials(currentUser?.name || 'User')}
              </div>
              <div>
                <p className="text-xs font-semibold text-[#24221F]">{currentUser?.name}</p>
                <p className="text-[11px] text-[#78736A] capitalize">{currentUser?.role.replace('_', ' ')}</p>
              </div>
            </div>
            <button
              onClick={() => {
                logout();
                setMobileMenuOpen(false);
              }}
              className="p-2 text-[#A82828] hover:bg-[#FDE8E8] rounded-lg transition-colors cursor-pointer"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
