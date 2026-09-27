import { useLayoutEffect, useRef } from 'react';

type OrbStatus = 'ready' | 'thinking' | 'preparing' | 'speaking';
type Ring = { selector: string; defaultTurnMs: number; thinkingTurnMs: number; entrySpinMs: number; exitSpinMs: number; role: 'outer' | 'clock' | 'band' | 'interior' };

const rings: Ring[] = [
  { selector: '.seven-orb-outer-half-a', defaultTurnMs: 420_000, thinkingTurnMs: 6000, entrySpinMs: 1040, exitSpinMs: 1800, role: 'outer' },
  { selector: '.seven-orb-outer-half-b', defaultTurnMs: 420_000, thinkingTurnMs: 6000, entrySpinMs: 1040, exitSpinMs: 1800, role: 'outer' },
  { selector: '.seven-orb-clock-ticks', defaultTurnMs: 228_570, thinkingTurnMs: 4500, entrySpinMs: 840, exitSpinMs: 1500, role: 'clock' },
  { selector: '.seven-orb-band', defaultTurnMs: 323_800, thinkingTurnMs: 3000, entrySpinMs: 680, exitSpinMs: 1200, role: 'band' },
  { selector: '.seven-orb-art-rest', defaultTurnMs: 80_000, thinkingTurnMs: 1500, entrySpinMs: 540, exitSpinMs: 900, role: 'interior' },
];

const resetSpeed = 7; // 600% faster than the available state.
const thinkingSteps = [180, 60, 70, 300, 120, 150];
const entrySpinTurns = 2;
const exitSpinTurns = 3;
const fastStopEasing = 'cubic-bezier(0.16, 0.72, 0.18, 1)';

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
  const mode = useRef<'default' | 'entering' | 'thinking' | 'exit-spinning' | 'settling' | 'holding'>('default');
  const currentStatus = useRef(status);
  currentStatus.current = status;

  useLayoutEffect(() => {
    const orb = orbRef.current;
    const isDefaultMotion = status === 'ready' || status === 'speaking';
    if (!orb || (isDefaultMotion && mode.current === 'default')) return;
    if (status !== 'thinking' && (mode.current === 'exit-spinning' || mode.current === 'settling')) return;
    if (status !== 'thinking' && mode.current === 'holding') {
      if (isDefaultMotion) {
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
    const enteringThinking = status === 'thinking';
    const leavingThinking = status !== 'thinking' && (mode.current === 'thinking' || mode.current === 'entering');

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
        element.style.transform = isDefaultMotion ? '' : 'rotate(0deg)';
        if (isDefaultMotion) element.style.animation = '';
      });
      mode.current = status === 'thinking' ? 'thinking' : isDefaultMotion ? 'default' : 'holding';
      return;
    }

    const track = (animation: Animation) => {
      activeAnimations.current.add(animation);
      void animation.finished.finally(() => activeAnimations.current.delete(animation)).catch(() => {});
      return animation;
    };
    const startThinkingRing = (ring: Ring, element: HTMLElement) => {
      if (generation.current !== token || currentStatus.current !== 'thinking') return;
      if (ring.role === 'interior') {
        track(element.animate(
          [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
          { duration: ring.thinkingTurnMs, iterations: Infinity, easing: 'linear' },
        ));
        return;
      }

      const sign = ring.role === 'clock' ? 1 : -1;
      const animateStep = (index: number, currentAngle: number) => {
        if (generation.current !== token) return;
        const degrees = thinkingSteps[index % thinkingSteps.length];
        const nextAngle = currentAngle + sign * (index % 2 === 0 ? degrees : -degrees);
        const duration = degrees / 360 * ring.thinkingTurnMs;
        const turn = track(element.animate(
          [{ transform: `rotate(${currentAngle}deg)` }, { transform: `rotate(${nextAngle}deg)` }],
          { duration, easing: 'ease-in-out', fill: 'forwards' },
        ));
        void turn.finished.then(() => {
          if (generation.current !== token) return;
          const settledAngle = ((nextAngle + 180) % 360 + 360) % 360 - 180;
          element.style.transform = `rotate(${settledAngle}deg)`;
          turn.cancel();
          animateStep(index + 1, settledAngle);
        }).catch(() => {});
      };
      animateStep(0, 0);
    };
    const reset = frozen.map(({ ring, element, angle }) => {
      if (!enteringThinking && !leavingThinking && Math.abs(angle) < 0.1) {
        element.style.transform = 'rotate(0deg)';
        return Promise.resolve();
      }
      const proportionalMs = Math.abs(angle) / 360 * ring.defaultTurnMs / resetSpeed;
      const direction = ring.role === 'clock' || ring.role === 'interior' ? 1 : -1;
      const turns = enteringThinking ? entrySpinTurns : leavingThinking ? exitSpinTurns : 0;
      const endAngle = turns ? direction * turns * 360 : 0;
      const animation = track(element.animate(
        [{ transform: `rotate(${angle}deg)` }, { transform: `rotate(${endAngle}deg)` }],
        {
          duration: enteringThinking ? ring.entrySpinMs : leavingThinking ? ring.exitSpinMs : Math.min(proportionalMs, 600),
          easing: turns ? fastStopEasing : 'ease-in-out',
          fill: 'forwards',
        },
      ));
      return animation.finished.then(() => {
        if (generation.current !== token) return;
        element.style.transform = 'rotate(0deg)';
        animation.cancel();
        if (enteringThinking) startThinkingRing(ring, element);
      }).catch(() => {});
    });

    mode.current = leavingThinking ? 'exit-spinning' : status === 'thinking' ? 'entering' : 'settling';
    void Promise.all(reset).then(() => {
      if (generation.current !== token) return;
      if (currentStatus.current !== 'thinking') {
        if (currentStatus.current === 'ready' || currentStatus.current === 'speaking') {
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
    });
  }, [status]);

  useLayoutEffect(() => () => {
    ++generation.current;
    activeAnimations.current.forEach((animation) => animation.cancel());
    activeAnimations.current.clear();
  }, []);

  return orbRef;
}
