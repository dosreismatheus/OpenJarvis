import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ChevronRight, Minus, Plus, RotateCcw, Save, Search, Trash2, X } from 'lucide-react';
import { getSevenProfile, saveSevenProfile, sevenVoiceGender, SEVEN_AREAS, type SevenArea, type SevenNote, type SevenProfile } from '../lib/seven';
import './SevenSettings.css';

const field: React.CSSProperties = { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px', width: '100%', fontSize: 13 };
const initialRotation = { yaw: -.28, pitch: .18 };

function NoteGraph({ notes, onSelect }: { notes: SevenNote[]; onSelect: (note: SevenNote) => void }) {
  const shouldAutoRotate = notes.length <= 500;
  const rotationPeriodSeconds = 300 + notes.length * .54;
  const rotationRadiansPerMs = (Math.PI * 2) / (rotationPeriodSeconds * 1000);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const autoFitApplied = useRef(false);
  const [zoom, setZoom] = useState(1.15);
  const [entryProgress, setEntryProgress] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(initialRotation);
  const drag = useRef<{ mode: 'rotate' | 'pan'; x: number; y: number; yaw: number; pitch: number; panX: number; panY: number } | null>(null);
  const motionTime = useRef(0);
  useEffect(() => {
    let frame = 0;
    let previous = 0;
    let startedAt = 0;
    let lastEntryUpdate = 0;
    const animate = (time: number) => {
      if (!startedAt) startedAt = time;
      const entryTime = Math.min(1, (time - startedAt) / 2200);
      if (entryTime < 1 && (!lastEntryUpdate || time - lastEntryUpdate >= 32)) {
        const easedEntry = 1 - Math.pow(1 - entryTime, 3);
        setEntryProgress(easedEntry);
        lastEntryUpdate = time;
      } else if (entryTime === 1 && lastEntryUpdate) {
        setEntryProgress(1);
        lastEntryUpdate = 0;
      }
      if (previous && shouldAutoRotate && !drag.current && !hoveredIdRef.current) {
        motionTime.current += time - previous;
        if (motionTime.current >= 32) {
          const elapsed = motionTime.current;
          motionTime.current = 0;
          setRotation((current) => hoveredIdRef.current || drag.current
            ? current
            : { ...current, yaw: current.yaw + elapsed * rotationRadiansPerMs });
        }
      }
      previous = time;
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [rotationRadiansPerMs, shouldAutoRotate]);
  const positions = useMemo(() => {
    const sorted = [...notes].sort((a, b) => a.area.localeCompare(b.area) || b.links.length - a.links.length || a.title.localeCompare(b.title, 'pt-BR'));
    const golden = Math.PI * (3 - Math.sqrt(5));
    const areaGroups = new Map<string, SevenNote[]>();
    for (const note of sorted) areaGroups.set(note.area, [...(areaGroups.get(note.area) || []), note]);
    const areas = [...areaGroups.keys()];
    const areaIndexes = new Map(areas.map((area) => [area, new Map((areaGroups.get(area) || []).map((note, index) => [note.id, index]))]));
    const clusterRadius = sorted.length > 600 ? 520 : 270;
    const centers = new Map(areas.map((area, index) => {
      const fraction = (index + .5) / areas.length;
      const vertical = 1 - 2 * fraction;
      const around = Math.sqrt(1 - vertical * vertical);
      const angle = index * golden + .35;
      return [area, { x: Math.cos(angle) * around * clusterRadius, y: Math.sin(angle) * around * clusterRadius * .72, z: vertical * clusterRadius }];
    }));
    const cloud = sorted.map((note) => {
      const group = areaGroups.get(note.area) || [note];
      const index = areaIndexes.get(note.area)?.get(note.id) || 0;
      const center = centers.get(note.area) || { x: 0, y: 0, z: 0 };
      const fraction = (index + .5) / group.length;
      const localRadius = 30 + Math.min(180, Math.sqrt(group.length) * 18);
      const vertical = 1 - 2 * fraction;
      const around = Math.sqrt(1 - vertical * vertical);
      const angle = index * golden + (areas.indexOf(note.area) * .71);
      const weight = Math.min(1.7, 1 + note.links.length * .055);
      return { note, x: center.x + Math.cos(angle) * around * localRadius * weight, y: center.y + Math.sin(angle) * around * localRadius * .82 * weight, z: center.z + vertical * localRadius * .7 };
    });
    const yawCos = Math.cos(rotation.yaw);
    const yawSin = Math.sin(rotation.yaw);
    const pitchCos = Math.cos(rotation.pitch);
    const pitchSin = Math.sin(rotation.pitch);
    const focal = 1040;
    return cloud.map((point) => {
      const rotatedX = point.x * yawCos + point.z * yawSin;
      const rotatedZ = -point.x * yawSin + point.z * yawCos;
      const rotatedY = point.y * pitchCos - rotatedZ * pitchSin;
      const depth = point.y * pitchSin + rotatedZ * pitchCos;
      const perspective = focal / (focal - depth);
      return { ...point, x: 600 + rotatedX * perspective, y: 400 + rotatedY * perspective, depth, perspective };
    }).sort((a, b) => a.depth - b.depth);
  }, [notes, rotation]);
  const fitView = useMemo(() => {
    if (!positions.length) return { zoom: 1.15, pan: { x: 0, y: 0 } };
    const minX = Math.min(...positions.map(({ x }) => x));
    const maxX = Math.max(...positions.map(({ x }) => x));
    const minY = Math.min(...positions.map(({ y }) => y));
    const maxY = Math.max(...positions.map(({ y }) => y));
    const width = maxX - minX + 48;
    const height = maxY - minY + 48;
    const shapeFitZoom = Math.min(4, Math.max(.35, Math.min(1040 / width, 600 / height) * 1.5));
    return {
      zoom: shapeFitZoom * .8,
      pan: { x: 600 - (minX + maxX) / 2, y: 400 - (minY + maxY) / 2 },
    };
  }, [positions]);
  useEffect(() => {
    if (!notes.length || autoFitApplied.current) return;
    autoFitApplied.current = true;
    setZoom(fitView.zoom);
    setPan(fitView.pan);
  }, [fitView, notes.length]);
  const byId = new Map(positions.map((position) => [position.note.id, position]));
  const seenLinks = new Set<string>();
  const links = positions.flatMap((source) => source.note.links.map((id) => {
    const target = byId.get(id);
    const key = [source.note.id, id].sort().join(':');
    if (!target || seenLinks.has(key)) return null;
    seenLinks.add(key);
    return { source, target };
  }).filter((edge): edge is { source: typeof source; target: typeof source } => edge !== null));
  const focused = byId.get(hoveredId || activeId || '')?.note;
  const detailNote = byId.get(activeId || '')?.note;
  const connected = new Set(links.filter(({ source, target }) => source.note.id === focused?.id || target.note.id === focused?.id)
    .flatMap(({ source, target }) => [source.note.id, target.note.id]));
  const related = detailNote ? notes.filter((note) => note.id !== detailNote.id && (detailNote.links.includes(note.id) || note.links.includes(detailNote.id))) : [];

  const entryScale = .72 + .28 * entryProgress;
  const transform = `translate(${pan.x} ${pan.y}) translate(600 400) scale(${zoom * entryScale}) translate(-600 -400)`;
  const changeZoom = (amount: number) => setZoom((value) => Math.min(12, Math.max(.28, value + amount)));
  const selectNote = (id: string | null) => {
    setActiveId(id);
    if (id) { hoveredIdRef.current = null; setHoveredId(null); }
  };
  const resetView = () => { setZoom(fitView.zoom); setPan(fitView.pan); setRotation(initialRotation); selectNote(null); };
  const zoomAtCursor = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointX = (event.clientX - bounds.left) * 1200 / bounds.width;
    const pointY = (event.clientY - bounds.top) * 800 / bounds.height;
    const nextZoom = Math.min(12, Math.max(.28, zoom + (event.deltaY < 0 ? .12 : -.12)));
    const difference = zoom - nextZoom;
    setPan((currentPan) => ({ x: currentPan.x + difference * (pointX - 600), y: currentPan.y + difference * (pointY - 400) }));
    setZoom(nextZoom);
  };
  const startDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest('.seven-graph-node')) return;
    const mode = event.shiftKey || event.button === 1 ? 'pan' : 'rotate';
    drag.current = { mode, x: event.clientX, y: event.clientY, yaw: rotation.yaw, pitch: rotation.pitch, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const moveDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current) return;
    const deltaX = event.clientX - current.x;
    const deltaY = event.clientY - current.y;
    if (current.mode === 'rotate') {
      setRotation({ yaw: current.yaw + deltaX * .006, pitch: Math.max(-1.25, Math.min(1.25, current.pitch - deltaY * .005)) });
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(box.width / 1200, box.height / 800);
    setPan({ x: current.panX + deltaX / scale, y: current.panY + deltaY / scale });
  };
  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className="seven-brain-map seven-brain-map-fullscreen">
    <div className="seven-graph-toolbar" aria-label="Controles do mapa">
      <span>{notes.length} notas <i /> {links.length} conexões</span>
      <div><button type="button" onClick={() => changeZoom(-.2)} aria-label="Diminuir zoom" title="Diminuir zoom"><Minus size={16} /></button><button type="button" onClick={resetView} aria-label="Redefinir mapa" title="Redefinir mapa"><RotateCcw size={15} /></button><span className="seven-graph-zoom-level" aria-live="polite">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => changeZoom(.2)} aria-label="Aumentar zoom" title="Aumentar zoom"><Plus size={16} /></button></div>
    </div>
    <div className="seven-graph-wrap">
      <svg viewBox="0 0 1200 800" role="group" aria-label="Mapa 3D conectado das notas pessoais" className="seven-graph" onWheel={zoomAtCursor} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; }}>
        <g transform={transform} opacity={entryProgress}>
        <g className={`seven-graph-focus-layer ${shouldAutoRotate ? '' : 'seven-graph-autospin'} ${hoveredId ? 'is-paused' : ''}`} style={{ '--seven-graph-spin-duration': `${rotationPeriodSeconds}s` } as React.CSSProperties}>
          {links.map(({ source, target }) => <path key={`${source.note.id}-${target.note.id}`} d={`M ${source.x} ${source.y} L ${target.x} ${target.y}`} className={`seven-graph-line ${notes.length > 500 ? 'seven-graph-line-dense' : ''} ${source.note.id === focused?.id || target.note.id === focused?.id ? 'seven-graph-line-active' : ''}`} />)}
          {positions.map(({ note, x, y, depth, perspective }) => {
          const color = SEVEN_AREAS[note.area]?.color || '#9ca3af';
          const selected = note.id === activeId;
          const showTitle = note.id === hoveredId || selected;
          const relatedNode = focused && !selected && connected.has(note.id);
          return <g key={note.id} role="button" tabIndex={0} aria-label={`Explorar nota ${note.title}`} aria-pressed={note.id === activeId} onMouseEnter={() => { hoveredIdRef.current = note.id; setHoveredId(note.id); }} onMouseLeave={() => { hoveredIdRef.current = null; setHoveredId(null); }} onFocus={() => { hoveredIdRef.current = note.id; setHoveredId(note.id); }} onBlur={() => { hoveredIdRef.current = null; setHoveredId(null); }} onClick={() => selectNote(note.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNote(note.id); } }} className={`seven-graph-node ${selected ? 'seven-graph-node-active' : ''} ${relatedNode ? 'seven-graph-node-connected' : ''} ${focused && !selected && !relatedNode ? 'seven-graph-node-muted' : ''}`}>
            <circle cx={x} cy={y} r="17" fill="transparent" />
            <circle cx={x} cy={y} r={Math.min(10, (3 + Math.sqrt(note.links.length) * .82) * perspective)} fill={color} className="seven-brain-data-dot" style={{ opacity: Math.max(.34, Math.min(.94, .62 + depth / 1100)) }} />
            {showTitle && <text x={x} y={y - 22} textAnchor="middle" className="seven-graph-title">{note.title}</text>}
          </g>;
          })}
        </g>
        </g>
      </svg>
    </div>
    <div className="seven-graph-hint">Arraste para girar <i /> Shift + arraste para mover <i /> Role para zoom</div>
    {detailNote && <div className="seven-map-detail">
      <div className="seven-map-detail-top"><div><span style={{ color: SEVEN_AREAS[detailNote.area]?.color || '#9ca3af' }}>{SEVEN_AREAS[detailNote.area]?.label || detailNote.area}</span><h3>{detailNote.title}</h3></div><div className="seven-map-detail-actions"><button type="button" onClick={() => onSelect(detailNote)}>Editar <ChevronRight size={14} /></button><button type="button" onClick={() => selectNote(null)} aria-label="Fechar detalhes"><X size={16} /></button></div></div>
      <p>{detailNote.body.replace(/<!--[^]*?-->/g, '').replace(/\s+/g, ' ').slice(0, 180)}</p>
      <div className="seven-map-related"><span>Conectada a</span>{related.length ? related.map((note) => <button key={note.id} type="button" onClick={() => selectNote(note.id)}>{note.title}</button>) : <em>Nenhuma nota ainda</em>}</div>
    </div>}
  </div>;
}

