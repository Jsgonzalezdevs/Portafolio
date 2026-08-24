import React, { useEffect, useRef } from 'react';

export const WavesBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId = 0;
    let width = 0;
    let height = 0;
    let maxRadius = 0;

    const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Track mouse
    const handleMouseMove = (e: MouseEvent) => {
      // Normalize to -0.5 to 0.5
      mouseRef.current.targetX = (e.clientX / window.innerWidth) - 0.5;
      mouseRef.current.targetY = (e.clientY / window.innerHeight) - 0.5;
    };

    window.addEventListener('mousemove', handleMouseMove);

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;

      // The canvas has as many real pixels as the screen does. Sized in CSS
      // pixels it is stretched by the device ratio on every phone and retina
      // display, which is what turned these hairlines into grey smudges.
      // Capped at 2: a third pass over the same area costs real frame time and
      // buys nothing visible at a 0.65px stroke.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      // Everything below keeps working in CSS pixels.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Recomputed here, not once at setup: it was left at whatever the window
      // measured on load, so rotating a phone left the field sized for the
      // other orientation.
      maxRadius = Math.max(width, height) * 0.75;
    };

    handleResize();

    // Simulation parameters
    const rings = 30;
    const sectors = 60;

    // Tilt settings
    let tiltX = 1.1; // Default tilt
    let tiltY = 0.3; // Default tilt
    let time = 0;

    const draw = () => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      // Smooth mouse tracking
      mouseRef.current.x += (mouseRef.current.targetX - mouseRef.current.x) * 0.05;
      mouseRef.current.y += (mouseRef.current.targetY - mouseRef.current.y) * 0.05;

      const currentTiltX = tiltX + mouseRef.current.y * 0.25;
      const currentTiltY = tiltY + mouseRef.current.x * 0.25;

      const cosX = Math.cos(currentTiltX);
      const sinX = Math.sin(currentTiltX);
      const cosY = Math.cos(currentTiltY);
      const sinY = Math.sin(currentTiltY);

      const centerX = width / 2;
      const centerY = height / 2;
      
      // Compute 3D points
      // We will project coordinates of form: ring, sector -> x, y, z
      // Point matrix: rings x sectors
      const points: Array<Array<{ sx: number; sy: number; alpha: number }>> = [];

      for (let r = 0; r <= rings; r++) {
        const ringPoints: Array<{ sx: number; sy: number; alpha: number }> = [];
        const radius = (r / rings) * maxRadius;

        for (let s = 0; s < sectors; s++) {
          const angle = (s / sectors) * Math.PI * 2;
          
          // Polar to 2D plane Cartesian
          const px = radius * Math.cos(angle);
          const py = radius * Math.sin(angle);

          // Compute height wave (Z) using a combination of sine waves
          // Waves propagate outwards from center (radius) and rotate (angle)
          const wave1 = Math.sin(radius * 0.005 - time * 0.8) * 45;
          const wave2 = Math.cos(angle * 3 + time * 0.4) * 15 * (radius / maxRadius);
          const pz = wave1 + wave2;

          // Apply X/Y rotation
          // Rotate Y-axis (Y-tilt)
          const rx1 = px * cosY - pz * sinY;
          const rz1 = px * sinY + pz * cosY;

          // Rotate X-axis (X-tilt)
          const rx2 = rx1;
          const ry2 = py * cosX - rz1 * sinX;
          const rz2 = py * sinX + rz1 * cosX;

          // Project with perspective
          const focalLength = 1200;
          const scale = focalLength / (focalLength + rz2);
          const sx = centerX + rx2 * scale;
          const sy = centerY + ry2 * scale;

          // Fade out towards the outer edges and the back of screen (large Z)
          const edgeFade = 1 - (radius / maxRadius);
          const depthFade = (rz2 + maxRadius) / (2 * maxRadius); // Normalised depth
          // Increase opacity ceiling to 0.55 and set a minimum of 0.03 so background lines are clearly visible
          const alpha = Math.max(0.03, Math.min(0.55, 0.55 * edgeFade * (1 - depthFade)));

          ringPoints.push({ sx, sy, alpha });
        }
        points.push(ringPoints);
      }

      // Draw concentric rings
      ctx.lineWidth = 0.65; // Thin and sharp lines
      for (let r = 1; r <= rings; r++) {
        ctx.beginPath();
        for (let s = 0; s <= sectors; s++) {
          const idx = s % sectors;
          const pt = points[r][idx];
          
          if (s === 0) {
            ctx.moveTo(pt.sx, pt.sy);
          } else {
            ctx.lineTo(pt.sx, pt.sy);
          }
        }
        // Use average alpha of the ring, with high visibility multiplier
        const sampleAlpha = points[r][0].alpha;
        ctx.strokeStyle = `rgba(255, 255, 255, ${sampleAlpha * 0.9})`;
        ctx.stroke();
      }

      // Draw radial sectors
      ctx.lineWidth = 0.45; // Slightly thinner for radial spokes
      for (let s = 0; s < sectors; s += 2) { // Draw every 2nd sector line for clean look
        ctx.beginPath();
        for (let r = 0; r < rings; r++) {
          const pt1 = points[r][s];
          const pt2 = points[r + 1][s];
          
          ctx.moveTo(pt1.sx, pt1.sy);
          ctx.lineTo(pt2.sx, pt2.sy);
        }
        // Stroke with alpha based on average depth
        const sampleAlpha = points[Math.floor(rings / 2)][s].alpha;
        ctx.strokeStyle = `rgba(255, 255, 255, ${sampleAlpha * 0.5})`;
        ctx.stroke();
      }

    };

    const bucle = () => {
      time += 0.015;
      draw();
      animationFrameId = requestAnimationFrame(bucle);
    };

    /**
     * Runs only when there is someone to see it and someone who wants to.
     *
     * Roughly 1,800 points are projected per frame. Left running, that carried
     * on at 60fps behind a background tab or a locked phone, which is a real
     * amount of battery spent drawing to nobody.
     *
     * Reduced motion gets one still frame rather than a blank rectangle: the
     * request is to stop things moving, not to remove them.
     */
    const reevaluar = () => {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;

      if (document.hidden) return;
      if (sinMovimiento.matches) {
        draw();
        return;
      }
      animationFrameId = requestAnimationFrame(bucle);
    };

    // A resize while paused still has to repaint, or the still frame keeps the
    // old dimensions until motion is switched back on.
    const alRedimensionar = () => {
      handleResize();
      if (animationFrameId === 0) reevaluar();
    };
    window.addEventListener('resize', alRedimensionar);
    document.addEventListener('visibilitychange', reevaluar);
    // Toggling the OS setting takes effect immediately, without a reload.
    sinMovimiento.addEventListener('change', reevaluar);

    reevaluar();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', alRedimensionar);
      document.removeEventListener('visibilitychange', reevaluar);
      sinMovimiento.removeEventListener('change', reevaluar);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full -z-10 pointer-events-none block"
      aria-hidden="true"
    />
  );
};
