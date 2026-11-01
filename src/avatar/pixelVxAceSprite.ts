/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Motor de sprites pixel-art de Pixel en estilo RPG Maker VX Ace.
 * - Proporciones chibi clásicas VX Ace (~1.25:1 cabeza/cuerpo, 48x56 celda lógica anclada en los pies).
 * - Pixel art puro sobre grilla entera con contornos oscuros de 1px y sombreado por grupos de píxeles.
 * - 4 direcciones (down, left, right, up) y ciclo de caminata suave de 3 fotogramas (0 -> 1 -> 2 -> 1).
 * - Soporte completo para peinados, paletas de piel/pelo/ropa/botas, 20 conjuntos, 10 accesorios,
 *   10 transformaciones raras y cosméticos desbloqueables de la aventura.
 */

import type { AvatarAppearance } from './avatarOptions';

export type VxFacingDirection = 'up' | 'down' | 'left' | 'right';

export interface VxPixelRenderOptions {
  reducedMotion?: boolean;
  equippedCosmetic?: string | null;
  lanternActive?: boolean;
  lanternRadiusScale?: number;
  interactAnim?: number;
  appearance?: AvatarAppearance;
}

interface ColorRamp {
  spec: string;
  light: string;
  base: string;
  mid: string;
  deep: string;
  outline: string;
}

const CELL_W = 48;
const CELL_H = 56;
const ORIGIN_X = 24;
const ORIGIN_Y = 48;
const DARK_OUTLINE = '#14101c';

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHexColor(hex: string): [number, number, number, number] {
  const clean = hex.trim().replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return [r || 0, g || 0, b || 0, 255];
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const a = clean.length >= 8 ? parseInt(clean.slice(6, 8), 16) : 255;
    return [
      Number.isFinite(r) ? r : 128,
      Number.isFinite(g) ? g : 128,
      Number.isFinite(b) ? b : 128,
      Number.isFinite(a) ? a : 255,
    ];
  }
  return [128, 128, 128, 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const hr = clampByte(r).toString(16).padStart(2, '0');
  const hg = clampByte(g).toString(16).padStart(2, '0');
  const hb = clampByte(b).toString(16).padStart(2, '0');
  return `#${hr}${hg}${hb}`;
}

const rampCache = new Map<string, ColorRamp>();

function deriveVxRamp(hex: string): ColorRamp {
  const cached = rampCache.get(hex);
  if (cached) return cached;
  const [r, g, b] = parseHexColor(hex);
  const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;

  // Desplazamiento sutil cálido en luces y frío-violeta en sombras al estilo RPG Maker VX Ace
  const specBoost = lum < 0.18 ? 96 : lum > 0.85 ? 28 : 66;
  const lightBoost = lum < 0.18 ? 48 : 32;

  const spec = rgbToHex(r + specBoost + 6, g + specBoost + 4, b + specBoost - 4);
  const light = rgbToHex(r + lightBoost + 4, g + lightBoost + 2, b + lightBoost - 3);
  const base = rgbToHex(r, g, b);
  const mid = rgbToHex(r * 0.78 - 6, g * 0.76 - 5, b * 0.82 + 2);
  const deep = rgbToHex(r * 0.54 - 10, g * 0.51 - 9, b * 0.62 + 4);
  const outline = rgbToHex(r * 0.26 + 8, g * 0.22 + 6, b * 0.32 + 14);

  const ramp: ColorRamp = { spec, light, base, mid, deep, outline };
  rampCache.set(hex, ramp);
  return ramp;
}

class VxPixelGrid {
  readonly data: Uint8ClampedArray;
  private readonly colorParseCache = new Map<string, [number, number, number, number]>();

  constructor() {
    this.data = new Uint8ClampedArray(CELL_W * CELL_H * 4);
  }

  private rgba(col: string): [number, number, number, number] {
    let parsed = this.colorParseCache.get(col);
    if (!parsed) {
      parsed = parseHexColor(col);
      this.colorParseCache.set(col, parsed);
    }
    return parsed;
  }

  px(x: number, y: number, col: string | null | undefined): void {
    if (!col) return;
    const gx = ORIGIN_X + Math.round(x);
    const gy = ORIGIN_Y + Math.round(y);
    if (gx < 0 || gx >= CELL_W || gy < 0 || gy >= CELL_H) return;
    const [r, g, b, a] = this.rgba(col);
    const idx = (gy * CELL_W + gx) * 4;
    if (a >= 255 || this.data[idx + 3] === 0) {
      this.data[idx] = r;
      this.data[idx + 1] = g;
      this.data[idx + 2] = b;
      this.data[idx + 3] = a;
    } else {
      const sa = a / 255;
      const da = 1 - sa;
      this.data[idx] = clampByte(r * sa + this.data[idx] * da);
      this.data[idx + 1] = clampByte(g * sa + this.data[idx + 1] * da);
      this.data[idx + 2] = clampByte(b * sa + this.data[idx + 2] * da);
      this.data[idx + 3] = clampByte(a + this.data[idx + 3] * da);
    }
  }

  /** Traza un tramo horizontal inclusivo [x1..x2] en la fila y */
  hline(x1: number, x2: number, y: number, col: string): void {
    const start = Math.min(x1, x2);
    const end = Math.max(x1, x2);
    for (let x = start; x <= end; x++) {
      this.px(x, y, col);
    }
  }

  /** Traza un tramo vertical inclusivo [y1..y2] en la columna x */
  vline(x: number, y1: number, y2: number, col: string): void {
    const start = Math.min(y1, y2);
    const end = Math.max(y1, y2);
    for (let y = start; y <= end; y++) {
      this.px(x, y, col);
    }
  }

  /** Rellena un rectángulo inclusivo por esquinas [x1..x2] x [y1..y2] */
  box(x1: number, y1: number, x2: number, y2: number, col: string): void {
    const sx = Math.min(x1, x2);
    const ex = Math.max(x1, x2);
    const sy = Math.min(y1, y2);
    const ey = Math.max(y1, y2);
    for (let y = sy; y <= ey; y++) {
      for (let x = sx; x <= ex; x++) {
        this.px(x, y, col);
      }
    }
  }

  /**
   * Genera automáticamente un contorno exterior limpio de 1px estilo RPG Maker VX Ace
   * alrededor de todos los materiales opacos sin duplicar pliegues internos oscuros.
   */
  applyOuterOutline(outlineColor: string = DARK_OUTLINE): void {
    const [or, og, ob, oa] = this.rgba(outlineColor);
    const mask = new Uint8Array(CELL_W * CELL_H);
    for (let i = 0; i < CELL_W * CELL_H; i++) {
      const p = i * 4;
      if (
        this.data[p + 3] > 20 &&
        !(this.data[p] === or && this.data[p + 1] === og && this.data[p + 2] === ob)
      ) {
        mask[i] = 1;
      }
    }
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    for (let y = 1; y < CELL_H - 1; y++) {
      for (let x = 1; x < CELL_W - 1; x++) {
        const idx = y * CELL_W + x;
        if (this.data[idx * 4 + 3] > 20) continue;
        let touchesBody = false;
        for (const [dx, dy] of dirs) {
          if (mask[(y + dy) * CELL_W + (x + dx)]) {
            touchesBody = true;
            break;
          }
        }
        if (touchesBody) {
          const p = idx * 4;
          this.data[p] = or;
          this.data[p + 1] = og;
          this.data[p + 2] = ob;
          this.data[p + 3] = oa;
        }
      }
    }
  }
}

interface OutfitPalette {
  jacket: ColorRamp;
  pants: ColorRamp;
  innerShirt: string;
  innerShadow: string;
  belt: string;
  buckle: string;
  accent: string;
  accentDeep: string;
  longCoat?: boolean;
  robe?: boolean;
  bareArms?: boolean;
}

