import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  ReactNode,
  useCallback,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Area,
  AuthUser,
  BedStatus,
  Company,
  Dorm,
  Employee,
  MaintenancePriority,
  MaintenanceTicket,
  Property,
  Room,
  RoomStatus,
  Task,
  TaskStatus,
  UserRole,
  Zone,
} from '../types';
import { generateId } from '../lib/utils';
import { can } from '../lib/permissions';
import { ApiError, setUnauthorizedHandler } from '../api/client';
import * as authApi from '../api/auth';
import * as companiesApi from '../api/companies';
import * as propertiesApi from '../api/properties';
import * as areasApi from '../api/areas';
import * as zonesApi from '../api/zones';
import * as roomsApi from '../api/rooms';
import * as dormsApi from '../api/dorms';
import * as employeesApi from '../api/employees';
import * as tasksApi from '../api/tasks';
import * as maintenanceApi from '../api/maintenance';
import * as mediaApi from '../api/media';
import {
  EmployeeCreateRequest,
  PropertyCreateRequest,
  RegisterCompanyRequest,
  RoomCreateRequest,
  RoomBulkCreateRequest,
  TaskCreateRequest,
  TaskUpdateRequest,
  DormCreateRequest,
  ZoneCreateRequest,
  AreaCreateRequest,
  AreaUpdateRequest,
  ZoneUpdateRequest,
  RoomUpdateRequest,
  DormUpdateRequest,
  EmployeeUpdateRequest,
  PropertyUpdateRequest,
} from '../api/types';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  description?: string;
}

interface AppContextType {
  // Auth & Role
  currentUser: AuthUser | null;
  currentRole: UserRole;
  activePropertyUid: string;
  activeProperty: Property | undefined;
  isAuthenticated: boolean;

  // Server-data state
  isLoadingData: boolean;
  dataError: string | null;
  retryLoad: () => void;

  // Navigation
  currentPath: string;
  openedZoneUid: string | null;
  employeesTab: 'board' | 'directory';
  roomsTab: 'rooms' | 'dorms';
  setOpenedZoneUid: (zoneUid: string | null) => void;
  setEmployeesTab: (tab: 'board' | 'directory') => void;
  setRoomsTab: (tab: 'rooms' | 'dorms') => void;
  navigate: (path: string, options?: { zoneUid?: string | null }) => void;

  // Auth operations
  signIn: (session: { user: AuthUser; company: Company }) => void;
  logout: () => void;
  registerCompanyAccount: (payload: RegisterCompanyRequest) => Promise<void>;
  setActivePropertyUid: (uid: string) => void;
  updateProfile: (updates: { name?: string; phone?: string; email?: string }) => Promise<void>;
  updateCompanyDetails: (updates: {
    name?: string;
    legal_name?: string;
    brand_name?: string;
    email?: string;
    phone?: string;
    address?: string;
    pin_code?: string;
  }) => Promise<void>;

  // Normalized Data (server state)
  company: Company | null;
  properties: Property[];
  companyProperties: Property[];
  areas: Area[];
  zones: Zone[];
  rooms: Room[];
  dorms: Dorm[];
  employees: Employee[];
  tasks: Task[];
  maintenanceTickets: MaintenanceTicket[];

  // Computed collections scoped to active property
  currentPropertyAreas: Area[];
  currentPropertyZones: Zone[];
  currentPropertyRooms: Room[];
  currentPropertyDorms: Dorm[];
  currentPropertyEmployees: Employee[];
  currentPropertyUnallocatedEmployees: Employee[];
  currentPropertyTasks: Task[];
  currentPropertyMaintenance: MaintenanceTicket[];
  currentEmployeeTasks: Task[];
  currentEmployeeMaintenance: MaintenanceTicket[];

  // Property Operations
  createProperty: (data: PropertyCreateRequest) => Promise<Property>;
  updateProperty: (property_uid: string, updates: PropertyUpdateRequest) => Promise<void>;
  deleteProperty: (property_uid: string) => Promise<void>;

  // Area Operations
  createArea: (data: Omit<AreaCreateRequest, 'property_uid'>) => Promise<Area>;
  updateArea: (area_uid: string, updates: AreaUpdateRequest) => Promise<void>;
  deleteArea: (area_uid: string) => Promise<void>;

  // Zone Operations
  createZone: (data: Omit<ZoneCreateRequest, 'property_uid'>) => Promise<Zone>;
  updateZone: (zone_uid: string, updates: ZoneUpdateRequest) => Promise<void>;
  deleteZone: (zone_uid: string) => Promise<void>;

  // Room Operations
  createRoom: (data: Omit<RoomCreateRequest, 'property_uid'>) => Promise<Room>;
  bulkCreateRooms: (
    data: Omit<RoomBulkCreateRequest, 'property_uid'>
  ) => Promise<{ createdCount: number; errors: string[] }>;
  updateRoom: (room_uid: string, updates: RoomUpdateRequest) => Promise<void>;
  moveRoomToZone: (room_uid: string, zone_uid: string | null) => Promise<void>;
  deleteRoom: (room_uid: string) => Promise<void>;
  bulkDeleteRooms: (roomUids: string[]) => Promise<void>;

  // Dorm & Bed Operations
  createDorm: (data: Omit<DormCreateRequest, 'property_uid'>) => Promise<Dorm>;
  updateDorm: (dorm_uid: string, updates: DormUpdateRequest) => Promise<void>;
  moveDormToZone: (dorm_uid: string, zone_uid: string | null) => Promise<void>;
  deleteDorm: (dorm_uid: string) => Promise<void>;
  updateBedStatus: (bed_uid: string, status: BedStatus, guest_name?: string) => Promise<void>;
  checkoutDorm: (dorm_uid: string) => Promise<void>;
  markDormCleaning: (dorm_uid: string) => Promise<void>;

  // Multi-Unit Selection & Bulk Actions (Cleaning & Checkout)
  bulkUpdateUnits: (options: {
    action: 'checkout' | 'cleaning' | 'available' | 'maintenance';
    roomUids?: string[];
    bedUids?: string[];
  }) => Promise<void>;
  bulkCheckoutRooms: (roomUids: string[]) => Promise<void>;
  bulkCleanRooms: (roomUids: string[], targetStatus?: RoomStatus) => Promise<void>;
  bulkCheckoutBeds: (bedUids: string[]) => Promise<void>;
  bulkCleanBeds: (bedUids: string[], targetStatus?: BedStatus) => Promise<void>;

  // Employee Operations
  employeeRecord: Employee | undefined;
  createEmployee: (data: Omit<EmployeeCreateRequest, 'property_uid'>) => Promise<Employee>;
  updateEmployee: (employee_uid: string, updates: EmployeeUpdateRequest) => Promise<void>;
  moveEmployeeToZone: (employee_uid: string, zone_uid: string | null) => Promise<void>;
  assignEmployeeToZone: (employee_uid: string, zone_uid: string | null) => Promise<void>;
  /** Assign to a whole area — the employee is eligible for work in every zone inside it */
  assignEmployeeToArea: (employee_uid: string, area_uid: string | null) => Promise<void>;
  deleteEmployee: (employee_uid: string) => Promise<void>;
  deactivateEmployee: (employee_uid: string) => Promise<void>;

