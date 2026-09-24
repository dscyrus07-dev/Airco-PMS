import { apiFetch } from './client';
import {
  ListResponse,
  WorkTemplate,
  WorkTemplateCreateRequest,
  WorkTemplateUpdateRequest,
  WorkTemplateGeneratedWork,
  TemplateGenerationRow,
} from './types';

export interface TemplateListParams {
  property_uid?: string;
  status?: string;
  template_type?: string;
  category?: string;
  search?: string;
}

export async function listTemplates(
  params: TemplateListParams = {}
): Promise<ListResponse<WorkTemplate>> {
  return apiFetch<ListResponse<WorkTemplate>>('/templates', { query: params });
}

export async function getTemplate(template_uid: string): Promise<WorkTemplate> {
  return apiFetch<WorkTemplate>(`/templates/${template_uid}`);
}

export async function createTemplate(
  req: WorkTemplateCreateRequest
): Promise<WorkTemplate> {
  return apiFetch<WorkTemplate>('/templates', { method: 'POST', body: req });
}

export async function updateTemplate(
  template_uid: string,
  req: WorkTemplateUpdateRequest
): Promise<WorkTemplate> {
  return apiFetch<WorkTemplate>(`/templates/${template_uid}`, {
    method: 'PATCH',
    body: req,
  });
}

export async function deleteTemplate(template_uid: string): Promise<void> {
  return apiFetch<void>(`/templates/${template_uid}`, { method: 'DELETE' });
}

export async function templateAction(
  template_uid: string,
  action: 'pause' | 'resume' | 'activate' | 'archive' | 'duplicate'
): Promise<WorkTemplate> {
  return apiFetch<WorkTemplate>(`/templates/${template_uid}/${action}`, {
    method: 'POST',
  });
}

export async function templateHistory(
  template_uid: string
): Promise<ListResponse<TemplateGenerationRow>> {
  return apiFetch<ListResponse<TemplateGenerationRow>>(
    `/templates/${template_uid}/history`
  );
}

export async function templateGeneratedWork(
  template_uid: string
): Promise<WorkTemplateGeneratedWork> {
  return apiFetch<WorkTemplateGeneratedWork>(
    `/templates/${template_uid}/generated-work`
  );
}

export async function generateDue(): Promise<{
  templates: number;
  generated: number;
  skipped: number;
}> {
  return apiFetch('/templates/generate-due', { method: 'POST' });
}