function resolveOutfitPalette(outfitId: string, shirtHex: string): OutfitPalette {
  const userShirt = deriveVxRamp(shirtHex);
  const darkDenim = deriveVxRamp('#263349');
  const charcoalPants = deriveVxRamp('#212634');
  const warmKhaki = deriveVxRamp('#6e553b');

  switch (outfitId) {
    case 'rocker':
      return {
        jacket: deriveVxRamp('#252836'),
        pants: charcoalPants,
        innerShirt: shirtHex,
        innerShadow: userShirt.deep,
        belt: '#17161f',
        buckle: '#cbd5e1',
        accent: '#f45b50',
        accentDeep: '#991b1b',
      };
    case 'mage':
      return {
        jacket: userShirt,
        pants: deriveVxRamp('#2c2247'),
        innerShirt: '#fef08a',
        innerShadow: '#ca8a04',
        belt: '#581c87',
        buckle: '#fde047',
        accent: '#c4b5fd',
        accentDeep: '#7e22ce',
        robe: true,
      };
    case 'indie':
      return {
        jacket: deriveVxRamp('#c99566'),
        pants: darkDenim,
        innerShirt: shirtHex,
        innerShadow: userShirt.mid,
        belt: '#5c3419',
        buckle: '#eab308',
        accent: '#fef3c7',
        accentDeep: '#92400e',
      };
    case 'hippie':
      return {
        jacket: userShirt,
        pants: deriveVxRamp('#4b6b94'),
        innerShirt: '#fef3c7',
        innerShadow: '#d97706',
        belt: '#b45309',
        buckle: '#fbbf24',
        accent: '#f472b6',
        accentDeep: '#34d399',
      };
    case 'punk':
      return {
        jacket: deriveVxRamp('#1e2130'),
        pants: deriveVxRamp('#2e1c36'),
        innerShirt: shirtHex,
        innerShadow: userShirt.deep,
        belt: '#111827',
        buckle: '#e2e8f0',
        accent: '#f43f5e',
        accentDeep: '#9f1239',
      };
    case 'ninja':
      return {
        jacket: deriveVxRamp('#1f2238'),
        pants: deriveVxRamp('#181a2c'),
        innerShirt: userShirt.mid,
        innerShadow: userShirt.deep,
        belt: shirtHex,
        buckle: '#c4b5fd',
        accent: '#a78bfa',
        accentDeep: '#5b21b6',
      };
    case 'knight':
      return {
        jacket: deriveVxRamp('#94a3b8'),
        pants: deriveVxRamp('#475569'),
        innerShirt: shirtHex,
        innerShadow: userShirt.deep,
        belt: '#451a03',
        buckle: '#facc15',
        accent: '#e2e8f0',
        accentDeep: '#334155',
      };
    case 'explorer':
      return {
        jacket: userShirt,
        pants: warmKhaki,
        innerShirt: '#f5ebd6',
        innerShadow: '#cbb793',
        belt: '#5c3317',
        buckle: '#facc15',
        accent: '#84cc16',
        accentDeep: '#4d7c0f',
      };
    case 'pirate':
      return {
        jacket: userShirt,
        pants: deriveVxRamp('#2e293a'),
        innerShirt: '#f8fafc',
        innerShadow: '#cbd5e1',
        belt: '#dc2626',
        buckle: '#facc15',
        accent: '#ef4444',
        accentDeep: '#991b1b',
        longCoat: true,
      };
    case 'scientist':
      return {
        jacket: deriveVxRamp('#f1efe7'),
        pants: charcoalPants,
        innerShirt: shirtHex,
        innerShadow: userShirt.mid,
        belt: '#334155',
        buckle: '#94a3b8',
        accent: '#38bdf8',
        accentDeep: '#0284c7',
        longCoat: true,
      };
    case 'athlete':
      return {
        jacket: userShirt,
        pants: deriveVxRamp('#1e293b'),
        innerShirt: '#f8fafc',
        innerShadow: '#cbd5e1',
        belt: '#f8fafc',
        buckle: '#38bdf8',
        accent: '#f8fafc',
        accentDeep: '#38bdf8',
      };
    case 'cowboy':
      return {
        jacket: deriveVxRamp('#854d27'),
        pants: darkDenim,
        innerShirt: shirtHex,
        innerShadow: userShirt.mid,
        belt: '#451a03',
        buckle: '#facc15',
        accent: '#ef4444',
        accentDeep: '#991b1b',
      };
    case 'cyberpunk':
      return {
        jacket: deriveVxRamp('#1e2038'),
        pants: deriveVxRamp('#17182b'),
        innerShirt: '#22d3ee',
        innerShadow: '#0891b2',
        belt: '#ff4bd8',
        buckle: '#67e8f9',
        accent: '#ff4bd8',
        accentDeep: '#06b6d4',
      };
    case 'artist':
      return {
        jacket: deriveVxRamp('#e2d8c3'),
        pants: darkDenim,
        innerShirt: shirtHex,
        innerShadow: userShirt.mid,
        belt: '#78350f',
        buckle: '#f59e0b',
        accent: '#ef4444',
        accentDeep: '#3b82f6',
      };
    case 'detective':
      return {
        jacket: deriveVxRamp('#3b4963'),
        pants: deriveVxRamp('#252f42'),
        innerShirt: '#f1ece1',
        innerShadow: '#cbd5e1',
        belt: '#1e293b',
        buckle: '#cbd5e1',
        accent: shirtHex,
        accentDeep: userShirt.deep,
        longCoat: true,
      };
    case 'space':
      return {
        jacket: deriveVxRamp('#e2e8f0'),
        pants: deriveVxRamp('#cbd5e1'),
        innerShirt: shirtHex,
        innerShadow: userShirt.deep,
        belt: '#334155',
        buckle: '#38bdf8',
        accent: '#38bdf8',
        accentDeep: '#f97316',
      };
    case 'tribal':
      return {
        jacket: deriveVxRamp('#9a5833'),
        pants: warmKhaki,
        innerShirt: shirtHex,
        innerShadow: userShirt.deep,
        belt: '#d97706',
        buckle: '#fde047',
        accent: '#fb923c',
        accentDeep: '#14b8a6',
        bareArms: true,
      };
    case 'vintage':
      return {
        jacket: userShirt,
        pants: deriveVxRamp('#3a332c'),
        innerShirt: '#faf5e8',
        innerShadow: '#d6cfc2',
        belt: '#451a03',
        buckle: '#facc15',
        accent: '#fde047',
        accentDeep: '#b45309',
      };
    case 'inventor':
      return {
        jacket: deriveVxRamp('#8c542b'),
        pants: charcoalPants,
        innerShirt: shirtHex,
        innerShadow: userShirt.mid,
        belt: '#451a03',
        buckle: '#fbbf24',
        accent: '#f59e0b',
        accentDeep: '#78350f',
      };
    case 'classic':
    default:
      return {
        jacket: userShirt,
        pants: darkDenim,
        innerShirt: '#f8fafc',
        innerShadow: '#cbd5e1',
        belt: '#4a2511',
        buckle: '#facc15',
        accent: '#eab308',
        accentDeep: '#a16207',
      };
  }
}

/**
 * Dibuja piernas y botas articuladas en grilla entera con animación de 3 fotogramas VX Ace:
 * frame 0 = paso izquierdo, frame 1 = postura neutra, frame 2 = paso derecho.
 */
function drawVxLegsAndBoots(
  g: VxPixelGrid,
  dir: VxFacingDirection,
  frame: 0 | 1 | 2,
  pants: ColorRamp,
  boots: ColorRamp,
  robeHemColor?: string
): void {
  const sole = DARK_OUTLINE;

  if (dir === 'down' || dir === 'up') {
    const isDown = dir === 'down';
    const leftStep = frame === 0;
    const rightStep = frame === 2;

    // Pierna izquierda (x = -4..-2)
    const lyTop = -5;
    const lyBot = leftStep ? 1 : rightStep ? -1 : 0;
    g.box(-4, lyTop, -2, lyTop + 2, pants.base);
    g.px(-4, lyTop, pants.deep);
    g.px(-2, lyTop + 1, pants.mid);

    // Bota izquierda
    const lBootTop = lyBot - 2;
    g.hline(-4, -2, lBootTop, boots.light);
    g.box(-4, lBootTop + 1, -2, lyBot, boots.base);
    g.px(-4, lyBot, boots.deep);
    if (isDown && !rightStep) {
      g.px(-3, lBootTop + 1, boots.spec);
      g.px(-2, lBootTop + 1, boots.light);
    } else if (!isDown && leftStep) {
      // Suela levantada vista desde atrás
      g.hline(-4, -2, lyBot, sole);
    }
    g.hline(-4, -2, lyBot + 1, sole);
    g.vline(-5, lyTop, lyBot, DARK_OUTLINE);
    g.vline(-1, lyTop + 1, lyBot, DARK_OUTLINE);

    // Pierna derecha (x = +2..+4)
    const ryTop = -5;
    const ryBot = rightStep ? 1 : leftStep ? -1 : 0;
    g.box(2, ryTop, 4, ryTop + 2, pants.base);
    g.px(4, ryTop, pants.deep);
    g.px(2, ryTop + 1, pants.mid);

    // Bota derecha
    const rBootTop = ryBot - 2;
    g.hline(2, 4, rBootTop, boots.light);
    g.box(2, rBootTop + 1, 4, ryBot, boots.base);
    g.px(4, ryBot, boots.deep);
    if (isDown && !leftStep) {
      g.px(3, rBootTop + 1, boots.spec);
      g.px(2, rBootTop + 1, boots.light);
    } else if (!isDown && rightStep) {
      g.hline(2, 4, ryBot, sole);
    }
    g.hline(2, 4, ryBot + 1, sole);
    g.vline(5, ryTop, ryBot, DARK_OUTLINE);
    g.vline(1, ryTop + 1, ryBot, DARK_OUTLINE);

    // Entrepierna y faldón si lleva túnica
    g.px(0, -5, DARK_OUTLINE);
    if (robeHemColor) {
      g.box(-5, -5, 5, -3, robeHemColor);
      g.hline(-5, 5, -2, DARK_OUTLINE);
    }
  } else {
    // Perfil lateral VX Ace con tijera horizontal de piernas
    const f = dir === 'right' ? 1 : -1;
    const mx = (x: number) => x * f;

    if (frame === 1) {
      // Postura neutra de perfil: pierna centrada con puntera orientada hacia el frente
      g.box(mx(-2), -5, mx(2), -3, pants.base);
      g.vline(mx(-2), -5, -3, pants.deep);
      g.hline(mx(-2), mx(2), -2, boots.light);
      g.box(mx(-2), -1, mx(3), 0, boots.base);
      g.px(mx(-2), 0, boots.deep);
      g.px(mx(2), -1, boots.spec);
      g.px(mx(3), -1, boots.light);
      g.hline(mx(-2), mx(3), 1, sole);
      g.vline(mx(-3), -5, 0, DARK_OUTLINE);
      g.vline(mx(3), -5, -2, DARK_OUTLINE);
      g.px(mx(4), -1, DARK_OUTLINE);
      g.px(mx(4), 0, DARK_OUTLINE);
    } else {
      // Zancada lateral: pierna lejana (más oscura) + pierna cercana (iluminada)
      const nearForward = frame === 0;
      const farDx = nearForward ? -3 : 3;
      const nearDx = nearForward ? 3 : -3;

      // 1. Pierna lejana
      g.box(mx(farDx - 1), -5, mx(farDx + 1), -3, pants.deep);
      g.box(mx(farDx - 1), -2, mx(farDx + 2), -1, boots.mid);
      g.px(mx(farDx + 2), -1, boots.base);
      g.hline(mx(farDx - 1), mx(farDx + 2), 0, sole);
      g.vline(mx(farDx - 2), -5, -1, DARK_OUTLINE);
      g.px(mx(farDx + 3), -1, DARK_OUTLINE);

      // 2. Pierna cercana en primer plano
      g.box(mx(nearDx - 1), -5, mx(nearDx + 1), -3, pants.base);
      g.px(mx(nearDx - 1), -4, pants.mid);
      g.hline(mx(nearDx - 1), mx(nearDx + 1), -2, boots.light);
      g.box(mx(nearDx - 1), -1, mx(nearDx + 2), 0, boots.base);
      g.px(mx(nearDx + 1), -1, boots.spec);
      g.hline(mx(nearDx - 1), mx(nearDx + 2), 1, sole);
      g.vline(mx(nearDx - 2), -5, 0, DARK_OUTLINE);
      g.px(mx(nearDx + 3), -1, DARK_OUTLINE);
      g.px(mx(nearDx + 3), 0, DARK_OUTLINE);
    }

    if (robeHemColor) {
      g.box(mx(-4), -5, mx(4), -3, robeHemColor);
      g.hline(mx(-4), mx(4), -2, DARK_OUTLINE);
    }
  }
}

