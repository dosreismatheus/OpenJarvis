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

export async function rememberSevenTurn(turn: { turn_id: string; user_text: string; assistant_text?: string }): Promise<void> {
  const response = await apiFetch('/v1/seven/memory/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(turn),
  });
  if (!response.ok) throw new Error(`Não consegui salvar esta conversa no Segundo Cérebro (${response.status}).`);
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

export function sevenRequestsFamilyGoal(text: string): boolean {
  return /fam[ií]lia\s+reunida|reunir\s+(?:a|minha|nossa)\s+fam[ií]lia|meta\s+(?:da|de)\s+fam[ií]lia|(?:mudar|ir embora|mor(?:ar|adia))\s+(?:para\s+)?(?:palmas|aragua[ií]na)|(?:gabi|gabriella)\s+.*\s+(?:mudar|mor(?:ar|adia)|trabalho)/i.test(text);
}

export function sevenIsIdentityQuestion(text: string): boolean {
  return /\b(?:quem\s+(?:[eé]\s+voc[eê]|voc[eê]\s+[eé])|quem\s+[eé]\s+(?:a\s+|o\s+)?seven|qual\s+(?:[eé]\s+)?(?:o\s+)?(?:seu|sua)\s+(?:foco|fun[cç][aã]o)|apresente-se)(?=$|[\s?!.,])/i.test(text);
}

function isPersonalNote(note: SevenNote): boolean {
  return note.id === 'seed-9' || /fam[ií]lia reunida/i.test(note.title);
}

export function sevenSystemPrompt(profile: SevenProfile, requestText: string): string {
  const voiceGender = sevenVoiceGender(profile.voice_id);
  const familyGoalRequested = sevenRequestsFamilyGoal(requestText);
  const identityRequested = sevenIsIdentityQuestion(requestText);
  const genderInstruction = voiceGender === 'feminine'
    ? 'Ao falar de si, use feminino: ela/dela, sua assistente.'
    : voiceGender === 'masculine'
      ? 'Ao falar de si, use masculino: ele/dele, seu assistente.'
      : '';
  const availableNotes = profile.notes.filter((note) => (familyGoalRequested || !isPersonalNote(note)) && (!identityRequested || note.title.toLocaleLowerCase('pt-BR') === '7build'));
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const tokens = normalize(requestText).match(/[a-z0-9]{4,}/g)?.filter((word) => !['voce', 'sobre', 'quero', 'como', 'para', 'qual', 'falar', 'fazer', 'pode', 'mais'].includes(word)) || [];
  const rankedNotes = availableNotes.map((note) => {
    const title = normalize(note.title);
    const body = normalize(note.body);
    const workQuestion = /7build|empresa|projeto|cliente|venda|marketing|trabalho|neg[oó]cio/i.test(requestText);
    const score = (note.title === '7build' && (identityRequested || workQuestion) ? 2 : 0) + tokens.reduce((total, word) => total + (title.includes(word) ? 5 : 0) + (body.includes(word) ? 1 : 0), 0);
    return { note, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, 6).map(({ note }) => note);
  const titles = new Map(rankedNotes.map((note) => [note.id, note.title]));
  const notes = rankedNotes
    .map((note) => {
      const related = note.links.map((id) => titles.get(id)).filter(Boolean).join(', ');
      const body = note.body.length > 1800 ? `${note.body.slice(0, 350)}\n[...]\n${note.body.slice(-1400)}` : note.body;
      return `- [${SEVEN_AREAS[note.area]?.label || note.area}] ${note.title}: ${body}${related ? ` Relações: ${related}.` : ''}`;
    })
    .join('\n');
  return [
    `Você é ${profile.name}, assistente pessoal de Matheus. Fale diretamente com ele e trate-o por "${profile.address}". ${genderInstruction}`,
    `Converse naturalmente sobre qualquer assunto que ele trouxer. Quando o assunto for trabalho, ajude no dia a dia da 7build. Responda em português do Brasil com tom ${profile.persona}, de forma breve, sem inventar fatos.`,
    notes ? `Notas pertinentes a esta conversa:\n${notes}` : '',
  ].filter(Boolean).join('\n\n');
}

export function stripAndCollectMemories(text: string): { clean: string; memories: Array<Pick<SevenNote, 'area' | 'title' | 'body'>> } {
  const memories: Array<Pick<SevenNote, 'area' | 'title' | 'body'>> = [];
  const clean = text.replace(/\[\[SAVE:([a-z_]+)\|([^|\]]+)\|([\s\S]*?)\]\]/g, (_all, area: string, title: string, body: string) => {
    if (area in SEVEN_AREAS && title.trim() && body.trim()) {
      memories.push({ area: area as SevenArea, title: title.trim(), body: body.trim() });
    }
    return '';
  }).trim();
  return { clean, memories };
}
