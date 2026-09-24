import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/navigation/Header';
import { ToastContainer } from './components/ui/ToastContainer';
import { Skeleton } from './components/ui/Skeleton';
import { Card } from './components/ui/Card';
import { Button } from './components/ui/Button';
import { AlertTriangle } from 'lucide-react';
import { LandingPage } from './components/landing/LandingPage';
import { Login } from './components/auth/Login';
import { Signup } from './components/auth/Signup';

// Route-level code splitting — heavy workspace views load on demand,
// so the first screen doesn't wait for the entire bundle.
const PropertiesView = React.lazy(() =>
  import('./components/properties/PropertiesView').then((m) => ({ default: m.PropertiesView }))
);
const ZonesView = React.lazy(() =>
  import('./components/zones/ZonesView').then((m) => ({ default: m.ZonesView }))
);
const RoomsDormsView = React.lazy(() =>
  import('./components/rooms/RoomsDormsView').then((m) => ({ default: m.RoomsDormsView }))
);
const EmployeesView = React.lazy(() =>
  import('./components/employees/EmployeesView').then((m) => ({ default: m.EmployeesView }))
);
const TasksView = React.lazy(() =>
  import('./components/tasks/TasksView').then((m) => ({ default: m.TasksView }))
);
const MaintenanceView = React.lazy(() =>
  import('./components/maintenance/MaintenanceView').then((m) => ({ default: m.MaintenanceView }))
);
const TemplatesView = React.lazy(() =>
  import('./components/templates/TemplatesView').then((m) => ({ default: m.TemplatesView }))
);
const EmployeeTasksView = React.lazy(() =>
  import('./components/employee_views/EmployeeTasksView').then((m) => ({ default: m.EmployeeTasksView }))
);
const ProfileView = React.lazy(() =>
  import('./components/employee_views/ProfileView').then((m) => ({ default: m.ProfileView }))
);
const AdminEmployeesView = React.lazy(() =>
  import('./components/admin/AdminEmployeesView').then((m) => ({ default: m.AdminEmployeesView }))
);
const AdminSettingsView = React.lazy(() =>
  import('./components/admin/AdminSettingsView').then((m) => ({ default: m.AdminSettingsView }))
);

/**
 * Route guard: unauthenticated visitors can never reach internal screens.
 */
const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useApp();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

/**
 * Wraps authenticated screens with workspace data states — loading skeleton
 * while collections load, a retryable error state if the API is unreachable,
 * and the real view otherwise. Never renders fabricated data.
 */
const WorkspaceGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isLoadingData, dataError, retryLoad, properties } = useApp();

  if (dataError) {
    return (
      <Card className="p-10 max-w-lg mx-auto text-center mt-10">
        <div className="w-12 h-12 rounded-full bg-[#FDE8E8] text-[#A32A2A] flex items-center justify-center mx-auto mb-3">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="font-display font-semibold text-lg text-[#24221F]">
          Unable to load workspace data
        </h2>
        <p className="font-body text-sm text-[#6C675F] mt-1.5 mb-5">{dataError}</p>
        <Button variant="primary" onClick={retryLoad}>
          Retry
        </Button>
      </Card>
    );
  }

  if (isLoadingData && properties.length === 0) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-[16px]" />
          ))}
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

/**
 * Handles property-scoped views while ensuring activePropertyUid is synchronized
 */
const PropertyScopedView: React.FC<{
  view: 'zones' | 'rooms' | 'employees' | 'tasks' | 'maintenance' | 'templates';
}> = ({ view }) => {
  const { propertyUid } = useParams<{ propertyUid: string }>();
  const { activePropertyUid, setActivePropertyUid, companyProperties, currentRole, currentUser } =
    useApp();

  useEffect(() => {
    if (propertyUid && propertyUid !== activePropertyUid) {
      if (companyProperties.some((p) => p.property_uid === propertyUid)) {
        setActivePropertyUid(propertyUid);
      }
    }
  }, [propertyUid, activePropertyUid, companyProperties, setActivePropertyUid]);

  if (currentRole === 'employee') {
    return <Navigate to="/employee/tasks" replace />;
  }

  // Property Managers are scoped to their single assigned property
  if (
    currentRole === 'property_manager' &&
    currentUser?.property_uid &&
    propertyUid !== currentUser.property_uid
  ) {
    return <Navigate to={`/property/${currentUser.property_uid}/zones`} replace />;
  }

  // Super Admins cannot open another company's property via URL
  if (
    currentRole === 'super_admin' &&
    propertyUid &&
    companyProperties.length > 0 &&
    !companyProperties.some((p) => p.property_uid === propertyUid)
  ) {
    return <Navigate to="/admin/properties" replace />;
  }

  const viewEl =
    view === 'zones' ? (
      <ZonesView />
    ) : view === 'rooms' ? (
      <RoomsDormsView />
    ) : view === 'tasks' ? (
      <TasksView />
    ) : view === 'maintenance' ? (
      <MaintenanceView />
    ) : view === 'templates' ? (
      <TemplatesView />
    ) : (
      <EmployeesView />
    );
  return <WorkspaceGate>{viewEl}</WorkspaceGate>;
};

