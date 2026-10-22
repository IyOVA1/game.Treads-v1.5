import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import * as THREE from "three";
import { useTankStore } from "../../store/tankStore";
import { getPart, ChassisPart, WeaponPart } from "../../data/parts";
import {
  game,
  spawnEffect,
  spawnProjectile,
  useBattleStore,
} from "../../game/battleState";
import { activateAbility, tickAbility } from "../../game/abilities";
import { MAP_LIMIT, sampleHull, slopeAlong, terrainHeight } from "../../game/terrain";
import { makeTrackTexture } from "../../game/visuals";

const SPEED_SCALE = 0.85;
const TURN_RATE = 1.3;
const MOUSE_YAW_SENS = 0.0024;
const MOUSE_PITCH_SENS = 0.0018;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const approach = (v: number, target: number, step: number) =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

/** Walk a camera ray against terrain height field to find aim point */
function aimPointOnTerrain(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  out: THREE.Vector3,
  maxDist = 180
) {
  let prevX = origin.x;
  let prevY = origin.y;
  let prevZ = origin.z;
  const step = 2.5;
  for (let d = step; d <= maxDist; d += step) {
    const x = origin.x + dir.x * d;
    const y = origin.y + dir.y * d;
    const z = origin.z + dir.z * d;
    const ground = terrainHeight(x, z);
    if (y <= ground + 0.15) {
      // interpolate
      const t =
        prevY > terrainHeight(prevX, prevZ) + 0.15
          ? (prevY - (terrainHeight(prevX, prevZ) + 0.15)) /
            (prevY - y + ground + 0.15 - (terrainHeight(prevX, prevZ) + 0.15) + 1e-6)
          : 0.5;
      out.set(
        prevX + (x - prevX) * Math.min(1, Math.max(0, t)),
        ground,
        prevZ + (z - prevZ) * Math.min(1, Math.max(0, t))
      );
      return true;
    }
    prevX = x;
    prevY = y;
    prevZ = z;
  }
  out.copy(origin).addScaledVector(dir, 60);
  out.y = terrainHeight(out.x, out.z);
  return false;
}