/**
 * Dibuja el torso compacto y expresivo al estilo RPG Maker VX Ace, con detalles específicos
 * para los 20 conjuntos en las 4 direcciones.
 */
function drawVxTorsoAndOutfit(
  g: VxPixelGrid,
  dir: VxFacingDirection,
  bobY: number,
  outfitId: string,
  pal: OutfitPalette
): void {
  const ty = -13 + bobY; // fila de hombros (-13) hasta cintura (-6)

  if (dir === 'down' || dir === 'up') {
    const isDown = dir === 'down';

    // Cuerpo base del torso (-6..+6)
    g.box(-5, ty, 5, ty + 7, pal.jacket.base);
    g.vline(-6, ty + 1, ty + 7, pal.jacket.mid);
    g.vline(6, ty + 1, ty + 7, pal.jacket.deep);
    g.hline(-5, 5, ty, pal.jacket.light);

    // Cinturón y hebilla en la cintura
    g.hline(-6, 6, ty + 6, pal.belt);
    g.hline(-6, 6, ty + 7, DARK_OUTLINE);
    if (isDown) {
      g.box(-1, ty + 6, 1, ty + 7, pal.buckle);
      g.px(0, ty + 6, '#ffffff');
    } else {
      // Costura trasera sutil
      g.vline(0, ty + 1, ty + 5, pal.jacket.mid);
    }

    // Faldón corto si es abrigo o túnica
    if (pal.longCoat) {
      g.hline(-6, -2, ty + 7, pal.jacket.mid);
      g.hline(2, 6, ty + 7, pal.jacket.deep);
    }

    if (isDown) {
      // Cuello interior en V y solapas limpias
      g.box(-2, ty, 2, ty + 2, pal.innerShirt);
      g.hline(-1, 1, ty + 3, pal.innerShadow);
      g.vline(-3, ty + 1, ty + 5, pal.jacket.deep);
      g.vline(3, ty + 1, ty + 5, pal.jacket.deep);
      g.vline(-4, ty + 1, ty + 3, pal.jacket.light);
    }

    // Detalles icónicos por conjunto
    switch (outfitId) {
      case 'rocker':
        if (isDown) {
          g.box(-2, ty + 1, 2, ty + 5, pal.innerShirt);
          g.px(0, ty + 2, pal.accent);
          g.px(-1, ty + 3, pal.accent);
          g.px(0, ty + 4, '#fde047');
          g.px(-5, ty + 1, '#e2e8f0');
          g.px(5, ty + 1, '#e2e8f0');
        } else {
          g.px(-2, ty + 2, pal.accent);
          g.px(2, ty + 2, pal.accent);
          g.hline(-1, 1, ty + 3, '#fde047');
        }
        break;
      case 'mage':
        g.hline(-5, 5, ty + 1, pal.accent);
        if (isDown) {
          g.px(0, ty + 2, '#fde047');
          g.vline(0, ty + 3, ty + 5, pal.accent);
        }
        break;
      case 'indie':
        if (isDown) {
          g.box(-2, ty + 1, 2, ty + 5, pal.innerShirt);
          g.vline(-3, ty + 1, ty + 5, pal.accent);
          g.vline(3, ty + 1, ty + 5, pal.accent);
        }
        break;
      case 'hippie':
        g.hline(-5, 5, ty + 2, pal.accent);
        g.px(-3, ty + 4, '#fde047');
        g.px(3, ty + 4, pal.accentDeep);
        break;
      case 'punk':
        g.px(-6, ty, pal.accent);
        g.px(6, ty, '#e2e8f0');
        if (isDown) {
          g.px(-4, ty + 2, pal.accent);
          g.px(4, ty + 3, '#e2e8f0');
          g.hline(2, 5, ty + 5, '#cbd5e1');
        }
        break;
      case 'ninja':
        g.hline(-5, 5, ty + 1, pal.accent);
        if (isDown) {
          g.px(-2, ty + 2, pal.accent);
          g.px(-1, ty + 3, pal.accent);
          g.px(0, ty + 4, pal.accent);
          g.px(1, ty + 5, pal.accent);
        }
        break;
      case 'knight':
        // Hombreras de placas metálicas y emblema solar
        g.box(-7, ty, -5, ty + 2, pal.accent);
        g.box(5, ty, 7, ty + 2, pal.accent);
        g.hline(-6, 6, ty + 1, pal.jacket.spec);
        if (isDown) {
          g.box(-1, ty + 2, 1, ty + 4, '#facc15');
          g.px(0, ty + 3, pal.innerShirt);
        }
        break;
      case 'explorer':
        // Arnés cruzado de cuero y brújula
        g.vline(-4, ty + 1, ty + 5, '#5c3317');
        g.vline(4, ty + 1, ty + 5, '#5c3317');
        if (isDown) {
          g.px(3, ty + 4, '#fde047');
          g.px(-4, ty + 3, pal.accent);
        }
        break;
      case 'pirate':
        g.hline(-6, 6, ty + 5, pal.accent);
        if (isDown) {
          g.px(-4, ty + 2, '#facc15');
          g.px(4, ty + 2, '#facc15');
          g.px(-4, ty + 4, '#facc15');
          g.px(4, ty + 4, '#facc15');
        }
        break;
      case 'scientist':
        if (isDown) {
          g.vline(0, ty + 1, ty + 5, '#dc2626');
          g.box(3, ty + 3, 5, ty + 4, '#38bdf8');
        }
        break;
      case 'athlete':
        g.vline(-5, ty + 1, ty + 5, pal.accent);
        g.vline(5, ty + 1, ty + 5, pal.accent);
        if (isDown) {
          g.hline(-2, 2, ty + 3, '#f8fafc');
        } else {
          g.box(-1, ty + 2, 1, ty + 4, '#f8fafc');
        }
        break;
      case 'cowboy':
        if (isDown) {
          g.hline(-3, 3, ty + 1, '#dc2626');
          g.px(0, ty + 2, '#dc2626');
          g.px(4, ty + 2, '#fde047');
        }
        break;
      case 'cyberpunk':
        g.hline(-6, 6, ty, pal.accent);
        if (isDown) {
          g.box(-1, ty + 2, 1, ty + 4, '#67e8f9');
          g.px(0, ty + 3, '#ffffff');
          g.vline(-4, ty + 1, ty + 5, pal.accent);
          g.vline(4, ty + 1, ty + 5, pal.accent);
        } else {
          g.vline(0, ty + 1, ty + 5, '#67e8f9');
        }
        break;
      case 'artist':
        if (isDown) {
          g.hline(-3, 3, ty, '#f59e0b');
          g.px(-3, ty + 3, '#ef4444');
          g.px(3, ty + 2, '#3b82f6');
          g.px(2, ty + 4, '#10b981');
        }
        break;
      case 'detective':
        if (isDown) {
          g.vline(0, ty + 1, ty + 5, pal.accent);
          g.px(-4, ty + 3, '#eab308');
          g.px(4, ty + 3, '#eab308');
        }
        break;
      case 'space':
        g.hline(-6, 6, ty + 1, pal.accent);
        if (isDown) {
          g.box(-3, ty + 2, -1, ty + 3, '#f97316');
          g.box(1, ty + 2, 3, ty + 3, '#38bdf8');
        } else {
          // Mochila soporte vital en la espalda
          g.box(-4, ty + 1, 4, ty + 5, '#64748b');
          g.box(-3, ty + 2, 3, ty + 4, '#94a3b8');
          g.px(-2, ty + 2, '#38bdf8');
          g.px(2, ty + 2, '#ef4444');
        }
        break;
      case 'tribal':
        g.hline(-6, 6, ty + 1, pal.accent);
        g.px(-4, ty + 2, '#fde047');
        g.px(0, ty + 2, pal.accentDeep);
        g.px(4, ty + 2, '#fde047');
        break;
      case 'vintage':
        if (isDown) {
          g.vline(0, ty + 1, ty + 5, '#991b1b');
          g.px(3, ty + 4, '#fde047');
          g.px(4, ty + 5, '#fde047');
        }
        break;
      case 'inventor':
        if (isDown) {
          g.box(-4, ty + 2, 4, ty + 5, '#78350f');
          g.px(-3, ty + 1, '#b45309');
          g.px(3, ty + 1, '#b45309');
          g.box(-1, ty + 3, 1, ty + 4, '#fbbf24');
        }
        break;
    }
  } else {
    // Vista de perfil del torso (-4..+4, más esbelto que el frente)
    const f = dir === 'right' ? 1 : -1;
    const mx = (x: number) => x * f;

    g.box(mx(-4), ty, mx(4), ty + 7, pal.jacket.base);
    g.vline(mx(-4), ty + 1, ty + 7, pal.jacket.deep);
    g.vline(mx(4), ty + 1, ty + 7, pal.jacket.light);
    g.hline(mx(-3), mx(3), ty, pal.jacket.light);

    // Pecho/cuello visible hacia el frente del perfil
    g.vline(mx(3), ty + 1, ty + 3, pal.innerShirt);
    g.hline(mx(-4), mx(4), ty + 6, pal.belt);
    g.px(mx(4), ty + 6, pal.buckle);
    g.hline(mx(-4), mx(4), ty + 7, DARK_OUTLINE);

    if (outfitId === 'knight') {
      g.box(mx(-2), ty, mx(2), ty + 2, pal.accent);
    } else if (outfitId === 'cyberpunk') {
      g.hline(mx(-4), mx(4), ty, pal.accent);
      g.px(mx(4), ty + 3, '#67e8f9');
    } else if (outfitId === 'athlete') {
      g.vline(mx(0), ty + 1, ty + 5, pal.accent);
    } else if (outfitId === 'space') {
      g.box(mx(-6), ty + 1, mx(-4), ty + 5, '#64748b');
      g.px(mx(-5), ty + 2, '#38bdf8');
    }
  }
}

