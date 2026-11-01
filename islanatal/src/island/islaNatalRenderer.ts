/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RENDERER DE LA ISLA NATAL — Pixel-art procedural estilo GBA (hora dorada).
 *
 * Todo se dibuja por código (sin hojas de sprites externas), en el mismo lenguaje
 * visual que la Isla del Origen pero con identidad propia: mar en calma, arena
 * cálida, pradera verde, un alto rocoso, palmeras con brisa y el resplandor cian
 * del viejo gabinete de Pong dormido en la arboleda.
 *
 * Convención de coordenadas: el escenario aplica el transform (dpr · zoom) y pasa
 * vw/vh en unidades de mundo; este módulo rellena el fondo en espacio de pantalla
 * y después traslada a (-camX, -camY).
 */

import type { AvatarAppearance } from '../avatar/avatarOptions';
import type { FacingDirection } from '../rpg/rpgContent';
import {
  drawPixelAvatar4Dir,
  drawGbcWoodenSign,
  drawPongHoverboard,
  drawRpgTreasureChest,
  isWorldBoxVisible,
} from './island70sRenderer';
import {
  ISLA_NATAL_ARCADE_ANCHOR,
  ISLA_NATAL_BOULDERS,
  ISLA_NATAL_CABIN,
  ISLA_NATAL_CLUTTER,
  ISLA_NATAL_DEPARTURE,
  ISLA_NATAL_FLOWERS,
  ISLA_NATAL_PALMS,
  ISLA_NATAL_PATH_PLAZAS,
  ISLA_NATAL_PATH_ROUTES,
  ISLA_NATAL_PEBBLES,
  ISLA_NATAL_SHELLS,
  ISLA_NATAL_SIGNS,
  ISLA_NATAL_SOLIDS,
  ISLA_NATAL_TRAVELER_SITE,
  ISLA_NATAL_TREES,
  ISLA_NATAL_TUFTS,
  ISLA_NATAL_WALK_RECTS,
  ISLA_NATAL_WORLD_H,
  ISLA_NATAL_WORLD_W,
  isIslaNatalPointOnLand,
  isIslaNatalPointOnPath,
  type IslaNatalClutter,
  type IslaNatalPathPlaza,
  type IslaNatalPathRoute,
  type IslaNatalPathTextureId,
  type IslaNatalSurface,
  type IslaNatalWalkRect,
} from './islaNatalData';

export type ArcadeCabinetState = 'dusty' | 'powered' | 'won';

export interface IslaNatalParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface IslaNatalPromptSpec {
  x: number;
  y: number;
  label: string;
  accentHex: string;
}

export interface IslaNatalPlayerRender {
  x: number;
  y: number;
  facingDir: FacingDirection;
  walking: boolean;
  sprinting: boolean;
  interactAnim: number;
  ridingPaddle: boolean;
  /** Inclinación de la tabla al surfear (radianes). */
  rideTilt: number;
}

export interface IslaNatalRenderParams {
  ctx: CanvasRenderingContext2D;
  vw: number;
  vh: number;
  camera: { x: number; y: number };
  elapsed: number;
  reducedMotion: boolean;
  player: IslaNatalPlayerRender;
  skinColor: string;
  hairColor: string;
  shirtColor: string;
  appearance: AvatarAppearance;
  arcadeState: ArcadeCabinetState;
  /** 0 = isla en reposo, 1 = máquina encendida y cargando el aire. */
  charge: number;
  /** Pulso de la anomalía tras la victoria (decae de 1 a 0). */
  signalPulse: number;
  /** La paleta sigue en el suelo, esperando junto al gabinete. */
  paddleOnGround: boolean;
  /** El faro de partida de la playa sur está encendido. */
  departureReady: boolean;
  particles: IslaNatalParticle[];
  prompt: IslaNatalPromptSpec | null;
  shockwaves: { x: number; y: number; t: number; life: number }[];
  /** Escena del viajero del futuro: fase y segundos transcurridos dentro de ella. */
  travelerEvent?: {
    phase: 'storm' | 'arrival' | 'descend' | 'talk' | 'board' | 'departure';
    t: number;
  } | null;
}

const CELL = 32;

const CABINET_POS = { x: 1697, y: 794 };
const HUT_POS = { x: 596, y: 952 };
const SHED_POS = { x: 1624, y: 718 };
const HUERTA_RECT = { x: 1068, y: 940, w: 216, h: 98 };
const SIGN_POS = { x: 1246, y: 1324 };
const NET_POS = { x: 1036, y: 1340 };
const SHELLS_POI_POS = { x: 1318, y: 1358 };
const MAILBOX_POS = { x: 742, y: 1050 };
const MIRADOR_POS = { x: 616, y: 424 };



/** Grúas y atrezo de construcción en la meseta noroeste (Highland). */
const HIGHLAND_CRANES = [
  { x: 412, y: 388, angle: -0.42 },
  { x: 574, y: 334, angle: 0.18 },
];

const HIGHLAND_CONSTRUCTION_PROPS: { x: number; y: number; type: 'wood_pile' | 'crates' | 'barrels' }[] = [
  { x: 446, y: 402, type: 'wood_pile' },
  { x: 520, y: 356, type: 'crates' },
  { x: 614, y: 348, type: 'barrels' },
  { x: 388, y: 546, type: 'crates' },
  { x: 742, y: 362, type: 'wood_pile' },
];

/** Pequeños arbustos dispersos en puntos clave (cerca de caminos),
 *  con densidad variable y giros orgánicos. */
const NATAL_PATH_SIDE_BUSHES: NatalBushSpec[] = [];

function hash2(x: number, y: number): number {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}

/* ------------------------------------------------------------------ */
/* GEOMETRÍA ORGÁNICA DE LA ISLA: CONTORNOS ASIMÉTRICOS Y PLAYAS       */
/* ------------------------------------------------------------------ */

type Vec2 = readonly [number, number];

function catmullRom1D(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Subdivide un polígono cerrado de control en una curva orgánica suave sin esquinas duras. */
function subdivideClosedCatmullRom(
  control: readonly Vec2[],
  samplesPerSegment = 9
): [number, number][] {
  const n = control.length;
  if (n < 3) return control.map((p) => [p[0], p[1]]);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = control[(i - 1 + n) % n];
    const p1 = control[i];
    const p2 = control[(i + 1) % n];
    const p3 = control[(i + 2) % n];
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      out.push([
        catmullRom1D(p0[0], p1[0], p2[0], p3[0], t),
        catmullRom1D(p0[1], p1[1], p2[1], p3[1], t),
      ]);
    }
  }
  return out;
}

function tracePolygonRing(ctx: CanvasRenderingContext2D, ring: readonly Vec2[]): void {
  if (ring.length === 0) return;
  ctx.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) {
    ctx.lineTo(ring[i][0], ring[i][1]);
  }
  ctx.closePath();
}

function pointInPolygonRing(x: number, y: number, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Silueta exterior ampliada un 40 % (2352 × 1736) y equilibrada con armonía natural
 * alrededor del eje central (x = 1176): bahías curvas al norte y al sur, alas costeras
 * compensadas al suroeste y sureste, promontorio rocoso al noroeste y península boscosa al noreste.
 */
const NATAL_ISLAND_CONTROL_POINTS: readonly Vec2[] = [
  // Norte: Bahía del Puerto (Suavizada)
  [1100, 640],
  [1176, 655],
  [1250, 640],
  // Noreste: Curva hacia la Arboleda
  [1400, 620],
  [1600, 580],
  [1800, 600],
  [1950, 680],
  [2000, 850],
  // Este: Península boscosa redondeada
  [1980, 1000],
  [1900, 1150],
  [1800, 1280],
  // Sureste: Hacia el Mirador del Oleaje
  [1650, 1380],
  [1500, 1420],
  // Sur: Gran Bahía de la Playa del Aurora (Circular y amplia)
  [1176, 1450],
  [850, 1420],
  [700, 1380],
  // Suroeste: Curva hacia la casa
  [550, 1280],
  [450, 1150],
  [430, 1000],
  // Oeste: Costa de la pradera
  [450, 850],
  [420, 700],
  // Noroeste: Promontorio del Alto de las Rocas (Irregular pero circularizado)
  [380, 600],
  [400, 450],
  [500, 360],
  [650, 330],
  [800, 360],
  [900, 450],
  [950, 600],
  [1020, 640],
];

/** Pequeños escollos y cayos costeros equilibrados frente a los cabos de la isla ampliada. */
const NATAL_COASTAL_SKERRIES: readonly { surface: IslaNatalSurface; points: readonly Vec2[] }[] = [
  {
    surface: 'rock',
    points: [
      [318, 472],
      [336, 460],
      [354, 468],
      [350, 486],
      [330, 492],
      [314, 482],
    ],
  },
  {
    surface: 'rock',
    points: [
      [512, 314],
      [530, 306],
      [546, 314],
      [540, 328],
      [520, 330],
    ],
  },
  {
    surface: 'sand',
    points: [
      [1896, 1188],
      [1918, 1180],
      [1938, 1192],
      [1932, 1210],
      [1908, 1214],
      [1892, 1202],
    ],
  },
  {
    surface: 'rock',
    points: [
      [572, 1326],
      [590, 1316],
      [606, 1326],
      [600, 1342],
      [578, 1344],
    ],
  },
  {
    surface: 'rock',
    points: [
      [1746, 1326],
      [1764, 1316],
      [1780, 1326],
      [1774, 1342],
      [1752, 1344],
    ],
  },
];

/**
 * Contorno curvo y equilibrado de la pradera interior: se retira tierra adentro frente a las
 * bahías para formar playas curvas naturales y envuelve de forma simétrica los bosques laterales.
 */
const NATAL_MEADOW_CONTROL_POINTS: readonly Vec2[] = [
  // Bahía Norte
  [1100, 680],
  [1176, 690],
  [1250, 680],
  // Noreste: Interior de la Arboleda
  [1400, 660],
  [1550, 620],
  [1750, 640],
  [1880, 720],
  [1920, 850],
  // Este: Borde boscoso
  [1900, 1000],
  [1820, 1120],
  // Sureste: Transición al Mirador
  [1700, 1220],
  [1550, 1260],
  // Sur: Borde de la Playa del Aurora
  [1350, 1275],
  [1176, 1270],
  [1000, 1275],
  // Suroeste: Transición hacia la casa
  [800, 1260],
  [650, 1220],
  [530, 1120],
  [480, 1000],
  // Oeste: Borde de la pradera
  [500, 850],
  [470, 720],
  // Noroeste: Bajo el Alto de las Rocas
  [550, 750],
  [750, 750],
  [850, 720],
  [950, 680],
  [1020, 680],
];

/** Meseta rocosa orgánica del Alto de las Rocas adaptada al mapa ampliado. */
const NATAL_ROCK_PLATEAU_CONTROL_POINTS: readonly Vec2[] = [
  [488, 372],
  [552, 340],
  [634, 336],
  [718, 358],
  [772, 402],
  [798, 466],
  [836, 514],
  [844, 594],
  [826, 676],
  [798, 728],
  [752, 756],
  [696, 758],
  [652, 752],
  [596, 758],
  [534, 762],
  [472, 752],
  [418, 742],
  [380, 672],
  [358, 594],
  [384, 516],
  [370, 444],
  [422, 396],
];

/** Terraza superior curva donde se asienta el Mirador del Alto de las Rocas. */
const NATAL_ROCK_CREST_CONTROL_POINTS: readonly Vec2[] = [
  [496, 380],
  [554, 348],
  [634, 344],
  [712, 366],
  [754, 408],
  [758, 464],
  [732, 498],
  [678, 506],
  [624, 502],
  [568, 508],
  [508, 498],
  [468, 468],
  [474, 418],
];

const NATAL_ISLAND_RING = subdivideClosedCatmullRom(NATAL_ISLAND_CONTROL_POINTS, 9);
const NATAL_SKERRY_RINGS = NATAL_COASTAL_SKERRIES.map((s) => ({
  surface: s.surface,
  ring: subdivideClosedCatmullRom(s.points, 7),
}));
const NATAL_MEADOW_RING = subdivideClosedCatmullRom(NATAL_MEADOW_CONTROL_POINTS, 9);
const NATAL_ROCK_PLATEAU_RING = subdivideClosedCatmullRom(NATAL_ROCK_PLATEAU_CONTROL_POINTS, 8);
const NATAL_ROCK_CREST_RING = subdivideClosedCatmullRom(NATAL_ROCK_CREST_CONTROL_POINTS, 7);

function pointOnLand(x: number, y: number): boolean {
  return pointInPolygonRing(x, y, NATAL_ISLAND_RING);
}

function isPointOnNatalRock(x: number, y: number): boolean {
  return pointInPolygonRing(x, y, NATAL_ROCK_PLATEAU_RING);
}

function getDistanceToMeadowEdge(x: number, y: number): number {
  let minDistanceSq = Infinity;
  const ring = NATAL_MEADOW_RING;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) continue;
    let t = ((x - p1[0]) * dx + (y - p1[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const closestX = p1[0] + t * dx;
    const closestY = p1[1] + t * dy;
    const dsq = (x - closestX) * (x - closestX) + (y - closestY) * (y - closestY);
    if (dsq < minDistanceSq) minDistanceSq = dsq;
  }
  return Math.sqrt(minDistanceSq);
}

function isPointOnNatalMeadow(x: number, y: number): boolean {
  if (!pointInPolygonRing(x, y, NATAL_MEADOW_RING)) return false;
  if (pointInPolygonRing(x, y, NATAL_ROCK_PLATEAU_RING)) return false;
  return pointInPolygonRing(x, y, NATAL_ISLAND_RING);
}

/** Carteles de zona: mismo formato pequeño que los del Origen. */

interface NatalBushSpec {
  x: number;
  y: number;
  seed: number;
  berry: boolean;
}

// 1. Definimos los puntos centrales precisos (anclajes)
const puntosEstrategicos = [
  { x: 1090, y: 695, zona: 'Izquierda del muelle' },
  { x: 1350, y: 710, zona: 'Derecha del muelle (entrada)' },
  { x: 596, y: 952, zona: 'Rodeando la casa de techo rojo' },
  { x: 790, y: 1110, zona: 'Sur del cruce de caminos oeste' },
  { x: 1318, y: 1358, zona: 'Frontera sur antes de la arena' },
  // Nuevos puntos marcados en la captura anterior
  { x: 520, y: 850, zona: 'Borde oeste (entrada cantera)' },
  { x: 920, y: 720, zona: 'Borde norte (claro izquierdo)' },
  { x: 1480, y: 670, zona: 'Borde norte (claro derecho)' },
  { x: 1980, y: 1220, zona: 'Borde sureste (cerca de la costa)' },
  // Refuerzo de bloques tras eliminar árboles
  { x: 720, y: 950, zona: 'Lado este casa (antiguo árbol)' },
  { x: 550, y: 1080, zona: 'Lado suroeste casa (antiguo árbol)' },
  { x: 850, y: 1050, zona: 'Pradera central (bloque extra)' },
  { x: 1550, y: 950, zona: 'Pradera este (bloque extra)' },
];

// Lista final donde guardaremos todos los arbustos válidos
const NATAL_BUSHES: NatalBushSpec[] = [];

// 3. Validar el terreno antes de plantar
function esTerrenoValido(x: number, y: number): boolean {
  // Evitar tapar el buzón (x: 742, y: 1050)
  const dx = x - 742;
  const dy = y - 1050;
  if (dx * dx + dy * dy < 50 * 50) return false;

  // Solo en césped y fuera de los caminos empedrados
  return isPointOnNatalMeadow(x, y) && !isIslaNatalPointOnPath(x, y);
}

// 2. Generamos los grupos
function poblarArbustos() {
  const radioDispersion = 45; // Área máxima alrededor del centro

  puntosEstrategicos.forEach((centro) => {
    // Elegir aleatoriamente entre 12 y 25 arbustos por grupo
    const cantidad = Math.floor(Math.random() * 14) + 12; 

    for (let i = 0; i < cantidad; i++) {
      // Calcular un desplazamiento (offset) aleatorio en círculo
      const angulo = Math.random() * Math.PI * 2;
      const distancia = Math.random() * radioDispersion;

      const posX = centro.x + Math.cos(angulo) * distancia;
      const posY = centro.y + Math.sin(angulo) * distancia;

      if (esTerrenoValido(posX, posY)) {
        NATAL_BUSHES.push({
          x: posX,
          y: posY,
          seed: Math.random(),
          berry: Math.random() > 0.7,
        });
      }
    }
  });
}

poblarArbustos();

/* ------------------------------------------------------------------ */
/* TERRENO PRERENDERIZADO: MÁSCARA DE COSTA Y TEXTURAS ARTESANALES    */
/* ------------------------------------------------------------------ */

const GROUND_PAD = 96;
const COAST_STEP = 2;
const SHELF_RANGE = 104;

const SURFACE_CODE_SAND = 0;
const SURFACE_CODE_GRASS = 1;
const SURFACE_CODE_ROCK = 2;

/** Campo de distancia a la silueta orgánica: controla costa erosionada, bajío y rompiente. */
interface NatalCoastField {
  cols: number;
  rows: number;
  pad: number;
  step: number;
  /** Distancia (en celdas) desde el mar hasta la orilla erosionada. */
  dist: Float32Array;
  /** Distancia (en celdas) desde la tierra hacia el mar: define la orla húmeda de marea. */
  inDist: Float32Array;
  /** Superficie costera más próxima: 0 = arena, 1 = césped, 2 = roca. */
  surface: Uint8Array;
}

interface NatalFoamPoint {
  x: number;
  y: number;
  phase: number;
  band: number;
  horiz: boolean;
  seed: number;
}

interface NatalGrassTiles {
  base: HTMLImageElement | null;
  clover: HTMLImageElement | null;
  sunlit: HTMLImageElement | null;
  mask: number;
}

interface NatalPathTiles {
  images: Record<IslaNatalPathTextureId, HTMLImageElement | null>;
  mask: number;
}

const NATAL_PATH_TILE_SOURCES: Record<IslaNatalPathTextureId, string> = {
  terracotta: '/assets/pixelverse/natal-path-terracotta.png',
  coastal: '/assets/pixelverse/natal-path-coastal.png',
  port: '/assets/pixelverse/natal-path-port.png',
  arboleda: '/assets/pixelverse/natal-path-arboleda.png',
  highland: '/assets/pixelverse/natal-path-highland.png',
};

const NATAL_PATH_FALLBACK_HEX: Record<IslaNatalPathTextureId, string> = {
  terracotta: '#b89464',
  coastal: '#bcae8e',
  port: '#c4ba9c',
  arboleda: '#6e765c',
  highland: '#7f7a6c',
};

const NATAL_PATH_TEXTURE_ORDER: IslaNatalPathTextureId[] = [
  'terracotta',
  'coastal',
  'port',
  'arboleda',
  'highland',
];

interface NatalSandTiles {
  granular: HTMLCanvasElement | null;
  rippled: HTMLCanvasElement | null;
  mask: number;
}

interface NatalWoodTiles {
  aged: HTMLCanvasElement | null;
  warm: HTMLCanvasElement | null;
  weathered: HTMLCanvasElement | null;
  mask: number;
}

interface NatalRockTiles {
  slate: HTMLCanvasElement | null;
  sandstone: HTMLCanvasElement | null;
  mask: number;
}

type NatalRockSpriteKey =
  | 'meadowBoulder'
  | 'basaltSpire'
  | 'coastalCluster'
  | 'sandstoneOutcrop'
  | 'slabWide'
  | 'boulderWide'
  | 'clusterFour'
  | 'spireSharp'
  | 'cragPointed'
  | 'pillarCluster'
  | 'pebbleSmooth'
  | 'pebbleQuad'
  | 'pebbleTrio'
  | 'outcropStepped'
  | 'outcropRidged'
  | 'outcropBlocky'
  | 'ledgeCracked'
  | 'cairnStacked'
  | 'spireSculpted'
  | 'cliffStepped'
  | 'cobbleMound'
  | 'cragConical'
  | 'plinthCarved'
  | 'boulderStriated'
  | 'outcropColumnar'
  | 'outcropTiered';

interface NatalRockSpritePair {
  normal: HTMLCanvasElement;
  flipped: HTMLCanvasElement;
  w: number;
  h: number;
}

type NatalRockAtlas = Partial<Record<NatalRockSpriteKey, NatalRockSpritePair>>;

const NATAL_SAND_GRANULAR_SRC = '/assets/aistudio/96630aeb4027b8722e28830b57576564_6e16ae7c.jpg';
const NATAL_SAND_RIPPLED_SRC = '/assets/aistudio/091ef03ceb1f7adf1d6967ee322945fc_0c1f74b1.jpg';
const NATAL_WOOD_AGED_SRC = '/assets/aistudio/imahges_ad902ded.jpg';
const NATAL_WOOD_WARM_SRC = '/assets/aistudio/imagges_0cb7c4a8.jpg';
const NATAL_WOOD_WEATHERED_SRC = '/assets/aistudio/imaasges_06bc36ec.jpg';
const NATAL_ROCK_SHEET_1_SRC = '/assets/aistudio/8c5aa45a4a2a059f495efcad57f22d4a_a3498a80.jpg';
const NATAL_ROCK_SHEET_2_SRC = '/assets/aistudio/ec4d1099ba59689139bffbeddcf89d59_719b2608.jpg';
const NATAL_ROCK_SHEET_3_SRC = '/assets/aistudio/e557612faecc973b6b94bda1c1100213_d12016cf.jpg';

let coastField: NatalCoastField | null = null;
let coastGroundLayer: HTMLCanvasElement | null = null;
let coastLayerTileMask = -1;
let coastFoam: NatalFoamPoint[] = [];
let natalWaterCausticsImg: HTMLImageElement | null = null;
let natalWaterSurfaceImg: HTMLImageElement | null = null;
let natalGrassTileImg: HTMLImageElement | null = null;
let natalGrassCloverImg: HTMLImageElement | null = null;
let natalGrassSunlitImg: HTMLImageElement | null = null;
let natalSandGranularImg: HTMLImageElement | null = null;
let natalSandRippledImg: HTMLImageElement | null = null;
let natalSandGranularTile: HTMLCanvasElement | null = null;
let natalSandRippledTile: HTMLCanvasElement | null = null;
let natalWoodAgedImg: HTMLImageElement | null = null;
let natalWoodWarmImg: HTMLImageElement | null = null;
let natalWoodWeatheredImg: HTMLImageElement | null = null;
let natalWoodAgedTile: HTMLCanvasElement | null = null;
let natalWoodWarmTile: HTMLCanvasElement | null = null;
let natalWoodWeatheredTile: HTMLCanvasElement | null = null;
let natalRockSheet1Img: HTMLImageElement | null = null;
let natalRockSheet2Img: HTMLImageElement | null = null;
let natalRockSheet3Img: HTMLImageElement | null = null;
let natalRockSlateTile: HTMLCanvasElement | null = null;
let natalRockSandstoneTile: HTMLCanvasElement | null = null;
const natalRockAtlasCache: NatalRockAtlas = {};
const NATAL_WATER_CAUSTICS_SRC = '/assets/aistudio/images_a679ab2f.jpg';
const NATAL_WATER_SURFACE_SRC = '/assets/aistudio/E_32b551ca.jpg';
let natalRockAtlasBakedMask = 0;
const natalPathTileImgs: Partial<Record<IslaNatalPathTextureId, HTMLImageElement>> = {};

function ensureNatalGrassTiles(): NatalGrassTiles {
  if (typeof Image === 'undefined') {
    return { base: null, clover: null, sunlit: null, mask: 0 };
  }
  if (!natalGrassTileImg) {
    natalGrassTileImg = new Image();
    natalGrassTileImg.decoding = 'async';
    natalGrassTileImg.src = '/assets/aistudio/imagDDDes_73e68a15.jpg';
  }
  if (!natalGrassCloverImg) {
    natalGrassCloverImg = new Image();
    natalGrassCloverImg.decoding = 'async';
    natalGrassCloverImg.src = '/assets/aistudio/imagDDDes_73e68a15.jpg';
  }
  if (!natalGrassSunlitImg) {
    natalGrassSunlitImg = new Image();
    natalGrassSunlitImg.decoding = 'async';
    natalGrassSunlitImg.src = '/assets/aistudio/imagDDDes_73e68a15.jpg';
  }
  const base =
    natalGrassTileImg.complete && natalGrassTileImg.naturalWidth > 0 ? natalGrassTileImg : null;
  const clover =
    natalGrassCloverImg.complete && natalGrassCloverImg.naturalWidth > 0
      ? natalGrassCloverImg
      : null;
  const sunlit =
    natalGrassSunlitImg.complete && natalGrassSunlitImg.naturalWidth > 0
      ? natalGrassSunlitImg
      : null;
  const mask = (base ? 1 : 0) | (clover ? 2 : 0) | (sunlit ? 4 : 0);
  return { base, clover, sunlit, mask };
}

function ensureNatalWaterTiles(): { caustics: HTMLImageElement | null; surface: HTMLImageElement | null } {
  if (typeof Image === 'undefined') return { caustics: null, surface: null };
  if (!natalWaterCausticsImg) {
    natalWaterCausticsImg = new Image();
    natalWaterCausticsImg.decoding = 'async';
    natalWaterCausticsImg.src = NATAL_WATER_CAUSTICS_SRC;
  }
  if (!natalWaterSurfaceImg) {
    natalWaterSurfaceImg = new Image();
    natalWaterSurfaceImg.decoding = 'async';
    natalWaterSurfaceImg.src = NATAL_WATER_SURFACE_SRC;
  }
  return {
    caustics: natalWaterCausticsImg.complete && natalWaterCausticsImg.naturalWidth > 0 ? natalWaterCausticsImg : null,
    surface: natalWaterSurfaceImg.complete && natalWaterSurfaceImg.naturalWidth > 0 ? natalWaterSurfaceImg : null,
  };
}

function ensureNatalPathTiles(): NatalPathTiles {
  const empty: Record<IslaNatalPathTextureId, HTMLImageElement | null> = {
    terracotta: null,
    coastal: null,
    port: null,
    arboleda: null,
    highland: null,
  };
  if (typeof Image === 'undefined') {
    return { images: empty, mask: 0 };
  }
  let mask = 0;
  for (let i = 0; i < NATAL_PATH_TEXTURE_ORDER.length; i++) {
    const key = NATAL_PATH_TEXTURE_ORDER[i];
    let img = natalPathTileImgs[key];
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.src = NATAL_PATH_TILE_SOURCES[key];
      natalPathTileImgs[key] = img;
    }
    if (img.complete && img.naturalWidth > 0) {
      empty[key] = img;
      mask |= 1 << i;
    }
  }
  return { images: empty, mask };
}

/**
 * Convierte una fotografía de arena en un mosaico toroidal 100% continuo (sin cortes
 * ni costuras visibles al repetirse con createPattern) y equilibra su escala/color
 * para integrarse con la iluminación dorada de Isla Natal.
 */
function bakeSeamlessSandTile(
  img: HTMLImageElement,
  size: number,
  mode: 'granular' | 'rippled'
): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || !img.complete || img.naturalWidth <= 0) return null;

  const nw = img.naturalWidth;
  const nh = img.naturalHeight;

  // Recorte central limpio evitando bordes de compresión JPG
  let sx = 0;
  let sy = 0;
  let sw = nw;
  let sh = nh;
  if (mode === 'granular') {
    const crop = Math.min(nw, Math.round(nh * 0.72));
    sx = Math.floor((nw - crop) * 0.5);
    sy = Math.floor((nh - crop) * 0.45);
    sw = crop;
    sh = crop;
  } else {
    const cropH = Math.round(nh * 0.88);
    const cropW = Math.min(nw, Math.round(cropH * 1.18));
    sx = Math.floor((nw - cropW) * 0.5);
    sy = Math.floor((nh - cropH) * 0.5);
    sw = cropW;
    sh = cropH;
  }

  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = size;
  rawCanvas.height = size;
  const rctx = rawCanvas.getContext('2d');
  if (!rctx) return null;
  rctx.imageSmoothingEnabled = true;
  rctx.imageSmoothingQuality = 'high';
  rctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);

  const srcData = rctx.getImageData(0, 0, size, size).data;

  // Normalizamos gradientes macro de iluminación para que no se perciba repetición en grilla,
  // preservando intactos el grano mineral, las conchas diminutas y las ondas de viento.
  const blurRadius = Math.max(8, Math.round(size * 0.14));
  const tempLum = new Float32Array(size * size);
  const macroLum = new Float32Array(size * size);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  const totalPx = size * size;

  for (let i = 0; i < totalPx; i++) {
    const p = i * 4;
    sumR += srcData[p];
    sumG += srcData[p + 1];
    sumB += srcData[p + 2];
  }
  const meanR = sumR / totalPx;
  const meanG = sumG / totalPx;
  const meanB = sumB / totalPx;
  const meanLum = 0.299 * meanR + 0.587 * meanG + 0.114 * meanB;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      let count = 0;
      for (let k = -blurRadius; k <= blurRadius; k += 2) {
        const xx = (x + k + size) % size;
        const p = (y * size + xx) * 4;
        acc += 0.299 * srcData[p] + 0.587 * srcData[p + 1] + 0.114 * srcData[p + 2];
        count++;
      }
      tempLum[y * size + x] = acc / count;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      let count = 0;
      for (let k = -blurRadius; k <= blurRadius; k += 2) {
        const yy = (y + k + size) % size;
        acc += tempLum[yy * size + x];
        count++;
      }
      macroLum[y * size + x] = acc / count;
    }
  }

  const eqData = new Uint8ClampedArray(totalPx * 4);
  const flattenStrength = mode === 'granular' ? 0.62 : 0.72;
  // Paleta objetivo cálida y coherente entre ambas muestras de arena
  const targetR = mode === 'granular' ? 210 : 219;
  const targetG = mode === 'granular' ? 176 : 186;
  const targetB = mode === 'granular' ? 124 : 131;
  const contrast = mode === 'granular' ? 0.88 : 0.94;

  for (let i = 0; i < totalPx; i++) {
    const p = i * 4;
    const localMacro = macroLum[i] || meanLum;
    const corr = Math.pow(meanLum / Math.max(32, localMacro), flattenStrength);
    const nr = (srcData[p] * corr - meanR) * contrast + targetR;
    const ng = (srcData[p + 1] * corr - meanG) * contrast + targetG;
    const nb = (srcData[p + 2] * corr - meanB) * contrast + targetB;
    eqData[p] = Math.max(0, Math.min(255, Math.round(nr)));
    eqData[p + 1] = Math.max(0, Math.min(255, Math.round(ng)));
    eqData[p + 2] = Math.max(0, Math.min(255, Math.round(nb)));
    eqData[p + 3] = 255;
  }

  // Síntesis toroidal de 4 cuadrantes desfasados con pesos suaves cosenoidales:
  // garantiza continuidad C1 perfecta en bordes X e Y sin líneas de unión.
  const outCanvas = document.createElement('canvas');
  outCanvas.width = size;
  outCanvas.height = size;
  const octx = outCanvas.getContext('2d');
  if (!octx) return null;
  const outImg = octx.createImageData(size, size);
  const out = outImg.data;
  const half = size >> 1;

  for (let y = 0; y < size; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / size);
    const yShift = (y + half) % size;
    for (let x = 0; x < size; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / size);
      const xShift = (x + half) % size;

      const w00 = wx * wy;
      const w10 = (1 - wx) * wy;
      const w01 = wx * (1 - wy);
      const w11 = (1 - wx) * (1 - wy);

      const i00 = (y * size + x) * 4;
      const i10 = (y * size + xShift) * 4;
      const i01 = (yShift * size + x) * 4;
      const i11 = (yShift * size + xShift) * 4;

      const dst = i00;
      const r = eqData[i00] * w00 + eqData[i10] * w10 + eqData[i01] * w01 + eqData[i11] * w11;
      const g =
        eqData[i00 + 1] * w00 +
        eqData[i10 + 1] * w10 +
        eqData[i01 + 1] * w01 +
        eqData[i11 + 1] * w11;
      const b =
        eqData[i00 + 2] * w00 +
        eqData[i10 + 2] * w10 +
        eqData[i01 + 2] * w01 +
        eqData[i11 + 2] * w11;

      // Sutil cuantización estética para integrarse con el pixel-art de alta calidad
      out[dst] = Math.min(255, Math.round(r / 3) * 3);
      out[dst + 1] = Math.min(255, Math.round(g / 3) * 3);
      out[dst + 2] = Math.min(255, Math.round(b / 3) * 3);
      out[dst + 3] = 255;
    }
  }

  octx.putImageData(outImg, 0, 0);
  return outCanvas;
}

function ensureNatalSandTiles(): NatalSandTiles {
  if (typeof Image === 'undefined') {
    return { granular: null, rippled: null, mask: 0 };
  }
  if (!natalSandGranularImg) {
    natalSandGranularImg = new Image();
    natalSandGranularImg.decoding = 'async';
    natalSandGranularImg.src = NATAL_SAND_GRANULAR_SRC;
  }
  if (!natalSandRippledImg) {
    natalSandRippledImg = new Image();
    natalSandRippledImg.decoding = 'async';
    natalSandRippledImg.src = NATAL_SAND_RIPPLED_SRC;
  }
  if (
    !natalSandGranularTile &&
    natalSandGranularImg.complete &&
    natalSandGranularImg.naturalWidth > 0
  ) {
    natalSandGranularTile = bakeSeamlessSandTile(natalSandGranularImg, 144, 'granular');
  }
  if (
    !natalSandRippledTile &&
    natalSandRippledImg.complete &&
    natalSandRippledImg.naturalWidth > 0
  ) {
    natalSandRippledTile = bakeSeamlessSandTile(natalSandRippledImg, 168, 'rippled');
  }
  const mask = (natalSandGranularTile ? 1 : 0) | (natalSandRippledTile ? 2 : 0);
  return {
    granular: natalSandGranularTile,
    rippled: natalSandRippledTile,
    mask,
  };
}

/**
 * Hornea una textura de tablones de madera en un mosaico horizontal continuo
 * (preservando las juntas rectas entre tablones y eliminando cualquier marca o corte lateral).
 */
function bakeSeamlessWoodTile(
  img: HTMLImageElement,
  tileW: number,
  tileH: number,
  variant: 'aged' | 'warm' | 'weathered'
): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || !img.complete || img.naturalWidth <= 0) return null;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const sx = Math.floor(nw * 0.04);
  const sy = Math.floor(nh * 0.04);
  const sw = Math.max(8, nw - sx * 2);
  const sh = Math.max(8, nh - sy * 2);

  const raw = document.createElement('canvas');
  raw.width = tileW;
  raw.height = tileH;
  const rctx = raw.getContext('2d');
  if (!rctx) return null;
  rctx.imageSmoothingEnabled = true;
  rctx.imageSmoothingQuality = 'high';
  rctx.drawImage(img, sx, sy, sw, sh, 0, 0, tileW, tileH);

  const src = rctx.getImageData(0, 0, tileW, tileH).data;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = tileW;
  outCanvas.height = tileH;
  const octx = outCanvas.getContext('2d');
  if (!octx) return null;
  const outImg = octx.createImageData(tileW, tileH);
  const out = outImg.data;
  const halfW = tileW >> 1;

  for (let y = 0; y < tileH; y++) {
    // Suavizado ligero en el borde superior/inferior para evitar saltos entre filas
    const edgeY = Math.min(y, tileH - 1 - y);
    const wy = edgeY < 6 ? edgeY / 6 : 1;
    const yMirror = (tileH - 1 - y);
    for (let x = 0; x < tileW; x++) {
      // Síntesis horizontal cosenoidal: conserva las líneas horizontales de los tablones
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / tileW);
      const xShift = (x + halfW) % tileW;

      const i0 = (y * tileW + x) * 4;
      const i1 = (y * tileW + xShift) * 4;
      const im = (yMirror * tileW + x) * 4;

      let r = src[i0] * wx + src[i1] * (1 - wx);
      let g = src[i0 + 1] * wx + src[i1 + 1] * (1 - wx);
      let b = src[i0 + 2] * wx + src[i1 + 2] * (1 - wx);

      if (wy < 1) {
        r = r * wy + src[im] * (1 - wy);
        g = g * wy + src[im + 1] * (1 - wy);
        b = b * wy + src[im + 2] * (1 - wy);
      }

      // En la variante cálida eliminamos cualquier destello grisáceo de marca de agua
      // manteniendo la calidez natural del veteado rojizo/ámbar.
      if (variant === 'warm') {
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        if (sat < 36 && r > 120) {
          r = r * 0.92 + 18;
          g = g * 0.78 + 6;
          b = b * 0.62;
        }
        r *= 0.96;
        g *= 0.93;
        b *= 0.90;
      } else if (variant === 'weathered') {
        r *= 0.95;
        g *= 0.94;
        b *= 0.91;
      } else {
        r *= 0.97;
        g *= 0.95;
        b *= 0.92;
      }

      const dst = i0;
      out[dst] = Math.max(0, Math.min(255, Math.round(r / 4) * 4));
      out[dst + 1] = Math.max(0, Math.min(255, Math.round(g / 4) * 4));
      out[dst + 2] = Math.max(0, Math.min(255, Math.round(b / 4) * 4));
      out[dst + 3] = 255;
    }
  }

  octx.putImageData(outImg, 0, 0);
  return outCanvas;
}

function ensureNatalWoodTiles(): NatalWoodTiles {
  if (typeof Image === 'undefined') {
    return { aged: null, warm: null, weathered: null, mask: 0 };
  }
  if (!natalWoodAgedImg) {
    natalWoodAgedImg = new Image();
    natalWoodAgedImg.decoding = 'async';
    natalWoodAgedImg.src = NATAL_WOOD_AGED_SRC;
  }
  if (!natalWoodWarmImg) {
    natalWoodWarmImg = new Image();
    natalWoodWarmImg.decoding = 'async';
    natalWoodWarmImg.src = NATAL_WOOD_WARM_SRC;
  }
  if (!natalWoodWeatheredImg) {
    natalWoodWeatheredImg = new Image();
    natalWoodWeatheredImg.decoding = 'async';
    natalWoodWeatheredImg.src = NATAL_WOOD_WEATHERED_SRC;
  }
  if (!natalWoodAgedTile && natalWoodAgedImg.complete && natalWoodAgedImg.naturalWidth > 0) {
    natalWoodAgedTile = bakeSeamlessWoodTile(natalWoodAgedImg, 96, 64, 'aged');
  }
  if (!natalWoodWarmTile && natalWoodWarmImg.complete && natalWoodWarmImg.naturalWidth > 0) {
    natalWoodWarmTile = bakeSeamlessWoodTile(natalWoodWarmImg, 96, 64, 'warm');
  }
  if (
    !natalWoodWeatheredTile &&
    natalWoodWeatheredImg.complete &&
    natalWoodWeatheredImg.naturalWidth > 0
  ) {
    natalWoodWeatheredTile = bakeSeamlessWoodTile(natalWoodWeatheredImg, 96, 64, 'weathered');
  }
  const mask =
    (natalWoodAgedTile ? 1 : 0) |
    (natalWoodWarmTile ? 2 : 0) |
    (natalWoodWeatheredTile ? 4 : 0);
  return {
    aged: natalWoodAgedTile,
    warm: natalWoodWarmTile,
    weathered: natalWoodWeatheredTile,
    mask,
  };
}

/**
 * Sintetiza un mosaico de roca mineral 100% continuo (sin costuras) a partir de la
 * superficie pétrea de las hojas adjuntas, con micro-fisuras de pixel-art e integración
 * cromática para la meseta y cresta del Alto de las Rocas.
 */
function bakeSeamlessRockTile(
  img: HTMLImageElement,
  crop: { rx: number; ry: number; rw: number; rh: number },
  size: number,
  variant: 'slate' | 'sandstone'
): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || !img.complete || img.naturalWidth <= 0) return null;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const sx = Math.max(0, Math.floor(crop.rx * nw));
  const sy = Math.max(0, Math.floor(crop.ry * nh));
  const sw = Math.max(8, Math.round(crop.rw * nw));
  const sh = Math.max(8, Math.round(crop.rh * nh));

  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = size;
  rawCanvas.height = size;
  const rctx = rawCanvas.getContext('2d');
  if (!rctx) return null;
  rctx.imageSmoothingEnabled = true;
  rctx.imageSmoothingQuality = 'high';
  rctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);

  const srcData = rctx.getImageData(0, 0, size, size).data;
  const totalPx = size * size;
  const blurRadius = Math.max(8, Math.round(size * 0.15));
  const tempLum = new Float32Array(totalPx);
  const macroLum = new Float32Array(totalPx);

  const clampedR = new Float32Array(totalPx);
  const clampedG = new Float32Array(totalPx);
  const clampedB = new Float32Array(totalPx);

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0; i < totalPx; i++) {
    const p = i * 4;
    let r = srcData[p];
    let g = srcData[p + 1];
    let b = srcData[p + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Evitamos que cualquier reflejo muy claro de borde contamine el mosaico mineral
    if (lum > 202) {
      const k = 172 / lum;
      r *= k;
      g *= k;
      b *= k;
    } else if (lum < 58) {
      const k = 74 / Math.max(12, lum);
      r *= k;
      g *= k;
      b *= k;
    }
    clampedR[i] = r;
    clampedG[i] = g;
    clampedB[i] = b;
    sumR += r;
    sumG += g;
    sumB += b;
  }

  const meanR = sumR / totalPx;
  const meanG = sumG / totalPx;
  const meanB = sumB / totalPx;
  const meanLum = 0.299 * meanR + 0.587 * meanG + 0.114 * meanB;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      let count = 0;
      for (let k = -blurRadius; k <= blurRadius; k += 2) {
        const xx = (x + k + size) % size;
        const idx = y * size + xx;
        acc += 0.299 * clampedR[idx] + 0.587 * clampedG[idx] + 0.114 * clampedB[idx];
        count++;
      }
      tempLum[y * size + x] = acc / count;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      let count = 0;
      for (let k = -blurRadius; k <= blurRadius; k += 2) {
        const yy = (y + k + size) % size;
        acc += tempLum[yy * size + x];
        count++;
      }
      macroLum[y * size + x] = acc / count;
    }
  }

  const eqData = new Uint8ClampedArray(totalPx * 4);
  const targetR = variant === 'slate' ? 136 : 162;
  const targetG = variant === 'slate' ? 133 : 144;
  const targetB = variant === 'slate' ? 124 : 116;
  const contrast = variant === 'slate' ? 0.96 : 0.94;

  for (let i = 0; i < totalPx; i++) {
    const p = i * 4;
    const localMacro = macroLum[i] || meanLum;
    const corr = Math.pow(meanLum / Math.max(36, localMacro), 0.68);
    const nr = (clampedR[i] * corr - meanR) * contrast + targetR;
    const ng = (clampedG[i] * corr - meanG) * contrast + targetG;
    const nb = (clampedB[i] * corr - meanB) * contrast + targetB;
    eqData[p] = Math.max(0, Math.min(255, Math.round(nr)));
    eqData[p + 1] = Math.max(0, Math.min(255, Math.round(ng)));
    eqData[p + 2] = Math.max(0, Math.min(255, Math.round(nb)));
    eqData[p + 3] = 255;
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = size;
  outCanvas.height = size;
  const octx = outCanvas.getContext('2d');
  if (!octx) return null;
  const outImg = octx.createImageData(size, size);
  const out = outImg.data;
  const half = size >> 1;

  for (let y = 0; y < size; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / size);
    const yShift = (y + half) % size;
    for (let x = 0; x < size; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / size);
      const xShift = (x + half) % size;

      const w00 = wx * wy;
      const w10 = (1 - wx) * wy;
      const w01 = wx * (1 - wy);
      const w11 = (1 - wx) * (1 - wy);

      const i00 = (y * size + x) * 4;
      const i10 = (y * size + xShift) * 4;
      const i01 = (yShift * size + x) * 4;
      const i11 = (yShift * size + xShift) * 4;

      const r = eqData[i00] * w00 + eqData[i10] * w10 + eqData[i01] * w01 + eqData[i11] * w11;
      const g =
        eqData[i00 + 1] * w00 +
        eqData[i10 + 1] * w10 +
        eqData[i01 + 1] * w01 +
        eqData[i11 + 1] * w11;
      const b =
        eqData[i00 + 2] * w00 +
        eqData[i10 + 2] * w10 +
        eqData[i01 + 2] * w01 +
        eqData[i11 + 2] * w11;

      out[i00] = Math.min(255, Math.round(r / 4) * 4);
      out[i00 + 1] = Math.min(255, Math.round(g / 4) * 4);
      out[i00 + 2] = Math.min(255, Math.round(b / 4) * 4);
      out[i00 + 3] = 255;
    }
  }
  octx.putImageData(outImg, 0, 0);

  // Juntas de lajas naturales y micro-diaclasas toroidales (envolventes en X e Y)
  const drawWrappedRect = (rx: number, ry: number, rw: number, rh: number, style: string) => {
    octx.fillStyle = style;
    for (let oy = -size; oy <= size; oy += size) {
      for (let ox = -size; ox <= size; ox += size) {
        const px = rx + ox;
        const py = ry + oy;
        if (px + rw <= 0 || py + rh <= 0 || px >= size || py >= size) continue;
        octx.fillRect(px, py, rw, rh);
      }
    }
  };

  for (let i = 0; i < 18; i++) {
    const h1 = hash2(i * 37 + (variant === 'slate' ? 11 : 73), i * 19 + 5);
    const h2 = hash2(i * 53 + 17, i * 29 - 13);
    const cx = Math.floor(h1 * size);
    const cy = Math.floor(h2 * size);
    const len = 8 + Math.floor(h1 * 16);
    drawWrappedRect(
      cx,
      cy,
      len,
      1,
      variant === 'slate' ? 'rgba(54, 54, 50, 0.34)' : 'rgba(78, 60, 42, 0.32)'
    );
    drawWrappedRect(
      cx + 1,
      cy + 1,
      Math.max(4, len - 3),
      1,
      variant === 'slate' ? 'rgba(196, 192, 178, 0.24)' : 'rgba(222, 198, 162, 0.24)'
    );
    if (h2 > 0.64) {
      drawWrappedRect(cx + 3, cy - 1, 3, 2, 'rgba(92, 128, 70, 0.28)');
    }
  }

  return outCanvas;
}

type RockBgMode = 'card-white' | 'checker' | 'studio-shadow';

/**
 * Recorta un sprite de roca de cualquiera de las 3 hojas adjuntas, elimina el fondo
 * blanco/damero/sombra de estudio por inundación 4-conexa desde los bordes, descarta
 * fragmentos periféricos, auto-ajusta su caja exacta y hornea versiones pixel-art
 * integradas con la luz cálida de Hora Dorada de Isla Natal.
 */
function extractAndBakeRockSprite(
  img: HTMLImageElement,
  crop: { rx: number; ry: number; rw: number; rh: number },
  bgMode: RockBgMode,
  targetMaxDim: number,
  warmTint = false
): NatalRockSpritePair | null {
  if (typeof document === 'undefined' || !img.complete || img.naturalWidth <= 0) return null;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const sx = Math.max(0, Math.floor(crop.rx * nw));
  const sy = Math.max(0, Math.floor(crop.ry * nh));
  const sw = Math.min(nw - sx, Math.max(8, Math.round(crop.rw * nw)));
  const sh = Math.min(nh - sy, Math.max(8, Math.round(crop.rh * nh)));

  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = sw;
  rawCanvas.height = sh;
  const rctx = rawCanvas.getContext('2d');
  if (!rctx) return null;
  rctx.imageSmoothingEnabled = false;
  rctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  const imgData = rctx.getImageData(0, 0, sw, sh);
  const d = imgData.data;
  const total = sw * sh;

  const isBg = (x: number, y: number): boolean => {
    const p = (y * sw + x) * 4;
    const r = d[p];
    const g = d[p + 1];
    const b = d[p + 2];
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (bgMode === 'card-white') return luma >= 216 && sat <= 24;
    if (bgMode === 'checker') return luma >= 204 && sat <= 22;
    const shadowZone = y >= sh * 0.74;
    return luma >= (shadowZone ? 180 : 212) && sat <= 22;
  };

  // 1. Inundación 4-conexa desde el perímetro de la celda (respeta contornos diagonales de 1px)
  const bg = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const trySeed = (x: number, y: number) => {
    const idx = y * sw + x;
    if (!bg[idx] && isBg(x, y)) {
      bg[idx] = 1;
      queue[tail++] = idx;
    }
  };
  for (let x = 0; x < sw; x++) {
    trySeed(x, 0);
    trySeed(x, sh - 1);
  }
  for (let y = 1; y < sh - 1; y++) {
    trySeed(0, y);
    trySeed(sw - 1, y);
  }
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % sw;
    const cy = (cur / sw) | 0;
    if (cx > 0) trySeed(cx - 1, cy);
    if (cx + 1 < sw) trySeed(cx + 1, cy);
    if (cy > 0) trySeed(cx, cy - 1);
    if (cy + 1 < sh) trySeed(cx, cy + 1);
  }

  // 2. Descarte de fragmentos ajenos que toquen el borde de recorte o motas sueltas
  const visited = new Uint8Array(total);
  const compBuf = new Int32Array(total);
  const components: {
    pixels: Int32Array;
    touchesBorder: boolean;
    score: number;
    count: number;
  }[] = [];
  const centerX = sw * 0.5;
  const centerY = sh * 0.54;

  for (let i = 0; i < total; i++) {
    if (bg[i] || visited[i]) continue;
    let cHead = 0;
    let cTail = 0;
    visited[i] = 1;
    compBuf[cTail++] = i;
    let touchesBorder = false;
    let minDistSq = Infinity;

    while (cHead < cTail) {
      const cur = compBuf[cHead++];
      const x = cur % sw;
      const y = (cur / sw) | 0;
      if (x === 0 || x === sw - 1 || y === 0 || y === sh - 1) touchesBorder = true;
      const dx = x - centerX;
      const dy = y - centerY;
      const dsq = dx * dx + dy * dy;
      if (dsq < minDistSq) minDistSq = dsq;

      for (let ny = Math.max(0, y - 1); ny <= Math.min(sh - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(sw - 1, x + 1); nx++) {
          const nIdx = ny * sw + nx;
          if (!bg[nIdx] && !visited[nIdx]) {
            visited[nIdx] = 1;
            compBuf[cTail++] = nIdx;
          }
        }
      }
    }

    const pixels = compBuf.slice(0, cTail);
    const score = cTail / (1 + minDistSq * 0.003);
    components.push({ pixels, touchesBorder, score, count: cTail });
  }

  if (components.length === 0) return null;
  let primaryIdx = 0;
  for (let i = 1; i < components.length; i++) {
    if (components[i].score > components[primaryIdx].score) primaryIdx = i;
  }
  for (let i = 0; i < components.length; i++) {
    if (i === primaryIdx) continue;
    const comp = components[i];
    if (comp.touchesBorder || comp.count < 6) {
      for (let k = 0; k < comp.pixels.length; k++) {
        bg[comp.pixels[k]] = 1;
      }
    }
  }

  // 3. Limpieza de halo de compresión JPG en el contorno exterior y caja exacta
  let minX = sw;
  let minY = sh;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const idx = y * sw + x;
      const p = idx * 4;
      if (bg[idx]) {
        d[p + 3] = 0;
        continue;
      }
      const touchesBg =
        x === 0 ||
        x === sw - 1 ||
        y === 0 ||
        y === sh - 1 ||
        bg[idx - 1] === 1 ||
        bg[idx + 1] === 1 ||
        bg[idx - sw] === 1 ||
        bg[idx + sw] === 1;

      if (touchesBg) {
        const r = d[p];
        const g = d[p + 1];
        const b = d[p + 2];
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        if (luma > 184 && sat <= 26) {
          d[p + 3] = 0;
          continue;
        }
        if (luma > 136 && sat <= 24) {
          d[p] = Math.round(r * 0.74);
          d[p + 1] = Math.round(g * 0.74);
          d[p + 2] = Math.round(b * 0.74);
          d[p + 3] = 230;
        }
      }

      if (d[p + 3] > 24) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  rctx.putImageData(imgData, 0, 0);

  const trimW = maxX - minX + 1;
  const trimH = maxY - minY + 1;
  const scale = Math.min(1, targetMaxDim / Math.max(trimW, trimH));
  const outW = Math.max(6, Math.round(trimW * scale));
  const outH = Math.max(6, Math.round(trimH * scale));

  const bakeSide = (flipX: boolean): HTMLCanvasElement | null => {
    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const octx = out.getContext('2d');
    if (!octx) return null;

    octx.save();
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    if (flipX) {
      octx.translate(outW, 0);
      octx.scale(-1, 1);
    }
    octx.drawImage(rawCanvas, minX, minY, trimW, trimH, 0, 0, outW, outH);
    octx.restore();

    // Integración direccional de Hora Dorada (sol cálido al oeste, sombra mineral al este)
    octx.globalCompositeOperation = 'source-atop';
    const sunGrad = octx.createLinearGradient(0, 0, outW, outH);
    sunGrad.addColorStop(
      0,
      warmTint ? 'rgba(255, 218, 146, 0.18)' : 'rgba(255, 224, 162, 0.14)'
    );
    sunGrad.addColorStop(0.52, 'rgba(255, 236, 198, 0.02)');
    sunGrad.addColorStop(1, 'rgba(16, 36, 40, 0.18)');
    octx.fillStyle = sunGrad;
    octx.fillRect(0, 0, outW, outH);

    // Oclusión ambiental suave en la base para asentar la roca sobre arena, hierba o meseta
    const baseGrad = octx.createLinearGradient(0, outH * 0.78, 0, outH);
    baseGrad.addColorStop(0, 'rgba(20, 30, 22, 0)');
    baseGrad.addColorStop(1, 'rgba(20, 30, 22, 0.22)');
    octx.fillStyle = baseGrad;
    octx.fillRect(0, outH * 0.78, outW, outH * 0.22);
    octx.globalCompositeOperation = 'source-over';

    // Nitidez pixel-art en bordes alfa para evitar velos semitransparentes
    const baked = octx.getImageData(0, 0, outW, outH);
    const bd = baked.data;
    for (let p = 0; p < bd.length; p += 4) {
      const a = bd[p + 3];
      if (a < 58) {
        bd[p + 3] = 0;
      } else if (a < 162) {
        bd[p] = Math.round(bd[p] * 0.84);
        bd[p + 1] = Math.round(bd[p + 1] * 0.84);
        bd[p + 2] = Math.round(bd[p + 2] * 0.84);
        bd[p + 3] = 228;
      } else {
        bd[p + 3] = 255;
      }
    }
    octx.putImageData(baked, 0, 0);
    return out;
  };

  const normal = bakeSide(false);
  const flipped = bakeSide(true);
  if (!normal || !flipped) return null;
  return { normal, flipped, w: outW, h: outH };
}

function ensureNatalRockImages(): void {
  if (typeof Image === 'undefined') return;
  if (!natalRockSheet1Img) {
    natalRockSheet1Img = new Image();
    natalRockSheet1Img.decoding = 'async';
    natalRockSheet1Img.src = NATAL_ROCK_SHEET_1_SRC;
  }
  if (!natalRockSheet2Img) {
    natalRockSheet2Img = new Image();
    natalRockSheet2Img.decoding = 'async';
    natalRockSheet2Img.src = NATAL_ROCK_SHEET_2_SRC;
  }
  if (!natalRockSheet3Img) {
    natalRockSheet3Img = new Image();
    natalRockSheet3Img.decoding = 'async';
    natalRockSheet3Img.src = NATAL_ROCK_SHEET_3_SRC;
  }
}

function ensureNatalRockTiles(): NatalRockTiles {
  ensureNatalRockImages();
  if (
    !natalRockSlateTile &&
    natalRockSheet3Img &&
    natalRockSheet3Img.complete &&
    natalRockSheet3Img.naturalWidth > 0
  ) {
    natalRockSlateTile = bakeSeamlessRockTile(
      natalRockSheet3Img,
      { rx: 0.072, ry: 0.186, rw: 0.132, rh: 0.044 },
      128,
      'slate'
    );
  }
  if (
    !natalRockSandstoneTile &&
    natalRockSheet1Img &&
    natalRockSheet1Img.complete &&
    natalRockSheet1Img.naturalWidth > 0
  ) {
    natalRockSandstoneTile = bakeSeamlessRockTile(
      natalRockSheet1Img,
      { rx: 0.215, ry: 0.245, rw: 0.150, rh: 0.130 },
      128,
      'sandstone'
    );
  }
  const mask = (natalRockSlateTile ? 1 : 0) | (natalRockSandstoneTile ? 2 : 0);
  return { slate: natalRockSlateTile, sandstone: natalRockSandstoneTile, mask };
}

function ensureNatalRockAtlas(): NatalRockAtlas {
  ensureNatalRockImages();

  if (
    !(natalRockAtlasBakedMask & 1) &&
    natalRockSheet1Img &&
    natalRockSheet1Img.complete &&
    natalRockSheet1Img.naturalWidth > 0
  ) {
    const s1 = natalRockSheet1Img;
    const meadow = extractAndBakeRockSprite(
      s1,
      { rx: 0.105, ry: 0.120, rw: 0.395, rh: 0.380 },
      'card-white',
      58,
      true
    );
    const basalt = extractAndBakeRockSprite(
      s1,
      { rx: 0.505, ry: 0.110, rw: 0.390, rh: 0.395 },
      'card-white',
      74,
      false
    );
    const coastal = extractAndBakeRockSprite(
      s1,
      { rx: 0.105, ry: 0.515, rw: 0.395, rh: 0.375 },
      'card-white',
      64,
      true
    );
    const sandstone = extractAndBakeRockSprite(
      s1,
      { rx: 0.495, ry: 0.500, rw: 0.400, rh: 0.390 },
      'card-white',
      72,
      true
    );
    if (meadow) natalRockAtlasCache.meadowBoulder = meadow;
    if (basalt) natalRockAtlasCache.basaltSpire = basalt;
    if (coastal) natalRockAtlasCache.coastalCluster = coastal;
    if (sandstone) natalRockAtlasCache.sandstoneOutcrop = sandstone;
    natalRockAtlasBakedMask |= 1;
  }

  if (
    !(natalRockAtlasBakedMask & 2) &&
    natalRockSheet2Img &&
    natalRockSheet2Img.complete &&
    natalRockSheet2Img.naturalWidth > 0
  ) {
    const s2 = natalRockSheet2Img;
    const specs: [
      NatalRockSpriteKey,
      { rx: number; ry: number; rw: number; rh: number },
      number,
    ][] = [
      ['slabWide', { rx: 0.210, ry: 0.030, rw: 0.185, rh: 0.140 }, 42],
      ['boulderWide', { rx: 0.565, ry: 0.320, rw: 0.180, rh: 0.155 }, 40],
      ['clusterFour', { rx: 0.785, ry: 0.320, rw: 0.170, rh: 0.150 }, 42],
      ['spireSharp', { rx: 0.012, ry: 0.470, rw: 0.130, rh: 0.195 }, 46],
      ['cragPointed', { rx: 0.278, ry: 0.475, rw: 0.152, rh: 0.160 }, 44],
      ['pillarCluster', { rx: 0.772, ry: 0.472, rw: 0.182, rh: 0.165 }, 48],
      ['pebbleSmooth', { rx: 0.168, ry: 0.662, rw: 0.130, rh: 0.105 }, 14],
      ['pebbleQuad', { rx: 0.310, ry: 0.640, rw: 0.162, rh: 0.128 }, 20],
      ['pebbleTrio', { rx: 0.640, ry: 0.660, rw: 0.145, rh: 0.105 }, 18],
      ['outcropStepped', { rx: 0.015, ry: 0.775, rw: 0.195, rh: 0.190 }, 62],
      ['outcropRidged', { rx: 0.382, ry: 0.780, rw: 0.185, rh: 0.185 }, 60],
      ['outcropBlocky', { rx: 0.762, ry: 0.780, rw: 0.195, rh: 0.185 }, 62],
    ];
    for (const [key, crop, dim] of specs) {
      const pair = extractAndBakeRockSprite(s2, crop, 'checker', dim, false);
      if (pair) natalRockAtlasCache[key] = pair;
    }
    natalRockAtlasBakedMask |= 2;
  }

  if (
    !(natalRockAtlasBakedMask & 4) &&
    natalRockSheet3Img &&
    natalRockSheet3Img.complete &&
    natalRockSheet3Img.naturalWidth > 0
  ) {
    const s3 = natalRockSheet3Img;
    const specs: [
      NatalRockSpriteKey,
      { rx: number; ry: number; rw: number; rh: number },
      number,
    ][] = [
      ['ledgeCracked', { rx: 0.040, ry: 0.162, rw: 0.198, rh: 0.116 }, 52],
      ['cairnStacked', { rx: 0.805, ry: 0.172, rw: 0.148, rh: 0.155 }, 44],
      ['spireSculpted', { rx: 0.050, ry: 0.540, rw: 0.122, rh: 0.182 }, 48],
      ['cliffStepped', { rx: 0.802, ry: 0.572, rw: 0.158, rh: 0.125 }, 50],
      ['cobbleMound', { rx: 0.042, ry: 0.712, rw: 0.132, rh: 0.108 }, 38],
      ['cragConical', { rx: 0.702, ry: 0.656, rw: 0.116, rh: 0.156 }, 44],
      ['plinthCarved', { rx: 0.048, ry: 0.822, rw: 0.172, rh: 0.130 }, 46],
      ['boulderStriated', { rx: 0.216, ry: 0.808, rw: 0.156, rh: 0.145 }, 46],
      ['outcropColumnar', { rx: 0.678, ry: 0.810, rw: 0.138, rh: 0.142 }, 58],
      ['outcropTiered', { rx: 0.808, ry: 0.815, rw: 0.150, rh: 0.138 }, 62],
    ];
    for (const [key, crop, dim] of specs) {
      const pair = extractAndBakeRockSprite(s3, crop, 'studio-shadow', dim, false);
      if (pair) natalRockAtlasCache[key] = pair;
    }
    natalRockAtlasBakedMask |= 4;
  }

  return natalRockAtlasCache;
}

/**
 * Micro-erosión natural de la línea de costa (en píxeles): suave y fluida en playas
 * de arena, más quebrada y mineral en los acantilados del Alto de las Rocas.
 */
function coastMicroErosion(wx: number, wy: number, surfaceCode: number): number {
  const waveLong = Math.sin(wx * 0.024 + Math.cos(wy * 0.019) * 1.9);
  const waveMed = Math.sin(wy * 0.043 - wx * 0.029 + 1.4);
  const waveFine = Math.sin((wx - wy) * 0.085 + 0.8);
  const grain = hash2(Math.floor(wx / 5) + 31, Math.floor(wy / 5) - 47) - 0.5;
  if (surfaceCode === SURFACE_CODE_ROCK) {
    return waveLong * 4.6 + waveMed * 3.8 + waveFine * 2.4 + grain * 4.2;
  }
  return waveLong * 3.4 + waveMed * 2.1 + waveFine * 0.9 + grain * 1.6;
}

/** Garantiza que ningún punto caminable del jugador quede jamás sobre el agua. */
function isInsideWalkableSafetyCore(wx: number, wy: number): boolean {
  const inset = 4;
  for (let i = 0; i < ISLA_NATAL_WALK_RECTS.length; i++) {
    const r: IslaNatalWalkRect = ISLA_NATAL_WALK_RECTS[i];
    if (
      wx >= r.x + inset &&
      wx <= r.x + r.w - inset &&
      wy >= r.y + inset &&
      wy <= r.y + r.h - inset
    ) {
      return true;
    }
  }
  return false;
}

function runChamferSweep(
  cols: number,
  rows: number,
  dist: Float32Array,
  inDist: Float32Array,
  surface?: Uint8Array
): void {
  const D = Math.SQRT2;
  const relax = (i: number, ni: number, weight: number) => {
    if (dist[ni] + weight < dist[i]) {
      dist[i] = dist[ni] + weight;
      if (surface) surface[i] = surface[ni];
    }
  };
  const relaxInner = (i: number, ni: number, weight: number) => {
    if (inDist[ni] + weight < inDist[i]) inDist[i] = inDist[ni] + weight;
  };

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const i = cy * cols + cx;
      if (cx > 0) {
        relax(i, i - 1, 1);
        relaxInner(i, i - 1, 1);
      }
      if (cy > 0) {
        relax(i, i - cols, 1);
        relaxInner(i, i - cols, 1);
        if (cx > 0) {
          relax(i, i - cols - 1, D);
          relaxInner(i, i - cols - 1, D);
        }
        if (cx < cols - 1) {
          relax(i, i - cols + 1, D);
          relaxInner(i, i - cols + 1, D);
        }
      }
    }
  }
  for (let cy = rows - 1; cy >= 0; cy--) {
    for (let cx = cols - 1; cx >= 0; cx--) {
      const i = cy * cols + cx;
      if (cx < cols - 1) {
        relax(i, i + 1, 1);
        relaxInner(i, i + 1, 1);
      }
      if (cy < rows - 1) {
        relax(i, i + cols, 1);
        relaxInner(i, i + cols, 1);
        if (cx < cols - 1) {
          relax(i, i + cols + 1, D);
          relaxInner(i, i + cols + 1, D);
        }
        if (cx > 0) {
          relax(i, i + cols - 1, D);
          relaxInner(i, i + cols - 1, D);
        }
      }
    }
  }
}

function buildCoastField(): NatalCoastField {
  const pad = GROUND_PAD;
  const step = COAST_STEP;
  const cols = Math.ceil((ISLA_NATAL_WORLD_W + pad * 2) / step) + 1;
  const rows = Math.ceil((ISLA_NATAL_WORLD_H + pad * 2) / step) + 1;
  const total = cols * rows;
  const dist = new Float32Array(total);
  const inDist = new Float32Array(total);
  const surface = new Uint8Array(total);

  // 1. Rasterización rápida de los contornos orgánicos (isla, escollos, pradera y roca)
  const baseLand = new Uint8Array(total);
  if (typeof document !== 'undefined') {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = cols;
    maskCanvas.height = rows;
    const mctx = maskCanvas.getContext('2d');
    if (mctx) {
      mctx.save();
      mctx.scale(1 / step, 1 / step);
      mctx.translate(pad, pad);

      // Canal R: masa terrestre principal + cayos/escollos + núcleo seguro caminable
      mctx.fillStyle = '#ff0000';
      mctx.beginPath();
      tracePolygonRing(mctx, NATAL_ISLAND_RING);
      for (const sk of NATAL_SKERRY_RINGS) tracePolygonRing(mctx, sk.ring);
      mctx.fill();
      for (const r of ISLA_NATAL_WALK_RECTS) {
        mctx.fillRect(r.x + 4, r.y + 4, Math.max(2, r.w - 8), Math.max(2, r.h - 8));
      }

      // Canal G: pradera interior (solo donde ya existe masa terrestre)
      mctx.globalCompositeOperation = 'source-atop';
      mctx.fillStyle = '#ff8000';
      mctx.beginPath();
      tracePolygonRing(mctx, NATAL_MEADOW_RING);
      mctx.fill();

      // Canal B: promontorio rocoso y escollos de roca
      mctx.fillStyle = '#ff00ff';
      mctx.beginPath();
      tracePolygonRing(mctx, NATAL_ROCK_PLATEAU_RING);
      for (const sk of NATAL_SKERRY_RINGS) {
        if (sk.surface === 'rock') tracePolygonRing(mctx, sk.ring);
      }
      mctx.fill();
      mctx.restore();

      const img = mctx.getImageData(0, 0, cols, rows).data;
      for (let i = 0; i < total; i++) {
        const p = i * 4;
        if (img[p + 3] > 96 && img[p] > 96) {
          baseLand[i] = 1;
          surface[i] =
            img[p + 2] > 128
              ? SURFACE_CODE_ROCK
              : img[p + 1] > 64
                ? SURFACE_CODE_GRASS
                : SURFACE_CODE_SAND;
        }
      }
    }
  } else {
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const wx = cx * step - pad + step * 0.5;
        const wy = cy * step - pad + step * 0.5;
        const idx = cy * cols + cx;
        if (pointInPolygonRing(wx, wy, NATAL_ISLAND_RING) || isInsideWalkableSafetyCore(wx, wy)) {
          baseLand[idx] = 1;
          surface[idx] = pointInPolygonRing(wx, wy, NATAL_ROCK_PLATEAU_RING)
            ? SURFACE_CODE_ROCK
            : pointInPolygonRing(wx, wy, NATAL_MEADOW_RING)
              ? SURFACE_CODE_GRASS
              : SURFACE_CODE_SAND;
        }
      }
    }
  }

  for (let i = 0; i < total; i++) {
    if (baseLand[i]) {
      dist[i] = 0;
      inDist[i] = 9999;
    } else {
      dist[i] = 9999;
      inDist[i] = 0;
    }
  }
  runChamferSweep(cols, rows, dist, inDist, surface);

  // 2. Aplicamos micro-erosión marina al borde para tallar calas, salientes y rocas vivas
  const erodedLand = new Uint8Array(total);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const i = cy * cols + cx;
      const wx = cx * step - pad + step * 0.5;
      const wy = cy * step - pad + step * 0.5;
      const rawSdPx = (dist[i] > 0 ? dist[i] : -inDist[i]) * step;
      if (Math.abs(rawSdPx) > 14) {
        erodedLand[i] = rawSdPx <= 0 ? 1 : 0;
        continue;
      }
      // En el arranque del muelle del Puerto Norte mantenemos la orilla limpia en x ≈ 1176, y ≈ 668
      const dockBlend =
        wy > 646 && wy < 698 && wx > 1132 && wx < 1220
          ? Math.max(0, 1 - Math.abs(wx - 1176) / 44)
          : 0;
      const erosion = coastMicroErosion(wx, wy, surface[i]) * (1 - dockBlend * 0.75);
      if (rawSdPx - erosion <= 0 || isInsideWalkableSafetyCore(wx, wy)) {
        erodedLand[i] = 1;
      }
    }
  }

  // 3. Campo de distancias definitivo sobre la silueta erosionada
  for (let i = 0; i < total; i++) {
    if (erodedLand[i]) {
      dist[i] = 0;
      inDist[i] = 9999;
    } else {
      dist[i] = 9999;
      inDist[i] = 0;
    }
  }
  runChamferSweep(cols, rows, dist, inDist, surface);

  return { cols, rows, pad, step, dist, inDist, surface };
}

function sampleDistancePx(field: NatalCoastField, wx: number, wy: number): number {
  const fx = (wx + field.pad) / field.step - 0.5;
  const fy = (wy + field.pad) / field.step - 0.5;
  const x0 = Math.max(0, Math.min(field.cols - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(field.rows - 1, Math.floor(fy)));
  const x1 = Math.min(field.cols - 1, x0 + 1);
  const y1 = Math.min(field.rows - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const i00 = y0 * field.cols + x0;
  const i10 = y0 * field.cols + x1;
  const i01 = y1 * field.cols + x0;
  const i11 = y1 * field.cols + x1;
  const top = field.dist[i00] + (field.dist[i10] - field.dist[i00]) * tx;
  const bottom = field.dist[i01] + (field.dist[i11] - field.dist[i01]) * tx;
  return (top + (bottom - top) * ty) * field.step;
}

function sampleSurfaceAt(field: NatalCoastField, wx: number, wy: number): IslaNatalSurface {
  const cx = Math.round((wx + field.pad) / field.step - 0.5);
  const cy = Math.round((wy + field.pad) / field.step - 0.5);
  const x = Math.max(0, Math.min(field.cols - 1, cx));
  const y = Math.max(0, Math.min(field.rows - 1, cy));
  const code = field.surface[y * field.cols + x];
  if (code === SURFACE_CODE_ROCK) return 'rock';
  if (code === SURFACE_CODE_GRASS) return 'grass';
  return 'sand';
}

function sampleInnerDistancePx(field: NatalCoastField, wx: number, wy: number): number {
  const fx = (wx + field.pad) / field.step - 0.5;
  const fy = (wy + field.pad) / field.step - 0.5;
  const x0 = Math.max(0, Math.min(field.cols - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(field.rows - 1, Math.floor(fy)));
  const x1 = Math.min(field.cols - 1, x0 + 1);
  const y1 = Math.min(field.rows - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const i00 = y0 * field.cols + x0;
  const i10 = y0 * field.cols + x1;
  const i01 = y1 * field.cols + x0;
  const i11 = y1 * field.cols + x1;
  const top = field.inDist[i00] + (field.inDist[i10] - field.inDist[i00]) * tx;
  const bottom = field.inDist[i01] + (field.inDist[i11] - field.inDist[i01]) * tx;
  return Math.min(60, (top + (bottom - top) * ty) * field.step);
}

function buildFoamPoints(field: NatalCoastField): NatalFoamPoint[] {
  const bands: { min: number; max: number; skip: number }[] = [
    { min: 1.5, max: 7, skip: 0.5 },
    { min: 11, max: 18, skip: 0.68 },
    { min: 23, max: 32, skip: 0.78 },
    { min: 38, max: 50, skip: 0.87 },
  ];
  const pts: NatalFoamPoint[] = [];
  const step = field.step;
  const stride = Math.max(1, Math.round(4 / step));
  for (let cy = stride; cy < field.rows - stride; cy += stride) {
    for (let cx = stride; cx < field.cols - stride; cx += stride) {
      const d = field.dist[cy * field.cols + cx] * step;
      if (d < 1 || d > 52) continue;
      for (let b = 0; b < bands.length; b++) {
        const band = bands[b];
        if (d < band.min || d > band.max) continue;
        const h = hash2(cx * 37 + b * 911, cy * 53 - b * 277);
        if (h < band.skip) continue;
        const gx =
          field.dist[cy * field.cols + cx + stride] - field.dist[cy * field.cols + cx - stride];
        const gy =
          field.dist[(cy + stride) * field.cols + cx] -
          field.dist[(cy - stride) * field.cols + cx];
        const horiz = Math.abs(gy) >= Math.abs(gx);
        pts.push({
          x: cx * step - field.pad + (h - 0.5) * 6.5,
          y: cy * step - field.pad + (hash2(cx + 191, cy - 71) - 0.5) * 6.5,
          phase: h * 6.283 + b * 1.37,
          band: b,
          horiz,
          seed: h,
        });
      }
    }
  }
  return pts;
}

function shelfColor(d: number): string {
  // Bajío estilo AAA: vibrante gradiente cian/turquesa con alta saturación
  // que resalta la costa contra el azul profundo del océano.
  if (d <= 5) return 'rgba(110, 245, 255, 0.62)';
  if (d <= 14) return 'rgba(64, 230, 245, 0.48)';
  if (d <= 26) return 'rgba(42, 210, 235, 0.36)';
  if (d <= 44) return 'rgba(28, 180, 210, 0.26)';
  if (d <= 68) return 'rgba(18, 140, 175, 0.18)';
  if (d <= 92) return 'rgba(12, 100, 140, 0.12)';
  if (d <= 124) return 'rgba(8, 70, 110, 0.08)';
  return 'rgba(6, 50, 85, 0.04)';
}

function wetRimColor(surface: IslaNatalSurface, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (surface === 'sand') return `rgba(136, 98, 52, ${(a * 0.62).toFixed(3)})`;
  if (surface === 'grass') return `rgba(26, 64, 29, ${(a * 0.44).toFixed(3)})`;
  if (surface === 'path') return `rgba(102, 74, 42, ${(a * 0.5).toFixed(3)})`;
  return `rgba(50, 46, 40, ${(a * 0.46).toFixed(3)})`;
}

/**
 * Mancha suave de luz o de oclusión sobre el terreno. Se usa en la capa
 * prerenderizada: aporta volumen amplio sin el borde duro de un rectángulo.
 */
function paintGroundHalo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rgb: string,
  alpha: number
): void {
  if (rx <= 0 || ry <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, Math.max(0.2, ry / rx));
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${rgb}, ${alpha.toFixed(3)})`);
  g.addColorStop(0.55, `rgba(${rgb}, ${(alpha * 0.55).toFixed(3)})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
  ctx.restore();
}



/* ------------------------------ ARENA ----------------------------- */

function paintSandTexture(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number
): void {
  const sandTiles = ensureNatalSandTiles();

  // 1. Manto base continuo con la arena granular orgánica (imagen adjunta 1)
  ctx.fillStyle = '#d4b27c';
  ctx.fillRect(x, y, w, h);

  const granularPattern = sandTiles.granular
    ? ctx.createPattern(sandTiles.granular, 'repeat')
    : null;
  if (granularPattern) {
    ctx.fillStyle = granularPattern;
    ctx.fillRect(x, y, w, h);
  }

  // 2. Bancos y lomas de arena rizada por el viento (imagen adjunta 2) fundidos
  // con máscaras radiales suaves en playas abiertas, cabos y caletas secas.
  const rippledPattern = sandTiles.rippled
    ? ctx.createPattern(sandTiles.rippled, 'repeat')
    : null;
  if (rippledPattern && typeof document !== 'undefined') {
    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = 420;
    patchCanvas.height = 280;
    const patchCtx = patchCanvas.getContext('2d');
    if (patchCtx) {
      const duneZones: [number, number, number, number, number][] = [
        // Playa del Aurora (abanicos simétricos de dunas suaves a ambos lados del eje central)
        [980, 1368, 196, 88, 0.88],
        [1372, 1368, 196, 88, 0.88],
        [1176, 1396, 164, 72, 0.82],
        [832, 1338, 138, 68, 0.80],
        [1520, 1338, 138, 68, 0.80],
        // Punta del Oleaje y Ensenada Este
        [1728, 1176, 156, 98, 0.88],
        [1618, 1258, 142, 82, 0.84],
        [1912, 1196, 56, 36, 0.80],
        // Punta y Ensenada del Poniente (espejo suroeste)
        [624, 1176, 156, 98, 0.86],
        [734, 1258, 142, 82, 0.82],
        // Media luna de arena del Puerto Norte y caletas septentrionales
        [1176, 668, 108, 42, 0.76],
        [1492, 684, 88, 46, 0.76],
        [868, 684, 88, 46, 0.74],
      ];
      for (const [cx, cy, rx, ry, alpha] of duneZones) {
        paintTexturedMeadowPatch(ctx, rippledPattern, patchCanvas, patchCtx, cx, cy, rx, ry, alpha);
      }
    }
  } else if (!granularPattern) {
    // Respaldo cromático armónico mientras decodifican las texturas asíncronamente
    for (let py = y; py < y + h; py += 52) {
      for (let px = x; px < x + w; px += 52) {
        const th = hash2(px * 0.23 + seed, py * 0.31 - seed);
        const cx = px + 14 + Math.floor(th * 26);
        const cy = py + 16 + Math.floor(hash2(px + 7, py + 3) * 22);
        if (th > 0.54) {
          paintGroundHalo(ctx, cx, cy, 26 + th * 16, 12 + th * 8, '238, 212, 162', 0.16);
        } else {
          paintGroundHalo(ctx, cx, cy, 24 + th * 18, 11 + th * 8, '166, 128, 78', 0.12);
        }
      }
    }
  }

  // 3. Relieve volumétrico de hora dorada: calidez de sol poniente en lomos altos
  // y sutil humedad ocre en hondonadas para dar profundidad orgánica a toda la costa.
  for (let py = y; py < y + h; py += 64) {
    for (let px = x; px < x + w; px += 64) {
      const th = hash2(px * 0.19 + seed, py * 0.29 - seed);
      const cx = px + 16 + Math.floor(th * 30);
      const cy = py + 16 + Math.floor(hash2(px + 11, py - 5) * 28);
      if (th > 0.60) {
        paintGroundHalo(ctx, cx, cy, 34 + th * 20, 16 + th * 10, '252, 232, 184', 0.11);
      } else if (th < 0.32) {
        paintGroundHalo(ctx, cx, cy, 30 + th * 22, 15 + th * 9, '138, 100, 56', 0.10);
      }
    }
  }

  // 4. Micro-destellos minerales de cuarzo y diminutos restos marinos integrados en la arena
  for (let py = y + 6; py < y + h - 6; py += 18) {
    for (let px = x + 6; px < x + w - 6; px += 21) {
      const th = hash2(px + 41 + seed, py - 19);
      if (th > 0.92) {
        ctx.fillStyle = 'rgba(255, 246, 218, 0.46)';
        ctx.fillRect(px, py, 2, 1);
      } else if (th < 0.06) {
        ctx.fillStyle = 'rgba(122, 88, 48, 0.32)';
  ctx.fillRect(px, py, 2, 1);
      }
    }
  }
}

/**
 * RENDERIZADO DE CÉSPED AAA
 * Implementa una técnica de renderizado rica que combina matices verdes,
 * ruido de baja frecuencia para variaciones cromáticas y ruido de alta
 * frecuencia para briznas procedurales detalladas.
 */
function paintGrassTexture(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number
): void {
  const tiles = ensureNatalGrassTiles();

  // 1. Manto base con patrón retro pixel-art
  const basePattern = tiles.base ? ctx.createPattern(tiles.base, 'repeat') : null;
  ctx.fillStyle = basePattern ?? '#4f9f38';
  ctx.fillRect(x, y, w, h);

  // 2. Ruido de Baja Frecuencia & Sombras de Profundidad (Capa de AO y relieve de pradera)
  for (let py = y - 16; py < y + h + 16; py += 40) {
    for (let px = x - 16; px < x + w + 16; px += 40) {
      const h1 = hash2(px * 0.17 + seed, py * 0.23 - seed);
      const cx = px + 20 + (hash2(py, px) - 0.5) * 28;
      const cy = py + 20 + (hash2(px, py) - 0.5) * 28;

      if (h1 > 0.68) {
        // Lomas y claros soleados (verde lima / amarillo dorado)
        paintGroundHalo(ctx, cx, cy, 38 + h1 * 22, 18 + h1 * 12, '187, 247, 120', 0.09);
      } else if (h1 < 0.38) {
        // Hondonadas y sombras de profundidad (verde bosque profundo)
        paintGroundHalo(ctx, cx, cy, 34 + h1 * 26, 18 + h1 * 14, '10, 42, 18', 0.16);
      }
    }
  }

  // 3. Briznas y micro-mechones procedurales para textura 3D de alta densidad
  for (let py = y + 8; py < y + h - 8; py += 16) {
    for (let px = x + 8; px < x + w - 8; px += 18) {
      const h2 = hash2(px * 0.37 + 13, py * 0.41 - 29);
      if (h2 > 0.48) {
        const bx = px + Math.floor(h2 * 8);
        const by = py + Math.floor(hash2(py, px) * 8);
        // Sombra de raíz
        ctx.fillStyle = 'rgba(8, 28, 12, 0.42)';
        ctx.fillRect(bx - 1, by + 1, 3, 1);
        // Cuerpo de brizna
        ctx.fillStyle = h2 > 0.78 ? '#6ecb45' : h2 > 0.62 ? '#42aa34' : '#22782b';
        ctx.fillRect(bx, by - 2, 1, 3);
        if (h2 > 0.82) {
          ctx.fillStyle = '#a6f272';
          ctx.fillRect(bx, by - 3, 1, 1);
        }
      }
    }
  }

}

/* ------------------------------ CÉSPED ---------------------------- */

/**
 * Pinta un parche orgánico difuminado de una textura de césped secundaria en
 * coordenadas de mundo, manteniendo continuidad de fase con el patrón global.
 */
function paintTexturedMeadowPatch(
  ctx: CanvasRenderingContext2D,
  pattern: CanvasPattern,
  patchCanvas: HTMLCanvasElement,
  patchCtx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  alpha: number
): void {
  if (rx <= 2 || ry <= 2 || alpha <= 0) return;
  const w = Math.ceil(rx * 2);
  const h = Math.ceil(ry * 2);
  if (patchCanvas.width < w) patchCanvas.width = w;
  if (patchCanvas.height < h) patchCanvas.height = h;

  const left = Math.round(cx - rx);
  const top = Math.round(cy - ry);

  patchCtx.save();
  patchCtx.globalCompositeOperation = 'source-over';
  patchCtx.clearRect(0, 0, w, h);

  // Máscara radial suave
  patchCtx.save();
  patchCtx.translate(rx, ry);
  patchCtx.scale(1, Math.max(0.25, ry / rx));
  const mask = patchCtx.createRadialGradient(0, 0, rx * 0.12, 0, 0, rx);
  mask.addColorStop(0, `rgba(255, 255, 255, ${alpha.toFixed(3)})`);
  mask.addColorStop(0.58, `rgba(255, 255, 255, ${(alpha * 0.62).toFixed(3)})`);
  mask.addColorStop(1, 'rgba(255, 255, 255, 0)');
  patchCtx.fillStyle = mask;
  patchCtx.fillRect(-rx, -rx, rx * 2, rx * 2);
  patchCtx.restore();

  // Relleno con la textura en fase exacta de coordenadas de mundo
  patchCtx.globalCompositeOperation = 'source-in';
  patchCtx.translate(-left, -top);
  patchCtx.fillStyle = pattern;
  patchCtx.fillRect(left, top, w, h);
  patchCtx.restore();

  ctx.drawImage(patchCanvas, 0, 0, w, h, left, top, w, h);
}

/**
 * Unifica toda la vegetación de Isla Natal dentro de un contorno costero curvo
 * y festoneado que integra las tres texturas de césped sin bordes rectos.
 */
function paintUnifiedIslandMeadow(ctx: CanvasRenderingContext2D): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of NATAL_MEADOW_RING) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  minX = Math.floor(minX - 32);
  minY = Math.floor(minY - 32);
  maxX = Math.ceil(maxX + 32);
  maxY = Math.ceil(maxY + 32);

  const w = maxX - minX;
  const h = maxY - minY;
  if (typeof document === 'undefined' || w <= 0 || h <= 0) return;

  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  if (!octx) return;

  octx.save();
  octx.translate(-minX, -minY);

  // 1. Recorte base al perímetro y contorno de la pradera
  octx.beginPath();
  tracePolygonRing(octx, NATAL_ISLAND_RING);
  octx.clip();

  octx.beginPath();
  tracePolygonRing(octx, NATAL_MEADOW_RING);
  // Pequeños lóbulos herbáceos para romper la línea del clip
  for (let i = 0; i < NATAL_MEADOW_RING.length; i += 2) {
    const [mx, my] = NATAL_MEADOW_RING[i];
    const h = hash2(Math.round(mx * 3) + i * 19, Math.round(my * 3) - i * 11);
    if (h < 0.35) continue;
    const r = 3.2 + h * 5.2;
    octx.moveTo(mx + r, my);
    octx.arc(mx, my, r, 0, Math.PI * 2);
  }
  octx.clip();

  // 2. Renderizado del manto de césped y detalles
  paintGrassTexture(octx, minX, minY, w, h, 42);

  for (let py = minY + 12; py < maxY - 12; py += 24) {
    for (let px = minX + 12; px < maxX - 12; px += 28) {
      const h = hash2(px * 0.31 + 17, py * 0.27 - 31);
      const tx = px + Math.floor(h * 18);
      const ty = py + Math.floor(hash2(py, px) * 16);

      if (h > 0.9) {
        const flowerType = Math.floor(h * 100) % 4;
        const pColor =
          flowerType === 0
            ? '#ffffff'
            : flowerType === 1
              ? '#fef08a'
              : flowerType === 2
                ? '#f43f5e'
                : '#60a5fa';
        octx.fillStyle = 'rgba(10, 32, 12, 0.3)';
        octx.fillRect(tx - 2, ty + 1, 5, 2);
        octx.fillStyle = '#22662c';
        octx.fillRect(tx, ty - 2, 1, 3);
        octx.fillRect(tx - 1, ty - 1, 1, 1);
        octx.fillStyle = pColor;
        octx.fillRect(tx - 2, ty - 4, 5, 1);
        octx.fillRect(tx - 1, ty - 5, 3, 3);
        octx.fillStyle = '#eab308';
        octx.fillRect(tx, ty - 4, 1, 1);
      } else if (h > 0.72) {
        octx.fillStyle = 'rgba(16, 54, 20, 0.28)';
        octx.fillRect(tx - 2, ty, 6, 3);
        octx.fillStyle = '#22662c';
        octx.fillRect(tx - 2, ty - 2, 2, 2);
        octx.fillRect(tx + 1, ty - 2, 2, 2);
        octx.fillRect(tx - 1, ty - 3, 3, 2);
        octx.fillStyle = '#4f9f38';
        octx.fillRect(tx - 1, ty - 2, 1, 1);
        octx.fillRect(tx + 1, ty - 2, 1, 1);
      }
    }
  }
  octx.restore();

  // 3. APLICAR TRANSICIÓN DE RUIDO (Alpha Blending por píxel)
  const imageData = octx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const grosorFrontera = 22; // Píxeles de ancho de la transición

  for (let row = 0; row < h; row++) {
    const wy = minY + row;
    for (let col = 0; col < w; col++) {
      const i = (row * w + col) * 4;
      const alphaIdx = i + 3;
      if (data[alphaIdx] === 0) continue;

      const wx = minX + col;
      // Calculamos la distancia al borde de la pradera
      const dist = getDistanceToMeadowEdge(wx, wy);

      if (dist < grosorFrontera) {
        // Generamos ruido matemático orgánico
        const ruido = hash2(wx * 0.05, wy * 0.05);
        // Calculamos proximidad (1.0 en el borde, 0.0 a grosorFrontera de distancia)
        const proximidadArena = 1.0 - dist / grosorFrontera;

        if (ruido < proximidadArena) {
          data[alphaIdx] = 0; // Borramos el césped
        } else {
          // Difuminamos suavemente los bordes restantes
          data[alphaIdx] = Math.floor(data[alphaIdx] * (1.0 - proximidadArena * 0.4));
        }
      }
    }
  }
  octx.putImageData(imageData, 0, 0);

  // 4. Dibujamos el resultado final en el lienzo principal
  ctx.save();
  ctx.drawImage(off, minX, minY);

  // Sombras proyectadas de palmeras (sobre el césped ya procesado)
  ctx.beginPath();
  tracePolygonRing(ctx, NATAL_ISLAND_RING);
  ctx.clip();
  for (const p of ISLA_NATAL_PALMS) {
    paintGroundHalo(ctx, p.x + 4, p.y + 12, 42, 20, '10, 38, 14', 0.15);
  }
  ctx.restore();

  // Transición suave de calidez en la orilla sur
  const beachWarmth = ctx.createLinearGradient(0, 1152, 0, 1288);
  beachWarmth.addColorStop(0, 'rgba(214, 180, 126, 0)');
  beachWarmth.addColorStop(1, 'rgba(210, 174, 118, 0.15)');
  ctx.fillStyle = beachWarmth;
  ctx.fillRect(minX, 1152, maxX - minX, 142);
}

/* ---------------------- RED DE CAMINOS EMPEDRADOS ----------------- */

interface PathSamplePoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
  t: number;
}

function subdividePathPoints(points: [number, number][]): PathSamplePoint[] {
  if (points.length < 2) return [];
  let pts: [number, number][] = points.map((p) => [p[0], p[1]]);
  // Suavizado Chaikin conservando extremos exactos para conectar umbrales y cruces.
  for (let iter = 0; iter < 3; iter++) {
    const next: [number, number][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      next.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }

  // Remuestreo uniforme cada ~3.5 px para trazos orgánicos continuos.
  const dense: [number, number][] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const segLen = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(segLen / 3.5));
    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      dense.push([ax + (bx - ax) * u, ay + (by - ay) * u]);
    }
  }

  const out: PathSamplePoint[] = [];
  const lastIdx = Math.max(1, dense.length - 1);
  for (let i = 0; i < dense.length; i++) {
    const prev = dense[Math.max(0, i - 1)];
    const next = dense[Math.min(dense.length - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    out.push({
      x: dense[i][0],
      y: dense[i][1],
      nx: -dy,
      ny: dx,
      t: i / lastIdx,
    });
  }
  return out;
}

function smoothStep01(v: number): number {
  const c = Math.max(0, Math.min(1, v));
  return c * c * (3 - 2 * c);
}

/**
 * Lecho orgánico de transición bajo caminos y glorietas: funde suavemente el césped,
 * la arena o la roca con una franja húmeda de musgo y tierra pisada sin bordes duros.
 */
function paintPathBedShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  alphaScale: number
): void {
  if (alphaScale <= 0.02 || rx <= 1 || ry <= 1) return;
  const onRock = isPointOnNatalRock(x, y);
  const onMeadow = !onRock && isPointOnNatalMeadow(x, y);

  if (onMeadow) {
    // Lecho interior de tierra cálida pisada
    paintGroundHalo(ctx, x + 0.5, y + 1.0, rx + 1.8, ry + 1.4, '88, 64, 36', 0.25 * alphaScale);
  } else if (onRock) {
    paintGroundHalo(ctx, x + 0.8, y + 1.4, rx + 4.2, ry + 3.6, '34, 36, 40', 0.22 * alphaScale);
  } else {
    // Playa y ribera arenosa: depresión cálida de arena compactada
    paintGroundHalo(ctx, x + 0.8, y + 1.4, rx + 5.2, ry + 4.4, '124, 88, 46', 0.22 * alphaScale);
    paintGroundHalo(ctx, x, y + 0.6, rx + 2.2, ry + 1.8, '196, 158, 104', 0.18 * alphaScale);
  }
}

function fillFeatheredRadialStamp(
  offCtx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  alpha: number,
  innerStop = 0.44
): void {
  if (rx <= 0.8 || ry <= 0.8 || alpha <= 0.01) return;
  offCtx.save();
  offCtx.translate(cx, cy);
  offCtx.scale(1, Math.max(0.25, ry / rx));
  const g = offCtx.createRadialGradient(0, 0, rx * innerStop, 0, 0, rx);
  g.addColorStop(0, `rgba(255, 255, 255, ${alpha.toFixed(3)})`);
  g.addColorStop(0.68, `rgba(255, 255, 255, ${(alpha * 0.72).toFixed(3)})`);
  g.addColorStop(0.88, `rgba(255, 255, 255, ${(alpha * 0.32).toFixed(3)})`);
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  offCtx.fillStyle = g;
  offCtx.fillRect(-rx, -rx, rx * 2, rx * 2);
  offCtx.restore();
}

function applyPathWorldShading(
  offCtx: CanvasRenderingContext2D,
  left: number,
  top: number,
  w: number,
  h: number,
  texture: IslaNatalPathTextureId
): void {
  offCtx.save();
  offCtx.globalCompositeOperation = 'source-atop';

  // Luz cálida del oeste y penumbra esmeralda hacia el este para integrar con la hora dorada.
  const sunGrad = offCtx.createLinearGradient(0, 0, w, h);
  sunGrad.addColorStop(0, 'rgba(255, 230, 174, 0.10)');
  sunGrad.addColorStop(0.52, 'rgba(104, 138, 72, 0.04)');
  sunGrad.addColorStop(1, 'rgba(20, 46, 26, 0.13)');
  offCtx.fillStyle = sunGrad;
  offCtx.fillRect(0, 0, w, h);

  // Veladura sutil musgosa/terrosa para hermanar el contraste de las piedras con el césped isleño.
  if (texture === 'terracotta') {
    offCtx.fillStyle = 'rgba(84, 96, 46, 0.07)';
    offCtx.fillRect(0, 0, w, h);
  } else if (texture === 'port') {
    offCtx.fillStyle = 'rgba(72, 102, 54, 0.08)';
    offCtx.fillRect(0, 0, w, h);
  }

  // Sombra fresca bajo el dosel de La Arboleda.
  if (texture === 'arboleda' && left + w > 1420) {
    const canopyX = Math.max(0, 1420 - left);
    const canopyGrad = offCtx.createLinearGradient(canopyX, 0, w, 0);
    canopyGrad.addColorStop(0, 'rgba(24, 58, 26, 0.04)');
    canopyGrad.addColorStop(1, 'rgba(16, 44, 22, 0.19)');
    offCtx.fillStyle = canopyGrad;
    offCtx.fillRect(canopyX, 0, w - canopyX, h);
  }

  // Veladura cálida de arena barrida por la brisa en tramos playeros y cabeceras costeras.
  if (texture === 'coastal' && top + h > 1180) {
    const sandY = Math.max(0, 1180 - top);
    const sandGrad = offCtx.createLinearGradient(0, sandY, 0, h);
    sandGrad.addColorStop(0, 'rgba(214, 180, 126, 0)');
    sandGrad.addColorStop(1, 'rgba(214, 180, 126, 0.36)');
    offCtx.fillStyle = sandGrad;
    offCtx.fillRect(0, sandY, w, h - sandY);
  } else if (texture === 'port' && top < 716) {
    const portBottom = Math.min(h, Math.max(12, 724 - top));
    const sandGrad = offCtx.createLinearGradient(0, portBottom, 0, 0);
    sandGrad.addColorStop(0, 'rgba(214, 180, 126, 0)');
    sandGrad.addColorStop(1, 'rgba(214, 180, 126, 0.28)');
    offCtx.fillStyle = sandGrad;
    offCtx.fillRect(0, 0, w, portBottom);
  }

  offCtx.restore();
}

function paintScallopedPlaza(
  ctx: CanvasRenderingContext2D,
  plaza: IslaNatalPathPlaza,
  tiles: NatalPathTiles
): void {
  if (typeof document === 'undefined') return;
  const pad = 22;
  const left = Math.floor(plaza.x - plaza.rx - pad);
  const top = Math.floor(plaza.y - plaza.ry - pad);
  const w = Math.ceil((plaza.rx + pad) * 2);
  const h = Math.ceil((plaza.ry + pad) * 2);

  paintPathBedShadow(ctx, plaza.x, plaza.y, plaza.rx + 4.5, plaza.ry + 4, 0.82);

  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const offCtx = off.getContext('2d');
  if (!offCtx) return;

  const cx = plaza.x - left;
  const cy = plaza.y - top;

  // Núcleo difuminado radialmente + corona festoneada de lajas suaves en el borde.
  fillFeatheredRadialStamp(offCtx, cx, cy, plaza.rx * 1.04, plaza.ry * 1.04, 0.98, 0.48);

  const lobes = 28;
  for (let i = 0; i < lobes; i++) {
    const ang = (i / lobes) * Math.PI * 2;
    const h1 = hash2(Math.round(plaza.x) + i * 19, Math.round(plaza.y) - i * 13);
    const h2 = hash2(Math.round(plaza.x) - i * 31, Math.round(plaza.y) + i * 7);
    const distScale = 0.64 + h1 * 0.28;
    const lx = cx + Math.cos(ang) * plaza.rx * distScale;
    const ly = cy + Math.sin(ang) * plaza.ry * distScale;
    const lr = 4.6 + h2 * 4.6;
    fillFeatheredRadialStamp(offCtx, lx, ly, lr * 1.18, lr * 0.96, 0.72 + h1 * 0.22, 0.34);
  }

  // Relleno con la textura del trayecto alineada en coordenadas de mundo.
  offCtx.save();
  offCtx.globalCompositeOperation = 'source-in';
  offCtx.translate(-left, -top);
  const img = tiles.images[plaza.texture];
  const pattern = img ? offCtx.createPattern(img, 'repeat') : null;
  offCtx.fillStyle = pattern ?? NATAL_PATH_FALLBACK_HEX[plaza.texture];
  offCtx.fillRect(left, top, w, h);
  offCtx.restore();

  applyPathWorldShading(offCtx, left, top, w, h, plaza.texture);
  ctx.drawImage(off, 0, 0, w, h, left, top, w, h);
}

function paintScallopedRoute(
  ctx: CanvasRenderingContext2D,
  route: IslaNatalPathRoute,
  samples: PathSamplePoint[],
  tiles: NatalPathTiles
): void {
  if (samples.length === 0 || typeof document === 'undefined') return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of samples) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
  }

  const pad = Math.ceil(route.width * 0.95 + 22);
  const left = Math.floor(minX - pad);
  const top = Math.floor(minY - pad);
  const w = Math.ceil(maxX - minX + pad * 2);
  const h = Math.ceil(maxY - minY + pad * 2);

  // 1. Lecho hundido gradual de tierra/musgo/arena bajo el empedrado.
  for (let i = 0; i < samples.length; i += 3) {
    const s = samples[i];
    let endFade = 1;
    if (route.featherStart && s.t < 0.16) endFade = smoothStep01(s.t / 0.16);
    if (route.featherEnd && s.t > 0.84) endFade = Math.min(endFade, smoothStep01((1 - s.t) / 0.16));
    const halfW = route.width * 0.5 * (0.72 + 0.28 * endFade);
    paintPathBedShadow(ctx, s.x, s.y, halfW + 3.2, halfW * 0.9 + 2.8, endFade * 0.42);
  }

  // 2. Máscara radialmente difuminada del sendero + piedras irregulares en ambos márgenes.
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const offCtx = off.getContext('2d');
  if (!offCtx) return;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    let alpha = 1;
    let widthScale = 1;
    if (route.featherStart && s.t < 0.16) {
      const f = smoothStep01(s.t / 0.16);
      alpha = 0.14 + 0.86 * f;
      widthScale = 0.58 + 0.42 * f;
    }
    if (route.featherEnd && s.t > 0.84) {
      const f = smoothStep01((1 - s.t) / 0.16);
      alpha = Math.min(alpha, 0.14 + 0.86 * f);
      widthScale = Math.min(widthScale, 0.58 + 0.42 * f);
    }

    const wobble =
      Math.sin(i * 0.27 + s.x * 0.028) * 1.45 + Math.cos(i * 0.16 + s.y * 0.028) * 1.05;
    const halfW = Math.max(6, route.width * 0.5 * widthScale + wobble);
    const sx = s.x - left;
    const sy = s.y - top;

    fillFeatheredRadialStamp(offCtx, sx, sy, halfW * 1.02, halfW * 1.02, alpha * 0.94, 0.42);

    // Lóbulos laterales de piedra con caída suave para fundirse entre las briznas de hierba.
    if (i % 3 === 0) {
      for (const side of [-1, 1] as const) {
        const h1 = hash2(i * 23 + (side > 0 ? 7 : 53), Math.round(s.x + s.y));
        if (h1 < 0.15) continue;
        const h2 = hash2(i * 41 + (side > 0 ? 97 : 13), Math.round(s.x - s.y));
        const offset = halfW * (0.62 + h1 * 0.42);
        const lx = sx + s.nx * side * offset;
        const ly = sy + s.ny * side * offset;
        const lr = 4.2 + h2 * 5.8; // Piedras más grandes y redondas
        fillFeatheredRadialStamp(
          offCtx,
          lx,
          ly,
          lr * 1.12,
          lr * 1.08,
          alpha * (0.72 + h1 * 0.22),
          0.38
        );
      }
    }

  }

  // 3. Aplicación del patrón seamless en coordenadas de mundo.
  offCtx.save();
  offCtx.globalCompositeOperation = 'source-in';
  offCtx.translate(-left, -top);
  const img = tiles.images[route.texture];
  const pattern = img ? offCtx.createPattern(img, 'repeat') : null;
  offCtx.fillStyle = pattern ?? NATAL_PATH_FALLBACK_HEX[route.texture];
  offCtx.fillRect(left, top, w, h);
  offCtx.restore();

  applyPathWorldShading(offCtx, left, top, w, h, route.texture);
  ctx.drawImage(off, 0, 0, w, h, left, top, w, h);
}

/** Peldaños de piedra tallada donde el sendero sube a la meseta y a la cresta del Alto de las Rocas. */
function paintHighlandRampSteps(ctx: CanvasRenderingContext2D): void {
  const atlas = ensureNatalRockAtlas();
  const drawStepFlight = (
    steps: { cx: number; y: number; w: number }[],
    plinthY: number,
    plinthSpanCx: number
  ) => {
    if (atlas.plinthCarved) {
      ctx.drawImage(atlas.plinthCarved.normal, plinthSpanCx - 30, plinthY, 16, 14);
      ctx.drawImage(atlas.plinthCarved.flipped, plinthSpanCx + 15, plinthY + 2, 16, 14);
    }
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      const lx = Math.round(st.cx - st.w * 0.5 - 5);
      const rx = Math.round(st.cx + st.w * 0.5);
      ctx.fillStyle = '#2d3036';
      ctx.fillRect(lx - 1, st.y - 2, 7, 8);
      ctx.fillRect(rx - 1, st.y - 2, 7, 8);
      ctx.fillStyle = '#6f747d';
      ctx.fillRect(lx, st.y - 1, 5, 6);
      ctx.fillRect(rx, st.y - 1, 5, 6);
      ctx.fillStyle = '#adb2b9';
      ctx.fillRect(lx, st.y - 1, 4, 2);
      ctx.fillRect(rx + 1, st.y - 1, 4, 2);
    }

    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      const sx = Math.round(st.cx - st.w * 0.5);
      ctx.fillStyle = 'rgba(26, 28, 32, 0.74)';
      ctx.fillRect(sx - 1, st.y + 3, st.w + 2, 2);
      ctx.fillStyle = i % 2 === 0 ? '#8c9096' : '#7d8188';
      ctx.fillRect(sx, st.y, st.w, 3);
      const split = sx + 10 + ((i * 7) % 10);
      ctx.fillStyle = 'rgba(38, 40, 44, 0.65)';
      ctx.fillRect(split, st.y, 1, 3);
      ctx.fillRect(sx, st.y, 1, 3);
      ctx.fillRect(sx + st.w - 1, st.y, 1, 3);
      ctx.fillStyle = 'rgba(232, 224, 202, 0.68)';
      ctx.fillRect(sx + 1, st.y, st.w - 2, 1);
      if (i % 2 === 1) {
        ctx.fillStyle = 'rgba(88, 134, 66, 0.62)';
        ctx.fillRect(sx + 1, st.y + 2, 5, 1);
      } else {
        ctx.fillStyle = 'rgba(88, 134, 66, 0.56)';
        ctx.fillRect(sx + st.w - 6, st.y + 2, 5, 1);
      }
    }
  };

  // Tramo principal de acceso a la meseta rocosa (y ≈ 752)
  drawStepFlight(
    [
      { cx: 649, y: 744, w: 32 },
      { cx: 651, y: 749, w: 33 },
      { cx: 653, y: 754, w: 34 },
      { cx: 655, y: 759, w: 34 },
      { cx: 657, y: 764, w: 32 },
    ],
    742,
    653
  );

  // Escalinata corta de acceso a la terraza superior del Mirador (y ≈ 502)
  drawStepFlight(
    [
      { cx: 622, y: 495, w: 30 },
      { cx: 623, y: 500, w: 31 },
      { cx: 625, y: 505, w: 31 },
    ],
    494,
    624
  );
}

/** Pinta un manojo orgánico de hierba, trébol, musgo, arena o liquen sobre el borde de piedra. */
function paintVergeDetailAt(
  ctx: CanvasRenderingContext2D,
  ex: number,
  ey: number,
  inwardX: number,
  inwardY: number,
  texture: IslaNatalPathTextureId,
  h1: number,
  h2: number
): void {
  const onRock = isPointOnNatalRock(ex, ey);
  const onMeadow = !onRock && isPointOnNatalMeadow(ex, ey);

  if (!onMeadow && !onRock) {
    // Arena costera: lenguas suaves de arena dorada y granos sueltos que montan las piedras.
    ctx.fillStyle = h1 > 0.66 ? 'rgba(226, 196, 144, 0.80)' : 'rgba(198, 160, 108, 0.70)';
    ctx.fillRect(ex - 2, ey, 4, 2);
    ctx.fillRect(Math.round(ex + inwardX * 2.4) - 1, Math.round(ey + inwardY * 2.4), 3, 2);
    ctx.fillStyle = 'rgba(248, 226, 180, 0.52)';
    ctx.fillRect(ex - 1, ey, 2, 1);
    if (h2 > 0.74) {
      const px = Math.round(ex - inwardX * (3 + h2 * 7));
      const py = Math.round(ey - inwardY * (3 + h2 * 7));
      ctx.fillStyle = 'rgba(122, 88, 48, 0.44)';
      ctx.fillRect(px, py + 1, 3, 2);
      ctx.fillStyle = '#c4ae8c';
      ctx.fillRect(px, py, 3, 2);
    }
    return;
  }

  if (onRock) {
    // Meseta del Alto de las Rocas: musgo alpino, líquenes y esquirlas minerales.
    ctx.fillStyle = h1 > 0.62 ? 'rgba(110, 148, 84, 0.56)' : 'rgba(92, 86, 76, 0.50)';
    ctx.fillRect(ex - 1, ey, 3, 2);
    ctx.fillRect(Math.round(ex + inwardX * 2), Math.round(ey + inwardY * 2), 2, 1);
    if (h2 > 0.76) {
      ctx.fillStyle = '#b4ab98';
      ctx.fillRect(Math.round(ex - inwardX * 2), ey - 1, 2, 1);
    }
    return;
  }

  // Pradera y Arboleda: briznas escalonadas y tréboles que abrazan y montan las lajas del camino.
  const darkGrass = texture === 'arboleda' ? '#1d4a1b' : '#144d27';
  const midGrass = texture === 'arboleda' ? '#367423' : '#22662c';
  const tipGrass = texture === 'arboleda' ? '#6cb03a' : '#48b859';

  // Sombra húmeda de raíz sobre el borde de la piedra (integración AAA)
  const inX = Math.round(ex + inwardX * (2.2 + h2 * 3.1));
  const inY = Math.round(ey + inwardY * (2.2 + h2 * 3.1));
  ctx.fillStyle = 'rgba(8, 24, 12, 0.45)';
  ctx.fillRect(inX - 2, inY - 1, 5, 3);

  // Mata principal en el margen con briznas que montan la piedra
  ctx.fillStyle = darkGrass;
  ctx.fillRect(ex - 2, ey, 4, 2);
  ctx.fillStyle = midGrass;
  ctx.fillRect(ex - 1, ey - 2, 3, 3);
  ctx.fillRect(inX, inY - 2, 2, 4);
  
  // Briznas individuales que rompen la línea recta del camino
  ctx.fillStyle = tipGrass;
  ctx.fillRect(ex, ey - 4, 1, 3);
  ctx.fillRect(inX + 1, inY - 4, 1, 3);
  if (h1 > 0.65) {
      ctx.fillRect(Math.round(ex + inwardX * 4), Math.round(ey + inwardY * 4) - 2, 1, 2);
  }

  // Hoja de trébol o brote bajo que avanza sobre la junta exterior
  if (h2 > 0.40) {
    const cx = Math.round(ex + inwardX * 4.2);
    const cy = Math.round(ey + inwardY * 4.2);
    ctx.fillStyle = '#1b4a18';
    ctx.fillRect(cx - 1, cy, 2, 2);
    ctx.fillStyle = '#5fb33d';
    ctx.fillRect(cx, cy - 1, 1, 1);
  }

  // Florecilla silvestre ocasional al borde de los senderos de pradera y huerta
  if (h1 > 0.89 && h2 > 0.62) {
    ctx.fillStyle = h2 > 0.82 ? '#fde68a' : '#fef3c7';
    ctx.fillRect(ex - 1, ey - 4, 2, 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(ex, ey - 3, 1, 1);
  } else if (h1 > 0.84 && h2 < 0.28) {
    // Guijarro suelto integrado entre la hierba junto al sendero
    const px = Math.round(ex - inwardX * 3.2);
    const py = Math.round(ey - inwardY * 3.2);
    ctx.fillStyle = 'rgba(22, 46, 18, 0.42)';
    ctx.fillRect(px, py + 1, 3, 2);
    ctx.fillStyle = NATAL_PATH_FALLBACK_HEX[texture];
    ctx.fillRect(px, py, 2, 2);
  }
}

/** Briznas de césped, trébol, musgo, arena y guijarros que abrazan los bordes de cada trayecto. */
function paintRouteEdgeIntegration(
  ctx: CanvasRenderingContext2D,
  route: IslaNatalPathRoute,
  samples: PathSamplePoint[]
): void {
  for (let i = 1; i < samples.length - 1; i += 2) {
    const s = samples[i];
    const halfW = route.width * 0.5;

    for (const side of [-1, 1] as const) {
      const h1 = hash2(i * 37 + (side > 0 ? 11 : 73), Math.round(s.x * 2 + s.y));
      if (h1 < 0.24) continue;
      const h2 = hash2(i * 53 + (side > 0 ? 97 : 19), Math.round(s.x - s.y * 2));
      const edgeDist = halfW * (0.76 + (h1 - 0.24) * 0.38);
      const ex = Math.round(s.x + s.nx * side * edgeDist);
      const ey = Math.round(s.y + s.ny * side * edgeDist);
      paintVergeDetailAt(ctx, ex, ey, -s.nx * side, -s.ny * side, route.texture, h1, h2);
    }

    // Brotes finos de musgo y hierba entre juntas interiores de piedra.
    const hm = hash2(i * 59 + 17, Math.round(s.x - s.y * 2));
    if (isPointOnNatalMeadow(s.x, s.y) && hm > (route.texture === 'arboleda' ? 0.68 : 0.80)) {
      const spread = (hm - 0.80) * route.width * 1.3;
      const mx = Math.round(s.x + s.nx * spread);
      const my = Math.round(s.y + s.ny * spread);
      ctx.fillStyle = 'rgba(64, 118, 44, 0.50)';
      ctx.fillRect(mx - 1, my, 3, 1);
      ctx.fillStyle = 'rgba(118, 178, 68, 0.42)';
      ctx.fillRect(mx, my - 1, 1, 1);
    }
  }
}

/** Integra también el perímetro de las plazas empedradas con el césped, la arena o la roca. */
function paintPlazaEdgeIntegration(
  ctx: CanvasRenderingContext2D,
  plaza: IslaNatalPathPlaza,
  sampledRoutes: { route: IslaNatalPathRoute; samples: PathSamplePoint[] }[]
): void {
  const count = Math.max(18, Math.round((plaza.rx + plaza.ry) * 0.72));
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2;
    const h1 = hash2(Math.round(plaza.x) + i * 29, Math.round(plaza.y) + i * 17);
    if (h1 < 0.28) continue;
    const h2 = hash2(Math.round(plaza.x) - i * 43, Math.round(plaza.y) - i * 11);
    const scale = 0.82 + h2 * 0.24;
    const ex = Math.round(plaza.x + Math.cos(ang) * plaza.rx * scale);
    const ey = Math.round(plaza.y + Math.sin(ang) * plaza.ry * scale);

    // No dibujamos matas de borde justo encima del centro de un sendero conectado a la glorieta
    let insideConnectedCenter = false;
    for (let r = 0; r < sampledRoutes.length && !insideConnectedCenter; r++) {
      const sr = sampledRoutes[r];
      const coreR2 = Math.pow(sr.route.width * 0.36, 2);
      for (let k = 0; k < sr.samples.length; k += 4) {
        const dx = ex - sr.samples[k].x;
        const dy = ey - sr.samples[k].y;
        if (dx * dx + dy * dy < coreR2) {
          insideConnectedCenter = true;
          break;
        }
      }
    }
    if (insideConnectedCenter) continue;

    paintVergeDetailAt(ctx, ex, ey, -Math.cos(ang), -Math.sin(ang), plaza.texture, h1, h2);
  }
}

function paintIslandPaths(ctx: CanvasRenderingContext2D): void {
  const tiles = ensureNatalPathTiles();
  const sampledRoutes = ISLA_NATAL_PATH_ROUTES.map((route) => ({
    route,
    samples: subdividePathPoints(route.points),
  }));

  const isJunctionPlaza = (id: string) =>
    id === 'plaza-huerta-norte' ||
    id === 'plaza-huerta-sur' ||
    id === 'plaza-huerta-oeste' ||
    id === 'plaza-huerta-este' ||
    id === 'plaza-crucero-norte';

  // 1. Glorietas base de cruces del anillo central y del norte para asentar los empalmes.
  for (const plaza of ISLA_NATAL_PATH_PLAZAS) {
    if (isJunctionPlaza(plaza.id)) {
      paintScallopedPlaza(ctx, plaza, tiles);
    }
  }

  // 2. Trazado continuo y difuminado de cada trayecto con su textura correspondiente.
  for (const { route, samples } of sampledRoutes) {
    paintScallopedRoute(ctx, route, samples, tiles);
  }

  // 3. Plazas terminales (umbral de Casa de Pixel, entrada de la Huerta, muelle, cobertizo Pong y miradores).
  for (const plaza of ISLA_NATAL_PATH_PLAZAS) {
    if (!isJunctionPlaza(plaza.id)) {
      paintScallopedPlaza(ctx, plaza, tiles);
    }
  }

  // 4. Escalones tallados en la subida al Alto de las Rocas.
  paintHighlandRampSteps(ctx);

  // 5. Integración orgánica de césped, trébol, musgo y arena sobre rutas y glorietas.
  for (const { route, samples } of sampledRoutes) {
    paintRouteEdgeIntegration(ctx, route, samples);
  }
  for (const plaza of ISLA_NATAL_PATH_PLAZAS) {
    paintPlazaEdgeIntegration(ctx, plaza, sampledRoutes);
  }
}

/* ------------------------------ ROCA ------------------------------ */

function paintRockTexture(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number
): void {
  const rockTiles = ensureNatalRockTiles();

  // 1. Manto base continuo de caliza/pizarra agrietada sintetizado desde las rocas adjuntas
  ctx.fillStyle = '#84827a';
  ctx.fillRect(x, y, w, h);

  const slatePattern = rockTiles.slate ? ctx.createPattern(rockTiles.slate, 'repeat') : null;
  if (slatePattern) {
    ctx.fillStyle = slatePattern;
    ctx.fillRect(x, y, w, h);
  }

  // 2. Afloramientos cálidos de arenisca dorada fundidos de forma orgánica sobre lomos soleados
  const sandstonePattern = rockTiles.sandstone
    ? ctx.createPattern(rockTiles.sandstone, 'repeat')
    : null;
  if (sandstonePattern && typeof document !== 'undefined') {
    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = 320;
    patchCanvas.height = 240;
    const patchCtx = patchCanvas.getContext('2d');
    if (patchCtx) {
      const warmOutcrops: [number, number, number, number, number][] = [
        [608, 424, 148, 76, 0.66],
        [468, 552, 128, 92, 0.54],
        [734, 598, 118, 86, 0.58],
        [548, 692, 114, 66, 0.48],
        [588, 1330, 34, 24, 0.55],
        [1762, 1330, 34, 24, 0.55],
      ];
      for (const [cx, cy, rx, ry, alpha] of warmOutcrops) {
        if (cx + rx < x || cx - rx > x + w || cy + ry < y || cy - ry > y + h) continue;
        paintTexturedMeadowPatch(ctx, sandstonePattern, patchCanvas, patchCtx, cx, cy, rx, ry, alpha);
      }
    }
  }

  // 3. Relieve mineral volumétrico, diaclasas quebradas y vetas de musgo de montaña
  for (let py = y + 10; py < y + h - 8; py += 36) {
    for (let px = x + 10; px < x + w - 8; px += 42) {
      const th = hash2(px * 0.27 + seed, py * 0.33 - seed);
      const cx = px + Math.floor(th * 20);
      const cy = py + Math.floor(hash2(px + 9, py - 5) * 18);
      if (th > 0.64) {
        paintGroundHalo(ctx, cx, cy, 26 + th * 14, 14 + th * 8, '228, 214, 184', 0.12);
      } else if (th < 0.30) {
        paintGroundHalo(ctx, cx, cy, 24 + th * 16, 13 + th * 8, '36, 38, 40', 0.14);
      }
    }
  }

  // Grietas escalonadas estilo pixel-art con bisel soleado
  for (let py = y + 14; py < y + h - 12; py += 34) {
    for (let px = x + 16; px < x + w - 16; px += 46) {
      const th = hash2(px + 7 + seed, py + 71);
      if (th < 0.48) continue;
      let cx = px;
      let cy = py;
      const steps = 4 + Math.floor(th * 4);
      for (let s = 0; s < steps; s++) {
        const dir = hash2(px + s * 13, py - s * 7);
        cx += dir > 0.45 ? 2 : 1;
        cy += dir > 0.72 ? 2 : dir < 0.28 ? -1 : 1;
        ctx.fillStyle = 'rgba(42, 43, 46, 0.58)';
        ctx.fillRect(cx, cy, 2, 1);
        ctx.fillStyle = 'rgba(218, 210, 190, 0.32)';
        ctx.fillRect(cx, cy + 1, 2, 1);
      }
      if (th > 0.76) {
        ctx.fillStyle = 'rgba(88, 132, 66, 0.50)';
        ctx.fillRect(px + 1, py + 1, 5, 2);
      }
    }
  }

  // Esquirlas minerales y líquenes claros asentados sobre la meseta
  for (let py = y + 6; py < y + h - 5; py += 16) {
    for (let px = x + 6; px < x + w - 5; px += 19) {
      const th = hash2(px + 29, py + 53 + seed);
      if (th > 0.86) {
        ctx.fillStyle = 'rgba(44, 46, 50, 0.48)';
        ctx.fillRect(px, py + 1, 3, 2);
        ctx.fillStyle = th > 0.93 ? '#b8b4a6' : '#96948a';
        ctx.fillRect(px, py, 3, 2);
        ctx.fillStyle = 'rgba(244, 236, 214, 0.45)';
        ctx.fillRect(px, py, 2, 1);
      } else if (th < 0.06) {
        ctx.fillStyle = 'rgba(182, 204, 154, 0.42)';
        ctx.fillRect(px, py, 3, 2);
      }
    }
  }
}

/* --------------------- TRANSICIONES Y ACANTILADOS CURVOS ---------- */

/**
 * Integra de forma natural el borde curvo de la pradera con las playas de arena
 * y las riberas costeras mediante matas dunares, lenguas de arena y guijarros.
 */
function paintCurvedMeadowBeachFringe(ctx: CanvasRenderingContext2D): void {
  const n = NATAL_MEADOW_RING.length;
  for (let i = 0; i < n; i++) {
    const [x, y] = NATAL_MEADOW_RING[i];
    if (!pointInPolygonRing(x, y, NATAL_ISLAND_RING)) continue;
    if (pointInPolygonRing(x, y, NATAL_ROCK_PLATEAU_RING)) continue;

    const prev = NATAL_MEADOW_RING[(i - 1 + n) % n];
    const next = NATAL_MEADOW_RING[(i + 1) % n];
    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // En un anillo horario (coordenadas de pantalla Y hacia abajo), la normal exterior es (dy, -dx)
    const nx = dy;
    const ny = -dx;

    const th = hash2(Math.round(x * 2) + i * 17, Math.round(y * 2) - i * 13);
    if (i % 3 === 0) {
      paintGroundHalo(ctx, x + nx * 4, y + ny * 4, 15 + th * 11, 9 + th * 6, '212, 178, 124', 0.18);
    }
    if (th < 0.28) continue;

    const sx = Math.round(x + nx * 1.2);
    const sy = Math.round(y + ny * 1.2);
    // Sombra de contacto profunda y oclusión ambiental (Contact Shadow)
    ctx.fillStyle = 'rgba(14, 28, 10, 0.44)';
    ctx.fillRect(sx - 1, sy, 4, 3);
    ctx.fillStyle = 'rgba(14, 28, 10, 0.26)';
    ctx.fillRect(sx - 2, sy + 1, 6, 2);

    // Integración Orgánica: Micro-variaciones y blending con arena
    const tx = Math.round(x + nx * (1.2 + th * 4.8));
    const ty = Math.round(y + ny * (1.2 + th * 4.8));
    if (th > 0.55) {
      ctx.fillStyle = th > 0.78 ? '#427c24' : '#2d5a1a';
      ctx.fillRect(tx - 1, ty - 2, 2, 3);
      ctx.fillStyle = '#6ab038';
      ctx.fillRect(tx, ty - 3, 1, 2);
    }

    // Difuminado de arena barrida hacia el césped
    if (th > 0.32 && th < 0.78) {
      const bx = Math.round(x - nx * (1.5 + th * 3.5));
      const by = Math.round(y - ny * (1.5 + th * 3.5));
      ctx.fillStyle = 'rgba(196, 168, 112, 0.42)';
      ctx.fillRect(bx - 1, by, 3, 2);
      ctx.fillStyle = 'rgba(232, 212, 164, 0.28)';
      ctx.fillRect(bx, by, 2, 1);
    }

    // Pequeños guijarros en la orilla del pasto
    if (i % 7 === 0 && th > 0.65) {
      ctx.fillStyle = '#7a766c';
      ctx.fillRect(sx + 1, sy + 2, 2, 2);
      ctx.fillStyle = '#9c988e';
      ctx.fillRect(sx + 1, sy + 2, 1, 1);
    }
  }
}

/**
 * Dibuja los acantilados facetados y cornisas de sillar rústico siguiendo la silueta
 * curva del Alto de las Rocas y su terraza superior (en el mismo lenguaje visual de las
 * hojas de rocas adjuntas y respetando el paso de la escalinata tallada).
 */
function paintCurvedCliffArc(
  ctx: CanvasRenderingContext2D,
  ring: readonly Vec2[],
  baseFaceH: number,
  gapMinX: number,
  gapMaxX: number,
  minBrowseY: number
): void {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x, y] = ring[i];
    if (y < minBrowseY) continue;
    if (!pointInPolygonRing(x, y + 6, NATAL_ISLAND_RING)) continue;

    const prev = ring[(i - 1 + n) % n];
    const next = ring[(i + 1) % n];
    const segLen = Math.hypot(next[0] - x, next[1] - y);
    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const nx = dy;
    const ny = -dx;

    const steps = Math.max(1, Math.ceil(segLen / 3));
    for (let s = 0; s < steps; s++) {
      const u = s / steps;
      const px = Math.round(x + (next[0] - x) * u);
      const py = Math.round(y + (next[1] - y) * u);
      if (px >= gapMinX && px <= gapMaxX && ny > 0.15) continue;

      const th = hash2(px + 13, py - 29);
      const blockIdx = Math.floor(px / 11);
      const blockJoint = px % 11 === 0;
      const westLit = nx < 0.08;

      if (ny > 0.24) {
        const hh = Math.max(8, Math.round(baseFaceH * (0.62 + 0.48 * ny) + (th - 0.5) * 4));
        // Sombra proyectada sobre el talud/pradera inferior
        ctx.fillStyle = 'rgba(14, 26, 20, 0.28)';
        ctx.fillRect(px, py + hh, 4, 5);

        // Contorno superior e inferior oscuro estilo pixel-art (como las hojas 2 y 3)
        ctx.fillStyle = '#2c2f36';
        ctx.fillRect(px, py - 1, 4, hh + 2);

        // Bloques de roca facetada con iluminación oeste -> este
        const faceColor = westLit
          ? blockIdx % 2 === 0
            ? '#888b90'
            : '#7c7f85'
          : blockIdx % 2 === 0
            ? '#6c7078'
            : '#5f636b';
        ctx.fillStyle = faceColor;
        ctx.fillRect(px, py + 1, 4, hh - 2);

        // Cornisa superior tallada y bisel iluminado por el sol
        ctx.fillStyle = westLit ? '#b5b4aa' : '#9c9e9a';
        ctx.fillRect(px, py, 4, 3);
        ctx.fillStyle = westLit ? 'rgba(248, 236, 206, 0.72)' : 'rgba(218, 214, 198, 0.46)';
        ctx.fillRect(px, py, 4, 1);

        // Estratos horizontales y diaclasas verticales entre bloques de roca (Efecto AAA Estratificado)
        if (hh >= 10) {
          for (let ly = 4; ly < hh - 2; ly += 6) {
            const eth = hash2(px, py + ly);
            ctx.fillStyle = 'rgba(38, 40, 46, 0.55)';
            ctx.fillRect(px, py + ly, 4, 1);
            if (eth > 0.6) {
                ctx.fillStyle = 'rgba(230, 220, 200, 0.25)';
                ctx.fillRect(px, py + ly - 1, 4, 1);
            }
          }
        }
        if (blockJoint || th > 0.82) {
          ctx.fillStyle = 'rgba(30, 32, 38, 0.68)';
          ctx.fillRect(px + 1, py + 2, 1, Math.max(3, hh - 3));
        }

        // Musgo colgante y pedruscos al pie del acantilado
        if (th < 0.24) {
          ctx.fillStyle = '#3b7332';
          ctx.fillRect(px, py + 1, 3, 2);
          ctx.fillStyle = '#6fb34f';
          ctx.fillRect(px, py + 1, 2, 1);
        }
        if (th > 0.74) {
          ctx.fillStyle = '#32353d';
          ctx.fillRect(px, py + hh - 1, 3, 3);
          ctx.fillStyle = '#8b8e94';
          ctx.fillRect(px, py + hh - 1, 2, 2);
        }
      } else if (nx > 0.22 && pointInPolygonRing(px + 6, py, NATAL_ISLAND_RING)) {
        // Reborde rocoso lateral este con bloques escalonados y musgo
        if (th > 0.40) {
          ctx.fillStyle = '#2d3037';
          ctx.fillRect(px - 1, py, 4, 4);
          ctx.fillStyle = '#7d8087';
          ctx.fillRect(px - 1, py, 3, 3);
          ctx.fillStyle = '#aeb0aa';
          ctx.fillRect(px - 1, py, 2, 1);
          if (th > 0.72) {
            ctx.fillStyle = 'rgba(92, 138, 70, 0.58)';
            ctx.fillRect(px + 1, py + 2, 3, 2);
          }
        }
      }
    }
  }
}

function paintOrganicRockHeadland(ctx: CanvasRenderingContext2D): void {
  // 1. Meseta principal y escollos rocosos recortados a la silueta costera
  ctx.save();
  ctx.beginPath();
  tracePolygonRing(ctx, NATAL_ROCK_PLATEAU_RING);
  for (const sk of NATAL_SKERRY_RINGS) {
    if (sk.surface === 'rock') tracePolygonRing(ctx, sk.ring);
  }
  ctx.clip();
  paintRockTexture(ctx, 300, 300, 560, 480, 41);
  paintRockTexture(ctx, 560, 1310, 56, 42, 73);
  paintRockTexture(ctx, 1736, 1310, 56, 42, 79);
  ctx.restore();

  // 2. Terraza alta curva del Mirador del Alto de las Rocas
  ctx.save();
  ctx.beginPath();
  tracePolygonRing(ctx, NATAL_ROCK_CREST_RING);
  ctx.clip();
  paintRockTexture(ctx, 456, 336, 316, 184, 89);
  ctx.fillStyle = 'rgba(244, 228, 194, 0.09)';
  ctx.fillRect(456, 336, 316, 184);
  ctx.restore();

  // 3. Frentes de acantilado facetados con paso abierto para las escalinatas talladas
  paintCurvedCliffArc(ctx, NATAL_ROCK_CREST_RING, 13, 600, 648, 448);
  paintCurvedCliffArc(ctx, NATAL_ROCK_PLATEAU_RING, 20, 626, 678, 650);
}

/* ----------------- COSTA, BAJÍO Y MAREA PRERENDERIZADOS ----------- */

/** Anchura variable del bajío turquesa: amplia en bahías/playas y más abrupta en acantilados. */
function localShelfRange(wx: number, wy: number, surface: IslaNatalSurface): number {
  const macro =
    Math.sin(wx * 0.0085 + 0.7) * 11 + Math.cos(wy * 0.011 - 0.4) * 9;
  if (surface === 'rock') {
    return Math.max(44, Math.min(72, 54 + macro * 0.65));
  }
  // Lagunas turquesas más generosas en Playa del Aurora y ensenadas del sur
  const southLagoon = wy > 1010 ? 14 : 0;
  return Math.max(66, Math.min(SHELF_RANGE, 84 + southLagoon + macro));
}

function paintCoastBand(ctx: CanvasRenderingContext2D, field: NatalCoastField): void {
  const step = 2;
  const width = ISLA_NATAL_WORLD_W + field.pad * 2;
  const height = ISLA_NATAL_WORLD_H + field.pad * 2;

  for (let py = 0; py < height; py += step) {
    for (let px = 0; px < width; px += step) {
      const wx = px - field.pad + step * 0.5;
      const wy = py - field.pad + step * 0.5;
      const d = sampleDistancePx(field, wx, wy);

      if (d <= 0.05) {
        // Tierra firme: pintamos la orla húmeda de marea y el filo vivo de espuma/roca mojada
        const inner = sampleInnerDistancePx(field, wx, wy);
        if (inner < 17) {
          const surface = sampleSurfaceAt(field, wx, wy);
          ctx.fillStyle = wetRimColor(surface, 1 - inner / 17);
          ctx.fillRect(px, py, step, step);
          const th = hash2(px + 29, py - 61);
          if (inner < 3.2 && th > 0.46) {
            ctx.fillStyle =
              surface === 'rock'
                ? 'rgba(210, 238, 236, 0.34)'
                : 'rgba(255, 248, 224, 0.36)';
            ctx.fillRect(px, py, step, 1);
          }
        }
        continue;
      }

      // Fuera de la silueta erosionada recortamos cualquier excedente de textura
      if (d < 34) {
        ctx.clearRect(px, py, step, step);
      }
      if (d > SHELF_RANGE + 18) continue;

      const surface = sampleSurfaceAt(field, wx, wy);
      const maxShelf = localShelfRange(wx, wy, surface);
      const th = hash2(px + 17, py + 89);
      const wobble =
        Math.sin(wx * 0.052 + wy * 0.023) * 2.8 + Math.sin(wy * 0.074 - wx * 0.015) * 2.1;
      const band = d + wobble;
      if (band > maxShelf) continue;
      if (band > maxShelf - 24) {
        const chance = (band - (maxShelf - 24)) / 26;
        if (th < chance) continue;
      }

      const normBand = (band / maxShelf) * 84;
      ctx.fillStyle = shelfColor(normBand);
      ctx.fillRect(px, py, step, step);

      // Bancos de arena sumergidos bajo el agua cristalina de las playas curvas
      if (surface === 'sand' && band > 3 && band < 28) {
        const sandGlow = (1 - band / 28) * 0.2;
        ctx.fillStyle = `rgba(222, 190, 134, ${sandGlow.toFixed(3)})`;
        ctx.fillRect(px, py, step, step);
      }

      // Detalle submarino: destellos, praderas de posidonia y arrecifes someros
      if (band < 26 && th > 0.88) {
        ctx.fillStyle = 'rgba(224, 255, 250, 0.42)';
        ctx.fillRect(px, py, 2 + Math.floor(th * 3), 1);
      } else if (band > 8 && band < 38 && th < 0.036) {
        ctx.fillStyle =
          surface === 'rock' ? 'rgba(22, 58, 72, 0.42)' : 'rgba(18, 78, 68, 0.35)';
        ctx.fillRect(px, py, 3, 2);
      }
      if (band < 12 && th > 0.74) {
        ctx.fillStyle = 'rgba(214, 244, 228, 0.34)';
        ctx.fillRect(px, py, 2, 1);
      }
    }
  }
}

function paintGroundLayer(field: NatalCoastField): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ISLA_NATAL_WORLD_W + field.pad * 2;
  canvas.height = ISLA_NATAL_WORLD_H + field.pad * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;

  ctx.save();
  ctx.translate(field.pad, field.pad);

  // 1. Manto continuo de arena dorada enmascarado a la silueta orgánica (+ margen de erosión)
  ctx.save();
  ctx.beginPath();
  tracePolygonRing(ctx, NATAL_ISLAND_RING);
  for (const sk of NATAL_SKERRY_RINGS) tracePolygonRing(ctx, sk.ring);
  ctx.lineWidth = 22;
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#d4b27c';
  ctx.strokeStyle = '#d4b27c';
  ctx.fill();
  ctx.stroke();
  for (const r of ISLA_NATAL_WALK_RECTS) {
    ctx.fillRect(r.x + 2, r.y + 2, Math.max(2, r.w - 4), Math.max(2, r.h - 4));
  }
  ctx.globalCompositeOperation = 'source-atop';
  paintSandTexture(ctx, 290, 290, 1772, 1240, 37);
  ctx.restore();

  // 2. Pradera orgánica unificada (3 texturas) + integración curva con las playas
  paintUnifiedIslandMeadow(ctx);
  paintCurvedMeadowBeachFringe(ctx);

  // 3. Promontorio y terrazas curvas del Alto de las Rocas + acantilados estratificados
  paintOrganicRockHeadland(ctx);

  // 4. Red coherente de caminos empedrados según cada trayecto (intacta)
  paintIslandPaths(ctx);

  ctx.restore();

  // 5. Esculpido costero final, orla húmeda de marea y bajío turquesa asimétrico
  paintCoastBand(ctx, field);

  // 6. Luz de la isla dentro de la masa terrestre y su bajío (sin teñir el mar abierto)
  const worldW = canvas.width;
  const worldH = canvas.height;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const worldLight = ctx.createLinearGradient(0, 0, worldW, worldH);
  worldLight.addColorStop(0, 'rgba(255, 222, 156, 0.13)');
  worldLight.addColorStop(0.34, 'rgba(255, 236, 190, 0.045)');
  worldLight.addColorStop(0.62, 'rgba(210, 230, 200, 0)');
  worldLight.addColorStop(1, 'rgba(18, 52, 64, 0.08)');
  ctx.fillStyle = worldLight;
  ctx.fillRect(0, 0, worldW, worldH);

  // 7. Grandes sombras de nube y calvas de sol sobre el relieve insular
  for (let i = 0; i < 9; i += 1) {
    const th = hash2(i * 91 + 7, i * 37 + 19);
    const cx = (th * 0.9 + 0.05) * worldW;
    const cy = (hash2(i * 13 + 3, i * 71 + 5) * 0.86 + 0.07) * worldH;
    const rx = 90 + th * 110;
    const ry = 44 + th * 52;
    paintGroundHalo(ctx, cx, cy, rx, ry, '22, 52, 46', 0.05);
    paintGroundHalo(ctx, cx + rx * 0.5, cy + ry * 0.6, rx * 0.6, ry * 0.6, '12, 38, 34', 0.035);
  }
  ctx.restore();

  return canvas;
}

function ensureCoastLayer(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const tileMask =
    ensureNatalGrassTiles().mask |
    (ensureNatalPathTiles().mask << 3) |
    (ensureNatalSandTiles().mask << 8) |
    (ensureNatalRockTiles().mask << 10);
  if (coastGroundLayer && coastLayerTileMask === tileMask) {
    return coastGroundLayer;
  }
  if (!coastField) {
    coastField = buildCoastField();
    coastFoam = buildFoamPoints(coastField);
  }
  coastGroundLayer = paintGroundLayer(coastField);
  coastLayerTileMask = tileMask;
  return coastGroundLayer;
}

/* ------------------------------------------------------------------ */
/* MAR                                                                */
/* ------------------------------------------------------------------ */

function drawOcean(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  vw: number,
  vh: number,
  elapsed: number,
  animFrame4: number,
  charge: number,
  reducedMotion: boolean
): void {
  const waterTiles = ensureNatalWaterTiles();

  // 1. Fondo de mar profundo con gradiente
  const depth = ctx.createLinearGradient(0, camY, 0, camY + vh);
  depth.addColorStop(0, '#0c3452');
  depth.addColorStop(0.42, '#092b47');
  depth.addColorStop(1, '#051c31');
  ctx.fillStyle = depth;
  ctx.fillRect(camX, camY, vw, vh);

  // 2. Textura de superficie de agua (E_32b551ca.jpg)
  if (waterTiles.surface) {
    ctx.save();
    const surfaceScale = 2.4;
    const scrollX = reducedMotion ? 0 : elapsed * 8;
    const scrollY = reducedMotion ? 0 : elapsed * 3;
    const pattern = ctx.createPattern(waterTiles.surface, 'repeat');
    if (pattern) {
      ctx.globalAlpha = 0.42;
      const matrix = new DOMMatrix();
      matrix.translateSelf(-camX * 0.1 - scrollX, -camY * 0.1 - scrollY);
      matrix.scaleSelf(surfaceScale, surfaceScale);
      pattern.setTransform(matrix);
      ctx.fillStyle = pattern;
      ctx.fillRect(camX, camY, vw, vh);
    }
    ctx.restore();
  }

  // 3. Cáusticas y reflejos (images_a679ab2f.jpg)
  if (waterTiles.caustics) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const causticScale = 1.8;
    const scrollX = reducedMotion ? 0 : Math.sin(elapsed * 0.5) * 15;
    const scrollY = reducedMotion ? 0 : elapsed * 12;
    const pattern = ctx.createPattern(waterTiles.caustics, 'repeat');
    if (pattern) {
      ctx.globalAlpha = 0.18 + Math.sin(elapsed * 1.2) * 0.04;
      const matrix = new DOMMatrix();
      matrix.translateSelf(-camX * 0.15 + scrollX, -camY * 0.15 - scrollY);
      matrix.scaleSelf(causticScale, causticScale);
      pattern.setTransform(matrix);
      ctx.fillStyle = pattern;
      ctx.fillRect(camX, camY, vw, vh);
    }
    ctx.restore();
  }

  // 4. Luz cálida del oeste
  const westGlow = ctx.createLinearGradient(camX, 0, camX + vw * 0.6, 0);
  westGlow.addColorStop(0, 'rgba(255, 176, 108, 0.08)');
  westGlow.addColorStop(0.55, 'rgba(255, 162, 98, 0.03)');
  westGlow.addColorStop(1, 'rgba(255, 150, 90, 0)');
  ctx.fillStyle = westGlow;
  ctx.fillRect(camX, camY, vw * 0.6, vh);

}

/* ------------------------------------------------------------------ */
/* TIERRA: bajío, arena húmeda, superficies y espuma                   */
/* ------------------------------------------------------------------ */

function drawLandmass(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  vw: number,
  vh: number,
  elapsed: number
): void {
  const layer = ensureCoastLayer();

  if (layer) {
    const sx = Math.max(0, Math.round(camX) + GROUND_PAD - 6);
    const sy = Math.max(0, Math.round(camY) + GROUND_PAD - 6);
    const sw = Math.min(layer.width - sx, Math.ceil(vw) + 12);
    const sh = Math.min(layer.height - sy, Math.ceil(vh) + 12);
    if (sw > 0 && sh > 0) {
      ctx.drawImage(layer, sx, sy, sw, sh, sx - GROUND_PAD, sy - GROUND_PAD, sw, sh);
    }
  } else {
    // Respaldo mínimo si el canvas no está disponible.
    ctx.fillStyle = '#e8d3a0';
    for (const r of ISLA_NATAL_WALK_RECTS) {
      if (!isWorldBoxVisible(r.x, r.y, r.w, r.h, camX, camY, vw, vh)) continue;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  drawShoreWater(ctx, camX, camY, vw, vh, elapsed);
}

/** Brillo, ondulación y espuma animada sobre la costa prerenderizada. */
function drawShoreWater(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  vw: number,
  vh: number,
  elapsed: number
): void {
  const field = coastField;
  if (!field) return;

  // Cáusticas del bajío: destellos quietos que respiran con la marea.
  const grid = 14;
  const gx0 = Math.floor(camX / grid) * grid;
  const gy0 = Math.floor(camY / grid) * grid;
  for (let wy = gy0; wy < camY + vh + grid; wy += grid) {
    for (let wx = gx0; wx < camX + vw + grid; wx += grid) {
      const th = hash2(wx + 61, wy - 37);
      if (th < 0.82) continue;
      const d = sampleDistancePx(field, wx + 7, wy + 7);
      if (d < 2 || d > 46) continue;
      const shimmer = Math.sin(elapsed * 2.1 + th * 34 + d * 0.18);
      if (shimmer < 0.15) continue;
      const alpha = 0.1 + (shimmer + 0.5) * 0.2;
      ctx.fillStyle = `rgba(196, 255, 249, ${alpha.toFixed(3)})`;
      const len = 3 + Math.floor(th * 5);
      ctx.fillRect(wx + Math.floor(th * 8), wy + Math.floor(th * 10), len, 1);
    }
  }

  // Rompiente: espuma que sube y baja siguiendo el contorno real de la isla.
  const foam = coastFoam;
  for (let i = 0; i < foam.length; i++) {
    const f = foam[i];
    if (!isWorldBoxVisible(f.x - 14, f.y - 14, 28, 28, camX, camY, vw, vh)) continue;
    const wave = Math.sin(elapsed * (1.5 + f.band * 0.18) + f.phase);
    const tide = wave * (1.3 + f.band * 0.7);
    const x = Math.round(f.x + (f.horiz ? 0 : tide));
    const y = Math.round(f.y + (f.horiz ? tide : 0));

    if (f.band === 0) {
      // Lengua de espuma que lame la arena.
      const a = 0.28 + Math.max(0, wave) * 0.55;
      ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
      if (f.horiz) ctx.fillRect(x, y, 7, 2);
      else ctx.fillRect(x, y, 2, 6);
      if (f.seed > 0.62) {
        ctx.fillStyle = 'rgba(190, 246, 236, 0.75)';
        if (f.horiz) ctx.fillRect(x + 2, y - 1, 3, 1);
        else ctx.fillRect(x - 1, y + 1, 1, 3);
      }
    } else if (f.band === 1) {
      const a = 0.16 + Math.max(0, wave) * 0.34;
      ctx.fillStyle = `rgba(232, 255, 250, ${a.toFixed(3)})`;
      if (f.horiz) ctx.fillRect(x, y, 8, 1);
      else ctx.fillRect(x, y, 1, 7);
    } else if (f.band === 2) {
      const a = 0.08 + Math.max(0, wave) * 0.18;
      ctx.fillStyle = `rgba(190, 240, 236, ${a.toFixed(3)})`;
      if (f.horiz) ctx.fillRect(x, y, 5, 1);
      else ctx.fillRect(x, y, 1, 5);
    } else if (wave > 0.5) {
      ctx.fillStyle = `rgba(220, 250, 246, ${(0.05 + wave * 0.1).toFixed(3)})`;
      if (f.horiz) ctx.fillRect(x, y, 4, 1);
      else ctx.fillRect(x, y, 1, 4);
    }
  }

  // Sheen dorado del atardecer sobre el agua que roza la costa oeste: une el
  // reflejo del sol con la rompiente y evita que la orilla quede fría.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < foam.length; i++) {
    const f = foam[i];
    if (f.x > 920) continue;
    const dy = Math.abs(f.y - 588);
    if (dy > 250) continue;
    const flick = 0.55 + Math.sin(elapsed * 1.35 + f.phase) * 0.45;
    const a = (1 - dy / 250) * 0.13 * flick;
    if (a <= 0.004) continue;
    ctx.fillStyle = `rgba(255, 214, 148, ${a.toFixed(3)})`;
    if (f.horiz) ctx.fillRect(Math.round(f.x - 2), Math.round(f.y - 1), 7, 1);
    else ctx.fillRect(Math.round(f.x - 1), Math.round(f.y - 3), 1, 7);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* VEGETACIÓN Y ROCAS                                                 */
/* ------------------------------------------------------------------ */

function drawTuft(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number, sway: number): void {
  const h = 3 + Math.floor(seed * 6);
  const kind = Math.floor(hash2(x, y) * 3);

  // Sombra profunda de contacto en la raíz
  ctx.fillStyle = 'rgba(6, 22, 10, 0.48)';
  ctx.fillRect(x - 3, y, 7, 2);
  ctx.fillStyle = 'rgba(4, 16, 8, 0.60)';
  ctx.fillRect(x - 1, y, 3, 1);

  // Tres variantes de mata: abanico alto, penacho bajo y brote doble. Así el
  // campo no repite la misma silueta por todas partes.
  if (kind === 0) {
    ctx.fillStyle = seed > 0.5 ? '#356f36' : '#3d7c3c';
    ctx.fillRect(x - 3, y - h + 2, 1, h - 1);
    ctx.fillRect(x + 3, y - h + 1, 1, h - 1);
    ctx.fillStyle = seed > 0.5 ? '#5fae4e' : '#4f9a45';
    ctx.fillRect(x - 2, y - h, 1, h);
    ctx.fillRect(x + 2, y - h + 1, 1, h - 1);
    ctx.fillStyle = seed > 0.5 ? '#8ddb74' : '#79c96a';
    ctx.fillRect(x - 1 + sway, y - h, 1, h - 1);
    ctx.fillRect(x + 1 + sway, y - h - 1, 1, h);
    ctx.fillRect(x + sway, y - h + 2, 1, h - 3);
    if (seed > 0.62) {
      ctx.fillStyle = '#b7e88f';
      ctx.fillRect(x + 1 + sway, y - h - 1, 1, 1);
    }
  } else if (kind === 1) {
    // Penacho bajo y tupido, sin punta brillante.
    ctx.fillStyle = '#3d7c3c';
    ctx.fillRect(x - 2, y - h + 1, 5, h - 1);
    ctx.fillStyle = '#589c48';
    ctx.fillRect(x - 1 + sway, y - h, 3, h - 1);
    ctx.fillStyle = '#74c161';
    ctx.fillRect(x + sway, y - h, 1, h - 2);
  } else {
    // Brote doble, más oscuro y discreto.
    ctx.fillStyle = '#356f36';
    ctx.fillRect(x - 2, y - h + 2, 1, h - 2);
    ctx.fillRect(x + 1, y - h + 1, 1, h - 1);
    ctx.fillStyle = '#549e44';
    ctx.fillRect(x - 1 + sway, y - h, 1, h - 1);
    ctx.fillRect(x + 2 + sway, y - h + 1, 1, h - 2);
  }
}

function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number): void {
  ctx.fillStyle = 'rgba(30, 68, 32, 0.35)';
  ctx.fillRect(x - 1, y, 4, 1);
  ctx.fillStyle = '#3f8a41';
  ctx.fillRect(x, y - 4, 1, 4);
  ctx.fillRect(x + 1, y - 2, 2, 1);
  const petal = seed > 0.8 ? '#f9a8d4' : seed > 0.55 ? '#fde68a' : seed > 0.3 ? '#f8fafc' : '#c4b5fd';
  ctx.fillStyle = petal;
  ctx.fillRect(x - 1, y - 6, 3, 1);
  ctx.fillRect(x - 1, y - 5, 1, 3);
  ctx.fillRect(x + 1, y - 5, 1, 3);
  ctx.fillRect(x, y - 7, 1, 1);
  ctx.fillRect(x, y - 3, 1, 1);
  ctx.fillStyle = seed > 0.5 ? '#fbbf24' : '#f59e0b';
  ctx.fillRect(x, y - 5, 1, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(x - 1, y - 6, 1, 1);
}

function drawPebble(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number): void {
  const atlas = ensureNatalRockAtlas();
  const onMeadow = isPointOnNatalMeadow(x, y);
  const onRock = x < 590 && y < 544;
  const onSand = !onMeadow && !onRock;

  // Guijarros medianos/grupos extraídos directamente de la hoja 2 (fila 5)
  if (seed > 0.62) {
    const key: NatalRockSpriteKey =
      seed > 0.86 ? 'pebbleQuad' : seed > 0.74 ? 'pebbleTrio' : 'pebbleSmooth';
    const pair = atlas[key];
    if (pair) {
      const flip = hash2(x + 17, y - 23) > 0.5;
      const sprite = flip ? pair.flipped : pair.normal;
      const scale = 0.68 + (seed - 0.62) * 0.45;
      const dw = Math.max(6, Math.round(pair.w * scale));
      const dh = Math.max(5, Math.round(pair.h * scale));
      ctx.fillStyle = onSand
        ? 'rgba(104, 72, 36, 0.34)'
        : onRock
          ? 'rgba(30, 32, 36, 0.34)'
          : 'rgba(22, 46, 22, 0.30)';
      ctx.beginPath();
      ctx.ellipse(x + 1, y + 1, dw * 0.52, Math.max(2, dh * 0.26), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(sprite, Math.round(x - dw * 0.5), Math.round(y - dh + 2), dw, dh);
      if (onSand) {
        ctx.fillStyle = 'rgba(226, 194, 142, 0.62)';
        ctx.fillRect(Math.round(x - dw * 0.35), y + 1, Math.max(3, Math.round(dw * 0.45)), 1);
      }
      return;
    }
  }

  // Piedrecillas pequeñas con contorno pixel-art acorde a la paleta mineral de las hojas adjuntas
  const s = 3 + Math.floor(seed * 3);
  if (onSand) {
    ctx.fillStyle = 'rgba(104, 72, 36, 0.36)';
    ctx.fillRect(x - 1, y + 1, s + 3, 2);
    ctx.fillStyle = 'rgba(234, 204, 152, 0.55)';
    ctx.fillRect(x - 1, y + 2, s + 2, 1);
  } else {
    ctx.fillStyle = 'rgba(34, 36, 40, 0.34)';
    ctx.fillRect(x, y + 1, s + 2, 2);
  }
  ctx.fillStyle = '#2d3138';
  ctx.fillRect(x - 1, y - 1, s + 2, s);
  ctx.fillStyle = seed > 0.32 ? '#8f949c' : '#777c85';
  ctx.fillRect(x, y, s, Math.max(1, s - 2));
  ctx.fillStyle = 'rgba(238, 232, 214, 0.58)';
  ctx.fillRect(x, y, Math.max(1, s - 1), 1);
}

function drawShell(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number): void {
  // Pequeña depresión cálida y granos de arena apoyados sobre el borde de la concha
  ctx.fillStyle = 'rgba(108, 76, 38, 0.38)';
  ctx.fillRect(x, y + 2, 5, 2);
  ctx.fillStyle = 'rgba(238, 210, 160, 0.58)';
  ctx.fillRect(x - 1, y + 2, 2, 1);
  ctx.fillStyle = seed > 0.5 ? '#f8cde4' : '#fbe4c8';
  ctx.fillRect(x, y, 4, 3);
  ctx.fillRect(x + 1, y - 1, 2, 1);
  ctx.fillStyle = 'rgba(182, 118, 138, 0.72)';
  ctx.fillRect(x + 1, y, 1, 3);
  ctx.fillRect(x + 3, y + 1, 1, 2);
  ctx.fillStyle = 'rgba(255, 250, 238, 0.75)';
  ctx.fillRect(x, y, 2, 1);
  ctx.fillStyle = 'rgba(206, 168, 114, 0.52)';
  ctx.fillRect(x + 3, y + 2, 2, 1);
}



/**
 * Proyecta una sombra elíptica semitransparente (rgba(0,0,0,0.25)) debajo de las entidades del mapa.
 * La dimensión de la sombra se calcula dinámicamente según la posición Y de la entidad.
 */
export function drawEntityDynamicShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  baseRx: number,
  baseRy: number,
  yScaleFactor = 0.00018
): void {
  // Ajuste dinámico de escala basado en la profundidad Y en el mundo (referencia y0 = 900)
  const depthScale = 1 + (y - 900) * yScaleFactor;
  const rx = Math.max(2.5, baseRx * depthScale);
  const ry = Math.max(1.2, baseRy * depthScale);

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(y), rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Dibuja la Huerta de Cultivo en HUERTA_RECT (1068, 940, 216, 98):
 * Surcos de tierra fértil, hortalizas (calabazas, tomates con tutores, maíz, coles),
 * cajones de madera, barril de agua y postes de cerco.
 * Para cada hortaliza y elemento, proyecta sombras elípticas semitransparentes (rgba(0,0,0,0.25))
 * calculadas dinámicamente según la posición Y.
 */
function drawHuertaGarden(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  reducedMotion: boolean
): void {
  const { x, y, w, h } = HUERTA_RECT;

  // 1. Parche de tierra fértil de la huerta (surcos)
  ctx.fillStyle = '#261b11'; // Tierra húmeda profunda
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#3d2b1b'; // Tierra abonada
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);

  // Surcos horizontales
  const rows = [y + 16, y + 38, y + 60, y + 82];
  for (const ry of rows) {
    ctx.fillStyle = '#2d1e13';
    ctx.fillRect(x + 6, ry - 3, w - 12, 10);
    ctx.fillStyle = '#483422';
    ctx.fillRect(x + 8, ry - 2, w - 16, 8);
    ctx.fillStyle = '#5c432d';
    ctx.fillRect(x + 10, ry - 2, w - 20, 2);
  }

  // 2. Fila 1: Calabazas con enredaderas
  const row1Y = rows[0] + 2;
  for (let cx = x + 20; cx <= x + w - 20; cx += 28) {
    // Sombra elíptica semitransparente (rgba(0,0,0,0.25)) calculada dinámicamente según Y
    drawEntityDynamicShadow(ctx, cx + 2, row1Y + 3, 10, 5);

    // Calabaza naranja brillante
    ctx.fillStyle = '#1e381a';
    ctx.fillRect(cx - 8, row1Y - 2, 16, 5);
    ctx.fillStyle = '#d97706';
    ctx.fillRect(cx - 5, row1Y - 4, 10, 7);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(cx - 4, row1Y - 5, 8, 3);
    ctx.fillStyle = '#78350f';
    ctx.fillRect(cx, row1Y - 6, 2, 2);
  }

  // 3. Fila 2: Tomates con tutores de madera
  const row2Y = rows[1] + 2;
  for (let cx = x + 16; cx <= x + w - 16; cx += 22) {
    // Sombra elíptica semitransparente (rgba(0,0,0,0.25)) calculada dinámicamente según Y
    drawEntityDynamicShadow(ctx, cx + 2, row2Y + 4, 9, 4.5);

    // Tutor de madera vertical
    ctx.fillStyle = '#3a2414';
    ctx.fillRect(cx, row2Y - 14, 2, 16);
    ctx.fillStyle = '#784d2a';
    ctx.fillRect(cx, row2Y - 14, 1, 16);

    // Follaje tomatera
    ctx.fillStyle = '#1e4d22';
    ctx.fillRect(cx - 6, row2Y - 12, 12, 11);
    ctx.fillStyle = '#34853b';
    ctx.fillRect(cx - 5, row2Y - 11, 10, 8);

    // Frutos rojos
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(cx - 4, row2Y - 6, 3, 3);
    ctx.fillRect(cx + 2, row2Y - 8, 3, 3);
    ctx.fillRect(cx - 1, row2Y - 3, 3, 3);
    ctx.fillStyle = '#fca5a5';
    ctx.fillRect(cx - 4, row2Y - 6, 1, 1);
    ctx.fillRect(cx + 2, row2Y - 8, 1, 1);
  }

  // 4. Fila 3: Mazorcas altas de maíz
  const row3Y = rows[2] + 2;
  const wind = reducedMotion ? 0 : Math.sin(elapsed * 2 + x) * 0.8;
  for (let cx = x + 18; cx <= x + w - 18; cx += 20) {
    // Sombra elíptica semitransparente (rgba(0,0,0,0.25)) calculada dinámicamente según Y
    drawEntityDynamicShadow(ctx, cx + 2, row3Y + 4, 11, 5);

    // Caña alta de maíz
    ctx.fillStyle = '#1e4a1d';
    ctx.fillRect(cx, row3Y - 18, 2, 20);
    ctx.fillStyle = '#3f8e3d';
    ctx.fillRect(cx - 5 + wind, row3Y - 12, 12, 8);
    ctx.fillStyle = '#65c462';
    ctx.fillRect(cx - 4 + wind, row3Y - 11, 10, 5);

    // Espiga de maíz
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(cx + 1, row3Y - 9, 3, 5);
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(cx + 1, row3Y - 9, 1, 3);
  }

  // 5. Fila 4: Coles brillantes y lechugas
  const row4Y = rows[3] + 2;
  for (let cx = x + 14; cx <= x + w - 14; cx += 24) {
    // Sombra elíptica semitransparente (rgba(0,0,0,0.25)) calculada dinámicamente según Y
    drawEntityDynamicShadow(ctx, cx + 2, row4Y + 3, 8, 4);

    ctx.fillStyle = '#143818';
    ctx.beginPath();
    ctx.ellipse(cx, row4Y - 2, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#22662a';
    ctx.beginPath();
    ctx.ellipse(cx, row4Y - 2, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(cx - 2, row4Y - 3, 4, 3);
    ctx.fillStyle = '#bbf7d0';
    ctx.fillRect(cx - 1, row4Y - 3, 2, 1);
  }

  // 6. Elementos accesorios (Barril de agua y cajones de cosecha)
  const barrelX = x + 10;
  const barrelY = y + h - 14;
  drawEntityDynamicShadow(ctx, barrelX + 6, barrelY + 12, 10, 5);

  // Barril
  ctx.fillStyle = '#3f2817';
  ctx.fillRect(barrelX, barrelY, 12, 13);
  ctx.fillStyle = '#6b462b';
  ctx.fillRect(barrelX + 1, barrelY + 1, 10, 11);
  ctx.fillStyle = '#383b42';
  ctx.fillRect(barrelX, barrelY + 3, 12, 2);
  ctx.fillRect(barrelX, barrelY + 9, 12, 2);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(barrelX + 2, barrelY + 1, 8, 2);

  // Postes de cerco perimetral con sombras elípticas dinámicas
  for (const px of [x + 2, x + Math.round(w / 2), x + w - 4]) {
    for (const py of [y + 2, y + h - 2]) {
      drawEntityDynamicShadow(ctx, px + 1, py + 2, 5, 3);
      ctx.fillStyle = '#2d1a0e';
      ctx.fillRect(px - 1, py - 10, 4, 11);
      ctx.fillStyle = '#6e4528';
      ctx.fillRect(px, py - 10, 2, 10);
    }
  }
}

const BUSH_PHOTO_SOURCES = [
  '/assets/aistudio/imageDDDASs_1d655170.jpg',
  '/assets/aistudio/imSSSSDASSSAages_7dc1d2bf.jpg',
  '/assets/aistudio/imSSSSDAages_5c2a7aa7.jpg',
  '/assets/aistudio/imSSSSDages_32b004cc.jpg',
  '/assets/aistudio/imagesSDSS_6ee06b20.jpg',
  '/assets/aistudio/imaSSAges_fe1a522e.jpg',
];

let bushPhotoImgs: HTMLImageElement[] = [];
const bakedBushMap = new Map<HTMLImageElement, HTMLCanvasElement>();

function ensureBushPhotos(): HTMLImageElement[] {
  if (typeof Image === 'undefined') return [];
  if (bushPhotoImgs.length === 0) {
    bushPhotoImgs = BUSH_PHOTO_SOURCES.map(src => {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      return img;
    });
  }
  return bushPhotoImgs.filter(img => img.complete && img.naturalWidth > 0);
}

function getBakedBushNoBg(img: HTMLImageElement): HTMLCanvasElement | null {
  if (bakedBushMap.has(img)) return bakedBushMap.get(img)!;
  if (!img.complete || img.naturalWidth <= 0) return null;

  const nw = img.naturalWidth;
  const nh = img.naturalHeight;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = nw;
  tempCanvas.height = nh;
  const tctx = tempCanvas.getContext('2d');
  if (!tctx) return null;
  tctx.drawImage(img, 0, 0);

  const imgData = tctx.getImageData(0, 0, nw, nh);
  const d = imgData.data;

  let minX = nw, minY = nh, maxX = -1, maxY = -1;

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;

    // Recorte estricto de fondo blanco / crema y halos claros (defringing completo)
    if (luma > 170 && sat < 32) {
      d[i + 3] = 0;
    } else if (r > 175 && g > 175 && b > 165) {
      d[i + 3] = 0;
    } else if (luma > 145 && sat < 24) {
      const alpha = Math.max(0, (170 - luma) / 25);
      d[i + 3] = Math.round(alpha * 255);
    }

    // Tintado y oscurecimiento de bordes claros para eliminar la línea blanca perimetral
    if (d[i + 3] > 0) {
      if (luma > 125 || (r > 140 && g > 140) || sat < 30) {
        d[i] = Math.round(r * 0.16 + 12);
        d[i + 1] = Math.round(g * 0.48 + 36);
        d[i + 2] = Math.round(b * 0.16 + 18);
      }
      const idx = i / 4;
      const x = idx % nw;
      const y = (idx / nw) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  tctx.putImageData(imgData, 0, 0);

  if (maxX < minX || maxY < minY) return null;

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  const out = document.createElement('canvas');
  out.width = cropW;
  out.height = cropH;
  const octx = out.getContext('2d');
  if (!octx) return null;

  octx.drawImage(tempCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

  // Tinte de hora dorada e integración croma con la pradera
  octx.globalCompositeOperation = 'source-atop';
  const sunGrad = octx.createLinearGradient(0, 0, cropW, cropH);
  sunGrad.addColorStop(0, 'rgba(255, 224, 152, 0.10)');
  sunGrad.addColorStop(0.5, 'rgba(255, 236, 190, 0.02)');
  sunGrad.addColorStop(1, 'rgba(16, 48, 40, 0.18)');
  octx.fillStyle = sunGrad;
  octx.fillRect(0, 0, cropW, cropH);

  bakedBushMap.set(img, out);
  return out;
}

function drawBushCluster(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  seed: number,
  elapsed: number,
  reducedMotion: boolean,
  scale = 1
): void {
  const loaded = ensureBushPhotos();
  if (loaded.length === 0) {
    drawBush(ctx, x, y, seed, elapsed, reducedMotion, scale);
    return;
  }

  const count = 2 + Math.floor(seed * 2); // 2 o 3 arbustos agrupados orgánicamente
  for (let i = 0; i < count; i++) {
    const offsetX = Math.round((hash2(x + i * 37, y - i * 19) - 0.5) * 24);
    const offsetY = Math.round((hash2(x + i * 23, y + i * 29) - 0.5) * 12);
    const bx = x + offsetX;
    const by = y + offsetY;
    if (isIslaNatalPointOnPath(bx, by)) continue;
    const imgIdx = Math.floor(hash2(bx + i, by - i) * loaded.length) % loaded.length;
    const img = loaded[imgIdx];
    const baked = getBakedBushNoBg(img);
    if (!baked) continue;

    const bw = Math.round(44 * scale);
    const bh = Math.round((baked.height / baked.width) * bw);

    // EFECTO DIFUSO DE SOMBRA & INTEGRACIÓN CON EL CÉSPED
    ctx.save();
    const diffGrad = ctx.createRadialGradient(bx, by + 2, bw * 0.1, bx, by + 2, bw * 0.78);
    diffGrad.addColorStop(0, 'rgba(4, 18, 8, 0.62)');
    diffGrad.addColorStop(0.48, 'rgba(8, 28, 14, 0.28)');
    diffGrad.addColorStop(1, 'rgba(12, 38, 20, 0)');
    ctx.fillStyle = diffGrad;
    ctx.beginPath();
    ctx.ellipse(bx, by + 2, bw * 0.78, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawEntityDynamicShadow(ctx, bx + 2, by + 2, bw * 0.48, 6);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(baked, Math.round(bx - bw * 0.5), Math.round(by - bh + 2), bw, bh);
    ctx.restore();

    // Briznas de hierba que abrazan la base del arbusto para fundirlo en el suelo
    ctx.fillStyle = '#22662c';
    for (let k = -2; k <= 2; k++) {
      const gx = bx + k * 8;
      const gh = 3 + Math.floor(hash2(gx, by) * 3);
      ctx.fillRect(gx, by - gh + 2, 2, gh);
    }
  }
}

function drawBush(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  seed: number,
  elapsed: number,
  reducedMotion: boolean,
  scale = 1
): void {
  const sway = reducedMotion ? 0 : Math.round(Math.sin(elapsed * 1.6 + seed * 8) * 0.8);
  const w = (26 + Math.floor(seed * 10)) * scale;
  const half = Math.round(w / 2);

  // EFECTO DIFUSO DE SOMBRA Y AURA VEGETAL
  ctx.save();
  const diffGrad = ctx.createRadialGradient(x, y + 2, half * 0.1, x, y + 2, half * 1.35);
  diffGrad.addColorStop(0, 'rgba(4, 18, 8, 0.58)');
  diffGrad.addColorStop(0.5, 'rgba(8, 28, 14, 0.24)');
  diffGrad.addColorStop(1, 'rgba(12, 38, 20, 0)');
  ctx.fillStyle = diffGrad;
  ctx.beginPath();
  ctx.ellipse(x, y + 2, half * 1.35, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawEntityDynamicShadow(ctx, x + 2, y + 2, half + 3, 6);

  // Sombra de contacto sólida y oclusión ambiental (integración con césped AAA)
  ctx.fillStyle = 'rgba(8, 28, 14, 0.55)';
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 1, half - 1, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Parche de césped base y raíces ocultas
  ctx.fillStyle = '#144d27';
  ctx.beginPath();
  ctx.ellipse(x, y, half + 4, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Briznas que abrazan el arbusto
  ctx.fillStyle = '#22662c';
  for(let i=0; i<4; i++) {
      const bh = 2 + (hash2(x + i * 7, y) * 3);
      ctx.fillRect(x - half + i * 8, y - bh, 2, bh);
  }

  // Lóbulos redondeados con esquinas achaflanadas: la copa deja de ser una
  // pila de rectángulos y gana volumen de arbusto pintado a mano.
  const blob = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: string,
    pad = 0
  ) => {
    const hw = Math.max(2, Math.round(rx + pad));
    const hh = Math.max(2, Math.round(ry + pad));
    ctx.fillStyle = color;
    // Base sólida del lóbulo
    ctx.fillRect(cx - hw + 2, cy - hh, hw * 2 - 4, hh * 2);
    ctx.fillRect(cx - hw, cy - hh + 2, hw * 2, hh * 2 - 4);
    // Destello de luz superior cálido (verde dorado, sin borde blanco)
    ctx.fillStyle = 'rgba(160, 230, 100, 0.22)';
    ctx.fillRect(cx - hw + 2, cy - hh, hw * 2 - 4, 2);
    // Sombra profunda inferior
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(cx - hw + 2, cy + hh - 2, hw * 2 - 4, 2);
  };

  const lobes = [
    { cx: x - half * 0.54, cy: y - 8, rx: half * 0.56, ry: 8 },
    { cx: x + half * 0.5, cy: y - 9, rx: half * 0.57, ry: 8 },
    { cx: x - half * 0.2 + sway, cy: y - 17, rx: half * 0.52, ry: 9 },
    { cx: x + half * 0.22 + sway, cy: y - 18, rx: half * 0.5, ry: 8 },
    { cx: x + sway * 0.6, cy: y - 25, rx: half * 0.43, ry: 7 },
  ];

  for (const l of lobes) blob(l.cx, l.cy, l.rx, l.ry, '#123217', 1.4);
  for (const l of lobes) blob(l.cx, l.cy + 1, l.rx, l.ry, '#1e4a24', 0.2);
  for (const l of lobes) blob(l.cx, l.cy, l.rx - 1, l.ry - 1, '#2c642f', 0);
  for (const l of lobes) {
    blob(l.cx - 2, l.cy - 2, l.rx * 0.55, l.ry * 0.52, '#3f8a3f', 0);
    blob(l.cx - 3, l.cy - 3, l.rx * 0.28, l.ry * 0.26, '#69b854', 0);
  }

  // Hojas individuales en el borde: rompen la silueta y dan textura de follaje.
  for (let i = 0; i < 12; i++) {
    const th = hash2(x + i * 13, y - i * 7);
    if (th < 0.32) continue;
    const ang = th * Math.PI * 2;
    const lx = x + sway + Math.round(Math.cos(ang) * (half - 1 + th * 4));
    const ly = y - 14 + Math.round(Math.sin(ang) * (13 + th * 5));
    const lit = Math.cos(ang) < -0.1 && Math.sin(ang) < 0.35;
    ctx.fillStyle = lit ? '#83c962' : th > 0.7 ? '#3f8a3f' : '#1d4723';
    ctx.fillRect(lx, ly, 3, 2);
    if (lit) {
      ctx.fillStyle = '#a9e284';
      ctx.fillRect(lx, ly, 1, 1);
    }
  }

  // Mechones y sombras internas: profundidad dentro de la copa.
  for (let i = 0; i < 6; i++) {
    const th = hash2(x + 19 + i * 7, y - 9 - i * 4);
    const lx = x - half + 4 + Math.round(th * (w - 8));
    const ly = y - 8 - Math.floor(hash2(i + 5, x) * 16);
    ctx.fillStyle = th > 0.55 ? 'rgba(18, 52, 24, 0.55)' : 'rgba(120, 190, 90, 0.5)';
    ctx.fillRect(lx, ly, 3, 2);
    ctx.fillRect(lx + 2, ly - 1, 1, 1);
  }

  // Bayas rojas sobre el follaje (sólo en los arbustos marcados).
  if (seed > 0.5) {
    for (let i = 0; i < 4; i++) {
      const bx = x - half + 6 + Math.round(hash2(x + i, y + 5) * (w - 14));
      const by = y - 8 - Math.floor(hash2(y - i, x + 9) * 12);
      ctx.fillStyle = 'rgba(30, 10, 12, 0.5)';
      ctx.fillRect(bx + 1, by + 1, 3, 3);
      ctx.fillStyle = '#8b1e24';
      ctx.fillRect(bx, by, 3, 3);
      ctx.fillStyle = '#e0524e';
      ctx.fillRect(bx, by, 2, 2);
      ctx.fillStyle = '#ffd9cf';
      ctx.fillRect(bx, by, 1, 1);
    }
  }

  // Pastito de la base.
  ctx.fillStyle = '#2f6d33';
  ctx.fillRect(x - half + 2, y, 5, 2);
  ctx.fillRect(x + half - 7, y + 1, 4, 2);
  ctx.fillStyle = '#7fc460';
  ctx.fillRect(x - half + 3, y - 1, 2, 2);
}

interface NatalMote {
  x: number;
  y: number;
  phase: number;
  speed: number;
  size: number;
}

/** Polen dorado flotando sobre la pradera y la playa. */
const NATAL_MOTES: NatalMote[] = (() => {
  const out: NatalMote[] = [];
  let guard = 0;
  while (out.length < 120 && guard < 4000) {
    guard++;
    const x = 280 + hash2(guard, 13) * 1160;
    const y = 250 + hash2(guard + 421, 29) * 830;
    if (!pointOnLand(x, y)) continue;
    out.push({
      x: Math.round(x),
      y: Math.round(y),
      phase: hash2(guard + 7, 3) * 6.283,
      speed: 0.25 + hash2(guard + 3, 11) * 0.5,
      size: hash2(guard + 5, 17) > 0.78 ? 2 : 1,
    });
  }
  return out;
})();

interface NatalButterfly {
  x: number;
  y: number;
  phase: number;
  color: string;
}

/** Mariposas que rondan las flores silvestres. */
const NATAL_BUTTERFLIES: NatalButterfly[] = ISLA_NATAL_FLOWERS.filter(
  (_, index) => index % 24 === 5
).map((f, i) => ({
  x: f.x,
  y: f.y,
  phase: f.seed * 6.283 + i,
  color: i % 2 === 0 ? '#fde68a' : '#fbcfe8',
}));

function drawAmbientLife(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  vw: number,
  vh: number,
  elapsed: number,
  reducedMotion: boolean
): void {
  for (let i = 0; i < NATAL_MOTES.length; i++) {
    const m = NATAL_MOTES[i];
    if (!isWorldBoxVisible(m.x - 12, m.y - 12, 24, 24, camX, camY, vw, vh)) continue;
    const t = elapsed * m.speed + m.phase;
    const x = Math.round(m.x + Math.sin(t) * 13 + Math.cos(t * 0.6) * 5);
    const y = Math.round(m.y + Math.cos(t * 0.8) * 7 - Math.sin(t * 0.4) * 4);
    const a = 0.18 + (Math.sin(t * 1.7) * 0.5 + 0.5) * 0.4;
    ctx.fillStyle = `rgba(255, 238, 184, ${a.toFixed(3)})`;
    ctx.fillRect(x, y, m.size, m.size);
  }

  if (reducedMotion) return;
  for (let i = 0; i < NATAL_BUTTERFLIES.length; i++) {
    const b = NATAL_BUTTERFLIES[i];
    const t = elapsed * 0.7 + b.phase;
    const x = Math.round(b.x + Math.sin(t) * 26 + Math.sin(t * 0.37) * 9);
    const y = Math.round(b.y - 10 + Math.cos(t * 0.8) * 12);
    if (!isWorldBoxVisible(x - 8, y - 8, 16, 16, camX, camY, vw, vh)) continue;
    const flap = Math.sin(elapsed * 12 + b.phase) > 0 ? 1 : 0;
    ctx.fillStyle = b.color;
    ctx.fillRect(x - 2, y - flap, 2, 2);
    ctx.fillRect(x + 1, y - flap, 2, 2);
    ctx.fillStyle = 'rgba(80, 60, 40, 0.8)';
    ctx.fillRect(x, y, 1, 2);
  }
}


interface NatalPalmBakedSet {
  sunlit: [HTMLCanvasElement, HTMLCanvasElement];
  woodland: [HTMLCanvasElement, HTMLCanvasElement];
}

let natalPalmSprite1: HTMLImageElement | null = null;
let natalPalmSprite2: HTMLImageElement | null = null;
let natalPalmBaked1: NatalPalmBakedSet | null = null;
let natalPalmBaked2: NatalPalmBakedSet | null = null;

function bakeIntegratedPalmCanvas(
  img: HTMLImageElement,
  outW: number,
  outH: number,
  flipX: boolean,
  woodlandShade: boolean
): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || !img.complete || img.naturalWidth <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const bctx = canvas.getContext('2d');
  if (!bctx) return null;

  bctx.save();
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  if (flipX) {
    bctx.translate(outW, 0);
    bctx.scale(-1, 1);
  }
  bctx.drawImage(img, 0, 0, outW, outH);
  bctx.restore();

  // Baño lumínico de Hora Dorada: sol cálido desde el oeste y penumbra esmeralda al este
  bctx.globalCompositeOperation = 'source-atop';
  const sunGrad = bctx.createLinearGradient(0, outH * 0.08, outW, outH * 0.92);
  if (woodlandShade) {
    sunGrad.addColorStop(0, 'rgba(255, 214, 134, 0.14)');
    sunGrad.addColorStop(0.45, 'rgba(64, 128, 42, 0.08)');
    sunGrad.addColorStop(1, 'rgba(12, 42, 24, 0.28)');
  } else {
    sunGrad.addColorStop(0, 'rgba(255, 224, 146, 0.21)');
    sunGrad.addColorStop(0.48, 'rgba(128, 186, 62, 0.06)');
    sunGrad.addColorStop(1, 'rgba(16, 48, 26, 0.22)');
  }
  bctx.fillStyle = sunGrad;
  bctx.fillRect(0, 0, outW, outH);

  // Luz cálida rebotada desde la arena/pradera en el envés bajo de la copa y oclusión en la raíz
  const baseGrad = bctx.createLinearGradient(0, outH * 0.82, 0, outH);
  baseGrad.addColorStop(0, 'rgba(22, 42, 20, 0)');
  baseGrad.addColorStop(1, 'rgba(18, 36, 16, 0.34)');
  bctx.fillStyle = baseGrad;
  bctx.fillRect(0, outH * 0.82, outW, outH * 0.18);
  bctx.globalCompositeOperation = 'source-over';

  // Limpieza suave de bordes sin escalones blancos: preserva puntas finas de palma y oscurece semitransparencias
  const imgData = bctx.getImageData(0, 0, outW, outH);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 22) {
      d[i + 3] = 0;
      continue;
    }
    if (a < 215) {
      const k = 0.84 + (a / 215) * 0.16;
      d[i] = Math.round(d[i] * k * 0.94);
      d[i + 1] = Math.round(d[i + 1] * k);
      d[i + 2] = Math.round(d[i + 2] * k * 0.88);
      d[i + 3] = Math.min(255, Math.round(Math.pow(a / 255, 0.92) * 255));
    }
  }
  bctx.putImageData(imgData, 0, 0);
  return canvas;
}

function ensureNatalPalmSprites(): [NatalPalmBakedSet | null, NatalPalmBakedSet | null] {
  if (typeof Image === 'undefined') return [null, null];
  if (!natalPalmSprite1) {
    natalPalmSprite1 = new Image();
    natalPalmSprite1.decoding = 'async';
    natalPalmSprite1.src = '/assets/pixelverse/natal-palm-1.png';
  }
  if (!natalPalmSprite2) {
    natalPalmSprite2 = new Image();
    natalPalmSprite2.decoding = 'async';
    natalPalmSprite2.src = '/assets/pixelverse/natal-palm-2.png';
  }
  if (!natalPalmBaked1 && natalPalmSprite1.complete && natalPalmSprite1.naturalWidth > 0) {
    const s0 = bakeIntegratedPalmCanvas(natalPalmSprite1, 184, 188, false, false);
    const s1 = bakeIntegratedPalmCanvas(natalPalmSprite1, 184, 188, true, false);
    const w0 = bakeIntegratedPalmCanvas(natalPalmSprite1, 184, 188, false, true);
    const w1 = bakeIntegratedPalmCanvas(natalPalmSprite1, 184, 188, true, true);
    if (s0 && s1 && w0 && w1) {
      natalPalmBaked1 = { sunlit: [s0, s1], woodland: [w0, w1] };
    }
  }
  if (!natalPalmBaked2 && natalPalmSprite2.complete && natalPalmSprite2.naturalWidth > 0) {
    const s0 = bakeIntegratedPalmCanvas(natalPalmSprite2, 164, 212, false, false);
    const s1 = bakeIntegratedPalmCanvas(natalPalmSprite2, 164, 212, true, false);
    const w0 = bakeIntegratedPalmCanvas(natalPalmSprite2, 164, 212, false, true);
    const w1 = bakeIntegratedPalmCanvas(natalPalmSprite2, 164, 212, true, true);
    if (s0 && s1 && w0 && w1) {
      natalPalmBaked2 = { sunlit: [s0, s1], woodland: [w0, w1] };
    }
  }
  return [natalPalmBaked1, natalPalmBaked2];
}

/**
 * AAA Micro-clutter: Dibuja pequeños detalles ambientales con oclusión ambiental profunda.
 */
function drawClutter(
  ctx: CanvasRenderingContext2D,
  clutter: IslaNatalClutter,
  elapsed: number,
  reducedMotion: boolean
): void {
  const { x, y, kind, seed } = clutter;
  const onMeadow = isPointOnNatalMeadow(x, y);
  const onRock = x < 618 && y < 548;
  const surface: 'sand' | 'grass' | 'rock' = onRock ? 'rock' : onMeadow ? 'grass' : 'sand';

  ctx.save();
  ctx.translate(x, y);

  // Sombra base común (Oclusión Ambiental profunda)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 6, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  switch (kind) {
    case 'mushroom': {
      const colors = ['#f87171', '#fb923c', '#fde68a'];
      const color = colors[Math.floor(seed * colors.length)];
      // Sombrerito
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, -2, 3, Math.PI, 0);
      ctx.fill();
      // Tallo
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(-1, -2, 2, 3);
      break;
    }
    case 'log': {
      ctx.rotate(seed * Math.PI);
      ctx.fillStyle = '#451a03';
      ctx.fillRect(-6, -2, 12, 4);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-5, -1, 10, 2);
      break;
    }
    case 'fern': {
      const sway = reducedMotion ? 0 : Math.sin(elapsed * 1.5 + seed * 10) * 0.1;
      ctx.rotate(sway);
      ctx.fillStyle = '#14532d';
      for (let i = 0; i < 3; i++) {
        ctx.rotate((Math.PI * 2) / 3);
        ctx.beginPath();
        ctx.ellipse(0, -4, 2, 6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'flower-cluster': {
      const colors = ['#f472b6', '#c084fc', '#60a5fa'];
      const color = colors[Math.floor(seed * colors.length)];
      ctx.fillStyle = '#166534';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      for (let i = 0; i < 5; i++) {
        const ang = (i * Math.PI * 2) / 5;
        ctx.fillRect(Math.cos(ang) * 3 - 1, Math.sin(ang) * 3 - 1, 2, 2);
      }
      break;
    }
    case 'debris': {
      ctx.fillStyle = surface === 'sand' ? '#92400e' : '#4b5563';
      ctx.fillRect(-2, -1, 4, 2);
      ctx.fillRect(2, 1, 2, 1);
      break;
    }
  }

  ctx.restore();
}

function drawPalm(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  seed: number,
  elapsed: number,
  reducedMotion: boolean
): void {
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const [palmSingleSet, palmTwinSet] = ensureNatalPalmSprites();
  const useTwinVariant = seed >= 0.48;
  const set = useTwinVariant ? palmTwinSet : palmSingleSet;
  const flipped = hash2(baseX + 31, baseY - 19) > 0.5;

  const land = isIslaNatalPointOnLand(baseX, baseY);
  const onMeadow = isPointOnNatalMeadow(baseX, baseY);
  const onSand = !onMeadow && land?.surface !== 'path';
  const nearBeach = onSand || !isPointOnNatalMeadow(baseX, baseY + 20);
  const onPath = land?.surface === 'path';
  const inArboleda = land?.zone === 'arboleda-arcade' || baseX > 1080;

  const pair = set ? (inArboleda ? set.woodland : set.sunlit) : null;
  const sprite = pair ? pair[flipped ? 1 : 0] : null;

  const scale = 0.84 + seed * 0.28;
  const drawW = Math.round((useTwinVariant ? 80 : 90) * scale);
  const drawH = Math.round((useTwinVariant ? 104 : 92) * scale);
  // Inclinación orgánica hacia el océano (sur / sureste)
  const seawardLean = 0.038 + (hash2(baseX - 13, baseY + 29) - 0.42) * 0.055;
  const breeze = reducedMotion
    ? 0
    : Math.sin(elapsed * 1.06 + seed * 9 + baseX * 0.018) * 0.02 +
      Math.sin(elapsed * 2.15 + seed * 15) * 0.005;
  const totalShear = seawardLean + breeze;
  const shadowShift = Math.round(-totalShear * 52);

  ctx.save();
  ctx.translate(baseX, baseY);

  // 1. Sombra proyectada de tronco + abanico de hojas hacia el este-sureste (hora dorada)
  const shadowColor = onSand
    ? 'rgba(88, 62, 28, 0.22)'
    : onPath
      ? 'rgba(54, 36, 18, 0.22)'
      : 'rgba(12, 36, 18, 0.22)';
  ctx.fillStyle = shadowColor;
  // Sombra alargada del tronco en el suelo
  ctx.beginPath();
  ctx.moveTo(-3, 2);
  ctx.lineTo(3, 0);
  ctx.lineTo(24 + shadowShift, 5);
  ctx.lineTo(18 + shadowShift, 8);
  ctx.closePath();
  ctx.fill();

  // Silueta lobulada de las palmas proyectada sobre el césped/arena
  const crownShadowX = 27 + shadowShift;
  const crownShadowY = 6;
  const frondAngles = [-2.5, -1.55, -0.65, 0.25, 1.15, 2.15];
  for (let fi = 0; fi < frondAngles.length; fi++) {
    const ang = frondAngles[fi] + seed * 0.8 + breeze * 2.4;
    const fx = crownShadowX + Math.cos(ang) * (drawW * 0.16);
    const fy = crownShadowY + Math.sin(ang) * 5.2;
    ctx.beginPath();
    ctx.ellipse(fx, fy, drawW * 0.17, 4.2, ang * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Lecho de raíces y oclusión ambiental de contacto AAA profunda
  ctx.fillStyle = onSand
    ? 'rgba(40, 20, 8, 0.65)'
    : onPath
      ? 'rgba(32, 16, 8, 0.62)'
      : 'rgba(4, 18, 6, 0.68)';
  ctx.beginPath();
  ctx.ellipse(0, 3, useTwinVariant ? 19 : 12, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Núcleo más oscuro de contacto directo
  ctx.fillStyle = onSand ? 'rgba(18, 8, 4, 0.75)' : 'rgba(2, 8, 3, 0.78)';
  ctx.beginPath();
  ctx.ellipse(0, 3, useTwinVariant ? 11 : 7, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();

  if (!onSand && !onPath) {
    // Mantillo de tierra fértil y briznas de integración natural
    ctx.fillStyle = '#2b1809';
    ctx.fillRect(useTwinVariant ? -10 : -6, 1, useTwinVariant ? 20 : 12, 2);
    
    // Parche de césped que envuelve la base
    ctx.fillStyle = '#144d27';
    ctx.beginPath();
    ctx.ellipse(0, 2, useTwinVariant ? 16 : 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Briznas individuales
    ctx.fillStyle = '#48b859';
    const bCount = useTwinVariant ? 6 : 4;
    for(let i=0; i<bCount; i++) {
        const bh = 3 + (hash2(baseX + i * 9, baseY) * 5);
        ctx.fillRect(-14 + i * 7, -bh + 2, 2, bh);
    }
  }

  // 3. Dibujo de la palmera con suavizado de alta calidad para conservar el detalle de las hojas
  if (sprite) {
    ctx.save();
    ctx.translate(0, 4);
    ctx.transform(1, 0, totalShear, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sprite, -drawW * 0.5, -drawH * 0.965, drawW, drawH);
    ctx.restore();
  } else {
    ctx.fillStyle = '#6e4a29';
    ctx.fillRect(-3, -52, 6, 54);
    ctx.fillStyle = '#2e7226';
    ctx.beginPath();
    ctx.ellipse(0, -54, 24, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Integración frontal al pie según el terreno real (arena costera, sendero o pradera)
  if (nearBeach) {
    // Pequeño montículo de arena removida y rizada abrazando la raíz de la palmera
    ctx.fillStyle = 'rgba(186, 148, 96, 0.58)';
    ctx.beginPath();
    ctx.ellipse(0, 4, useTwinVariant ? 17 : 11, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(222, 188, 134, 0.72)';
    ctx.fillRect(-10, 3, 8, 2);
    ctx.fillRect(3, 3, 8, 2);
    ctx.fillStyle = 'rgba(246, 224, 178, 0.55)';
    ctx.fillRect(-8, 2, 5, 1);
    ctx.fillRect(4, 3, 4, 1);

    // Ondulación de arena texturizada al pie
    ctx.fillStyle = 'rgba(164, 128, 80, 0.40)';
    ctx.fillRect(-12, 5, 24, 1);
  }
  if (onPath) {
    ctx.fillStyle = 'rgba(166, 130, 82, 0.62)';
    ctx.fillRect(-10, 3, 8, 2);
    ctx.fillRect(3, 3, 8, 2);
  }
  if (!onSand) {
    const sway = reducedMotion ? 0 : Math.round(Math.sin(elapsed * 1.45 + seed * 6) * 0.7);
    const offsets = useTwinVariant ? [-15, -9, -3, 3, 9, 15] : [-8, -4, 0, 4, 8];
    for (let i = 0; i < offsets.length; i++) {
      const gx = offsets[i] + Math.round((hash2(baseX + i * 7, baseY - i * 5) - 0.5) * 2);
      const gh = 3 + ((i + Math.floor(seed * 10)) % 3);
      ctx.fillStyle = i % 2 === 0 ? '#24571c' : '#387624';
      ctx.fillRect(gx - 1, 5 - gh, 2, gh);
      ctx.fillStyle = i % 3 === 0 ? '#8ad04e' : '#64ab35';
      ctx.fillRect(gx + sway, 4 - gh, 1, gh - 1);
    }
  }

  // Clutter costero: coco caído ocasional, guijarros de playa y restos vegetales
  if (seed > 0.32) {
    const cx = useTwinVariant ? (flipped ? -13 : 12) : flipped ? -8 : 7;
    ctx.fillStyle = onSand ? 'rgba(96, 66, 32, 0.48)' : 'rgba(20, 36, 18, 0.38)';
    ctx.fillRect(cx, 5, 5, 2);
    ctx.fillStyle = '#6e431f';
    ctx.fillRect(cx, 3, 4, 3);
    ctx.fillStyle = '#b67837';
    ctx.fillRect(cx, 3, 2, 2);
    if (onSand) {
      ctx.fillStyle = 'rgba(226, 194, 142, 0.62)';
      ctx.fillRect(cx - 1, 5, 3, 1);
    }
  }
  // Detalle de pequeños guijarros o maderitas arrastradas en la costa
  if (nearBeach && seed > 0.50) {
    const px = flipped ? 14 : -14;
    ctx.fillStyle = 'rgba(70, 50, 30, 0.35)';
    ctx.fillRect(px, 4, 4, 2);
    ctx.fillStyle = '#8f8372';
    ctx.fillRect(px, 3, 3, 2);
  }

  ctx.restore();
}

/** Escollos y agujas marinas sobre los cayos rocosos y bajíos (lejos del carril norte de surf). */
const NATAL_SEA_ROCKS: readonly {
  x: number;
  y: number;
  kind: NatalRockSpriteKey;
  scale: number;
  flip: boolean;
}[] = [
  { x: 231, y: 352, kind: 'spireSculpted', scale: 0.88, flip: false },
  { x: 384, y: 232, kind: 'spireSharp', scale: 0.82, flip: false },
  { x: 432, y: 966, kind: 'cragConical', scale: 0.80, flip: false },
  { x: 242, y: 520, kind: 'spireSharp', scale: 0.70, flip: true },
  { x: 1352, y: 840, kind: 'cragPointed', scale: 0.74, flip: false },
  { x: 1142, y: 982, kind: 'cobbleMound', scale: 0.72, flip: true },
];

/**
 * Peñascos escénicos situados en cornisas y cabos costeros fuera de los rectángulos
 * caminables (enriquecen la silueta rocosa sin alterar colisiones ni senderos).
 */
const NATAL_SCENIC_ROCKS: readonly {
  x: number;
  y: number;
  kind: NatalRockSpriteKey;
  scale: number;
  flip: boolean;
}[] = [
  // Península Noroeste (Cantera) - Simetría equilibrada
  { x: 442, y: 440, kind: 'outcropRidged', scale: 0.82, flip: false },
  { x: 682, y: 464, kind: 'coastalCluster', scale: 0.72, flip: false },
  // Zonas de Pradera y Arboleda
  { x: 1296, y: 794, kind: 'outcropBlocky', scale: 0.78, flip: false },
  { x: 1284, y: 874, kind: 'cobbleMound', scale: 0.86, flip: true },
];

function drawGroundedRockSprite(
  ctx: CanvasRenderingContext2D,
  pair: NatalRockSpritePair,
  cx: number,
  baseY: number,
  drawW: number,
  drawH: number,
  flip: boolean,
  surface: 'sand' | 'grass' | 'rock'
): void {
  const rx = Math.round(cx - drawW * 0.5);
  const ry = Math.round(baseY - drawH);

  // 1. Sombra proyectada y oclusión ambiental profunda en la base (contacto directo con el suelo)
  const contactColor =
    surface === 'sand'
      ? 'rgba(42, 24, 10, 0.68)'
      : surface === 'rock'
        ? 'rgba(8, 10, 14, 0.74)'
        : 'rgba(4, 18, 8, 0.70)';
  ctx.fillStyle = contactColor;
  ctx.beginPath();
  ctx.ellipse(cx, baseY, drawW * 0.48, Math.max(3.5, drawH * 0.13), 0, 0, Math.PI * 2);
  ctx.fill();

  // Núcleo de oclusión oscuro justo bajo la roca
  ctx.fillStyle =
    surface === 'sand'
      ? 'rgba(20, 10, 4, 0.78)'
      : surface === 'rock'
        ? 'rgba(4, 5, 8, 0.82)'
        : 'rgba(2, 8, 3, 0.80)';
  ctx.beginPath();
  ctx.ellipse(cx, baseY, drawW * 0.28, Math.max(2, drawH * 0.07), 0, 0, Math.PI * 2);
  ctx.fill();

  // Sombra proyectada difusa hacia el este-sureste
  ctx.fillStyle =
    surface === 'sand'
      ? 'rgba(92, 64, 30, 0.36)'
      : surface === 'rock'
        ? 'rgba(24, 28, 34, 0.36)'
        : 'rgba(16, 40, 20, 0.34)';
  ctx.beginPath();
  ctx.ellipse(
    Math.round(cx + drawW * 0.12),
    baseY - 1,
    drawW * 0.54,
    Math.max(3.8, drawH * 0.15),
    0.05,
    0,
    Math.PI * 2
  );
  ctx.fill();

  if (surface === 'sand') {
    // Cuenco cálido de arena hundida alrededor de la roca costera
    ctx.fillStyle = 'rgba(138, 98, 52, 0.32)';
    ctx.beginPath();
    ctx.ellipse(cx, baseY - 1, drawW * 0.58, Math.max(4.2, drawH * 0.18), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Sprite pixel-art recortado e iluminado de las hojas adjuntas
  const sprite = flip ? pair.flipped : pair.normal;
  ctx.drawImage(sprite, rx, ry, drawW, drawH);

  // 3. Integración frontal con el terreno (lenguas de arena, briznas de hierba o lascas minerales)
  if (surface === 'sand') {
    ctx.fillStyle = 'rgba(218, 184, 130, 0.76)';
    ctx.fillRect(rx + Math.round(drawW * 0.10), baseY - 2, Math.round(drawW * 0.36), 3);
    ctx.fillRect(rx + Math.round(drawW * 0.54), baseY - 1, Math.round(drawW * 0.30), 2);
    ctx.fillStyle = 'rgba(246, 222, 176, 0.54)';
    ctx.fillRect(rx + Math.round(drawW * 0.14), baseY - 2, Math.round(drawW * 0.22), 1);
  } else if (surface === 'grass') {
    const tufts = [-0.36, -0.14, 0.12, 0.34];
    for (let i = 0; i < tufts.length; i++) {
      const gx = Math.round(cx + drawW * tufts[i]);
      const gh = 3 + (i % 2);
      ctx.fillStyle = i % 2 === 0 ? '#2b6123' : '#3a7a2c';
      ctx.fillRect(gx - 1, baseY - gh + 1, 2, gh);
      ctx.fillStyle = '#7ec449';
      ctx.fillRect(gx, baseY - gh, 1, gh - 1);
    }
  } else {
    // Meseta de roca: esquirlas minerales y liquen en la junta basal
    ctx.fillStyle = 'rgba(92, 136, 68, 0.52)';
    ctx.fillRect(rx + Math.round(drawW * 0.18), baseY - 2, Math.max(4, Math.round(drawW * 0.18)), 2);
  }
}

function drawCoastalSeaRocks(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  vw: number,
  vh: number,
  elapsed: number,
  reducedMotion: boolean
): void {
  const atlas = ensureNatalRockAtlas();
  for (let i = 0; i < NATAL_SEA_ROCKS.length; i++) {
    const sr = NATAL_SEA_ROCKS[i];
    if (!isWorldBoxVisible(sr.x - 36, sr.y - 54, 72, 68, camX, camY, vw, vh)) continue;
    const pair = atlas[sr.kind];
    const dw = pair ? Math.max(16, Math.round(pair.w * sr.scale)) : 22;
    const dh = pair ? Math.max(16, Math.round(pair.h * sr.scale)) : 26;
    const rx = Math.round(sr.x - dw * 0.5);
    const ry = Math.round(sr.y - dh);

    // Sombra submarina sobre el arrecife turquesa
    ctx.fillStyle = 'rgba(6, 32, 48, 0.44)';
    ctx.beginPath();
    ctx.ellipse(sr.x + 2, sr.y + 1, dw * 0.62, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Anillo animado de espuma marina rompiendo contra el escollo
    const wave = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(elapsed * 2.1 + i * 1.7);
    const foamRx = dw * 0.58 + wave * 3.2;
    const foamRy = 4.2 + wave * 1.4;
    ctx.strokeStyle = `rgba(226, 255, 250, ${(0.36 + wave * 0.36).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(sr.x, sr.y - 1, foamRx, foamRy, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (pair) {
      const sprite = sr.flip ? pair.flipped : pair.normal;
      ctx.drawImage(sprite, rx, ry, dw, dh);
      // Franja húmeda oscura por la marea en la base sumergida
      ctx.fillStyle = 'rgba(14, 42, 52, 0.36)';
      ctx.fillRect(rx + 2, sr.y - 4, dw - 4, 3);
    } else {
      ctx.fillStyle = '#474c54';
      ctx.fillRect(rx + 3, ry + 4, dw - 6, dh - 4);
    }

    // Salpicadura frontal blanca de la rompiente
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.42 + wave * 0.38).toFixed(3)})`;
    ctx.fillRect(Math.round(sr.x - dw * 0.34), sr.y - 1, Math.max(4, Math.round(dw * 0.28)), 2);
    ctx.fillRect(Math.round(sr.x + dw * 0.08), sr.y, Math.max(3, Math.round(dw * 0.22)), 1);
  }
}

function drawScenicRock(
  ctx: CanvasRenderingContext2D,
  spec: (typeof NATAL_SCENIC_ROCKS)[number]
): void {
  const atlas = ensureNatalRockAtlas();
  const pair = atlas[spec.kind];
  if (!pair) return;
  const dw = Math.max(18, Math.round(pair.w * spec.scale));
  const dh = Math.max(16, Math.round(pair.h * spec.scale));
  const onRock = spec.x < 618 && spec.y < 548;
  const onMeadow = !onRock && isPointOnNatalMeadow(spec.x, spec.y);
  const surface: 'sand' | 'grass' | 'rock' = onRock ? 'rock' : onMeadow ? 'grass' : 'sand';
  drawGroundedRockSprite(ctx, pair, spec.x, spec.y, dw, dh, spec.flip, surface);
}

function drawBoulder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  seed: number
): void {
  const atlas = ensureNatalRockAtlas();
  const onRock = x < 590 && y < 544;
  const onMeadow = !onRock && isPointOnNatalMeadow(x, y);
  const surface: 'sand' | 'grass' | 'rock' = onRock ? 'rock' : onMeadow ? 'grass' : 'sand';

  // Selección determinista entre las rocas medianas de las 3 hojas según terreno y semilla
  const rockChoices: NatalRockSpriteKey[] =
    surface === 'sand'
      ? ['boulderStriated', 'cobbleMound', 'clusterFour', 'boulderWide']
      : surface === 'rock'
        ? ['meadowBoulder', 'pillarCluster', 'cairnStacked', 'cragPointed', 'cliffStepped']
        : ['meadowBoulder', 'boulderStriated', 'clusterFour'];

  const idx = Math.floor(hash2(x + 19, y - 31) * rockChoices.length) % rockChoices.length;
  const chosenKey = rockChoices[idx];
  const pair = atlas[chosenKey] ?? atlas.boulderStriated ?? atlas.boulderWide;
  const flip = hash2(x - 11, y + 23) > 0.52;

  if (pair) {
    const targetW =
      chosenKey === 'meadowBoulder'
        ? 34 + Math.round(seed * 10)
        : 28 + Math.round(seed * 12);
    const scale = targetW / Math.max(1, pair.w);
    const dw = Math.max(20, Math.round(pair.w * scale));
    const dh = Math.max(15, Math.round(pair.h * scale));
    drawGroundedRockSprite(ctx, pair, x, y + 2, dw, dh, flip, surface);
    return;
  }

  // Respaldo instantáneo durante el primer fotograma de carga asíncrona
  const w = 20 + Math.floor(seed * 10);
  const h = 14 + Math.floor(seed * 8);
  ctx.fillStyle = surface === 'sand' ? 'rgba(92, 64, 30, 0.32)' : 'rgba(24, 36, 28, 0.30)';
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 1, w * 0.55, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2d3138';
  ctx.fillRect(Math.round(x - w * 0.5) - 1, y - h - 1, w + 2, h + 2);
  ctx.fillStyle = '#868a92';
  ctx.fillRect(Math.round(x - w * 0.5), y - h, w, h);
}

/** Grandes peñascos que dan cuerpo a los bloqueos de la meseta y de la costa. */
function drawRockOutcrop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  solidId?: string
): void {
  const atlas = ensureNatalRockAtlas();
  const cx = Math.round(x + w * 0.5);
  const baseY = Math.round(y + h);
  const onRock = x < 590 && y < 544;
  const onMeadow = !onRock && isPointOnNatalMeadow(cx, baseY);
  const surface: 'sand' | 'grass' | 'rock' = onRock ? 'rock' : onMeadow ? 'grass' : 'sand';

  // Asignación específica según cada formación geológica de Isla Natal
  let mainKey: NatalRockSpriteKey = 'outcropTiered';
  let accentKey: NatalRockSpriteKey | null = null;
  let flipMain = seed > 0.5;
  let scaleBoost = 1.08;

  if (solidId === 'bolo-norte') {
    mainKey = 'basaltSpire';
    accentKey = 'outcropRidged';
    flipMain = false;
    scaleBoost = 1.12;
  } else if (solidId === 'bolo-este') {
    mainKey = 'sandstoneOutcrop';
    accentKey = 'cliffStepped';
    flipMain = false;
    scaleBoost = 1.12;
  } else if (solidId === 'bolo-meseta-sur') {
    mainKey = 'outcropTiered';
    accentKey = 'pebbleQuad';
    flipMain = true;
    scaleBoost = 1.08;
  } else if (solidId === 'roca-punta') {
    mainKey = 'coastalCluster';
    accentKey = 'pebbleTrio';
    flipMain = false;
    scaleBoost = 1.15;
  } else if (solidId === 'roca-ensenada') {
    mainKey = 'outcropColumnar';
    accentKey = 'cobbleMound';
    flipMain = false;
    scaleBoost = 1.14;
  } else if (surface === 'sand') {
    mainKey = 'coastalCluster';
  }

  const mainPair = atlas[mainKey] ?? atlas.outcropBlocky ?? atlas.coastalCluster;
  if (mainPair) {
    const dw = Math.round(w * scaleBoost);
    const dh = Math.max(Math.round(h * 1.02), Math.round(dw * (mainPair.h / Math.max(1, mainPair.w))));

    // Roca secundaria de apoyo integrada dentro de la huella del peñasco
    if (accentKey && atlas[accentKey]) {
      const acc = atlas[accentKey]!;
      const aw = Math.max(14, Math.round(w * (accentKey.startsWith('pebble') ? 0.36 : 0.48)));
      const ah = Math.max(10, Math.round(aw * (acc.h / Math.max(1, acc.w))));
      const side = solidId === 'bolo-norte' ? 1 : -1;
      drawGroundedRockSprite(
        ctx,
        acc,
        cx + side * Math.round(w * 0.28),
        baseY - 2,
        aw,
        ah,
        !flipMain,
        surface
      );
    }

    drawGroundedRockSprite(ctx, mainPair, cx, baseY + 1, dw, dh, flipMain, surface);
    return;
  }

  // Respaldo compacto durante la carga inicial
  ctx.fillStyle = surface === 'sand' ? 'rgba(92, 64, 30, 0.30)' : 'rgba(24, 36, 28, 0.28)';
  ctx.beginPath();
  ctx.ellipse(cx + 2, baseY + 1, w * 0.54, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2d3138';
  ctx.fillRect(Math.round(x), Math.round(y + h * 0.15), w, Math.round(h * 0.85));
  ctx.fillStyle = '#848890';
  ctx.fillRect(Math.round(x + 2), Math.round(y + h * 0.15 + 2), w - 4, Math.round(h * 0.85) - 4);
}

/** Tronco caído del claro: corteza, anillos y musgo húmedo. */
function drawFallenLog(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number
): void {
  const left = Math.round(x);
  const top = Math.round(y);
  const logH = Math.max(12, h - 6);

  ctx.fillStyle = 'rgba(24, 40, 26, 0.3)';
  ctx.beginPath();
  ctx.ellipse(left + w * 0.5, top + h + 1, w * 0.5, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sombra bajo el tronco.
  ctx.fillStyle = '#3e2816';
  ctx.fillRect(left, top + logH - 4, w, 5);

  // Cuerpo del tronco con vetas.
  ctx.fillStyle = '#6b4626';
  ctx.fillRect(left, top, w, logH);
  ctx.fillStyle = '#825833';
  ctx.fillRect(left, top + 1, w, logH - 6);
  ctx.fillStyle = '#9c6b3d';
  ctx.fillRect(left, top + 2, w, 3);
  ctx.fillStyle = 'rgba(255, 220, 170, 0.28)';
  ctx.fillRect(left + 2, top + 1, w - 6, 1);
  for (let px = left + 8; px < left + w - 6; px += 13) {
    const th = hash2(px + 3, top + seed * 100);
    ctx.fillStyle = 'rgba(74, 48, 26, 0.55)';
    ctx.fillRect(px, top + 3, 1 + Math.floor(th * 3), logH - 8);
    ctx.fillStyle = 'rgba(196, 142, 90, 0.4)';
    ctx.fillRect(px + 2, top + 5, 4 + Math.floor(th * 5), 1);
  }

  // Anillos del corte en el extremo oeste.
  ctx.fillStyle = '#c89a63';
  ctx.fillRect(left - 2, top + 2, 5, logH - 6);
  ctx.fillStyle = '#8a6238';
  ctx.fillRect(left - 1, top + 4, 1, logH - 10);
  ctx.fillStyle = '#6b4626';
  ctx.fillRect(left - 2, top + 2, 1, logH - 6);

  // Musgo sobre la corteza.
  ctx.fillStyle = '#5f9a52';
  ctx.fillRect(left + 6, top + 1, Math.floor(w * 0.22), 3);
  ctx.fillRect(left + w * 0.62, top + 2, Math.floor(w * 0.18), 2);
  ctx.fillStyle = '#86bd6e';
  ctx.fillRect(left + 8, top + 1, Math.floor(w * 0.1), 1);

  // Hongos y hojas al pie.
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(left + w * 0.28, top + logH - 1, 2, 3);
  ctx.fillStyle = '#d97706';
  ctx.fillRect(left + w * 0.28 - 1, top + logH - 2, 4, 2);
}

/* ------------------------------------------------------------------ */
/* CONSTRUCCIONES                                                     */
/* ------------------------------------------------------------------ */

function drawHut(ctx: CanvasRenderingContext2D, elapsed: number, reducedMotion: boolean): void {
  const { x, y } = HUT_POS;
  const s = ISLA_NATAL_SOLIDS.find((v) => v.id === 'cabana');
  const w = s ? s.w : 112;
  const h = s ? s.h : 94;
  const woodTiles = ensureNatalWoodTiles();
  const flicker = reducedMotion ? 0.85 : 0.78 + Math.sin(elapsed * 3.1) * 0.07;

  // Geometría en L inspirada en las cabañas artesanales de referencia:
  // - Ala oeste con tejado a dos aguas orientado norte-sur, hastial frontal de madera y tejadillo lateral.
  // - Cuerpo principal este con zócalo de piedra musgosa, planta alta entramada, buhardilla y porche con puerta arqueada.
  // - Leñera lateral al este con troncos apilados bajo alero inclinado.
  const baseY = y + h;
  const westWingX = x - 2;
  const westWingW = 44;
  const eastBodyX = x + 38;
  const eastBodyW = w - 34; // 78 px -> hasta x + 116

  // 1. Sombra de Oclusión Ambiental Profunda y Contact Shadow en la base
  ctx.fillStyle = 'rgba(6, 12, 8, 0.58)';
  ctx.beginPath();
  ctx.ellipse(x + w * 0.52 + 4, baseY + 3, w * 0.58 + 10, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(2, 6, 4, 0.72)';
  ctx.fillRect(x - 8, baseY - 2, w + 20, 4);

  // 3. Conexión de Caminos en las Puertas (Access Trail)
  // Tramo de tierra batida, barro y empedrado desde el umbral (doorX ≈ 662) hacia la plaza y sendero
  const trailX = x + w - 52;
  const trailW = 34;
  ctx.fillStyle = '#23170e'; // Base de tierra batida húmeda
  ctx.fillRect(trailX - 2, baseY - 2, trailW + 4, 20);
  ctx.fillStyle = '#856d50'; // Cuerpo de grava y arcilla
  ctx.fillRect(trailX, baseY, trailW, 18);
  // Pequeñas lajas y cantos rodados de paso
  ctx.fillStyle = '#a89882';
  ctx.fillRect(trailX + 3, baseY + 3, 7, 4);
  ctx.fillRect(trailX + 18, baseY + 7, 8, 4);
  ctx.fillRect(trailX + 9, baseY + 12, 6, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(trailX + 3, baseY + 7, 7, 1);
  ctx.fillRect(trailX + 18, baseY + 11, 8, 1);
  ctx.fillRect(trailX + 9, baseY + 16, 6, 1);

  // 4. Zócalo o Cimentación de Transición (Foundations)
  // Cimiento robusto de piedra de cantera que soporta la estructura
  ctx.fillStyle = '#14171a';
  ctx.fillRect(x - 6, baseY - 8, w + 16, 9);
  ctx.fillStyle = '#2a2e36';
  ctx.fillRect(x - 6, baseY - 8, w + 16, 7);
  ctx.fillStyle = '#4a4e58';
  ctx.fillRect(x - 6, baseY - 8, w + 16, 2);
  for (let i = 0; i < w + 12; i += 12) {
    const th = hash2(x + i * 7, baseY - 5);
    ctx.fillStyle = th > 0.5 ? '#3e424c' : '#23262d';
    ctx.fillRect(x - 4 + i, baseY - 7, 9, 5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x - 4 + i, baseY - 7, 7, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x - 4 + i, baseY - 3, 9, 1);
  }

  // 2. Cobertizo lateral izquierdo
  const shedLeftX = westWingX - 11;
  const shedLeftTop = y + 36;
  ctx.fillStyle = '#24170e';
  ctx.fillRect(shedLeftX + 1, shedLeftTop + 18, 11, baseY - (shedLeftTop + 18) - 2);
  // Poste de madera exterior y tornapunta
  ctx.fillStyle = '#3b2516';
  ctx.fillRect(shedLeftX + 1, shedLeftTop + 18, 4, baseY - (shedLeftTop + 18));
  ctx.fillStyle = '#7c5332';
  ctx.fillRect(shedLeftX + 2, shedLeftTop + 18, 1, baseY - (shedLeftTop + 20));
  // Faldón de tablones inclinados del cobertizo oeste
  for (let r = 0; r < 6; r++) {
    const ry = shedLeftTop + r * 4;
    ctx.fillStyle = r % 2 === 0 ? '#6e492b' : '#5d3d23';
    ctx.fillRect(shedLeftX - 1, ry, 13, 4);
    ctx.fillStyle = '#966840';
    ctx.fillRect(shedLeftX, ry, 11, 1);
    ctx.fillStyle = '#2b1a0f';
    ctx.fillRect(shedLeftX - 1, ry + 3, 13, 1);
  }

  // 3. Leñera cubierta adosada al muro este (troncos cortados apilados como en la referencia)
  const woodshedX = eastBodyX + eastBodyW - 2;
  const woodshedW = 15;
  const woodshedTop = y + 44;
  ctx.fillStyle = '#241810';
  ctx.fillRect(woodshedX, woodshedTop + 12, woodshedW, baseY - (woodshedTop + 12) - 2);
  ctx.fillStyle = '#3f2817';
  ctx.fillRect(woodshedX + woodshedW - 4, woodshedTop + 12, 4, baseY - (woodshedTop + 12) - 1);
  ctx.fillStyle = '#7d5432';
  ctx.fillRect(woodshedX + woodshedW - 3, woodshedTop + 12, 1, baseY - (woodshedTop + 14));
  // Troncos redondos apilados con anillos claros
  for (let row = 0; row < 4; row++) {
    const ly = baseY - 6 - row * 5;
    const cols = row === 3 ? 2 : 3;
    for (let col = 0; col < cols; col++) {
      const lx = woodshedX + 2 + col * 4 + (row % 2);
      ctx.fillStyle = '#4a2e19';
      ctx.fillRect(lx - 1, ly - 1, 4, 4);
      ctx.fillStyle = (row + col) % 2 === 0 ? '#cfa068' : '#b98850';
      ctx.fillRect(lx, ly, 3, 3);
      ctx.fillStyle = '#8a5d34';
      ctx.fillRect(lx + 1, ly + 1, 1, 1);
    }
  }
  // Tejadillo inclinado de la leñera
  for (let r = 0; r < 5; r++) {
    const ry = woodshedTop + r * 3;
    ctx.fillStyle = r % 2 === 0 ? '#784e2d' : '#633f23';
    ctx.fillRect(woodshedX - 1, ry, woodshedW + 3 - r, 3);
    ctx.fillStyle = '#a47247';
    ctx.fillRect(woodshedX, ry, woodshedW + 1 - r, 1);
  }

  // 4. Planta baja de mampostería de piedra rústica y sillares con musgo
  // Zócalo del ala oeste (más alto y sombreado, con escalera de madera apoyada)
  const westStoneTop = y + 58;
  ctx.fillStyle = '#2b2d28';
  ctx.fillRect(westWingX, westStoneTop, westWingW, baseY - westStoneTop);
  for (let py = westStoneTop + 2, row = 0; py < baseY - 2; py += 6, row++) {
    const odd = (row % 2) * 5;
    for (let px = westWingX + 2 + odd; px < westWingX + westWingW - 4; px += 11) {
      const th = hash2(px + 11, py - 3);
      ctx.fillStyle = th > 0.62 ? '#6e7568' : th > 0.28 ? '#585f54' : '#484f45';
      ctx.fillRect(px, py, 9, 5);
      ctx.fillStyle = 'rgba(188, 198, 176, 0.22)';
      ctx.fillRect(px, py, 7, 1);
      if (th < 0.24) {
        ctx.fillStyle = 'rgba(84, 128, 62, 0.45)';
        ctx.fillRect(px + 1, py + 3, 5, 2);
      }
    }
  }
  // Tornapuntas y postes del zócalo oeste + escalera de mano y leña baja
  ctx.fillStyle = '#3b2414';
  ctx.fillRect(westWingX, westStoneTop - 2, 5, baseY - westStoneTop + 2);
  ctx.fillRect(westWingX + westWingW - 5, westStoneTop - 2, 5, baseY - westStoneTop + 2);
  ctx.fillStyle = '#754d2d';
  ctx.fillRect(westWingX + 1, westStoneTop, 1, baseY - westStoneTop);
  // Escalera de madera apoyada en el zócalo oeste
  const ladX = westWingX + 10;
  ctx.fillStyle = '#2a180c';
  ctx.fillRect(ladX, westStoneTop + 3, 2, baseY - westStoneTop - 1);
  ctx.fillRect(ladX + 7, westStoneTop + 3, 2, baseY - westStoneTop - 1);
  ctx.fillStyle = '#8c5e37';
  ctx.fillRect(ladX, westStoneTop + 3, 1, baseY - westStoneTop - 2);
  ctx.fillRect(ladX + 7, westStoneTop + 3, 1, baseY - westStoneTop - 2);
  for (let ry = westStoneTop + 7; ry < baseY - 3; ry += 5) {
    ctx.fillStyle = '#6e4728';
    ctx.fillRect(ladX + 1, ry, 6, 2);
    ctx.fillStyle = '#b07d4f';
    ctx.fillRect(ladX + 1, ry, 6, 1);
  }

  // Planta baja de sillares cálidos y musgosos del cuerpo principal este
  const eastStoneTop = y + 52;
  ctx.fillStyle = '#332e27';
  ctx.fillRect(eastBodyX, eastStoneTop, eastBodyW, baseY - eastStoneTop);
  for (let py = eastStoneTop + 2, row = 0; py < baseY - 2; py += 6, row++) {
    const odd = (row % 2) * 6;
    for (let px = eastBodyX + 3 + odd; px < eastBodyX + eastBodyW - 5; px += 12) {
      const th = hash2(px + 19, py + 7);
      ctx.fillStyle = th > 0.66 ? '#9a9483' : th > 0.34 ? '#7f7a6c' : '#686559';
      ctx.fillRect(px, py, 10, 5);
      ctx.fillStyle = 'rgba(236, 228, 204, 0.26)';
      ctx.fillRect(px, py, 8, 1);
      ctx.fillStyle = 'rgba(30, 28, 22, 0.42)';
      ctx.fillRect(px, py + 4, 10, 1);
      if (py > baseY - 12 && th < 0.35) {
        ctx.fillStyle = 'rgba(82, 130, 58, 0.5)';
        ctx.fillRect(px + 1, py + 2, 6, 2);
      }
    }
  }

  // 5. Planta media de madera entramada y vigas vistas (usando textura adjunta de madera)
  // Caja saliente de troncos ensamblados en el ala oeste
  const westTimberTop = y + 32;
  const westTimberH = 27;
  ctx.fillStyle = '#2d1b0f';
  ctx.fillRect(westWingX - 2, westTimberTop, westWingW + 4, westTimberH);
  if (woodTiles.aged) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(westWingX + 2, westTimberTop + 2, westWingW - 4, westTimberH - 4);
    ctx.clip();
    const pat = ctx.createPattern(woodTiles.aged, 'repeat');
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(westWingX + 2, westTimberTop + 2, westWingW - 4, westTimberH - 4);
    }
    ctx.restore();
  } else {
    for (let py = westTimberTop + 2; py < westTimberTop + westTimberH - 2; py += 5) {
      ctx.fillStyle = py % 2 === 0 ? '#785030' : '#664226';
      ctx.fillRect(westWingX + 2, py, westWingW - 4, 4);
    }
  }
  // Cabezas de troncos ensamblados en las esquinas del ala oeste (como la foto 6)
  for (let py = westTimberTop + 1; py < westTimberTop + westTimberH - 2; py += 5) {
    for (const cx of [westWingX - 2, westWingX + westWingW - 3]) {
      ctx.fillStyle = '#2b190d';
      ctx.fillRect(cx, py, 5, 5);
      ctx.fillStyle = '#a9794c';
      ctx.fillRect(cx + 1, py + 1, 3, 3);
      ctx.fillStyle = '#6f4828';
      ctx.fillRect(cx + 2, py + 2, 1, 1);
    }
  }
  // Dos ventanucos acogedores en el ala oeste
  for (const wx of [westWingX + 7, westWingX + 25]) {
    const wy = westTimberTop + 7;
    ctx.fillStyle = '#26160c';
    ctx.fillRect(wx - 1, wy - 1, 11, 12);
    ctx.fillStyle = '#7c5230';
    ctx.fillRect(wx, wy, 9, 10);
    ctx.fillStyle = `rgba(255, 198, 112, ${(flicker * 0.86).toFixed(2)})`;
    ctx.fillRect(wx + 1, wy + 1, 7, 7);
    ctx.fillStyle = '#3b2414';
    ctx.fillRect(wx + 4, wy + 1, 1, 7);
    ctx.fillRect(wx + 1, wy + 4, 7, 1);
    ctx.fillStyle = '#9e6d43';
    ctx.fillRect(wx - 1, wy + 9, 11, 2);
  }

  // Entramado Tudor de estuco cálido y vigas de roble en la planta alta del cuerpo este (inspirado en foto 5)
  const eastTimberTop = y + 27;
  const eastTimberH = 26;
  ctx.fillStyle = '#311e11';
  ctx.fillRect(eastBodyX - 1, eastTimberTop, eastBodyW + 2, eastTimberH);
  // Paneles de estuco cálido envejecido
  const panelXs = [eastBodyX + 4, eastBodyX + 22, eastBodyX + 42, eastBodyX + 60];
  for (let i = 0; i < panelXs.length; i++) {
    const px = panelXs[i];
    const pw = i === 1 ? 16 : 14;
    ctx.fillStyle = '#d8c5a3';
    ctx.fillRect(px, eastTimberTop + 3, pw, eastTimberH - 6);
    ctx.fillStyle = 'rgba(176, 148, 108, 0.38)';
    ctx.fillRect(px, eastTimberTop + eastTimberH - 6, pw, 3);
    ctx.fillStyle = 'rgba(255, 246, 224, 0.45)';
    ctx.fillRect(px, eastTimberTop + 3, pw, 2);
  }
  // Viga maestra divisoria con cabezas talladas
  ctx.fillStyle = '#4a2e1a';
  ctx.fillRect(eastBodyX - 2, eastTimberTop + eastTimberH - 3, eastBodyW + 4, 4);
  ctx.fillStyle = '#8f6239';
  ctx.fillRect(eastBodyX - 1, eastTimberTop + eastTimberH - 3, eastBodyW + 2, 1);
  // Dos ventanas de madera con cuarterones iluminados en la planta alta este
  for (const wx of [eastBodyX + 14, eastBodyX + 51]) {
    const wy = eastTimberTop + 5;
    ctx.fillStyle = '#2a180d';
    ctx.fillRect(wx - 1, wy - 1, 13, 15);
    ctx.fillStyle = '#6f4828';
    ctx.fillRect(wx, wy, 11, 13);
    ctx.fillStyle = `rgba(255, 204, 118, ${(flicker * 0.92).toFixed(2)})`;
    ctx.fillRect(wx + 1, wy + 1, 9, 10);
    ctx.fillStyle = 'rgba(255, 242, 198, 0.55)';
    ctx.fillRect(wx + 2, wy + 2, 3, 3);
    ctx.fillStyle = '#3b2414';
    ctx.fillRect(wx + 5, wy + 1, 1, 10);
    ctx.fillRect(wx + 1, wy + 5, 9, 1);
    // Jardinera con flores bajo la ventana alta
    ctx.fillStyle = '#5c3b22';
    ctx.fillRect(wx - 1, wy + 12, 13, 3);
    ctx.fillStyle = '#3f8a41';
    ctx.fillRect(wx + 1, wy + 10, 9, 2);
    ctx.fillStyle = wx < eastBodyX + 30 ? '#f9a8d4' : '#fde68a';
    ctx.fillRect(wx + 2, wy + 9, 2, 2);
    ctx.fillRect(wx + 7, wy + 9, 2, 2);
  }

  // 6. Puerta principal arqueada de piedra y ventana baja con postigos en el cuerpo este
  // Coordenada exacta alineada con el POI 'puerta-cabana' (x ≈ 506, umbral en plaza-umbral-casa)
  const doorX = x + w - 46; // 496 (centro 508)
  const doorY = baseY - 33; // 755
  // Arco de dovelas de piedra alrededor de la puerta (como en las fotos 5 y 6)
  ctx.fillStyle = '#2a2620';
  ctx.fillRect(doorX - 4, doorY - 4, 28, 34);
  ctx.fillStyle = '#aba391';
  ctx.fillRect(doorX - 3, doorY - 2, 26, 32);
  ctx.fillRect(doorX - 1, doorY - 4, 22, 3);
  ctx.fillStyle = '#ded6c1';
  ctx.fillRect(doorX, doorY - 4, 20, 1);
  // Juntas radiales de las piedras del arco
  ctx.fillStyle = 'rgba(46, 40, 32, 0.55)';
  for (let sy = doorY + 3; sy < baseY - 3; sy += 6) {
    ctx.fillRect(doorX - 3, sy, 4, 1);
    ctx.fillRect(doorX + 19, sy, 4, 1);
  }
  ctx.fillRect(doorX + 9, doorY - 4, 1, 4);
  // Hoja de puerta de tablones verticales de roble con herrajes de hierro y aldaba
  ctx.fillStyle = '#301d10';
  ctx.fillRect(doorX + 1, doorY, 18, 30);
  ctx.fillStyle = '#6f4829';
  ctx.fillRect(doorX + 2, doorY + 1, 16, 28);
  ctx.fillStyle = '#8b5d36';
  ctx.fillRect(doorX + 3, doorY + 2, 14, 2);
  for (let px = doorX + 5; px < doorX + 17; px += 4) {
    ctx.fillStyle = 'rgba(42, 24, 12, 0.55)';
    ctx.fillRect(px, doorY + 2, 1, 27);
  }
  // Bisagras de forja y aldaba dorada
  ctx.fillStyle = '#272a30';
  ctx.fillRect(doorX + 2, doorY + 6, 8, 2);
  ctx.fillRect(doorX + 2, doorY + 21, 8, 2);
  ctx.fillStyle = '#e0ab2b';
  ctx.fillRect(doorX + 14, doorY + 14, 3, 3);
  ctx.fillStyle = '#fff3c4';
  ctx.fillRect(doorX + 14, doorY + 14, 1, 1);

  // Ventana baja oriental con arco de piedra y luz cálida interior
  const winLowX = doorX + 29;
  const winLowY = baseY - 24;
  ctx.fillStyle = '#aba391';
  ctx.fillRect(winLowX - 2, winLowY - 2, 14, 15);
  ctx.fillStyle = '#26170d';
  ctx.fillRect(winLowX, winLowY, 10, 11);
  ctx.fillStyle = `rgba(255, 196, 106, ${flicker.toFixed(2)})`;
  ctx.fillRect(winLowX + 1, winLowY + 1, 8, 9);
  ctx.fillStyle = '#3b2414';
  ctx.fillRect(winLowX + 5, winLowY + 1, 1, 9);
  ctx.fillRect(winLowX + 1, winLowY + 5, 8, 1);

  // Solera escalonada de piedra y tablones del porche que enlazan con el sendero
  ctx.fillStyle = 'rgba(28, 20, 12, 0.38)';
  ctx.fillRect(doorX - 5, baseY, 32, 5);
  ctx.fillStyle = '#c49d6c';
  ctx.fillRect(doorX - 4, baseY - 1, 30, 4);
  ctx.fillStyle = 'rgba(255, 242, 214, 0.5)';
  ctx.fillRect(doorX - 3, baseY - 1, 28, 1);

  // Barril de madera sobre caballete y macetas junto al porche (inspirado en foto 4 y 5)
  const brX = eastBodyX + 4;
  const brY = baseY - 13;
  ctx.fillStyle = 'rgba(20, 16, 10, 0.42)';
  ctx.fillRect(brX - 1, baseY - 2, 13, 3);
  ctx.fillStyle = '#4a2e1a';
  ctx.fillRect(brX, brY + 8, 11, 4);
  ctx.fillStyle = '#7c512f';
  ctx.fillRect(brX + 1, brY, 9, 9);
  ctx.fillStyle = '#9c6a40';
  ctx.fillRect(brX + 2, brY + 1, 7, 2);
  ctx.fillStyle = '#32363d';
  ctx.fillRect(brX + 1, brY + 2, 9, 1);
  ctx.fillRect(brX + 1, brY + 6, 9, 1);

  // Rótulo colgante artesanal «CASA» sobre soporte de madera junto a la puerta
  const signX = eastBodyX + 18;
  const signY = eastStoneTop + 4;
  ctx.fillStyle = '#3b2414';
  ctx.fillRect(signX - 8, signY, 18, 2);
  ctx.fillStyle = '#29180d';
  ctx.fillRect(signX - 7, signY + 3, 16, 11);
  ctx.fillStyle = '#b4834b';
  ctx.fillRect(signX - 6, signY + 4, 14, 9);
  ctx.fillStyle = '#d8ab72';
  ctx.fillRect(signX - 5, signY + 4, 12, 1);
  ctx.fillStyle = '#2c1a0d';
  ctx.font = '700 5px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CASA', signX + 1, signY + 10);
  ctx.textAlign = 'left';

  // Farolillo cálido junto al arco de entrada
  const lanternX = doorX + 23;
  const lanternY = doorY + 4;
  ctx.fillStyle = '#2b2b33';
  ctx.fillRect(lanternX - 1, lanternY - 3, 5, 2);
  ctx.fillStyle = `rgba(255, 202, 112, ${(0.72 + flicker * 0.22).toFixed(2)})`;
  ctx.fillRect(lanternX, lanternY - 1, 4, 5);
  ctx.fillStyle = '#fff3c4';
  ctx.fillRect(lanternX + 1, lanternY, 2, 3);
  if (!reducedMotion) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gl = ctx.createRadialGradient(lanternX + 2, lanternY + 2, 1, lanternX + 2, lanternY + 2, 24);
    gl.addColorStop(0, 'rgba(255, 198, 108, 0.30)');
    gl.addColorStop(1, 'rgba(255, 198, 108, 0)');
    ctx.fillStyle = gl;
    ctx.fillRect(lanternX - 22, lanternY - 22, 48, 48);
    ctx.restore();
  }

  // 7. CUBIERTAS DE TEJA Y PAJA EN L CON BUHARDILLA Y CHIMENEA DE PIEDRA
  // 7a. Tejado principal este de teja terracota artesanal (escalonado fila por fila como foto 4 y 5)
  const eastRoofTop = y - 10;
  const eastRoofBottom = eastTimberTop + 3;
  const eastRoofRows = Math.floor((eastRoofBottom - eastRoofTop) / 4);
  for (let r = 0; r <= eastRoofRows; r++) {
    const ry = eastRoofTop + r * 4;
    const flare = Math.round((r / Math.max(1, eastRoofRows)) * 5);
    const rx = eastBodyX - 4 - Math.round(flare * 0.4);
    const rw = eastBodyW + 10 + flare;
    ctx.fillStyle = '#381c12';
    ctx.fillRect(rx, ry, rw, 5);
    for (let tx = rx + 1, col = 0; tx < rx + rw - 2; tx += 5, col++) {
      const th = hash2(tx + r * 7, ry);
      const tileTone =
        th > 0.72 ? '#cf683e' : th > 0.34 ? '#b8532f' : '#9c4124';
      ctx.fillStyle = tileTone;
      ctx.fillRect(tx, ry, 4, 4);
      ctx.fillStyle = r < 3 || th > 0.6 ? 'rgba(255, 198, 146, 0.36)' : 'rgba(255, 178, 124, 0.20)';
      ctx.fillRect(tx, ry, 3, 1);
      ctx.fillStyle = 'rgba(54, 22, 12, 0.45)';
      ctx.fillRect(tx, ry + 3, 4, 1);
    }
  }
  // Cumbrera de madera tallada y remates del tejado este
  ctx.fillStyle = '#472818';
  ctx.fillRect(eastBodyX - 4, eastRoofTop - 3, eastBodyW + 10, 4);
  ctx.fillStyle = '#8f5934';
  ctx.fillRect(eastBodyX - 3, eastRoofTop - 2, eastBodyW + 8, 2);
  ctx.fillStyle = 'rgba(255, 226, 172, 0.35)';
  ctx.fillRect(eastBodyX - 2, eastRoofTop - 2, eastBodyW + 4, 1);

  // Buhardilla central con tejadillo a dos aguas sobre el faldón este (como foto 5)
  const dormCx = eastBodyX + 38;
  const dormTop = eastRoofTop + 5;
  const dormW = 22;
  // Muro de la buhardilla
  ctx.fillStyle = '#2d1a0e';
  ctx.fillRect(dormCx - 8, dormTop + 8, 16, 13);
  ctx.fillStyle = '#784e2d';
  ctx.fillRect(dormCx - 7, dormTop + 9, 14, 11);
  ctx.fillStyle = `rgba(255, 206, 122, ${(flicker * 0.9).toFixed(2)})`;
  ctx.fillRect(dormCx - 4, dormTop + 11, 8, 7);
  ctx.fillStyle = '#382112';
  ctx.fillRect(dormCx, dormTop + 11, 1, 7);
  ctx.fillRect(dormCx - 4, dormTop + 14, 8, 1);
  // Tejadillo triangular escalonado de la buhardilla
  for (let i = 0; i < 10; i++) {
    const hw = 2 + Math.round((i / 9) * (dormW * 0.5));
    ctx.fillStyle = i % 2 === 0 ? '#cc643b' : '#ad4b29';
    ctx.fillRect(dormCx - hw, dormTop + i, hw * 2, 2);
    ctx.fillStyle = '#422014';
    ctx.fillRect(dormCx - hw - 1, dormTop + i + 1, 1, 2);
    ctx.fillRect(dormCx + hw, dormTop + i + 1, 1, 2);
  }
  ctx.fillStyle = '#f2b885';
  ctx.fillRect(dormCx - 1, dormTop, 2, 9);

  // 7b. Ala oeste transversal con hastial triangular de madera verde-grisácea y cubierta a dos aguas (como foto 6 y 7)
  const gableCx = westWingX + Math.round(westWingW * 0.5); // x + 20
  const gablePeakY = y - 16;
  const gableEaveY = westTimberTop + 2;
  const gableHalfW = Math.round(westWingW * 0.5) + 5; // 27 px

  // Tímpano triangular de tablones verticales bajo el alero del hastial
  for (let gy = gablePeakY + 7; gy < gableEaveY; gy++) {
    const t = (gy - (gablePeakY + 7)) / Math.max(1, gableEaveY - (gablePeakY + 7));
    const hw = Math.max(2, Math.round(t * (gableHalfW - 4)));
    ctx.fillStyle = '#7d806b';
    ctx.fillRect(gableCx - hw, gy, hw * 2, 1);
  }
  for (let px = gableCx - gableHalfW + 5; px < gableCx + gableHalfW - 4; px += 4) {
    const dist = Math.abs(px - gableCx);
    const topY = Math.round(gablePeakY + 8 + (dist / (gableHalfW - 4)) * (gableEaveY - gablePeakY - 8));
    if (topY < gableEaveY) {
      ctx.fillStyle = 'rgba(38, 42, 32, 0.48)';
      ctx.fillRect(px, topY, 1, gableEaveY - topY);
    }
  }
  // Ventanuco romboidal de desván en el centro del hastial
  ctx.fillStyle = '#23170e';
  ctx.fillRect(gableCx - 2, gableEaveY - 12, 5, 5);
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(gableCx - 1, gableEaveY - 11, 3, 3);

  // Faldón izquierdo iluminado por el sol del oeste y faldón derecho con sombra sobre el encuentro en L
  for (let i = 0; i <= gableEaveY - gablePeakY; i++) {
    const t = i / Math.max(1, gableEaveY - gablePeakY);
    const span = Math.round(3 + t * gableHalfW);
    const ry = gablePeakY + i;
    // Sombra proyectada sobre el tejado este
    ctx.fillStyle = 'rgba(28, 14, 10, 0.28)';
    ctx.fillRect(gableCx + span, ry + 2, 4, 2);
    // Borde exterior de vigas cabrias
    ctx.fillStyle = '#3b2014';
    ctx.fillRect(gableCx - span - 1, ry, 4, 3);
    ctx.fillRect(gableCx + span - 3, ry, 4, 3);
    // Tejas soleadas al oeste y más profundas al este
    if (i < 7) {
      ctx.fillStyle = i % 3 === 0 ? '#dc7648' : '#bd5732';
      ctx.fillRect(gableCx - span + 1, ry, span * 2 - 2, 2);
    } else {
      ctx.fillStyle = '#e07b4c';
      ctx.fillRect(gableCx - span + 1, ry - 2, 5, 3);
      ctx.fillStyle = '#a84726';
      ctx.fillRect(gableCx + span - 6, ry - 2, 5, 3);
    }
  }
  // Remate central de madera en la cumbrera del ala oeste
  ctx.fillStyle = '#4a2b18';
  ctx.fillRect(gableCx - 2, gablePeakY - 3, 5, 11);
  ctx.fillStyle = '#a67144';
  ctx.fillRect(gableCx - 1, gablePeakY - 2, 2, 9);

  // 8. Chimenea robusta de sillares de piedra con humo suave en la cumbrera
  const chimX = eastBodyX + 10;
  const chimY = eastRoofTop - 13;
  ctx.fillStyle = '#2d2d2a';
  ctx.fillRect(chimX - 1, chimY, 15, 18);
  ctx.fillStyle = '#6f7368';
  ctx.fillRect(chimX, chimY + 1, 13, 16);
  ctx.fillStyle = '#969a8d';
  ctx.fillRect(chimX, chimY, 13, 3);
  ctx.fillStyle = '#464942';
  ctx.fillRect(chimX + 2, chimY + 1, 9, 2);
  ctx.fillRect(chimX, chimY + 7, 13, 1);
  ctx.fillRect(chimX, chimY + 12, 13, 1);
  ctx.fillRect(chimX + 6, chimY + 3, 1, 9);
  ctx.fillStyle = 'rgba(244, 238, 218, 0.35)';
  ctx.fillRect(chimX, chimY, 10, 1);
  if (!reducedMotion) {
    for (let i = 0; i < 6; i++) {
      const st = (elapsed * 0.26 + i / 6) % 1;
      const alpha = 0.28 * (1 - st);
      ctx.fillStyle = `rgba(232, 238, 244, ${alpha.toFixed(3)})`;
      const sx = chimX + 6 + Math.sin(st * 7 + i) * 8;
      const sy = chimY - 4 - st * 40;
      const size = 2 + Math.round(st * 5);
      ctx.fillRect(Math.round(sx), Math.round(sy), size, size - 1);
    }
  }

  // Enredadera y matas floridas que trepan desde la base para fundir los muros con la pradera
  const ivySpots = [eastBodyX + 2, eastBodyX + 39, woodshedX - 2, westWingX + westWingW - 4];
  for (let i = 0; i < ivySpots.length; i++) {
    const ix = ivySpots[i];
    ctx.fillStyle = '#2a5e24';
    ctx.fillRect(ix - 2, baseY - 6, 6, 6);
    ctx.fillRect(ix - 1, baseY - 12 - (i % 2) * 5, 4, 7);
    ctx.fillStyle = '#63ad3c';
    ctx.fillRect(ix - 1, baseY - 5, 4, 3);
    ctx.fillRect(ix, baseY - 11 - (i % 2) * 4, 2, 4);
  }

  // 2. Vegetación Superpuesta en la Base (Blending con el Pasto)
  // Mechones de césped y briznas de hierba que crecen por encima de los píxeles más bajos de la casa
  for (let bx = x - 10; bx <= x + w + 14; bx += 3) {
    // Saltamos el tramo del umbral de la puerta
    if (bx >= trailX + 2 && bx <= trailX + trailW - 2) continue;
    const bh = 3 + Math.floor(hash2(bx * 13, baseY + 7) * 5);
    const isTall = bh > 5;
    ctx.fillStyle = bx % 6 === 0 ? '#144d27' : '#22662c';
    ctx.fillRect(bx, baseY - bh, 2, bh + 1);

    if (isTall) {
      ctx.fillStyle = '#48b859';
      ctx.fillRect(bx, baseY - bh, 2, 2);
      ctx.fillStyle = '#86efac';
      ctx.fillRect(bx, baseY - bh, 1, 1);
    }

    if (hash2(bx * 19, x) > 0.62) {
      ctx.fillStyle = 'rgba(82, 130, 58, 0.85)';
      ctx.fillRect(bx - 1, baseY - 5, 4, 3);
    }
  }
}

function drawShed(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  arcadeState: ArcadeCabinetState,
  reducedMotion: boolean
): void {
  const s = ISLA_NATAL_SOLIDS.find((v) => v.id === 'cobertizo');
  const x = SHED_POS.x;
  const y = SHED_POS.y;
  const w = s ? s.w : 146;
  const h = s ? s.h : 122;
  const baseY = y + h;
  const lit = arcadeState !== 'dusty';
  const woodTiles = ensureNatalWoodTiles();

  // 1. Sombra de Oclusión Ambiental Profunda y Contact Shadow en la base
  ctx.fillStyle = 'rgba(6, 12, 8, 0.58)';
  ctx.beginPath();
  ctx.ellipse(x + w * 0.52 + 6, baseY + 3, w * 0.56 + 12, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(2, 6, 4, 0.72)';
  ctx.fillRect(x - 8, baseY - 2, w + 20, 4);

  // 3. Conexión de Caminos en las Puertas (Access Trails)
  // Extensión de tierra batida, barro y empedrado desde la entrada del porche hacia la plaza del arcade
  const trailShedX = x + 38;
  const trailShedW = w - 38;
  ctx.fillStyle = '#22160d'; // Tierra batida húmeda
  ctx.fillRect(trailShedX - 2, baseY - 2, trailShedW + 4, 18);
  ctx.fillStyle = '#7a6348'; // Grava y barro compactado
  ctx.fillRect(trailShedX, baseY, trailShedW, 16);
  // Piedras planas de acceso
  ctx.fillStyle = '#9e8c74';
  ctx.fillRect(trailShedX + 8, baseY + 4, 10, 4);
  ctx.fillRect(trailShedX + 34, baseY + 7, 12, 4);
  ctx.fillRect(trailShedX + 64, baseY + 3, 11, 4);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
  ctx.fillRect(trailShedX + 8, baseY + 7, 10, 1);
  ctx.fillRect(trailShedX + 34, baseY + 10, 12, 1);
  ctx.fillRect(trailShedX + 64, baseY + 6, 11, 1);

  // 4. Zócalo o Cimentación de Transición (Foundations)
  // Cimiento de piedra reforzada y vigas de madera
  ctx.fillStyle = '#14171a';
  ctx.fillRect(x - 4, baseY - 8, w + 12, 9);
  ctx.fillStyle = '#282b32';
  ctx.fillRect(x - 4, baseY - 8, w + 12, 7);
  ctx.fillStyle = '#424650';
  ctx.fillRect(x - 4, baseY - 8, w + 12, 2);
  for (let i = 0; i < w + 8; i += 12) {
    const th = hash2(x + i * 9, baseY - 6);
    ctx.fillStyle = th > 0.5 ? '#3b3e47' : '#22252c';
    ctx.fillRect(x - 2 + i, baseY - 7, 9, 5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x - 2 + i, baseY - 7, 7, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x - 2 + i, baseY - 3, 9, 1);
  }

  // Diseño arquitectónico mejorado de Cabaña-Taller del Bosque (inspirado en las fotos 6 y 7):
  // - Ala oeste cerrada de troncos y piedra musgosa con hastial agudo, ventanuco iluminado y banco exterior.
  // - Porche-taller oriental de vigas robustas abierto al frente para dejar visible e interactuable el gabinete PONG.
  const lodgeW = 54;
  const porchX = x + lodgeW - 4;
  const porchW = w - lodgeW + 4;

  // 1. Suelo de tablones envejecidos del porche-taller (con textura de madera adjunta)
  ctx.fillStyle = '#24170d';
  ctx.fillRect(porchX, baseY - 14, porchW, 14);
  if (woodTiles.weathered) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(porchX + 2, baseY - 13, porchW - 4, 11);
    ctx.clip();
    const pat = ctx.createPattern(woodTiles.weathered, 'repeat');
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(porchX + 2, baseY - 13, porchW - 4, 11);
    }
    ctx.restore();
  } else {
    ctx.fillStyle = '#6d4c2f';
    ctx.fillRect(porchX + 2, baseY - 13, porchW - 4, 11);
  }
  ctx.fillStyle = 'rgba(20, 14, 8, 0.45)';
  ctx.fillRect(porchX, baseY - 2, porchW, 2);

  // 2. Interior sombreado del porche-taller con pared trasera de madera y estanterías
  ctx.fillStyle = '#18110b';
  ctx.fillRect(porchX + 2, y + 26, porchW - 6, h - 38);
  if (woodTiles.aged) {
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.beginPath();
    ctx.rect(porchX + 4, y + 28, porchW - 10, h - 42);
    ctx.clip();
    const pat = ctx.createPattern(woodTiles.aged, 'repeat');
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(porchX + 4, y + 28, porchW - 10, h - 42);
    }
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(8, 10, 10, 0.52)';
  ctx.fillRect(porchX + 4, y + 28, porchW - 10, 20);
  // Estante de taller y herramientas colgadas al fondo
  ctx.fillStyle = '#4c3420';
  ctx.fillRect(porchX + 8, y + 50, 32, 3);
  ctx.fillStyle = '#9aa0a6';
  ctx.fillRect(porchX + 12, y + 45, 5, 5);
  ctx.fillStyle = '#d97706';
  ctx.fillRect(porchX + 21, y + 46, 6, 4);

  // 3. Cuerpo cerrado oeste del taller: zócalo de piedra musgosa + paredes de troncos + hastial
  const lodgeStoneTop = baseY - 30;
  ctx.fillStyle = '#2b2f29';
  ctx.fillRect(x, lodgeStoneTop, lodgeW, 30);
  for (let py = lodgeStoneTop + 2, row = 0; py < baseY - 2; py += 6, row++) {
    const odd = (row % 2) * 5;
    for (let px = x + 2 + odd; px < x + lodgeW - 4; px += 11) {
      const th = hash2(px + 7, py - 11);
      ctx.fillStyle = th > 0.6 ? '#6b7364' : th > 0.3 ? '#555d50' : '#454c41';
      ctx.fillRect(px, py, 9, 5);
      if (th < 0.34) {
        ctx.fillStyle = 'rgba(78, 128, 58, 0.52)';
        ctx.fillRect(px + 1, py + 2, 5, 2);
      }
    }
  }
  // Muro de troncos del cuerpo oeste
  const lodgeWallTop = y + 36;
  const lodgeWallH = lodgeStoneTop - lodgeWallTop;
  ctx.fillStyle = '#2a190e';
  ctx.fillRect(x - 1, lodgeWallTop, lodgeW + 2, lodgeWallH);
  if (woodTiles.warm) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 2, lodgeWallTop + 2, lodgeW - 4, lodgeWallH - 4);
    ctx.clip();
    const pat = ctx.createPattern(woodTiles.warm, 'repeat');
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(x + 2, lodgeWallTop + 2, lodgeW - 4, lodgeWallH - 4);
    }
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(26, 16, 8, 0.34)';
  ctx.fillRect(x + 2, lodgeWallTop + 2, lodgeW - 4, lodgeWallH - 4);
  // Cabezas de troncos en las esquinas del taller
  for (let py = lodgeWallTop + 2; py < lodgeStoneTop - 2; py += 6) {
    for (const cx of [x - 2, x + lodgeW - 3]) {
      ctx.fillStyle = '#26160b';
      ctx.fillRect(cx, py, 5, 5);
      ctx.fillStyle = '#9e6f44';
      ctx.fillRect(cx + 1, py + 1, 3, 3);
    }
  }
  // Ventana del taller con postigos verdes y resplandor ámbar/cian
  const swinX = x + 17;
  const swinY = lodgeWallTop + 13;
  ctx.fillStyle = '#23140b';
  ctx.fillRect(swinX - 2, swinY - 2, 20, 19);
  ctx.fillStyle = '#2d4f43';
  ctx.fillRect(swinX - 6, swinY - 1, 4, 17);
  ctx.fillRect(swinX + 18, swinY - 1, 4, 17);
  ctx.fillStyle = lit ? 'rgba(130, 236, 245, 0.78)' : 'rgba(232, 184, 106, 0.55)';
  ctx.fillRect(swinX, swinY, 16, 15);
  ctx.fillStyle = '#3b2414';
  ctx.fillRect(swinX + 7, swinY, 2, 15);
  ctx.fillRect(swinX, swinY + 7, 16, 2);
  // Mesa de carpintero y cajones junto al cuerpo oeste
  ctx.fillStyle = '#5c3d22';
  ctx.fillRect(x + 8, baseY - 18, 34, 16);
  ctx.fillStyle = '#8b5e36';
  ctx.fillRect(x + 7, baseY - 19, 36, 3);
  ctx.fillStyle = '#332011';
  ctx.fillRect(x + 11, baseY - 11, 28, 1);

  // 4. Gabinete de Pong (exactamente en CABINET_POS para preservar la interacción y cables)
  drawCabinet(ctx, elapsed, arcadeState, reducedMotion);

  // Cable que sale desde el gabinete hacia la espesura
  ctx.strokeStyle = '#2b2b33';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CABINET_POS.x + 14, CABINET_POS.y + 26);
  ctx.quadraticCurveTo(x + w - 4, baseY - 10, x + w + 16, baseY - 2);
  ctx.stroke();

  // Columnas delanteras de madera labrada y tornapuntas del porche-taller (sin tapar la pantalla de Pong)
  for (const postX of [porchX + 1, x + w - 8]) {
    ctx.fillStyle = '#2c1b0f';
    ctx.fillRect(postX, y + 26, 7, h - 26);
    ctx.fillStyle = '#7c5331';
    ctx.fillRect(postX + 1, y + 26, 3, h - 26);
    ctx.fillStyle = '#a47247';
    ctx.fillRect(postX + 1, y + 26, 1, h - 28);
    ctx.fillStyle = '#484d46';
    ctx.fillRect(postX - 1, baseY - 5, 9, 5);
  }
  // Viga frontal del porche y bombilla colgante
  ctx.fillStyle = '#382213';
  ctx.fillRect(porchX, y + 24, porchW + 2, 6);
  ctx.fillStyle = '#7d5432';
  ctx.fillRect(porchX + 1, y + 24, porchW, 2);

  ctx.fillStyle = '#2b2b33';
  ctx.fillRect(x + 88, y + 30, 1, 12);
  ctx.fillStyle = lit ? '#fef3c7' : '#8d8168';
  ctx.fillRect(x + 86, y + 41, 5, 5);
  if (lit && !reducedMotion) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x + 88, y + 44, 1, x + 88, y + 44, 28);
    g.addColorStop(0, 'rgba(255, 236, 160, 0.26)');
    g.addColorStop(1, 'rgba(255, 236, 160, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x + 60, y + 16, 56, 56);
    ctx.restore();
  }

  // 5. CUBIERTAS VERDE BOSQUE DE TEJAMANIL ESCALONADO (inspiradas en la foto 7)
  // 5a. Faldón horizontal sobre el porche-taller oriental
  const porchRoofTop = y - 2;
  const porchRoofBottom = y + 26;
  const pRows = Math.floor((porchRoofBottom - porchRoofTop) / 4);
  for (let r = 0; r <= pRows; r++) {
    const ry = porchRoofTop + r * 4;
    const rx = porchX - 2;
    const rw = porchW + 8;
    ctx.fillStyle = '#14261c';
    ctx.fillRect(rx, ry, rw, 5);
    for (let tx = rx + 1; tx < rx + rw - 2; tx += 5) {
      const th = hash2(tx + r * 13, ry - 5);
      ctx.fillStyle = th > 0.66 ? '#3a6b4c' : th > 0.3 ? '#2c563c' : '#21442f';
      ctx.fillRect(tx, ry, 4, 4);
      ctx.fillStyle = 'rgba(158, 214, 168, 0.24)';
      ctx.fillRect(tx, ry, 3, 1);
    }
  }
  ctx.fillStyle = '#3b2414';
  ctx.fillRect(porchX - 2, porchRoofTop - 2, porchW + 7, 3);
  // Festón tallado de madera clara bajo el alero del porche (guiño a la foto 7)
  ctx.fillStyle = '#cbb793';
  for (let sx = porchX + 2; sx < porchX + porchW + 2; sx += 4) {
    ctx.fillRect(sx, porchRoofBottom, 2, 2);
  }

  // 5b. Gran hastial agudo oeste con tejamanil verde bosque y moldura de madera
  const sGableCx = x + Math.round(lodgeW * 0.5);
  const sPeakY = y - 14;
  const sEaveY = lodgeWallTop + 2;
  const sHalfW = Math.round(lodgeW * 0.5) + 6;
  for (let gy = sPeakY + 7; gy < sEaveY; gy++) {
    const t = (gy - (sPeakY + 7)) / Math.max(1, sEaveY - (sPeakY + 7));
    const hw = Math.max(2, Math.round(t * (sHalfW - 4)));
    ctx.fillStyle = '#9b8c72';
    ctx.fillRect(sGableCx - hw, gy, hw * 2, 1);
  }
  // Ventana geminada de buhardilla en el hastial del taller (como foto 7)
  ctx.fillStyle = '#23160d';
  ctx.fillRect(sGableCx - 6, sEaveY - 16, 12, 10);
  ctx.fillStyle = '#cbb793';
  ctx.fillRect(sGableCx - 5, sEaveY - 15, 10, 8);
  ctx.fillStyle = '#283834';
  ctx.fillRect(sGableCx - 4, sEaveY - 14, 3, 6);
  ctx.fillRect(sGableCx + 1, sEaveY - 14, 3, 6);

  for (let i = 0; i <= sEaveY - sPeakY; i++) {
    const t = i / Math.max(1, sEaveY - sPeakY);
    const span = Math.round(3 + t * sHalfW);
    const ry = sPeakY + i;
    ctx.fillStyle = 'rgba(10, 20, 14, 0.32)';
    ctx.fillRect(sGableCx + span, ry + 2, 4, 2);
    ctx.fillStyle = '#182e22';
    ctx.fillRect(sGableCx - span - 1, ry, 5, 3);
    ctx.fillRect(sGableCx + span - 4, ry, 5, 3);
    ctx.fillStyle = i % 2 === 0 ? '#3f7352' : '#2d593e';
    ctx.fillRect(sGableCx - span + 1, ry, 4, 2);
    ctx.fillStyle = '#234731';
    ctx.fillRect(sGableCx + span - 4, ry, 3, 2);
    // Moldura clara festoneada bajo las vigas del hastial
    if (i > 5 && i % 3 === 0) {
      ctx.fillStyle = '#d4c3a3';
      ctx.fillRect(sGableCx - span + 3, ry + 2, 2, 1);
      ctx.fillRect(sGableCx + span - 5, ry + 2, 2, 1);
    }
  }
  // Musgo silvestre sobre las tejas del bosque
  ctx.fillStyle = 'rgba(116, 178, 78, 0.45)';
  ctx.fillRect(porchX + 18, porchRoofTop + 6, 9, 2);
  ctx.fillRect(porchX + 56, porchRoofTop + 14, 11, 2);

  // 2. Vegetación Superpuesta en la Base (Blending con el Pasto)
  // Mechones de césped y briznas de hierba que crecen por encima de los píxeles más bajos del cobertizo
  for (let bx = x - 8; bx <= x + w + 12; bx += 3) {
    // Saltamos el tramo principal del acceso al taller
    if (bx >= trailShedX + 10 && bx <= trailShedX + trailShedW - 10) continue;
    const bh = 3 + Math.floor(hash2(bx * 17, baseY + 11) * 5);
    const isTall = bh > 5;
    ctx.fillStyle = bx % 6 === 0 ? '#144d27' : '#22662c';
    ctx.fillRect(bx, baseY - bh, 2, bh + 1);

    if (isTall) {
      ctx.fillStyle = '#48b859';
      ctx.fillRect(bx, baseY - bh, 2, 2);
      ctx.fillStyle = '#86efac';
      ctx.fillRect(bx, baseY - bh, 1, 1);
    }

    if (hash2(bx * 23, x) > 0.62) {
      ctx.fillStyle = 'rgba(82, 130, 58, 0.85)';
      ctx.fillRect(bx - 1, baseY - 5, 4, 3);
    }
  }
}

function drawCabinet(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  arcadeState: ArcadeCabinetState,
  reducedMotion: boolean
): void {
  const x = CABINET_POS.x - 18;
  const y = CABINET_POS.y - 40;
  const lit = arcadeState !== 'dusty';

  // Sombra del gabinete.
  ctx.fillStyle = 'rgba(10, 16, 10, 0.4)';
  ctx.fillRect(x - 3, y + 62, 42, 5);

  // Cuerpo con moldura, vetas y laterales de madera.
  ctx.fillStyle = '#2c2114';
  ctx.fillRect(x - 2, y + 2, 40, 63);
  ctx.fillStyle = lit ? '#d9a521' : '#8f7233';
  ctx.fillRect(x, y + 4, 36, 59);
  ctx.fillStyle = lit ? '#f0bf3c' : '#a8893f';
  ctx.fillRect(x + 2, y + 6, 32, 9);
  ctx.fillStyle = 'rgba(60, 40, 12, 0.5)';
  ctx.fillRect(x, y + 52, 36, 11);
  ctx.fillStyle = 'rgba(92, 60, 20, 0.55)';
  ctx.fillRect(x + 1, y + 8, 2, 44);
  ctx.fillRect(x + 33, y + 8, 2, 44);
  // Vetas laterales.
  ctx.fillStyle = 'rgba(255, 226, 150, 0.16)';
  for (let py = y + 10; py < y + 50; py += 8) {
    ctx.fillRect(x + 1, py, 1, 4);
    ctx.fillRect(x + 34, py + 3, 1, 3);
  }
  // T-molding.
  ctx.fillStyle = '#1c1a16';
  ctx.fillRect(x - 2, y + 2, 40, 2);
  ctx.fillRect(x - 2, y + 60, 40, 2);

  // Marquesina con bisel y brillo.
  ctx.fillStyle = '#1c1a16';
  ctx.fillRect(x + 2, y - 6, 32, 12);
  ctx.fillStyle = lit ? '#0d2136' : '#2a2118';
  ctx.fillRect(x + 3, y - 5, 30, 10);
  ctx.fillStyle = lit ? '#fef3c7' : '#8d8168';
  ctx.font = '700 7px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('PONG', x + 18, y + 3);
  if (lit) {
    ctx.fillStyle = 'rgba(254, 243, 199, 0.22)';
    ctx.fillRect(x + 4, y - 4, 28, 1);
  }

  // Pantalla con marco, bisel interior y reflejos.
  const sx = x + 5;
  const sy = y + 16;
  const sw = 26;
  const sh = 22;
  ctx.fillStyle = '#1c1a16';
  ctx.fillRect(sx - 2, sy - 2, sw + 4, sh + 4);
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(sx - 1, sy - 1, sw + 2, sh + 2);

  if (!lit) {
    ctx.fillStyle = 'rgba(190, 200, 210, 0.14)';
    ctx.fillRect(sx + 2, sy + 2, sw - 8, 3);
    ctx.fillStyle = 'rgba(120, 130, 140, 0.2)';
    ctx.fillRect(sx + 4, sy + sh - 6, 10, 2);
    ctx.fillStyle = 'rgba(120, 130, 140, 0.16)';
    ctx.fillRect(sx + 15, sy + 6, 4, 8);
  } else if (arcadeState === 'powered') {
    ctx.fillStyle = '#0d2136';
    ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = 'rgba(0, 243, 255, 0.12)';
    ctx.fillRect(sx, sy, sw, sh);
    const bounce = reducedMotion
      ? sh / 2
      : sh / 2 + Math.sin(elapsed * 2.6) * (sh / 2 - 4);
    ctx.fillStyle = '#e8fbff';
    ctx.fillRect(sx + 3, sy + sh / 2 - 4, 2, 8);
    ctx.fillRect(sx + sw - 5, sy + sh / 2 - 4, 2, 8);
    ctx.fillRect(sx + sw / 2 - 1 + Math.round(Math.sin(elapsed * 1.7) * 6), sy + bounce - 1, 2, 2);
    // Líneas de barrido del tubo.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    for (let ly = sy; ly < sy + sh; ly += 3) ctx.fillRect(sx, ly, sw, 1);
  } else {
    for (let i = 0; i < sh; i += 2) {
      const n = hash2(Math.floor(elapsed * 12) + i, i);
      ctx.fillStyle = n > 0.72 ? 'rgba(232, 251, 255, 0.9)' : 'rgba(20, 60, 80, 0.8)';
      ctx.fillRect(sx, sy + i, sw, 1 + Math.floor(n));
    }
    ctx.fillStyle = '#39ff14';
    ctx.font = '700 7px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('3-0', sx + sw / 2, sy + sh / 2 + 2);
  }
  // Reflejo de pantalla.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(sx + 2, sy + 2, 8, 2);
  ctx.fillRect(sx + 2, sy + 5, 4, 8);

  // Panel de control con dos perillas, monedero y ranura.
  ctx.fillStyle = '#2b2116';
  ctx.fillRect(x + 4, y + 41, 28, 10);
  ctx.fillStyle = 'rgba(255, 226, 150, 0.12)';
  ctx.fillRect(x + 4, y + 41, 28, 1);
  const knob = (kx: number) => {
    ctx.fillStyle = '#0f0d0a';
    ctx.fillRect(kx - 2, y + 44, 5, 5);
    ctx.fillStyle = lit ? '#f8fafc' : '#6b7280';
    ctx.fillRect(kx - 1, y + 45, 3, 3);
    ctx.fillStyle = lit ? '#fbbf24' : '#6b5a2a';
    ctx.fillRect(kx, y + 45, 1, 2);
  };
  knob(x + 9);
  knob(x + 27);
  ctx.fillStyle = lit ? '#fbbf24' : '#6b5a2a';
  ctx.fillRect(x + 16, y + 54, 4, 3);
  ctx.fillStyle = '#0f0d0a';
  ctx.fillRect(x + 17, y + 54, 2, 1);
  // Rejilla inferior.
  ctx.fillStyle = 'rgba(20, 16, 10, 0.5)';
  for (let px = x + 6; px < x + 30; px += 4) {
    ctx.fillRect(px, y + 58, 2, 2);
  }

  if (lit) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = reducedMotion ? 0.5 : 0.42 + Math.sin(elapsed * 2.2) * 0.1;
    const g = ctx.createRadialGradient(sx + sw / 2, sy + sh / 2, 2, sx + sw / 2, sy + sh / 2, 66);
    g.addColorStop(0, `rgba(0, 243, 255, ${(0.34 * pulse * 2).toFixed(3)})`);
    g.addColorStop(0.45, `rgba(0, 243, 255, ${(0.1 * pulse * 2).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0, 243, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - 64, sy - 64, sw + 128, sh + 128);
    ctx.restore();
  }
}

function drawSignWithContext(ctx: CanvasRenderingContext2D, sx: number, sy: number): void {
  const onMeadow = isPointOnNatalMeadow(sx, sy);
  const signOnSand = !onMeadow && !(sx < 590 && sy < 544);

  // Sombra de contacto suave (Ground AO)
  ctx.fillStyle = onMeadow ? 'rgba(8, 32, 12, 0.42)' : 'rgba(104, 72, 36, 0.38)';
  ctx.beginPath();
  ctx.ellipse(sx + 2, sy + 1, 12, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  if (signOnSand) {
    // Montículo de arena compactada abrazando el poste del cartel playero
    ctx.fillStyle = 'rgba(220, 186, 132, 0.76)';
    ctx.fillRect(sx - 5, sy - 1, 10, 2);
    ctx.fillStyle = 'rgba(246, 222, 176, 0.52)';
    ctx.fillRect(sx - 4, sy - 1, 5, 1);
  } else if (onMeadow) {
    // Detalle de briznas de hierba abrazando los postes
    ctx.fillStyle = '#1d6b38';
    ctx.fillRect(sx - 11, sy - 2, 2, 3);
    ctx.fillRect(sx - 8, sy - 3, 2, 4);
    ctx.fillRect(sx + 4, sy - 2, 2, 3);
    ctx.fillRect(sx + 9, sy - 3, 2, 4);
    ctx.fillStyle = '#3aa250';
    ctx.fillRect(sx - 10, sy - 2, 1, 2);
    ctx.fillRect(sx + 5, sy - 2, 1, 2);
  }

  drawGbcWoodenSign(ctx, sx, sy);
}

function drawSign(ctx: CanvasRenderingContext2D): void {
  drawSignWithContext(ctx, SIGN_POS.x, SIGN_POS.y);
}

function drawNet(ctx: CanvasRenderingContext2D, elapsed: number): void {
  const { x, y } = NET_POS;
  // Depresión húmeda en la arena donde descansa la red tendida al sol
  ctx.fillStyle = 'rgba(116, 82, 42, 0.36)';
  ctx.beginPath();
  ctx.ellipse(x + 1, y + 1, 25, 9.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(148, 110, 62, 0.38)';
  ctx.fillRect(x - 21, y - 7, 42, 14);
  ctx.strokeStyle = '#a8bdb0';
  ctx.lineWidth = 1;
  for (let i = -20; i <= 20; i += 5) {
    ctx.beginPath();
    ctx.moveTo(x + i, y - 8);
    ctx.lineTo(x + i + 3, y + 8);
    ctx.stroke();
  }
  for (let j = -6; j <= 6; j += 4) {
    ctx.beginPath();
    ctx.moveTo(x - 22, y + j + Math.sin(elapsed * 1.4 + j) * 0.6);
    ctx.lineTo(x + 22, y + j);
    ctx.stroke();
  }
  // Remiendo de hilo cian imposible
  ctx.strokeStyle = '#22d3ee';
  ctx.beginPath();
  ctx.moveTo(x + 8, y - 6);
  ctx.lineTo(x + 16, y + 2);
  ctx.lineTo(x + 9, y + 6);
  ctx.stroke();
  // Flotadores de corcho naranja con sombra en la arena
  ctx.fillStyle = 'rgba(92, 64, 30, 0.42)';
  ctx.fillRect(x - 20, y - 8, 4, 2);
  ctx.fillRect(x + 18, y - 8, 4, 2);
  ctx.fillStyle = '#f97316';
  ctx.fillRect(x - 20, y - 10, 3, 3);
  ctx.fillRect(x + 18, y - 10, 3, 3);
  // Lenguas finas de arena sobre los bordes inferiores de la red
  ctx.fillStyle = 'rgba(222, 188, 134, 0.68)';
  ctx.fillRect(x - 19, y + 6, 8, 2);
  ctx.fillRect(x + 6, y + 7, 9, 2);
  ctx.fillStyle = 'rgba(246, 222, 176, 0.48)';
  ctx.fillRect(x - 17, y + 6, 5, 1);
}

/**
 * Grúa de construcción de madera del Alto de las Rocas (inspirada en imagen cb8dbff3).
 */
function drawNatalHighlandCrane(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  elapsed: number,
  reducedMotion: boolean
): void {
  const sway = reducedMotion ? 0 : Math.sin(elapsed * 0.8) * 0.02;
  const totalAngle = angle + sway;
  
  ctx.save();
  ctx.translate(cx, cy);
  
  // Base de piedra y cimentación
  ctx.fillStyle = 'rgba(20, 15, 10, 0.4)';
  ctx.fillRect(-10, -2, 20, 4);
  ctx.fillStyle = '#4a4e58';
  ctx.fillRect(-8, -12, 16, 10);
  ctx.fillStyle = '#6e7568';
  ctx.fillRect(-7, -11, 14, 8);

  // Mástil vertical de troncos
  ctx.fillStyle = '#2d1b0e';
  ctx.fillRect(-3, -42, 6, 30);
  ctx.fillStyle = '#6e4828';
  ctx.fillRect(-2, -41, 4, 29);
  
  // Brazo giratorio (Pluma)
  ctx.save();
  ctx.translate(0, -38);
  ctx.rotate(totalAngle);
  
  // Madera del brazo
  ctx.fillStyle = '#3b2514';
  ctx.fillRect(-6, -2, 48, 4);
  ctx.fillStyle = '#8c623a';
  ctx.fillRect(-5, -1, 46, 2);
  
  // Poleas y cuerdas
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(38, 0, 3, 4);
  ctx.strokeStyle = '#c8aa78';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, 3);
  const ropeLen = 22 + Math.sin(elapsed * 1.2) * 2;
  ctx.lineTo(40, ropeLen);
  ctx.stroke();
  
  // Carga (Cajón o Troncos suspendidos)
  ctx.fillStyle = '#5c3a21';
  ctx.fillRect(35, ropeLen, 10, 10);
  ctx.fillStyle = '#7d5330';
  ctx.fillRect(36, ropeLen + 1, 8, 8);
  
  ctx.restore();
  
  // Contrapeso posterior
  ctx.fillStyle = '#2d2d2a';
  ctx.fillRect(-12, -40, 8, 8);
  ctx.fillStyle = '#6f7368';
  ctx.fillRect(-11, -39, 6, 6);

  ctx.restore();
}

/**
 * Atrezo de obra y materiales en la meseta del Alto de las Rocas.
 */
function drawNatalConstructionProps(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: 'wood_pile' | 'crates' | 'barrels'
): void {
  ctx.save();
  ctx.translate(x, y);
  
  if (type === 'wood_pile') {
    // Sombra
    ctx.fillStyle = 'rgba(20, 10, 5, 0.35)';
    ctx.fillRect(-2, 10, 32, 6);
    // Troncos apilados
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5 - r; c++) {
        const lx = c * 6 + r * 3;
        const ly = 12 - r * 5;
        ctx.fillStyle = '#4a2e19';
        ctx.fillRect(lx, ly, 7, 5);
        ctx.fillStyle = '#8b5d36';
        ctx.fillRect(lx + 1, ly + 1, 5, 3);
        ctx.fillStyle = '#cfa068';
        ctx.fillRect(lx + 5, ly + 1, 1, 3);
      }
    }
  } else if (type === 'crates') {
    // Sombra
    ctx.fillStyle = 'rgba(20, 10, 5, 0.35)';
    ctx.fillRect(-2, 8, 22, 5);
    // Cajones amontonados
    ctx.fillStyle = '#3b2514';
    ctx.fillRect(0, 0, 12, 12);
    ctx.fillRect(10, 2, 10, 10);
    ctx.fillRect(4, -8, 11, 11);
    ctx.fillStyle = '#7d5330';
    ctx.fillRect(1, 1, 10, 10);
    ctx.fillRect(11, 3, 8, 8);
    ctx.fillRect(5, -7, 9, 9);
  } else if (type === 'barrels') {
    // Barriles cinchados
    for (let i = 0; i < 3; i++) {
        const bx = i * 11;
        const by = (i % 2) * 3;
        ctx.fillStyle = 'rgba(20, 10, 5, 0.35)';
        ctx.fillRect(bx - 1, by + 10, 12, 4);
        ctx.fillStyle = '#2b1a0d';
        ctx.fillRect(bx, by, 10, 13);
        ctx.fillStyle = '#6e4626';
        ctx.fillRect(bx + 1, by + 1, 8, 11);
        ctx.fillStyle = '#374151';
        ctx.fillRect(bx, by + 3, 10, 2);
        ctx.fillRect(bx, by + 9, 10, 2);
    }
  }

  ctx.restore();
}

function drawShellCluster(ctx: CanvasRenderingContext2D, elapsed: number): void {
  const { x, y } = SHELLS_POI_POS;
  // Pequeña hondonada de arena removida alrededor de las caracolas
  ctx.fillStyle = 'rgba(116, 82, 42, 0.30)';
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 3; i++) {
    const sx = x - 10 + i * 9;
    const sy = y - 2 + (i % 2);
    ctx.fillStyle = 'rgba(96, 66, 32, 0.36)';
    ctx.fillRect(sx, sy + 3, 6, 2);
    ctx.fillStyle = i % 2 === 0 ? '#f8cde4' : '#fbe4c8';
    ctx.fillRect(sx, sy, 5, 4);
    ctx.fillStyle = 'rgba(182, 118, 138, 0.65)';
    ctx.fillRect(sx + 1, sy, 1, 4);
    ctx.fillStyle = 'rgba(224, 190, 136, 0.58)';
    ctx.fillRect(sx - 1, sy + 3, 3, 1);
  }
  // Cangrejo que recoloca y huye dejando leve rastro en la arena
  const scuttle = (Math.sin(elapsed * 0.9) + 1) / 2;
  const cx = x + 16 + scuttle * 14;
  const cy = y + 8 - scuttle * 3;
  ctx.fillStyle = 'rgba(132, 94, 48, 0.28)';
  ctx.fillRect(x + 15, y + 8, Math.max(2, Math.round(scuttle * 14)), 1);
  ctx.fillStyle = 'rgba(92, 62, 28, 0.36)';
  ctx.fillRect(cx - 3, cy + 2, 7, 1);
  ctx.fillStyle = '#f4763c';
  ctx.fillRect(cx - 3, cy - 2, 6, 4);
  ctx.fillRect(cx - 5, cy - 1, 2, 2);
  ctx.fillRect(cx + 3, cy - 1, 2, 2);
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(cx - 2, cy - 3, 1, 1);
  ctx.fillRect(cx + 1, cy - 3, 1, 1);
}

function drawMailbox(ctx: CanvasRenderingContext2D): void {
  const { x, y } = MAILBOX_POS;
  ctx.fillStyle = 'rgba(24, 44, 28, 0.3)';
  ctx.fillRect(x + 1, y, 12, 3);
  ctx.fillStyle = '#6b4a2a';
  ctx.fillRect(x, y - 18, 3, 19);
  ctx.fillStyle = '#8b95a5';
  ctx.fillRect(x - 7, y - 30, 18, 13);
  ctx.fillStyle = '#a8b2c1';
  ctx.fillRect(x - 7, y - 30, 18, 4);
  ctx.fillStyle = '#3f4a5a';
  ctx.fillRect(x - 4, y - 24, 12, 2);
  // Postal asomando
  ctx.fillStyle = '#f8f5e6';
  ctx.fillRect(x - 2, y - 27, 8, 5);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(x - 1, y - 26, 6, 1);
}

/**
 * Mirador del Alto de las Rocas: tarima de tablones, baranda y catalejo de latón
 * apuntando hacia adelante, sobre el horizonte donde duerme la Isla del Origen.
 */
function drawAltoMirador(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  reducedMotion: boolean
): void {
  const { x, y } = MIRADOR_POS;
  const glint = reducedMotion ? 0.55 : 0.35 + (Math.sin(elapsed * 1.7) + 1) * 0.18;
  const rockAtlas = ensureNatalRockAtlas();

  // Basamento de losas de piedra agrietada (hoja 3) que asienta el mirador sobre la cresta
  ctx.fillStyle = 'rgba(14, 20, 26, 0.36)';
  ctx.fillRect(x - 64, y - 1, 128, 10);
  if (rockAtlas.ledgeCracked) {
    ctx.drawImage(rockAtlas.ledgeCracked.normal, x - 64, y - 6, 46, 14);
    ctx.drawImage(rockAtlas.ledgeCracked.flipped, x - 22, y - 6, 44, 14);
    ctx.drawImage(rockAtlas.ledgeCracked.normal, x + 18, y - 6, 46, 14);
  }

  // Tarima de tablones.
  ctx.fillStyle = '#3a2413';
  ctx.fillRect(x - 62, y - 8, 124, 10);
  ctx.fillStyle = '#7a4f2a';
  ctx.fillRect(x - 62, y - 10, 124, 5);
  ctx.fillStyle = '#9a6a3c';
  ctx.fillRect(x - 62, y - 10, 124, 1);
  for (let i = -56; i <= 56; i += 12) {
    ctx.fillStyle = 'rgba(36, 20, 8, 0.45)';
    ctx.fillRect(x + i, y - 5, 1, 7);
  }

  // Postes y doble baranda de madera.
  for (const px of [x - 58, x - 4, x + 50]) {
    ctx.fillStyle = '#4a2c16';
    ctx.fillRect(px, y - 33, 6, 25);
    ctx.fillStyle = '#8a5a30';
    ctx.fillRect(px, y - 33, 2, 25);
    ctx.fillStyle = '#c9a06a';
    ctx.fillRect(px, y - 34, 6, 2);
  }
  ctx.fillStyle = '#5c3a1f';
  ctx.fillRect(x - 60, y - 31, 120, 4);
  ctx.fillRect(x - 60, y - 18, 120, 3);
  ctx.fillStyle = '#a8743f';
  ctx.fillRect(x - 60, y - 32, 120, 2);
  ctx.fillStyle = `rgba(255, 214, 150, ${glint.toFixed(2)})`;
  ctx.fillRect(x - 60, y - 32, 120, 1);

  // Catalejo de latón sobre trípode, apuntando al horizonte (arriba).
  const tx = x - 8;
  const ty = y - 24;
  ctx.fillStyle = '#1c120a';
  ctx.beginPath();
  ctx.moveTo(tx, ty + 1);
  ctx.lineTo(tx - 16, y + 2);
  ctx.lineTo(tx - 11, y + 2);
  ctx.lineTo(tx + 1, ty + 3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tx, ty + 1);
  ctx.lineTo(tx + 17, y + 2);
  ctx.lineTo(tx + 12, y + 2);
  ctx.lineTo(tx + 1, ty + 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3a2616';
  ctx.fillRect(tx - 4, ty, 9, 4);

  // Tubo largo inclinado hacia adelante.
  ctx.save();
  ctx.translate(tx, ty - 2);
  ctx.rotate(-1.08);
  ctx.fillStyle = '#5b3a16';
  ctx.fillRect(-12, -4, 58, 9);
  ctx.fillStyle = '#a97a35';
  ctx.fillRect(-12, -4, 58, 4);
  ctx.fillStyle = '#e0b766';
  ctx.fillRect(-12, -4, 58, 1);
  // Refuerzos del tubo.
  ctx.fillStyle = '#3d260f';
  ctx.fillRect(-8, -5, 4, 11);
  ctx.fillRect(28, -5, 4, 11);
  // Campana del objetivo.
  ctx.fillStyle = '#3d260f';
  ctx.fillRect(42, -6, 9, 13);
  ctx.fillStyle = '#d9c082';
  ctx.fillRect(45, -4, 5, 9);
  ctx.fillStyle = `rgba(186, 244, 255, ${glint.toFixed(2)})`;
  ctx.fillRect(47, -2, 3, 6);
  // Ocular y contrapeso.
  ctx.fillStyle = '#6b471f';
  ctx.fillRect(-17, -5, 6, 11);
  ctx.fillStyle = '#2a1a0b';
  ctx.fillRect(-20, -3, 4, 7);
  ctx.restore();
}

function drawPaddleItem(ctx: CanvasRenderingContext2D, elapsed: number, reducedMotion: boolean): void {
  const x = CABINET_POS.x + 60;
  const y = CABINET_POS.y + 76;
  const bob = reducedMotion ? 0 : Math.sin(elapsed * 2.4) * 1.6;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y - 10 + bob, 1, x, y - 10 + bob, 34);
  g.addColorStop(0, 'rgba(255,255,255,0.4)');
  g.addColorStop(0.4, 'rgba(0,243,255,0.22)');
  g.addColorStop(1, 'rgba(0,243,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 36, y - 46 + bob, 72, 72);
  ctx.restore();

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(x - 3, y - 26 + bob, 7, 22);
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(x - 3, y - 26 + bob, 2, 22);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(x - 1, y - 4 + bob, 3, 8);
  ctx.fillStyle = '#00f3ff';
  ctx.fillRect(x + 4, y - 20 + bob, 2, 12);
}

/** Pasarela de tablones donde el sendero de tierra entra en la arena de la playa. */
function drawBeachBoardwalk(ctx: CanvasRenderingContext2D): void {
  const x = 740;
  const y = 912;
  const w = 64;
  const h = 26;
  const woodTiles = ensureNatalWoodTiles();

  // Sombra húmeda sobre la arena y bajo los tablones.
  ctx.fillStyle = 'rgba(58, 42, 22, 0.28)';
  ctx.fillRect(x - 3, y + 5, w + 6, h + 4);
  ctx.fillStyle = 'rgba(30, 22, 12, 0.42)';
  ctx.fillRect(x, y + h, w, 3);

  // Tablones horizontales con la textura de madera blanqueada por el sol y la sal
  ctx.fillStyle = '#3a2414';
  ctx.fillRect(x, y, w, h);
  if (woodTiles.weathered) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, w - 2, h - 2);
    ctx.clip();
    const pat = ctx.createPattern(woodTiles.weathered, 'repeat');
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    }
    ctx.restore();
  }
  for (let row = 0; row < 4; row++) {
    const py = y + row * 6;
    if (!woodTiles.weathered) {
      ctx.fillStyle = row % 2 === 0 ? '#8a6238' : '#7c5732';
      ctx.fillRect(x + 1, py + 1, w - 2, 4);
    }
    ctx.fillStyle = 'rgba(34, 20, 10, 0.55)';
    ctx.fillRect(x, py, w, 1);
    ctx.fillStyle = 'rgba(255, 226, 170, 0.18)';
    ctx.fillRect(x + 1, py + 1, w - 2, 1);
    ctx.fillStyle = 'rgba(42, 26, 14, 0.65)';
    for (let px = x + 9; px < x + w - 4; px += 16) {
      ctx.fillRect(px, py + 3, 1, 1);
    }
  }

  // Largueros laterales planos
  for (const px of [x - 3, x + w]) {
    ctx.fillStyle = 'rgba(30, 22, 12, 0.35)';
    ctx.fillRect(px, y, 3, h + 2);
    ctx.fillStyle = '#5c4229';
    ctx.fillRect(px, y, 3, h);
    ctx.fillStyle = '#8a6238';
    ctx.fillRect(px, y, 1, h);
  }

  // Cabeceras transversales en los dos extremos, al ras del suelo.
  for (const py of [y - 1, y + h - 3]) {
    ctx.fillStyle = '#3a2414';
    ctx.fillRect(x - 3, py, w + 6, 4);
    ctx.fillStyle = '#8a6238';
    ctx.fillRect(x - 2, py, w + 4, 2);
    ctx.fillStyle = 'rgba(255, 226, 170, 0.28)';
    ctx.fillRect(x - 2, py, w + 4, 1);
  }

  // Arena arrastrada por la brisa marina sobre los extremos y tablones inferiores de la pasarela
  ctx.fillStyle = 'rgba(220, 186, 132, 0.72)';
  ctx.fillRect(x - 5, y + h - 2, 14, 3);
  ctx.fillRect(x + w - 11, y + h - 2, 16, 3);
  ctx.fillRect(x + 18, y + h - 1, 12, 2);
  ctx.fillStyle = 'rgba(244, 220, 174, 0.52)';
  ctx.fillRect(x - 3, y + h - 2, 8, 1);
  ctx.fillRect(x + w - 8, y + h - 2, 9, 1);
  ctx.fillStyle = 'rgba(214, 180, 126, 0.45)';
  ctx.fillRect(x + 4, y + 19, 9, 2);
  ctx.fillRect(x + w - 15, y + 13, 8, 2);
}

/**
 * Muelle ampliado del Puerto Norte construido con las tres texturas de madera adjuntas:
 * - Pasarela principal ancha (x = 772..868, y = 398..522)
 * - Brazo lateral oriental de amarre (x = 860..902, y = 414..458)
 * - Pilotes sumergidos, escalera al agua, cabos trenzados, salvavidas y farol de partida.
 */
function drawNorthPortDock(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  ready: boolean,
  reducedMotion: boolean
): void {
  const woodTiles = ensureNatalWoodTiles();
  const mainLeft = 1130;
  const mainW = 92; // centro en x = 1176
  const mainTop = 548;
  const mainBottom = 674;
  const mainH = mainBottom - mainTop;

  const wingLeft = 1214;
  const wingW = 42; // hasta x = 1256
  const wingTop = 566;
  const wingH = 42; // hasta y = 608

  // 1. Estribo costero de piedra y arena húmeda donde el muelle nace en la orilla norte
  ctx.fillStyle = 'rgba(104, 72, 36, 0.36)';
  ctx.beginPath();
  ctx.ellipse(1176, mainBottom + 2, 54, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5c584e';
  ctx.fillRect(mainLeft - 2, mainBottom - 6, mainW + 4, 8);
  ctx.fillStyle = '#8d8778';
  ctx.fillRect(mainLeft, mainBottom - 6, mainW, 3);

  // 2. Sombra proyectada sobre el agua turquesa del puerto
  ctx.fillStyle = 'rgba(3, 18, 28, 0.40)';
  ctx.fillRect(mainLeft + 5, mainTop + 7, mainW, mainH - 4);
  ctx.fillRect(wingLeft + 4, wingTop + 7, wingW, wingH);

  // 3. Pilotes gruesos de madera sumergidos en el mar con verdín de marea y espuma sutil
  const pilings: [number, number, number][] = [
    [mainLeft + 2, mainTop + 4, 18],
    [mainLeft + 45, mainTop + 4, 18],
    [mainLeft + mainW - 8, mainTop + 4, 18],
    [mainLeft + 2, mainTop + 48, 16],
    [mainLeft + mainW - 8, mainTop + 56, 16],
    [mainLeft + 2, mainTop + 92, 14],
    [mainLeft + mainW - 8, mainTop + 92, 14],
    [wingLeft + wingW - 7, wingTop + 4, 18],
    [wingLeft + wingW - 7, wingTop + wingH - 4, 18],
  ];
  for (const [px, py, ph] of pilings) {
    ctx.fillStyle = '#23150b';
    ctx.fillRect(px, py, 6, ph);
    ctx.fillStyle = '#624226';
    ctx.fillRect(px + 1, py, 3, ph - 4);
    ctx.fillStyle = 'rgba(34, 72, 66, 0.65)';
    ctx.fillRect(px, py + ph - 6, 6, 5);
    const lap = reducedMotion ? 0.5 : 0.4 + Math.sin(elapsed * 2.2 + px * 0.1) * 0.25;
    ctx.fillStyle = `rgba(208, 248, 244, ${(lap * 0.55).toFixed(2)})`;
    ctx.fillRect(px - 1, py + ph - 2, 8, 1);
  }

  // 4. Escalera marinera lateral de bajada al agua en el costado oeste
  const stepY = 580;
  ctx.fillStyle = '#2b1a0e';
  ctx.fillRect(mainLeft - 7, stepY, 7, 22);
  for (let s = 0; s < 4; s++) {
    ctx.fillStyle = s % 2 === 0 ? '#8c623a' : '#734e2c';
    ctx.fillRect(mainLeft - 6, stepY + 2 + s * 5, 6, 3);
    ctx.fillStyle = 'rgba(255, 232, 184, 0.26)';
    ctx.fillRect(mainLeft - 6, stepY + 2 + s * 5, 5, 1);
  }

  // 5. Cubierta principal y brazo este texturizados con las 3 maderas
  ctx.fillStyle = '#331f11';
  ctx.fillRect(mainLeft, mainTop, mainW, mainH);
  ctx.fillRect(wingLeft - 2, wingTop, wingW + 2, wingH);

  const paintWoodRect = (
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    tile: HTMLCanvasElement | null,
    fallbackA: string,
    fallbackB: string
  ) => {
    if (tile) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      const pat = ctx.createPattern(tile, 'repeat');
      if (pat) {
        ctx.translate(rx, ry);
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, rw, rh);
      }
      ctx.restore();
    } else {
      for (let py = ry; py < ry + rh; py += 6) {
        const row = Math.floor((py - ry) / 6);
        ctx.fillStyle = row % 2 === 0 ? fallbackA : fallbackB;
        ctx.fillRect(rx, py + 1, rw, 5);
      }
    }
    // Juntas nítidas entre tablones, bisel de luz solar y clavos de hierro forjado
    for (let py = ry; py < ry + rh; py += 6) {
      ctx.fillStyle = 'rgba(30, 17, 8, 0.56)';
      ctx.fillRect(rx, py, rw, 1);
      ctx.fillStyle = 'rgba(255, 228, 176, 0.16)';
      ctx.fillRect(rx + 1, py + 1, rw - 2, 1);
      ctx.fillStyle = 'rgba(36, 22, 12, 0.68)';
      for (let px = rx + 6; px < rx + rw - 4; px += 16) {
        ctx.fillRect(px, py + 3, 1, 1);
        ctx.fillRect(px, py + 4, 1, 1);
      }
    }
  };

  // Pasarela principal con madera 1 (aged)
  paintWoodRect(mainLeft + 3, mainTop + 3, mainW - 6, mainH - 5, woodTiles.aged, '#865e37', '#76512e');
  // Pasillo central de honor y cabecera norte con madera 2 (warm)
  paintWoodRect(mainLeft + 22, mainTop + 4, 48, mainH - 8, woodTiles.warm, '#946336', '#82542c');
  paintWoodRect(mainLeft + 4, mainTop + 3, mainW - 8, 18, woodTiles.warm, '#946336', '#82542c');
  // Brazo oriental de amarre con madera 3 (weathered)
  paintWoodRect(wingLeft, wingTop + 3, wingW - 3, wingH - 6, woodTiles.weathered, '#8b6b47', '#7b5d3c');

  // Vigas perimetrales maestras y defensas laterales
  ctx.fillStyle = '#472c18';
  ctx.fillRect(mainLeft, mainTop, 4, mainH);
  ctx.fillRect(mainLeft + mainW - 4, mainTop, 4, wingTop - mainTop);
  ctx.fillRect(mainLeft + mainW - 4, wingTop + wingH, 4, mainBottom - (wingTop + wingH));
  ctx.fillRect(mainLeft, mainTop, mainW, 4);
  ctx.fillRect(wingLeft, wingTop, wingW, 4);
  ctx.fillRect(wingLeft, wingTop + wingH - 4, wingW, 4);
  ctx.fillRect(wingLeft + wingW - 4, wingTop, 4, wingH);

  ctx.fillStyle = '#9e7146';
  ctx.fillRect(mainLeft + 1, mainTop, mainW - 2, 1);
  ctx.fillRect(mainLeft + 1, mainTop + 1, 1, mainH - 2);
  ctx.fillRect(wingLeft, wingTop + 1, wingW - 2, 1);

  // Postes esquineros bajos con cabos marineros tendidos en los laterales
  const bollardCoords: [number, number][] = [
    [mainLeft + 1, mainTop + 1],
    [mainLeft + mainW - 7, mainTop + 1],
    [mainLeft + 1, mainTop + 44],
    [mainLeft + 1, mainTop + 88],
    [mainLeft + mainW - 7, mainTop + 88],
    [wingLeft + wingW - 7, wingTop + 1],
    [wingLeft + wingW - 7, wingTop + wingH - 7],
  ];
  // Cuerdas colgantes entre postes laterales
  ctx.strokeStyle = '#c8aa78';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(mainLeft + 3, mainTop + 5);
  ctx.quadraticCurveTo(mainLeft + 5, mainTop + 25, mainLeft + 3, mainTop + 46);
  ctx.quadraticCurveTo(mainLeft + 5, mainTop + 67, mainLeft + 3, mainTop + 90);
  ctx.stroke();

  for (const [bx, by] of bollardCoords) {
    ctx.fillStyle = 'rgba(20, 12, 6, 0.45)';
    ctx.fillRect(bx - 1, by + 5, 8, 2);
    ctx.fillStyle = '#382213';
    ctx.fillRect(bx, by, 6, 6);
    ctx.fillStyle = '#8b5e36';
    ctx.fillRect(bx + 1, by + 1, 4, 4);
    ctx.fillStyle = '#caa26e';
    ctx.fillRect(bx + 1, by, 4, 1);
  }

  // Rollo de cuerda en proa oeste
  ctx.fillStyle = 'rgba(28, 16, 8, 0.38)';
  ctx.beginPath();
  ctx.ellipse(1143, 565, 6.5, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#bfa06c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(1142, 564, 5, 3.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#e5cba0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(1142, 563.5, 3, 2, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Salvavidas clásico blanco y coral sujeto junto al borde este
  const ringX = 1215;
  const ringY = 623;
  ctx.fillStyle = 'rgba(26, 16, 8, 0.4)';
  ctx.beginPath();
  ctx.ellipse(ringX + 1, ringY + 1, 6.5, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.ellipse(ringX, ringY, 6, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ea580c';
  ctx.fillRect(ringX - 6, ringY - 1, 3, 2);
  ctx.fillRect(ringX + 3, ringY - 1, 3, 2);
  ctx.fillRect(ringX - 1, ringY - 4, 2, 2);
  ctx.fillRect(ringX - 1, ringY + 2, 2, 2);
  ctx.fillStyle = '#5c3c22';
  ctx.fillRect(ringX - 2, ringY - 1, 4, 2);

  // Arena seca de la media luna del puerto abrazando el arranque sur del muelle
  ctx.fillStyle = 'rgba(218, 184, 130, 0.70)';
  ctx.fillRect(mainLeft - 3, mainBottom - 3, 22, 4);
  ctx.fillRect(mainLeft + mainW - 19, mainBottom - 3, 22, 4);
  ctx.fillStyle = 'rgba(244, 220, 174, 0.48)';
  ctx.fillRect(mainLeft, mainBottom - 3, 12, 1);
  ctx.fillRect(mainLeft + mainW - 14, mainBottom - 3, 12, 1);

  // Farolillo cian de navegación en la proa oriental
  const beaconPostX = mainLeft + mainW - 11;
  const beaconPostY = mainTop + 4;
  ctx.fillStyle = '#2b2b33';
  ctx.fillRect(beaconPostX, beaconPostY - 8, 3, 14);
  ctx.fillRect(beaconPostX - 3, beaconPostY - 8, 6, 2);
  const glow = ready && !reducedMotion ? 0.64 + Math.sin(elapsed * 3.2) * 0.22 : ready ? 0.74 : 0.28;
  ctx.fillStyle = `rgba(0, 243, 255, ${glow.toFixed(2)})`;
  ctx.fillRect(beaconPostX - 3, beaconPostY - 6, 6, 6);
  ctx.fillStyle = 'rgba(224, 250, 255, 0.92)';
  ctx.fillRect(beaconPostX - 2, beaconPostY - 5, 4, 3);

  if (!ready) return;

  // Carril de luz abierta hacia el norte desde la proa del muelle
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lane = ctx.createLinearGradient(0, mainTop, 0, mainTop - 135);
  lane.addColorStop(0, 'rgba(0, 243, 255, 0.30)');
  lane.addColorStop(1, 'rgba(0, 243, 255, 0)');
  ctx.fillStyle = lane;
  ctx.fillRect(1162, mainTop - 132, 28, 136);
  for (let i = 0; i < 6; i++) {
    const t = reducedMotion ? i / 6 : ((elapsed * 0.24 + i / 6) % 1);
    const ly = mainTop - 10 - t * 108;
    const alpha = 0.14 + (1 - t) * 0.34;
    ctx.fillStyle = `rgba(190, 246, 255, ${alpha.toFixed(3)})`;
    ctx.fillRect(1170 + Math.sin(t * 9 + i) * 7, Math.round(ly), 10, 2);
  }
  ctx.restore();
}

/**
 * Objetos tridimensionales sobre el muelle agrandado (ordenados por Y con el jugador)
 */
function drawNorthPortDockProps(
  ctx: CanvasRenderingContext2D,
  cluster: 'west' | 'east',
  elapsed: number,
  reducedMotion: boolean
): void {
  const woodTiles = ensureNatalWoodTiles();
  const flicker = reducedMotion ? 0.85 : 0.78 + Math.sin(elapsed * 3.4) * 0.08;

  if (cluster === 'west') {
    // Coordenadas alineadas con el sólido { x: 1130, y: 604, w: 18, h: 24 }
    const cx = 1133;
    const cy = 604;

    // Sombra de contacto sobre los tablones
    ctx.fillStyle = 'rgba(20, 12, 6, 0.44)';
    ctx.beginPath();
    ctx.ellipse(cx + 9, cy + 22, 11, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cajón de madera claveteada con refuerzos cruzados
    ctx.fillStyle = '#2d1b0e';
    ctx.fillRect(cx, cy + 6, 16, 15);
    if (woodTiles.warm) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx + 1, cy + 7, 14, 13);
      ctx.clip();
      const pat = ctx.createPattern(woodTiles.warm, 'repeat');
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(cx + 1, cy + 7, 14, 13);
      }
      ctx.restore();
    } else {
      ctx.fillStyle = '#8b5c34';
      ctx.fillRect(cx + 1, cy + 7, 14, 13);
    }
    ctx.fillStyle = '#b48150';
    ctx.fillRect(cx + 1, cy + 7, 14, 2);
    ctx.fillRect(cx + 1, cy + 7, 2, 13);
    ctx.fillRect(cx + 13, cy + 7, 2, 13);
    ctx.strokeStyle = '#5c3b20';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + 2, cy + 9);
    ctx.lineTo(cx + 14, cy + 19);
    ctx.stroke();

    // Barril pequeño delante/norte del cajón
    const bx = cx + 3;
    const by = cy - 4;
    ctx.fillStyle = '#2b190d';
    ctx.fillRect(bx, by, 12, 13);
    ctx.fillStyle = '#7c4f2b';
    ctx.fillRect(bx + 1, by + 1, 10, 11);
    ctx.fillStyle = '#a67346';
    ctx.fillRect(bx + 2, by + 1, 8, 2);
    ctx.fillStyle = '#333840';
    ctx.fillRect(bx + 1, by + 3, 10, 1);
    ctx.fillRect(bx + 1, by + 8, 10, 1);

    // Farolillo de aceite posado sobre el cajón
    const lx = cx + 8;
    const ly = cy + 3;
    ctx.fillStyle = '#272a30';
    ctx.fillRect(lx - 2, ly - 4, 5, 6);
    ctx.fillStyle = `rgba(255, 204, 112, ${flicker.toFixed(2)})`;
    ctx.fillRect(lx - 1, ly - 3, 3, 4);
    if (!reducedMotion) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(lx, ly - 1, 1, lx, ly - 1, 18);
      g.addColorStop(0, 'rgba(255, 198, 106, 0.26)');
      g.addColorStop(1, 'rgba(255, 198, 106, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(lx - 18, ly - 19, 36, 36);
      ctx.restore();
    }
    return;
  }

  // Grupo del brazo oriental: alineado con { x: 1230, y: 572, w: 22, h: 22 }
  const ex = 1232;
  const ey = 572;

  ctx.fillStyle = 'rgba(20, 12, 6, 0.44)';
  ctx.beginPath();
  ctx.ellipse(ex + 11, ey + 20, 13, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Dos barriles marineros con aros de hierro
  const barrels: [number, number][] = [
    [ex, ey + 2],
    [ex + 10, ey + 5],
  ];
  for (const [bx, by] of barrels) {
    ctx.fillStyle = '#29180c';
    ctx.fillRect(bx, by, 12, 15);
    ctx.fillStyle = '#754b29';
    ctx.fillRect(bx + 1, by + 1, 10, 13);
    ctx.fillStyle = '#9c693e';
    ctx.fillRect(bx + 2, by + 1, 3, 12);
    ctx.fillStyle = '#b98856';
    ctx.fillRect(bx + 2, by + 1, 8, 2);
    ctx.fillStyle = '#2f353d';
    ctx.fillRect(bx + 1, by + 4, 10, 1);
    ctx.fillRect(bx + 1, by + 10, 10, 1);
  }

  // Nasa / cesta de mimbre de pescador delante de los barriles
  const wx = ex + 2;
  const wy = ey + 13;
  ctx.fillStyle = '#3b2814';
  ctx.fillRect(wx, wy, 11, 9);
  ctx.fillStyle = '#b48a52';
  ctx.fillRect(wx + 1, wy + 1, 9, 7);
  ctx.fillStyle = '#8c6638';
  for (let py = wy + 2; py < wy + 8; py += 2) {
    ctx.fillRect(wx + 1, py, 9, 1);
  }
  ctx.fillStyle = '#d9b57c';
  ctx.fillRect(wx + 2, wy + 1, 7, 1);

  // Bita de amarre de hierro fundido con cabo enrollado en la esquina del brazo
  ctx.fillStyle = '#1f242b';
  ctx.fillRect(ex + 17, ey - 3, 5, 7);
  ctx.fillRect(ex + 15, ey - 2, 9, 2);
  ctx.fillStyle = '#64748b';
  ctx.fillRect(ex + 16, ey - 2, 6, 1);
  ctx.fillStyle = '#cbb07c';
  ctx.fillRect(ex + 16, ey + 1, 7, 2);

  // Caña de pescar artesanal inclinada hacia el mar al este del brazo
  const rodSway = reducedMotion ? 0 : Math.sin(elapsed * 1.8) * 0.8;
  ctx.strokeStyle = '#8c5e34';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(ex + 14, ey + 14);
  ctx.lineTo(ex + 34, ey - 2 + rodSway);
  ctx.stroke();
  // Sedal fino y boya roja y blanca meciendo en el agua
  const bobX = ex + 34;
  const bobY = ey + 14 + (reducedMotion ? 0 : Math.sin(elapsed * 2.5) * 1.4);
  ctx.strokeStyle = 'rgba(226, 244, 250, 0.55)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(ex + 34, ey - 2 + rodSway);
  ctx.lineTo(bobX, bobY);
  ctx.stroke();
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(Math.round(bobX) - 1, Math.round(bobY) - 1, 3, 2);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(Math.round(bobX) - 1, Math.round(bobY) + 1, 3, 1);
}

function drawDepartureBeacon(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  active: boolean,
  reducedMotion: boolean
): void {
  const { x, y } = ISLA_NATAL_DEPARTURE;
  if (!active) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const t = reducedMotion ? i / 3 : ((elapsed * 0.55 + i / 3) % 1);
    const r = 10 + t * 46;
    ctx.strokeStyle = `rgba(0, 243, 255, ${(0.5 * (1 - t)).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(224, 250, 255, 0.7)';
  ctx.fillRect(x - 1, y - 26 - Math.sin(elapsed * 2) * 2, 2, 12);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* AVATARES Y PARTÍCULAS                                              */
/* ------------------------------------------------------------------ */

type NatalAvatarParams = Pick<
  IslaNatalRenderParams,
  'player' | 'reducedMotion' | 'skinColor' | 'hairColor' | 'shirtColor' | 'appearance'
>;

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  params: NatalAvatarParams,
  elapsed: number
): void {
  const p = params.player;

  if (p.ridingPaddle) {
    const hover = params.reducedMotion ? 0 : Math.round(Math.sin(elapsed * 5.2) * 2.5);
    const boardY = p.y + 4;
    const avatarY = boardY + hover - 3;
    const tilt = p.rideTilt;

    // Estela en V: chorro de plasma y espuma que se abren tras la tabla
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(p.x, avatarY + 6);
    ctx.rotate(tilt);
    const plasma = ctx.createLinearGradient(-128, 0, 0, 0);
    plasma.addColorStop(0, 'rgba(0, 243, 255, 0)');
    plasma.addColorStop(0.6, 'rgba(0, 243, 255, 0.2)');
    plasma.addColorStop(1, 'rgba(0, 243, 255, 0.55)');
    ctx.fillStyle = plasma;
    ctx.fillRect(-128, -5, 128, 10);
    ctx.restore();

    // Espuma en abanico: dos filas de guiones que se abren tras la tabla
    ctx.save();
    ctx.translate(p.x, avatarY + 6);
    ctx.rotate(tilt);
    for (let i = 0; i < 6; i++) {
      const dist = 16 + i * 20;
      const spread = 3 + i * 2.2;
      const drift = Math.sin(elapsed * 8 - i * 1.15) * 2;
      const alpha = Math.max(0.08, 0.52 - i * 0.07);
      ctx.fillStyle = `rgba(224, 250, 255, ${alpha.toFixed(2)})`;
      ctx.fillRect(-dist - 10, -spread - 2 + drift, 12, 2);
      ctx.fillRect(-dist - 10, spread - 1 - drift, 12, 2);
      ctx.fillStyle = `rgba(165, 243, 252, ${(alpha * 0.85).toFixed(2)})`;
      ctx.fillRect(-dist - 3, 0, 9, 3);
    }
    // Cresta de proa: el canto corta el agua y levanta espuma delante
    const bow = params.reducedMotion
      ? 0.7
      : 0.55 + Math.sin(elapsed * 11) * 0.25;
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.55 + bow * 0.25).toFixed(2)})`;
    ctx.fillRect(20, -3, 7, 2);
    ctx.fillRect(26, 0, 5, 2);
    ctx.restore();

    // Rocío marino levantado por el canto de la tabla
    ctx.fillStyle = 'rgba(224, 250, 255, 0.6)';
    for (let i = 1; i <= 5; i++) {
      const back = i * 14;
      const wobble = Math.sin(elapsed * 7 + i) * 3;
      ctx.fillRect(
        p.x - Math.cos(tilt) * back + wobble - 2,
        avatarY - Math.sin(tilt) * back + 9,
        4,
        2
      );
    }

    // La Barra de Pong: la misma pieza del viejo viajero que espera en la Isla del Origen
    drawPongHoverboard(
      ctx,
      p.x,
      boardY,
      tilt,
      false,
      elapsed,
      params.skinColor,
      params.hairColor,
      params.shirtColor,
      params.reducedMotion,
      params.appearance
    );

    // Postura de surf: el cuerpo acompaña la inclinación de la tabla
    ctx.save();
    ctx.translate(p.x, avatarY);
    ctx.rotate(tilt * 0.72);
    drawPixelAvatar4Dir(
      ctx,
      0,
      0,
      p.facingDir,
      false,
      false,
      elapsed,
      params.skinColor,
      params.hairColor,
      params.shirtColor,
      {
        reducedMotion: params.reducedMotion,
        interactAnim: p.interactAnim,
        appearance: params.appearance,
      }
    );
    ctx.restore();
    return;
  }

  const playerOnSand = !isPointOnNatalMeadow(p.x, p.y) && !(p.x < 590 && p.y < 544);
  ctx.fillStyle = playerOnSand ? 'rgba(92, 64, 30, 0.34)' : 'rgba(20, 44, 28, 0.34)';
  ctx.beginPath();
  ctx.ellipse(p.x + 3, p.y + 3, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  drawPixelAvatar4Dir(
    ctx,
    p.x,
    p.y,
    p.facingDir,
    p.walking,
    p.sprinting,
    elapsed,
    params.skinColor,
    params.hairColor,
    params.shirtColor,
    {
      reducedMotion: params.reducedMotion,
      interactAnim: p.interactAnim,
      appearance: params.appearance,
    }
  );
}

function drawPromptBadge(ctx: CanvasRenderingContext2D, prompt: IslaNatalPromptSpec, bob: number): void {
  const px = Math.round(prompt.x);
  const py = Math.round(prompt.y - 52 + bob);
  ctx.save();
  ctx.font = '700 10px "JetBrains Mono", monospace';
  const text = `[E] ${prompt.label}`;
  const tw = Math.ceil(ctx.measureText(text).width) + 20;
  const left = Math.round(px - tw / 2);

  ctx.fillStyle = '#050811';
  ctx.fillRect(left - 2, py - 16, tw + 4, 24);
  ctx.fillStyle = prompt.accentHex || '#d8be88';
  ctx.fillRect(left, py - 14, tw, 20);
  ctx.fillStyle = '#0b1324';
  ctx.fillRect(left + 2, py - 12, tw - 4, 16);
  ctx.fillStyle = '#f8f5e6';
  ctx.textAlign = 'center';
  ctx.fillText(text, px, py);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* EL VIAJERO Y SU MÁQUINA DEL TIEMPO                                  */
/* ------------------------------------------------------------------ */

/** Geometría de la escena, derivada del punto de aterrizaje. */
const SHIP_HALF_W = 54;
const SHIP_LEG = 16;
const SHIP_HULL_H = 34;
const RAMP_LEN = 76;
const TALK_OFFSET = 104;
const DOOR_OFFSET = 46;
const DOOR_HEIGHT = 34;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smoothstep = (v: number): number => {
  const p = clamp01(v);
  return p * p * (3 - 2 * p);
};

/** Rastro chamuscado y polvo asentado en el punto de aterrizaje. */
function drawLandingScorch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  elapsed: number
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(28, 26, 18, 0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y + 3, 66, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(46, 38, 22, 0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y + 3, 42, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Trizas radiales en la hierba.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + hash2(i, 41) * 0.25;
    const r = 46 + hash2(i, 9) * 26;
    const len = 4 + hash2(i, 5) * 8;
    ctx.strokeStyle = `rgba(34, 30, 20, ${(0.18 + hash2(i, 3) * 0.16).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.26);
    ctx.lineTo(x + Math.cos(a) * (r + len), y + Math.sin(a) * (r + len) * 0.26);
    ctx.stroke();
  }

  // Brasas que aún respiran.
  for (let i = 0; i < 4; i++) {
    const pulse = 0.15 + 0.5 * Math.abs(Math.sin(elapsed * 1.6 + i * 1.7));
    ctx.fillStyle = `rgba(103, 232, 249, ${(pulse * 0.4).toFixed(3)})`;
    ctx.fillRect(
      Math.round(x - 30 + hash2(i, 21) * 60),
      Math.round(y - 1 + hash2(i, 13) * 3),
      2,
      2
    );
  }
  ctx.restore();
}

/**
 * Nave del viajero: casco metálico con remaches y paneles, cúpula de cristal,
 * patas hidráulicas, rampa de descenso y luces de aterrizaje.
 */
function drawTravelerShip(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  lift: number,
  elapsed: number,
  reducedMotion: boolean,
  landed: boolean
): void {
  const bob = !landed && !reducedMotion ? Math.sin(elapsed * 1.7) * 1.2 : 0;
  const cy = groundY - lift + bob;
  const hullBottom = cy - SHIP_LEG;
  const hullTop = hullBottom - SHIP_HULL_H;
  const left = x - SHIP_HALF_W;
  const right = x + SHIP_HALF_W;
  const shrink = clamp01(1 - lift / 300);
  const blink = reducedMotion ? 0.6 : 0.35 + Math.abs(Math.sin(elapsed * 3.4)) * 0.65;

  ctx.save();

  // Haz de aterrizaje: una columna de luz suave mientras baja.
  if (lift > 6) {
    const beam = ctx.createLinearGradient(0, hullBottom, 0, groundY);
    beam.addColorStop(0, 'rgba(150, 240, 255, 0.26)');
    beam.addColorStop(1, 'rgba(150, 240, 255, 0)');
    ctx.fillStyle = beam;
    ctx.fillRect(x - 34, hullBottom, 68, groundY - hullBottom);
  }

  // Sombra proyectada, se achica a medida que sube.
  ctx.fillStyle = `rgba(8, 20, 30, ${(0.3 * shrink).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(x, groundY + 3, 62 * (0.55 + 0.45 * shrink), 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Patas hidráulicas.
  for (const legX of [x - 38, x + 30]) {
    ctx.fillStyle = '#4b6172';
    ctx.fillRect(Math.round(legX), hullBottom, 5, SHIP_LEG);
    ctx.fillStyle = '#7e97a6';
    ctx.fillRect(Math.round(legX + 1), hullBottom, 1, SHIP_LEG - 3);
    ctx.fillStyle = '#2b3b48';
    ctx.fillRect(Math.round(legX - 4), groundY - 2, 13, 4);
    ctx.fillStyle = '#93a9b6';
    ctx.fillRect(Math.round(legX - 4), groundY - 2, 13, 1);
  }

  // Rampa de descenso hacia el oeste, sólo con la nave apoyada.
  if (landed) {
    const doorX = x - DOOR_OFFSET;
    const doorY = hullBottom - 4;
    const footX = doorX - RAMP_LEN;
    ctx.fillStyle = '#53697a';
    ctx.beginPath();
    ctx.moveTo(doorX - 2, doorY);
    ctx.lineTo(doorX + 14, doorY);
    ctx.lineTo(footX + 16, groundY + 1);
    ctx.lineTo(footX, groundY + 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7d95a4';
    ctx.beginPath();
    ctx.moveTo(doorX - 2, doorY);
    ctx.lineTo(doorX + 2, doorY);
    ctx.lineTo(footX + 2, groundY + 1);
    ctx.lineTo(footX, groundY + 1);
    ctx.closePath();
    ctx.fill();
    // Travesaños y luces de borde.
    for (let i = 1; i < 6; i++) {
      const p = i / 6;
      const px = doorX + (footX - doorX) * p;
      const py = doorY + (groundY - doorY) * p;
      ctx.fillStyle = 'rgba(24, 34, 42, 0.5)';
      ctx.fillRect(Math.round(px), Math.round(py), 14, 1);
    }
    ctx.fillStyle = `rgba(150, 240, 255, ${(0.4 + blink * 0.3).toFixed(3)})`;
    ctx.fillRect(Math.round(footX), Math.round(groundY - 1), 2, 2);
    ctx.fillRect(Math.round(footX + 13), Math.round(groundY - 1), 2, 2);
  }

  // Casco principal con degradado metálico.
  const hull = ctx.createLinearGradient(0, hullTop, 0, hullBottom);
  hull.addColorStop(0, '#54707f');
  hull.addColorStop(0.28, '#334c5c');
  hull.addColorStop(0.72, '#223542');
  hull.addColorStop(1, '#121e27');
  ctx.fillStyle = hull;
  ctx.fillRect(left, hullTop, SHIP_HALF_W * 2, SHIP_HULL_H);

  // Borde superior iluminado y panza en sombra.
  ctx.fillStyle = 'rgba(196, 228, 238, 0.5)';
  ctx.fillRect(left + 3, hullTop, SHIP_HALF_W * 2 - 6, 1);
  ctx.fillStyle = 'rgba(178, 208, 220, 0.22)';
  ctx.fillRect(left + 3, hullTop + 1, SHIP_HALF_W * 2 - 6, 3);
  ctx.fillStyle = 'rgba(8, 14, 18, 0.6)';
  ctx.fillRect(left, hullBottom - 5, SHIP_HALF_W * 2, 5);

  // Paneles verticales y remaches.
  for (let px = left + 12; px < right - 6; px += 18) {
    ctx.fillStyle = 'rgba(12, 20, 26, 0.45)';
    ctx.fillRect(px, hullTop + 4, 1, SHIP_HULL_H - 8);
    ctx.fillStyle = 'rgba(150, 186, 200, 0.14)';
    ctx.fillRect(px + 1, hullTop + 4, 1, SHIP_HULL_H - 8);
  }
  ctx.fillStyle = 'rgba(168, 200, 212, 0.4)';
  for (let px = left + 8; px < right - 4; px += 18) {
    for (let py = hullTop + 8; py < hullBottom - 8; py += 9) {
      ctx.fillRect(px, py, 1, 1);
    }
  }

  // Franjas de advertencia en los costados.
  for (const sx of [left + 2, right - 10]) {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#c9a227' : '#1b262e';
      ctx.fillRect(sx + i * 2, hullBottom - 12, 2, 6);
    }
  }

  // Compuerta lateral izquierda.
  const doorX = x - DOOR_OFFSET;
  ctx.fillStyle = '#0d161d';
  ctx.fillRect(doorX - 2, hullBottom - DOOR_HEIGHT, 15, DOOR_HEIGHT - 4);
  ctx.fillStyle = '#3f5a6b';
  ctx.fillRect(doorX + 13, hullBottom - DOOR_HEIGHT, 2, DOOR_HEIGHT - 4);
  ctx.fillStyle = 'rgba(103, 232, 249, 0.55)';
  ctx.fillRect(doorX - 1, hullBottom - DOOR_HEIGHT + 2, 13, 1);

  // Ventanillas.
  for (const wx of [x + 8, x + 26]) {
    ctx.fillStyle = '#0e1a22';
    ctx.fillRect(wx - 2, hullTop + 10, 12, 10);
    ctx.fillStyle = '#5fd7e8';
    ctx.fillRect(wx - 1, hullTop + 11, 10, 8);
    ctx.fillStyle = 'rgba(230, 253, 255, 0.85)';
    ctx.fillRect(wx, hullTop + 12, 4, 2);
    ctx.fillStyle = 'rgba(24, 70, 84, 0.5)';
    ctx.fillRect(wx + 6, hullTop + 14, 3, 4);
  }

  // Toberas y llama de los propulsores.
  for (const nx of [x - 30, x + 22]) {
    ctx.fillStyle = '#18262f';
    ctx.fillRect(nx, hullBottom - 2, 14, 4);
    ctx.fillStyle = '#4c6575';
    ctx.fillRect(nx + 1, hullBottom - 2, 12, 1);
  }
  if (lift > 2 && !reducedMotion) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const nx of [x - 27, x + 25]) {
      const flame = 8 + Math.abs(Math.sin(elapsed * 22 + nx)) * 10;
      const g = ctx.createLinearGradient(0, hullBottom, 0, hullBottom + flame);
      g.addColorStop(0, 'rgba(220, 252, 255, 0.95)');
      g.addColorStop(0.5, 'rgba(103, 232, 249, 0.55)');
      g.addColorStop(1, 'rgba(103, 232, 249, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(nx - 2, hullBottom, 8, flame);
    }
    ctx.restore();
  }

  // Cúpula de cristal: anillos de píxeles y reflejos.
  const domeH = 34;
  const domeTop = hullTop - domeH;
  const rows = [26, 40, 50, 58, 64, 68];
  for (let i = 0; i < rows.length; i++) {
    const w = rows[i];
    const ry = domeTop + i * 5;
    ctx.fillStyle = i < 2 ? '#9fb6c4' : i > 3 ? '#6f8798' : '#8aa3b3';
    ctx.fillRect(Math.round(x - w / 2), ry, w, 5);
  }
  const glass = ctx.createLinearGradient(0, domeTop, 0, hullTop);
  glass.addColorStop(0, 'rgba(176, 236, 246, 0.85)');
  glass.addColorStop(0.45, 'rgba(74, 152, 176, 0.85)');
  glass.addColorStop(1, 'rgba(20, 58, 76, 0.9)');
  ctx.fillStyle = glass;
  ctx.fillRect(x - 26, domeTop + 4, 52, domeH - 8);
  ctx.fillRect(x - 32, domeTop + 14, 64, domeH - 18);
  // Reflejo vertical.
  ctx.fillStyle = 'rgba(236, 254, 255, 0.5)';
  ctx.fillRect(x - 20, domeTop + 6, 5, domeH - 14);
  ctx.fillRect(x - 16, domeTop + 9, 2, domeH - 20);
  // Costillas de la cúpula.
  ctx.fillStyle = 'rgba(28, 54, 68, 0.55)';
  ctx.fillRect(x - 1, domeTop + 2, 2, domeH - 4);
  ctx.fillRect(x - 32, hullTop - 4, 64, 4);
  ctx.fillStyle = '#b9cdd8';
  ctx.fillRect(x - 32, hullTop - 4, 64, 1);
  // Luces internas.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const domeGlow = ctx.createRadialGradient(x, domeTop + 18, 2, x, domeTop + 18, 34);
  domeGlow.addColorStop(0, `rgba(103, 232, 249, ${(0.28 + blink * 0.18).toFixed(3)})`);
  domeGlow.addColorStop(1, 'rgba(103, 232, 249, 0)');
  ctx.fillStyle = domeGlow;
  ctx.fillRect(x - 34, domeTop - 6, 68, 52);
  ctx.restore();

  // Antena con baliza.
  ctx.fillStyle = '#5c7484';
  ctx.fillRect(x + 18, domeTop - 16, 2, 18);
  ctx.fillRect(x + 16, domeTop - 18, 6, 2);
  ctx.fillStyle = `rgba(255, 120, 90, ${blink.toFixed(3)})`;
  ctx.fillRect(x + 17, domeTop - 21, 4, 3);

  // Luces de aterrizaje en el borde del casco.
  const lightA = 0.35 + Math.abs(Math.sin(elapsed * 2.4)) * 0.65;
  const lightB = 0.35 + Math.abs(Math.sin(elapsed * 2.4 + Math.PI)) * 0.65;
  ctx.fillStyle = `rgba(150, 240, 255, ${lightA.toFixed(3)})`;
  ctx.fillRect(left + 4, hullTop + 2, 3, 3);
  ctx.fillStyle = `rgba(255, 170, 120, ${lightB.toFixed(3)})`;
  ctx.fillRect(right - 7, hullTop + 2, 3, 3);

  // Motas de energía alrededor de la nave.
  if (!reducedMotion) {
    for (let i = 0; i < 6; i++) {
      const a = (elapsed * 0.6 + i * 0.17) % 1;
      const mx = x - 46 + hash2(i * 3 + 1, Math.floor(elapsed * 3)) * 92;
      const my = hullBottom - 6 - a * 54;
      ctx.fillStyle = `rgba(150, 240, 255, ${((1 - a) * 0.4).toFixed(3)})`;
      ctx.fillRect(Math.round(mx), Math.round(my), 1, 2);
    }
  }

  ctx.restore();
}

/**
 * El viajero: silueta encapuchada. Bajo la capucha no hay rostro, sólo una
 * sombra fría. Camina con el peso de alguien que ya no debería estar aquí.
 */
function drawFutureTraveler(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  elapsed: number,
  facing: -1 | 1,
  walking: boolean
): void {
  const step = walking && Math.floor(elapsed * 7) % 2 === 0 ? 1 : 0;
  const bob = walking ? Math.abs(Math.sin(elapsed * 7)) * 1.5 : Math.sin(elapsed * 1.4) * 0.6;
  const bx = Math.round(x);
  const by = Math.round(y - bob);
  const look = facing >= 0 ? 1 : -1;
  const sway = walking ? Math.sin(elapsed * 7) * 1.3 : Math.sin(elapsed * 1.1) * 0.5;

  ctx.save();

  // Sombra doble: cuerpo y halo frío de la máquina.
  ctx.fillStyle = 'rgba(6, 16, 26, 0.36)';
  ctx.beginPath();
  ctx.ellipse(bx, y + 2, 14, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(103, 232, 249, 0.08)';
  ctx.beginPath();
  ctx.ellipse(bx, y + 2, 9, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Botas de suela gruesa.
  ctx.fillStyle = '#090d15';
  ctx.fillRect(bx - 9 + step, by - 6, 7, 5);
  ctx.fillRect(bx + 2 - step, by - 6, 7, 5);
  ctx.fillStyle = '#39465f';
  ctx.fillRect(bx - 9 + step, by - 6, 6, 1);
  ctx.fillRect(bx + 2 - step, by - 6, 6, 1);
  ctx.fillStyle = '#05080e';
  ctx.fillRect(bx - 10 + step, by - 2, 8, 2);
  ctx.fillRect(bx + 2 - step, by - 2, 8, 2);

  // Túnica larga con vuelo y pliegues profundos.
  const hemL = bx - 13 + sway * 0.45;
  const hemR = bx + 13 + sway * 0.45;
  ctx.fillStyle = '#1b2238';
  ctx.beginPath();
  ctx.moveTo(bx - 8, by - 31);
  ctx.lineTo(bx + 8, by - 31);
  ctx.lineTo(hemR, by - 6);
  ctx.lineTo(hemL, by - 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#242e4b';
  ctx.beginPath();
  ctx.moveTo(bx - 7, by - 30);
  ctx.lineTo(bx + 1, by - 30);
  ctx.lineTo(bx + 3 + sway * 0.3, by - 7);
  ctx.lineTo(bx - 9 + sway * 0.45, by - 7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(8, 12, 22, 0.6)';
  ctx.fillRect(bx - 1, by - 29, 2, 21);
  ctx.fillRect(bx - 6, by - 28, 1, 18);
  ctx.fillRect(bx + 6, by - 28, 1, 18);
  // Dobladillo reforzado.
  ctx.fillStyle = '#39456a';
  ctx.fillRect(Math.round(hemL), by - 7, Math.round(hemR - hemL), 2);
  ctx.fillStyle = 'rgba(103, 232, 249, 0.28)';
  ctx.fillRect(Math.round(hemL) + 1, by - 6, Math.round(hemR - hemL) - 2, 1);

  // Torso y capa corta de viaje.
  ctx.fillStyle = '#242e4b';
  ctx.fillRect(bx - 9, by - 40, 18, 11);
  ctx.fillStyle = '#303d63';
  ctx.beginPath();
  ctx.moveTo(bx - 13, by - 37);
  ctx.lineTo(bx - 8, by - 42);
  ctx.lineTo(bx + 8, by - 42);
  ctx.lineTo(bx + 13, by - 37);
  ctx.lineTo(bx + 10, by - 31);
  ctx.lineTo(bx - 10, by - 31);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3d4b78';
  ctx.fillRect(bx - 8, by - 42, 16, 1);
  ctx.fillStyle = '#141a2a';
  ctx.fillRect(bx - 10, by - 32, 20, 2);
  ctx.fillStyle = 'rgba(103, 232, 249, 0.18)';
  ctx.fillRect(bx - 12, by - 36, 1, 5);
  ctx.fillRect(bx + 11, by - 36, 1, 5);

  // Mangas anchas y guantes.
  ctx.fillStyle = '#202944';
  ctx.beginPath();
  ctx.moveTo(bx - 12, by - 39);
  ctx.lineTo(bx - 16, by - 27);
  ctx.lineTo(bx - 11, by - 25);
  ctx.lineTo(bx - 8, by - 35);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(bx + 12, by - 39);
  ctx.lineTo(bx + 16, by - 27);
  ctx.lineTo(bx + 11, by - 25);
  ctx.lineTo(bx + 8, by - 35);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2f3c60';
  ctx.fillRect(bx - 15, by - 39, 2, 10);
  ctx.fillRect(bx + 13, by - 39, 2, 10);
  ctx.fillStyle = '#0a0f1b';
  ctx.fillRect(bx - 13, by - 26, 5, 4);
  ctx.fillRect(bx + 8, by - 26, 5, 4);

  // Cinturón con hebilla de energía.
  ctx.fillStyle = '#0d1320';
  ctx.fillRect(bx - 9, by - 23, 18, 3);
  ctx.fillStyle = '#67e8f9';
  ctx.fillRect(bx + look * 2 - 1, by - 23, 3, 2);
  ctx.fillStyle = 'rgba(224, 255, 255, 0.8)';
  ctx.fillRect(bx + look * 2, by - 23, 1, 1);

  // Capucha alta y capa de viaje.
  ctx.fillStyle = '#1a2138';
  ctx.fillRect(bx - 8, by - 45, 16, 5);
  ctx.beginPath();
  ctx.moveTo(bx - 9, by - 41);
  ctx.lineTo(bx - 8, by - 48);
  ctx.lineTo(bx - 4, by - 53);
  ctx.lineTo(bx + 4, by - 53);
  ctx.lineTo(bx + 8, by - 47);
  ctx.lineTo(bx + 9, by - 40);
  ctx.lineTo(bx + 6, by - 37);
  ctx.lineTo(bx - 6, by - 37);
  ctx.closePath();
  ctx.fillStyle = '#2c3859';
  ctx.fill();
  ctx.fillStyle = '#3d4b75';
  ctx.beginPath();
  ctx.moveTo(bx - 4, by - 52);
  ctx.lineTo(bx + 4, by - 52);
  ctx.lineTo(bx + 6, by - 46);
  ctx.lineTo(bx - 6, by - 46);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(103, 232, 249, 0.3)';
  ctx.fillRect(bx + look * 7, by - 46, 1, 6);
  ctx.fillStyle = '#101524';
  ctx.fillRect(bx - 8, by - 39, 16, 2);

  // Velo del rostro: un vacío frío, sin rasgos.
  const faceX = bx + look;
  const faceGrad = ctx.createLinearGradient(0, by - 50, 0, by - 40);
  faceGrad.addColorStop(0, '#03050a');
  faceGrad.addColorStop(0.7, '#070c16');
  faceGrad.addColorStop(1, 'rgba(10, 18, 32, 0.9)');
  ctx.fillStyle = faceGrad;
  ctx.beginPath();
  ctx.ellipse(faceX, by - 45, 4.5, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(125, 211, 252, 0.22)';
  ctx.fillRect(bx + look * 5, by - 48, 1, 6);

  // Estrellas diminutas atrapadas en el vacío.
  for (let i = 0; i < 3; i++) {
    const drift = (elapsed * 0.3 + i * 0.31) % 1;
    const sx = faceX - 2 + Math.round(hash2(i + 3, 7) * 4);
    const sy = Math.round(by - 48 + drift * 5);
    ctx.fillStyle = `rgba(186, 230, 253, ${(0.25 + (1 - drift) * 0.5).toFixed(3)})`;
    ctx.fillRect(sx, sy, 1, 1);
  }

  // Motas de tiempo alrededor de la figura.
  if (!walking) {
    for (let i = 0; i < 4; i++) {
      const a = (elapsed * 0.5 + i * 0.26) % 1;
      ctx.fillStyle = `rgba(140, 226, 248, ${((1 - a) * 0.5).toFixed(3)})`;
      ctx.fillRect(bx - 13 + i * 8, Math.round(by - 12 - a * 24), 1, 2);
    }
  }

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* INTERIOR DE LA CABAÑA                                              */
/* ------------------------------------------------------------------ */

export interface IslaNatalCabinRenderParams {
  ctx: CanvasRenderingContext2D;
  vw: number;
  vh: number;
  camera: { x: number; y: number };
  elapsed: number;
  reducedMotion: boolean;
  player: IslaNatalPlayerRender;
  skinColor: string;
  hairColor: string;
  shirtColor: string;
  appearance: AvatarAppearance;
  prompt: IslaNatalPromptSpec | null;
  /** La mochila sigue colgada del clavo junto a la ventana. */
  backpackOnHook: boolean;
  /** El cofre del abuelo ya fue abierto con la combinación. */
  chestOpened: boolean;
  /** La radio de la mesa está encendida y suena durante la intro. */
  radioOn?: boolean;
  /** Interferencia y estática que interrumpen la transmisión de la radio. */
  radioStatic?: { t: number } | null;
  /** Tormenta y anomalías del Reinicio Cero mientras Pixel está adentro. */
  storm?: { t: number } | null;
}

const CABIN_BOOK_COLORS = [
  '#1d3d78',
  '#164a38',
  '#7a1c28',
  '#8a5a16',
  '#3a2468',
  '#1f5868',
  '#6a3416',
  '#b07a22',
  '#2f5c2a',
  '#4a1c48',
  '#245a78',
  '#8c3a18',
];

function drawCabinBookRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number
): void {
  let bx = x;
  let col = seed | 0;
  while (bx < x + w - 2) {
    const bw = 2 + (col % 3);
    if (bx + bw > x + w) break;
    const bh = Math.max(6, h - 1 - (col % 5));
    ctx.fillStyle = CABIN_BOOK_COLORS[col % CABIN_BOOK_COLORS.length];
    ctx.fillRect(bx, y + h - bh, bw, bh);
    ctx.fillStyle = 'rgba(232, 198, 112, 0.55)';
    ctx.fillRect(bx, y + h - bh + 1 + (col % 3), bw, 1);
    if (col % 5 === 0) {
      ctx.fillStyle = 'rgba(255, 244, 210, 0.22)';
      ctx.fillRect(bx, y + h - bh, 1, bh);
    }
    bx += bw + 1;
    col++;
  }
}

function drawCabinBookshelfBay(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number
): void {
  ctx.fillStyle = '#1a0e08';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#3a2214';
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  ctx.fillStyle = '#5a3820';
  ctx.fillRect(x + 2, y + 2, w - 4, 2);
  const rows = 5;
  const rowH = Math.floor((h - 10) / rows);
  for (let r = 0; r < rows; r++) {
    const sy = y + 6 + r * rowH;
    ctx.fillStyle = '#100804';
    ctx.fillRect(x + 4, sy, w - 8, rowH - 4);
    drawCabinBookRow(ctx, x + 5, sy + 1, w - 10, rowH - 7, seed + r * 17);
    ctx.fillStyle = '#6a4428';
    ctx.fillRect(x + 3, sy + rowH - 4, w - 6, 3);
    ctx.fillStyle = '#8a5c34';
    ctx.fillRect(x + 3, sy + rowH - 4, w - 6, 1);
  }
  ctx.fillStyle = '#24140c';
  ctx.fillRect(x, y, 3, h);
  ctx.fillRect(x + w - 3, y, 3, h);
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(x + 1, y, 1, h);
  ctx.fillRect(x + w - 2, y, 1, h);
}

function drawCabinColumn(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  ctx.fillStyle = '#140c08';
  ctx.fillRect(x, y, 16, h);
  ctx.fillStyle = '#3a2416';
  ctx.fillRect(x + 2, y, 12, h);
  ctx.fillStyle = '#6a462a';
  ctx.fillRect(x + 2, y, 3, h);
  ctx.fillStyle = '#24140c';
  for (let vy = y + 8; vy < y + h - 6; vy += 18) ctx.fillRect(x + 5, vy, 7, 2);
  ctx.fillStyle = '#8a6240';
  ctx.fillRect(x + 1, y, 14, 4);
  ctx.fillRect(x + 1, y + h - 5, 14, 5);
}

function drawCabinArchNiche(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  kind: 'moon' | 'sun'
): void {
  ctx.fillStyle = '#1a0e08';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#4a301c';
  ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
  ctx.fillStyle = '#120a06';
  ctx.beginPath();
  ctx.moveTo(x + 8, y + h - 8);
  ctx.quadraticCurveTo(x + w / 2, y + 4, x + w - 8, y + h - 8);
  ctx.lineTo(x + w - 8, y + h - 4);
  ctx.lineTo(x + 8, y + h - 4);
  ctx.closePath();
  ctx.fill();
  if (kind === 'moon') {
    const sky = ctx.createLinearGradient(0, y + 8, 0, y + h - 10);
    sky.addColorStop(0, '#1a2748');
    sky.addColorStop(1, '#3a2a48');
    ctx.fillStyle = sky;
  } else {
    const sky = ctx.createLinearGradient(0, y + 8, 0, y + h - 10);
    sky.addColorStop(0, '#c47a38');
    sky.addColorStop(1, '#e8b868');
    ctx.fillStyle = sky;
  }
  ctx.fillRect(x + 10, y + 14, w - 20, h - 28);
  ctx.fillStyle = '#5a3820';
  ctx.fillRect(x + 6, y + h - 12, w - 12, 6);
  ctx.fillStyle = '#8a5c34';
  ctx.fillRect(x + 6, y + h - 12, w - 12, 2);
  ctx.fillStyle = '#d8c090';
  ctx.fillRect(x + 16, y + h - 22, w - 32, 8);
  ctx.fillStyle = '#2a1810';
  ctx.fillRect(x + 18, y + h - 20, w - 36, 5);
  if (kind === 'moon') {
    ctx.fillStyle = '#e8e0c8';
    ctx.beginPath();
    ctx.arc(x + w / 2 + 8, y + 26, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a2748';
    ctx.beginPath();
    ctx.arc(x + w / 2 + 12, y + 24, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(240, 220, 160, 0.45)';
    ctx.fillRect(x + 16, y + 22, 2, 2);
    ctx.fillRect(x + 28, y + 30, 1, 1);
    ctx.fillRect(x + 22, y + 18, 1, 1);
  } else {
    ctx.fillStyle = '#f4d878';
    ctx.beginPath();
    ctx.arc(x + w / 2, y + 26, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 236, 180, 0.7)';
    ctx.beginPath();
    ctx.arc(x + w / 2, y + 26, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Sala de la cabaña: biblioteca cálida, parquet y luz de tarde. */
function drawCabinShell(ctx: CanvasRenderingContext2D, elapsed: number, reducedMotion: boolean): void {
  const W = ISLA_NATAL_CABIN.roomW;
  const H = ISLA_NATAL_CABIN.roomH;
  const wallH = 132;

  // Marco de caoba de la sala.
  ctx.fillStyle = '#1a0e08';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#4a2c18';
  ctx.fillRect(6, 6, W - 12, H - 12);
  ctx.fillStyle = '#2a1810';
  ctx.fillRect(10, 10, W - 20, H - 20);

  // Parquet de roble con vetas y juntas.
  ctx.fillStyle = '#5a3820';
  ctx.fillRect(10, wallH, W - 20, H - wallH - 10);
  const plankH = 12;
  for (let y = wallH; y < H - 10; y += plankH) {
    const row = Math.floor((y - wallH) / plankH);
    const offset = row % 2 === 0 ? 0 : 16;
    ctx.fillStyle = row % 2 === 0 ? '#6a4428' : '#624022';
    ctx.fillRect(10, y, W - 20, plankH);
    ctx.fillStyle = 'rgba(255, 214, 160, 0.08)';
    ctx.fillRect(10, y, W - 20, 1);
    ctx.fillStyle = 'rgba(20, 10, 4, 0.35)';
    ctx.fillRect(10, y + plankH - 1, W - 20, 1);
    for (let x = 18 + offset; x < W - 16; x += 48) {
      ctx.fillStyle = 'rgba(24, 12, 6, 0.4)';
      ctx.fillRect(x, y, 1, plankH);
      if (hash2(x, y) > 0.72) {
        ctx.fillStyle = 'rgba(32, 16, 8, 0.4)';
        ctx.fillRect(x + 10, y + 4, 3, 2);
      }
    }
  }
  const floorSheen = ctx.createRadialGradient(W * 0.5, 210, 12, W * 0.5, 210, 180);
  floorSheen.addColorStop(0, 'rgba(255, 214, 150, 0.07)');
  floorSheen.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = floorSheen;
  ctx.fillRect(10, wallH, W - 20, H - wallH - 10);

  // Pared de biblioteca: tres bahías de estantes, columnas y nichos.
  const wallGrad = ctx.createLinearGradient(0, 0, 0, wallH);
  wallGrad.addColorStop(0, '#2c1a10');
  wallGrad.addColorStop(0.7, '#23140c');
  wallGrad.addColorStop(1, '#1a0e08');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(10, 10, W - 20, wallH - 10);
  for (let x = 18; x < W - 16; x += 22) {
    ctx.fillStyle = 'rgba(255, 220, 170, 0.04)';
    ctx.fillRect(x, 12, 10, wallH - 22);
  }

  drawCabinBookshelfBay(ctx, 12, 12, 76, 78, 3);
  drawCabinBookshelfBay(ctx, 186, 12, 70, 54, 11);
  drawCabinBookshelfBay(ctx, 328, 12, 72, 54, 19);
  drawCabinBookshelfBay(ctx, 404, 12, 64, 48, 29);
  drawCabinColumn(ctx, 154, 10, wallH - 10);
  drawCabinColumn(ctx, 310, 10, wallH - 10);

  drawCabinArchNiche(ctx, 186, 68, 70, 56, 'moon');
  drawCabinArchNiche(ctx, 328, 68, 72, 56, 'sun');

  // Viga superior, zócalo y moldura.
  ctx.fillStyle = '#140c08';
  ctx.fillRect(8, 8, W - 16, 10);
  ctx.fillStyle = '#5a3820';
  ctx.fillRect(8, 8, W - 16, 3);
  ctx.fillStyle = '#8a5c34';
  ctx.fillRect(8, 8, W - 16, 1);
  for (let x = 20; x < W - 16; x += 36) {
    ctx.fillStyle = 'rgba(16, 8, 4, 0.55)';
    ctx.fillRect(x, 8, 4, 10);
  }
  ctx.fillStyle = '#1a0e08';
  ctx.fillRect(10, wallH - 10, W - 20, 10);
  ctx.fillStyle = '#6a4428';
  ctx.fillRect(10, wallH - 10, W - 20, 3);
  ctx.fillStyle = '#8a5c34';
  ctx.fillRect(10, wallH - 10, W - 20, 1);
  ctx.fillStyle = 'rgba(8, 4, 2, 0.45)';
  ctx.fillRect(10, wallH, W - 20, 10);

  // Ventana al atardecer con cortinas de terciopelo y jardinera.
  const wx = 94;
  const wy = 26;
  const ww = 84;
  const wh = 60;
  ctx.fillStyle = '#140c08';
  ctx.fillRect(wx - 8, wy - 8, ww + 16, wh + 16);
  ctx.fillStyle = '#5a3820';
  ctx.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
  ctx.fillStyle = '#c9a44a';
  ctx.fillRect(wx - 4, wy - 4, ww + 8, 2);
  ctx.fillRect(wx - 4, wy + wh + 2, ww + 8, 2);
  const sky = ctx.createLinearGradient(0, wy, 0, wy + wh);
  sky.addColorStop(0, '#6f87a8');
  sky.addColorStop(0.55, '#e8a86a');
  sky.addColorStop(1, '#f6d39a');
  ctx.fillStyle = sky;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.fillStyle = '#2f6a74';
  ctx.fillRect(wx, wy + wh - 20, ww, 20);
  ctx.fillStyle = '#fce9b8';
  ctx.fillRect(wx + 52, wy + wh - 26, 12, 4);
  ctx.fillStyle = 'rgba(255, 220, 150, 0.5)';
  ctx.fillRect(wx + 50, wy + wh - 22, 16, 8);
  ctx.fillStyle = 'rgba(38, 52, 46, 0.7)';
  ctx.fillRect(wx + 6, wy + wh - 22, 16, 3);
  ctx.fillRect(wx + 12, wy + wh - 27, 3, 6);
  ctx.fillRect(wx + 20, wy + wh - 25, 2, 4);
  ctx.fillStyle = 'rgba(255, 245, 214, 0.28)';
  ctx.fillRect(wx + 2, wy + 2, 20, 1);
  ctx.fillStyle = '#3b2415';
  ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh);
  ctx.fillRect(wx, wy + wh / 2 - 1, ww, 2);
  ctx.fillStyle = '#7a2430';
  ctx.fillRect(wx - 14, wy - 10, 12, wh + 24);
  ctx.fillRect(wx + ww + 2, wy - 10, 12, wh + 24);
  ctx.fillStyle = '#a03844';
  ctx.fillRect(wx - 12, wy - 8, 4, wh + 20);
  ctx.fillRect(wx + ww + 4, wy - 8, 4, wh + 20);
  ctx.fillStyle = '#c9a44a';
  ctx.fillRect(wx - 14, wy - 12, ww + 28, 5);
  ctx.fillStyle = '#4d3320';
  ctx.fillRect(wx - 8, wy + wh + 2, ww + 16, 8);
  ctx.fillStyle = '#77502f';
  ctx.fillRect(wx - 7, wy + wh + 2, ww + 14, 2);
  const blooms = ['#f9a8d4', '#fde68a', '#f8fafc', '#f472b6'];
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = '#3f7a3c';
    ctx.fillRect(wx - 4 + i * 12, wy + wh - 4, 2, 6);
    ctx.fillStyle = blooms[i % blooms.length];
    ctx.fillRect(wx - 6 + i * 12, wy + wh - 7, 5, 3);
  }

  // Haz de luz de la ventana.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const beam = ctx.createLinearGradient(wx + 10, wy + wh, wx + 40, H);
  beam.addColorStop(0, 'rgba(255, 214, 150, 0.2)');
  beam.addColorStop(1, 'rgba(255, 190, 120, 0)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(wx + 4, wy + wh);
  ctx.lineTo(wx + ww - 4, wy + wh);
  ctx.lineTo(wx + ww + 46, H);
  ctx.lineTo(wx - 40, H);
  ctx.closePath();
  ctx.fill();
  const pool = ctx.createRadialGradient(wx + 36, 212, 6, wx + 36, 212, 104);
  pool.addColorStop(0, 'rgba(255, 200, 130, 0.22)');
  pool.addColorStop(1, 'rgba(255, 190, 120, 0)');
  ctx.fillStyle = pool;
  ctx.fillRect(wx - 70, 108, 210, 190);
  ctx.restore();

  // Chimenea de piedra bajo el nicho de la luna.
  ctx.fillStyle = '#2a1c14';
  ctx.fillRect(198, 92, 48, 40);
  ctx.fillStyle = '#6a4a32';
  ctx.fillRect(200, 94, 44, 36);
  ctx.fillStyle = '#120a06';
  ctx.fillRect(208, 104, 28, 24);
  const flicker = reducedMotion ? 0.9 : 0.82 + Math.sin(elapsed * 4.7) * 0.1 + Math.sin(elapsed * 11.3) * 0.04;
  ctx.fillStyle = `rgba(255, 150, 60, ${flicker.toFixed(2)})`;
  ctx.beginPath();
  ctx.moveTo(212, 126);
  ctx.lineTo(222, 108);
  ctx.lineTo(232, 126);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f4d060';
  ctx.fillRect(218, 116, 4, 8);
  ctx.fillStyle = '#3a2414';
  ctx.fillRect(196, 90, 52, 6);
  ctx.fillStyle = '#8a5c34';
  ctx.fillRect(196, 90, 52, 2);

  // Retrato familiar y estante con frascos.
  ctx.fillStyle = '#2a180c';
  ctx.fillRect(256, 32, 50, 42);
  ctx.fillStyle = '#c9a44a';
  ctx.fillRect(258, 34, 46, 38);
  ctx.fillStyle = '#6d4a2b';
  ctx.fillRect(260, 36, 42, 34);
  ctx.fillStyle = '#d9c39a';
  ctx.fillRect(262, 38, 38, 30);
  ctx.fillStyle = 'rgba(96, 72, 46, 0.6)';
  ctx.fillRect(263, 39, 36, 3);
  ctx.fillStyle = '#4a3120';
  ctx.fillRect(272, 50, 6, 14);
  ctx.fillRect(273, 44, 4, 5);
  ctx.fillRect(286, 52, 6, 12);
  ctx.fillRect(288, 46, 3, 5);
  ctx.fillStyle = 'rgba(40, 24, 12, 0.4)';
  ctx.fillRect(262, 62, 38, 1);

  ctx.fillStyle = '#3a2414';
  ctx.fillRect(318, 40, 62, 3);
  ctx.fillStyle = '#6b4a2a';
  ctx.fillRect(318, 43, 62, 4);
  ctx.fillRect(322, 47, 3, 6);
  ctx.fillRect(372, 47, 3, 6);
  const jarColors = ['#9bbf7a', '#d8a24a', '#b45a3c'];
  for (let i = 0; i < 3; i++) {
    const jx = 326 + i * 17;
    ctx.fillStyle = jarColors[i];
    ctx.fillRect(jx, 31, 9, 10);
    ctx.fillStyle = 'rgba(255, 248, 220, 0.45)';
    ctx.fillRect(jx + 1, 32, 2, 6);
    ctx.fillStyle = '#5c3a20';
    ctx.fillRect(jx - 1, 29, 11, 3);
  }

  // Lámpara colgante de aceite.
  ctx.fillStyle = '#241408';
  ctx.fillRect(239, 8, 2, 18);
  ctx.fillStyle = '#8a5f30';
  ctx.beginPath();
  ctx.moveTo(232, 26);
  ctx.lineTo(248, 26);
  ctx.lineTo(244, 34);
  ctx.lineTo(236, 34);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(255, 214, 138, ${flicker.toFixed(2)})`;
  ctx.fillRect(237, 34, 6, 4);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lampGlow = ctx.createRadialGradient(240, 36, 2, 240, 36, 96);
  lampGlow.addColorStop(0, `rgba(255, 208, 132, ${(0.34 * flicker).toFixed(2)})`);
  lampGlow.addColorStop(1, 'rgba(255, 190, 110, 0)');
  ctx.fillStyle = lampGlow;
  ctx.fillRect(144, -60, 192, 192);
  ctx.restore();

  // Alfombra central de lana bordada (granate y oro).
  ctx.fillStyle = 'rgba(16, 8, 4, 0.28)';
  ctx.fillRect(150, 196, 176, 80);
  ctx.fillStyle = '#6a2428';
  ctx.fillRect(154, 198, 168, 76);
  ctx.fillStyle = '#c9a44a';
  ctx.fillRect(154, 198, 168, 3);
  ctx.fillRect(154, 271, 168, 3);
  ctx.fillRect(154, 198, 3, 76);
  ctx.fillRect(319, 198, 3, 76);
  ctx.fillStyle = '#8a3430';
  ctx.fillRect(164, 208, 148, 56);
  ctx.fillStyle = '#d4b06a';
  ctx.strokeStyle = '#d4b06a';
  ctx.lineWidth = 1;
  ctx.strokeRect(168, 212, 140, 48);
  ctx.strokeRect(176, 220, 124, 32);
  ctx.fillStyle = '#e8d090';
  ctx.beginPath();
  ctx.moveTo(238, 226);
  ctx.lineTo(250, 236);
  ctx.lineTo(238, 246);
  ctx.lineTo(226, 236);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#6a2428';
  ctx.beginPath();
  ctx.arc(238, 236, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d4b06a';
  for (let fy = 202; fy < 270; fy += 4) {
    ctx.fillRect(150, fy, 4, 2);
    ctx.fillRect(322, fy, 4, 2);
  }

  // Alfombra ovalada a la derecha.
  ctx.fillStyle = 'rgba(16, 8, 4, 0.22)';
  ctx.beginPath();
  ctx.ellipse(392, 236, 38, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7a5a28';
  ctx.beginPath();
  ctx.ellipse(390, 234, 36, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9a44a';
  ctx.beginPath();
  ctx.ellipse(390, 234, 28, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a3a18';
  ctx.beginPath();
  ctx.ellipse(390, 234, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Puerta al sur, con umbral cálido y felpudo.
  const dx0 = 206;
  const dy0 = 258;
  ctx.fillStyle = '#1c0f07';
  ctx.fillRect(dx0 - 6, dy0 - 6, 74, 48);
  ctx.fillStyle = '#4f3320';
  ctx.fillRect(dx0 - 3, dy0 - 3, 68, 45);
  ctx.fillStyle = '#6b482c';
  ctx.fillRect(dx0, dy0, 62, 42);
  for (let y = dy0 + 4; y < 296; y += 8) {
    ctx.fillStyle = 'rgba(46, 27, 14, 0.5)';
    ctx.fillRect(dx0 + 2, y, 58, 1);
  }
  ctx.fillStyle = '#8a5f3a';
  ctx.fillRect(dx0 + 31, dy0 + 2, 1, 40);
  ctx.fillStyle = '#d9a521';
  ctx.fillRect(dx0 + 48, dy0 + 22, 3, 4);
  ctx.fillStyle = 'rgba(255, 236, 160, 0.7)';
  ctx.fillRect(dx0 + 48, dy0 + 22, 1, 1);
  ctx.fillStyle = '#8d8779';
  ctx.fillRect(dx0 - 8, 296, 78, 4);
  ctx.fillStyle = 'rgba(255, 244, 220, 0.3)';
  ctx.fillRect(dx0 - 8, 296, 76, 1);
  ctx.fillStyle = '#2a5a38';
  ctx.fillRect(dx0 + 4, 284, 54, 10);
  ctx.fillStyle = '#3a7a4c';
  ctx.fillRect(dx0 + 5, 285, 52, 2);
  ctx.fillStyle = 'rgba(20, 40, 24, 0.45)';
  ctx.fillRect(dx0 + 5, 289, 52, 1);
}

function drawCabinFurniture(ctx: CanvasRenderingContext2D, elapsed: number, reducedMotion: boolean): void {
  // Cama de caoba con edredón y almohadas, junto a la pared oeste.
  const bx = 30;
  const by = 150;
  const bw = 112;
  const bh = 114;
  ctx.fillStyle = 'rgba(20, 12, 6, 0.28)';
  ctx.beginPath();
  ctx.ellipse(bx + bw * 0.55, by + bh - 2, bw * 0.62, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a180c';
  ctx.fillRect(bx, by, 12, bh);
  ctx.fillRect(bx + 2, by + bh - 10, bw - 2, 10);
  ctx.fillStyle = '#6b4226';
  ctx.fillRect(bx + 2, by + 2, 8, bh - 14);
  ctx.fillStyle = '#c9a44a';
  ctx.fillRect(bx + 3, by + 8, 6, 2);
  ctx.fillRect(bx + 3, by + 28, 6, 2);
  ctx.fillStyle = '#5c381f';
  ctx.fillRect(bx + 10, by + 18, bw - 14, bh - 32);
  ctx.fillStyle = '#efe4c8';
  ctx.fillRect(bx + 12, by + 20, bw - 18, bh - 38);
  ctx.fillStyle = '#f8f1dc';
  ctx.fillRect(bx + 14, by + 22, 32, 20);
  ctx.fillRect(bx + 18, by + 44, 28, 16);
  ctx.fillStyle = 'rgba(180, 160, 122, 0.45)';
  ctx.fillRect(bx + 14, by + 40, 32, 2);
  ctx.fillStyle = '#3f6a4c';
  ctx.fillRect(bx + 46, by + 22, bw - 52, bh - 42);
  ctx.fillStyle = '#528a62';
  for (let y = by + 28; y < by + bh - 28; y += 12) {
    ctx.fillRect(bx + 48, y, bw - 56, 3);
  }
  ctx.fillStyle = '#c96f4a';
  ctx.fillRect(bx + 62, by + 50, 24, 22);
  ctx.fillStyle = '#e0a15a';
  ctx.fillRect(bx + 66, by + 54, 16, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(bx + 46, by + 22, bw - 52, 4);
  ctx.fillStyle = '#3a2414';
  ctx.fillRect(bx + 8, by + 12, bw - 12, 6);
  ctx.fillStyle = '#8a6238';
  ctx.fillRect(bx + 10, by + 14, bw - 16, 2);
  ctx.fillStyle = '#24140c';
  for (let i = 0; i < 5; i++) ctx.fillRect(bx + 22 + i * 18, by + 2, 3, 14);

  // Mesita con lámpara de aceite al pie de la cama.
  ctx.fillStyle = '#3a2414';
  ctx.fillRect(26, 248, 22, 16);
  ctx.fillStyle = '#6b4428';
  ctx.fillRect(27, 249, 20, 4);
  ctx.fillStyle = '#c9a44a';
  ctx.fillRect(34, 253, 4, 2);
  ctx.fillStyle = '#8a5c30';
  ctx.fillRect(32, 242, 8, 8);
  ctx.fillStyle = '#f4d878';
  ctx.fillRect(34, 238, 4, 5);

  // Mesa de lectura con mantel, radio, libros y café.
  const tx = 318;
  const ty = 148;
  const tw = 86;
  const th = 58;
  ctx.fillStyle = 'rgba(20, 12, 6, 0.26)';
  ctx.beginPath();
  ctx.ellipse(tx + tw / 2, ty + th, tw * 0.55, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4d3320';
  ctx.fillRect(tx + 4, ty + 10, 6, th - 8);
  ctx.fillRect(tx + tw - 10, ty + 10, 6, th - 8);
  ctx.fillStyle = '#7d5738';
  ctx.fillRect(tx, ty, tw, 12);
  ctx.fillStyle = '#9a6f45';
  ctx.fillRect(tx, ty, tw, 2);
  ctx.fillStyle = '#e7d4ae';
  ctx.fillRect(tx + 4, ty + 10, tw - 8, 22);
  ctx.fillStyle = 'rgba(178, 84, 64, 0.65)';
  for (let x = tx + 10; x < tx + tw - 8; x += 12) ctx.fillRect(x, ty + 10, 4, 22);
  ctx.fillRect(tx + 4, ty + 18, tw - 8, 3);
  ctx.fillStyle = '#3a2468';
  ctx.fillRect(tx + 8, ty + 12, 10, 8);
  ctx.fillStyle = '#1d3d78';
  ctx.fillRect(tx + 11, ty + 10, 9, 8);
  ctx.fillStyle = '#e8d090';
  ctx.fillRect(tx + 13, ty + 11, 5, 6);
  ctx.fillStyle = '#3f5f6b';
  ctx.fillRect(tx + 12, ty - 2, 12, 10);
  ctx.fillStyle = '#5c8491';
  ctx.fillRect(tx + 13, ty - 1, 10, 2);
  ctx.fillStyle = '#2b424c';
  ctx.fillRect(tx + 24, ty + 1, 3, 5);
  ctx.fillStyle = '#c8dbe0';
  ctx.fillRect(tx + 15, ty + 7, 6, 2);
  ctx.fillStyle = '#3a2414';
  ctx.fillRect(tx + 34, ty - 4, 22, 14);
  ctx.fillStyle = '#a8732f';
  ctx.fillRect(tx + 35, ty - 3, 20, 12);
  ctx.fillStyle = '#f0d9a8';
  ctx.fillRect(tx + 37, ty - 1, 10, 5);
  ctx.fillStyle = '#2a1a10';
  for (let i = 0; i < 4; i++) ctx.fillRect(tx + 38 + i * 2, ty + 6, 1, 2);
  ctx.fillStyle = '#c9b27c';
  ctx.fillRect(tx + 50, ty + 4, 3, 3);
  ctx.fillStyle = '#8e8a80';
  ctx.fillRect(tx + 55, ty - 12, 1, 9);
  ctx.fillStyle = '#e8e2d2';
  ctx.fillRect(tx + 62, ty + 2, 8, 5);
  ctx.fillStyle = '#b7ad96';
  ctx.fillRect(tx + 63, ty + 7, 9, 2);
  ctx.fillStyle = '#e8e2d2';
  ctx.fillRect(tx + 69, ty + 3, 2, 2);
  ctx.fillStyle = '#5c3a21';
  ctx.fillRect(tx + 26, ty + 44, 24, 4);
  ctx.fillRect(tx + 26, ty + 48, 3, 16);
  ctx.fillRect(tx + 47, ty + 48, 3, 16);
  ctx.fillStyle = '#7d5530';
  ctx.fillRect(tx + 26, ty + 30, 3, 16);
  ctx.fillRect(tx + 27, ty + 32, 22, 3);
  ctx.fillStyle = '#7a2430';
  ctx.fillRect(tx + 28, ty + 34, 20, 8);

  drawCabinGuitar(ctx);
  drawCabinKeyboard(ctx);

  // Cocina económica / estufa de hierro contra la pared este.
  const kx = 404;
  const ky = 112;
  const kw = 64;
  const kh = 92;
  ctx.fillStyle = 'rgba(20, 12, 6, 0.3)';
  ctx.beginPath();
  ctx.ellipse(kx + kw / 2, ky + kh, kw * 0.6, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3e2a1a';
  ctx.fillRect(kx, ky + 8, kw, kh - 8);
  ctx.fillStyle = '#937f68';
  ctx.fillRect(kx - 2, ky + 4, kw + 4, 8);
  ctx.fillStyle = '#b5a48c';
  ctx.fillRect(kx - 2, ky + 4, kw + 4, 2);
  ctx.fillStyle = '#2f2014';
  ctx.fillRect(kx + 4, ky + 16, kw - 8, 34);
  ctx.fillStyle = '#5a5148';
  ctx.fillRect(kx + 8, ky + 10, 20, 4);
  ctx.fillRect(kx + 36, ky + 10, 20, 4);
  ctx.fillStyle = '#1b1410';
  ctx.fillRect(kx + 10, ky + 8, 16, 4);
  ctx.fillRect(kx + 38, ky + 8, 16, 4);
  ctx.fillStyle = '#3b3330';
  ctx.beginPath();
  ctx.ellipse(kx + 18, ky + 2, 11, 8, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6b615a';
  ctx.fillRect(kx + 8, ky - 6, 20, 2);
  ctx.fillStyle = '#2a221d';
  ctx.fillRect(kx + 4, ky - 8, 4, 4);
  const ember = reducedMotion ? 0.7 : 0.55 + Math.sin(elapsed * 6.1) * 0.2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const emberGlow = ctx.createRadialGradient(kx + 18, ky + 4, 1, kx + 18, ky + 4, 34);
  emberGlow.addColorStop(0, `rgba(255, 142, 60, ${(0.4 * ember).toFixed(2)})`);
  emberGlow.addColorStop(1, 'rgba(255, 120, 40, 0)');
  ctx.fillStyle = emberGlow;
  ctx.fillRect(kx - 18, ky - 32, 72, 72);
  ctx.restore();
  ctx.fillStyle = `rgba(255, 176, 92, ${ember.toFixed(2)})`;
  ctx.fillRect(kx + 12, ky + 4, 14, 3);
  ctx.fillStyle = '#4f3722';
  ctx.fillRect(kx + 6, ky + 56, 22, 26);
  ctx.fillRect(kx + 34, ky + 56, 22, 26);
  ctx.fillStyle = '#6b4a2a';
  ctx.fillRect(kx + 8, ky + 58, 18, 22);
  ctx.fillRect(kx + 36, ky + 58, 18, 22);
  ctx.fillStyle = '#d9a521';
  ctx.fillRect(kx + 24, ky + 68, 2, 3);
  ctx.fillRect(kx + 36, ky + 68, 2, 3);
  if (!reducedMotion) {
    for (let i = 0; i < 3; i++) {
      const st = (elapsed * 0.42 + i / 3) % 1;
      ctx.fillStyle = `rgba(236, 232, 220, ${(0.22 * (1 - st)).toFixed(2)})`;
      ctx.fillRect(Math.round(kx + 16 + Math.sin(st * 6 + i) * 5), Math.round(ky - 14 - st * 26), 2 + Math.round(st * 3), 2);
    }
  }
  ctx.fillStyle = '#3a2414';
  ctx.fillRect(kx - 2, 74, kw + 6, 3);
  ctx.fillStyle = '#6b4a2a';
  ctx.fillRect(kx - 2, 77, kw + 6, 3);
  for (let i = 0; i < 3; i++) {
    const px = kx + 4 + i * 20;
    ctx.fillStyle = i % 2 === 0 ? '#b06a3a' : '#8f8a7c';
    ctx.fillRect(px, 62, 16, 12);
    ctx.fillStyle = 'rgba(255, 226, 180, 0.45)';
    ctx.fillRect(px + 1, 63, 3, 9);
    ctx.fillStyle = '#3a2414';
    ctx.fillRect(px + 5, 58, 2, 4);
  }

  // Planta de interior en la esquina sureste, sobre la cocina.
  ctx.fillStyle = '#7c2d12';
  ctx.fillRect(448, 198, 16, 12);
  ctx.fillStyle = '#c2410c';
  ctx.fillRect(447, 196, 18, 4);
  ctx.fillStyle = '#14532d';
  ctx.beginPath();
  ctx.arc(456, 188, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(452, 184, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(460, 186, 5, 0, Math.PI * 2);
  ctx.fill();

  // Banco de lectura arrimado al borde sur de la mesa.
  ctx.fillStyle = '#3a2414';
  ctx.fillRect(338, 200, 24, 10);
  ctx.fillStyle = '#6b4428';
  ctx.fillRect(339, 201, 22, 3);
  ctx.fillStyle = '#7a2430';
  ctx.fillRect(340, 204, 20, 5);
}

/** Guitarra eléctrica roja de la familia, colgada de un clavo sobre la cama. */
function drawCabinGuitar(ctx: CanvasRenderingContext2D): void {
  if (!ctx) return;
  const cx = 52;
  ctx.save();

  // Clavo y cordón de cuero.
  ctx.fillStyle = '#1d1008';
  ctx.fillRect(cx - 1, 46, 3, 5);
  ctx.fillStyle = '#6b4a2a';
  ctx.fillRect(cx, 50, 1, 6);

  // Mástil de palo rosa con trastes claros.
  ctx.fillStyle = '#170c06';
  ctx.fillRect(cx - 3, 62, 7, 26);
  ctx.fillStyle = '#4a2a17';
  ctx.fillRect(cx - 2, 62, 5, 26);
  ctx.fillStyle = '#7d4a2b';
  ctx.fillRect(cx - 2, 62, 1, 26);
  ctx.fillStyle = 'rgba(226, 214, 190, 0.55)';
  for (let y = 67; y < 88; y += 5) ctx.fillRect(cx - 2, y, 5, 1);

  // Pala roja con clavijas de cromo.
  ctx.fillStyle = '#170c06';
  ctx.fillRect(cx - 6, 51, 13, 12);
  ctx.fillStyle = '#b3241c';
  ctx.fillRect(cx - 5, 52, 11, 10);
  ctx.fillStyle = '#e04a36';
  ctx.fillRect(cx - 4, 52, 9, 1);
  ctx.fillStyle = '#d7dbe2';
  ctx.fillRect(cx - 8, 54, 2, 2);
  ctx.fillRect(cx - 8, 58, 2, 2);
  ctx.fillRect(cx + 6, 54, 2, 2);
  ctx.fillRect(cx + 6, 58, 2, 2);
  ctx.fillStyle = '#8f949c';
  ctx.fillRect(cx - 8, 55, 2, 1);
  ctx.fillRect(cx + 6, 55, 2, 1);

  // Cuerpo sólido rojo con doble cutaway.
  const outline: [number, number][] = [
    [cx - 4, 84],
    [cx - 13, 87],
    [cx - 15, 97],
    [cx - 12, 107],
    [cx - 13, 117],
    [cx - 6, 124],
    [cx + 6, 124],
    [cx + 13, 117],
    [cx + 12, 107],
    [cx + 15, 97],
    [cx + 13, 87],
    [cx + 4, 84],
  ];
  const body: [number, number][] = [
    [cx - 4, 86],
    [cx - 11, 89],
    [cx - 13, 97],
    [cx - 10, 107],
    [cx - 11, 116],
    [cx - 5, 122],
    [cx + 5, 122],
    [cx + 11, 116],
    [cx + 10, 107],
    [cx + 13, 97],
    [cx + 11, 89],
    [cx + 4, 86],
  ];
  const trace = (pts: [number, number][]) => {
    if (!pts || pts.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p) ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
  };
  ctx.fillStyle = '#2a0a08';
  trace(outline);
  ctx.fill();
  ctx.fillStyle = '#c22a20';
  trace(body);
  ctx.fill();

  // Brillo del barniz en el lóbulo superior izquierdo.
  ctx.fillStyle = '#e04a36';
  ctx.beginPath();
  ctx.moveTo(cx - 9, 92);
  ctx.lineTo(cx - 3, 90);
  ctx.lineTo(cx - 3, 110);
  ctx.lineTo(cx - 8, 112);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 220, 200, 0.35)';
  ctx.fillRect(cx - 11, 90, 2, 8);
  ctx.fillRect(cx - 10, 88, 5, 1);

  // Golpeador perla.
  ctx.fillStyle = '#ece6d6';
  ctx.beginPath();
  ctx.moveTo(cx + 3, 94);
  ctx.lineTo(cx + 12, 100);
  ctx.lineTo(cx + 10, 113);
  ctx.lineTo(cx + 3, 116);
  ctx.lineTo(cx + 1, 106);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(160, 150, 130, 0.35)';
  ctx.fillRect(cx + 4, 96, 1, 18);

  // Pastillas dobles y puente cromado.
  const pyList = [96, 106];
  for (let pi = 0; pi < pyList.length; pi++) {
    const py = pyList[pi];
    ctx.fillStyle = '#171310';
    ctx.fillRect(cx - 7, py, 12, 4);
    ctx.fillStyle = '#c9ced6';
    for (let i = 0; i < 6; i++) ctx.fillRect(cx - 6 + i * 2, py + 1, 1, 2);
  }
  ctx.fillStyle = '#b9bfc8';
  ctx.fillRect(cx - 7, 116, 14, 3);
  ctx.fillStyle = '#6f7680';
  for (let i = 0; i < 6; i++) ctx.fillRect(cx - 6 + i * 2, 117, 1, 2);
  // Perillas de volumen y tono.
  ctx.fillStyle = '#dfe3e8';
  ctx.fillRect(cx + 8, 115, 3, 3);
  ctx.fillRect(cx + 8, 120, 3, 3);
  ctx.fillStyle = '#5c6169';
  ctx.fillRect(cx + 9, 116, 1, 1);
  ctx.fillRect(cx + 9, 121, 1, 1);

  // Palanca de vibrato.
  ctx.strokeStyle = '#c9ced6';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + 6, 118);
  ctx.lineTo(cx + 12, 124);
  ctx.lineTo(cx + 14, 121);
  ctx.stroke();

  // Cuerdas.
  ctx.fillStyle = 'rgba(236, 240, 246, 0.6)';
  ctx.fillRect(cx - 2, 60, 1, 57);
  ctx.fillRect(cx, 60, 1, 57);
  ctx.fillRect(cx + 2, 60, 1, 57);
  ctx.fillRect(cx + 4, 62, 1, 55);

  ctx.restore();
}

/** Teclado musical blanco sobre su banco, en el rincón del retrato. */
function drawCabinKeyboard(ctx: CanvasRenderingContext2D): void {
  const x = 252;
  const y = 100;
  const w = 56;

  ctx.save();

  // Sombra sobre la pared.
  ctx.fillStyle = 'rgba(16, 9, 4, 0.35)';
  ctx.fillRect(x - 2, y + 24, w + 4, 4);

  // Patas claras hasta el zócalo.
  ctx.fillStyle = '#8f897c';
  ctx.fillRect(x + 4, y + 16, 4, 17);
  ctx.fillRect(x + w - 8, y + 16, 4, 17);
  ctx.fillStyle = '#ddd6c6';
  ctx.fillRect(x + 5, y + 17, 2, 15);
  ctx.fillRect(x + w - 7, y + 17, 2, 15);

  // Mueble blanco marfil con contorno gris cálido.
  ctx.fillStyle = '#5a544a';
  ctx.fillRect(x - 1, y - 1, w + 2, 19);
  ctx.fillStyle = '#ece7da';
  ctx.fillRect(x, y, w, 17);
  ctx.fillStyle = '#fbf7ec';
  ctx.fillRect(x, y, w, 3);
  ctx.fillStyle = '#c9c2b2';
  ctx.fillRect(x, y + 14, w, 3);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 1, y, w - 2, 1);

  // Fieltro rojo bajo las teclas.
  ctx.fillStyle = '#a83226';
  ctx.fillRect(x + 3, y + 4, w - 6, 3);

  // Teclas blancas con separaciones y teclas negras en patrón de piano.
  const keysY = y + 6;
  const keysW = w - 6;
  ctx.fillStyle = '#f8f3e6';
  ctx.fillRect(x + 3, keysY, keysW, 7);
  ctx.fillStyle = 'rgba(140, 130, 112, 0.5)';
  for (let i = 1; i < 14; i++) {
    ctx.fillRect(x + 3 + Math.round((i * keysW) / 14), keysY, 1, 7);
  }
  // Negras: dos, tres, dos, tres...
  const blackPattern = [1, 2, 4, 5, 6, 8, 9, 11, 12, 13];
  ctx.fillStyle = '#1f1a16';
  for (const k of blackPattern) {
    const kx = x + 3 + Math.round((k * keysW) / 14) - 1;
    ctx.fillRect(kx, keysY, 2, 4);
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.fillRect(x + 3, keysY, keysW, 1);

  // Nombre grabado en metal y un par de perillas.
  ctx.fillStyle = '#9aa0a8';
  ctx.fillRect(x + w - 15, y + 1, 11, 2);
  ctx.fillStyle = '#3a3630';
  ctx.fillRect(x + 5, y + 1, 2, 2);
  ctx.fillRect(x + 10, y + 1, 2, 2);

  // Reflejo cálido de la lámpara sobre el mueble.
  ctx.fillStyle = 'rgba(255, 214, 150, 0.16)';
  ctx.fillRect(x + 4, y + 2, 20, 2);

  ctx.restore();
}

/** Mochila de lona colgada del clavo, con brillo suave para que se descubra. */
function drawCabinBackpack(ctx: CanvasRenderingContext2D, elapsed: number, reducedMotion: boolean): void {
  const { x, y } = ISLA_NATAL_CABIN.backpack;
  const bob = reducedMotion ? 0 : Math.sin(elapsed * 1.6) * 0.6;
  ctx.save();
  ctx.translate(0, Math.round(bob));
  // Clavo y correas.
  ctx.fillStyle = '#241408';
  ctx.fillRect(x - 1, y - 12, 3, 5);
  ctx.fillStyle = '#8a6a45';
  ctx.fillRect(x, y - 9, 1, 3);
  ctx.fillStyle = '#6b4728';
  ctx.fillRect(x - 9, y - 8, 3, 14);
  ctx.fillRect(x + 7, y - 8, 3, 14);
  // Cuerpo de lona.
  ctx.fillStyle = 'rgba(20, 12, 6, 0.35)';
  ctx.fillRect(x - 11, y - 6, 24, 32);
  ctx.fillStyle = '#8c5835';
  ctx.fillRect(x - 12, y - 7, 24, 31);
  ctx.fillStyle = '#a86c42';
  ctx.fillRect(x - 10, y - 5, 20, 9);
  ctx.fillStyle = '#72452a';
  ctx.fillRect(x - 12, y + 4, 24, 3);
  // Solapa y hebilla.
  ctx.fillStyle = '#9c6239';
  ctx.fillRect(x - 10, y + 8, 20, 6);
  ctx.fillStyle = '#d9a521';
  ctx.fillRect(x - 2, y + 10, 4, 3);
  ctx.fillStyle = '#f4d27a';
  ctx.fillRect(x - 1, y + 10, 1, 1);
  // Bolsillo y costuras.
  ctx.fillStyle = '#a06c45';
  ctx.fillRect(x - 7, y + 15, 14, 7);
  ctx.fillStyle = '#7a4f31';
  ctx.fillRect(x - 7, y + 15, 14, 1);
  ctx.fillStyle = 'rgba(255, 224, 180, 0.35)';
  ctx.fillRect(x - 11, y - 6, 1, 24);
  ctx.fillRect(x - 11, y + 14, 23, 1);
  // Asa superior.
  ctx.fillStyle = '#5c3a22';
  ctx.fillRect(x - 4, y - 12, 8, 2);
  ctx.fillRect(x - 6, y - 10, 2, 4);
  ctx.fillRect(x + 4, y - 10, 2, 4);
  ctx.restore();
}

/** El cofre del abuelo, bajo el retrato familiar, con su cerradura de cuatro discos. */
function drawCabinChest(
  ctx: CanvasRenderingContext2D,
  opened: boolean,
  elapsed: number,
  reducedMotion: boolean
): void {
  const { x, y } = ISLA_NATAL_CABIN.chest;
  // Pozo de luz cálida para separar el cofre del parquet.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(x, y + 4, 2, x, y + 4, 42);
  glow.addColorStop(0, opened ? 'rgba(255, 214, 138, 0.16)' : 'rgba(255, 196, 110, 0.2)');
  glow.addColorStop(1, 'rgba(255, 170, 80, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 44, y - 38, 88, 84);
  ctx.restore();

  if (opened) {
    // Tapa levantada contra la pared: sin ella el cofre abierto se confundía
    // con un banco. Se dibuja detrás del cuerpo, con sus herrajes dorados.
    ctx.fillStyle = '#2a1a0e';
    ctx.fillRect(x - 15, y - 29, 30, 10);
    ctx.fillStyle = '#8b4e20';
    ctx.fillRect(x - 14, y - 28, 28, 8);
    ctx.fillStyle = '#b4672e';
    ctx.fillRect(x - 14, y - 28, 28, 2);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(x - 10, y - 28, 2, 8);
    ctx.fillRect(x + 8, y - 28, 2, 8);
    ctx.fillStyle = '#070b14';
    ctx.fillRect(x - 9, y - 20, 3, 2);
    ctx.fillRect(x + 6, y - 20, 3, 2);
  }

  drawRpgTreasureChest(ctx, x, y, opened, '#facc15', elapsed, reducedMotion);

  if (opened) {
    // Carta y fotografía asomando del interior de terciopelo.
    ctx.fillStyle = '#f4e6c4';
    ctx.fillRect(x - 9, y - 13, 12, 6);
    ctx.fillStyle = '#d8c49a';
    ctx.fillRect(x - 9, y - 11, 12, 1);
    ctx.fillStyle = '#2f4a6a';
    ctx.fillRect(x + 3, y - 15, 9, 8);
    ctx.fillStyle = '#bcd2e6';
    ctx.fillRect(x + 4, y - 14, 7, 2);
    ctx.fillStyle = '#e8d7b4';
    ctx.fillRect(x + 5, y - 11, 4, 3);
  } else if (!reducedMotion && Math.floor(elapsed * 2.2) % 4 === 0) {
    // La cerradura devuelve un destello: el cofre sabe que ya puedes abrirlo.
    ctx.fillStyle = '#fff6cf';
    ctx.fillRect(x + 1, y - 10, 2, 2);
  }
}

/** Radio encendida sobre la mesa: dial cálido y ondas de sonido. */
function drawCabinRadioLive(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  reducedMotion: boolean
): void {
  const rx = 363;
  const ry = 149;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.5 + Math.sin(elapsed * 3.1) * 0.25;
  const glow = ctx.createRadialGradient(rx, ry, 1, rx, ry, 26);
  glow.addColorStop(0, `rgba(255, 206, 130, ${(0.3 * pulse).toFixed(3)})`);
  glow.addColorStop(1, 'rgba(255, 180, 90, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(rx - 28, ry - 24, 56, 48);

  // Ondas que salen del altavoz.
  for (let i = 0; i < 3; i++) {
    const p = ((reducedMotion ? 0.5 : elapsed * 0.9) + i / 3) % 1;
    ctx.strokeStyle = `rgba(255, 214, 150, ${((1 - p) * 0.4).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(rx + 7, ry + 2, 6 + p * 24, -0.8, 0.6);
    ctx.stroke();
  }

  // Dial encendido.
  ctx.fillStyle = `rgba(255, 236, 190, ${(0.55 + pulse * 0.35).toFixed(3)})`;
  ctx.fillRect(rx - 6, ry - 2, 4, 2);
  ctx.restore();
}

/** Interferencia y estática en la radio antes de que se corte la transmisión. */
function drawCabinRadioStatic(
  ctx: CanvasRenderingContext2D,
  staticElapsed: number,
  elapsed: number,
  reducedMotion: boolean
): void {
  const rx = 363;
  const ry = 149;
  const cutProgress = Math.min(1, staticElapsed / 2.6);
  const alive = cutProgress < 0.88;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  if (alive) {
    const jitter = reducedMotion ? 0.6 : Math.abs(Math.sin(elapsed * 31.7 + staticElapsed * 19));
    const glow = ctx.createRadialGradient(rx, ry, 1, rx, ry, 28);
    glow.addColorStop(0, `rgba(103, 232, 249, ${(0.36 * jitter).toFixed(3)})`);
    glow.addColorStop(0.55, `rgba(244, 63, 94, ${(0.22 * (1 - jitter)).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(rx - 30, ry - 26, 60, 52);

    // Arcos quebrados de estática y chispas de señal interrumpida.
    for (let i = 0; i < 4; i++) {
      const seed = hash2(Math.floor(elapsed * 24) + i * 13, i * 7);
      if (seed < 0.25) continue;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(103, 232, 249, 0.72)' : 'rgba(251, 113, 133, 0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const baseX = rx + 4 + (seed - 0.5) * 14;
      const baseY = ry - 4 + ((i % 3) - 1) * 5;
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(baseX + 5 - (i % 2) * 9, baseY - 5);
      ctx.lineTo(baseX + 9 - (i % 2) * 14, baseY - 2);
      ctx.lineTo(baseX + 13 - (i % 2) * 18, baseY - 9);
      ctx.stroke();
    }

    // Dial parpadeante antes del apagón definitivo.
    if (Math.floor(elapsed * 18) % 3 !== 0) {
      ctx.fillStyle = Math.floor(elapsed * 22) % 2 === 0 ? '#67e8f9' : '#fda4af';
      ctx.fillRect(rx - 6, ry - 2, 4, 2);
    }
  } else {
    // Última chispa al cortarse por completo la emisora.
    const fade = Math.max(0, 1 - (cutProgress - 0.88) / 0.12);
    ctx.fillStyle = `rgba(226, 232, 240, ${(0.5 * fade).toFixed(3)})`;
    ctx.fillRect(rx - 5, ry - 2, 3, 2);
  }

  ctx.restore();
}

export function renderIslaNatalCabin(params: IslaNatalCabinRenderParams): void {
  const { ctx, vw, vh, camera, elapsed, reducedMotion } = params;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#080604';
  ctx.fillRect(0, 0, vw, vh);

  ctx.save();
  ctx.translate(-Math.round(camera.x), -Math.round(camera.y));
  drawCabinShell(ctx, elapsed, reducedMotion);
  drawCabinFurniture(ctx, elapsed, reducedMotion);
  drawCabinChest(ctx, params.chestOpened, elapsed, reducedMotion);
  if (params.radioOn) drawCabinRadioLive(ctx, elapsed, reducedMotion);
  if (params.radioStatic) {
    drawCabinRadioStatic(ctx, params.radioStatic.t, elapsed, reducedMotion);
  }
  if (params.backpackOnHook) drawCabinBackpack(ctx, elapsed, reducedMotion);
  drawPlayer(ctx, params, elapsed);
  if (params.prompt) {
    const bob = reducedMotion ? 0 : (Math.floor(elapsed * 3.2) % 2 === 0 ? 0 : -2);
    drawPromptBadge(ctx, params.prompt, bob);
  }
  ctx.restore();

  // Calidez interior: viñeta de madera y polvo flotando en la luz.
  const vig = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.26, vw / 2, vh / 2, Math.max(vw, vh) * 0.72);
  vig.addColorStop(0, 'rgba(24, 12, 4, 0)');
  vig.addColorStop(1, 'rgba(12, 6, 2, 0.62)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, vw, vh);
  const grade = ctx.createLinearGradient(0, 0, 0, vh);
  grade.addColorStop(0, 'rgba(255, 176, 96, 0.05)');
  grade.addColorStop(0.5, 'rgba(255, 150, 80, 0.015)');
  grade.addColorStop(1, 'rgba(40, 18, 8, 0.16)');
  ctx.fillStyle = grade;
  ctx.fillRect(0, 0, vw, vh);

  // Parpadeo sutil de la lámpara durante la interferencia de la radio.
  if (params.radioStatic && !reducedMotion) {
    const flickerCut = Math.sin(elapsed * 29) > 0.55 ? 0.18 : 0.04;
    ctx.fillStyle = `rgba(8, 12, 24, ${flickerCut.toFixed(3)})`;
    ctx.fillRect(0, 0, vw, vh);
  }

  // Secuencia cinematográfica de rayos, tormenta y acontecimientos extraños del Reinicio Cero.
  if (params.storm) {
    const st = params.storm.t;
    const dark = Math.min(0.58, 0.16 + Math.min(1, st / 1.4) * 0.36);
    ctx.fillStyle = `rgba(7, 11, 24, ${dark.toFixed(3)})`;
    ctx.fillRect(0, 0, vw, vh);

    const wx0 = 94 - Math.round(camera.x);
    const wy0 = 26 - Math.round(camera.y);
    const ww = 84;
    const wh = 60;

    // Cielo tormentoso y grieta dimensional del Reinicio Cero tras los cristales de la ventana.
    ctx.save();
    ctx.beginPath();
    ctx.rect(wx0, wy0, ww, wh);
    ctx.clip();

    const stormSky = ctx.createLinearGradient(0, wy0, 0, wy0 + wh);
    const anomalyPhase = Math.max(0, Math.min(1, (st - 1.7) / 2.2));
    stormSky.addColorStop(0, anomalyPhase > 0.2 ? '#1e0b2e' : '#091122');
    stormSky.addColorStop(0.58, anomalyPhase > 0.2 ? '#3b0f36' : '#13223b');
    stormSky.addColorStop(1, '#091829');
    ctx.fillStyle = stormSky;
    ctx.fillRect(wx0, wy0, ww, wh);

    // Lluvia diagonal azotando el cristal.
    if (!reducedMotion) {
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.38)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        const rx = wx0 + ((i * 19 + Math.floor(elapsed * 130)) % (ww + 18)) - 8;
        const ry = wy0 + ((i * 23 + Math.floor(elapsed * 190)) % (wh + 12)) - 6;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 5, ry + 11);
        ctx.stroke();
      }
    }

    // Grieta carmesí/cian del Reinicio Cero abriéndose sobre el horizonte exterior.
    if (anomalyPhase > 0.04) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const riftGlow = ctx.createRadialGradient(
        wx0 + 46,
        wy0 + 22,
        2,
        wx0 + 46,
        wy0 + 22,
        44
      );
      riftGlow.addColorStop(0, `rgba(244, 63, 94, ${(0.72 * anomalyPhase).toFixed(3)})`);
      riftGlow.addColorStop(0.5, `rgba(168, 85, 247, ${(0.45 * anomalyPhase).toFixed(3)})`);
      riftGlow.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = riftGlow;
      ctx.fillRect(wx0, wy0, ww, wh);

      ctx.strokeStyle = `rgba(254, 205, 211, ${(0.85 * anomalyPhase).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(wx0 + 16, wy0 + 14);
      ctx.lineTo(wx0 + 34, wy0 + 20);
      ctx.lineTo(wx0 + 48, wy0 + 16);
      ctx.lineTo(wx0 + 68, wy0 + 26);
      ctx.stroke();
      ctx.restore();
    }

    // Rejilla de madera de la ventana sobre el cristal tormentoso.
    ctx.fillStyle = '#24140b';
    ctx.fillRect(wx0 + ww / 2 - 1, wy0, 2, wh);
    ctx.fillRect(wx0, wy0 + wh / 2 - 1, ww, 2);
    ctx.restore();

    // Acontecimientos extraños en el interior: motas antigravitatorias y pulso cromático del Reinicio Cero.
    if (anomalyPhase > 0.08) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const roomRift = ctx.createRadialGradient(
        wx0 + 42,
        wy0 + 30,
        6,
        wx0 + 42,
        wy0 + 30,
        260
      );
      roomRift.addColorStop(0, `rgba(244, 63, 94, ${(0.24 * anomalyPhase).toFixed(3)})`);
      roomRift.addColorStop(0.48, `rgba(56, 189, 248, ${(0.14 * anomalyPhase).toFixed(3)})`);
      roomRift.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = roomRift;
      ctx.fillRect(0, 0, vw, vh);

      if (!reducedMotion) {
        for (let i = 0; i < 18; i++) {
          const seedX = hash2(i * 17, 5);
          const seedY = hash2(i * 29, 11);
          const mx = Math.round(seedX * vw);
          const lift = ((elapsed * 36 + seedY * vh) % vh);
          const my = Math.round(vh - lift);
          ctx.fillStyle =
            i % 3 === 0
              ? `rgba(103, 232, 249, ${(0.52 * anomalyPhase).toFixed(3)})`
              : i % 3 === 1
                ? `rgba(244, 114, 182, ${(0.46 * anomalyPhase).toFixed(3)})`
                : `rgba(253, 224, 71, ${(0.4 * anomalyPhase).toFixed(3)})`;
          ctx.fillRect(mx, my, i % 4 === 0 ? 3 : 2, i % 4 === 0 ? 3 : 2);
        }

        for (let b = 0; b < 4; b++) {
          const bandSeed = hash2(Math.floor(elapsed * 14) + b * 23, b);
          if (bandSeed < 0.52) continue;
          const by = Math.round(bandSeed * vh);
          ctx.fillStyle =
            b % 2 === 0
              ? `rgba(103, 232, 249, ${(0.16 * anomalyPhase).toFixed(3)})`
              : `rgba(244, 63, 94, ${(0.14 * anomalyPhase).toFixed(3)})`;
          ctx.fillRect(0, by, vw, 2 + (b % 2));
        }
      }
      ctx.restore();
    }

    const gaussian = (center: number, spread: number) => {
      const d = (st - center) / spread;
      return Math.exp(-d * d);
    };
    const flash = Math.max(
      gaussian(0.32, 0.1),
      gaussian(1.35, 0.13),
      gaussian(2.65, 0.15),
      gaussian(3.85, 0.14),
      gaussian(5.1, 0.16)
    );
    if (flash > 0.01) {
      // Luz eléctrica que entra por la ventana y recorre toda la habitación.
      const wx = 136 - Math.round(camera.x);
      const wy = 56 - Math.round(camera.y);
      const crimsonTint = st > 2.2;
      const beam = ctx.createRadialGradient(wx, wy, 6, wx, wy, 320);
      beam.addColorStop(
        0,
        crimsonTint
          ? `rgba(255, 210, 235, ${(flash * 0.72).toFixed(3)})`
          : `rgba(196, 238, 255, ${(flash * 0.68).toFixed(3)})`
      );
      beam.addColorStop(
        0.42,
        crimsonTint
          ? `rgba(244, 114, 182, ${(flash * 0.32).toFixed(3)})`
          : `rgba(140, 200, 245, ${(flash * 0.3).toFixed(3)})`
      );
      beam.addColorStop(1, 'rgba(120, 180, 230, 0)');
      ctx.fillStyle = beam;
      ctx.fillRect(0, 0, vw, vh);

      ctx.fillStyle = crimsonTint
        ? `rgba(255, 228, 242, ${(flash * 0.28).toFixed(3)})`
        : `rgba(226, 245, 255, ${(flash * 0.3).toFixed(3)})`;
      ctx.fillRect(0, 0, vw, vh);

      // Rayos bifurcados dibujados dentro del marco de la ventana.
      const strike = Math.max(
        Math.exp(-Math.pow((st - 0.32) / 0.06, 2)),
        Math.exp(-Math.pow((st - 1.35) / 0.06, 2)),
        Math.exp(-Math.pow((st - 2.65) / 0.065, 2)),
        Math.exp(-Math.pow((st - 5.1) / 0.07, 2))
      );
      if (strike > 0.05) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = crimsonTint
          ? `rgba(255, 240, 248, ${(strike * 0.96).toFixed(3)})`
          : `rgba(240, 253, 255, ${(strike * 0.95).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(wx0 + 54, wy0 + 2);
        ctx.lineTo(wx0 + 48, wy0 + 14);
        ctx.lineTo(wx0 + 55, wy0 + 16);
        ctx.lineTo(wx0 + 42, wy0 + 38);
        ctx.lineTo(wx0 + 48, wy0 + 40);
        ctx.lineTo(wx0 + 36, wy0 + 58);
        ctx.stroke();
        ctx.strokeStyle = crimsonTint
          ? `rgba(244, 63, 94, ${(strike * 0.58).toFixed(3)})`
          : `rgba(150, 226, 255, ${(strike * 0.5).toFixed(3)})`;
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.restore();
      }

      // Destello intenso de impacto.
      const blind = Math.max(
        Math.exp(-Math.pow((st - 0.3) / 0.055, 2)),
        Math.exp(-Math.pow((st - 5.08) / 0.06, 2)) * 0.78
      );
      if (blind > 0.01 && !reducedMotion) {
        ctx.fillStyle = `rgba(255, 255, 255, ${(blind * 0.72).toFixed(3)})`;
        ctx.fillRect(0, 0, vw, vh);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* SPRITES DE ÁRBOLES DE ISLA NATAL (INTEGRACIÓN AL TERRENO)          */
/* ------------------------------------------------------------------ */

let natalTreeSprite1: HTMLImageElement | null = null;
let natalTreeSprite2: HTMLImageElement | null = null;
let natalTreeBaked1: [HTMLCanvasElement, HTMLCanvasElement] | null = null;
let natalTreeBaked2: [HTMLCanvasElement, HTMLCanvasElement] | null = null;

function bakeIntegratedTreeCanvas(img: HTMLImageElement, flipX: boolean): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || !img.complete || img.naturalWidth <= 0) return null;
  const size = 88;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const bctx = canvas.getContext('2d');
  if (!bctx) return null;

  bctx.save();
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  if (flipX) {
    bctx.translate(size, 0);
    bctx.scale(-1, 1);
  }
  bctx.drawImage(img, 0, 0, size, size);
  bctx.restore();

  // Tinte direccional de hora dorada idéntico al del terreno (sol cálido siempre desde el oeste)
  bctx.globalCompositeOperation = 'source-atop';
  const sunGrad = bctx.createLinearGradient(0, 0, size, size);
  sunGrad.addColorStop(0, 'rgba(255, 224, 152, 0.14)');
  sunGrad.addColorStop(0.45, 'rgba(255, 236, 190, 0.03)');
  sunGrad.addColorStop(1, 'rgba(16, 48, 40, 0.18)');
  bctx.fillStyle = sunGrad;
  bctx.fillRect(0, 0, size, size);

  // Sombra ambiental en la base de las raíces para fundirse con el suelo húmedo/pradera
  const rootGrad = bctx.createLinearGradient(0, size * 0.78, 0, size);
  rootGrad.addColorStop(0, 'rgba(22, 42, 20, 0)');
  rootGrad.addColorStop(1, 'rgba(22, 42, 20, 0.28)');
  bctx.fillStyle = rootGrad;
  bctx.fillRect(0, size * 0.78, size, size * 0.22);
  bctx.globalCompositeOperation = 'source-over';

  // Limpieza de bordes semitransparentes para evitar halos sobre césped/sendero pixel-art
  const imgData = bctx.getImageData(0, 0, size, size);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 42) {
      d[i + 3] = 0;
    } else if (a < 150) {
      d[i + 3] = Math.round(a * 0.85);
    } else {
      d[i + 3] = 255;
    }
  }
  bctx.putImageData(imgData, 0, 0);
  return canvas;
}

function ensureNatalTreeSprites(): [
  [HTMLCanvasElement, HTMLCanvasElement] | null,
  [HTMLCanvasElement, HTMLCanvasElement] | null,
] {
  if (typeof Image === 'undefined') return [null, null];
  if (!natalTreeSprite1) {
    natalTreeSprite1 = new Image();
    natalTreeSprite1.decoding = 'async';
    natalTreeSprite1.src = '/assets/pixelverse/natal-tree-1.png';
  }
  if (!natalTreeSprite2) {
    natalTreeSprite2 = new Image();
    natalTreeSprite2.decoding = 'async';
    natalTreeSprite2.src = '/assets/pixelverse/natal-tree-2.png';
  }
  if (!natalTreeBaked1 && natalTreeSprite1.complete && natalTreeSprite1.naturalWidth > 0) {
    const normal = bakeIntegratedTreeCanvas(natalTreeSprite1, false);
    const flipped = bakeIntegratedTreeCanvas(natalTreeSprite1, true);
    if (normal && flipped) natalTreeBaked1 = [normal, flipped];
  }
  if (!natalTreeBaked2 && natalTreeSprite2.complete && natalTreeSprite2.naturalWidth > 0) {
    const normal = bakeIntegratedTreeCanvas(natalTreeSprite2, false);
    const flipped = bakeIntegratedTreeCanvas(natalTreeSprite2, true);
    if (normal && flipped) natalTreeBaked2 = [normal, flipped];
  }
  return [natalTreeBaked1, natalTreeBaked2];
}

/* ------------------------------------------------------------------ */
/* CUADRO COMPLETO                                                    */
/* ------------------------------------------------------------------ */

export function renderIslaNatalFrame(params: IslaNatalRenderParams): void {
  const {
    ctx,
    vw,
    vh,
    camera,
    elapsed,
    reducedMotion,
    arcadeState,
    charge,
    signalPulse,
    paddleOnGround,
    departureReady,
    particles,
    prompt,
    shockwaves,
    travelerEvent,
  } = params;
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;

  const animFrame4 = reducedMotion ? 0 : Math.floor(elapsed * 3.2) % 4;
  const camX = Math.round(camera.x);
  const camY = Math.round(camera.y);

  // Fondo de mar profundo (cubre todo el viewport antes de trasladar)
  ctx.fillStyle = '#0a2b46';
  ctx.fillRect(0, 0, vw, vh);

  ctx.save();
  ctx.translate(-camX, -camY);

  drawOcean(ctx, camX, camY, vw, vh, elapsed, animFrame4, charge, reducedMotion);
  drawLandmass(ctx, camX, camY, vw, vh, elapsed);
  drawCoastalSeaRocks(ctx, camX, camY, vw, vh, elapsed, reducedMotion);

  // Muelle del Puerto Norte: se dibuja como parte del suelo para que el
  // jugador pueda caminar sobre los tablones sin quedar oculto por la pasarela.
  drawNorthPortDock(ctx, elapsed, departureReady, reducedMotion);
  drawBeachBoardwalk(ctx);

  // Detalle de suelo (matas, flores, guijarros, conchas)
  const sway = reducedMotion ? 0 : Math.round(Math.sin(elapsed * 1.4) * 0.6);
  for (const t of ISLA_NATAL_TUFTS) {
    if (!isWorldBoxVisible(t.x - 6, t.y - 10, 12, 12, camX, camY, vw, vh)) continue;
    if (!isPointOnNatalMeadow(t.x, t.y)) continue;
    drawTuft(ctx, t.x, t.y, t.seed, sway);
  }
  for (const f of ISLA_NATAL_FLOWERS) {
    if (!isWorldBoxVisible(f.x - 4, f.y - 8, 8, 10, camX, camY, vw, vh)) continue;
    if (!isPointOnNatalMeadow(f.x, f.y)) continue;
    drawFlower(ctx, f.x, f.y, f.seed);
  }
  for (const p of ISLA_NATAL_PEBBLES) {
    if (!isWorldBoxVisible(p.x - 10, p.y - 10, 20, 16, camX, camY, vw, vh)) continue;
    drawPebble(ctx, p.x, p.y, p.seed);
  }
  for (const s of ISLA_NATAL_SHELLS) {
    if (!isWorldBoxVisible(s.x - 4, s.y - 4, 8, 8, camX, camY, vw, vh)) continue;
    drawShell(ctx, s.x, s.y, s.seed);
  }

  // Elementos ordenados por profundidad (oclusión correcta con el jugador)
  const ySorted: { sortY: number; draw: () => void }[] = [];
  const [treeSpriteOak, treeSpriteTall] = ensureNatalTreeSprites();

  const drawHandcraftedTreeNatal = (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    variant: 'forest' | 'meadow' | 'pine',
    treeIndex: number,
    elapsed: number,
    reducedMotion: boolean
  ) => {
    const x = Math.round(cx);
    const y = Math.round(cy);
    const seed = hash2(x + treeIndex * 17, y - treeIndex * 13);
    const useTallVariant =
      variant === 'pine' ? true : variant === 'meadow' ? false : treeIndex % 2 === 1;
    const spritePair = useTallVariant ? treeSpriteTall : treeSpriteOak;
    const flipped = seed > 0.54;
    const sprite = spritePair ? spritePair[flipped ? 1 : 0] : null;

    // 15% a 30% de variación aleatoria en escala para destruir repetición
    const sizeScale = 0.85 + seed * 0.30;
    const baseSize = useTallVariant ? 80 : 84;
    const size = Math.round(baseSize * sizeScale);

    // Inclinación orgánica y oscilación de brisa
    const windShear = reducedMotion
      ? 0
      : Math.sin(elapsed * 1.15 + cx * 0.045 + cy * 0.02) * 0.016;
    const organicTilt = (hash2(x + 47, y - 31) - 0.48) * 0.07;
    const totalShear = windShear + organicTilt;
    const shadowShift = Math.round(-totalShear * 42);

    ctx.save();
    ctx.translate(x, y);

    // 1. Sombra moteada del dosel proyectada al este-sureste
    ctx.fillStyle = 'rgba(14, 38, 22, 0.18)';
    ctx.beginPath();
    ctx.ellipse(15 + shadowShift, 4, size * 0.42, size * 0.14, 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(14, 38, 22, 0.15)';
    ctx.beginPath();
    ctx.ellipse(24 + shadowShift, 1, size * 0.25, size * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Oclusión ambiental profunda y sombra de contacto oscura bajo el tronco
    ctx.fillStyle = 'rgba(6, 18, 10, 0.65)';
    ctx.beginPath();
    ctx.ellipse(0, 3, size * 0.32, size * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();

    // Núcleo más oscuro de contacto directo
    ctx.fillStyle = 'rgba(2, 8, 4, 0.74)';
    ctx.beginPath();
    ctx.ellipse(0, 3, size * 0.18, size * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();

    // Lecho de mantillo y tierra fértil donde brotan las raíces
    ctx.fillStyle = 'rgba(54, 34, 16, 0.58)';
    ctx.fillRect(-13, 1, 26, 4);

    // Raíces leñosas visibles (root flares) extendiéndose a los lados
    ctx.fillStyle = '#2b1708';
    ctx.beginPath();
    ctx.moveTo(-6, -4);
    ctx.lineTo(-14, 3);
    ctx.lineTo(-11, 4);
    ctx.lineTo(-2, 0);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(6, -4);
    ctx.lineTo(14, 3);
    ctx.lineTo(11, 4);
    ctx.lineTo(2, 0);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#366b31';
    ctx.fillRect(-16, 0, 8, 2);
    ctx.fillRect(9, 1, 8, 2);

    // 3. Dibujo del árbol con variación orgánica de tono y brillo
    if (sprite) {
      ctx.save();
      ctx.translate(0, 6);
      ctx.transform(1, 0, totalShear, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;

      // Variación sutil de color y matiz por semilla (sin alterar paleta base)
      const tintVal = (hash2(x - 29, y + 19) - 0.5) * 14;
      const brightness = 96 + Math.round(seed * 8);
      ctx.filter = `hue-rotate(${Math.round(tintVal)}deg) brightness(${brightness}%)`;
      ctx.drawImage(sprite, Math.round(-size * 0.5), Math.round(-size * 0.94), size, size);
      ctx.filter = 'none';
      ctx.restore();
    } else {
      ctx.fillStyle = '#4a2a14';
      ctx.fillRect(-5, -14, 10, 16);
      ctx.fillStyle = '#1f6a34';
      ctx.beginPath();
      ctx.ellipse(0, -34, 24, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Sotobosque espeso al pie: briznas, helechos, hojarasca y pequeñas piedras
    const grassOffsets = [-17, -11, -5, 2, 8, 14];
    for (let gi = 0; gi < grassOffsets.length; gi++) {
      const gx = grassOffsets[gi] + Math.round((hash2(x + gi * 11, y - gi * 7) - 0.5) * 3);
      const gy = 3 + (gi % 2);
      const gh = 3 + ((gi + treeIndex) % 3);
      ctx.fillStyle = gi % 2 === 0 ? '#356f36' : '#3d7c3c';
      ctx.fillRect(gx - 1, gy - gh + 1, 2, gh);
      ctx.fillStyle = gi % 3 === 0 ? '#79c96a' : '#589c48';
      ctx.fillRect(gx + sway, gy - gh, 1, gh - 1);
    }
    // Hojas caídas al pie del árbol
    ctx.fillStyle = '#89b84a';
    ctx.fillRect(-19 + (treeIndex % 4), 5, 2, 1);
    ctx.fillRect(15 - (treeIndex % 3), 6, 2, 1);
    ctx.fillStyle = '#c49645';
    ctx.fillRect(6 + (treeIndex % 5), 6, 2, 1);
    ctx.fillStyle = '#5c3818';
    ctx.fillRect(-10 + (treeIndex % 7), 5, 2, 1);

    // Helecho / matorral bajo ocasional al pie
    if (seed > 0.40) {
      const fx = (treeIndex % 2 === 0 ? 10 : -12);
      ctx.fillStyle = '#26541f';
      ctx.fillRect(fx, 3, 3, 2);
      ctx.fillStyle = '#4a9437';
      ctx.fillRect(fx - 1, 2, 2, 2);
    }

    ctx.restore();
  };

  for (let ti = 0; ti < ISLA_NATAL_TREES.length; ti++) {
    const tree = ISLA_NATAL_TREES[ti];
    if (!isWorldBoxVisible(tree.x - 52, tree.y - 100, 104, 116, camX, camY, vw, vh)) continue;
    // En la zona suroeste, algunos árboles enmarcan el tejado rojo por detrás y sus copas solapan con él creando profundidad
    const overlaysCottageRoof = tree.x >= 580 && tree.x <= 720 && tree.y >= 870 && tree.y <= 910;
    const sortY = overlaysCottageRoof ? HUT_POS.y + 98 : tree.y + 10;
    ySorted.push({
      sortY,
      draw: () =>
        drawHandcraftedTreeNatal(ctx, tree.x, tree.y, tree.variant, ti, elapsed, reducedMotion),
    });
  }
  for (const p of ISLA_NATAL_PALMS) {
    if (!isWorldBoxVisible(p.x - 56, p.y - 116, 112, 130, camX, camY, vw, vh)) continue;
    ySorted.push({ sortY: p.y + 4, draw: () => drawPalm(ctx, p.x, p.y, p.seed, elapsed, reducedMotion) });
  }
  for (const b of ISLA_NATAL_BOULDERS) {
    if (!isWorldBoxVisible(b.x - 36, b.y - 52, 72, 64, camX, camY, vw, vh)) continue;
    ySorted.push({ sortY: b.y, draw: () => drawBoulder(ctx, b.x, b.y, b.seed) });
  }

  // Grúas y atrezo de construcción en Highland
  for (const c of HIGHLAND_CRANES) {
    if (!isWorldBoxVisible(c.x - 60, c.y - 80, 120, 100, camX, camY, vw, vh)) continue;
    ySorted.push({
      sortY: c.y + 4,
      draw: () => drawNatalHighlandCrane(ctx, c.x, c.y, c.angle, elapsed, reducedMotion),
    });
  }
  for (const p of HIGHLAND_CONSTRUCTION_PROPS) {
    if (!isWorldBoxVisible(p.x - 30, p.y - 30, 60, 60, camX, camY, vw, vh)) continue;
    ySorted.push({
      sortY: p.y,
      draw: () => drawNatalConstructionProps(ctx, p.x, p.y, p.type),
    });
  }
  for (const sr of NATAL_SCENIC_ROCKS) {
    if (!isWorldBoxVisible(sr.x - 44, sr.y - 58, 88, 72, camX, camY, vw, vh)) continue;
    ySorted.push({ sortY: sr.y, draw: () => drawScenicRock(ctx, sr) });
  }
  for (const b of NATAL_BUSHES) {
    if (isIslaNatalPointOnPath(b.x, b.y)) continue;
    if (!isWorldBoxVisible(b.x - 22, b.y - 26, 44, 34, camX, camY, vw, vh)) continue;
    ySorted.push({ sortY: b.y + 2, draw: () => drawBushCluster(ctx, b.x, b.y, b.seed, elapsed, reducedMotion) });
  }
  for (const b of NATAL_PATH_SIDE_BUSHES) {
    if (isIslaNatalPointOnPath(b.x, b.y)) continue;
    if (!isWorldBoxVisible(b.x - 16, b.y - 20, 32, 28, camX, camY, vw, vh)) continue;
    ySorted.push({ sortY: b.y + 1, draw: () => drawBushCluster(ctx, b.x, b.y, b.seed, elapsed, reducedMotion, 0.75) });
  }
  for (const c of ISLA_NATAL_CLUTTER) {
    if (!isWorldBoxVisible(c.x - 10, c.y - 10, 20, 20, camX, camY, vw, vh)) continue;
    ySorted.push({ sortY: c.y, draw: () => drawClutter(ctx, c, elapsed, reducedMotion) });
  }


  // Peñascos, tronco, cargas del muelle y rocas costeras que dan cuerpo a los bloqueos del mapa.
  for (const solid of ISLA_NATAL_SOLIDS) {
    if (solid.id === 'cabana' || solid.id === 'cobertizo') continue;
    if (
      !isWorldBoxVisible(solid.x - 32, solid.y - 48, solid.w + 68, solid.h + 64, camX, camY, vw, vh)
    ) {
      continue;
    }
    const seed = hash2(solid.x + 3, solid.y - 7);
    if (solid.id === 'muelle-carga-oeste') {
      ySorted.push({
        sortY: solid.y + solid.h,
        draw: () => drawNorthPortDockProps(ctx, 'west', elapsed, reducedMotion),
      });
    } else if (solid.id === 'muelle-carga-brazo') {
      ySorted.push({
        sortY: solid.y + solid.h,
        draw: () => drawNorthPortDockProps(ctx, 'east', elapsed, reducedMotion),
      });
    } else if (solid.id === 'tronco') {
      ySorted.push({
        sortY: solid.y + solid.h,
        draw: () => drawFallenLog(ctx, solid.x, solid.y, solid.w, solid.h, seed),
      });
    } else {
      ySorted.push({
        sortY: solid.y + solid.h,
        draw: () => drawRockOutcrop(ctx, solid.x, solid.y, solid.w, solid.h, seed, solid.id),
      });
    }
  }

  ySorted.push({ sortY: HUT_POS.y + 96, draw: () => drawHut(ctx, elapsed, reducedMotion) });
  ySorted.push({ sortY: SHED_POS.y + 124, draw: () => drawShed(ctx, elapsed, arcadeState, reducedMotion) });
  for (const sign of ISLA_NATAL_SIGNS) {
    if (!isWorldBoxVisible(sign.x - 20, sign.y - 30, 40, 40, camX, camY, vw, vh)) continue;
    ySorted.push({
      sortY: sign.y + 1,
      draw: () => drawSignWithContext(ctx, sign.x, sign.y),
    });
  }
  ySorted.push({ sortY: SIGN_POS.y + 2, draw: () => drawSign(ctx) });
  ySorted.push({ sortY: NET_POS.y + 8, draw: () => drawNet(ctx, elapsed) });
  ySorted.push({ sortY: SHELLS_POI_POS.y + 8, draw: () => drawShellCluster(ctx, elapsed) });
  ySorted.push({ sortY: MAILBOX_POS.y + 1, draw: () => drawMailbox(ctx) });
  if (isWorldBoxVisible(MIRADOR_POS.x - 64, MIRADOR_POS.y - 40, 128, 52, camX, camY, vw, vh)) {
    ySorted.push({
      sortY: MIRADOR_POS.y + 2,
      draw: () => drawAltoMirador(ctx, elapsed, reducedMotion),
    });
  }
  if (paddleOnGround) {
    ySorted.push({
      sortY: CABINET_POS.y + 24,
      draw: () => drawPaddleItem(ctx, elapsed, reducedMotion),
    });
  }
  if (travelerEvent && travelerEvent.phase !== 'storm') {
    const phase = travelerEvent.phase;
    const tt = travelerEvent.t;
    const site = ISLA_NATAL_TRAVELER_SITE;
    let lift = 0;
    if (phase === 'arrival') {
      lift = 240 * (1 - smoothstep(tt / 2.4));
    } else if (phase === 'departure') {
      lift = 260 * smoothstep(tt / 2.0);
    }
    const landed = lift < 1.5;
    ySorted.push({
      sortY: site.y + 2,
      draw: () => {
        if (lift < 40) drawLandingScorch(ctx, site.x, site.y, elapsed);
        drawTravelerShip(ctx, site.x, site.y, lift, elapsed, reducedMotion, landed);
      },
    });

    if (phase === 'descend' || phase === 'talk' || phase === 'board') {
      const doorX = site.x - DOOR_OFFSET;
      const talkX = site.x - TALK_OFFSET;
      let px = talkX;
      let walking = false;
      if (phase === 'descend') {
        const p = clamp01(tt / 1.7);
        px = doorX + (talkX - doorX) * smoothstep(p);
        walking = p > 0.08 && p < 0.95;
      } else if (phase === 'board') {
        const p = clamp01(tt / 1.4);
        px = talkX + (doorX - talkX) * smoothstep(p);
        walking = p > 0.08 && p < 0.95;
      }
      ySorted.push({
        sortY: site.y + 4,
        draw: () => drawFutureTraveler(ctx, px, site.y, elapsed, -1, walking),
      });
    }
  }

  ySorted.push({ sortY: params.player.y + 4, draw: () => drawPlayer(ctx, params, elapsed) });

  ySorted.sort((a, b) => a.sortY - b.sortY);
  for (const item of ySorted) item.draw();

  // Partículas (polen, chispas de la señal)
  for (const pt of particles) {
    const a = Math.max(0, Math.min(1, pt.life / pt.maxLife));
    ctx.globalAlpha = a;
    ctx.fillStyle = pt.color;
    ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
  }
  ctx.globalAlpha = 1;

  drawAmbientLife(ctx, camX, camY, vw, vh, elapsed, reducedMotion);

  drawDepartureBeacon(ctx, elapsed, departureReady, reducedMotion);

  // Ondas de choque de la anomalía sobre el mar
  if (shockwaves.length > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const sw of shockwaves) {
      const t = sw.t / sw.life;
      const r = 20 + t * 1500;
      ctx.strokeStyle = `rgba(180, 245, 255, ${(0.55 * (1 - t)).toFixed(3)})`;
      ctx.lineWidth = 6 - t * 4;
      ctx.beginPath();
      ctx.ellipse(sw.x, sw.y, r, r * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(0, 243, 255, ${(0.3 * (1 - t)).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sw.x, sw.y, r * 0.72, r * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Luz ambiental: farol de la cabaña, resplandor del cobertizo y sol poniente
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const pools: { x: number; y: number; r: number; rgba: string }[] = [
    { x: HUT_POS.x + 96, y: HUT_POS.y + 52, r: 74, rgba: 'rgba(255, 178, 92, 0.16)' },
    { x: MAILBOX_POS.x, y: MAILBOX_POS.y - 24, r: 40, rgba: 'rgba(255, 214, 140, 0.1)' },
  ];

  if (arcadeState !== 'dusty') {
    const intensity = arcadeState === 'won' ? 0.3 + signalPulse * 0.35 : 0.18 + charge * 0.16;
    pools.push({
      x: ISLA_NATAL_ARCADE_ANCHOR.x,
      y: ISLA_NATAL_ARCADE_ANCHOR.y - 46,
      r: 150,
      rgba: `rgba(0, 243, 255, ${intensity.toFixed(3)})`,
    });
  }

  for (const pool of pools) {
    const g = ctx.createRadialGradient(pool.x, pool.y, 2, pool.x, pool.y, pool.r);
    g.addColorStop(0, pool.rgba);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(pool.x - pool.r, pool.y - pool.r, pool.r * 2, pool.r * 2);
  }

  // Sol bajo al oeste: baño cálido sobre la isla
  const sunX = 120;
  const sunY = 420;
  const sun = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 1500);
  sun.addColorStop(0, 'rgba(255, 196, 120, 0.26)');
  sun.addColorStop(0.35, 'rgba(255, 168, 100, 0.1)');
  sun.addColorStop(1, 'rgba(255, 150, 90, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(camX, camY, vw, vh);
  ctx.restore();

  // Corrupción de señal en el cielo de la isla durante la anomalía
  if (signalPulse > 0.02) {
    ctx.save();
    const bands = 5;
    for (let i = 0; i < bands; i++) {
      const n = hash2(Math.floor(elapsed * 9) + i * 31, i);
      if (n < 0.45) continue;
      const by = camY + n * vh;
      const bh = 2 + Math.floor(n * 6);
      ctx.globalAlpha = 0.28 * signalPulse;
      ctx.fillStyle = i % 2 === 0 ? '#67e8f9' : '#f0abfc';
      ctx.fillRect(camX + (n * 80) % 120, by, vw, bh);
    }
    ctx.restore();
  }

  if (prompt) {
    drawPromptBadge(ctx, prompt, animFrame4 % 2 === 0 ? 0 : -2);
  }

  // Pájaros sobre la isla (se dispersan con la señal)
  ctx.save();
  const birdScatter = signalPulse > 0.3 ? 2.4 : 1;
  for (let i = 0; i < 3; i++) {
    const bt = elapsed * 0.06 * birdScatter + i * 0.33;
    const bx = ISLA_NATAL_WORLD_W * 0.5 + Math.cos(bt * (1 + i * 0.2)) * (420 + i * 90);
    const by = ISLA_NATAL_WORLD_H * 0.42 + Math.sin(bt * 1.6) * 210;
    if (!isWorldBoxVisible(bx - 10, by - 6, 20, 12, camX, camY, vw, vh)) continue;
    const flap = reducedMotion ? 0 : Math.round(Math.sin(elapsed * 9 + i * 2) * 1.6);
    ctx.fillStyle = 'rgba(226, 240, 250, 0.85)';
    ctx.fillRect(Math.round(bx) - 3, Math.round(by) - flap, 2, 2);
    ctx.fillRect(Math.round(bx) + 1, Math.round(by) - flap, 2, 2);
    ctx.fillRect(Math.round(bx) - 1, Math.round(by), 2, 1);
    ctx.fillStyle = 'rgba(20, 40, 60, 0.22)';
    ctx.fillRect(Math.round(bx) - 14, Math.round(by) + 26, 5, 2);
  }
  ctx.restore();

  ctx.restore();

  // Viñeta suave en espacio de pantalla
  const vig = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.36, vw / 2, vh / 2, Math.max(vw, vh) * 0.8);
  vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vig.addColorStop(1, 'rgba(4, 10, 20, 0.45)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, vw, vh);

  // Neblina cálida del atardecer y frescor del mar en el borde inferior
  const haze = ctx.createLinearGradient(0, 0, 0, vh);
  haze.addColorStop(0, 'rgba(255, 190, 126, 0.13)');
  haze.addColorStop(0.42, 'rgba(255, 172, 114, 0.05)');
  haze.addColorStop(0.78, 'rgba(90, 120, 170, 0.04)');
  haze.addColorStop(1, 'rgba(52, 46, 96, 0.13)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, vw, vh);

  // Rayo de sol rasante desde el oeste (sutil, acompaña al sol del mapa)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const ray = ctx.createLinearGradient(0, vh * 0.18, vw * 0.7, vh * 0.82);
  ray.addColorStop(0, 'rgba(255, 200, 130, 0.07)');
  ray.addColorStop(1, 'rgba(255, 160, 100, 0)');
  ctx.fillStyle = ray;
  ctx.fillRect(0, 0, vw, vh);
  ctx.restore();

  // Bloom localizado del sol bajo. Puramente atmosférico: no toca objetos,
  // colisiones ni lectura, y sólo se pinta si el sol entra en cuadro.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const sunSX = 120 - camX;
  const sunSY = 420 - camY;
  if (sunSX > -360 && sunSX < vw + 360 && sunSY > -360 && sunSY < vh + 360) {
    const bloom = ctx.createRadialGradient(sunSX, sunSY, 4, sunSX, sunSY, 340);
    bloom.addColorStop(0, 'rgba(255, 232, 176, 0.14)');
    bloom.addColorStop(0.38, 'rgba(255, 198, 126, 0.06)');
    bloom.addColorStop(1, 'rgba(255, 168, 100, 0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(sunSX - 340, sunSY - 340, 680, 680);
  }
  ctx.restore();

  // Tormenta de la llegada: el cielo se oscurece y se parte en destellos.
  if (travelerEvent?.phase === 'storm') {
    const st = travelerEvent.t;
    ctx.fillStyle = `rgba(8, 16, 28, ${(0.34 * Math.min(1, st / 0.5)).toFixed(3)})`;
    ctx.fillRect(0, 0, vw, vh);

    const gaussian = (center: number, spread: number) => {
      const d = (st - center) / spread;
      return Math.exp(-d * d);
    };
    const flash = Math.max(
      gaussian(0.3, 0.11),
      gaussian(1.05, 0.13),
      gaussian(1.9, 0.16)
    );
    if (flash > 0.01) {
      ctx.fillStyle = `rgba(226, 245, 255, ${(flash * 0.62).toFixed(3)})`;
      ctx.fillRect(0, 0, vw, vh);
    }
  }
}