  // Room and Dorm Helper Aliases
  updateRoomStatus: (room_uid: string, status: RoomStatus) => Promise<void>;
  assignRoomToZone: (room_uid: string, zone_uid: string | null) => Promise<void>;
  assignDormToZone: (dorm_uid: string, zone_uid: string | null) => Promise<void>;

  // Task Operations
  createTask: (data: Omit<TaskCreateRequest, 'property_uid'>) => Promise<Task>;
  updateTask: (task_uid: string, updates: TaskUpdateRequest) => Promise<void>;
  deleteTask: (task_uid: string) => Promise<void>;
  startTask: (task_uid: string) => Promise<void>;
  completeTask: (task_uid: string, photos: File[], note?: string) => Promise<void>;
  requestTaskRedo: (task_uid: string, note?: string) => Promise<void>;
  reassignTask: (task_uid: string, employee_uid: string | null) => Promise<void>;
  updateTaskStatus: (task_uid: string, status: TaskStatus) => Promise<void>;
  submitTask: (task_uid: string, note: string | undefined, photo_urls: string[]) => Promise<void>;
  approveTask: (task_uid: string, note?: string) => Promise<void>;
  rejectTask: (task_uid: string, reason: string) => Promise<void>;
  reopenTask: (task_uid: string, note?: string) => Promise<void>;

  // Maintenance ticket operations
  createMaintenanceTicket: (
    data: Omit<import('../api/types').MaintenanceCreateRequest, 'property_uid'>
  ) => Promise<MaintenanceTicket>;
  /** Grouped creation — one POST, backend zone-round-robin allocation. */
  createMaintenanceBatch: (
    tickets: Omit<import('../api/types').WorkBatchTicketIn, 'kind'>[]
  ) => Promise<import('../api/types').WorkBatch[]>;
  assignMaintenanceTicket: (ticket_uid: string, employee_uid: string | null) => Promise<void>;
  startMaintenanceTicket: (ticket_uid: string) => Promise<void>;
  holdMaintenanceTicket: (ticket_uid: string, note?: string) => Promise<void>;
  resolveMaintenanceTicket: (ticket_uid: string, notes: string, photo_urls: string[]) => Promise<void>;
  closeMaintenanceTicket: (ticket_uid: string) => Promise<void>;
  disapproveMaintenanceTicket: (ticket_uid: string, reason: string) => Promise<void>;
  updateMaintenanceTicket: (
    ticket_uid: string,
    updates: import('../api/types').MaintenanceUpdateRequest
  ) => Promise<void>;

  // UI Toast notifications
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;

  // Permissions helper
  canDo: (action: any, resource: any, context?: any) => boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const apiErrorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // -------------------------------------------------------------------
  // Auth & session
  // -------------------------------------------------------------------
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [activePropertyUid, setActivePropertyUid] = useState<string>('');