/**
 * Dibuja brazos y manos definidos con balanceo opuesto estilo RPG Maker VX Ace.
 */
function drawVxArms(
  g: VxPixelGrid,
  dir: VxFacingDirection,
  frame: 0 | 1 | 2,
  bobY: number,
  interactReach: number,
  skin: ColorRamp,
  sleeve: ColorRamp,
  bareArms: boolean
): void {
  const armMat = bareArms ? skin : sleeve;
  const ty = -12 + bobY;

  if (dir === 'down' || dir === 'up') {
    const isDown = dir === 'down';
    const leftForward = isDown ? frame === 2 : frame === 0;
    const rightForward = isDown ? frame === 0 : frame === 2;

    const lSwing = leftForward ? 1 : frame === 1 ? 0 : -1;
    const rSwing = rightForward ? 1 : frame === 1 ? 0 : -1;
    const reach = isDown ? interactReach : 0;

    // Brazo izquierdo (x = -9..-8, separado del torso por pliegue de 1px en x = -7)
    const ly = ty + lSwing;
    g.vline(-7, ly, ly + 4 + reach, DARK_OUTLINE);
    g.box(-9, ly, -8, ly + 2, armMat.base);
    g.px(-9, ly, armMat.light);
    g.px(-8, ly + 2, armMat.deep);
    g.box(-9, ly + 3, -8, ly + 4 + reach, skin.base);
    g.px(-9, ly + 3, skin.light);

    // Brazo derecho (x = +8..+9, separado del torso por pliegue de 1px en x = +7)
    const ry = ty + rSwing;
    g.vline(7, ry, ry + 4 + reach, DARK_OUTLINE);
    g.box(8, ry, 9, ry + 2, armMat.base);
    g.px(8, ry, armMat.mid);
    g.px(9, ry + 2, armMat.deep);
    g.box(8, ry + 3, 9, ry + 4 + reach, skin.base);
    g.px(8, ry + 3, skin.light);
  } else {
    // Perfil lateral: brazo cercano oscilando + mano lejana asomando en zancada opuesta
    const f = dir === 'right' ? 1 : -1;
    const mx = (x: number) => x * f;

    // Si frame === 0, el brazo lejano asoma por delante del pecho
    if (frame === 0 || interactReach > 0) {
      const fx = 5 + interactReach;
      g.box(mx(fx - 1), ty + 2, mx(fx), ty + 3, skin.mid);
      g.px(mx(fx), ty + 2, skin.base);
    }

    // Brazo cercano en primer plano (con contorno propio para despegarse del torso)
    const swingDx = frame === 0 ? -2 : frame === 2 ? 2 : 0;
    const ax = swingDx + interactReach;
    g.vline(mx(ax - 2), ty, ty + 4, DARK_OUTLINE);
    g.vline(mx(ax + 2), ty, ty + 4, DARK_OUTLINE);
    g.hline(mx(ax - 1), mx(ax + 1), ty - 1, DARK_OUTLINE);
    g.hline(mx(ax - 1), mx(ax + 1), ty + 5, DARK_OUTLINE);

    g.box(mx(ax - 1), ty, mx(ax + 1), ty + 2, armMat.base);
    g.px(mx(ax + 1), ty, armMat.light);
    g.px(mx(ax - 1), ty + 2, armMat.deep);
    g.box(mx(ax - 1), ty + 3, mx(ax + 1), ty + 4, skin.base);
    g.px(mx(ax + 1), ty + 3, skin.light);
  }
}

/**
 * Dibuja la cabeza y el rostro expresivo de Pixel al estilo RPG Maker VX Ace,
 * incluyendo ojos verticales con pupila/iris/destello, cejas, rubor suave y peinado en capas.
 */
