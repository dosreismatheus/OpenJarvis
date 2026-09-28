import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { PCFShadowMap } from 'three';
import { Activity, ArrowLeft, ArrowUpRight, Building2, Check, ChevronRight, CircleAlert, Compass, Layers3, Maximize2, Minus, MousePointer2, Plus, RotateCcw, Users, X } from 'lucide-react';
import { Link } from 'react-router';
import type { SquadConnection } from '../lib/squads';
import { AGENT_STATUS, SevenCampusScene, agentColor, type CampusArea, type CampusHover } from './SevenCampusScene';
import './SevenCampus.css';

type View = { kind: 'campus' } | { kind: 'area'; id: string } | { kind: 'squad'; id: string };

const AREAS: CampusArea[] = [
  { id: 'gestores', name: 'Coordenação das Squads', floor: 1, description: 'O ponto de encontro dos gestores com o Seven. Cada gestor atua junto da sua squad, na própria VPS.', people: 'Gestores das squads', status: 'Conectada às squads', color: '#c4b9bb' },
  { id: 'vendas', name: 'Vendas', floor: 2, description: 'Relacionamentos, propostas comerciais, negociação e fechamento.', people: 'Área comercial', status: 'Estrutura definida', color: '#d5676d' },
  { id: 'marketing', name: 'Marketing', floor: 3, description: 'Marca, conteúdo e campanhas que aproximam a Seven Build de novas oportunidades.', people: 'Área de marketing', status: 'Estrutura definida', color: '#e24f55' },
  { id: 'produto', name: 'Produto e Estratégia', floor: 4, description: 'Prioridades, direção dos produtos e os resultados que queremos construir.', people: 'Você e Seven', status: 'Estrutura definida', color: '#d9989d' },
  { id: 'administrativo', name: 'Administrativo', floor: 5, description: 'Financeiro, notas fiscais, boletos, pagamentos e operações burocráticas.', people: 'Área corporativa', status: 'Em estruturação', color: '#b3b3bb' },
  { id: 'diretoria', name: 'Diretoria', floor: 6, description: 'Você dirige a Seven Build. O Seven atua como CTO, junto do Overclaw e sua squad.', people: 'Você · Seven · Overclaw', status: 'Direção central', color: '#ef6d70' },
];