export function SevenSettings({ mode = 'profile' }: { mode?: 'profile' | 'brain' | 'notes' }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [profile, setProfile] = useState<SevenProfile | null>(null);
  const [selected, setSelected] = useState<string | null>(searchParams.get('note'));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [area, setArea] = useState<SevenArea | 'all'>('all');
  useEffect(() => { getSevenProfile().then(setProfile).catch((error) => setStatus(error.message)); }, []);

  const save = async () => {
    if (!profile) return;
    setBusy(true); setStatus('');
    try {
      const latest = await getSevenProfile();
      const payload = mode === 'profile'
        ? { ...latest, name: profile.name, address: profile.address, persona: profile.persona, voice_enabled: profile.voice_enabled, voice_id: profile.voice_id, voice_speed: profile.voice_speed }
        : { ...profile, name: latest.name, address: latest.address, persona: latest.persona, voice_enabled: latest.voice_enabled, voice_id: latest.voice_id, voice_speed: latest.voice_speed };
      setProfile(await saveSevenProfile(payload));
      setStatus(mode === 'notes' ? 'Notas salvas no Obsidian.' : 'Perfil salvo neste computador.');
    }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Não consegui salvar.'); }
    finally { setBusy(false); }
  };
  const updateNote = (id: string, updates: Partial<SevenNote>) => {
    if (!profile) return;
    setProfile({ ...profile, notes: profile.notes.map((note) => note.id === id ? { ...note, ...updates } : note) });
  };
  const addNote = () => {
    if (!profile) return;
    const note: SevenNote = { id: crypto.randomUUID(), area: 'meta', title: 'Nova nota', body: 'Edite este conteúdo.', links: [] };
    setProfile({ ...profile, notes: [...profile.notes, note] }); setSelected(note.id);
  };
  const removeNote = (id: string) => {
    if (!profile) return;
    setProfile({ ...profile, notes: profile.notes.filter((note) => note.id !== id) });
    setSelected(null);
  };
  const activeNote = profile?.notes.find((note) => note.id === selected);
  const filteredNotes = profile?.notes.filter((note) => (area === 'all' || note.area === area) && `${note.title} ${note.body}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))) || [];
  const openEditor = (note: SevenNote) => {
    navigate(`/brain/notes?note=${encodeURIComponent(note.id)}`);
  };

  if (mode === 'profile') return <section className="rounded-xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
    <div className="flex items-center justify-between gap-3 mb-2"><h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Seven · perfil e voz</h3><Link to="/" className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-accent)' }}><ArrowLeft size={13} /> Voltar ao Seven</Link></div>
    <p className="text-xs mb-4" style={{ color: 'var(--color-text-secondary)' }}>Configure como o Seven responde. Suas notas ficam na página dedicada do Segundo Cérebro.</p>
    {!profile ? <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{status || 'Carregando...'}</p> : <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Nome do assistente<input style={field} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} maxLength={60} /></label>
        <label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Como chamar você<input style={field} value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} maxLength={60} /></label>
        <label className="text-xs sm:col-span-2" style={{ color: 'var(--color-text-secondary)' }}>Personalidade<input style={field} value={profile.persona} onChange={(e) => setProfile({ ...profile, persona: e.target.value })} maxLength={120} /></label>
      </div>
      <div className="flex flex-wrap items-end gap-3 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}><input type="checkbox" checked={profile.voice_enabled} onChange={(e) => setProfile({ ...profile, voice_enabled: e.target.checked })} /> Responder por voz</label>
        <label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Voz local<input style={{ ...field, width: 135 }} value={profile.voice_id} onChange={(e) => setProfile({ ...profile, voice_id: e.target.value })} placeholder="pm_faber" /><span style={{ display: 'block', marginTop: 5 }}>{profile.voice_id === 'pm_faber' ? 'Piper Faber · rápida · masculina' : profile.voice_id === 'pf_dora' ? 'Kokoro Dora · feminina' : sevenVoiceGender(profile.voice_id) === 'feminine' ? 'Feminina · ela/dela' : sevenVoiceGender(profile.voice_id) === 'masculine' ? 'Masculina · ele/dele' : 'Pronome não identificado'}</span></label>
        <label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Velocidade<input style={{ ...field, width: 90 }} type="number" min="0.5" max="2" step="0.1" value={profile.voice_speed} onChange={(e) => setProfile({ ...profile, voice_speed: Number(e.target.value) })} /></label>
      </div>
      <div className="seven-settings-brain-link"><div><strong>Segundo Cérebro</strong><span>{profile.notes.length} notas no Obsidian. Explore o mapa e edite as notas em páginas próprias.</span></div><Link to="/brain">Abrir Segundo Cérebro <ChevronRight size={15} /></Link></div>
      <div className="flex items-center justify-between mt-4 gap-3"><span role="status" className="text-xs" style={{ color: status.startsWith('Perfil salvo') ? 'var(--color-success)' : 'var(--color-error)' }}>{status}</span><button type="button" disabled={busy} onClick={() => void save()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}><Save size={14} /> {busy ? 'Salvando...' : 'Salvar perfil'}</button></div>
    </>}
  </section>;

  if (mode === 'brain') return <section className="seven-brain-map-page">
    {!profile ? <p className="seven-brain-loading">{status || 'Carregando notas...'}</p> : <>
      <Link className="seven-brain-map-back" to="/" aria-label="Voltar ao Seven"><ArrowLeft size={18} /></Link>
      <NoteGraph notes={profile.notes} onSelect={openEditor} />
    </>}
  </section>;

  return <section className="seven-brain-workspace seven-brain-notes-page">
    {!profile ? <p className="seven-brain-loading">{status || 'Carregando notas...'}</p> : <>
      <div className="seven-settings-brain-head"><div><span>SEGUNDO CÉREBRO · OBSIDIAN</span><h1>Notas pessoais</h1><p>Organize o conteúdo das notas. O mapa de relações tem uma página própria.</p></div><a href="obsidian://open?vault=Seven%20Brain">Abrir no Obsidian <ChevronRight size={15} /></a></div>
      <div className="seven-brain-toolbar"><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar notas e conteúdo" aria-label="Buscar notas" /></label><select value={area} onChange={(event) => setArea(event.target.value as SevenArea | 'all')} aria-label="Filtrar por área"><option value="all">Todas as áreas</option>{Object.entries(SEVEN_AREAS).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}</select><button type="button" onClick={addNote}><Plus size={15} /> Adicionar nota</button></div>
      <div className="seven-brain-notes-grid"><div className="seven-brain-notes-list">{filteredNotes.map((note) => <button key={note.id} type="button" onClick={() => setSelected(note.id)} className={selected === note.id ? 'active' : ''}><span style={{ background: SEVEN_AREAS[note.area]?.color || '#aaa' }} /><span><strong>{note.title}</strong><small>{SEVEN_AREAS[note.area]?.label || note.area}</small></span><ChevronRight size={14} /></button>)}{filteredNotes.length === 0 && <p className="seven-brain-empty">Nenhuma nota corresponde à busca.</p>}</div>
        <div className="seven-brain-editor-panel">{activeNote ? <div id="seven-note-editor" className="seven-brain-editor"><div className="seven-brain-editor-heading"><strong>Editar nota</strong><button type="button" onClick={() => setSelected(null)}>Fechar</button></div><label>Título<input style={field} value={activeNote.title} onChange={(e) => updateNote(activeNote.id, { title: e.target.value })} maxLength={100} /></label><label>Área<select style={field} value={activeNote.area} onChange={(e) => updateNote(activeNote.id, { area: e.target.value as SevenArea })}>{Object.entries(SEVEN_AREAS).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}</select></label><label>Conteúdo<textarea style={field} rows={12} value={activeNote.body} onChange={(e) => updateNote(activeNote.id, { body: e.target.value })} maxLength={1000000} /></label><button type="button" className="seven-brain-delete" onClick={() => removeNote(activeNote.id)}><Trash2 size={13} /> Excluir nota</button></div> : <p>Selecione uma nota para editar.</p>}</div>
      </div>
      <div className="seven-brain-actions"><span role="status">{status}</span><button type="button" disabled={busy} onClick={() => void save()}><Save size={15} /> {busy ? 'Salvando...' : 'Salvar notas'}</button></div>
    </>}
  </section>;
}
