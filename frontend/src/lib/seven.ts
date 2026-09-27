import { apiFetch } from './api';

export const SEVEN_AREAS = {
  voce: { label: 'Você', color: '#ef4444' },
  metas: { label: 'Metas', color: '#fbbf24' },
  trabalho: { label: 'Carreira', color: '#ff5547' },
  projetos: { label: 'Projetos', color: '#a78bfa' },
  financas: { label: 'Finanças', color: '#fb923c' },
  aprendizado: { label: 'Aprendizado', color: '#38bdf8' },
  saude: { label: 'Saúde', color: '#34d399' },
  relacoes: { label: 'Relações', color: '#f472b6' },
  interesses: { label: 'Interesses', color: '#e8a46b' },
  meta: { label: 'Outros', color: '#9ca3af' },
} as const;

export type SevenArea = keyof typeof SEVEN_AREAS;
export interface SevenNote {
  id: string;
  area: SevenArea;
  title: string;
  body: string;
  links: string[];
  path?: string;
}

export interface SevenProfile {
  name: string;
  address: string;
  persona: string;
  voice_enabled: boolean;
  voice_id: string;
  voice_speed: number;
  notes: SevenNote[];
  revision: string;
}

export interface SevenModel {
  key: string;
  name: string;
  provider: string;
  local: boolean;
}

export interface SevenAgentProvider {
  id: string;
  label: string;
  configured: boolean;
  source: 'panel' | 'external' | '';
  can_remove: boolean;
}

export interface SevenAgentSettings {
  default_model: string;
  fallbacks: string[];
  providers: SevenAgentProvider[];
}

async function agentSettingsResponse(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  const body = await response.json().catch(() => ({})) as { detail?: string };
  throw new Error(body.detail || fallback);
}

// Credentials must only travel to the authenticated panel origin, regardless
// of the generic Jarvis API URL configured in localStorage.
const agentSettingsFetch = (path: string, init: RequestInit = {}) => fetch(path, {
  ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
});

export async function getSevenAgentSettings(): Promise<SevenAgentSettings> {
  const response = await agentSettingsFetch('/v1/seven/agent-settings');
  await agentSettingsResponse(response, 'Não foi possível carregar as configurações do OpenClaw.');
  return response.json();
}

export async function saveSevenProviderKey(provider: string, apiKey: string): Promise<void> {
  const response = await agentSettingsFetch(`/v1/seven/agent-settings/keys/${encodeURIComponent(provider)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  await agentSettingsResponse(response, 'Não foi possível salvar a chave no OpenClaw.');
}

export async function removeSevenProviderKey(provider: string): Promise<void> {
  const response = await agentSettingsFetch(`/v1/seven/agent-settings/keys/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  });
  await agentSettingsResponse(response, 'Não foi possível remover a chave do OpenClaw.');
}

export async function saveSevenAgentModels(primary: string, fallbacks: string[]): Promise<void> {
  const response = await agentSettingsFetch('/v1/seven/agent-settings/models', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ primary, fallbacks }),
  });
  await agentSettingsResponse(response, 'Não foi possível salvar os modelos do OpenClaw.');
}

export function sevenVoiceGender(voiceId: string): 'feminine' | 'masculine' | null {
  const match = /^[a-z]([fm])_/i.exec(voiceId.trim());
  return match?.[1].toLowerCase() === 'f' ? 'feminine' : match?.[1].toLowerCase() === 'm' ? 'masculine' : null;
}

export async function getSevenProfile(): Promise<SevenProfile> {
  const response = await apiFetch('/v1/seven/profile');
  if (!response.ok) throw new Error(`Não foi possível carregar o perfil (${response.status}).`);
  return response.json();
}

export async function saveSevenProfile(profile: SevenProfile): Promise<SevenProfile> {
  const response = await apiFetch('/v1/seven/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).detail; } catch { /* HTTP status is enough */ }
    throw new Error(detail || `Não foi possível salvar o perfil (${response.status}).`);
  }
  return response.json();
}

export async function getSevenModels(): Promise<SevenModel[]> {
  const response = await apiFetch('/v1/seven/models');
  if (!response.ok) throw new Error('Não foi possível carregar os modelos do OpenClaw.');
  const data = await response.json() as { models: string[]; catalog?: SevenModel[] };
  return data.catalog ?? data.models.map((key) => ({
    key,
    name: key.split('/').slice(1).join('/'),
    provider: key.split('/')[0],
    local: key.startsWith('ollama/'),
  }));
}

export async function* streamSevenChat(request: { conversation_id: string; text: string; model?: string; history?: { role: 'user' | 'assistant'; text: string }[] }, signal?: AbortSignal): AsyncGenerator<string> {
  const response = await apiFetch('/v1/seven/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(data.detail || `OpenClaw retornou erro ${response.status}.`);
  }
  if (!response.body) throw new Error('OpenClaw não retornou uma resposta em tempo real.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const chunk = JSON.parse(data);
          const content = chunk.choices?.[0]?.delta?.content;
          if (typeof content === 'string') yield content;
          if (chunk.error?.message) throw new Error(chunk.error.message);
        } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function speakSeven(text: string, signal?: AbortSignal): Promise<Blob> {
  const response = await apiFetch('/v1/seven/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 2000) }),
    signal,
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).detail; } catch { /* HTTP status is enough */ }
    throw new Error(detail || `Falha ao gerar voz (${response.status}).`);
  }
  return response.blob();
}
