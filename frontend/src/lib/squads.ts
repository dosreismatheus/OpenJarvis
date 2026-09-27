import { apiFetch } from './api';

export type SquadAgent = { id: string; name: string; role: string; status: 'idle' | 'working' | 'blocked' | 'review'; task: string; summary: string; updated_at: string | null };
export type SquadCard = { id: string; title: string; description: string; column: string; assignee: string; links: string[]; updated_at: string; history?: { from: string | null; to: string; by: string; at: string; evidence: string }[] };
export type SquadBrainNote = { path: string; title: string; content: string; links: string[] };
export type SquadSnapshot = {
  schema_version: number;
  id: string;
  name: string;
  description: string;
  repository: string;
  environments: { staging: string; production: string };
  agents: SquadAgent[];
  board: { columns: { id: string; name: string }[]; cards: SquadCard[] };
  updated_at: string | null;
  revision: number;
};
export type SquadConnection = { id: string; name: string; url: string; online: boolean; error?: string; data?: SquadSnapshot };

async function responseJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || `Erro HTTP ${response.status}`);
  return body;
}

export async function listSquads(): Promise<SquadConnection[]> {
  return responseJson(await apiFetch('/v1/seven/squads'));
}

export async function addSquad(input: { id: string; name: string; url: string; token_env?: string; command_token_env?: string }): Promise<void> {
  await responseJson(await apiFetch('/v1/seven/squads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
}

export async function sendSquadRequest(id: string, input: { title: string; details: string }): Promise<void> {
  await responseJson(await apiFetch(`/v1/seven/squads/${encodeURIComponent(id)}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
}

export async function getSquadBrain(id: string): Promise<SquadBrainNote[]> {
  const result = await responseJson(await apiFetch(`/v1/seven/squads/${encodeURIComponent(id)}/brain`));
  return Array.isArray(result.notes) ? result.notes : [];
}

export async function saveSquadBrainNote(id: string, path: string, content: string): Promise<void> {
  await responseJson(await apiFetch(`/v1/seven/squads/${encodeURIComponent(id)}/brain/note`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content }) }));
}

export async function reviewSquadRequest(squadId: string, requestId: string, approved: boolean, feedback: string): Promise<void> {
  await responseJson(await apiFetch(`/v1/seven/squads/${encodeURIComponent(squadId)}/requests/${encodeURIComponent(requestId)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved, feedback }) }));
}

export async function resumeSquadRequest(squadId: string, requestId: string, feedback: string): Promise<void> {
  await responseJson(await apiFetch(`/v1/seven/squads/${encodeURIComponent(squadId)}/requests/${encodeURIComponent(requestId)}/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback }) }));
}

export async function removeSquad(id: string): Promise<void> {
  const response = await apiFetch(`/v1/seven/squads/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) await responseJson(response);
}
