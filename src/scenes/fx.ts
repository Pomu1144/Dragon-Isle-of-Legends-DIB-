import Phaser from 'phaser';

export const EL_COLOR: Record<string, number> = {
  Fire: 0xff7043, Water: 0x42a5f5, Air: 0xc5b3ff, Earth: 0xd4a95a, Life: 0x9be15d, Death: 0xb05cff, Arcane: 0xffd54f,
};

/** Cover-fit a background image with a slow drift for life. */
export function coverBg(scene: Phaser.Scene, key: string, drift = true, depth = -10) {
  const { width, height } = scene.scale;
  const img = scene.add.image(width / 2, height / 2, key).setDepth(depth);
  const s = Math.max(width / img.width, height / img.height) * (drift ? 1.06 : 1);
  img.setScale(s);
  if (drift) scene.tweens.add({ targets: img, scale: s * 1.03, x: width / 2 + 12, duration: 14000, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
  return img;
}

export function ambient(scene: Phaser.Scene, tint = 0xfff1c0, count = 26) {
  const { width, height } = scene.scale;
  return scene.add.particles(0, 0, 'glow', {
    x: { min: 0, max: width }, y: { min: 0, max: height }, lifespan: 6000, speedY: { min: -12, max: -4 }, speedX: { min: -6, max: 6 },
    scale: { start: 0.2, end: 0.9 }, alpha: { start: 0, end: 0.6, ease: 'Sine.inOut' }, tint, frequency: 6000 / count, blendMode: 'ADD',
  }).setDepth(5);
}

export function vignette(scene: Phaser.Scene, alpha = 0.55) {
  const { width, height } = scene.scale;
  const key = `vig_${alpha}`;
  if (!scene.textures.exists(key)) {
    const c = scene.textures.createCanvas(key, 256, 144)!;
    const ctx = c.getContext();
    const g = ctx.createRadialGradient(128, 72, 40, 128, 72, 150);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${alpha})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 144);
    c.refresh();
  }
  return scene.add.image(width / 2, height / 2, key).setDisplaySize(width, height).setDepth(50);
}
