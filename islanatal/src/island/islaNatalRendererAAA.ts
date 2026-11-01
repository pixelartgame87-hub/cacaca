/**
 * RENDERER DE ÁRBOLES AAA PARA ISLA NATAL
 *
 * Mejora la calidad visual de los árboles normales, manteniendo la compatibilidad
 * con la estructura existente y respetando el estilo artístico de PIXELVERSE.
 */

export function drawHandcraftedTreeNatalAAA(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  variant: 'forest' | 'meadow' | 'pine',
  elapsed = 0,
  reducedMotion = false,
  crownVariant: 0 | 1 | 2 = 0
): void {
  const x = Math.round(cx);
  const y = Math.round(cy);
  const canopySway = reducedMotion ? 0 : Math.round(Math.sin(elapsed * 1.15 + cx * 0.045) * 1.25);

  ctx.save();
  ctx.translate(x, y);

  // 1. Oclusión ambiental profunda de contacto directo en la raíz
  ctx.fillStyle = 'rgba(6, 18, 10, 0.62)';
  ctx.beginPath();
  ctx.ellipse(0, 3, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // 2. Sombra proyectada por el tronco y la copa (proyección direccional Este-Sureste para Hora Dorada)
  const isPine = variant === 'pine';
  const shadowX = 14;
  const shadowY = 8;
  const shadowRx = isPine ? 22 : 28;
  const shadowRy = isPine ? 9 : 12;

  // Faldón exterior difuso de sombra
  ctx.fillStyle = 'rgba(8, 26, 14, 0.22)';
  ctx.beginPath();
  ctx.ellipse(shadowX, shadowY, shadowRx + 6, shadowRy + 3, 0.12, 0, Math.PI * 2);
  ctx.fill();

  // Núcleo denso de sombra de copa
  ctx.fillStyle = 'rgba(4, 16, 8, 0.38)';
  ctx.beginPath();
  ctx.ellipse(shadowX - 2, shadowY - 1, shadowRx * 0.72, shadowRy * 0.72, 0.1, 0, Math.PI * 2);
  ctx.fill();

  const isForest = variant === 'forest';
  
  // Raíz extendida (flare) para fundir el tronco con la tierra
  ctx.fillStyle = '#2d1808';
  ctx.beginPath();
  ctx.moveTo(-9, 2);
  ctx.lineTo(-4, -10);
  ctx.lineTo(4, -10);
  ctx.lineTo(9, 2);
  ctx.closePath();
  ctx.fill();

  // Variación de altura del tronco según crownVariant
  const trunkH = crownVariant === 1 ? 20 : (crownVariant === 2 ? 10 : 14);
  
  // Tronco texturizado
  ctx.fillRect(-5, -trunkH, 10, trunkH);
  ctx.fillStyle = '#5d3a20';
  ctx.fillRect(-3, -trunkH + 1, 6, trunkH - 1);
  ctx.fillStyle = '#8c5a30';
  ctx.fillRect(-1, -trunkH + 1, 2, trunkH - 2);
  
  // Detalles de corteza y musgo basal
  ctx.fillStyle = '#1e3a1f';
  ctx.fillRect(-6, -2, 2, 4);
  ctx.fillRect(4, -2, 2, 4);

  // 2. Hierba y briznas alrededor de la base para que el tronco nazca naturalmente del suelo
  ctx.fillStyle = isForest ? '#166534' : '#3f7c19';
  ctx.fillRect(-7, 0, 2, -3);
  ctx.fillRect(-5, 1, 2, -4);
  ctx.fillRect(-2, 2, 2, -3);
  ctx.fillRect(1, 2, 2, -4);
  ctx.fillRect(4, 1, 2, -3);
  ctx.fillRect(6, 0, 2, -3);

  ctx.fillStyle = isForest ? '#4ade80' : '#86efac';
  ctx.fillRect(-6, 0, 1, -2);
  ctx.fillRect(2, 1, 1, -3);

  ctx.save();
  ctx.translate(canopySway, 0);

  // Follaje AAA: Sistema de capas superpuestas
  const drawLayer = (
    yOff: number, 
    width: number, 
    height: number, 
    color: string, 
    shadow: string, 
    highlight: string
  ) => {
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(0, yOff, width * 0.9, height * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, yOff, width, height, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = highlight;
    ctx.beginPath();
    ctx.ellipse(-width * 0.3, yOff - height * 0.3, width * 0.5, height * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  if (variant === 'pine') {
    if (crownVariant === 1) {
      // Pino esbelto 4 capas
      drawLayer(-25, 22, 14, '#1e6a5d', '#0d3d35', '#5eead4');
      drawLayer(-40, 18, 12, '#289d89', '#13675a', '#ccfbf1');
      drawLayer(-53, 14, 10, '#34d399', '#1e6a5d', '#ffffff');
      drawLayer(-64, 8, 7, '#a7f3d0', '#289d89', '#ffffff');
    } else if (crownVariant === 2) {
      // Pino ancho 3 capas anchas
      drawLayer(-22, 26, 16, '#1e6a5d', '#0d3d35', '#5eead4');
      drawLayer(-38, 20, 14, '#289d89', '#13675a', '#ccfbf1');
      drawLayer(-50, 13, 9, '#5eead4', '#289d89', '#ffffff');
    } else {
      // Pino cónico clásico
      drawLayer(-30, 20, 15, '#1e6a5d', '#0d3d35', '#5eead4');
      drawLayer(-45, 15, 12, '#289d89', '#13675a', '#ccfbf1');
      drawLayer(-58, 10, 8, '#5eead4', '#289d89', '#ffffff');
    }
  } else {
    // Árbol frondoso (forest o meadow)
    const baseCol = isForest ? '#166534' : '#3f7c19';
    const shadCol = isForest ? '#064e3b' : '#1f480d';
    const highCol = isForest ? '#86efac' : '#a8e63e';
    
    if (crownVariant === 1) {
      // Copa Alta y Alargada
      drawLayer(-32, 20, 24, baseCol, shadCol, highCol);
      drawLayer(-50, 16, 18, baseCol, shadCol, highCol);
      drawLayer(-65, 11, 12, highCol, baseCol, '#ffffff');
    } else if (crownVariant === 2) {
      // Copa Ancha Horizontal
      drawLayer(-20, 30, 16, baseCol, shadCol, highCol);
      drawLayer(-32, 26, 14, baseCol, shadCol, highCol);
      drawLayer(-44, 20, 11, highCol, baseCol, '#ffffff');
    } else {
      // Copa Esférica Clásica
      drawLayer(-25, 25, 18, baseCol, shadCol, highCol);
      drawLayer(-38, 22, 15, baseCol, shadCol, highCol);
      drawLayer(-50, 18, 12, highCol, baseCol, '#ffffff');
    }
  }

  ctx.restore();
  ctx.restore();
}
