import { apiFetch } from './client';
import { Company } from '../types';
import { UpdateCompanyRequest } from './types';

export async function getCompany(company_uid: string): Promise<Company> {
  return apiFetch<Company>(`/companies/${company_uid}`);
}

export async function updateCompany(
  company_uid: string,
  req: UpdateCompanyRequest
): Promise<Company> {
  return apiFetch<Company>(`/companies/${company_uid}`, { method: 'PATCH', body: req });
}