  // -------------------------------------------------------------------
  // Server state — populated exclusively by the API layer
  // -------------------------------------------------------------------
  const [properties, setProperties] = useState<Property[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [dorms, setDorms] = useState<Dorm[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [maintenanceTickets, setMaintenanceTickets] = useState<MaintenanceTicket[]>([]);

  const [isLoadingData, setIsLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Navigation state driven by react-router-dom
  const location = useLocation();
  const routerNavigate = useNavigate();
  const currentPath = location.pathname;

  const [openedZoneUid, setOpenedZoneUid] = useState<string | null>(null);
  const [employeesTab, setEmployeesTab] = useState<'board' | 'directory'>('board');
  const [roomsTab, setRoomsTab] = useState<'rooms' | 'dorms'>('rooms');

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = generateId('toast');
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // -------------------------------------------------------------------
  // Workspace loading — pulls every collection the UI depends on.
  // All list calls are scoped server-side by the caller's company/role.
  // -------------------------------------------------------------------
  const loadWorkspace = useCallback(async () => {
    setIsLoadingData(true);
    setDataError(null);
    try {
      const [propertiesRes, areasRes, zonesRes, roomsRes, dormsRes, employeesRes, tasksRes, maintenanceRes] =
        await Promise.all([
          propertiesApi.listProperties(),
          areasApi.listAreas(),
          zonesApi.listZones(),
          roomsApi.listRooms(),
          dormsApi.listDorms(),
          employeesApi.listEmployees(),
          tasksApi.listTasks(),
          maintenanceApi.listMaintenance(),
        ]);
      setProperties(propertiesRes.items);
      setAreas(areasRes.items);
      setZones(zonesRes.items);
      setRooms(roomsRes.items);
      setDorms(dormsRes.items);
      setEmployees(employeesRes.items);
      setTasks(tasksRes.items);
      setMaintenanceTickets(maintenanceRes.items);
    } catch (err) {
      setDataError(apiErrorMessage(err, 'Unable to load workspace data. Please try again.'));
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  const retryLoad = useCallback(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  // Approving/rejecting/reopening work re-derives unit statuses server-side
  // (bed released to available, room back to cleaning, ...) — the local
  // rooms/dorms lists must be re-pulled or the UI shows stale states.
  const refreshUnits = useCallback(() => {
    void roomsApi.listRooms().then((r) => setRooms(r.items)).catch(() => {});
    void dormsApi.listDorms().then((d) => setDorms(d.items)).catch(() => {});
  }, []);

  // -------------------------------------------------------------------
  // Session bootstrap: token present → GET /auth/me → load workspace
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const { user, company: userCompany } = await authApi.me();
        if (cancelled) return;
        setCurrentUser(user);
        setCompany(userCompany);
        if (user.property_uid) setActivePropertyUid(user.property_uid);
        await loadWorkspace();
      } catch {
        // No/invalid session — stay on the public routes
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [loadWorkspace]);

  // Session expiry: API client fires this on any 401
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCurrentUser(null);
      setCompany(null);
      routerNavigate('/login');
    });
    return () => setUnauthorizedHandler(null);
  }, [routerNavigate]);

  const currentRole: UserRole = currentUser?.role || 'super_admin';
  const isAuthenticated = !!currentUser;

  // -------------------------------------------------------------------
  // Derived collections
  // -------------------------------------------------------------------
  const activeProperty = useMemo(
    () => properties.find((p) => p.property_uid === activePropertyUid),
    [properties, activePropertyUid]
  );

  const companyProperties = useMemo(
    () => properties.filter((p) => !company || p.company_uid === company.company_uid),
    [properties, company]
  );

  const currentPropertyAreas = useMemo(
    () =>
      areas
        .filter((a) => a.property_uid === activePropertyUid)
        .sort((a, b) => a.level_number - b.level_number),
    [areas, activePropertyUid]
  );

  const currentPropertyZones = useMemo(
    () => zones.filter((z) => z.property_uid === activePropertyUid),
    [zones, activePropertyUid]
  );

  const currentPropertyRooms = useMemo(
    () => rooms.filter((r) => r.property_uid === activePropertyUid),
    [rooms, activePropertyUid]
  );

  const currentPropertyDorms = useMemo(
    () => dorms.filter((d) => d.property_uid === activePropertyUid),
    [dorms, activePropertyUid]
  );

  const currentPropertyEmployees = useMemo(
    () => employees.filter((e) => e.property_uid === activePropertyUid),
    [employees, activePropertyUid]
  );

  const currentPropertyUnallocatedEmployees = useMemo(
    () => currentPropertyEmployees.filter((e) => !e.zone_uid && !e.area_uid),
    [currentPropertyEmployees]
  );

  const currentPropertyTasks = useMemo(
    () => tasks.filter((t) => t.property_uid === activePropertyUid),
    [tasks, activePropertyUid]
  );

  const currentPropertyMaintenance = useMemo(
    () => maintenanceTickets.filter((t) => t.property_uid === activePropertyUid),
    [maintenanceTickets, activePropertyUid]
  );

  const currentEmployeeTasks = useMemo(() => {
    const uid = currentUser?.employee_uid;
    if (!uid) return [];
    return tasks.filter((t) => t.employee_uid === uid || t.assigned_to_uid === uid);
  }, [tasks, currentUser]);

  const currentEmployeeMaintenance = useMemo(() => {
    const uid = currentUser?.employee_uid;
    if (!uid) return [];
    return maintenanceTickets.filter((t) => t.assigned_to === uid);
  }, [maintenanceTickets, currentUser]);

  // Auto-synchronize active property UID if route has /property/:propertyId/...
  useEffect(() => {
    const match = location.pathname.match(/\/property\/([^/]+)/);
    if (match && match[1]) {
      const propId = match[1];
      if (properties.some((p) => p.property_uid === propId) && propId !== activePropertyUid) {
        setActivePropertyUid(propId);
      }
    }
  }, [location.pathname, properties, activePropertyUid]);

  // Navigate helper calling react-router-dom
  const navigate = useCallback(
    (path: string, options?: { zoneUid?: string | null }) => {
      if (options?.zoneUid !== undefined) {
        setOpenedZoneUid(options.zoneUid);
      }
      routerNavigate(path);
    },
    [routerNavigate]
  );

  // -------------------------------------------------------------------
  // Auth operations
  // -------------------------------------------------------------------
  const signIn = useCallback(
    (session: { user: AuthUser; company: Company }) => {
      const { user, company: userCompany } = session;
      setCurrentUser(user);
      setCompany(userCompany);
      if (user.property_uid) setActivePropertyUid(user.property_uid);
      void loadWorkspace();

      if (user.role === 'super_admin') {
        routerNavigate('/admin/properties');
      } else if (user.role === 'property_manager') {
        routerNavigate(`/property/${user.property_uid}/zones`);
      } else {
        routerNavigate('/employee/tasks');
      }
    },
    [loadWorkspace, routerNavigate]
  );

  const logout = useCallback(() => {
    void authApi.logout(); // best-effort server-side invalidation
    setCurrentUser(null);
    setCompany(null);
    setProperties([]);
    setAreas([]);
    setZones([]);
    setRooms([]);
    setDorms([]);
    setEmployees([]);
    setTasks([]);
    setMaintenanceTickets([]);
    routerNavigate('/');
    addToast({
      type: 'info',
      title: 'Logged Out',
      description: 'You have been signed out of Management Tool.',
    });
  }, [routerNavigate, addToast]);

  const registerCompanyAccount = useCallback(
    async (payload: RegisterCompanyRequest) => {
      const res = await authApi.registerCompany(payload);
      signIn({ user: res.user, company: res.company });
      addToast({
        type: 'success',
        title: 'Organization Registered',
        description: `${res.company.name} setup completed. Welcome to Management Tool!`,
      });
    },
    [signIn, addToast]
  );

  const updateProfile = useCallback(
    async (updates: { name?: string; phone?: string; email?: string }) => {
      try {
        const updated = await authApi.updateProfile(updates);
        setCurrentUser(updated);
        if (updated.employee_uid) {
          setEmployees((prev) =>
            prev.map((e) => (e.employee_uid === updated.employee_uid ? { ...e, ...updates } : e))
          );
        }
        addToast({
          type: 'success',
          title: 'Profile Updated',
          description: 'Your details were saved.',
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Profile Update Failed',
          description: apiErrorMessage(err, 'Could not save profile changes.'),
        });
        throw err;
      }
    },
    [addToast]
  );

  const updateCompanyDetails = useCallback(
    async (updates: {
      name?: string;
      legal_name?: string;
      brand_name?: string;
      email?: string;
      phone?: string;
      address?: string;
      pin_code?: string;
    }) => {
      if (!company) return;
      const updated = await companiesApi.updateCompany(company.company_uid, updates);
      setCompany(updated);
    },
    [company]
  );

  // -------------------------------------------------------------------
  // Property operations
  // -------------------------------------------------------------------
  // Create-mutation error helper: field-targeted errors (409/422) are rethrown
  // so the calling form can show them inline; everything else gets a toast.
  const createError = useCallback(
    (err: unknown, title: string, fallback: string): never => {
      if (err instanceof ApiError && err.field) throw err;
      addToast({ type: 'error', title, description: apiErrorMessage(err, fallback) });
      throw err;
    },
    [addToast]
  );

  const createProperty = useCallback(
    async (data: PropertyCreateRequest): Promise<Property> => {
      const created = await propertiesApi.createProperty(data).catch((err: unknown) =>
        createError(err, 'Create Failed', 'Could not create the property.')
      );
      setProperties((prev) => [created, ...prev]);
      // Manager employee record is created by the backend — refresh the roster
      void employeesApi.listEmployees().then((r) => setEmployees(r.items)).catch(() => {});
      addToast({
        type: 'success',
        title: 'Property Created',
        description: `${created.name} and Property Manager account generated.`,
      });
      return created;
    },
    [addToast, createError]
  );

  const updateProperty = useCallback(
    async (property_uid: string, updates: PropertyUpdateRequest) => {
      try {
        const updated = await propertiesApi.updateProperty(property_uid, updates);
        setProperties((prev) => prev.map((p) => (p.property_uid === property_uid ? updated : p)));
        addToast({ type: 'success', title: 'Property Updated', description: 'Changes saved.' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Update Failed',
          description: apiErrorMessage(err, 'Could not update the property.'),
        });
        throw err;
      }
    },
    [addToast]
  );

  const deleteProperty = useCallback(
    async (property_uid: string) => {
      const propName = properties.find((p) => p.property_uid === property_uid)?.name || 'Property';
      try {
        await propertiesApi.deleteProperty(property_uid);
        // Cascades (zones/rooms/staff/tasks) are enforced server-side — refresh
        await loadWorkspace();
        if (activePropertyUid === property_uid) {
          setActivePropertyUid('');
        }
        addToast({
          type: 'warning',
          title: 'Property Deleted',
          description: `${propName} and its scoped entities removed.`,
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Delete Failed',
          description: apiErrorMessage(err, 'Could not delete the property.'),
        });
      }
    },
    [properties, activePropertyUid, loadWorkspace, addToast]
  );

  // -------------------------------------------------------------------
  // Area operations
  // -------------------------------------------------------------------
  const createArea = useCallback(
    async (data: Omit<AreaCreateRequest, 'property_uid'>): Promise<Area> => {
      const created = await areasApi
        .createArea({ ...data, property_uid: activePropertyUid })
        .catch((err: unknown) => createError(err, 'Create Failed', 'Could not create the area.'));
      setAreas((prev) => [...prev, created]);
      addToast({ type: 'success', title: 'Area Created', description: `${created.name} added.` });
      return created;
    },
    [activePropertyUid, addToast, createError]
  );

  const updateArea = useCallback(
    async (area_uid: string, updates: AreaUpdateRequest) => {
      try {
        const updated = await areasApi.updateArea(area_uid, updates);
        setAreas((prev) => prev.map((a) => (a.area_uid === area_uid ? updated : a)));
        addToast({ type: 'success', title: 'Area Updated', description: 'Changes saved.' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Update Failed',
          description: apiErrorMessage(err, 'Could not update the area.'),
        });
        throw err;
      }
    },
    [addToast]
  );

  const deleteArea = useCallback(
    async (area_uid: string) => {
      try {
        await areasApi.deleteArea(area_uid);
        setAreas((prev) => prev.filter((a) => a.area_uid !== area_uid));
        // Zones referencing the area are cleared server-side — refresh zones
        void zonesApi.listZones().then((r) => setZones(r.items)).catch(() => {});
        addToast({ type: 'warning', title: 'Area Deleted', description: 'Area removed.' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Delete Failed',
          description: apiErrorMessage(err, 'Could not delete the area.'),
        });
      }
    },
    [addToast]
  );

  // -------------------------------------------------------------------
  // Zone operations
  // -------------------------------------------------------------------
  const createZone = useCallback(
    async (data: Omit<ZoneCreateRequest, 'property_uid'>): Promise<Zone> => {
      const created = await zonesApi
        .createZone({ ...data, property_uid: activePropertyUid })
        .catch((err: unknown) => createError(err, 'Create Failed', 'Could not create the zone.'));
      setZones((prev) => [...prev, created]);
      addToast({ type: 'success', title: 'Zone Created', description: `${created.name} added.` });
      return created;
    },
    [activePropertyUid, addToast, createError]
  );

  const updateZone = useCallback(
    async (zone_uid: string, updates: ZoneUpdateRequest) => {
      try {
        const updated = await zonesApi.updateZone(zone_uid, updates);
        setZones((prev) => prev.map((z) => (z.zone_uid === zone_uid ? updated : z)));
        // Changing zone_type away from 'stay' un-assigns units server-side
        if (updates.zone_type && updates.zone_type !== 'stay') {
          void roomsApi.listRooms().then((r) => setRooms(r.items)).catch(() => {});
          void dormsApi.listDorms().then((r) => setDorms(r.items)).catch(() => {});
        }
        addToast({ type: 'success', title: 'Zone Updated', description: 'Changes saved.' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Update Failed',
          description: apiErrorMessage(err, 'Could not update the zone.'),
        });
        throw err;
      }
    },
    [addToast]
  );

  const deleteZone = useCallback(
    async (zone_uid: string) => {
      try {
        await zonesApi.deleteZone(zone_uid);
        // Rooms/dorms/employees/tasks in the zone are unassigned server-side
        await loadWorkspace();
        addToast({
          type: 'warning',
          title: 'Zone Deleted',
          description: 'Zone removed; assigned units and staff were un-allocated.',
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Delete Failed',
          description: apiErrorMessage(err, 'Could not delete the zone.'),
        });
      }
    },
    [loadWorkspace, addToast]
  );

  // -------------------------------------------------------------------
  // Room operations
  // -------------------------------------------------------------------
  const createRoom = useCallback(
    async (data: Omit<RoomCreateRequest, 'property_uid'>): Promise<Room> => {
      const created = await roomsApi
        .createRoom({ ...data, property_uid: activePropertyUid })
        .catch((err: unknown) => createError(err, 'Create Failed', 'Could not create the room.'));
      setRooms((prev) => [...prev, created]);
      addToast({
        type: 'success',
        title: 'Room Created',
        description: `Room ${created.room_number} added.`,
      });
      return created;
    },
    [activePropertyUid, addToast, createError]
  );

  const bulkCreateRooms = useCallback(
    async (
      data: Omit<RoomBulkCreateRequest, 'property_uid'>
    ): Promise<{ createdCount: number; errors: string[] }> => {
      const res = await roomsApi
        .bulkCreateRooms({ ...data, property_uid: activePropertyUid })
        .catch((err: unknown) =>
          createError(err, 'Bulk Create Failed', 'Could not create the rooms.')
        );
      setRooms((prev) => [...prev, ...res.created]);
      return { createdCount: res.created.length, errors: res.errors };
    },
    [activePropertyUid, createError]
  );

  const updateRoom = useCallback(
    async (room_uid: string, updates: RoomUpdateRequest) => {
      try {
        const updated = await roomsApi.updateRoom(room_uid, updates);
        setRooms((prev) => prev.map((r) => (r.room_uid === room_uid ? updated : r)));
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Update Failed',
          description: apiErrorMessage(err, 'Could not update the room.'),
        });
        throw err;
      }
    },
    [addToast]
  );

