import { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { SquadBrainNote } from '../lib/squads';
import './SquadBrainMap.css';

type Position = { note: SquadBrainNote; x: number; y: number };
const outline = 'M 595 138 C 558 88 504 86 460 111 C 410 74 350 91 326 141 C 262 130 215 178 225 237 C 177 273 181 334 212 369 C 180 423 210 484 262 501 C 252 565 320 604 379 583 C 422 627 493 615 524 576 C 563 591 591 563 598 522 Z';
const folds = ['M 393 145 C 351 186 358 228 414 249', 'M 273 264 C 330 253 348 283 349 329', 'M 430 262 C 479 277 486 323 463 358', 'M 304 402 C 356 387 397 418 392 473', 'M 484 458 C 526 444 558 462 564 510', 'M 392 533 C 424 504 459 505 491 530'];
const golden = Math.PI * (3 - Math.sqrt(5));

function category(path: string) {
  if (path.startsWith('demandas/')) return { name: 'Demandas', color: '#ffbb69' };
  if (path.startsWith('decisoes/')) return { name: 'Decisões', color: '#b99aff' };
  if (path.startsWith('produto/')) return { name: 'Produto', color: '#72c8ed' };
  if (path.startsWith('contexto/')) return { name: 'Contexto', color: '#ef6974' };
  return { name: 'Visão geral', color: '#f26370' };
}

function noteId(path: string) { return path.replace(/\.md$/i, ''); }

export function SquadBrainMap({ notes, compact = false, selectedPath, onSelect }: { notes: SquadBrainNote[]; compact?: boolean; selectedPath?: string; onSelect?: (path: string) => void }) {
  const [activePath, setActivePath] = useState<string | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const positions = useMemo(() => {
    const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));
    const groups: SquadBrainNote[][] = [[], []];
    sorted.forEach((note) => {
      const side = note.path.startsWith('demandas/') || note.path.startsWith('decisoes/') ? 1 : 0;
      groups[side].push(note);
    });
    return groups.flatMap((group, side) => group.map((note, index): Position => {
      const radius = Math.sqrt((index + .48) / Math.max(group.length, 1));
      const angle = index * golden + (side ? .6 : 2.4);
      return { note, x: (side ? 790 : 410) + Math.cos(angle) * radius * 162, y: 360 + Math.sin(angle) * radius * 220 };
    }));
  }, [notes]);
  const texture = useMemo(() => Array.from({ length: 184 }, (_, index) => {
    const side = index % 2;
    const order = Math.floor(index / 2);
    const radius = Math.sqrt((order + .5) / 92) * .96;
    const angle = order * golden + (side ? .4 : 2.3);
    return { x: (side ? 790 : 410) + Math.cos(angle) * radius * 176, y: 360 + Math.sin(angle) * radius * 229 };
  }), []);
  const byId = new Map(positions.map((position) => [noteId(position.note.path), position]));
  const seen = new Set<string>();
  const edges = positions.flatMap((source) => source.note.links.map((link) => {
    const target = byId.get(noteId(link));
    const key = [source.note.path, target?.note.path].sort().join(':');
    if (!target || target === source || seen.has(key)) return null;
    seen.add(key);
    return { source, target };
  }).filter((edge): edge is { source: Position; target: Position } => edge !== null));
  const focusedPath = hoveredPath || activePath || (compact ? selectedPath : null);
  const activeNote = notes.find((note) => note.path === activePath);
  const connected = new Set(edges.filter(({ source, target }) => source.note.path === focusedPath || target.note.path === focusedPath)
    .flatMap(({ source, target }) => [source.note.path, target.note.path]));
  const transform = `translate(${pan.x} ${pan.y}) translate(600 360) scale(${zoom}) translate(-600 -360)`;

  return <div className={`squad-brain-map ${compact ? 'is-compact' : 'is-full'}`}>
    <svg viewBox="0 0 1200 720" role="group" aria-label="Mapa das notas da squad em formato de cérebro" onWheel={compact ? undefined : (event) => { event.preventDefault(); setZoom((value) => Math.min(3, Math.max(.8, value + (event.deltaY < 0 ? .12 : -.12)))); }} onPointerDown={compact ? undefined : (event) => { if ((event.target as Element).closest('.squad-brain-node')) return; drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={compact ? undefined : (event) => { if (!drag.current) return; const box = event.currentTarget.getBoundingClientRect(); setPan({ x: drag.current.panX + (event.clientX - drag.current.x) * 1200 / box.width, y: drag.current.panY + (event.clientY - drag.current.y) * 720 / box.height }); }} onPointerUp={compact ? undefined : (event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>
      <g transform={transform}>
        <path d={outline} className="squad-brain-outline" /><path d={outline} transform="translate(1200 0) scale(-1 1)" className="squad-brain-outline" />
        {folds.map((path, index) => <g key={index}><path d={path} className="squad-brain-fold" /><path d={path} transform="translate(1200 0) scale(-1 1)" className="squad-brain-fold" /></g>)}
        {texture.map((dot, index) => <circle key={index} cx={dot.x} cy={dot.y} r="1.5" className="squad-brain-texture" />)}
        {edges.map(({ source, target }) => <path key={`${source.note.path}:${target.note.path}`} d={`M ${source.x} ${source.y} Q 600 360 ${target.x} ${target.y}`} className={`squad-brain-edge ${focusedPath && (source.note.path === focusedPath || target.note.path === focusedPath) ? 'is-focused' : ''}`} />)}
        {positions.map(({ note, x, y }) => <g key={note.path} className={`squad-brain-node ${focusedPath && note.path !== focusedPath && !connected.has(note.path) ? 'is-muted' : ''}`} role="button" tabIndex={0} aria-label={`Explorar nota ${note.title}`} onMouseEnter={() => setHoveredPath(note.path)} onMouseLeave={() => setHoveredPath(null)} onFocus={() => setHoveredPath(note.path)} onBlur={() => setHoveredPath(null)} onClick={() => { setActivePath(note.path); onSelect?.(note.path); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActivePath(note.path); onSelect?.(note.path); } }}>
          <circle cx={x} cy={y} r="18" fill="transparent" /><circle cx={x} cy={y} r={Math.min(10, 6 + note.links.length * .5)} fill={category(note.path).color} className="squad-brain-dot" />
          {(focusedPath === note.path || (compact && notes.length === 1)) && <text x={x + 16} y={y - 13} className="squad-brain-label">{note.title}</text>}
        </g>)}
      </g>
    </svg>
    {!compact && activeNote && <div className="squad-brain-detail"><div><span style={{ color: category(activeNote.path).color }}>{category(activeNote.path).name}</span><button type="button" onClick={() => setActivePath(null)} aria-label="Fechar detalhes"><X size={16} /></button></div><h2>{activeNote.title}</h2><p>{activeNote.content.replace(/<!--[^]*?-->/g, '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').slice(0, 260)}</p>{activeNote.links.length > 0 && <small>{activeNote.links.length} conexões</small>}</div>}
    {!compact && notes.length === 0 && <div className="squad-brain-empty">Este cérebro ainda não tem notas.</div>}
  </div>;
}