export function PlayerTank() {
  const blueprint = useTankStore((s) => s.blueprint);
  const stats = useTankStore((s) => s.stats);
  const [, getKeys] = useKeyboardControls();

  const chassis = getPart<ChassisPart>(blueprint.chassisId)!;
  const weapon = getPart<WeaponPart>(blueprint.weaponId)!;
  const [w, h, l] = chassis.size;

  const groupRef = useRef<THREE.Group>(null);
  const turretRef = useRef<THREE.Group>(null);
  const barrelRef = useRef<THREE.Mesh>(null);
  const muzzleRef = useRef<THREE.Object3D>(null);
  const trackMatL = useRef<THREE.MeshStandardMaterial>(null);
  const trackMatR = useRef<THREE.MeshStandardMaterial>(null);
  const wheelSpin = useRef(0);
  const wheelRefs = useRef<(THREE.Mesh | null)[]>([]);
  const trackTex = useRef<THREE.CanvasTexture | null>(null);
  if (!trackTex.current) trackTex.current = makeTrackTexture();

  const speed = useRef(0);
  const lastShot = useRef(-10);
  const recoil = useRef(0);
  const deadFx = useRef(false);
  const camReady = useRef(false);
  const ammo = useRef(weapon.magazine > 0 ? weapon.magazine : 999);
  const reloading = useRef(false);
  const reloadT = useRef(0);

  const tmp = useRef({
    target: new THREE.Quaternion(),
    yawQ: new THREE.Quaternion(),
    local: new THREE.Quaternion(),
    tilt: new THREE.Quaternion(),
    v1: new THREE.Vector3(),
    v2: new THREE.Vector3(),
    aim: new THREE.Vector3(),
  }).current;

  // Pointer-lock mouse → turret only
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement == null) return;
      const maxPitch = weapon.arc * (Math.PI / 180);
      game.player.turretYaw -= e.movementX * MOUSE_YAW_SENS;
      // Front hemisphere only (±90°)
      game.player.turretYaw = THREE.MathUtils.clamp(
        game.player.turretYaw,
        -Math.PI / 2,
        Math.PI / 2
      );
      game.player.pitch = THREE.MathUtils.clamp(
        game.player.pitch - e.movementY * MOUSE_PITCH_SENS,
        -0.15,
        maxPitch
      );
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [weapon.arc]);

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    if (game.paused) return;
    const dt = Math.min(delta, 0.05);
    const pl = game.player;
    const alive = useBattleStore.getState().hp > 0;
    pl.alive = alive;
    pl.radius = Math.max(w, l) / 2 + 0.3;
    const now = state.clock.elapsedTime;
    const nowMs = performance.now();

    const { forward, backward, left, right, ability } = getKeys();

    // ---------- Ability (duration → then CD) ----------
    if (alive && ability && !pl.abilityActive && useBattleStore.getState().abilityCd <= 0) {
      activateAbility(chassis, nowMs);
    }
    tickAbility(chassis, dt, nowMs);

    // ---------- Driving ----------
    if (alive) {
      pl.yaw += ((left ? 1 : 0) - (right ? 1 : 0)) * TURN_RATE * dt;

      const uphill =
        Math.max(0, slopeAlong(pl.pos.x, pl.pos.z, pl.yaw)) * (speed.current >= 0 ? 1 : -1);
      const climb = 150 / (stats.powerToWeight + 50);
      const slopeFactor = THREE.MathUtils.clamp(1 - Math.max(0, uphill) * 3 * climb, 0.25, 1);

      const maxSpeed = stats.topSpeed * SPEED_SCALE * slopeFactor * pl.speedMul;
      const accel = 2 + stats.powerToWeight * 0.025;
      let target = 0;
      if (forward) target = maxSpeed;
      else if (backward) target = -maxSpeed * 0.5;
      speed.current = approach(speed.current, target, (target === 0 ? 6 : accel) * dt);
    } else {
      speed.current = approach(speed.current, 0, 8 * dt);
    }

    pl.speed = speed.current;
    pl.pos.x += -Math.sin(pl.yaw) * speed.current * dt;
    pl.pos.z += -Math.cos(pl.yaw) * speed.current * dt;
    if (Math.abs(pl.pos.x) > MAP_LIMIT || Math.abs(pl.pos.z) > MAP_LIMIT) {
      pl.pos.x = THREE.MathUtils.clamp(pl.pos.x, -MAP_LIMIT, MAP_LIMIT);
      pl.pos.z = THREE.MathUtils.clamp(pl.pos.z, -MAP_LIMIT, MAP_LIMIT);
      speed.current = 0;
    }

    pl.pos.y = sampleHull(pl.pos.x, pl.pos.z, pl.yaw, w, l, tmp.target);
    tmp.yawQ.setFromAxisAngle(Y_AXIS, pl.yaw);
    tmp.local.copy(tmp.yawQ).invert().multiply(tmp.target);
    tmp.tilt.slerp(tmp.local, 1 - Math.exp(-8 * dt));
    g.quaternion.copy(tmp.yawQ).multiply(tmp.tilt);
    g.position.set(pl.pos.x, pl.pos.y + h / 2 + 0.1, pl.pos.z);

    if (turretRef.current) {
      turretRef.current.rotation.order = "YXZ";
      turretRef.current.rotation.y = pl.turretYaw;
      turretRef.current.rotation.x = pl.pitch;
    }

    recoil.current = Math.max(0, recoil.current - dt * 4);
    if (barrelRef.current) barrelRef.current.position.z = -l * 0.32 + recoil.current * 0.4;
    g.updateMatrixWorld(true);

    // ---------- Reload ----------
    const magSize = weapon.magazine > 0 ? weapon.magazine : 999;
    if (reloading.current) {
      reloadT.current += dt;
      const p = Math.min(1, reloadT.current / weapon.reload);
      useBattleStore.getState().setAmmo(0, true, p);
      if (reloadT.current >= weapon.reload) {
        reloading.current = false;
        ammo.current = magSize;
        reloadT.current = 0;
        useBattleStore.getState().setAmmo(ammo.current, false, 0);
        useBattleStore.getState().setWarning("");
      }
    } else {
      useBattleStore.getState().setAmmo(ammo.current, false, 0);
    }
    if (alive && !reloading.current && weapon.magazine > 0 && ammo.current <= 0) {
      reloading.current = true;
      reloadT.current = 0;
      useBattleStore.getState().setWarning("RELOADING");
    }

    // ---------- Camera: fixed height, follows turret facing ----------
    const cam = state.camera;
    const aimYaw = pl.yaw + pl.turretYaw;
    const sinA = Math.sin(aimYaw);
    const cosA = Math.cos(aimYaw);
    const back = 12;
    const camHeight = h + 2.4;
    tmp.v1.set(
      pl.pos.x + sinA * back,
      pl.pos.y + camHeight,
      pl.pos.z + cosA * back
    );
    tmp.v1.y = Math.max(tmp.v1.y, terrainHeight(tmp.v1.x, tmp.v1.z) + 2);
    if (!camReady.current) {
      cam.position.copy(tmp.v1);
      camReady.current = true;
    } else {
      cam.position.lerp(tmp.v1, 1 - Math.exp(-10 * dt));
    }
    // Look ahead along turret aim so crosshair (center) matches gun direction
    const lookDist = 40;
    cam.lookAt(
      pl.pos.x - sinA * lookDist,
      pl.pos.y + h * 0.5 + Math.sin(pl.pitch) * lookDist,
      pl.pos.z - cosA * lookDist
    );

    // ---------- Fire LMB: from muzzle toward terrain point under screen center ----------
    const fireInterval = weapon.rpm > 0 ? 60 / weapon.rpm : 0.2;
    const canFire =
      alive &&
      game.input.fire &&
      muzzleRef.current &&
      !reloading.current &&
      ammo.current > 0 &&
      now - lastShot.current > fireInterval &&
      !weapon.isCharge;

    if (canFire) {
      lastShot.current = now;
      ammo.current -= 1;
      muzzleRef.current!.getWorldPosition(tmp.v1);

      // Screen-center ray = exact crosshair direction (elevation included)
      tmp.v2.set(0, 0, 0.5).unproject(cam);
      tmp.v2.sub(cam.position).normalize();
      const rayDir = tmp.v2.clone();
      const isMortar = weapon.weaponType === "mortar";
      const spd = Math.max(25, weapon.projectileSpeed);

      if (isMortar) {
        // Mortar: impact mean point is ground under reticle
        aimPointOnTerrain(cam.position, rayDir, tmp.aim, 220);
        const toAim = tmp.aim.clone().sub(tmp.v1);
        const distAim = Math.max(8, toAim.length());
        const flight = Math.max(0.55, distAim / spd);
        toAim.y += 0.5 * 9.8 * flight * flight;
        tmp.v2.copy(toAim.normalize().multiplyScalar(spd));
      } else {
        // Direct fire: pure crosshair ray — no terrain pull, no dip
        tmp.v2.copy(rayDir).multiplyScalar(spd);
      }

      spawnProjectile({
        pos: tmp.v1.clone(),
        vel: tmp.v2.clone(),
        damage: weapon.damage,
        owner: "player",
        life: Math.max(2.5, (weapon.range / Math.max(1, weapon.projectileSpeed)) * 1.6),
        splash: weapon.splashRadius
          ? weapon.splashRadius * 0.15
          : 0.9 + weapon.damage / 200,
        ballistic: isMortar,
      });
      spawnEffect(tmp.v1, 0.8, 0.12);
      recoil.current = 1;
      speed.current -= weapon.recoil * 0.0006;
      useBattleStore.getState().setAmmo(ammo.current, false, 0);
    }

    // Track scroll + wheel spin
    const scroll = speed.current * dt * 0.32;
    if (trackMatL.current?.map) trackMatL.current.map.offset.y -= scroll;
    if (trackMatR.current?.map) trackMatR.current.map.offset.y -= scroll;
    wheelSpin.current -= speed.current * dt * 1.7;
    for (const wh of wheelRefs.current) {
      if (wh) wh.rotation.x = wheelSpin.current;
    }

    if (!alive && !deadFx.current) {
      deadFx.current = true;
      spawnEffect(tmp.v1.set(pl.pos.x, pl.pos.y + 1, pl.pos.z), 4, 1);
    }
  });

  const barrelZ = -l * 0.38;
  const trackY = -h / 2 + 0.2;

  return (
    <group ref={groupRef}>
      {/* Lower chassis / sponson depth */}
      <mesh position={[0, -h * 0.12, 0]} castShadow receiveShadow>
        <boxGeometry args={[w * 1.05, h * 0.55, l * 0.98]} />
        <meshStandardMaterial color="#4f5a48" metalness={0.15} roughness={0.88} />
      </mesh>
      {/* Main armored hull */}
      <mesh position={[0, h * 0.08, 0]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.92, h * 0.7, l * 0.88]} />
        <meshStandardMaterial color="#66745a" metalness={0.18} roughness={0.82} />
      </mesh>
      {/* Raised front glacis */}
      <mesh position={[0, h * 0.22, l * 0.28]} rotation={[-0.18, 0, 0]} castShadow>
        <boxGeometry args={[w * 0.8, h * 0.32, l * 0.3]} />
        <meshStandardMaterial color="#788467" metalness={0.12} roughness={0.88} />
      </mesh>
      {/* Rear deck step */}
      <mesh position={[0, h * 0.15, -l * 0.32]} castShadow>
        <boxGeometry args={[w * 0.75, h * 0.2, l * 0.22]} />
        <meshStandardMaterial color="#5a6652" metalness={0.14} roughness={0.86} />
      </mesh>

      {/* Tracks with real depth: outer pad + inner well + wheels */}
      {([-1, 1] as const).map((side, si) => (
        <group key={side} position={[side * (w / 2 + 0.16), trackY, 0]}>
          {/* Outer track band */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.42, 0.52, l * 0.98]} />
            <meshStandardMaterial
              ref={si === 0 ? trackMatL : trackMatR}
              map={trackTex.current!}
              color="#b0b0b0"
              metalness={0.12}
              roughness={0.94}
            />
          </mesh>
          {/* Inner dark well for depth */}
          <mesh position={[side * -0.12, 0.02, 0]}>
            <boxGeometry args={[0.2, 0.38, l * 0.9]} />
            <meshStandardMaterial color="#1a1c18" metalness={0.05} roughness={0.95} />
          </mesh>
          {/* Top return run */}
          <mesh position={[0, 0.28, 0]} castShadow>
            <boxGeometry args={[0.36, 0.08, l * 0.92]} />
            <meshStandardMaterial color="#3a3c36" metalness={0.2} roughness={0.9} />
          </mesh>
          {/* Road wheels */}
          {Array.from({ length: 5 }, (_, i) => (
            <mesh
              key={i}
              ref={(el) => {
                wheelRefs.current[si * 5 + i] = el;
              }}
              position={[side * 0.08, -0.08, -l * 0.36 + i * l * 0.18]}
              rotation={[0, 0, Math.PI / 2]}
              castShadow
            >
              <cylinderGeometry args={[0.14, 0.14, 0.16, 10]} />
              <meshStandardMaterial color="#3a3c36" metalness={0.35} roughness={0.75} />
            </mesh>
          ))}
          {/* Front/rear idlers */}
          {([-l * 0.46, l * 0.46] as const).map((z, j) => (
            <mesh
              key={`id-${j}`}
              position={[side * 0.08, 0.02, z]}
              rotation={[0, 0, Math.PI / 2]}
              castShadow
            >
              <cylinderGeometry args={[0.12, 0.12, 0.14, 10]} />
              <meshStandardMaterial color="#2a2c28" metalness={0.4} roughness={0.7} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Turret — box body so barrel never clips a flat cylinder face */}
      <group ref={turretRef} position={[0, h / 2 + 0.22, -0.08]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.35, 0.55, 1.45]} />
          <meshStandardMaterial color="#6e7a62" metalness={0.2} roughness={0.78} />
        </mesh>
        {/* Rounded-ish top plate */}
        <mesh position={[0, 0.28, 0]} castShadow>
          <boxGeometry args={[1.15, 0.12, 1.2]} />
          <meshStandardMaterial color="#7a866c" metalness={0.18} roughness={0.8} />
        </mesh>
        {/* Mantlet / gun shield in front of barrel root */}
        <mesh position={[0, 0.06, -0.55]} castShadow>
          <boxGeometry args={[0.55, 0.4, 0.28]} />
          <meshStandardMaterial color="#4a5344" metalness={0.25} roughness={0.7} />
        </mesh>
        {/* Barrel sits in front of mantlet — no penetration through turret block */}
        <mesh
          ref={barrelRef}
          position={[0, 0.06, barrelZ]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
        >
          <cylinderGeometry args={[0.09, 0.12, l * 0.55, 10]} />
          <meshStandardMaterial color="#2e342e" metalness={0.45} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.06, barrelZ - l * 0.22]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.14, 0.14, 0.18, 10]} />
          <meshStandardMaterial color="#1e221e" metalness={0.5} roughness={0.5} />
        </mesh>
        {/* Hatch */}
        <mesh position={[0.35, 0.38, 0.15]} castShadow>
          <cylinderGeometry args={[0.18, 0.2, 0.1, 8]} />
          <meshStandardMaterial color="#8a947c" metalness={0.15} roughness={0.85} />
        </mesh>
        <object3D ref={muzzleRef} position={[0, 0.06, -l * 0.65]} />
      </group>
    </group>
  );
}