  const updateRoomStatus = useCallback(
    async (room_uid: string, status: RoomStatus) => {
      const previous = rooms.find((r) => r.room_uid === room_uid)?.status;
      setRooms((prev) =>
        prev.map((r) => (r.room_uid === room_uid ? { ...r, status } : r))
      );
      try {
        await updateRoom(room_uid, { status });
        // Status transitions may trigger task automation server-side
        void tasksApi.listTasks().then((r) => setTasks(r.items)).catch(() => {});
      } catch {
        if (previous) {
          setRooms((prev) =>
            prev.map((r) => (r.room_uid === room_uid ? { ...r, status: previous } : r))
          );
        }
      }
    },
    [updateRoom, rooms]
  );

  // Fire-and-forget zone assignment — errors already toasted by updateRoom
  const moveRoomToZone = useCallback(
    async (room_uid: string, zone_uid: string | null) => {
      // Optimistic move — the card lands immediately; API confirms or rolls back
      const previous = rooms.find((r) => r.room_uid === room_uid)?.zone_uid ?? null;
      setRooms((prev) =>
        prev.map((r) => (r.room_uid === room_uid ? { ...r, zone_uid } : r))
      );
      try {
        await updateRoom(room_uid, { zone_uid });
      } catch {
        setRooms((prev) =>
          prev.map((r) => (r.room_uid === room_uid ? { ...r, zone_uid: previous } : r))
        );
      }
    },
    [updateRoom, rooms]
  );

  const assignRoomToZone = moveRoomToZone;

  const deleteRoom = useCallback(
    async (room_uid: string) => {
      try {
        await roomsApi.deleteRoom(room_uid);
        setRooms((prev) => prev.filter((r) => r.room_uid !== room_uid));
        addToast({ type: 'warning', title: 'Room Deleted', description: 'Room removed.' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Delete Failed',
          description: apiErrorMessage(err, 'Could not delete the room.'),
        });
      }
    },
    [addToast]
  );

  // -------------------------------------------------------------------
  // Dorm & bed operations
  // -------------------------------------------------------------------
  const createDorm = useCallback(
    async (data: Omit<DormCreateRequest, 'property_uid'>): Promise<Dorm> => {
      const created = await dormsApi
        .createDorm({ ...data, property_uid: activePropertyUid })
        .catch((err: unknown) => createError(err, 'Create Failed', 'Could not create the dorm.'));
      setDorms((prev) => [...prev, created]);
      addToast({
        type: 'success',
        title: 'Dorm Created',
        description: `${created.name} added with ${created.beds.length} beds.`,
      });
      return created;
    },
    [activePropertyUid, addToast, createError]
  );