function drawVxHeadAndHair(
  g: VxPixelGrid,
  dir: VxFacingDirection,
  bobY: number,
  blink: boolean,
  skin: ColorRamp,
  hair: ColorRamp,
  hairStyleId: string,
  visorActive: boolean,
  eyepatch: boolean
): void {
  const hy = bobY; // base: cabeza entre y = -32 .. -14

  if (dir === 'down') {
    // 1. Mechones largos traseros si el peinado es largo o coleta
    if (hairStyleId === 'long') {
      g.box(-9, -20 + hy, -7, -11 + hy, hair.deep);
      g.box(7, -20 + hy, 9, -11 + hy, hair.deep);
      g.vline(-8, -19 + hy, -12 + hy, hair.mid);
      g.vline(8, -19 + hy, -12 + hy, hair.mid);
    } else if (hairStyleId === 'ponytail') {
      g.box(-3, -34 + hy, 3, -32 + hy, hair.base);
      g.px(-1, -34 + hy, hair.spec);
      g.hline(-2, 2, -31 + hy, '#ef4444');
    }

    // 2. Silueta ovalada del rostro chibi VX Ace
    g.box(-7, -25 + hy, 7, -17 + hy, skin.base);
    g.hline(-6, 6, -16 + hy, skin.base);
    g.hline(-4, 4, -15 + hy, skin.mid); // contorno suave del mentón
    g.hline(-3, 3, -15 + hy, skin.base);

    // Sombra cálida bajo el flequillo y volumen en mejillas
    g.hline(-7, 7, -24 + hy, skin.mid);
    g.vline(-7, -23 + hy, -18 + hy, skin.mid);
    g.vline(7, -23 + hy, -18 + hy, skin.mid);
    g.box(-2, -20 + hy, 2, -17 + hy, skin.light);
    // Rubor cálido pixel-art en mejillas
    g.px(-6, -17 + hy, '#f39c93');
    g.px(6, -17 + hy, '#f39c93');
    // Sombra mínima de boca/expresión serena
    g.hline(-1, 0, -16 + hy, skin.deep);

    // 3. Ojos verticales expresivos estilo RPG Maker VX Ace (y = -21..-18)
    if (visorActive) {
      g.box(-7, -22 + hy, 7, -18 + hy, '#0f172a');
      g.box(-6, -21 + hy, 6, -19 + hy, '#06b6d4');
      g.hline(-5, 5, -20 + hy, '#67e8f9');
      g.hline(-5, -2, -21 + hy, '#ffffff');
    } else if (blink) {
      g.hline(-6, -3, -19 + hy, DARK_OUTLINE);
      g.hline(3, 6, -19 + hy, DARK_OUTLINE);
      g.hline(-5, -4, -20 + hy, skin.mid);
      g.hline(4, 5, -20 + hy, skin.mid);
    } else {
      // Cejas suaves
      g.hline(-6, -4, -23 + hy, hair.deep);
      g.hline(4, 6, -23 + hy, hair.deep);

      // Ojo izquierdo (-5..-4, pestaña -6..-4)
      g.hline(-6, -4, -21 + hy, DARK_OUTLINE);
      g.px(-5, -20 + hy, '#ffffff'); // destello blanco superior
      g.px(-4, -20 + hy, DARK_OUTLINE);
      g.px(-5, -19 + hy, '#1d4ed8');
      g.px(-4, -19 + hy, DARK_OUTLINE);
      g.px(-5, -18 + hy, '#38bdf8');
      g.px(-4, -18 + hy, '#0284c7');
      g.vline(-3, -20 + hy, -18 + hy, '#fff7ed');

      // Ojo derecho (+4..+5, pestaña +4..+6) o parche pirata
      if (eyepatch) {
        g.box(3, -22 + hy, 6, -18 + hy, DARK_OUTLINE);
        g.box(4, -21 + hy, 5, -19 + hy, '#334155');
        g.hline(-7, 2, -22 + hy, DARK_OUTLINE);
      } else {
        g.hline(4, 6, -21 + hy, DARK_OUTLINE);
        g.px(4, -20 + hy, '#ffffff');
        g.px(5, -20 + hy, DARK_OUTLINE);
        g.px(4, -19 + hy, DARK_OUTLINE);
        g.px(5, -19 + hy, '#1d4ed8');
        g.px(4, -18 + hy, '#0284c7');
        g.px(5, -18 + hy, '#38bdf8');
        g.vline(3, -20 + hy, -18 + hy, '#fff7ed');
      }
    }

    // 4. Bóveda craneal y flequillo en capas según el peinado
    g.hline(-6, 6, -31 + hy, hair.base);
    g.hline(-8, 8, -30 + hy, hair.base);
    g.box(-9, -29 + hy, 9, -25 + hy, hair.base);

    // Sombreado de volumen superior e inferior de la cabellera
    g.hline(-6, 6, -31 + hy, hair.mid);
    g.vline(-9, -29 + hy, -24 + hy, hair.mid);
    g.vline(9, -29 + hy, -24 + hy, hair.deep);

    // Banda de brillo especular en corona (sello clásico de RPG Maker VX Ace)
    g.hline(-6, -3, -28 + hy, hair.spec);
    g.hline(-1, 2, -28 + hy, hair.light);
    g.hline(4, 6, -28 + hy, hair.spec);
    g.px(-4, -27 + hy, hair.light);
    g.px(5, -27 + hy, hair.light);

    // Patillas laterales que enmarcan las sienes
    g.box(-9, -25 + hy, -8, -19 + hy, hair.base);
    g.px(-8, -18 + hy, hair.mid);
    g.box(8, -25 + hy, 9, -19 + hy, hair.mid);
    g.px(8, -18 + hy, hair.deep);

    // Variaciones de flequillo y silueta frontal
    if (hairStyleId === 'cropped') {
      g.hline(-7, 7, -24 + hy, hair.deep);
      g.px(-5, -23 + hy, hair.base);
      g.px(0, -23 + hy, hair.base);
      g.px(5, -23 + hy, hair.mid);
    } else if (hairStyleId === 'parted') {
      // Raya lateral asimétrica
      g.box(-7, -25 + hy, 2, -23 + hy, hair.base);
      g.hline(-6, 0, -22 + hy, hair.mid);
      g.px(-3, -21 + hy, hair.deep);
      g.box(4, -25 + hy, 7, -22 + hy, hair.mid);
      g.px(6, -21 + hy, hair.deep);
      g.vline(3, -27 + hy, -24 + hy, hair.deep);
    } else if (hairStyleId === 'tousled') {
      // Flequillo tupido y redondeado estilo urbano (ref. dd86c9o)
      g.hline(-4, 4, -32 + hy, hair.mid);
      g.box(-7, -25 + hy, 7, -23 + hy, hair.base);
      g.px(-6, -22 + hy, hair.mid);
      g.hline(-3, -1, -22 + hy, hair.base);
      g.px(-2, -21 + hy, hair.deep);
      g.hline(1, 3, -22 + hy, hair.mid);
      g.px(2, -21 + hy, hair.deep);
      g.px(6, -22 + hy, hair.deep);
      g.vline(-4, -26 + hy, -23 + hy, hair.deep);
      g.vline(0, -26 + hy, -23 + hy, hair.mid);
      g.vline(4, -26 + hy, -23 + hy, hair.deep);
    } else {
      // 'hero' / 'long' / 'ponytail': mechones dinámicos VX Ace con puntas definidas
      g.px(-4, -32 + hy, hair.base);
      g.hline(-1, 2, -32 + hy, hair.base);
      g.hline(-7, 7, -24 + hy, hair.base);
      // Tres mechones frontales con surcos oscuros entre sí
      g.box(-6, -24 + hy, -4, -23 + hy, hair.mid);
      g.px(-5, -22 + hy, hair.deep);
      g.box(-2, -24 + hy, 1, -22 + hy, hair.base);
      g.px(0, -21 + hy, hair.mid);
      g.box(3, -24 + hy, 6, -23 + hy, hair.mid);
      g.px(4, -22 + hy, hair.deep);
      g.vline(-3, -26 + hy, -24 + hy, hair.deep);
      g.vline(2, -26 + hy, -24 + hy, hair.deep);
    }
  } else if (dir === 'up') {
    // Vista trasera completa: bóveda capilar con volumen, surcos verticales y puntas escalonadas
    g.hline(-6, 6, -31 + hy, hair.mid);
    g.hline(-8, 8, -30 + hy, hair.base);
    g.box(-9, -29 + hy, 9, -17 + hy, hair.base);

    // Puntas inferiores escalonadas sobre la nuca
    g.hline(-4, 4, -15 + hy, skin.mid); // nuca sutil
    const tipY = hairStyleId === 'long' ? -11 + hy : hairStyleId === 'cropped' ? -17 + hy : -15 + hy;
    if (hairStyleId === 'long') {
      g.box(-8, -17 + hy, 8, tipY, hair.base);
      g.vline(-8, -17 + hy, tipY, hair.mid);
      g.vline(8, -17 + hy, tipY, hair.deep);
    }
    g.hline(-8, -6, tipY, hair.mid);
    g.hline(-4, -2, tipY + 1, hair.deep);
    g.hline(0, 1, tipY, hair.mid);
    g.hline(3, 5, tipY + 1, hair.deep);
    g.hline(6, 8, tipY, hair.deep);

    // Surcos verticales entre mechones estilo VX Ace
    g.vline(-5, -26 + hy, tipY - 1, hair.mid);
    g.vline(-1, -25 + hy, tipY, hair.deep);
    g.vline(3, -26 + hy, tipY - 1, hair.mid);
    g.vline(7, -28 + hy, tipY - 1, hair.deep);
    g.vline(-9, -28 + hy, -18 + hy, hair.mid);
    g.vline(9, -28 + hy, -18 + hy, hair.deep);

    // Banda de brillo especular curva en la coronilla trasera
    g.hline(-6, -3, -27 + hy, hair.spec);
    g.hline(-2, 1, -28 + hy, hair.light);
    g.hline(2, 6, -27 + hy, hair.spec);
    g.px(-5, -26 + hy, hair.light);
    g.px(4, -26 + hy, hair.light);

    if (hairStyleId === 'ponytail') {
      g.box(-2, -33 + hy, 2, -31 + hy, hair.light);
      g.hline(-2, 2, -25 + hy, '#ef4444');
      g.box(-3, -24 + hy, 3, -15 + hy, hair.mid);
      g.vline(0, -24 + hy, -16 + hy, hair.spec);
      g.hline(-2, 2, -14 + hy, hair.deep);
    }
  } else {
    // Perfil lateral auténtico RPG Maker VX Ace (derecha o espejo exacto izquierda)
    const f = dir === 'right' ? 1 : -1;
    const mx = (x: number) => x * f;

    // 1. Rostro en perfil (frente y mejilla hacia +f, cráneo hacia -f)
    g.box(mx(-3), -25 + hy, mx(6), -17 + hy, skin.base);
    g.vline(mx(7), -21 + hy, -17 + hy, skin.base); // curva suave de nariz/mejilla
    g.px(mx(7), -18 + hy, skin.light);
    g.px(mx(5), -17 + hy, '#f39c93'); // rubor lateral
    g.hline(mx(-2), mx(5), -16 + hy, skin.base);
    g.hline(mx(-1), mx(4), -15 + hy, skin.mid);

    // 2. Ojo lateral vertical VX Ace (x = +4..+5)
    if (visorActive) {
      g.box(mx(1), -22 + hy, mx(7), -18 + hy, '#0f172a');
      g.box(mx(2), -21 + hy, mx(7), -19 + hy, '#67e8f9');
      g.hline(mx(3), mx(6), -20 + hy, '#ffffff');
    } else if (blink) {
      g.hline(mx(3), mx(6), -19 + hy, DARK_OUTLINE);
    } else if (eyepatch && dir === 'left') {
      g.box(mx(3), -22 + hy, mx(6), -18 + hy, DARK_OUTLINE);
      g.hline(mx(-2), mx(3), -22 + hy, DARK_OUTLINE);
    } else {
      g.hline(mx(3), mx(6), -23 + hy, hair.deep); // ceja
      g.hline(mx(3), mx(6), -21 + hy, DARK_OUTLINE); // pestaña superior
      g.px(mx(5), -20 + hy, '#ffffff'); // brillo ocular
      g.px(mx(4), -20 + hy, DARK_OUTLINE);
      g.px(mx(4), -19 + hy, DARK_OUTLINE);
      g.px(mx(5), -19 + hy, '#1d4ed8');
      g.px(mx(4), -18 + hy, '#0284c7');
      g.px(mx(5), -18 + hy, '#38bdf8');
    }

    // 3. Cabello en perfil con patilla delante de la oreja y mechones traseros escalonados
    g.hline(mx(-6), mx(5), -31 + hy, hair.mid);
    g.hline(mx(-8), mx(7), -30 + hy, hair.base);
    g.box(mx(-9), -29 + hy, mx(7), -25 + hy, hair.base);

    // Mechones de flequillo adelantados sobre la frente
    g.box(mx(4), -25 + hy, mx(8), -23 + hy, hair.base);
    g.px(mx(8), -22 + hy, hair.mid);
    g.px(mx(6), -22 + hy, hair.deep);

    // Parte posterior del cabello con volumen y puntas hacia atrás
    const backBottom = hairStyleId === 'long' ? -11 + hy : hairStyleId === 'cropped' ? -18 + hy : -16 + hy;
    g.box(mx(-9), -25 + hy, mx(-2), backBottom, hair.base);
    g.vline(mx(-9), -27 + hy, backBottom + 1, hair.deep);
    g.px(mx(-10), -23 + hy, hair.mid);
    g.px(mx(-10), -20 + hy, hair.deep);
    g.vline(mx(-5), -25 + hy, backBottom, hair.mid);

    // Patilla frente a la oreja + oreja pixelada
    g.vline(mx(1), -24 + hy, -19 + hy, hair.mid);
    g.box(mx(-1), -20 + hy, mx(0), -18 + hy, skin.base);
    g.px(mx(-1), -19 + hy, skin.deep);

    // Brillo especular lateral en la corona
    g.hline(mx(-5), mx(3), -28 + hy, hair.spec);
    g.hline(mx(-2), mx(4), -27 + hy, hair.light);

    // Cola de caballo proyectada hacia atrás en perfil
    if (hairStyleId === 'ponytail') {
      g.px(mx(-8), -27 + hy, '#ef4444');
      g.box(mx(-12), -27 + hy, mx(-9), -18 + hy, hair.mid);
      g.vline(mx(-11), -26 + hy, -20 + hy, hair.spec);
    }
  }
}

/**
 * Sombreros propios de conjuntos específicos (mago, pirata, vaquero, detective, ninja, inventor, artista).
 */
