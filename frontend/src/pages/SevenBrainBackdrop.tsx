import { useEffect, useMemo, useRef } from 'react';
import { SEVEN_AREAS, type SevenNote } from '../lib/seven';

type CloudPoint = { id: string; x: number; y: number; z: number; color: string; links: number };

export function SevenBrainBackdrop({ notes }: { notes: SevenNote[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graph = useMemo(() => {
    const sorted = [...notes].sort((a, b) => b.links.length - a.links.length || a.area.localeCompare(b.area) || a.title.localeCompare(b.title, 'pt-BR'));
    const count = Math.max(sorted.length, 1);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const points: CloudPoint[] = sorted.map((note, index) => {
      const fraction = (index + .5) / count;
      const radius = sorted.length === 1 ? 0 : 265 * Math.cbrt(fraction);
      const vertical = 1 - 2 * fraction;
      const around = Math.sqrt(1 - vertical * vertical);
      const angle = index * golden + .35;
      return {
        id: note.id,
        x: Math.cos(angle) * around * radius,
        y: Math.sin(angle) * around * radius * .9,
        z: vertical * radius,
        color: SEVEN_AREAS[note.area]?.color || '#ef8a8d',
        links: note.links.length,
      };
    });
    const byId = new Map(points.map((point, index) => [point.id, index]));
    const seen = new Set<string>();
    const links: Array<[number, number]> = [];
    sorted.forEach((note, source) => note.links.forEach((id) => {
      const target = byId.get(id);
      const key = [note.id, id].sort().join(':');
      if (target === undefined || seen.has(key)) return;
      seen.add(key);
      links.push([source, target]);
    }));
    return { points, links };
  }, [notes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const started = performance.now();
    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      const pixelWidth = Math.round(width * pixelRatio);
      const pixelHeight = Math.round(height * pixelRatio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (!graph.points.length) return;

      const elapsed = reducedMotion ? 0 : performance.now() - started;
      const yaw = -.28 + elapsed * .000008;
      const pitch = .18 + Math.sin(elapsed * .000012) * .06;
      const yawCos = Math.cos(yaw);
      const yawSin = Math.sin(yaw);
      const pitchCos = Math.cos(pitch);
      const pitchSin = Math.sin(pitch);
      const factor = Math.min(width, height) / 600;
      const projected = graph.points.map((point) => {
        const rotatedX = point.x * yawCos + point.z * yawSin;
        const rotatedZ = -point.x * yawSin + point.z * yawCos;
        const rotatedY = point.y * pitchCos - rotatedZ * pitchSin;
        const depth = point.y * pitchSin + rotatedZ * pitchCos;
        const perspective = 1040 / (1040 - depth);
        return { x: width / 2 + rotatedX * perspective * factor, y: height / 2 + rotatedY * perspective * factor, depth };
      });

      context.lineWidth = Math.max(.55, .9 * factor);
      context.strokeStyle = 'rgba(242, 113, 121, .26)';
      context.beginPath();
      graph.links.forEach(([source, target]) => {
        context.moveTo(projected[source].x, projected[source].y);
        context.lineTo(projected[target].x, projected[target].y);
      });
      context.stroke();

      graph.points.forEach((point, index) => {
        const { x, y, depth } = projected[index];
        const simulated = point.id.startsWith('preview-node-');
        const visibility = Math.max(.55, Math.min(1, .76 + depth / 800));
        context.fillStyle = point.color;
        context.globalAlpha = visibility * .13;
        context.beginPath();
        context.arc(x, y, (simulated ? 2.4 : 5 + Math.min(point.links, 6) * .5) * factor, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = visibility;
        context.beginPath();
        context.arc(x, y, (simulated ? 1 : 2 + Math.min(point.links, 6) * .22) * factor, 0, Math.PI * 2);
        context.fill();
      });
      context.globalAlpha = 1;
    };
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(canvas);
    const timer = reducedMotion ? null : window.setInterval(() => {
      if (document.visibilityState === 'visible') draw();
    }, 500);
    return () => {
      resize.disconnect();
      if (timer !== null) window.clearInterval(timer);
    };
  }, [graph]);

  return <canvas ref={canvasRef} className="seven-orb-brain" aria-hidden="true" />;
}