  const updateDorm = useCallback(
    async (dorm_uid: string, updates: DormUpdateRequest) => {
      try {
        const updated = await dormsApi.updateDorm(dorm_uid, updates);
        setDorms((prev) => prev.map((d) => (d.dorm_uid === dorm_uid ? updated : d)));
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Update Failed',
          description: apiErrorMessage(err, 'Could not update the dorm.'),
        });
        throw err;
      }
    },
    [addToast]
  );

  const moveDormToZone = useCallback(
    async (dorm_uid: string, zone_uid: string | null) => {
      const previous = dorms.find((d) => d.dorm_uid === dorm_uid)?.zone_uid ?? null;
      setDorms((prev) =>
        prev.map((d) => (d.dorm_uid === dorm_uid ? { ...d, zone_uid } : d))
      );
      try {
        await updateDorm(dorm_uid, { zone_uid });
      } catch {
        setDorms((prev) =>
          prev.map((d) => (d.dorm_uid === dorm_uid ? { ...d, zone_uid: previous } : d))
        );
      }
    },
    [updateDorm, dorms]
  );

  const assignDormToZone = moveDormToZone;

  const deleteDorm = useCallback(
    async (dorm_uid: string) => {
      try {
        await dormsApi.deleteDorm(dorm_uid);
        setDorms((prev) => prev.filter((d) => d.dorm_uid !== dorm_uid));
        addToast({
          type: 'warning',
          title: 'Dorm Deleted',
          description: 'Dorm and its beds removed.',
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Delete Failed',
          description: apiErrorMessage(err, 'Could not delete the dorm.'),
        });
      }
    },
    [addToast]
  );

  const updateBedStatus = useCallback(
    async (bed_uid: string, status: BedStatus, guest_name?: string) => {
      // Optimistic — flip the bed in its dorm card immediately, rollback on error
      const prevDorms = dorms;
      setDorms((prev) =>
        prev.map((d) => ({
          ...d,
          beds: d.beds.map((b) =>
            b.bed_uid === bed_uid
              ? { ...b, status, guest_name: guest_name ?? b.guest_name }
              : b
          ),
        }))
      );
      try {
        // API returns the containing dorm — nested beds stay consistent
        const dorm = await dormsApi.updateBedStatus(bed_uid, { status, guest_name });
        setDorms((prev) => prev.map((d) => (d.dorm_uid === dorm.dorm_uid ? dorm : d)));
        // Bed transitions may trigger automation rules → refresh tasks
        void tasksApi.listTasks().then((r) => setTasks(r.items)).catch(() => {});
      } catch (err) {
        setDorms(prevDorms);
        addToast({
          type: 'error',
          title: 'Bed Update Failed',
          description: apiErrorMessage(err, 'Could not update the bed status.'),
        });
      }
    },
    [addToast, dorms]
  );

  const checkoutDorm = useCallback(
    async (dorm_uid: string) => {
      try {
        const dorm = await dormsApi.checkoutDorm(dorm_uid);
        setDorms((prev) => prev.map((d) => (d.dorm_uid === dorm_uid ? dorm : d)));
        void tasksApi.listTasks().then((r) => setTasks(r.items)).catch(() => {});
        addToast({
          type: 'success',
          title: 'Dorm Checked Out',
          description: 'All occupied beds flagged for cleaning.',
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Checkout Failed',
          description: apiErrorMessage(err, 'Could not check out the dorm.'),
        });
      }
    },
    [addToast]
  );

  const markDormCleaning = useCallback(
    async (dorm_uid: string) => {
      try {
        const dorm = await dormsApi.markDormCleaning(dorm_uid);
        setDorms((prev) => prev.map((d) => (d.dorm_uid === dorm_uid ? dorm : d)));
        void tasksApi.listTasks().then((r) => setTasks(r.items)).catch(() => {});
        addToast({
          type: 'info',
          title: 'Cleaning Requested',
          description: 'Dorm queued for housekeeping.',
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Request Failed',
          description: apiErrorMessage(err, 'Could not request cleaning.'),
        });
      }
    },
    [addToast]
  );

  // -------------------------------------------------------------------
  // Bulk unit operations — checkout / cleaning / available
  // -------------------------------------------------------------------
  const bulkUpdateUnits = useCallback(
    async (options: {
      action: 'checkout' | 'cleaning' | 'available' | 'maintenance';
      roomUids?: string[];
      bedUids?: string[];
    }) => {
      const roomUids = options.roomUids || [];
      const bedUids = options.bedUids || [];
      if (roomUids.length === 0 && bedUids.length === 0) return;

      try {
        const res = await roomsApi.bulkUpdateUnits({
          action: options.action,
          property_uid: activePropertyUid,
          room_uids: roomUids,
          bed_uids: bedUids,
        });
        setRooms((prev) => {
          const byId = new Map(res.rooms.map((r) => [r.room_uid, r]));
          return prev.map((r) => byId.get(r.room_uid) || r);
        });
        setDorms((prev) => {
          const byId = new Map(res.dorms.map((d) => [d.dorm_uid, d]));
          return prev.map((d) => byId.get(d.dorm_uid) || d);
        });
        if (res.generated_tasks?.length) {
          setTasks((prev) => [...prev, ...(res.generated_tasks || [])]);
        }

        const unitText = `${roomUids.length > 0 ? `${roomUids.length} room${roomUids.length > 1 ? 's' : ''}` : ''}${
          roomUids.length > 0 && bedUids.length > 0 ? ' & ' : ''
        }${bedUids.length > 0 ? `${bedUids.length} bed${bedUids.length > 1 ? 's' : ''}` : ''}`;

        if (options.action === 'checkout') {
          addToast({
            type: 'success',
            title: 'Bulk Checkout Completed',
            description: `Checked out ${unitText}. Flagged for cleaning.`,
          });
        } else if (options.action === 'cleaning') {
          addToast({
            type: 'info',
            title: 'Marked for Housekeeping',
            description: `${unitText} set to Cleaning in progress.`,
          });
        } else {
          const blocked = res.skipped_blocked || [];
          addToast({
            type: blocked.length ? 'info' : 'success',
            title: blocked.length ? 'Partially Released' : 'Cleaning Finished',
            description: blocked.length
              ? `${blocked.join(', ')} still ${blocked.length > 1 ? 'have' : 'has'} active work — kept unavailable.`
              : `${unitText} marked Available.`,
          });
        }
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Bulk Action Failed',
          description: apiErrorMessage(err, 'Could not update the selected units.'),
        });
      }
    },
    [activePropertyUid, addToast]
  );

  const bulkDeleteRooms = useCallback(
    async (roomUids: string[]) => {
      if (roomUids.length === 0) return;
      try {
        const res = await roomsApi.bulkDeleteRooms({
          property_uid: activePropertyUid,
          room_uids: roomUids,
        });
        setRooms((prev) => prev.filter((r) => !roomUids.includes(r.room_uid)));
        addToast({
          type: 'success',
          title: 'Rooms Deleted',
          description: `Deleted ${res.deleted} room${res.deleted === 1 ? '' : 's'}.`,
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Bulk Delete Failed',
          description: apiErrorMessage(err, 'Could not delete the selected rooms.'),
        });
      }
    },
    [activePropertyUid, addToast]
  );

  const bulkCheckoutRooms = useCallback(
    (roomUids: string[]) => bulkUpdateUnits({ action: 'checkout', roomUids }),
    [bulkUpdateUnits]
  );
  const bulkCleanRooms = useCallback(
    (roomUids: string[], targetStatus: RoomStatus = 'cleaning') =>
      bulkUpdateUnits({
        action: targetStatus === 'available' ? 'available' : 'cleaning',
        roomUids,
      }),
    [bulkUpdateUnits]
  );
  const bulkCheckoutBeds = useCallback(
    (bedUids: string[]) => bulkUpdateUnits({ action: 'checkout', bedUids }),
    [bulkUpdateUnits]
  );
  const bulkCleanBeds = useCallback(
    (bedUids: string[], targetStatus: BedStatus = 'cleaning') =>
      bulkUpdateUnits({
        action: targetStatus === 'available' ? 'available' : 'cleaning',
        bedUids,
      }),
    [bulkUpdateUnits]
  );

  // -------------------------------------------------------------------
  // Employee operations
  // -------------------------------------------------------------------
  const createEmployee = useCallback(
    async (data: Omit<EmployeeCreateRequest, 'property_uid'>): Promise<Employee> => {
      const created = await employeesApi
        .createEmployee({ ...data, property_uid: activePropertyUid })
        .catch((err: unknown) => createError(err, 'Onboarding Failed', 'Could not create the employee.'));
      setEmployees((prev) => [created, ...prev]);
      addToast({
        type: 'success',
        title: 'Employee Onboarded',
        description: `${created.name} assigned ID ${created.employee_uid}.`,
      });
      return created;
    },
    [activePropertyUid, addToast, createError]
  );

  const updateEmployee = useCallback(
    async (employee_uid: string, updates: EmployeeUpdateRequest) => {
      try {
        const updated = await employeesApi.updateEmployee(employee_uid, updates);
        setEmployees((prev) =>
          prev.map((e) => (e.employee_uid === employee_uid ? updated : e))
        );
        addToast({
          type: 'success',
          title: 'Employee Updated',
          description: 'Details saved.',
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Update Failed',
          description: apiErrorMessage(err, 'Could not update the employee.'),
        });
        throw err;
      }
    },
    [addToast]
  );

  // Drag-and-drop zone assignment — optimistic with rollback on failure
  const moveEmployeeToZone = useCallback(
    async (employee_uid: string, zone_uid: string | null) => {
      const prev = employees.find((e) => e.employee_uid === employee_uid);
      const previous = { zone_uid: prev?.zone_uid ?? null, area_uid: prev?.area_uid ?? null };
      // zone assignment clears any area-level assignment (mutually exclusive)
      setEmployees((prev) =>
        prev.map((e) =>
          e.employee_uid === employee_uid ? { ...e, zone_uid, area_uid: null } : e
        )
      );
      try {
        const updated = await employeesApi.assignEmployeeToZone(employee_uid, zone_uid);
        setEmployees((prev) =>
          prev.map((e) => (e.employee_uid === employee_uid ? updated : e))
        );
        const zoneName = zones.find((z) => z.zone_uid === zone_uid)?.name;
        addToast({
          type: 'success',
          title: 'Employee Reassigned',
          description: zone_uid
            ? `Moved to ${zoneName || 'zone'}.`
            : 'Moved to the unallocated pool.',
        });
      } catch (err) {
        // Roll back the optimistic move
        setEmployees((prev) =>
          prev.map((e) =>
            e.employee_uid === employee_uid
              ? { ...e, zone_uid: previous.zone_uid, area_uid: previous.area_uid }
              : e
          )
        );
        addToast({
          type: 'error',
          title: 'Assignment Failed',
          description: apiErrorMessage(err, 'Could not move the employee.'),
        });
      }
    },
    [employees, zones, addToast]
  );

  const assignEmployeeToZone = moveEmployeeToZone;

  // Area-level assignment — the employee covers every zone inside the area
  const assignEmployeeToArea = useCallback(
    async (employee_uid: string, area_uid: string | null) => {
      const prev = employees.find((e) => e.employee_uid === employee_uid);
      const previous = { zone_uid: prev?.zone_uid ?? null, area_uid: prev?.area_uid ?? null };
      setEmployees((p) =>
        p.map((e) =>
          e.employee_uid === employee_uid ? { ...e, area_uid, zone_uid: null } : e
        )
      );
      try {
        const updated = await employeesApi.assignEmployeeToArea(employee_uid, area_uid);
        setEmployees((p) =>
          p.map((e) => (e.employee_uid === employee_uid ? updated : e))
        );
        const areaName = areas.find((a) => a.area_uid === area_uid)?.name;
        addToast({
          type: 'success',
          title: 'Employee Reassigned',
          description: area_uid
            ? `Assigned to whole ${areaName || 'area'} — covers all its zones.`
            : 'Moved to the unallocated pool.',
        });
      } catch (err) {
        setEmployees((p) =>
          p.map((e) =>
            e.employee_uid === employee_uid
              ? { ...e, zone_uid: previous.zone_uid, area_uid: previous.area_uid }
              : e
          )
        );
        addToast({
          type: 'error',
          title: 'Assignment Failed',
          description: apiErrorMessage(err, 'Could not move the employee.'),
        });
      }
    },
    [employees, areas, addToast]
  );

  const deactivateEmployee = useCallback(
    async (employee_uid: string) => {
      try {
        const updated = await employeesApi.deactivateEmployee(employee_uid);
        setEmployees((prev) =>
          prev.map((e) => (e.employee_uid === employee_uid ? updated : e))
        );
        addToast({
          type: 'warning',
          title: 'Employee Deactivated',
          description: 'Moved to inactive status and unassigned from zone.',
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Deactivation Failed',
          description: apiErrorMessage(err, 'Could not deactivate the employee.'),
        });
      }
    },
    [addToast]
  );

  const deleteEmployee = useCallback(
    async (employee_uid: string) => {
      try {
        await employeesApi.deleteEmployee(employee_uid);
        // Their tasks are unassigned server-side — refresh the roster & tasks
        await loadWorkspace();
        addToast({
          type: 'warning',
          title: 'Employee Deleted',
          description: 'Record removed; assigned tasks were un-allocated.',
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Delete Failed',
          description: apiErrorMessage(err, 'Could not delete the employee.'),
        });
      }
    },
    [loadWorkspace, addToast]
  );

  // -------------------------------------------------------------------
  // Task operations
  // -------------------------------------------------------------------
  const createTask = useCallback(
    async (data: Omit<TaskCreateRequest, 'property_uid'>): Promise<Task> => {
      const created = await tasksApi
        .createTask({ ...data, property_uid: activePropertyUid })
        .catch((err: unknown) => createError(err, 'Create Failed', 'Could not create the task.'));
      setTasks((prev) => [created, ...prev]);
      addToast({ type: 'success', title: 'Task Created', description: `${created.title}` });
      return created;
    },
    [activePropertyUid, addToast, createError]
  );

  const updateTask = useCallback(
    async (task_uid: string, updates: TaskUpdateRequest) => {
      try {
        const updated = await tasksApi.updateTask(task_uid, updates);
        setTasks((prev) => prev.map((t) => (t.task_uid === task_uid ? updated : t)));
        addToast({ type: 'success', title: 'Task Updated', description: 'Changes saved.' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Update Failed',
          description: apiErrorMessage(err, 'Could not update the task.'),
        });
        throw err;
      }
    },
    [addToast]
  );

  const deleteTask = useCallback(
    async (task_uid: string) => {
      try {
        await tasksApi.deleteTask(task_uid);
        setTasks((prev) => prev.filter((t) => t.task_uid !== task_uid));
        addToast({ type: 'warning', title: 'Task Deleted', description: 'Task removed.' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Delete Failed',
          description: apiErrorMessage(err, 'Could not delete the task.'),
        });
      }
    },
    [addToast]
  );

  const startTask = useCallback(
    async (task_uid: string) => {
      try {
        const updated = await tasksApi.startTask(task_uid);
        setTasks((prev) => prev.map((t) => (t.task_uid === task_uid ? updated : t)));
        addToast({ type: 'info', title: 'Task Started', description: 'Status → In Progress.' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Action Failed',
          description: apiErrorMessage(err, 'Could not start the task.'),
        });
      }
    },
    [addToast]
  );

  const completeTask = useCallback(
    async (task_uid: string, photos: File[], note?: string) => {
      try {
        // Upload evidence photos first — backend requires ≥1 photo
        const photo_urls: string[] = [];
        for (const file of photos) {
          const res = await mediaApi.uploadPhoto(file);
          photo_urls.push(res.url);
        }
        const res = await tasksApi.completeTask(task_uid, { photo_urls, note });
        setTasks((prev) => {
          const next = prev.map((t) => (t.task_uid === task_uid ? res.task : t));
          if (res.generated_task) next.unshift(res.generated_task);
          return next;
        });
        if (res.task.room_uid || res.task.dorm_uid) refreshUnits();
        addToast({
          type: 'success',
          title: 'Task Completed',
          description: res.generated_task
            ? 'Evidence attached. Next recurring instance scheduled.'
            : 'Evidence attached and task closed.',
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Completion Failed',
          description: apiErrorMessage(err, 'Could not complete the task.'),
        });
      }
    },
    [addToast, refreshUnits]
  );

  const requestTaskRedo = useCallback(
    async (task_uid: string, note?: string) => {
      try {
        const updated = await tasksApi.requestTaskRedo(task_uid, note);
        setTasks((prev) => prev.map((t) => (t.task_uid === task_uid ? updated : t)));
        if (updated.room_uid || updated.dorm_uid) refreshUnits();
        addToast({
          type: 'warning',
          title: 'Redo Requested',
          description: 'Task reopened for the assignee.',
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Action Failed',
          description: apiErrorMessage(err, 'Could not request a redo.'),
        });
      }
    },
    [addToast, refreshUnits]
  );

  const reassignTask = useCallback(
    async (task_uid: string, employee_uid: string | null) => {
      try {
        const updated = await tasksApi.reassignTask(task_uid, employee_uid);
        setTasks((prev) => prev.map((t) => (t.task_uid === task_uid ? updated : t)));
        addToast({ type: 'info', title: 'Task Reassigned', description: 'Assignee updated.' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Action Failed',
          description: apiErrorMessage(err, 'Could not reassign the task.'),
        });
      }
    },
    [addToast]
  );

  const updateTaskStatus = useCallback(
    async (task_uid: string, status: TaskStatus) => {
      try {
        await updateTask(task_uid, { status });
      } catch {
        /* toast already emitted */
      }
    },
    [updateTask]
  );

  // -------------------------------------------------------------------
  // Task ticket review workflow — submit / approve / reject / reopen
  // -------------------------------------------------------------------
  const submitTask = useCallback(
    async (task_uid: string, note: string | undefined, photo_urls: string[]) => {
      try {
        const updated = await tasksApi.submitTask(task_uid, { note, photo_urls });
        setTasks((prev) => prev.map((t) => (t.task_uid === task_uid ? updated : t)));
        addToast({ type: 'success', title: 'Task Submitted', description: 'Sent for supervisor review.' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Submit Failed',
          description: apiErrorMessage(err, 'Could not submit the task.'),
        });
      }
    },
    [addToast]
  );

  const approveTask = useCallback(
    async (task_uid: string, note?: string) => {
      try {
        const res = await tasksApi.approveTask(task_uid, note);
        setTasks((prev) => {
          const next = prev.map((t) => (t.task_uid === task_uid ? res.task : t));
          if (res.generated_task) next.unshift(res.generated_task);
          return next;
        });
        if (res.task.room_uid || res.task.dorm_uid) refreshUnits();
        addToast({ type: 'success', title: 'Task Approved', description: 'Marked completed.' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Approval Failed',
          description: apiErrorMessage(err, 'Could not approve the task.'),
        });
      }
    },
    [addToast, refreshUnits]
  );

  const rejectTask = useCallback(
    async (task_uid: string, reason: string) => {
      try {
        const updated = await tasksApi.rejectTask(task_uid, reason);
        setTasks((prev) => prev.map((t) => (t.task_uid === task_uid ? updated : t)));
        if (updated.room_uid || updated.dorm_uid) refreshUnits();
        addToast({ type: 'warning', title: 'Task Rejected', description: 'Reopened for the assignee.' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Rejection Failed',
          description: apiErrorMessage(err, 'Could not reject the task.'),
        });
      }
    },
    [addToast, refreshUnits]
  );

  const reopenTask = useCallback(
    async (task_uid: string, note?: string) => {
      try {
        const updated = await tasksApi.reopenTask(task_uid, note);
        setTasks((prev) => prev.map((t) => (t.task_uid === task_uid ? updated : t)));
        if (updated.room_uid || updated.dorm_uid) refreshUnits();
        addToast({ type: 'info', title: 'Task Reopened' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Action Failed',
          description: apiErrorMessage(err, 'Could not reopen the task.'),
        });
      }
    },
    [addToast, refreshUnits]
  );

  // -------------------------------------------------------------------
  // Maintenance tickets — the ticket is the record; room status is derived
  // -------------------------------------------------------------------
  const _upsertTicket = useCallback((t: MaintenanceTicket) => {
    setMaintenanceTickets((prev) => {
      const i = prev.findIndex((x) => x.ticket_uid === t.ticket_uid);
      if (i === -1) return [t, ...prev];
      const next = [...prev];
      next[i] = t;
      return next;
    });
  }, []);

  const createMaintenanceTicket = useCallback(
    async (data: Omit<import('../api/types').MaintenanceCreateRequest, 'property_uid'>) => {
      const ticket = await maintenanceApi.createMaintenanceTicket({
        ...data,
        property_uid: activePropertyUid,
      });
      _upsertTicket(ticket);
      if (ticket.room_uid) {
        setRooms((prev) =>
          prev.map((r) =>
            r.room_uid === ticket.room_uid ? { ...r, status: 'maintenance' as RoomStatus } : r
          )
        );
      }
      return ticket;
    },
    [activePropertyUid, _upsertTicket]
  );

  const createMaintenanceBatch = useCallback(
    async (tickets: Omit<import('../api/types').WorkBatchTicketIn, 'kind'>[]) => {
      const res = await maintenanceApi.createWorkBatch({
        property_uid: activePropertyUid,
        tickets: tickets.map((t) => ({ ...t, kind: 'maintenance' as const })),
      });
      // Apply all created tickets + unit status flips to local state
      const allTickets = res.batches.flatMap((b) => b.tickets);
      for (const t of allTickets) _upsertTicket(t);
      const roomIds = new Set(allTickets.map((t) => t.room_uid).filter(Boolean));
      const bedIds = new Set(allTickets.map((t) => t.bed_uid).filter(Boolean));
      // Bed-level tickets also carry dorm_uid as location context — only a
      // ticket WITHOUT bed_uid flags the whole dorm.
      const dormIds = new Set(
        allTickets.filter((t) => !t.bed_uid).map((t) => t.dorm_uid).filter(Boolean)
      );
      if (roomIds.size) {
        setRooms((prev) =>
          prev.map((r) =>
            roomIds.has(r.room_uid) ? { ...r, status: 'maintenance' as RoomStatus } : r
          )
        );
      }
      if (bedIds.size || dormIds.size) {
        setDorms((prev) =>
          prev.map((d) => {
            const dormFlagged = dormIds.has(d.dorm_uid);
            return {
              ...d,
              status: dormFlagged ? 'maintenance' : d.status,
              beds: d.beds.map((b) =>
                bedIds.has(b.bed_uid) || (dormFlagged && b.status !== 'occupied')
                  ? { ...b, status: 'maintenance' as BedStatus }
                  : b
              ),
            };
          })
        );
      }
      return res.batches;
    },
    [activePropertyUid, _upsertTicket]
  );

  const _ticketAction = useCallback(
    async (
      fn: () => Promise<MaintenanceTicket>,
      successToast: { type: 'success' | 'info' | 'warning'; title: string; description?: string },
      errorTitle: string
    ) => {
      try {
        const ticket = await fn();
        _upsertTicket(ticket);
        // resolved keeps the unit blocked until the PM closes it; only
        // close/cancel release server-side — refetch rather than guess
        if (['closed', 'cancelled'].includes(ticket.status)) refreshUnits();
        addToast(successToast);
      } catch (err) {
        addToast({
          type: 'error',
          title: errorTitle,
          description: apiErrorMessage(err, 'The ticket action failed.'),
        });
      }
    },
    [_upsertTicket, addToast, refreshUnits]
  );

  const assignMaintenanceTicket = useCallback(
    (ticket_uid: string, employee_uid: string | null) =>
      _ticketAction(
        () => maintenanceApi.assignMaintenanceTicket(ticket_uid, employee_uid),
        { type: 'success', title: 'Ticket Assigned' },
        'Assign Failed'
      ),
    [_ticketAction]
  );

  const startMaintenanceTicket = useCallback(
    (ticket_uid: string) =>
      _ticketAction(
        () => maintenanceApi.startMaintenanceTicket(ticket_uid),
        { type: 'info', title: 'Work Started' },
        'Action Failed'
      ),
    [_ticketAction]
  );

  const holdMaintenanceTicket = useCallback(
    (ticket_uid: string, note?: string) =>
      _ticketAction(
        () => maintenanceApi.holdMaintenanceTicket(ticket_uid, note),
        { type: 'warning', title: 'Ticket On Hold' },
        'Action Failed'
      ),
    [_ticketAction]
  );

  const resolveMaintenanceTicket = useCallback(
    (ticket_uid: string, notes: string, photo_urls: string[]) =>
      _ticketAction(
        () =>
          maintenanceApi.resolveMaintenanceTicket(ticket_uid, {
            resolution_notes: notes,
            photo_urls,
          }),
        { type: 'success', title: 'Submitted for Approval', description: 'Sent for Property Manager review.' },
        'Resolve Failed'
      ),
    [_ticketAction]
  );

  const closeMaintenanceTicket = useCallback(
    (ticket_uid: string) =>
      _ticketAction(
        () => maintenanceApi.closeMaintenanceTicket(ticket_uid),
        { type: 'success', title: 'Approved — Ticket Completed' },
        'Approve Failed'
      ),
    [_ticketAction]
  );

  const disapproveMaintenanceTicket = useCallback(
    (ticket_uid: string, reason: string) =>
      _ticketAction(
        () => maintenanceApi.disapproveMaintenanceTicket(ticket_uid, reason),
        { type: 'info', title: 'Returned for correction' },
        'Disapprove Failed'
      ),
    [_ticketAction]
  );

  const updateMaintenanceTicket = useCallback(
    async (
      ticket_uid: string,
      updates: import('../api/types').MaintenanceUpdateRequest
    ) => {
      try {
        const ticket = await maintenanceApi.updateMaintenanceTicket(ticket_uid, updates);
        _upsertTicket(ticket);
        // cancellation releases the unit server-side only when nothing else
        // blocks it — refetch instead of assuming 'available'
        if (ticket.status === 'cancelled') refreshUnits();
        addToast({ type: 'success', title: 'Ticket Updated' });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Update Failed',
          description: apiErrorMessage(err, 'Could not update the ticket.'),
        });
      }
    },
    [_upsertTicket, addToast, refreshUnits]
  );

  // -------------------------------------------------------------------
  // Permissions wrapper
  // -------------------------------------------------------------------
  const canDo = (action: any, resource: any, context?: any) => {
    return can(action, resource, currentUser, {
      property_uid: activePropertyUid,
      employee_uid: currentUser?.employee_uid,
      ...context,
    });
  };

  const value: AppContextType = {
    currentUser,
    currentRole,
    activePropertyUid,
    activeProperty,
    isAuthenticated,
    isLoadingData,
    dataError,
    retryLoad,
    currentPath,
    openedZoneUid,
    employeesTab,
    roomsTab,
    setOpenedZoneUid,
    setEmployeesTab,
    setRoomsTab,
    navigate,
    signIn,
    logout,
    registerCompanyAccount,
    setActivePropertyUid,
    updateProfile,
    updateCompanyDetails,
    company,
    properties,
    companyProperties,
    areas,
    zones,
    rooms,
    dorms,
    employees,
    tasks,
    employeeRecord: employees.find(
      (e) => e.employee_uid === currentUser?.employee_uid || e.email === currentUser?.email
    ),
    currentPropertyAreas,
    currentPropertyZones,
    currentPropertyRooms,
    currentPropertyDorms,
    currentPropertyEmployees,
    currentPropertyUnallocatedEmployees,
    currentPropertyTasks,
    currentPropertyMaintenance,
    maintenanceTickets,
    currentEmployeeTasks,
    currentEmployeeMaintenance,
    createProperty,
    updateProperty,
    deleteProperty,
    createArea,
    updateArea,
    deleteArea,
    createZone,
    updateZone,
    deleteZone,
    createRoom,
    bulkCreateRooms,
    updateRoom,
    moveRoomToZone,
    deleteRoom,
    updateRoomStatus,
    assignRoomToZone,
    createDorm,
    updateDorm,
    moveDormToZone,
    deleteDorm,
    assignDormToZone,
    updateBedStatus,
    checkoutDorm,
    markDormCleaning,
    bulkUpdateUnits,
    bulkDeleteRooms,
    bulkCheckoutRooms,
    bulkCleanRooms,
    bulkCheckoutBeds,
    bulkCleanBeds,
    createEmployee,
    updateEmployee,
    moveEmployeeToZone,
    assignEmployeeToZone,
    assignEmployeeToArea,
    deleteEmployee,
    deactivateEmployee,
    createTask,
    updateTask,
    deleteTask,
    startTask,
    completeTask,
    requestTaskRedo,
    reassignTask,
    updateTaskStatus,
    submitTask,
    approveTask,
    rejectTask,
    reopenTask,
    createMaintenanceTicket,
    createMaintenanceBatch,
    assignMaintenanceTicket,
    startMaintenanceTicket,
    holdMaintenanceTicket,
    resolveMaintenanceTicket,
    closeMaintenanceTicket,
    disapproveMaintenanceTicket,
    updateMaintenanceTicket,
    toasts,
    addToast,
    dismissToast,
    canDo,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
