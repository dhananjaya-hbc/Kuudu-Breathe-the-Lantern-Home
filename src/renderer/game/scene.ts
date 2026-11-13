// The night river scene: sky, stars, distant hills, and the river.
//
// Original flat illustrated style, drawn entirely in code: warm lantern
// light on a dark blue river. Behind the lantern, small floating lights
// appear on the water as the player builds a streak, so the river "lights
// up behind you".
//
// The lantern itself, its reflection, and the gates are drawn by their own
// modules; this file also defines the shared layout they all use.

/** Screen layout in device pixels, shared by the scene, lantern and gates. */
export interface Layout {
  width: number;
  height: number;
  /** Device pixel ratio, for line widths and sizes. */
  scale: number;
  /** Where the sky meets the water. */
  waterY: number;
  /** Highest point the lantern reaches (height 1). */
  flyTop: number;
  /** Lowest point the lantern reaches (height 0), just above the water. */
  flyBottom: number;
  /** The lantern's fixed horizontal position; the world scrolls past it. */
  lanternX: number;
}

export function computeLayout(width: number, height: number, scale: number): Layout {
  const waterY = height * 0.72;
  return {
    width,
    height,
    scale,
    waterY,
    flyTop: height * 0.14,
    // High enough that the lantern's paper tails skim the water, not dip into it.
    flyBottom: waterY - height * 0.14,
    lanternX: width * 0.3,
  };
}

/** Screen y for a lantern/target height (0 = bottom, 1 = top). */
export function yForHeight(layout: Layout, h: number): number {
  return layout.flyBottom - h * (layout.flyBottom - layout.flyTop);
}

export interface SceneState {
  /** How far the world has scrolled, in device pixels. */
  scrollPx: number;
  /** Current glow, 0–1: how well the player is matching the rhythm right now. */
  glow: number;
  /** Gates passed in a row. More streak = more lights on the river. */
  streak: number;
  timeMs: number;
}

/** Small deterministic random generator, so stars and ripples never jump between frames. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Star {
  x: number;
  y: number;
  r: number;
  twinkle: number;
}

interface Ripple {
  x: number;
  y: number;
  length: number;
}

/** The most river lights shown, however long the streak. */
const MAX_LIGHTS = 18;

export class Scene {
  private readonly stars: Star[];
  private readonly ripples: Ripple[];

  constructor(seed = 2026) {
    const rand = seeded(seed);
    this.stars = Array.from({ length: 140 }, () => ({
      x: rand(),
      y: rand() ** 1.6, // more stars high in the sky
      r: 0.5 + rand() * 1.3,
      twinkle: rand() * Math.PI * 2,
    }));
    this.ripples = Array.from({ length: 60 }, () => ({
      x: rand(),
      y: rand() ** 0.8,
      length: 0.02 + rand() * 0.05,
    }));
  }

  draw(ctx: CanvasRenderingContext2D, layout: Layout, state: SceneState): void {
    this.drawSky(ctx, layout, state);
    this.drawHills(ctx, layout, state.scrollPx);
    this.drawWater(ctx, layout, state);
    this.drawRiverLights(ctx, layout, state);
  }

