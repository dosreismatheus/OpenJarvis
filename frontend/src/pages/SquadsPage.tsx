import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ArrowUpRight, BookOpen, Boxes, ChevronRight, Circle, GitBranch, Plus, RefreshCw, Server, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { addSquad, getSquadBrain, listSquads, removeSquad, resumeSquadRequest, reviewSquadRequest, saveSquadBrainNote, sendSquadRequest, type SquadBrainNote, type SquadConnection, type SquadAgent, type SquadCard } from '../lib/squads';
import { SquadBrainMap } from '../components/SquadBrainMap';
import './SquadsPage.css';

const agentStatus: Record<SquadAgent['status'], string> = { idle: 'Disponível', working: 'Trabalhando', blocked: 'Bloqueado', review: 'Em revisão' };

function safeLink(value: string): string | undefined {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? value : undefined; }
  catch { return undefined; }
}

function formatMoment(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : value;
}

function CardDetailsDialog({ card, columns, agents, notes, onClose }: {
  card: SquadCard;
  columns: { id: string; name: string }[];
  agents: SquadAgent[];
  notes: SquadBrainNote[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  const columnName = (id: string | null) => columns.find((column) => column.id === id)?.name || id || 'Início';
  const blockedEvent = [...(card.history || [])].reverse().find((event) => event.to === 'bloqueado');
  const relatedNotes = notes.filter((note) => note.path === `demandas/${card.id}.md` || note.path.startsWith(`demandas/${card.id}/`) || note.path === `produto/${card.id}.md`);
  const assignee = agents.find((agent) => agent.id === card.assignee)?.name || (card.column === 'humano' ? 'Matheus' : 'Sem responsável');
  return <div className="squads-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="squads-card-dialog" role="dialog" aria-modal="true" aria-labelledby="squads-card-dialog-title">
      <header className="squads-card-dialog-header"><div><span className="squads-kicker">DETALHES DA DEMANDA</span><h2 id="squads-card-dialog-title">{card.title}</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Fechar detalhes"><X size={19} /></button></header>
      <div className="squads-card-dialog-meta"><span>Etapa: <strong>{columnName(card.column)}</strong></span><span>Responsável: <strong>{assignee}</strong></span><span>Atualizada: <strong>{formatMoment(card.updated_at)}</strong></span></div>
      <section><h3>Pedido</h3><p className="squads-card-dialog-text">{card.description || 'A demanda não tem descrição.'}</p></section>
      {card.column === 'bloqueado' && <section className="squads-card-block-reason"><h3>Motivo do bloqueio</h3><p>{blockedEvent?.evidence || 'A squad não registrou um motivo para este bloqueio.'}</p>{blockedEvent && <small>{blockedEvent.by} · {formatMoment(blockedEvent.at)}</small>}</section>}
      <section><h3>Histórico</h3>{card.history?.length ? <ol className="squads-card-history">{[...card.history].reverse().map((event, index) => <li key={`${event.at}-${index}`}><div><strong>{columnName(event.from)} → {columnName(event.to)}</strong><span>{formatMoment(event.at)}</span></div><small>{event.by}</small><p>{event.evidence || 'Sem observações registradas.'}</p></li>)}</ol> : <p className="squads-card-dialog-muted">Ainda não há histórico registrado.</p>}</section>
      {relatedNotes.length > 0 && <section><h3>Notas da demanda</h3><div className="squads-card-note-list">{relatedNotes.map((note) => <details key={note.path}><summary>{note.title}</summary><pre>{note.content}</pre></details>)}</div></section>}
      {card.links.some((link) => safeLink(link)) && <section><h3>Referências</h3><div className="squads-card-reference-list">{card.links.filter((link) => safeLink(link)).map((link) => <a key={link} href={link} target="_blank" rel="noreferrer">{link}<ArrowUpRight size={14} /></a>)}</div></section>}
    </section>
  </div>;
}

export function SquadsPage() {
  const { squadId } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<SquadConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', url: '', token_env: '', command_token_env: '' });
  const [request, setRequest] = useState({ title: '', details: '' });
  const [requestStatus, setRequestStatus] = useState('');
  const [brainNotes, setBrainNotes] = useState<SquadBrainNote[]>([]);
  const [brainError, setBrainError] = useState('');
  const [brainQuery, setBrainQuery] = useState('');
  const [selectedNote, setSelectedNote] = useState('');
  const [brainEditor, setBrainEditor] = useState<'closed' | 'edit' | 'new'>('closed');
  const [brainTitle, setBrainTitle] = useState('');
  const [brainDraft, setBrainDraft] = useState('');
  const [reviewFeedback, setReviewFeedback] = useState<Record<string, string>>({});
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === squadId);
  const snapshot = selected?.data;
  const openCard = snapshot?.board.cards.find((card) => card.id === openCardId);

  const refresh = useCallback(async () => {
    try { setItems(await listSquads()); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as squads.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!squadId) { setBrainNotes([]); return; }
    let active = true;
    const load = async () => {
      try { const notes = await getSquadBrain(squadId); if (active) { setBrainNotes(notes); setBrainError(''); } }
      catch (cause) { if (active) setBrainError(cause instanceof Error ? cause.message : 'Não foi possível carregar o cérebro da squad.'); }
    };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [squadId]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try { await addSquad(form); setShowForm(false); setForm({ id: '', name: '', url: '', token_env: '', command_token_env: '' }); await refresh(); navigate(`/squads/${form.id}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível cadastrar a squad.'); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Desconectar esta squad do Seven? O repositório e o servidor continuarão intactos.')) return;
    try { await removeSquad(id); navigate('/squads'); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível desconectar.'); }
  };

  const sendRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!squadId || !request.title.trim()) return;
    setSaving(true); setRequestStatus('');
    try { await sendSquadRequest(squadId, request); setRequest({ title: '', details: '' }); setRequestStatus('Demanda enviada à fila do gestor.'); await refresh(); }
    catch (cause) { setRequestStatus(cause instanceof Error ? cause.message : 'Não foi possível enviar a demanda.'); }
    finally { setSaving(false); }
  };

  const review = async (requestId: string, approved: boolean) => {
    if (!squadId || !reviewFeedback[requestId]?.trim()) { setError('Descreva o resultado do teste humano antes de enviar.'); return; }
    setSaving(true);
    try { await reviewSquadRequest(squadId, requestId, approved, reviewFeedback[requestId].trim()); setReviewFeedback((current) => ({ ...current, [requestId]: '' })); setError(''); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível registrar sua avaliação.'); }
    finally { setSaving(false); }
  };

  const resume = async (requestId: string) => {
    if (!squadId || !reviewFeedback[requestId]?.trim()) { setError('Explique como o bloqueio foi resolvido antes de retomar.'); return; }
    setSaving(true);
    try { await resumeSquadRequest(squadId, requestId, reviewFeedback[requestId].trim()); setReviewFeedback((current) => ({ ...current, [requestId]: '' })); setError(''); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível retomar a demanda.'); }
    finally { setSaving(false); }
  };

  const saveContext = async () => {
    if (!squadId || !brainDraft.trim()) return;
    const slug = brainTitle.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
    const path = brainEditor === 'new' ? `contexto/${slug}.md` : selectedNote || '00-visao.md';
    if (brainEditor === 'new' && !slug) { setBrainError('Informe um título para a nova nota.'); return; }
    setSaving(true);
    try {
      const content = brainEditor === 'new' ? `# ${brainTitle.trim()}\n\n${brainDraft.trim()}` : brainDraft;
      await saveSquadBrainNote(squadId, path, content);
      setBrainNotes(await getSquadBrain(squadId));
      setSelectedNote(path); setBrainEditor('closed'); setBrainTitle(''); setBrainDraft(''); setBrainError('');
    } catch (cause) { setBrainError(cause instanceof Error ? cause.message : 'Não foi possível salvar a nota.'); }
    finally { setSaving(false); }
  };

  const visibleNotes = brainNotes.filter((note) => `${note.title} ${note.path} ${note.content}`.toLowerCase().includes(brainQuery.toLowerCase()));
  const activeNote = brainNotes.find((note) => note.path === selectedNote) || visibleNotes[0];

  return <div className="squads-page">
    <header className="squads-topbar"><Link to="/" className="squads-brand"><img src="/seven/7build-mark.svg" alt="" /> SEVEN <span>/ SQUADS</span></Link><div><Link to="/brain" className="squads-text-link">Segundo cérebro</Link><button type="button" onClick={() => void refresh()} aria-label="Atualizar"><RefreshCw size={17} /></button></div></header>
    <main className="squads-content">
      <div className="squads-heading"><div>{squadId && <Link to="/squads" className="squads-back"><ArrowLeft size={15} /> Todas as squads</Link>}<div className="squads-kicker"><Boxes size={15} /> OPERAÇÃO</div><h1>{snapshot?.name || selected?.name || 'Squads'}</h1><p>{snapshot?.description || (squadId ? 'Acompanhamento em tempo real da equipe.' : 'Acompanhe cada equipe, seu trabalho e seus ambientes em um só lugar.')}</p></div><div className="squads-heading-actions"><button type="button" onClick={() => setShowForm(true)} className="squads-primary"><Plus size={16} /> Conectar squad</button></div></div>
      {error && <div className="squads-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Fechar"><X size={15} /></button></div>}
      {loading ? <div className="squads-empty">Carregando squads...</div> : squadId ? (
        !selected ? <div className="squads-empty">Squad não encontrada. <Link to="/squads">Ver todas</Link></div> : <>
          <div className="squads-detail-meta"><span className={`squads-connection ${selected.online ? 'is-online' : ''}`}><i /> {selected.online ? 'Servidor conectado' : 'Servidor indisponível'}</span><span><Server size={14} /> {selected.url}</span><button type="button" onClick={() => void remove(selected.id)} title="Desconectar squad"><Trash2 size={15} /> Desconectar</button></div>
          {!snapshot ? <div className="squads-empty"><Server size={25} /><strong>Não foi possível consultar esta squad.</strong><span>{selected.error || 'Confira o servidor e tente atualizar.'}</span></div> : <>
            <div className="squads-links"><a href={safeLink(snapshot.repository)} target="_blank" rel="noreferrer"><GitBranch size={19} /><span>Repositório<strong>{snapshot.repository || 'Não configurado'}</strong></span><ArrowUpRight size={17} /></a><a href={safeLink(snapshot.environments.staging)} target="_blank" rel="noreferrer" aria-disabled={!safeLink(snapshot.environments.staging)}><Server size={19} /><span>Staging<strong>{snapshot.environments.staging || 'Ainda não configurado'}</strong></span><ArrowUpRight size={17} /></a><a href={safeLink(snapshot.environments.production)} target="_blank" rel="noreferrer" aria-disabled={!safeLink(snapshot.environments.production)}><ShieldCheck size={19} /><span>Produção<strong>{snapshot.environments.production || 'Ainda não configurado'}</strong></span><ArrowUpRight size={17} /></a></div>
            <form className="squads-request" onSubmit={(event) => void sendRequest(event)}><div><span className="squads-kicker">COMUNICAÇÃO COM A SQUAD</span><h2>Enviar demanda ao gestor</h2><p>O gestor receberá a demanda no backlog e coordenará os demais agentes.</p></div><div className="squads-request-fields"><input required maxLength={160} value={request.title} onChange={(event) => setRequest({ ...request, title: event.target.value })} placeholder="Título da demanda" aria-label="Título da demanda" /><textarea maxLength={4000} value={request.details} onChange={(event) => setRequest({ ...request, details: event.target.value })} placeholder="Contexto, objetivo e critérios de aceite" aria-label="Detalhes da demanda" rows={2} /><div><span role="status">{requestStatus}</span><button type="submit" className="squads-primary" disabled={saving || !request.title.trim()}>{saving ? 'Enviando...' : 'Enviar ao gestor'}</button></div></div></form>
            <section className="squads-section"><div className="squads-section-title"><h2><Users size={18} /> Agentes</h2><span>{snapshot.agents.filter((agent) => agent.status === 'working').length} trabalhando · {snapshot.agents.length} no total</span></div><div className="squads-agents">{snapshot.agents.map((agent) => <article key={agent.id} className="squads-agent"><div className="squads-agent-head"><div className="squads-agent-avatar">{agent.name.slice(0, 2).toUpperCase()}</div><div><h3>{agent.name}</h3><span>{agent.role}</span></div><span className={`squads-status status-${agent.status}`}><i /> {agentStatus[agent.status] || agent.status}</span></div><p>{agent.task || 'Nenhuma tarefa em andamento.'}</p>{agent.summary && <small>{agent.summary}</small>}</article>)}</div></section>
            <section className="squads-section">
              <div className="squads-section-title"><h2><Boxes size={18} /> Board da squad</h2><span>{snapshot.board.cards.length} cartões · atualização automática</span></div>
              <div className="squads-board">{snapshot.board.columns.map((column) => <div className="squads-column" key={column.id}>
                <div className="squads-column-head"><span>{column.name}</span><strong>{snapshot.board.cards.filter((card) => card.column === column.id).length}</strong></div>
                {snapshot.board.cards.filter((card) => card.column === column.id).map((card) => <div key={card.id} className="squads-board-item">
                  <button type="button" className="squads-card" onClick={() => setOpenCardId(card.id)} aria-label={`Abrir detalhes de ${card.title}`}>
                    <h3>{card.title}</h3>{card.description && <p>{card.description}</p>}
                    {card.column === 'bloqueado' && <p className="squads-card-block-summary">Motivo: {[...(card.history || [])].reverse().find((event) => event.to === 'bloqueado')?.evidence || 'Motivo não registrado'}</p>}
                    <span className="squads-card-preview-meta"><span>{snapshot.agents.find((agent) => agent.id === card.assignee)?.name || (card.column === 'humano' ? 'Matheus' : 'Sem responsável')}</span><span>Ver detalhes <ChevronRight size={14} /></span></span>
                  </button>
                  {card.links.some((link) => safeLink(link)) && <div className="squads-card-links">{card.links.filter((link) => safeLink(link)).map((link) => <a key={link} href={link} target="_blank" rel="noreferrer" title="Abrir referência"><ArrowUpRight size={14} /></a>)}</div>}
                  {(card.column === 'humano' || card.column === 'bloqueado') && <div className="squads-human-review squads-card-action"><label htmlFor={`review-${card.id}`}>{card.column === 'humano' ? 'Resultado do seu teste' : 'Como o bloqueio foi resolvido?'}</label><textarea id={`review-${card.id}`} value={reviewFeedback[card.id] || ''} onChange={(event) => setReviewFeedback((current) => ({ ...current, [card.id]: event.target.value }))} placeholder={card.column === 'humano' ? 'O que funcionou ou precisa ser corrigido?' : 'Informe a correção ou contexto para retomar'} maxLength={2000} rows={3} /><div>{card.column === 'humano' ? <><button type="button" disabled={saving} onClick={() => void review(card.id, false)}>Devolver ao PO</button><button type="button" disabled={saving} onClick={() => void review(card.id, true)}>Aprovar</button></> : <button type="button" disabled={saving} onClick={() => void resume(card.id)}>Retomar etapa</button>}</div></div>}
                </div>)}
              </div>)}</div>
            </section>
            <section className="squads-section">
              <div className="squads-section-title"><h2><BookOpen size={18} /> Cérebro da squad · Obsidian</h2><span>{brainNotes.length} {brainNotes.length === 1 ? 'nota compartilhada' : 'notas compartilhadas'}</span></div>
              <p className="squads-brain-intro">Contexto do produto, decisões e entregas ligados às demandas. Os rascunhos privados dos agentes não aparecem aqui.</p>
              {brainError && <div className="squads-error">{brainError}</div>}
              <SquadBrainMap notes={brainNotes} compact selectedPath={activeNote?.path} onSelect={(path) => { setSelectedNote(path); setBrainEditor('closed'); }} />
              <Link to={`/squads/${squadId}/brain`} className="squads-brain-open">Abrir mapa em página própria <ArrowUpRight size={15} /></Link>
              <div className="squads-brain">
                <aside><input value={brainQuery} onChange={(event) => setBrainQuery(event.target.value)} placeholder="Buscar notas" aria-label="Buscar notas da squad" /><button type="button" className="squads-brain-add" onClick={() => { setBrainEditor('new'); setBrainTitle(''); setBrainDraft(''); }}>+ Adicionar contexto</button>{visibleNotes.map((note) => <button type="button" key={note.path} onClick={() => { setSelectedNote(note.path); setBrainEditor('closed'); }} className={activeNote?.path === note.path ? 'active' : ''}><strong>{note.title}</strong><small>{note.path}</small></button>)}</aside>
                <article>{brainEditor !== 'closed' ? <div className="squads-brain-form">{brainEditor === 'new' && <label>Título<input value={brainTitle} onChange={(event) => setBrainTitle(event.target.value)} maxLength={80} placeholder="Ex.: Clientes e permissões" /></label>}<label>{brainEditor === 'new' ? 'Contexto' : `Editar ${activeNote?.title || 'Visão da squad'}`}<textarea value={brainDraft} onChange={(event) => setBrainDraft(event.target.value)} maxLength={20000} rows={12} /></label><div><button type="button" onClick={() => setBrainEditor('closed')}>Cancelar</button><button type="button" disabled={saving || !brainDraft.trim()} onClick={() => void saveContext()}>{saving ? 'Salvando...' : 'Salvar no cérebro'}</button></div></div> : activeNote ? <><span>{activeNote.path}</span><div className="squads-brain-note-head"><h3>{activeNote.title}</h3>{(activeNote.path === '00-visao.md' || activeNote.path.startsWith('contexto/')) && <button type="button" onClick={() => { setSelectedNote(activeNote.path); setBrainDraft(activeNote.content); setBrainEditor('edit'); }}>Editar contexto</button>}</div><pre>{activeNote.content}</pre>{activeNote.links.length > 0 && <div className="squads-brain-links">Relacionada a: {activeNote.links.map((link) => <button type="button" key={link} onClick={() => setSelectedNote(`${link}.md`)}>{link}</button>)}</div>}</> : <p>O cérebro desta squad ainda não tem notas.</p>}</article>
              </div>
            </section>
          </>}
        </>
      ) : items.length === 0 ? <div className="squads-empty"><Boxes size={28} /><strong>Nenhuma squad conectada ainda.</strong><span>Crie um repositório a partir do template e conecte o servidor da squad aqui.</span><a href="https://github.com/suhmah/seven-squad-template" target="_blank" rel="noreferrer">Abrir template no GitHub ↗</a><button type="button" className="squads-primary" onClick={() => setShowForm(true)}>Conectar primeira squad <ChevronRight size={15} /></button></div> : <div className="squads-grid">{items.map((item) => <Link to={`/squads/${item.id}`} className="squads-tile" key={item.id}><div className="squads-tile-top"><div className="squads-tile-icon"><Boxes size={22} /></div><span className={`squads-connection ${item.online ? 'is-online' : ''}`}><i />{item.online ? 'Conectada' : 'Indisponível'}</span></div><h2>{item.data?.name || item.name}</h2><p>{item.data?.description || item.error || 'Acompanhe a equipe e o board.'}</p><div className="squads-tile-foot"><span><Users size={15} /> {item.data?.agents.length ?? 0} agentes</span><span><Circle size={13} /> {item.data?.board.cards.length ?? 0} cartões</span><ChevronRight size={17} /></div></Link>)}</div>}
    </main>
    {openCard && snapshot && <CardDetailsDialog card={openCard} columns={snapshot.board.columns} agents={snapshot.agents} notes={brainNotes} onClose={() => setOpenCardId(null)} />}
    {showForm && <div className="squads-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false); }}><form className="squads-modal" onSubmit={(event) => void create(event)}><div className="squads-modal-head"><div><span className="squads-kicker">NOVA CONEXÃO</span><h2>Conectar squad</h2></div><button type="button" onClick={() => setShowForm(false)} aria-label="Fechar"><X size={18} /></button></div><p>O Seven consulta o servidor da squad e mostra o trabalho registrado por ela.</p><label>ID da squad<input required pattern="[a-z0-9][a-z0-9-]{1,62}" value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder="minha-squad" /></label><label>Nome<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Squad do produto" /></label><label>URL do servidor<input required type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="http://127.0.0.1:8761" /></label><label>Variável do token de leitura <small>opcional</small><input value={form.token_env} onChange={(event) => setForm({ ...form, token_env: event.target.value })} placeholder="SQUAD_MINHA_SQUAD_READ_TOKEN" /></label><label>Variável do token de demandas <small>opcional</small><input value={form.command_token_env} onChange={(event) => setForm({ ...form, command_token_env: event.target.value })} placeholder="SQUAD_MINHA_SQUAD_COMMAND_TOKEN" /></label><button type="submit" className="squads-primary" disabled={saving}>{saving ? 'Conectando...' : 'Conectar squad'}</button></form></div>}
  </div>;
}