/**
 * Restricts a route to specific roles — employees can never reach admin or
 * property-management screens, and managers/admins never see employee views.
 */
const RequireRole: React.FC<{ roles: string[]; children: React.ReactNode }> = ({
  roles,
  children,
}) => {
  const { currentRole, activePropertyUid } = useApp();
  if (!roles.includes(currentRole)) {
    if (currentRole === 'employee') return <Navigate to="/employee/tasks" replace />;
    if (currentRole === 'property_manager')
      return <Navigate to={`/property/${activePropertyUid}/zones`} replace />;
    return <Navigate to="/admin/properties" replace />;
  }
  return <>{children}</>;
};

/**
 * Directs the user to the canonical landing page for their active role
 */
const RootRedirect: React.FC = () => {
  const { currentRole, activePropertyUid, isAuthenticated } = useApp();

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  if (currentRole === 'super_admin') {
    return <Navigate to="/admin/properties" replace />;
  }
  if (currentRole === 'property_manager') {
    return <Navigate to={`/property/${activePropertyUid}/zones`} replace />;
  }
  return <Navigate to="/employee/tasks" replace />;
};

const AppContent: React.FC = () => {
  const { currentPath, isAuthenticated } = useApp();
  const isPublicPage =
    currentPath === '/' || currentPath === '/login' || currentPath === '/signup';

  return (
    <div className="min-h-screen bg-[#F7F4EE] text-[#24221F] font-body flex flex-col selection:bg-[#386641] selection:text-white">
      {/* Main Navigation Header (hidden on public landing/auth pages and when signed out) */}
      {isAuthenticated && !isPublicPage && <Header />}

      {/* Main Content Area — public pages manage their own full-width layout */}
      <main
        className={
          isPublicPage
            ? 'flex-1 w-full'
            : 'flex-1 w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6'
        }
      >
        <React.Suspense
          fallback={
            <div className="flex items-center justify-center py-24">
              <Skeleton className="h-8 w-40" />
            </div>
          }
        >
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* Super Admin company-level routes */}
          <Route path="/admin/properties" element={<RequireAuth><RequireRole roles={['super_admin']}><WorkspaceGate><PropertiesView /></WorkspaceGate></RequireRole></RequireAuth>} />
          <Route path="/admin/employees" element={<RequireAuth><RequireRole roles={['super_admin']}><WorkspaceGate><AdminEmployeesView /></WorkspaceGate></RequireRole></RequireAuth>} />
          <Route path="/admin/settings" element={<RequireAuth><RequireRole roles={['super_admin']}><WorkspaceGate><AdminSettingsView /></WorkspaceGate></RequireRole></RequireAuth>} />

          {/* Property workspace routes (Property Manager & Super Admin inside a property) */}
          <Route path="/property/:propertyUid/zones" element={<RequireAuth><PropertyScopedView view="zones" /></RequireAuth>} />
          <Route path="/property/:propertyUid/employees" element={<RequireAuth><PropertyScopedView view="employees" /></RequireAuth>} />
          <Route path="/property/:propertyUid/rooms" element={<RequireAuth><PropertyScopedView view="rooms" /></RequireAuth>} />
          <Route path="/property/:propertyUid/tasks" element={<RequireAuth><PropertyScopedView view="tasks" /></RequireAuth>} />
          <Route path="/property/:propertyUid/maintenance" element={<RequireAuth><PropertyScopedView view="maintenance" /></RequireAuth>} />
          <Route path="/property/:propertyUid/templates" element={<RequireAuth><PropertyScopedView view="templates" /></RequireAuth>} />
          <Route path="/property/:propertyUid/profile" element={<RequireAuth><WorkspaceGate><ProfileView /></WorkspaceGate></RequireAuth>} />
          <Route path="/property/:propertyUid" element={<RequireAuth><Navigate to="zones" replace /></RequireAuth>} />

          {/* Employee workspace routes */}
          <Route path="/employee/tasks" element={<RequireAuth><RequireRole roles={['employee']}><WorkspaceGate><EmployeeTasksView /></WorkspaceGate></RequireRole></RequireAuth>} />
          <Route path="/employee/profile" element={<RequireAuth><RequireRole roles={['employee']}><WorkspaceGate><ProfileView /></WorkspaceGate></RequireRole></RequireAuth>} />

          {/* Role-based fallback redirects */}
          <Route path="*" element={<RootRedirect />} />
        </Routes>
        </React.Suspense>
      </main>

      {/* Global Toast Notifications Container */}
      <ToastContainer />
    </div>
  );
};

export function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </BrowserRouter>
  );
}

export default App;