function drawVxOutfitHeadgear(
  g: VxPixelGrid,
  dir: VxFacingDirection,
  bobY: number,
  outfitId: string,
  pal: OutfitPalette
): void {
  const hy = bobY;
  switch (outfitId) {
    case 'mage': {
      // Sombrero puntiagudo clásico de mago RPG con cinta dorada
      g.hline(-12, 12, -30 + hy, '#1e1b4b');
      g.hline(-11, 11, -31 + hy, pal.jacket.deep);
      g.hline(-8, 8, -32 + hy, '#fde047');
      g.box(-7, -36 + hy, 7, -33 + hy, pal.jacket.base);
      g.box(-5, -40 + hy, 5, -37 + hy, pal.jacket.base);
      g.box(-2, -43 + hy, 3, -41 + hy, pal.jacket.light);
      g.px(3, -44 + hy, pal.jacket.spec);
      break;
    }
    case 'pirate': {
      // Tricornio marinero con ribete dorado y banda roja
      g.hline(-10, 10, -29 + hy, '#b91c1c');
      g.box(-11, -33 + hy, 11, -30 + hy, '#18181b');
      g.hline(-11, 11, -33 + hy, '#facc15');
      g.box(-7, -36 + hy, 7, -34 + hy, '#27272a');
      if (dir !== 'up') g.box(-1, -33 + hy, 1, -31 + hy, '#facc15');
      break;
    }
    case 'cowboy': {
      // Sombrero vaquero de ala curvada y copa moldeada
      const hat = deriveVxRamp('#7c4722');
      g.hline(-12, 12, -30 + hy, hat.deep);
      g.px(-12, -31 + hy, hat.base);
      g.px(12, -31 + hy, hat.base);
      g.hline(-8, 8, -31 + hy, '#451a03');
      g.px(0, -31 + hy, '#facc15');
      g.box(-7, -36 + hy, 7, -32 + hy, hat.base);
      g.hline(-5, 5, -37 + hy, hat.light);
      g.px(0, -37 + hy, hat.mid); // hendidura central de la copa
      break;
    }
    case 'detective': {
      // Fedora clásico con cinta oscura
      const fed = deriveVxRamp('#334155');
      g.hline(-11, 11, -30 + hy, fed.deep);
      g.hline(-8, 8, -31 + hy, '#0f172a');
      g.box(-7, -35 + hy, 7, -32 + hy, fed.base);
      g.hline(-5, 5, -36 + hy, fed.light);
      break;
    }
    case 'ninja': {
      // Cinta frontal shinobi con placa metálica y máscara inferior
      g.hline(-9, 9, -25 + hy, '#312e81');
      if (dir === 'down') {
        g.box(-3, -25 + hy, 3, -24 + hy, '#cbd5e1');
        g.box(-7, -18 + hy, 7, -15 + hy, '#1e1b4b');
      } else if (dir === 'left' || dir === 'right') {
        const f = dir === 'right' ? 1 : -1;
        g.box(2 * f, -18 + hy, 7 * f, -15 + hy, '#1e1b4b');
        g.hline(-12 * f, -9 * f, -25 + hy, pal.accent);
      }
      break;
    }
    case 'inventor': {
      // Gafas de latón sobre la frente
      if (dir !== 'up') {
        g.hline(-8, 8, -26 + hy, '#451a03');
        g.box(-5, -27 + hy, -2, -25 + hy, '#f59e0b');
        g.box(2, -27 + hy, 5, -25 + hy, '#f59e0b');
        g.px(-4, -26 + hy, '#67e8f9');
        g.px(3, -26 + hy, '#67e8f9');
      }
      break;
    }
    case 'artist': {
      // Boina ladeada de pintor
      g.box(-9, -33 + hy, 7, -30 + hy, '#be123c');
      g.hline(-7, 5, -34 + hy, '#f43f5e');
      g.px(-1, -35 + hy, '#1e293b');
      break;
    }
  }
}

/**
 * Capa trasera de accesorios (capa y mochila) dibujada detrás o sobre la espalda según la orientación.
 */
function drawVxBackAccessories(
  g: VxPixelGrid,
  dir: VxFacingDirection,
  bobY: number,
  accessories: string[],
  architectCrown: boolean
): void {
  const hasCape = accessories.includes('cape') || architectCrown;
  const hasPack = accessories.includes('backpack');
  const ty = -13 + bobY;

  if (hasCape) {
    const cape = deriveVxRamp(architectCrown ? '#7c3aed' : '#be123c');
    if (dir === 'up') {
      g.box(-8, ty + 1, 8, -2 + bobY, cape.base);
      g.vline(-8, ty + 1, -2 + bobY, cape.light);
      g.vline(8, ty + 1, -2 + bobY, cape.deep);
      g.vline(-3, ty + 2, -2 + bobY, cape.mid);
      g.vline(3, ty + 2, -2 + bobY, cape.mid);
      g.hline(-7, 7, -1 + bobY, cape.deep);
    } else if (dir === 'down') {
      g.box(-9, ty + 1, -6, -2 + bobY, cape.deep);
      g.box(6, ty + 1, 9, -2 + bobY, cape.deep);
      g.vline(-8, ty + 2, -3 + bobY, cape.base);
      g.vline(8, ty + 2, -3 + bobY, cape.base);
    } else {
      const f = dir === 'right' ? 1 : -1;
      g.box(-8 * f, ty + 1, -3 * f, -2 + bobY, cape.base);
      g.vline(-8 * f, ty + 2, -2 + bobY, cape.light);
      g.vline(-4 * f, ty + 2, -2 + bobY, cape.deep);
    }
  }

  if (hasPack) {
    const pack = deriveVxRamp('#8c5327');
    if (dir === 'up') {
      g.box(-6, ty + 1, 6, ty + 7, pack.base);
      g.hline(-5, 5, ty, '#d97706'); // manta enrollada arriba
      g.vline(-6, ty + 1, ty + 7, pack.light);
      g.vline(6, ty + 1, ty + 7, pack.deep);
      g.box(-1, ty + 3, 1, ty + 4, '#facc15');
    } else if (dir === 'left' || dir === 'right') {
      const f = dir === 'right' ? 1 : -1;
      g.box(-8 * f, ty + 1, -4 * f, ty + 7, pack.base);
      g.hline(-8 * f, -4 * f, ty, '#d97706');
      g.px(-7 * f, ty + 4, '#facc15');
    }
  }
}

/**
 * Capa frontal/superior de accesorios independientes y cosméticos en las 4 direcciones.
 */
function drawVxFrontAccessories(
  g: VxPixelGrid,
  dir: VxFacingDirection,
  bobY: number,
  accessories: string[],
  architectCrown: boolean
): void {
  const has = (id: string) => accessories.includes(id);
  const hy = bobY;
  const ty = -13 + bobY;

  if (has('cape') || architectCrown) {
    if (dir === 'down') {
      g.hline(-4, 4, ty, '#be123c');
      g.box(-1, ty, 1, ty + 1, '#facc15');
    }
  }

  if (has('scarf')) {
    const sc = deriveVxRamp('#ea580c');
    if (dir === 'down') {
      g.box(-7, ty - 1, 7, ty + 1, sc.base);
      g.hline(-6, 6, ty - 1, sc.light);
      g.box(3, ty + 1, 5, ty + 5, sc.base);
      g.hline(3, 5, ty + 5, sc.deep);
    } else if (dir === 'up') {
      g.box(-7, ty - 1, 7, ty + 1, sc.mid);
    } else {
      const f = dir === 'right' ? 1 : -1;
      g.box(-5 * f, ty - 1, 5 * f, ty + 1, sc.base);
      g.box(-7 * f, ty + 1, -4 * f, ty + 4, sc.mid);
    }
  }

  if (has('mask') && dir !== 'up') {
    if (dir === 'down') {
      g.box(-6, -19 + hy, 6, -15 + hy, '#cbd5e1');
      g.hline(-6, 6, -19 + hy, '#f8fafc');
      g.hline(-5, 5, -16 + hy, '#94a3b8');
    } else {
      const f = dir === 'right' ? 1 : -1;
      g.box(1 * f, -19 + hy, 7 * f, -15 + hy, '#cbd5e1');
      g.hline(1 * f, 7 * f, -19 + hy, '#f8fafc');
    }
  }

  if (has('glasses') && dir !== 'up') {
    if (dir === 'down') {
      g.box(-7, -22 + hy, -2, -18 + hy, DARK_OUTLINE);
      g.box(2, -22 + hy, 7, -18 + hy, DARK_OUTLINE);
      g.hline(-1, 1, -20 + hy, DARK_OUTLINE);
      g.box(-6, -21 + hy, -3, -19 + hy, '#67e8f9');
      g.box(3, -21 + hy, 6, -19 + hy, '#67e8f9');
      g.px(-6, -21 + hy, '#ffffff');
      g.px(3, -21 + hy, '#ffffff');
    } else {
      const f = dir === 'right' ? 1 : -1;
      g.box(2 * f, -22 + hy, 7 * f, -18 + hy, DARK_OUTLINE);
      g.hline(-1 * f, 2 * f, -20 + hy, DARK_OUTLINE);
      g.box(3 * f, -21 + hy, 6 * f, -19 + hy, '#67e8f9');
      g.px(4 * f, -21 + hy, '#ffffff');
    }
  }

  if (has('earrings') && dir !== 'up') {
    if (dir === 'down') {
      g.vline(-9, -18 + hy, -17 + hy, '#facc15');
      g.vline(9, -18 + hy, -17 + hy, '#facc15');
    } else {
      const f = dir === 'right' ? 1 : -1;
      g.vline(-1 * f, -17 + hy, -16 + hy, '#facc15');
    }
  }

  if (has('bandana')) {
    const bd = deriveVxRamp('#dc2626');
    g.box(-9, -28 + hy, 9, -26 + hy, bd.base);
    g.hline(-8, 8, -28 + hy, bd.light);
    if (dir === 'up' || dir === 'right') {
      g.box(-12, -27 + hy, -9, -24 + hy, bd.mid);
    } else {
      g.box(9, -27 + hy, 12, -24 + hy, bd.mid);
    }
  }

  if (has('cap')) {
    const cap = deriveVxRamp('#d97706');
    g.box(-9, -32 + hy, 9, -28 + hy, cap.base);
    g.hline(-7, 7, -33 + hy, cap.light);
    if (dir === 'down') {
      g.hline(-10, 10, -27 + hy, cap.deep);
      g.box(-2, -31 + hy, 2, -30 + hy, '#fef3c7');
    } else if (dir === 'left' || dir === 'right') {
      const f = dir === 'right' ? 1 : -1;
      g.box(4 * f, -28 + hy, 12 * f, -27 + hy, cap.deep);
    }
  }

  if (has('hat')) {
    const hat = deriveVxRamp('#b4783c');
    g.hline(-13, 13, -29 + hy, hat.deep);
    g.hline(-12, 12, -30 + hy, hat.base);
    g.hline(-8, 8, -31 + hy, '#7f1d1d');
    g.box(-8, -36 + hy, 8, -32 + hy, hat.base);
    g.hline(-6, 6, -37 + hy, hat.light);
  }

  if (has('headphones')) {
    g.hline(-8, 8, -33 + hy, '#334155');
    g.vline(-9, -32 + hy, -26 + hy, '#334155');
    g.vline(9, -32 + hy, -26 + hy, '#334155');
    if (dir === 'down' || dir === 'up') {
      g.box(-11, -25 + hy, -9, -20 + hy, '#22d3ee');
      g.box(9, -25 + hy, 11, -20 + hy, '#22d3ee');
      g.vline(-10, -24 + hy, -21 + hy, '#cffafe');
      g.vline(10, -24 + hy, -21 + hy, '#cffafe');
    } else {
      g.box(-2, -24 + hy, 2, -19 + hy, '#22d3ee');
      g.box(-1, -23 + hy, 1, -20 + hy, '#cffafe');
    }
  }

  if (architectCrown) {
    g.box(-7, -35 + hy, 7, -32 + hy, '#facc15');
    g.hline(-6, 6, -33 + hy, '#fde047');
    g.box(-7, -38 + hy, -5, -36 + hy, '#fde047');
    g.box(-1, -39 + hy, 1, -36 + hy, '#fef08a');
    g.box(5, -38 + hy, 7, -36 + hy, '#fde047');
    g.px(0, -34 + hy, '#ef4444');
  }
}

