import { useEffect, useMemo, useState } from 'react';
import { SEVEN_AREAS, type SevenNote } from '../lib/seven';

type Point = { note: SevenNote; x: number; y: number; depth: number };
const initialRotation = { yaw: -.28, pitch: .18 };

export function SevenBrainBackdrop({ notes }: { notes: SevenNote[] }) {
  const [rotation, setRotation] = useState(initialRotation);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const started = performance.now();
    let frame = 0;
    let lastUpdate = 0;
    const animate = (now: number) => {
      if (document.visibilityState === 'visible' && now - lastUpdate >= 33) {
        const elapsed = now - started;
        setRotation({
          yaw: initialRotation.yaw + elapsed * .00007,
          pitch: initialRotation.pitch + Math.sin(elapsed * .00022) * .12,
        });
        lastUpdate = now;
      }
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const { points, links } = useMemo(() => {
    const sorted = [...notes].sort((a, b) => b.links.length - a.links.length || a.area.localeCompare(b.area) || a.title.localeCompare(b.title, 'pt-BR'));
    const count = Math.max(sorted.length, 1);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const { yaw, pitch } = rotation;
    const points: Point[] = sorted.map((note, index) => {
      const fraction = (index + .5) / count;
      const radius = sorted.length === 1 ? 0 : 265 * Math.cbrt(fraction);
      const vertical = 1 - 2 * fraction;
      const around = Math.sqrt(1 - vertical * vertical);
      const angle = index * golden + .35;
      const x = Math.cos(angle) * around * radius;
      const y = Math.sin(angle) * around * radius * .9;
      const z = vertical * radius;
      const rotatedX = x * Math.cos(yaw) + z * Math.sin(yaw);
      const rotatedZ = -x * Math.sin(yaw) + z * Math.cos(yaw);
      const rotatedY = y * Math.cos(pitch) - rotatedZ * Math.sin(pitch);
      const depth = y * Math.sin(pitch) + rotatedZ * Math.cos(pitch);
      const perspective = 1040 / (1040 - depth);
      return { note, x: 300 + rotatedX * perspective, y: 300 + rotatedY * perspective, depth };
    });
    const byId = new Map(points.map((point) => [point.note.id, point]));
    const seen = new Set<string>();
    const links = points.flatMap((source) => source.note.links.map((id) => {
      const target = byId.get(id);
      const key = [source.note.id, id].sort().join(':');
      if (!target || seen.has(key)) return null;
      seen.add(key);
      return { key, source, target };
    }).filter((link): link is { key: string; source: Point; target: Point } => link !== null));
    return { points, links };
  }, [notes, rotation]);

  if (!points.length) return null;
  return <svg className="seven-orb-brain" viewBox="0 0 600 600" aria-hidden="true" focusable="false">
    {links.map(({ key, source, target }) => <line key={key} className="seven-orb-brain-link" x1={source.x} y1={source.y} x2={target.x} y2={target.y} />)}
    {points.map(({ note, x, y, depth }, index) => {
      const color = SEVEN_AREAS[note.area]?.color || '#ef8a8d';
      return <g key={note.id} className="seven-orb-brain-node" style={{ opacity: Math.max(.55, Math.min(1, .76 + depth / 800)), animationDelay: `${index * -.43}s` }}>
        <circle cx={x} cy={y} r={5 + Math.min(note.links.length, 6) * .5} fill={color} opacity=".13" />
        <circle cx={x} cy={y} r={2 + Math.min(note.links.length, 6) * .22} fill={color} />
      </g>;
    })}
  </svg>;
}
