/**
 * Typed screen-data hooks — the ONLY server collections the app keeps.
 * Login fetches exactly three things (me is already in the session):
 *   GET /tasks (employee-scoped server-side), GET /zones (names only),
 *   GET /maintenance — when the employee opens that tab.
 * No whole-property bootstrap like the web workspace.
 */

import { useFetch } from '@/hooks/useFetch';
import { getEligibleLocations, getTicket, listMyTickets } from '@/services/maintenance';
import { getTask, listMyTasks, listZones } from '@/services/tasks';
import type { ListResponse, Task, Zone } from '@/types/api';

interface TasksData {
  tasks: Task[];
  zones: Map<string, string>;
}

export const useMyTasks = () =>
  useFetch<TasksData>(async () => {
    const [tasksRes, zonesRes] = await Promise.all([
      listMyTasks(200),
      // Zone names are presentation-only; a zone failure must not blank the list.
      listZones().catch((): ListResponse<Zone> => ({ items: [], total: 0 })),
    ]);
    return {
      tasks: tasksRes.items,
      zones: new Map(zonesRes.items.map((z) => [z.zone_uid, z.name])),
    };
  });

export const useTask = (taskUid: string) => useFetch(() => getTask(taskUid), [taskUid]);

export const useMyTickets = () => useFetch(() => listMyTickets().then((r) => r.items));

export const useTicket = (ticketUid: string) =>
  useFetch(() => getTicket(ticketUid), [ticketUid]);

export const useEligibleLocations = () => useFetch(() => getEligibleLocations());
