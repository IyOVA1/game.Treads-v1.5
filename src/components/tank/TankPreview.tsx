import { useMemo } from "react";
import { TankBlueprint, getPart, ChassisPart, WeaponPart } from "../../data/parts";

interface Props {
  blueprint: TankBlueprint;
}

export function TankPreview({ blueprint }: Props) {
  const chassis = getPart<ChassisPart>(blueprint.chassisId)!;
  const weapon = getPart<WeaponPart>(blueprint.weaponId)!;
  const [w, h, l] = chassis.size;

  const bodyColor = useMemo(() => {
    const tier = chassis.tier;
    return tier === 1 ? "#66745a" : tier === 2 ? "#53634a" : "#3a4338";
  }, [chassis.tier]);

  return (
    <group position={[0, h / 2, 0]}>
      <mesh position={[0, -h * 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[w * 1.05, h * 0.55, l * 0.98]} />
        <meshStandardMaterial color="#4f5a48" metalness={0.15} roughness={0.88} />
      </mesh>
      <mesh position={[0, h * 0.08, 0]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.92, h * 0.7, l * 0.88]} />
        <meshStandardMaterial color={bodyColor} metalness={0.2} roughness={0.8} />
      </mesh>
      {([-1, 1] as const).map((side) => (
        <group key={side} position={[side * (w / 2 + 0.16), -h / 2 + 0.22, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.42, 0.5, l * 0.96]} />
            <meshStandardMaterial color="#303630" />
          </mesh>
          <mesh position={[side * -0.1, 0.02, 0]}>
            <boxGeometry args={[0.18, 0.36, l * 0.88]} />
            <meshStandardMaterial color="#1a1c18" />
          </mesh>
          {Array.from({ length: 5 }, (_, i) => (
            <mesh
              key={i}
              position={[side * 0.08, -0.06, -l * 0.36 + i * l * 0.18]}
              rotation={[0, 0, Math.PI / 2]}
              castShadow
            >
              <cylinderGeometry args={[0.13, 0.13, 0.14, 10]} />
              <meshStandardMaterial color="#4a4c45" metalness={0.3} roughness={0.78} />
            </mesh>
          ))}
        </group>
      ))}
      <group position={[0, h / 2 + 0.22, -0.08]}>
        <mesh castShadow>
          <boxGeometry args={[1.35, 0.55, 1.45]} />
          <meshStandardMaterial color="#6e7a62" metalness={0.2} roughness={0.78} />
        </mesh>
        <mesh position={[0, 0.06, -0.55]} castShadow>
          <boxGeometry args={[0.55, 0.4, 0.28]} />
          <meshStandardMaterial color="#4a5344" />
        </mesh>
        <mesh position={[0, 0.06, -l * 0.38]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.12, l * 0.55, 10]} />
          <meshStandardMaterial color="#2e342e" metalness={0.45} roughness={0.55} />
        </mesh>
        {weapon.tier >= 2 && (
          <mesh position={[0, 0.06, -l * 0.6]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.14, 0.14, 0.2, 8]} />
            <meshStandardMaterial color="#1e221e" />
          </mesh>
        )}
      </group>
    </group>
  );
}