function formatUpdate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Sem atualização registrada';
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function SevenCampus({ squads, onConnect }: { squads: SquadConnection[]; onConnect: () => void }) {
  const [view, setView] = useState<View>({ kind: 'campus' });
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [hover, setHover] = useState<CampusHover>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [tab, setTab] = useState<'agents' | 'tasks'>('agents');
  const [cameraRevision, setCameraRevision] = useState(0);
  const [zoomCommand, setZoomCommand] = useState({ step: 0, revision: 0 });
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const selectedAgentRef = useRef<HTMLDivElement>(null);
  const interior = view.kind !== 'campus';
  const area = view.kind === 'area' ? AREAS.find(item => item.id === view.id) : undefined;
  const squad = view.kind === 'squad' ? squads.find(item => item.id === view.id) : undefined;
  const agents = squad?.data?.agents || [];
  const cards = squad?.data?.board.cards || [];
  const selectedAgent = agents.find(agent => agent.id === selectedAgentId);
  const online = squads.filter(item => item.online).length;
  const working = squads.reduce((total, item) => total + (item.data?.agents.filter(agent => agent.status === 'working').length || 0), 0);
  const blocked = squads.reduce((total, item) => total + (item.data?.agents.filter(agent => agent.status === 'blocked').length || 0), 0);

  function navigate(next: View) {
    setView(next); setHover(null); setDirectoryOpen(false); setSelectedAgentId(null); setTab('agents');
    setZoomCommand({ step: 0, revision: 0 });
  }
  function inspectAgent(id: string) { setSelectedAgentId(id); setTab('agents'); setHover(null); }
  function zoom(step: number) { setZoomCommand(current => ({ step, revision: current.revision + 1 })); }
  function resetCamera() { setZoomCommand({ step: 0, revision: 0 }); setCameraRevision(current => current + 1); }

  useEffect(() => {
    document.body.style.cursor = hover ? 'pointer' : '';
    return () => { document.body.style.cursor = ''; };
  }, [hover]);
  useEffect(() => {
    if (!selectedAgentId || tab !== 'agents' || !selectedAgentRef.current) return;
    panelScrollRef.current?.scrollTo({
      top: Math.max(0, selectedAgentRef.current.offsetTop - 12),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }, [selectedAgentId, tab]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (directoryOpen) setDirectoryOpen(false);
      else { setView({ kind: 'campus' }); setHover(null); setSelectedAgentId(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [directoryOpen]);

  return <section className={'seven-campus' + (interior ? ' is-interior' : '')} aria-label="Campus interativo da Seven Build">
    <div className="campus-scene">
      <Canvas key={(interior ? 'interior' : 'campus') + cameraRevision} orthographic
        camera={{ position: interior ? [10,10,12] : [15,14,18], zoom: 34, near: .1, far: 120 }}
        shadows={{ type: PCFShadowMap }} dpr={[1,1.7]} frameloop="demand" gl={{ antialias: true, toneMappingExposure: 1.05 }}>
        <SevenCampusScene squads={squads} areas={AREAS} squad={squad} areaId={area?.id} interior={interior}
          selectedAgent={selectedAgentId} accent={area?.color || '#e10606'} zoomCommand={zoomCommand}
          onArea={id => navigate({ kind: 'area', id })} onSquad={id => navigate({ kind: 'squad', id })}
          onAgent={inspectAgent} onHover={setHover} />
      </Canvas>
    </div>

    <header className="campus-hud">
      <div className="campus-identity">
        <span className="campus-eyebrow"><span className="campus-brand-dot" /> SEVEN BUILD</span>
        <h1>{interior ? <><button type="button" onClick={() => navigate({ kind: 'campus' })} aria-label="Voltar ao campus"><ArrowLeft size={18} /></button>{area?.name || squad?.data?.name || squad?.name}</> : 'Campus'}</h1>
        <p>{interior ? (area ? 'Prédio central / ' + String(area.floor).padStart(2,'0') + 'º andar' : 'Espaço da equipe') : 'Pessoas, ideias e operações conectadas.'}</p>
      </div>
      {!interior && <div className="campus-hud-actions">
        <div className="campus-overview" aria-label="Resumo das squads">
          <span><i className={online ? 'is-online' : ''} /><strong>{online}/{squads.length}</strong> online</span>
          <span><Activity size={13} /><strong>{working}</strong> em atividade</span>
          {blocked > 0 && <span className="campus-attention"><CircleAlert size={13} /><strong>{blocked}</strong> bloqueados</span>}
        </div>
        <button type="button" className="campus-connect" onClick={onConnect}><Plus size={15} /><span>Conectar squad</span></button>
      </div>}
    </header>

    {directoryOpen && <nav id="campus-directory" className="campus-directory" aria-label="Locais do campus">
      <div className="campus-directory-heading"><span>Explorar campus</span><button type="button" aria-label="Fechar locais" onClick={() => setDirectoryOpen(false)}><X size={15} /></button></div>
      <p>PRÉDIO CENTRAL</p>
      {[...AREAS].reverse().map(item => <button type="button" className="campus-location" key={item.id} onClick={() => navigate({ kind: 'area', id: item.id })}>
        <span className="campus-floor-index">{String(item.floor).padStart(2,'0')}</span><span>{item.name}</span><ChevronRight size={13} />
      </button>)}
      <p>SQUADS <span>{squads.length}</span></p>
      {squads.length ? squads.map(item => <button type="button" className="campus-location" key={item.id} onClick={() => navigate({ kind: 'squad', id: item.id })}>
        <span className={'campus-location-icon' + (item.online ? ' is-online' : '')}><Building2 size={15} /></span><span>{item.data?.name || item.name}</span><ChevronRight size={13} />
      </button>) : <small className="campus-directory-empty">Conecte sua primeira squad.</small>}
    </nav>}

    {!interior && squads.length === 0 && <div className="campus-empty">
      <Building2 size={23} /><strong>Um lugar para cada equipe.</strong><p>Conecte uma squad para abrir sua sede no campus.</p>
      <button type="button" onClick={onConnect}>Conectar primeira squad <ArrowUpRight size={14} /></button>
    </div>}

    <footer className="campus-toolbar">
      <button type="button" className={'campus-explore' + (directoryOpen ? ' is-active' : '')} aria-expanded={directoryOpen} aria-controls="campus-directory" onClick={() => setDirectoryOpen(value => !value)}>
        <Layers3 size={16} /><span>Explorar</span><span className="campus-explore-count">{AREAS.length + squads.length}</span>
      </button>
      <div className={'campus-guide' + (hover ? ' is-hovering' : '')} aria-live="polite">
        {hover ? <><i style={{ background: hover.color }} /><span><strong>{hover.title}</strong><small>{hover.detail}</small></span><ArrowUpRight size={17} /></> :
          <><MousePointer2 size={15} /><span>{squad ? 'Selecione um agente para acompanhar' : area ? 'Explore os andares pelo menu' : 'Selecione um prédio para explorar'}<small>Arraste para girar · Role para aproximar</small></span></>}
      </div>
      <div className="campus-camera-tools" aria-label="Controles da câmera">
        <button type="button" onClick={() => zoom(-1)} aria-label="Afastar câmera" title="Afastar"><Minus size={16} /></button>
        <button type="button" onClick={() => zoom(1)} aria-label="Aproximar câmera" title="Aproximar"><Plus size={16} /></button>
        <span />
        <button type="button" onClick={resetCamera} aria-label="Restaurar câmera" title="Restaurar visão"><Maximize2 size={15} /></button>
      </div>
    </footer>
    {!interior && <div className="campus-compass" aria-hidden="true"><Compass size={21} /><span>VISÃO DO CAMPUS</span></div>}

    {interior && <aside className={'campus-panel' + (squad ? ' is-squad' : '')} aria-label={area?.name || squad?.name || 'Detalhes'}>
      <div className="campus-panel-scroll" ref={panelScrollRef}>
        <div className="campus-panel-top"><span className="campus-eyebrow">{area ? 'PRÉDIO CENTRAL' : 'SEDE DA SQUAD'}</span><button type="button" aria-label="Fechar detalhes e voltar ao campus" onClick={() => navigate({ kind: 'campus' })}><X size={17} /></button></div>
        {area ? <>
          <div className="campus-area-icon" style={{ color: area.color }}><Building2 size={24} /><span>{String(area.floor).padStart(2,'0')}</span></div>
          <h2>{area.name}</h2><p className="campus-description">{area.description}</p>
          <div className="campus-area-facts"><div><span>Responsáveis</span><strong>{area.people}</strong></div><div><span>Organização</span><strong>{area.status}</strong></div></div>
          {(area.id === 'gestores' || area.id === 'diretoria') ? <section className="campus-panel-section">
            <h3>Conexão com as squads <span>{squads.length}</span></h3>
            {squads.length ? squads.map(item => <button type="button" className="campus-squad-link" key={item.id} onClick={() => navigate({ kind: 'squad', id: item.id })}>
              <span className="campus-squad-icon"><Building2 size={18} /></span><span><strong>{item.data?.name || item.name}</strong><small><i className={item.online ? 'is-online' : ''} />{item.online ? 'Conectada' : 'Indisponível'}</small></span><ArrowUpRight size={16} />
            </button>) : <p className="campus-muted">Nenhuma squad conectada ainda.</p>}
          </section> : <div className="campus-note"><Layers3 size={17} /><span>Espaço reservado.<small>A atividade desta área ainda não está conectada.</small></span></div>}
          <section className="campus-panel-section"><h3>Andares do prédio</h3><div className="campus-floor-switcher">
            {AREAS.map(item => <button type="button" key={item.id} className={item.id === area.id ? 'is-active' : ''} aria-pressed={item.id === area.id} aria-label={item.name + ', andar ' + item.floor} title={item.name} onClick={() => navigate({ kind: 'area', id: item.id })}>{String(item.floor).padStart(2,'0')}</button>)}
          </div></section>
        </> : squad ? <>
          <div className={'campus-connection' + (squad.online ? ' is-online' : '')}><i />{squad.online ? 'Servidor conectado' : 'Servidor indisponível'}</div>
          <h2>{squad.data?.name || squad.name}</h2><p className="campus-description">{squad.data?.description || 'O espaço de trabalho da sua equipe.'}</p>
          {!squad.online && squad.error && <div className="campus-note is-warning"><CircleAlert size={16} /><span>{squad.error}</span></div>}
          <div className="campus-metrics"><div><strong>{agents.length}</strong><span>Agentes</span></div><div><strong>{agents.filter(agent => agent.status === 'working').length}</strong><span>Em atividade</span></div><div><strong>{cards.length}</strong><span>Demandas</span></div></div>
          <div className="campus-panel-tabs" role="tablist" aria-label="Informações da squad">
            <button type="button" role="tab" aria-selected={tab === 'agents'} aria-controls="campus-agents" id="campus-agents-tab" onClick={() => setTab('agents')}><Users size={14} /> Equipe <span>{agents.length}</span></button>
            <button type="button" role="tab" aria-selected={tab === 'tasks'} aria-controls="campus-tasks" id="campus-tasks-tab" onClick={() => setTab('tasks')}><Layers3 size={14} /> Demandas <span>{cards.length}</span></button>
          </div>
          {tab === 'agents' ? <div id="campus-agents" role="tabpanel" aria-labelledby="campus-agents-tab">
            {selectedAgent && <div className="campus-selected-agent" ref={selectedAgentRef}>
              <div><span className="campus-eyebrow">ACOMPANHANDO</span><button type="button" aria-label="Limpar seleção do agente" onClick={() => setSelectedAgentId(null)}><X size={13} /></button></div>
              <strong>{selectedAgent.name}</strong><p>{selectedAgent.summary || selectedAgent.task || 'Nenhuma atualização detalhada.'}</p>
            </div>}
            {agents.length ? agents.map((agent, index) => <button type="button" className={'campus-agent' + (agent.id === selectedAgentId ? ' is-selected' : '')} aria-pressed={agent.id === selectedAgentId} key={agent.id} onClick={() => inspectAgent(agent.id)}>
              <span className={'campus-avatar tone-' + index % 4}>{agent.name.slice(0,2).toUpperCase()}<i style={{ background: agentColor(agent.status) }} /></span>
              <span className="campus-agent-copy"><span><strong>{agent.name}</strong><small style={{ color: agentColor(agent.status) }}>{AGENT_STATUS[agent.status]}</small></span><em>{agent.role}</em><p>{agent.task || (agent.status === 'idle' ? 'Disponível para a próxima demanda.' : 'Sem tarefa registrada.')}</p></span>
              {agent.id === selectedAgentId ? <Check size={13} /> : <ChevronRight size={13} />}
            </button>) : <p className="campus-muted">Nenhum agente registrado nesta squad.</p>}
          </div> : <div id="campus-tasks" role="tabpanel" aria-labelledby="campus-tasks-tab">
            {cards.length ? cards.map(card => <article className="campus-task" key={card.id}><span className={'campus-task-dot' + (card.column === 'bloqueado' ? ' is-blocked' : '')} /><div><strong>{card.title}</strong><p>{squad.data?.board.columns.find(column => column.id === card.column)?.name || card.column}{card.assignee ? ' · ' + (agents.find(agent => agent.id === card.assignee)?.name || card.assignee) : ''}</p></div></article>) : <p className="campus-muted">Nenhuma demanda registrada.</p>}
          </div>}
        </> : <p className="campus-muted">Esta squad não está mais disponível.</p>}
      </div>
      <div className="campus-panel-footer">{squad ? <><span><RotateCcw size={11} /> Atualização {formatUpdate(squad.data?.updated_at)}</span><Link to={'/squads/' + squad.id}>Abrir operação completa <ArrowUpRight size={16} /></Link></> :
        <button type="button" onClick={() => navigate({ kind: 'campus' })}><ArrowLeft size={15} /> Voltar ao campus</button>}</div>
    </aside>}
  </section>;
}
