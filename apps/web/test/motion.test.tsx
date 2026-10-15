import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DROP_LAND,
  DUR,
  Kb,
  ScreenTransition,
  Skeleton,
  SLOWMO_TOTAL,
  StampSpinner,
  Ticket,
  dropScale,
  markTransitionOrigin,
  slowmoScale,
  zoomIn,
} from '../src/design';
import { Camera } from '../src/game/camera';
import { setReducedMotion } from '../src/test/media';

const paper = () => document.querySelector<HTMLElement>('.kb-screen');
const maskOf = (el: HTMLElement | null) => el?.style.getPropertyValue('mask') ?? '';

function Harness({ show, home }: { show: boolean; home?: () => { x: number; y: number; w: number; h: number } | null }) {
  return (
    <Kb>
      <ScreenTransition show={show} home={home}>
        <p>lobby page</p>
      </ScreenTransition>
    </Kb>
  );
}

describe('ScreenTransition', () => {
  it('boots the paper in, keeps it while it wipes away, then unmounts it', async () => {
    const { rerender } = render(<Harness show />);
    expect(screen.getByText('lobby page')).toBeTruthy();
    expect(paper()?.dataset.entrance).toBe('boot');

    markTransitionOrigin({ x: 100, y: 50 });
    rerender(<Harness show={false} />);
    // still there, no longer clickable, while the iris opens from the punch hole
    expect(screen.getByText('lobby page')).toBeTruthy();
    expect(paper()?.dataset.screenState).toBe('leaving');
    await waitFor(() => expect(maskOf(paper())).toContain('radial-gradient(circle at 100px 50px'));
    await waitFor(() => expect(screen.queryByText('lobby page')).toBeNull(), { timeout: 3000 });
  });

  it('comes back by closing the paper around the world (into the front-page photo)', async () => {
    const { rerender } = render(<Harness show />);
    rerender(<Harness show={false} />);
    await waitFor(() => expect(paper()).toBeNull(), { timeout: 3000 });
    const home = { x: 300, y: 120, w: 400, h: 250 };
    rerender(<Harness show home={() => home} />);
    expect(paper()?.dataset.entrance).toBe('in');
    // a rectangular window shrinking towards the photo, then no mask once it lands
    expect(maskOf(paper())).toContain('linear-gradient');
    await waitFor(() => expect(maskOf(paper())).toBe(''), { timeout: 3000 });
    expect(screen.getByText('lobby page')).toBeTruthy();
    // the card outline ended on the photo's box (regression: the last frame drew NaN)
    for (const path of document.querySelectorAll('.kb-screen__ink path')) expect(path.getAttribute('d') ?? '').not.toContain('NaN');
  });

  it('reduced motion: an opacity fade only, never a mask or a transform', async () => {
    setReducedMotion(true);
    const { rerender } = render(<Harness show />);
    expect(paper()?.dataset.entrance).toBeUndefined();
    markTransitionOrigin({ x: 100, y: 50 });
    rerender(<Harness show={false} />);
    const el = paper();
    const seen: string[] = [];
    const id = setInterval(() => seen.push(maskOf(el) + (el?.style.transform ?? '')), 10);
    await waitFor(() => expect(screen.queryByText('lobby page')).toBeNull(), { timeout: 1000 });
    clearInterval(id);
    expect(seen.every((s) => s === '')).toBe(true);
  });

  it('stands the paper up again when it returns before it finished leaving', async () => {
    const { rerender } = render(<Harness show />);
    rerender(<Harness show={false} />);
    await waitFor(() => expect(maskOf(paper())).not.toBe(''));
    rerender(<Harness show />);
    await waitFor(() => expect(paper()?.dataset.screenState).toBe('present'));
    expect(maskOf(paper())).toBe('');
    expect(paper()?.style.pointerEvents).toBe('');
  });
});

describe('ticket punch', () => {
  it('punches a hole and knocks out chads (none under reduced motion)', () => {
    const first = render(
      <Kb>
        <Ticket stub="10" punched>
          Penny Pond
        </Ticket>
      </Kb>,
    );
    expect(document.querySelector('.kb-ticket__hole')).not.toBeNull();
    expect(document.querySelectorAll('.kb-ticket__chad')).toHaveLength(6);
    first.unmount();
    setReducedMotion(true);
    render(
      <Kb>
        <Ticket stub="10" punched>
          Penny Pond
        </Ticket>
      </Kb>,
    );
    expect(document.querySelectorAll('.kb-ticket__chad')).toHaveLength(0);
  });
});

describe('loading states', () => {
  it('a stamp spinner and halftone rows announce the wait', () => {
    render(
      <Kb>
        <StampSpinner label="Loading the standings" />
        <Skeleton rows={4} label="Standings loading" />
      </Kb>,
    );
    expect(screen.getByRole('status', { name: 'Loading the standings' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Standings loading' }).querySelectorAll('.kb-skeleton__row')).toHaveLength(4);
  });
});

describe('motion curves', () => {
  it('coin drop: falls from high, squashes on landing, settles at 1', () => {
    expect(dropScale(0)).toBeCloseTo(1.9);
    const landing = dropScale(DROP_LAND);
    expect(landing).toBeLessThan(1);
    expect(dropScale(DROP_LAND - 1e-6)).toBeCloseTo(landing, 3);
    let peak = 0;
    for (let t = DROP_LAND; t <= 1; t += 0.01) peak = Math.max(peak, dropScale(t));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.05);
    expect(dropScale(1)).toBe(1);
  });

  it('death slow motion eases to 0.3, holds ~400 ms, and is back at full speed', () => {
    expect(slowmoScale(0)).toBe(1);
    expect(slowmoScale(0.2)).toBeCloseTo(0.3);
    expect(slowmoScale(DUR.slowmo - 0.01)).toBeCloseTo(0.3);
    expect(slowmoScale(SLOWMO_TOTAL)).toBe(1);
    expect(slowmoScale(-1)).toBe(1);
  });

  it('camera falls into the world: far at the start, exactly normal at the end, no overshoot', () => {
    expect(zoomIn(0)).toBeCloseTo(0.42);
    expect(zoomIn(1)).toBe(1);
    for (let t = 0; t <= 1; t += 0.05) expect(zoomIn(t)).toBeLessThanOrEqual(1);
    const cam = new Camera();
    cam.resize(1000, 800);
    cam.follow(0, 0, 1000, 0.016, true);
    const normal = cam.zoom;
    cam.zoomIntro(DUR.zoomIn);
    cam.follow(0, 0, 1000, 0.001);
    expect(cam.zoom).toBeLessThan(normal * 0.5);
    for (let i = 0; i < 120; i++) cam.follow(0, 0, 1000, 1 / 60);
    expect(cam.introducing).toBe(false);
    expect(cam.zoom).toBeCloseTo(normal);
  });
});