  private drawSky(ctx: CanvasRenderingContext2D, l: Layout, s: SceneState): void {
    const sky = ctx.createLinearGradient(0, 0, 0, l.waterY);
    sky.addColorStop(0, '#060d22');
    sky.addColorStop(0.65, '#0d1b3e');
    sky.addColorStop(1, '#1d2f5c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, l.width, l.waterY);

    // Stars drift very slowly with the scroll for a sense of distance.
    const drift = s.scrollPx * 0.02;
    for (const star of this.stars) {
      const x = (((star.x * l.width - drift) % l.width) + l.width) % l.width;
      const y = star.y * l.waterY * 0.85;
      const alpha = 0.45 + 0.4 * Math.sin(s.timeMs / 900 + star.twinkle);
      ctx.fillStyle = `rgba(245, 230, 200, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, star.r * l.scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // The full Vesak (Poya) moon: small and soft, so the lantern stays the brightest light.
    const mx = l.width * 0.8;
    const my = l.height * 0.17;
    const mr = 21 * l.scale;
    const halo = ctx.createRadialGradient(mx, my, mr * 0.9, mx, my, mr * 5);
    halo.addColorStop(0, 'rgba(255, 236, 190, 0.22)');
    halo.addColorStop(1, 'rgba(255, 236, 190, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
    // Solid, warm and bright, but small: the lantern is still the brightest thing on screen.
    const face = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, 0, mx, my, mr);
    face.addColorStop(0, '#fff6dc');
    face.addColorStop(1, '#ead9ad');
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
    // Faint shading so it is not a flat disc.
    ctx.fillStyle = 'rgba(190, 170, 120, 0.22)';
    for (const [dx, dy, r] of [
      [-0.35, -0.1, 0.28],
      [0.25, 0.3, 0.2],
      [0.3, -0.35, 0.14],
    ] as const) {
      ctx.beginPath();
      ctx.arc(mx + dx * mr, my + dy * mr, r * mr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Two layers of rolling hills at different scroll speeds. */
  private drawHills(ctx: CanvasRenderingContext2D, l: Layout, scrollPx: number): void {
    const layers = [
      { speed: 0.08, base: 0.82, amp: 0.06, color: '#14244a', freq: 1.3 },
      { speed: 0.2, base: 0.9, amp: 0.05, color: '#0f1c3b', freq: 2.1 },
    ];
    for (const layer of layers) {
      const offset = scrollPx * layer.speed;
      ctx.fillStyle = layer.color;
      ctx.beginPath();
      ctx.moveTo(0, l.waterY);
      const step = 8 * l.scale;
      for (let x = 0; x <= l.width + step; x += step) {
        const u = (x + offset) / l.width;
        const wave =
          Math.sin(u * Math.PI * 2 * layer.freq) * 0.6 +
          Math.sin(u * Math.PI * 2 * layer.freq * 2.7 + 1.3) * 0.4;
        ctx.lineTo(x, l.waterY * (layer.base - layer.amp * wave));
      }
      ctx.lineTo(l.width, l.waterY);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawWater(ctx: CanvasRenderingContext2D, l: Layout, s: SceneState): void {
    const waterHeight = l.height - l.waterY;
    const water = ctx.createLinearGradient(0, l.waterY, 0, l.height);
    water.addColorStop(0, '#132650');
    water.addColorStop(1, '#070f26');
    ctx.fillStyle = water;
    ctx.fillRect(0, l.waterY, l.width, waterHeight);

    // Warm light on the water under the lantern, brighter as the glow grows.
    const pool = ctx.createRadialGradient(
      l.lanternX,
      l.waterY + waterHeight * 0.15,
      0,
      l.lanternX,
      l.waterY + waterHeight * 0.15,
      l.width * 0.25,
    );
    pool.addColorStop(0, `rgba(255, 179, 71, ${(0.08 + 0.22 * s.glow).toFixed(3)})`);
    pool.addColorStop(1, 'rgba(255, 179, 71, 0)');
    ctx.fillStyle = pool;
    ctx.fillRect(0, l.waterY, l.width, waterHeight);

    // Ripples move with the current, faster than the hills.
    ctx.lineCap = 'round';
    for (const r of this.ripples) {
      const x = (((r.x * l.width - s.scrollPx) % l.width) + l.width) % l.width;
      const y = l.waterY + 6 * l.scale + r.y * (waterHeight - 12 * l.scale);
      const depth = (y - l.waterY) / waterHeight;
      ctx.strokeStyle = `rgba(160, 190, 230, ${(0.08 + 0.12 * (1 - depth)).toFixed(3)})`;
      ctx.lineWidth = (1 + depth * 1.5) * l.scale;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + r.length * l.width * (0.6 + depth), y);
      ctx.stroke();
    }

    // Horizon line.
    ctx.strokeStyle = 'rgba(160, 190, 230, 0.25)';
    ctx.lineWidth = l.scale;
    ctx.beginPath();
    ctx.moveTo(0, l.waterY);
    ctx.lineTo(l.width, l.waterY);
    ctx.stroke();
  }

  /** Floating lights left behind the lantern, one more for each gate in the streak. */
  private drawRiverLights(ctx: CanvasRenderingContext2D, l: Layout, s: SceneState): void {
    const count = Math.min(MAX_LIGHTS, s.streak);
    if (count === 0) return;
    const spacing = (l.lanternX - 30 * l.scale) / MAX_LIGHTS;
    const waterHeight = l.height - l.waterY;

    for (let i = 0; i < count; i++) {
      // Light 0 is nearest the lantern; older lights trail off to the left and fade.
      const x = l.lanternX - (i + 1) * spacing;
      const bob = Math.sin(s.timeMs / 700 + i * 1.7) * 3 * l.scale;
      const y = l.waterY + waterHeight * (0.12 + 0.18 * ((i * 0.37) % 1)) + bob;
      const fade = 1 - i / (MAX_LIGHTS + 4);
      const r = (5 + 2 * Math.sin(s.timeMs / 400 + i)) * l.scale;

      const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
      halo.addColorStop(0, `rgba(255, 179, 71, ${(0.35 * fade).toFixed(3)})`);
      halo.addColorStop(1, 'rgba(255, 179, 71, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);

      ctx.fillStyle = `rgba(255, 214, 140, ${(0.9 * fade).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Shimmering reflection.
      ctx.strokeStyle = `rgba(255, 179, 71, ${(0.25 * fade).toFixed(3)})`;
      ctx.lineWidth = 2 * l.scale;
      ctx.beginPath();
      ctx.moveTo(x - r, y + r * 2);
      ctx.lineTo(x + r, y + r * 2);
      ctx.stroke();
    }
  }
}
