import * as THREE from "three";

/** Dirty striped track band — scrolls with movement */
export function makeTrackTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#1c1e1a";
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 128; y += 14) {
    ctx.fillStyle = y % 28 === 0 ? "#3a3c36" : "#2a2c28";
    ctx.fillRect(0, y, 64, 7);
    ctx.fillStyle = "#6b6558";
    ctx.fillRect(6, y + 2, 52, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
