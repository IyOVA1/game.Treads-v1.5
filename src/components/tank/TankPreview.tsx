import { useMemo } from "react";
import { TankBlueprint, getPart, ChassisPart, WeaponPart } from "../../data/parts";

interface Props {
  blueprint: TankBlueprint;
}

export function TankPreview({ blueprint }: Props) {
  const chassis = getPart<ChassisPart>(blueprint.chassisId)!;
  const weapon = getPart<WeaponPart>(blueprint.weaponId)!;

  const [w, h, l] = chassis.size;

  // Simple procedural colors by tier
  const bodyColor = useMemo(() => {
    const tier = chassis.tier;
    return tier === 1 ? "#69775b" : tier === 2 ? "#53634a" : "#343f33";
  }, [chassis.tier]);

  return (
    <group position={[0, h / 2, 0]}>
      {/* Hull */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, l]} />
        <meshStandardMaterial color={bodyColor} metalness={0.4} roughness={0.6} />
      </mesh>

      {/* Tracks (left/right) */}
      <mesh position={[-w / 2 - 0.15, -h / 2 + 0.25, 0]} castShadow>
        <boxGeometry args={[0.35, 0.5, l * 0.95]} />
        <meshStandardMaterial color="#303630" />
      </mesh>
      <mesh position={[w / 2 + 0.15, -h / 2 + 0.25, 0]} castShadow>
        <boxGeometry args={[0.35, 0.5, l * 0.95]} />
        <meshStandardMaterial color="#303630" />
      </mesh>
      {[-1, 1].map((side) => Array.from({ length: 5 }, (_, i) => (
        <mesh key={`${side}-${i}`} position={[side * (w / 2 + 0.34), -h / 2 + 0.25, -l * 0.36 + i * l * 0.18]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 0.045, 10]} />
          <meshStandardMaterial color="#85877a" metalness={0.3} roughness={0.78} />
        </mesh>
      )))}

      {/* Turret */}
      <group position={[0, h / 2 + 0.25, -0.2]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.7, 0.85, 0.5, 8]} />
          <meshStandardMaterial color="#788368" metalness={0.18} roughness={0.8} />
        </mesh>

        {/* Barrel */}
        <mesh
          position={[0, 0.1, l * 0.35 + 0.4]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
        >
          <cylinderGeometry args={[0.12, 0.15, l * 0.55 + 0.6, 8]} />
          <meshStandardMaterial color="#343d35" metalness={0.42} roughness={0.62} />
        </mesh>

        {/* Muzzle brake hint for higher tiers */}
        {weapon.tier >= 2 && (
          <mesh position={[0, 0.1, l * 0.55 + 0.7]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.18, 0.18, 0.25, 6]} />
            <meshStandardMaterial color="#303630" />
          </mesh>
        )}
      </group>
    </group>
  );
}