/**
 * Dibuja las 10 apariencias extraordinarias (transformaciones) como sprites completos
 * estilo RPG Maker VX Ace en las 4 direcciones y 3 fotogramas.
 */
function drawVxTransformationSprite(
  g: VxPixelGrid,
  id: string,
  dir: VxFacingDirection,
  frame: 0 | 1 | 2,
  bobY: number,
  blink: boolean,
  interactReach: number,
  accessories: string[],
  architectCrown: boolean
): void {
  const hy = bobY;
  const ty = -13 + bobY;

  drawVxBackAccessories(g, dir, bobY, accessories, architectCrown);

  if (id === 'ghost') {
    // Silueta espectral flotante estilo VX Ace sin piernas rígidas, con cola ondulada
    const sp = deriveVxRamp('#a5f3fc');
    const wave = frame === 0 ? -1 : frame === 2 ? 1 : 0;
    g.hline(-5, 5, -31 + hy, sp.spec);
    g.hline(-7, 7, -30 + hy, sp.light);
    g.box(-8, -29 + hy, 8, -6 + hy, sp.base);
    g.vline(-8, -28 + hy, -7 + hy, sp.light);
    g.vline(8, -28 + hy, -7 + hy, sp.mid);
    // Cola etérea en puntas
    g.box(-8 + wave, -5 + hy, -5 + wave, -2 + hy, sp.mid);
    g.box(-2, -5 + hy, 2, -1 + hy, sp.base);
    g.box(5 + wave, -5 + hy, 8 + wave, -2 + hy, sp.deep);
    // Brazos flotantes cortos
    if (dir === 'down' || dir === 'up') {
      g.box(-10, -14 + hy, -9, -11 + hy, sp.light);
      g.box(9, -14 + hy, 10, -11 + hy, sp.mid);
    }
    if (dir === 'down' && !blink) {
      g.box(-5, -22 + hy, -3, -19 + hy, '#1e1b4b');
      g.box(3, -22 + hy, 5, -19 + hy, '#1e1b4b');
      g.px(-5, -22 + hy, '#ffffff');
      g.px(3, -22 + hy, '#ffffff');
      g.box(-1, -17 + hy, 1, -15 + hy, '#1e1b4b');
    } else if ((dir === 'left' || dir === 'right') && !blink) {
      const f = dir === 'right' ? 1 : -1;
      g.box(4 * f, -22 + hy, 6 * f, -19 + hy, '#1e1b4b');
      g.px(5 * f, -22 + hy, '#ffffff');
    }
    drawVxFrontAccessories(g, dir, bobY, accessories, architectCrown);
    return;
  }

  // Paletas base para las otras 9 transformaciones
  const configs: Record<
    string,
    { skin: string; hair: string; suit: string; pants: string; boots: string; eye: string }
  > = {
    monster: { skin: '#74c668', hair: '#2e6f40', suit: '#4a3728', pants: '#2d241e', boots: '#3f6212', eye: '#facc15' },
    frankenstein: { skin: '#8cc078', hair: '#18181b', suit: '#334155', pants: '#1e293b', boots: '#0f172a', eye: '#fef08a' },
    mummy: { skin: '#dfd0a8', hair: '#c8b486', suit: '#d6c396', pants: '#bda87b', boots: '#9c865b', eye: '#fbbf24' },
    vampire: { skin: '#f1e6ef', hair: '#1a1426', suit: '#881337', pants: '#18181b', boots: '#27272a', eye: '#f43f5e' },
    werewolf: { skin: '#b3835d', hair: '#5c3d28', suit: '#3b4d6b', pants: '#273449', boots: '#452c1e', eye: '#facc15' },
    skeleton: { skin: '#f3ecd8', hair: '#e2d9c0', suit: '#27272a', pants: '#18181b', boots: '#d6cdb5', eye: '#38bdf8' },
    alien: { skin: '#6ee798', hair: '#34d399', suit: '#312e81', pants: '#1e1b4b', boots: '#38bdf8', eye: '#0f172a' },
    demon: { skin: '#e14949', hair: '#3b0d19', suit: '#271526', pants: '#1a0f1a', boots: '#450a0a', eye: '#fde047' },
    glitch: { skin: '#5eead4', hair: '#ff4bd8', suit: '#1e1b4b', pants: '#0f172a', boots: '#22d3ee', eye: '#ff4bd8' },
  };
  const cfg = configs[id] ?? configs.monster;
  const skinR = deriveVxRamp(cfg.skin);
  const hairR = deriveVxRamp(cfg.hair);
  const suitR = deriveVxRamp(cfg.suit);
  const pantsR = deriveVxRamp(cfg.pants);
  const bootsR = deriveVxRamp(cfg.boots);

  drawVxLegsAndBoots(g, dir, frame, pantsR, bootsR);
  drawVxTorsoAndOutfit(g, dir, bobY, 'classic', {
    jacket: suitR,
    pants: pantsR,
    innerShirt: id === 'vampire' ? '#f8fafc' : cfg.skin,
    innerShadow: skinR.mid,
    belt: '#18181b',
    buckle: '#facc15',
    accent: cfg.eye,
    accentDeep: suitR.deep,
  });

  // Costillas óseas sobre el torso para el esqueleto
  if (id === 'skeleton' && dir !== 'up') {
    g.vline(0, ty + 1, ty + 5, skinR.base);
    g.hline(-4, 4, ty + 1, skinR.base);
    g.hline(-4, 4, ty + 3, skinR.mid);
    g.hline(-3, 3, ty + 5, skinR.mid);
  } else if (id === 'mummy') {
    g.hline(-5, 5, ty + 1, '#f5ebd1');
    g.hline(-5, 5, ty + 4, '#b8a376');
  } else if (id === 'vampire' && dir === 'down') {
    // Cuello alto de capa vampírica
    g.box(-9, ty - 3, -6, ty + 1, '#9f1239');
    g.box(6, ty - 3, 9, ty + 1, '#9f1239');
  }

  drawVxArms(g, dir, frame, bobY, interactReach, skinR, suitR, id === 'monster' || id === 'mummy');

  // Cabeza de criatura con rasgos icónicos VX Ace
  const baldHead = id === 'skeleton' || id === 'mummy' || id === 'alien';
  drawVxHeadAndHair(
    g,
    dir,
    bobY,
    blink,
    skinR,
    baldHead ? skinR : hairR,
    baldHead ? 'cropped' : 'hero',
    false,
    false
  );

  // Sobrescribir detalles craneales y faciales específicos por criatura
  if (id === 'monster' || id === 'demon') {
    const hornCol = id === 'demon' ? '#fde047' : '#f5ebd6';
    g.box(-10, -33 + hy, -8, -29 + hy, hornCol);
    g.px(-11, -34 + hy, hornCol);
    g.box(8, -33 + hy, 10, -29 + hy, hornCol);
    g.px(11, -34 + hy, hornCol);
    if (dir === 'down') {
      g.px(-3, -16 + hy, '#ffffff');
      g.px(3, -16 + hy, '#ffffff');
    }
  } else if (id === 'frankenstein') {
    g.box(-8, -32 + hy, 8, -27 + hy, '#18181b');
    g.hline(-11, -9, -21 + hy, '#94a3b8');
    g.hline(9, 11, -21 + hy, '#94a3b8');
    if (dir === 'down') {
      g.hline(-5, 3, -24 + hy, '#475569');
      g.px(-3, -25 + hy, '#475569');
      g.px(1, -25 + hy, '#475569');
    }
  } else if (id === 'mummy') {
    for (let y = -30; y <= -16; y += 3) {
      g.hline(-8, 8, y + hy, y % 2 === 0 ? '#f5ebd1' : '#c2ae82');
    }
    if (dir === 'down') {
      g.box(-6, -21 + hy, -3, -19 + hy, '#18181b');
      g.box(3, -21 + hy, 6, -19 + hy, '#18181b');
      g.px(-5, -20 + hy, '#fbbf24');
      g.px(4, -20 + hy, '#fbbf24');
    }
  } else if (id === 'vampire' && dir === 'down') {
    g.px(-4, -19 + hy, '#f43f5e');
    g.px(4, -19 + hy, '#f43f5e');
    g.px(-2, -16 + hy, '#ffffff');
    g.px(2, -16 + hy, '#ffffff');
  } else if (id === 'werewolf') {
    g.box(-9, -35 + hy, -5, -30 + hy, hairR.base);
    g.px(-7, -32 + hy, '#f4afab');
    g.box(5, -35 + hy, 9, -30 + hy, hairR.base);
    g.px(7, -32 + hy, '#f4afab');
    if (dir === 'down') {
      g.box(-2, -18 + hy, 2, -16 + hy, '#18181b');
    }
  } else if (id === 'skeleton' && dir === 'down') {
    g.box(-6, -21 + hy, -3, -18 + hy, '#0f172a');
    g.box(3, -21 + hy, 6, -18 + hy, '#0f172a');
    g.px(-5, -20 + hy, '#38bdf8');
    g.px(4, -20 + hy, '#38bdf8');
    g.px(0, -17 + hy, '#0f172a');
    g.hline(-3, 3, -15 + hy, '#0f172a');
    g.px(-2, -15 + hy, '#ffffff');
    g.px(0, -15 + hy, '#ffffff');
    g.px(2, -15 + hy, '#ffffff');
  } else if (id === 'alien') {
    g.vline(-5, -36 + hy, -31 + hy, skinR.base);
    g.box(-6, -38 + hy, -4, -36 + hy, '#a7f3d0');
    g.vline(5, -36 + hy, -31 + hy, skinR.base);
    g.box(4, -38 + hy, 6, -36 + hy, '#a7f3d0');
    if (dir === 'down') {
      g.box(-6, -22 + hy, -3, -18 + hy, '#0f172a');
      g.box(3, -22 + hy, 6, -18 + hy, '#0f172a');
      g.px(-5, -21 + hy, '#ffffff');
      g.px(4, -21 + hy, '#ffffff');
    }
  } else if (id === 'glitch') {
    const shift = frame === 0 ? -1 : frame === 2 ? 1 : 0;
    g.hline(-11 + shift, -8 + shift, -27 + hy, '#ff4bd8');
    g.hline(8 + shift, 11 + shift, -22 + hy, '#22d3ee');
    g.hline(-10 - shift, -7 - shift, -11 + hy, '#fde047');
  }

  drawVxFrontAccessories(g, dir, bobY, accessories, architectCrown);
}

