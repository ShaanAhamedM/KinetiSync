import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

// Maps mediapipe landmarks to finger paths
const FINGER_PATHS = [
  [0, 1, 2, 3, 4],       // Thumb
  [0, 5, 6, 7, 8],       // Index
  [9, 10, 11, 12],       // Middle (connects to 9, which connects to 0 via palm)
  [13, 14, 15, 16],      // Ring
  [0, 17, 18, 19, 20],   // Pinky
];

const PALM_PATH = [0, 1, 5, 9, 13, 17, 0];

// -- PARTICLE SYSTEM --
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string | { r: number; g: number; b: number };
  size?: number;
}

const particles: Particle[] = [];

export const updateAndDrawParticles = (ctx: CanvasRenderingContext2D) => {
  // Add some slight drag and fade to particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life--;
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.95; // drag
    p.vy *= 0.95;
    
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    
    ctx.beginPath();
    const size = p.size !== undefined ? p.size : 3;
    ctx.arc(p.x, p.y, size * (p.life / p.maxLife), 0, Math.PI * 2);
    if (typeof p.color === 'string') {
      ctx.fillStyle = p.color;
    } else if (p.color && typeof p.color === 'object' && 'r' in p.color) {
      ctx.fillStyle = `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, ${p.life / p.maxLife})`;
    } else {
      ctx.fillStyle = p.color as any;
    }
    ctx.fill();
  }
};

/**
 * Renders a scrolling telemetry waveform for the Digital Twin Dashboard
 */
export const renderTelemetryWaveform = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dataHistory: number[]
) => {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  
  // Draw Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for(let i = 0; i < height; i += 20) {
    ctx.moveTo(0, i); ctx.lineTo(width, i);
  }
  for(let i = 0; i < width; i += 20) {
    ctx.moveTo(i, 0); ctx.lineTo(i, height);
  }
  ctx.stroke();

  if (dataHistory.length < 2) {
    ctx.restore();
    return;
  }

  // Draw Waveform
  ctx.beginPath();
  ctx.strokeStyle = '#06b6d4'; // Cyan
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(6, 182, 212, 0.5)';
  ctx.shadowBlur = 10;

  const stepX = width / 100; // Assuming we keep max 100 data points
  
  // Start from right and go left
  let x = width;
  for (let i = dataHistory.length - 1; i >= 0; i--) {
    const val = dataHistory[i];
    // Map score (0-100) to Y axis (height-10 -> 10)
    const y = height - 10 - ((val / 100) * (height - 20));
    
    if (i === dataHistory.length - 1) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
    x -= stepX;
    
    if (x < 0) break;
  }
  
  ctx.stroke();
  
  // Draw current point glow
  const currentVal = dataHistory[dataHistory.length - 1];
  const currentY = height - 10 - ((currentVal / 100) * (height - 20));
  
  ctx.beginPath();
  ctx.arc(width, currentY, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  ctx.restore();
};

/**
 * Draws a smooth curve through an array of points using quadratic bezier curves.
 */
const drawSmoothPath = (ctx: CanvasRenderingContext2D, points: {x: number, y: number}[]) => {
  if (points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length - 2; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }

  // Curve through the last two points
  if (points.length > 2) {
    const last = points.length - 1;
    ctx.quadraticCurveTo(points[last - 1].x, points[last - 1].y, points[last].x, points[last].y);
  } else {
    ctx.lineTo(points[1].x, points[1].y);
  }
};

/**
 * Renders the Trainee's Live Hand as a crisp, clinical structural wireframe.
 */
