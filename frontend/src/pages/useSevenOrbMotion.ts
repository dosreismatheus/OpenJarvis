import { useLayoutEffect, useRef } from 'react';

type OrbStatus = 'ready' | 'thinking' | 'preparing' | 'speaking';
type Ring = { selector: string; defaultTurnMs: number; role: 'outer' | 'clock' | 'band' | 'interior' };

const rings: Ring[] = [
  { selector: '.seven-orb-outer-half-a', defaultTurnMs: 420_000, role: 'outer' },
  { selector: '.seven-orb-outer-half-b', defaultTurnMs: 420_000, role: 'outer' },
  { selector: '.seven-orb-clock-ticks', defaultTurnMs: 228_570, role: 'clock' },
  { selector: '.seven-orb-band', defaultTurnMs: 323_800, role: 'band' },
  { selector: '.seven-orb-art-rest', defaultTurnMs: 80_000, role: 'interior' },
];

const resetSpeed = 7; // 600% faster than the available state.
const thinkingSpeed = 3; // 200% faster than the available state.
const innerThinkingSpeed = 8; // 700% faster than the available state.

function angleOf(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform;
  if (transform === 'none') return 0;
  const matrix = new DOMMatrixReadOnly(transform);
  return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
}

export function useSevenOrbMotion(status: OrbStatus) {
  const orbRef = useRef<HTMLDivElement>(null);
  const activeAnimations = useRef(new Set<Animation>());
  const generation = useRef(0);
  const mode = useRef<'default' | 'thinking' | 'resetting' | 'holding'>('default');

  useLayoutEffect(() => {
    const orb = orbRef.current;
    if (!orb || (status === 'ready' && mode.current === 'default')) return;
    if (status !== 'thinking' && mode.current === 'holding') {
      if (status === 'ready') {
        orb.querySelectorAll<HTMLElement>('.seven-orb-art').forEach((element) => {
          element.style.transform = '';
          element.style.animation = '';
        });
        mode.current = 'default';
      }
      return;
    }

    const layers = rings.map((ring) => ({ ring, element: orb.querySelector<HTMLElement>(ring.selector) }));
    if (layers.some(({ element }) => !element)) return;
    const token = ++generation.current;

    // Read every live angle before stopping any animation, then hold each layer
    // at that exact position while the transition to the reference pose runs.
    const frozen = layers.map(({ ring, element }) => ({ ring, element: element!, angle: angleOf(element!) }));
    activeAnimations.current.forEach((animation) => animation.cancel());
    activeAnimations.current.clear();
    frozen.forEach(({ element, angle }) => {
      element.style.animation = 'none';
      element.style.transform = `rotate(${angle}deg)`;
    });

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      frozen.forEach(({ element }) => {
        element.style.transform = status === 'ready' ? '' : 'rotate(0deg)';
        if (status === 'ready') element.style.animation = '';
      });
      mode.current = status === 'thinking' ? 'thinking' : status === 'ready' ? 'default' : 'holding';
      return;
    }

    const track = (animation: Animation) => {
      activeAnimations.current.add(animation);
      void animation.finished.finally(() => activeAnimations.current.delete(animation)).catch(() => {});
      return animation;
    };
    const reset = frozen.map(({ ring, element, angle }) => {
      if (Math.abs(angle) < 0.1) {
        element.style.transform = 'rotate(0deg)';
        return Promise.resolve();
      }
      const proportionalMs = Math.abs(angle) / 360 * ring.defaultTurnMs / resetSpeed;
      const animation = track(element.animate(
        [{ transform: `rotate(${angle}deg)` }, { transform: 'rotate(0deg)' }],
        { duration: Math.min(proportionalMs, 600), easing: 'ease-in-out', fill: 'forwards' },
      ));
      return animation.finished.then(() => {
        if (generation.current !== token) return;
        element.style.transform = 'rotate(0deg)';
        animation.cancel();
      }).catch(() => {});
    });

    mode.current = 'resetting';
    void Promise.all(reset).then(() => {
      if (generation.current !== token) return;
      if (status !== 'thinking') {
        if (status === 'ready') {
          frozen.forEach(({ element }) => {
            element.style.transform = '';
            element.style.animation = '';
          });
          mode.current = 'default';
        } else {
          mode.current = 'holding';
        }
        return;
      }

      mode.current = 'thinking';
      frozen.forEach(({ ring, element }) => {
        if (ring.role === 'interior') {
          // The two inner layers keep turning in one direction throughout processing.
          track(element.animate(
            [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
            { duration: ring.defaultTurnMs / innerThinkingSpeed, iterations: Infinity, easing: 'linear' },
          ));
          return;
        }

        const sign = ring.role === 'clock' ? 1 : -1;
        const firstAngle = sign * 60;
        const oppositeAngle = -sign * 120;
        // First turn: 60°. Subsequent sweeps: 180° in alternating directions.
        const firstMs = Math.min(ring.defaultTurnMs / thinkingSpeed / 6, 900);
        const halfCycleMs = firstMs * 3;
        const firstTurn = track(element.animate(
          [{ transform: 'rotate(0deg)' }, { transform: `rotate(${firstAngle}deg)` }],
          { duration: firstMs, easing: 'ease-in-out', fill: 'forwards' },
        ));
        void firstTurn.finished.then(() => {
          if (generation.current !== token) return;
          element.style.transform = `rotate(${firstAngle}deg)`;
          firstTurn.cancel();
          track(element.animate([
            { transform: `rotate(${firstAngle}deg)` },
            { transform: `rotate(${oppositeAngle}deg)` },
            { transform: `rotate(${firstAngle}deg)` },
          ], { duration: halfCycleMs * 2, iterations: Infinity, easing: 'ease-in-out' }));
        }).catch(() => {});
      });
    });
  }, [status]);

  useLayoutEffect(() => () => {
    ++generation.current;
    activeAnimations.current.forEach((animation) => animation.cancel());
    activeAnimations.current.clear();
  }, []);

  return orbRef;
}