const spriteCanvasCache = new Map<string, HTMLCanvasElement>();
const MAX_CACHE_ENTRIES = 320;

function bakeVxSpriteFrame(
  dir: VxFacingDirection,
  frame: 0 | 1 | 2,
  blink: boolean,
  interactReach: number,
  skinHex: string,
  hairHex: string,
  shirtHex: string,
  bootHex: string,
  outfitId: string,
  hairStyleId: string,
  accessories: string[],
  transformationId: string | null,
  equippedCosmetic: string | null
): HTMLCanvasElement {
  const key = [
    dir,
    frame,
    blink ? 1 : 0,
    interactReach,
    skinHex,
    hairHex,
    shirtHex,
    bootHex,
    outfitId,
    hairStyleId,
    accessories.join(','),
    transformationId ?? '',
    equippedCosmetic ?? '',
  ].join('|');

  const existing = spriteCanvasCache.get(key);
  if (existing) return existing;

  const g = new VxPixelGrid();
  const bobY = frame === 1 ? 0 : 1;
  const visorActive = equippedCosmetic === 'item-visor-vectorial';
  const architectCrown = equippedCosmetic === 'item-manto-arquitecto';

  if (transformationId) {
    drawVxTransformationSprite(
      g,
      transformationId,
      dir,
      frame,
      bobY,
      blink,
      interactReach,
      accessories,
      architectCrown
    );
  } else {
    const skinR = deriveVxRamp(skinHex);
    const hairR = deriveVxRamp(hairHex);
    const bootR = deriveVxRamp(bootHex);
    const pal = resolveOutfitPalette(outfitId, shirtHex);

    drawVxBackAccessories(g, dir, bobY, accessories, architectCrown);
    drawVxLegsAndBoots(g, dir, frame, pal.pants, bootR, pal.robe ? pal.jacket.deep : undefined);
    drawVxTorsoAndOutfit(g, dir, bobY, outfitId, pal);
    drawVxArms(g, dir, frame, bobY, interactReach, skinR, pal.jacket, Boolean(pal.bareArms));
    drawVxHeadAndHair(
      g,
      dir,
      bobY,
      blink,
      skinR,
      hairR,
      hairStyleId,
      visorActive,
      outfitId === 'pirate'
    );
    drawVxOutfitHeadgear(g, dir, bobY, outfitId, pal);
    drawVxFrontAccessories(g, dir, bobY, accessories, architectCrown);
  }

  g.applyOuterOutline(DARK_OUTLINE);

  const offscreen = document.createElement('canvas');
  offscreen.width = CELL_W;
  offscreen.height = CELL_H;
  const octx = offscreen.getContext('2d');
  if (octx) {
    const imgData = octx.createImageData(CELL_W, CELL_H);
    imgData.data.set(g.data);
    octx.putImageData(imgData, 0, 0);
  }

  if (spriteCanvasCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = spriteCanvasCache.keys().next().value;
    if (oldestKey !== undefined) spriteCanvasCache.delete(oldestKey);
  }
  spriteCanvasCache.set(key, offscreen);
  return offscreen;
}

/**
 * Renderiza a Pixel en estilo RPG Maker VX Ace manteniendo el anclaje exacto de pies (ax, ay),
 * la sombra elíptica de contacto con el terreno y el halo de la Lámpara de Fósforo.
 */
export function renderPixelVxAce4Dir(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  facingDir: VxFacingDirection,
  walking: boolean,
  sprinting: boolean,
  t: number,
  skin: string,
  hair: string,
  shirt: string,
  opts?: VxPixelRenderOptions
): void {
  if (typeof document === 'undefined') return;

  const appearance = opts?.appearance;
  const reducedMotion = Boolean(opts?.reducedMotion);
  const animT = reducedMotion ? 0 : t;

  // Secuencia clásica RPG Maker VX Ace de 4 tiempos sobre 3 columnas: 1 (neutro) -> 0 (izq) -> 1 (neutro) -> 2 (der)
  const WALK_SEQUENCE: readonly (0 | 1 | 2)[] = [1, 0, 1, 2];
  const cycleIndex = walking && !reducedMotion
    ? Math.floor(animT * (sprinting ? 11.5 : 7.5)) % 4
    : 0;
  const frame: 0 | 1 | 2 = walking && !reducedMotion ? WALK_SEQUENCE[cycleIndex] : 1;

  const idleBreath = !walking && !reducedMotion && Math.sin(animT * 2.6) > 0.72 ? 1 : 0;
  const idleBlink = !walking && !reducedMotion && (animT % 4.8) > 4.64;
  const interactReach = (opts?.interactAnim ?? 0) > 0 ? 2 : 0;

  const rx = Math.round(ax);
  const ry = Math.round(ay);

  ctx.save();
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;

  // 1. Sombra pixelada escalonada de contacto en el suelo (coherente con VX Ace)
  ctx.fillStyle = 'rgba(6, 10, 18, 0.24)';
  ctx.fillRect(rx - 9, ry, 18, 4);
  ctx.fillStyle = 'rgba(6, 10, 18, 0.42)';
  ctx.fillRect(rx - 6, ry + 1, 12, 3);

  // 2. Halo de la Lámpara de Fósforo cuando está encendida en grutas o noche
  if (opts?.lanternActive) {
    const lanternScale = opts.lanternRadiusScale ?? 1;
    ctx.save();
    ctx.fillStyle = 'rgba(250, 204, 21, 0.2)';
    ctx.beginPath();
    ctx.arc(rx, ry - 14, 48 * lanternScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(254, 240, 138, 0.28)';
    ctx.beginPath();
    ctx.arc(rx, ry - 14, 26 * lanternScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 3. Sprite horneado sobre grilla entera de píxeles
  const sprite = bakeVxSpriteFrame(
    facingDir,
    frame,
    idleBlink,
    interactReach,
    skin || '#ffccaa',
    hair || '#331100',
    shirt || '#00cbd4',
    appearance?.bootColor ?? '#1e293b',
    appearance?.outfitId ?? 'classic',
    appearance?.hairStyleId ?? 'hero',
    appearance?.accessories ?? [],
    appearance?.transformationId ?? null,
    opts?.equippedCosmetic ?? null
  );

  if (appearance?.transformationId === 'ghost') {
    const floatY = !reducedMotion ? Math.round(Math.sin(animT * 3.4) * 1.5) : 0;
    ctx.globalAlpha *= 0.88;
    ctx.drawImage(sprite, rx - ORIGIN_X, ry - ORIGIN_Y - 2 + floatY);
  } else {
    ctx.drawImage(sprite, rx - ORIGIN_X, ry - ORIGIN_Y - idleBreath);
  }

  ctx.imageSmoothingEnabled = prevSmoothing;
  ctx.restore();
}