export const renderLiveHand = (
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  poseLandmarks?: NormalizedLandmark[]
) => {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';

  // Draw Pose (Arm Conduits) if available
  if (poseLandmarks && poseLandmarks.length > 0) {
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    
    // Left Arm (11 -> 13 -> 15)
    if (poseLandmarks[11] && poseLandmarks[13] && poseLandmarks[15]) {
      drawSmoothPath(ctx, [poseLandmarks[11], poseLandmarks[13], poseLandmarks[15]].map(lm => ({x: lm.x * width, y: lm.y * height})));
      ctx.stroke();
    }
    // Right Arm (12 -> 14 -> 16)
    if (poseLandmarks[12] && poseLandmarks[14] && poseLandmarks[16]) {
      drawSmoothPath(ctx, [poseLandmarks[12], poseLandmarks[14], poseLandmarks[16]].map(lm => ({x: lm.x * width, y: lm.y * height})));
      ctx.stroke();
    }
  }

  // Draw structural paths
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  [...FINGER_PATHS, PALM_PATH].forEach(pathIndices => {
    const points = pathIndices.map(i => ({
      x: landmarks[i].x * width,
      y: landmarks[i].y * height
    }));
    drawSmoothPath(ctx, points);
    ctx.stroke();
  });

  // Draw crisp joints
  ctx.fillStyle = '#171717';
  ctx.lineWidth = 1.5;
  landmarks.forEach((lm) => {
    ctx.beginPath();
    ctx.arc(lm.x * width, lm.y * height, 3, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  });

  ctx.restore();
};

/**
 * Renders the Expert's Ghost Hand as a glowing, cinematic silhouette.
 * Changes hue dynamically based on the current deviation score (0-100).
 */
export const renderGhostHand = (
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  score: number = 100,
  poseLandmarks?: NormalizedLandmark[]
) => {
  ctx.save();
  
  let glowColor = 'rgba(6, 182, 212, 0.8)'; // Cyan
  if (score < 50) {
    glowColor = 'rgba(239, 68, 68, 0.8)'; // Red
  } else if (score < 80) {
    glowColor = 'rgba(245, 158, 11, 0.8)'; // Amber
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw Pose (Arm Conduits) if available
  if (poseLandmarks && poseLandmarks.length > 0) {
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 30;
    
    const drawArm = (shoulder: number, elbow: number, wrist: number) => {
      if (poseLandmarks[shoulder] && poseLandmarks[elbow] && poseLandmarks[wrist]) {
        const pts = [poseLandmarks[shoulder], poseLandmarks[elbow], poseLandmarks[wrist]].map(lm => ({x: lm.x * width, y: lm.y * height}));
        drawSmoothPath(ctx, pts);
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 20;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 8;
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.shadowBlur = 30;
      }
    };
    drawArm(11, 13, 15); // Left
    drawArm(12, 14, 16); // Right
  }
  
  // Inner core
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  
  // Outer glow
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 20;

  // Draw paths with glow
  [...FINGER_PATHS, PALM_PATH].forEach(pathIndices => {
    const points = pathIndices.map(i => ({
      x: landmarks[i].x * width,
      y: landmarks[i].y * height
    }));
    drawSmoothPath(ctx, points);
    
    // Draw outer glow stroke
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 14;
    ctx.stroke();
    
    // Draw inner core stroke
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 6;
    ctx.shadowBlur = 0; // Disable blur for sharp inner core
    ctx.stroke();
    
    // Re-enable blur for next path
    ctx.shadowBlur = 20;
  });

  // Fill the palm area softly to create a silhouette effect
  const palmPoints = PALM_PATH.map(i => ({
    x: landmarks[i].x * width,
    y: landmarks[i].y * height
  }));
  
  ctx.fillStyle = glowColor.replace('0.8', '0.2'); // highly transparent fill
  ctx.beginPath();
  ctx.moveTo(palmPoints[0].x, palmPoints[0].y);
  for (let i = 1; i < palmPoints.length; i++) {
    ctx.lineTo(palmPoints[i].x, palmPoints[i].y);
  }
  ctx.closePath();
  ctx.fill();

  // Emit Particles from fingertips
  [4, 8, 12, 16, 20].forEach(tipIndex => {
    particles.push({
      x: landmarks[tipIndex].x * width,
      y: landmarks[tipIndex].y * height,
      vx: (Math.random() - 0.5) * 3,
      vy: (Math.random() - 0.5) * 3,
      life: 40,
      maxLife: 40,
      color: glowColor
    });
  });

  ctx.restore();
};
