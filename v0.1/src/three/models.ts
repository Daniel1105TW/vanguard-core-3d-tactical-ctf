import * as THREE from 'three';
import {
  DEFAULT_MAP_LAYOUT,
  FLAG_BASES,
  GADGETS,
  UNDERGROUND_GRID,
  WEAPON_ORDER,
} from '../shared/gameConfig.ts';
import type { GadgetId, MapLayout, TeamId, WeaponId } from '../shared/gameConfig.ts';
import type { ProceduralTextureSet } from './proceduralTextures.ts';

export interface TrooperRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  rightArmGroup: THREE.Group;
  carriedFlagGroup: THREE.Group;
  hpFillMesh: THREE.Mesh;
  nameSprite: THREE.Sprite;
  updateHealth: (hp: number, maxHp: number) => void;
  setCarriedFlag: (flagTeam: TeamId | null) => void;
  setActiveWeapon: (weaponId: WeaponId) => void;
  triggerAction: (isMelee: boolean) => void;
  animateWalk: (speed: number, time: number, pitch: number, crouching?: boolean) => void;
  flashHit: (headshot?: boolean) => void;
  updateFlash: (dt: number) => void;
}

export interface WeaponViewRig {
  root: THREE.Group;
  muzzleNode: THREE.Object3D;
  muzzleFlash: THREE.Mesh;
  spinnerNode?: THREE.Object3D;
}

export function createWeaponViewmodel(weaponId: WeaponId, team: TeamId): WeaponViewRig {
  const root = new THREE.Group();
  const teamAccent = team === 'red' ? 0xef4444 : 0x06b6d4;
  const accentHex =
    weaponId === 'pistol'
      ? 0x38bdf8
      : weaponId === 'smg'
        ? 0x22d3ee
        : weaponId === 'vector'
          ? 0x2dd4bf
          : weaponId === 'shotgun'
            ? 0xf97316
            : weaponId === 'rifle'
              ? 0xfbbf24
              : weaponId === 'burst'
                ? 0x34d399
                : weaponId === 'freezer'
                  ? 0x7dd3fc
                  : weaponId === 'laser'
                    ? 0x67e8f9
                    : weaponId === 'gatling'
                      ? 0xf43f5e
                      : weaponId === 'autocannon'
                        ? 0xfb7185
                        : weaponId === 'plasma'
                          ? 0xe879f9
                          : weaponId === 'katana'
                            ? 0x22d3ee
                            : weaponId === 'twinblades'
                              ? 0xc084fc
                              : weaponId === 'greatsword'
                                ? 0xf97316
                                : weaponId === 'plasma_saber'
                                  ? 0xf43f5e
                                  : 0xc084fc;

  const gunmetal = new THREE.MeshStandardMaterial({
    color: 0x2a3444,
    metalness: 0.85,
    roughness: 0.28,
  });
  const darkAlloy = new THREE.MeshStandardMaterial({
    color: 0x161c26,
    metalness: 0.6,
    roughness: 0.55,
  });
  const polymerGrip = new THREE.MeshStandardMaterial({
    color: 0x0f131a,
    metalness: 0.1,
    roughness: 0.88,
  });
  const chromeRail = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.95,
    roughness: 0.18,
  });
  const energyMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 2.2,
    roughness: 0.2,
    metalness: 0.1,
  });
  const teamStripMat = new THREE.MeshStandardMaterial({
    color: teamAccent,
    emissive: teamAccent,
    emissiveIntensity: 1.4,
    roughness: 0.3,
  });

  const muzzleNode = new THREE.Object3D();
  let spinnerNode: THREE.Object3D | undefined;

  if (weaponId === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.075, 0.34), gunmetal);
    slide.position.set(0, 0.02, -0.04);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.045, 0.28), darkAlloy);
    frame.position.set(0, -0.025, -0.01);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.08), polymerGrip);
    grip.position.set(0, -0.095, 0.08);
    grip.rotation.x = 0.22;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.09, 12), chromeRail);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.23);
    const energyStrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.014, 0.2), energyMat);
    energyStrip.position.set(0, 0.028, -0.04);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.026, 0.045), darkAlloy);
    sight.position.set(0, 0.068, 0.02);
    const sightDot = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, 0.006), teamStripMat);
    sightDot.position.set(0, 0.072, 0.04);

    root.add(slide, frame, grip, barrel, energyStrip, sight, sightDot);
    muzzleNode.position.set(0, 0.02, -0.29);
  } else if (weaponId === 'smg') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.42), gunmetal);
    body.position.set(0, 0.01, -0.06);
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.2, 10), darkAlloy);
    shroud.rotation.x = Math.PI / 2;
    shroud.position.set(0, 0.018, -0.34);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 10), chromeRail);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.018, -0.45);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.14, 0.075), polymerGrip);
    grip.position.set(0, -0.09, 0.08);
    grip.rotation.x = 0.2;
    const extMag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.055), darkAlloy);
    extMag.position.set(0, -0.12, -0.11);
    extMag.rotation.x = -0.18;
    const coil = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.02, 0.24), energyMat);
    coil.position.set(0, 0.03, -0.08);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.18), polymerGrip);
    stock.position.set(0, 0.0, 0.21);
    const holo = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.04, 0.07), darkAlloy);
    holo.position.set(0, 0.078, -0.01);

    root.add(body, shroud, barrel, grip, extMag, coil, stock, holo);
    muzzleNode.position.set(0, 0.018, -0.51);
  } else if (weaponId === 'shotgun') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.38), gunmetal);
    receiver.position.set(0, 0.01, -0.02);
    const barrelTop = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.44, 12), chromeRail);
    barrelTop.rotation.x = Math.PI / 2;
    barrelTop.position.set(0, 0.04, -0.36);
    const tubeBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.38, 12), darkAlloy);
    tubeBottom.rotation.x = Math.PI / 2;
    tubeBottom.position.set(0, -0.008, -0.33);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.065, 0.2), polymerGrip);
    pump.position.set(0, -0.016, -0.3);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.15, 0.08), polymerGrip);
    grip.position.set(0, -0.09, 0.1);
    grip.rotation.x = 0.28;
    const heatAccent = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.022, 0.24), energyMat);
    heatAccent.position.set(0, 0.042, -0.05);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.11, 0.24), darkAlloy);
    stock.position.set(0, -0.02, 0.24);

    root.add(receiver, barrelTop, tubeBottom, pump, grip, heatAccent, stock);
    muzzleNode.position.set(0, 0.04, -0.6);
  } else if (weaponId === 'rifle') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.105, 0.46), gunmetal);
    receiver.position.set(0, 0.01, -0.05);
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.08, 0.32), darkAlloy);
    handguard.position.set(0, 0.018, -0.36);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.24, 12), chromeRail);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.58);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.18, 0.078), darkAlloy);
    mag.position.set(0, -0.11, -0.12);
    mag.rotation.x = -0.14;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.14, 0.075), polymerGrip);
    grip.position.set(0, -0.09, 0.09);
    grip.rotation.x = 0.22;
    const energyRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.018, 0.36), energyMat);
    energyRail.position.set(0, 0.035, -0.16);
    const holoFrame = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.05, 0.085), darkAlloy);
    holoFrame.position.set(0, 0.085, -0.03);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.1, 0.22), polymerGrip);
    stock.position.set(0, -0.01, 0.24);

    root.add(receiver, handguard, barrel, mag, grip, energyRail, holoFrame, stock);
    muzzleNode.position.set(0, 0.02, -0.71);
  } else if (weaponId === 'burst') {
    // Precision Pulse Marksman Carbine with 2x optic
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.105, 0.5), gunmetal);
    receiver.position.set(0, 0.01, -0.06);
    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.072, 0.36), darkAlloy);
    shroud.position.set(0, 0.02, -0.4);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.26, 12), chromeRail);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.022, -0.64);
    const optic = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.22, 14), darkAlloy);
    optic.rotation.x = Math.PI / 2;
    optic.position.set(0, 0.095, -0.06);
    const opticGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 14), energyMat);
    opticGlow.rotation.x = Math.PI / 2;
    opticGlow.position.set(0, 0.095, 0.05);
    const coil = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.016, 0.42), energyMat);
    coil.position.set(0, 0.028, -0.22);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.15, 0.075), darkAlloy);
    mag.position.set(0, -0.095, -0.14);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.13, 0.075), polymerGrip);
    grip.position.set(0, -0.085, 0.09);
    grip.rotation.x = 0.22;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.095, 0.24), polymerGrip);
    stock.position.set(0, -0.01, 0.25);

    root.add(receiver, shroud, barrel, optic, opticGlow, coil, mag, grip, stock);
    muzzleNode.position.set(0, 0.022, -0.78);
  } else if (weaponId === 'gatling') {
    // Vulcan 6-Barrel Rotary Gatling Minigun
    const driveHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.082, 0.34, 14), gunmetal);
    driveHousing.rotation.x = Math.PI / 2;
    driveHousing.position.set(0, -0.02, -0.1);
    const ammoDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.18, 16), darkAlloy);
    ammoDrum.rotation.z = Math.PI / 2;
    ammoDrum.position.set(-0.075, -0.11, -0.06);
    const drumGlow = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.12), energyMat);
    drumGlow.position.set(-0.165, -0.11, -0.06);

    // Top carry handle & rear grip
    const handleBar = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.028, 0.28), darkAlloy);
    handleBar.position.set(0, 0.095, -0.1);
    const handlePost1 = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.065, 0.03), darkAlloy);
    handlePost1.position.set(0, 0.065, -0.22);
    const handlePost2 = handlePost1.clone();
    handlePost2.position.z = 0.02;
    const rearGrip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.08), polymerGrip);
    rearGrip.position.set(0, -0.07, 0.12);
    rearGrip.rotation.x = 0.28;

    // Rotating 6-barrel cluster
    spinnerNode = new THREE.Group();
    spinnerNode.position.set(0, -0.02, -0.48);
    const ringRadius = 0.046;
    const barrelGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.48, 8);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = new THREE.Mesh(barrelGeo, chromeRail);
      b.rotation.x = Math.PI / 2;
      b.position.set(Math.cos(a) * ringRadius, Math.sin(a) * ringRadius, 0);
      spinnerNode.add(b);
    }
    const clampFront = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.04, 12), darkAlloy);
    clampFront.rotation.x = Math.PI / 2;
    clampFront.position.z = -0.16;
    const clampMid = clampFront.clone();
    clampMid.position.z = 0.08;
    const heatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.022, 12), energyMat);
    heatBand.rotation.x = Math.PI / 2;
    heatBand.position.z = -0.04;
    spinnerNode.add(clampFront, clampMid, heatBand);

    root.add(driveHousing, ammoDrum, drumGlow, handleBar, handlePost1, handlePost2, rearGrip, spinnerNode);
    muzzleNode.position.set(0, -0.02, -0.74);
  } else if (weaponId === 'plasma') {
    // Nova Twin-Rail Plasma Cannon
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.135, 0.48), gunmetal);
    chassis.position.set(0, 0.01, -0.05);
    const prongLeft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.048, 0.42), chromeRail);
    prongLeft.position.set(-0.046, 0.02, -0.45);
    const prongRight = prongLeft.clone();
    prongRight.position.x = 0.046;
    const plasmaCore = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), energyMat);
    plasmaCore.position.set(0, 0.02, -0.34);
    const beamTrack = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.36), energyMat);
    beamTrack.position.set(0, 0.02, -0.48);
    const fin1 = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.18), darkAlloy);
    fin1.position.set(0, 0.075, -0.14);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.085), polymerGrip);
    grip.position.set(0, -0.095, 0.09);
    grip.rotation.x = 0.24;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.24), darkAlloy);
    stock.position.set(0, -0.01, 0.25);

    root.add(chassis, prongLeft, prongRight, plasmaCore, beamTrack, fin1, grip, stock);
    muzzleNode.position.set(0, 0.02, -0.68);
  } else if (weaponId === 'vector') {
    // Cyclone Compact PDW
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.11, 0.36), gunmetal);
    body.position.set(0, 0.015, -0.05);
    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.078, 0.22), darkAlloy);
    shroud.position.set(0, 0.025, -0.32);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 10), chromeRail);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.025, -0.45);
    const diagMag = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.22, 0.052), darkAlloy);
    diagMag.position.set(0, -0.11, -0.14);
    diagMag.rotation.x = -0.34;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.13, 0.072), polymerGrip);
    grip.position.set(0, -0.085, 0.07);
    grip.rotation.x = 0.22;
    const neonStrip = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.018, 0.28), energyMat);
    neonStrip.position.set(0, 0.036, -0.14);
    const holo = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.038, 0.068), darkAlloy);
    holo.position.set(0, 0.086, -0.02);

    root.add(body, shroud, barrel, diagMag, grip, neonStrip, holo);
    muzzleNode.position.set(0, 0.025, -0.5);
  } else if (weaponId === 'freezer') {
    // Cryo Frost Rifle with glowing ice canister
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.11, 0.48), gunmetal);
    receiver.position.set(0, 0.01, -0.06);
    const cryoTank = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.22, 12), energyMat);
    cryoTank.rotation.x = Math.PI / 2;
    cryoTank.position.set(0, 0.068, -0.22);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.36, 12), chromeRail);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.46);
    const finRing1 = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.008, 8, 16), energyMat);
    finRing1.position.set(0, 0.02, -0.42);
    const finRing2 = finRing1.clone();
    finRing2.position.z = -0.52;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.075), polymerGrip);
    grip.position.set(0, -0.09, 0.09);
    grip.rotation.x = 0.22;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.1, 0.22), darkAlloy);
    stock.position.set(0, -0.01, 0.24);

    root.add(receiver, cryoTank, barrel, finRing1, finRing2, grip, stock);
    muzzleNode.position.set(0, 0.02, -0.66);
  } else if (weaponId === 'laser') {
    // Helios Prismatic Laser Rifle
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.105, 0.5), gunmetal);
    chassis.position.set(0, 0.01, -0.06);
    const prismUpper = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.024, 0.42), chromeRail);
    prismUpper.position.set(0, 0.055, -0.4);
    const prismLower = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.024, 0.42), darkAlloy);
    prismLower.position.set(0, -0.015, -0.4);
    const coreBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.44, 10), energyMat);
    coreBeam.rotation.x = Math.PI / 2;
    coreBeam.position.set(0, 0.02, -0.42);
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.12), energyMat);
    cell.position.set(0, -0.03, -0.14);
    const optic = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.09), darkAlloy);
    optic.position.set(0, 0.09, -0.04);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.14, 0.075), polymerGrip);
    grip.position.set(0, -0.09, 0.09);
    grip.rotation.x = 0.22;

    root.add(chassis, prismUpper, prismLower, coreBeam, cell, optic, grip);
    muzzleNode.position.set(0, 0.02, -0.66);
  } else if (weaponId === 'autocannon') {
    // Hydra Heavy Explosive Autocannon
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.14, 0.52), gunmetal);
    body.position.set(0, 0.01, -0.05);
    const heavyBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.038, 0.48, 12), chromeRail);
    heavyBarrel.rotation.x = Math.PI / 2;
    heavyBarrel.position.set(0, 0.025, -0.5);
    const muzzleBrake = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.075, 0.12), darkAlloy);
    muzzleBrake.position.set(0, 0.025, -0.74);
    const ammoBox = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.16), darkAlloy);
    ammoBox.position.set(-0.075, -0.08, -0.12);
    const chargeGlow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.024, 0.36), energyMat);
    chargeGlow.position.set(0, 0.052, -0.16);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.14, 0.08), polymerGrip);
    grip.position.set(0, -0.095, 0.1);
    grip.rotation.x = 0.25;

    root.add(body, heavyBarrel, muzzleBrake, ammoBox, chargeGlow, grip);
    muzzleNode.position.set(0, 0.025, -0.82);
  } else if (weaponId === 'katana') {
    // Cyber Energy Katana (tilted tactical ready pose)
    const swordGroup = new THREE.Group();
    swordGroup.rotation.set(-0.35, 0.14, -0.22);
    swordGroup.position.set(0.02, -0.02, -0.08);

    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.26, 10), polymerGrip);
    hilt.position.set(0, -0.12, 0);
    const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.018, 8), darkAlloy);
    tsuba.position.set(0, 0.02, 0);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.72, 0.032), gunmetal);
    spine.position.set(0, 0.39, 0.01);
    const energyEdge = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.74, 0.022), energyMat);
    energyEdge.position.set(0, 0.4, -0.016);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.12, 4), energyMat);
    tip.position.set(0, 0.81, -0.004);
    tip.rotation.y = Math.PI / 4;

    swordGroup.add(hilt, tsuba, spine, energyEdge, tip);
    root.add(swordGroup);
    muzzleNode.position.set(0, 0.35, -0.45);
  } else if (weaponId === 'twinblades') {
    // Phantom Twinblades (right primary + angled left secondary dagger)
    const makeDagger = (side: number) => {
      const g = new THREE.Group();
      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.2, 8), polymerGrip);
      hilt.position.y = -0.08;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.018, 0.03), darkAlloy);
      guard.position.y = 0.02;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.46, 0.036), chromeRail);
      blade.position.y = 0.26;
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.48, 0.018), energyMat);
      edge.position.set(0, 0.27, -0.022);
      g.add(hilt, guard, blade, edge);
      g.position.set(side > 0 ? 0.04 : -0.42, -0.02, -0.1);
      g.rotation.set(-0.42, side * 0.22, -side * 0.32);
      return g;
    };
    root.add(makeDagger(1), makeDagger(-1));
    muzzleNode.position.set(-0.15, 0.22, -0.42);
  } else if (weaponId === 'greatsword') {
    // Titan Lava Greatsword
    const swordGroup = new THREE.Group();
    swordGroup.rotation.set(-0.3, 0.16, -0.26);
    swordGroup.position.set(0.04, -0.04, -0.1);

    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.028, 0.3, 10), polymerGrip);
    hilt.position.y = -0.15;
    const crossguard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.038, 0.05), darkAlloy);
    crossguard.position.y = 0.01;
    const bladeMain = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.82, 0.12), gunmetal);
    bladeMain.position.y = 0.44;
    const lavaCore = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.72, 0.038), energyMat);
    lavaCore.position.y = 0.42;
    const edgeGlow = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.84, 0.135), energyMat);
    edgeGlow.position.y = 0.45;

    swordGroup.add(hilt, crossguard, bladeMain, lavaCore, edgeGlow);
    root.add(swordGroup);
    muzzleNode.position.set(0, 0.4, -0.5);
  } else if (weaponId === 'plasma_saber') {
    // Starcore Plasma Saber
    const swordGroup = new THREE.Group();
    swordGroup.rotation.set(-0.34, 0.14, -0.2);
    swordGroup.position.set(0.02, -0.02, -0.08);

    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.24, 12), chromeRail);
    hilt.position.y = -0.1;
    const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.028, 0.06, 12), darkAlloy);
    emitter.position.y = 0.04;
    const haloRing = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.008, 8, 18), energyMat);
    haloRing.rotation.x = Math.PI / 2;
    haloRing.position.y = 0.07;
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const coreBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.78, 12), coreMat);
    coreBeam.position.y = 0.46;
    const outerBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.8, 12), energyMat);
    outerBeam.position.y = 0.46;

    swordGroup.add(hilt, emitter, haloRing, coreBeam, outerBeam);
    root.add(swordGroup);
    muzzleNode.position.set(0, 0.38, -0.45);
  } else {
    // Sniper Railgun
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.12, 0.56), gunmetal);
    chassis.position.set(0, 0.01, -0.08);
    const railUpper = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.026, 0.58), chromeRail);
    railUpper.position.set(0, 0.05, -0.55);
    const railLower = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.026, 0.58), chromeRail);
    railLower.position.set(0, -0.01, -0.55);
    const plasmaCore = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.022, 0.54), energyMat);
    plasmaCore.position.set(0, 0.02, -0.52);
    const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.28, 14), darkAlloy);
    scopeTube.rotation.x = Math.PI / 2;
    scopeTube.position.set(0, 0.1, -0.08);
    const scopeLens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.01, 14),
      teamStripMat,
    );
    scopeLens.rotation.x = Math.PI / 2;
    scopeLens.position.set(0, 0.1, 0.06);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.08), polymerGrip);
    grip.position.set(0, -0.09, 0.1);
    grip.rotation.x = 0.22;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.26), darkAlloy);
    stock.position.set(0, -0.01, 0.28);

    root.add(chassis, railUpper, railLower, plasmaCore, scopeTube, scopeLens, grip, stock);
    muzzleNode.position.set(0, 0.02, -0.86);
  }

  // Muzzle Flash Sprite Mesh
  const flashMat = new THREE.MeshBasicMaterial({
    color: accentHex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const muzzleFlash = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), flashMat);
  muzzleFlash.scale.set(1, 1, 2.2);
  muzzleNode.add(muzzleFlash);
  root.add(muzzleNode);

  return { root, muzzleNode, muzzleFlash, spinnerNode };
}

export function createFlagMesh(team: TeamId): THREE.Group {
  const group = new THREE.Group();
  const color = team === 'red' ? 0xef4444 : 0x06b6d4;
  const emissive = team === 'red' ? 0xdc2626 : 0x0891b2;

  const poleMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.92,
    roughness: 0.2,
  });
  const bannerMat = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 1.5,
    roughness: 0.35,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  const ringMat = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 2.0,
    roughness: 0.2,
  });

  // 1. Base emitter ring
  const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.12, 16), poleMat);
  emitter.position.y = 0.06;

  // 2. Vertical pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 2.5, 12), poleMat);
  pole.position.y = 1.25;

  // 3. Top finial orb
  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 1), ringMat);
  orb.position.y = 2.58;

  // 4. Holographic Banner
  const banner = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.62, 0.05), bannerMat);
  banner.position.set(0.5, 2.05, 0);

  // 5. Beacon vertical energy shaft (soft transparent)
  const beamMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.32, 9, 12, 1, true), beamMat);
  beam.position.y = 4.5;

  group.add(emitter, pole, orb, banner, beam);
  return group;
}

function makeNameplateSprite(name: string, team: TeamId, isBot: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 64);

  ctx.fillStyle = 'rgba(9, 13, 22, 0.78)';
  ctx.beginPath();
  ctx.roundRect(12, 12, 232, 40, 8);
  ctx.fill();

  ctx.strokeStyle = team === 'red' ? '#ef4444' : '#06b6d4';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = 'bold 20px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  const label = isBot ? name : name;
  ctx.fillText(label.slice(0, 14), 128, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.85, 0.46, 1);
  return sprite;
}

export function createTrooperRig(
  team: TeamId,
  name: string,
  isBot: boolean,
  contactShadowTex: THREE.Texture,
): TrooperRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const primaryHex = team === 'red' ? 0xdc2626 : 0x0284c7;
  const glowHex = team === 'red' ? 0xf87171 : 0x22d3ee;

  const armorMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    emissive: 0x000000,
    emissiveIntensity: 0,
    metalness: 0.75,
    roughness: 0.32,
  });
  const teamPlateMat = new THREE.MeshStandardMaterial({
    color: primaryHex,
    emissive: 0x000000,
    emissiveIntensity: 0,
    metalness: 0.4,
    roughness: 0.45,
  });
  const darkJointMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.15,
    roughness: 0.85,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: glowHex,
    emissive: glowHex,
    emissiveIntensity: 1.8,
    roughness: 0.15,
    metalness: 0.3,
  });

  // Ground contact shadow
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.4),
    new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.6,
    }),
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.03;
  root.add(shadowPlane);

  // 1-2. Articulated Legs (bottom at y=0)
  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.28), darkJointMat);
  leftLeg.position.set(-0.16, 0.36, 0);
  leftLeg.castShadow = true;
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.28), darkJointMat);
  rightLeg.position.set(0.16, 0.36, 0);
  rightLeg.castShadow = true;

  // 3. Armored Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.68, 0.38), armorMat);
  torso.position.set(0, 1.04, 0);
  torso.castShadow = true;

  // 4. Chest Team Plate & Core
  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.36, 0.42), teamPlateMat);
  chestPlate.position.set(0, 1.1, 0);
  const coreLight = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.44), visorMat);
  coreLight.position.set(0, 1.12, 0);

  // 5-6. Shoulder Pauldrons
  const leftPauldron = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.32), teamPlateMat);
  leftPauldron.position.set(-0.42, 1.28, 0);
  const rightPauldron = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.32), teamPlateMat);
  rightPauldron.position.set(0.42, 1.28, 0);

  // 7. Helmet + Visor HeadGroup
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.56, 0);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.36, 0.4), armorMat);
  helmet.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.08), visorMat);
  visor.position.set(0, 0.02, -0.19);
  headGroup.add(helmet, visor);

  // 8. Weapon Arm + All 16 Third-Person Weapon Rigs
  const rightArmGroup = new THREE.Group();
  rightArmGroup.position.set(0.38, 1.15, -0.05);
  const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.44), darkJointMat);
  armMesh.position.set(0, -0.05, -0.18);
  rightArmGroup.add(armMesh);

  const weaponMount = new THREE.Group();
  weaponMount.position.set(-0.04, 0.02, -0.44);
  weaponMount.scale.setScalar(0.86);
  rightArmGroup.add(weaponMount);

  const weaponRigs = new Map<WeaponId, WeaponViewRig>();
  for (const wid of WEAPON_ORDER) {
    const wRig = createWeaponViewmodel(wid, team);
    wRig.root.visible = wid === 'pistol';
    wRig.muzzleFlash.visible = false;
    weaponMount.add(wRig.root);
    weaponRigs.set(wid, wRig);
  }

  // 9. Back Carried Flag Slot (enemy flag mounted on back when carrying)
  const carriedFlagGroup = new THREE.Group();
  carriedFlagGroup.position.set(0, 1.15, 0.28);
  carriedFlagGroup.rotation.x = 0.24;
  carriedFlagGroup.scale.setScalar(0.72);
  const carriedRed = createFlagMesh('red');
  const carriedBlue = createFlagMesh('blue');
  carriedRed.visible = false;
  carriedBlue.visible = false;
  carriedFlagGroup.add(carriedRed, carriedBlue);

  bodyGroup.add(
    leftLeg,
    rightLeg,
    torso,
    chestPlate,
    coreLight,
    leftPauldron,
    rightPauldron,
    headGroup,
    rightArmGroup,
    carriedFlagGroup,
  );

  // Floating Nameplate + Health Bar
  const nameSprite = makeNameplateSprite(name, team, isBot);
  nameSprite.position.set(0, 2.25, 0);
  root.add(nameSprite);

  const hpBg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x090d16, side: THREE.DoubleSide }),
  );
  hpBg.position.set(0, 1.98, 0);
  const hpFillMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.065),
    new THREE.MeshBasicMaterial({
      color: team === 'red' ? 0xef4444 : 0x06b6d4,
      side: THREE.DoubleSide,
    }),
  );
  hpFillMesh.position.set(0, 1.98, 0.005);
  root.add(hpBg, hpFillMesh);

  let hitFlashTimer = 0;
  let currentWeapon: WeaponId = 'pistol';
  let actionTimer = 0;
  let actionIsMelee = false;
  let flashTimer = 0;
  let slashDir = 1;

  return {
    root,
    bodyGroup,
    headGroup,
    leftLeg,
    rightLeg,
    rightArmGroup,
    carriedFlagGroup,
    hpFillMesh,
    nameSprite,
    updateHealth: (hp: number, maxHp: number) => {
      const ratio = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
      hpFillMesh.scale.x = Math.max(0.001, ratio);
      hpFillMesh.position.x = -(1 - ratio) * 0.45;
    },
    setCarriedFlag: (flagTeam: TeamId | null) => {
      carriedRed.visible = flagTeam === 'red';
      carriedBlue.visible = flagTeam === 'blue';
    },
    setActiveWeapon: (weaponId: WeaponId) => {
      if (currentWeapon === weaponId) return;
      const oldRig = weaponRigs.get(currentWeapon);
      if (oldRig) {
        oldRig.root.visible = false;
        oldRig.muzzleFlash.visible = false;
      }
      const nextRig = weaponRigs.get(weaponId);
      if (nextRig) {
        nextRig.root.visible = true;
      }
      currentWeapon = weaponId;
    },
    triggerAction: (isMelee: boolean) => {
      actionIsMelee = isMelee;
      actionTimer = isMelee ? 0.22 : 0.12;
      if (isMelee) {
        slashDir *= -1;
      } else {
        flashTimer = 0.06;
      }
    },
    animateWalk: (speed: number, time: number, pitch: number, crouching = false) => {
      const swing = Math.min(1, speed / 7) * 0.55;
      leftLeg.rotation.x = Math.sin(time * 10) * swing;
      rightLeg.rotation.x = -Math.sin(time * 10) * swing;
      headGroup.rotation.x = THREE.MathUtils.clamp(pitch * 0.6, -0.45, 0.45);

      const clampedPitch = THREE.MathUtils.clamp(pitch * 0.85, -0.7, 0.7);
      if (actionTimer > 0) {
        if (actionIsMelee) {
          const p = 1 - actionTimer / 0.22;
          const wave = Math.sin(p * Math.PI);
          rightArmGroup.rotation.set(
            clampedPitch - wave * 0.85,
            wave * 0.9 * slashDir,
            wave * 0.65 * slashDir,
          );
          rightArmGroup.position.set(0.38, 1.15, -0.05 - wave * 0.16);
        } else {
          const kick = actionTimer / 0.12;
          rightArmGroup.rotation.set(clampedPitch + kick * 0.22, 0, 0);
          rightArmGroup.position.set(0.38, 1.15, -0.05 + kick * 0.08);
        }
      } else {
        rightArmGroup.rotation.set(clampedPitch, 0, 0);
        rightArmGroup.position.set(0.38, 1.15, -0.05);
      }

      const targetBodyY = crouching ? -0.42 : 0;
      bodyGroup.position.y += (targetBodyY - bodyGroup.position.y) * 0.25;
      const targetLegScale = crouching ? 0.58 : 1;
      leftLeg.scale.y += (targetLegScale - leftLeg.scale.y) * 0.25;
      rightLeg.scale.y = leftLeg.scale.y;
      nameSprite.position.y = crouching ? 1.82 : 2.25;
      hpFillMesh.position.y = crouching ? 1.56 : 1.98;
      hpBg.position.y = crouching ? 1.56 : 1.98;
    },
    flashHit: (headshot = false) => {
      hitFlashTimer = headshot ? 0.14 : 0.095;
      const flashColor = headshot ? 0xfbbf24 : 0xffffff;
      armorMat.emissive.setHex(flashColor);
      teamPlateMat.emissive.setHex(flashColor);
      armorMat.emissiveIntensity = headshot ? 2.6 : 1.8;
      teamPlateMat.emissiveIntensity = headshot ? 2.6 : 1.8;
    },
    updateFlash: (dt: number) => {
      if (actionTimer > 0) {
        actionTimer = Math.max(0, actionTimer - dt);
      }
      if (flashTimer > 0) {
        flashTimer = Math.max(0, flashTimer - dt);
      }
      const activeRig = weaponRigs.get(currentWeapon);
      if (activeRig) {
        if (flashTimer > 0) {
          activeRig.muzzleFlash.visible = true;
          (activeRig.muzzleFlash.material as THREE.MeshBasicMaterial).opacity = 0.95;
          activeRig.muzzleFlash.scale.setScalar(1.25 + Math.random() * 0.65);
          activeRig.muzzleFlash.rotation.z += dt * 40;
        } else {
          activeRig.muzzleFlash.visible = false;
          (activeRig.muzzleFlash.material as THREE.MeshBasicMaterial).opacity = 0;
        }
        if (activeRig.spinnerNode && actionTimer > 0) {
          activeRig.spinnerNode.rotation.z += dt * 24;
        }
      }

      if (hitFlashTimer > 0) {
        hitFlashTimer = Math.max(0, hitFlashTimer - dt);
        const t = hitFlashTimer / 0.1;
        armorMat.emissiveIntensity = t * 1.8;
        teamPlateMat.emissiveIntensity = t * 1.8;
        if (hitFlashTimer === 0) {
          armorMat.emissive.setHex(0x000000);
          teamPlateMat.emissive.setHex(0x000000);
        }
      }
    },
  };
}

export interface ArenaWorldController {
  root: THREE.Group;
  updateDigCell: (index: number, hp: number) => void;
  dispose: () => void;
}

export function buildArenaEnvironment(
  textures: ProceduralTextureSet,
  layout: MapLayout = DEFAULT_MAP_LAYOUT,
  digHp?: Uint8Array,
): ArenaWorldController {
  const root = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const isUnderground = layout.mode === 'underground';

  // Extended exterior terrain so nothing floats in an empty void
  const outerFloorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: isUnderground ? 0x070a0f : 0x0a101b,
      roughness: 0.9,
      metalness: 0.2,
    }),
  );
  const outerFloor = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(360, 260)), outerFloorMat);
  outerFloor.rotation.x = -Math.PI / 2;
  outerFloor.position.y = -0.1;
  root.add(outerFloor);

  // Main Tactical Arena Deck
  const floorMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.floorColor,
      roughnessMap: textures.floorRoughness,
      color: isUnderground ? 0x94a3b8 : 0xffffff,
      roughness: isUnderground ? 0.85 : 0.72,
      metalness: isUnderground ? 0.15 : 0.28,
    }),
  );
  const arenaFloor = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(108, 64)), floorMat);
  arenaFloor.rotation.x = -Math.PI / 2;
  arenaFloor.position.y = 0;
  arenaFloor.receiveShadow = true;
  root.add(arenaFloor);

  // Midfield holographic center line
  const centerLineMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: isUnderground ? 0.24 : 0.38,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  const centerLine = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.28, 60)), centerLineMat);
  centerLine.rotation.x = -Math.PI / 2;
  centerLine.position.y = 0.02;
  root.add(centerLine);

  // Shared materials
  const wallMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.panelColor,
      bumpMap: textures.panelBump,
      bumpScale: 0.04,
      color: isUnderground ? 0x2a3441 : 0x334155,
      metalness: 0.55,
      roughness: 0.45,
    }),
  );
  const trimCapMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.8,
      roughness: 0.25,
    }),
  );
  const redEmissiveMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1.7,
      roughness: 0.2,
    }),
  );
  const blueEmissiveMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x06b6d4,
      emissiveIntensity: 1.7,
      roughness: 0.2,
    }),
  );
  const amberEmissiveMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.5,
      roughness: 0.2,
    }),
  );

  // Base Flag Pedestals & Glowing Pads
  (['red', 'blue'] as TeamId[]).forEach((team) => {
    const baseGroup = new THREE.Group();
    const fPos = FLAG_BASES[team];

    const pedBase = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(1.5, 1.85, 0.22, 8)),
      trimCapMat,
    );
    pedBase.position.set(fPos.x, fPos.y + 0.11, fPos.z);
    pedBase.receiveShadow = true;
    baseGroup.add(pedBase);

    const glowPadMat = trackMat(
      new THREE.MeshBasicMaterial({
        map: team === 'red' ? textures.basePadGlowRed : textures.basePadGlowBlue,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    const glowPad = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(4.2, 4.2)), glowPadMat);
    glowPad.rotation.x = -Math.PI / 2;
    glowPad.position.set(fPos.x, fPos.y + 0.03, fPos.z);
    baseGroup.add(glowPad);

    root.add(baseGroup);
  });

  // Build every AABB Collider as multi-part architectural geometry (1:1 visual & collision sync)
  for (const box of layout.colliders) {
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    const d = box.maxZ - box.minZ;
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const cz = (box.minZ + box.maxZ) / 2;

    const grp = new THREE.Group();
    const core = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, h, d)), wallMat);
    core.position.set(cx, cy, cz);
    core.castShadow = box.kind !== 'wall' && h > 0.5;
    core.receiveShadow = true;
    grp.add(core);

    if (h > 0.5) {
      const cap = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w + 0.1, 0.14, d + 0.1)), trimCapMat);
      cap.position.set(cx, box.maxY - 0.06, cz);
      grp.add(cap);
    }

    const accentMat =
      box.team === 'red'
        ? redEmissiveMat
        : box.team === 'blue'
          ? blueEmissiveMat
          : amberEmissiveMat;

    if (box.kind === 'cover' || box.kind === 'base' || box.kind === 'bridge') {
      const strip = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(w + 0.14, 0.08, d + 0.14)),
        accentMat,
      );
      strip.position.set(cx, h > 0.5 ? box.maxY - 0.2 : box.maxY - 0.06, cz);
      grp.add(strip);
    }

    root.add(grp);
  }

  // Build Ramps matching layout.ramps
  for (const r of layout.ramps) {
    const lenX = r.maxX - r.minX;
    const lenZ = r.maxZ - r.minZ;
    const rise = Math.abs(r.yAtMaxX - r.yAtMinX);
    const hyp = Math.hypot(lenX, rise);
    const angle = Math.atan2(r.yAtMaxX - r.yAtMinX, lenX);

    const rampMesh = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(hyp, 0.24, lenZ)), wallMat);
    rampMesh.position.set((r.minX + r.maxX) / 2, rise / 2 - 0.1, (r.minZ + r.maxZ) / 2);
    rampMesh.rotation.z = angle;
    rampMesh.receiveShadow = true;
    rampMesh.castShadow = true;
    root.add(rampMesh);

    const railGeo = trackGeo(new THREE.BoxGeometry(hyp, 0.08, 0.14));
    const railTrim = new THREE.Mesh(railGeo, amberEmissiveMat);
    railTrim.position.set((r.minX + r.maxX) / 2, rise / 2 + 0.06, r.minZ + 0.1);
    railTrim.rotation.z = angle;
    root.add(railTrim);

    const railTrim2 = new THREE.Mesh(railGeo, amberEmissiveMat);
    railTrim2.position.set((r.minX + r.maxX) / 2, rise / 2 + 0.06, r.maxZ - 0.1);
    railTrim2.rotation.z = angle;
    root.add(railTrim2);
  }

  // Subterranean Ceiling, Mining Lights & Instanced Diggable Soil Grid
  let soilMesh: THREE.InstancedMesh | null = null;
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  const applySoilCell = (index: number, hp: number) => {
    if (!soilMesh) return;
    const { cols, cellSize, originX, originZ, height } = UNDERGROUND_GRID;
    const r = Math.floor(index / cols);
    const c = index - r * cols;
    const cx = originX + (c + 0.5) * cellSize;
    const cz = originZ + (r + 0.5) * cellSize;

    if (hp <= 0) {
      dummy.position.set(cx, -20, cz);
      dummy.scale.set(0.0001, 0.0001, 0.0001);
      dummy.updateMatrix();
      soilMesh.setMatrixAt(index, dummy.matrix);
    } else {
      const slightVar = ((c * 17 + r * 31) % 7) * 0.02;
      if (hp === 1) {
        dummy.position.set(cx, height * 0.48, cz);
        dummy.scale.set(0.96, 0.96, 0.96);
        tmpColor.setRGB(0.54 + slightVar, 0.42 + slightVar, 0.34);
      } else {
        dummy.position.set(cx, height * 0.5, cz);
        dummy.scale.set(1, 1, 1);
        tmpColor.setRGB(0.92 + slightVar, 0.86 + slightVar, 0.78 + slightVar);
      }
      dummy.updateMatrix();
      soilMesh.setMatrixAt(index, dummy.matrix);
      soilMesh.setColorAt(index, tmpColor);
    }
  };

  if (layout.ceilingY !== null) {
    const ceilY = layout.ceilingY;
    const ceilMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: textures.panelColor,
        bumpMap: textures.panelBump,
        bumpScale: 0.05,
        color: 0x1e293b,
        roughness: 0.82,
        metalness: 0.3,
      }),
    );
    const ceilMesh = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(108, 0.5, 64)), ceilMat);
    ceilMesh.position.set(0, ceilY + 0.25, 0);
    ceilMesh.receiveShadow = true;
    root.add(ceilMesh);

    // Mining Overhead Support Beams & Chamber Strip Lights
    for (const xPos of [-42, -28, -14, 0, 14, 28, 42]) {
      const beam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.9, 0.35, 60)), trimCapMat);
      beam.position.set(xPos, ceilY - 0.14, 0);
      root.add(beam);

      const stripMat =
        xPos <= -35 ? redEmissiveMat : xPos >= 35 ? blueEmissiveMat : amberEmissiveMat;
      const strip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.28, 0.08, 18)), stripMat);
      strip.position.set(xPos, ceilY - 0.32, 0);
      root.add(strip);
    }

    // Instanced diggable soil blocks
    const { cols, rows, cellSize, height } = UNDERGROUND_GRID;
    const totalCells = cols * rows;
    const soilGeo = trackGeo(new THREE.BoxGeometry(cellSize, height, cellSize));
    const soilMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: textures.dirtColor,
        bumpMap: textures.dirtBump,
        bumpScale: 0.06,
        roughness: 0.92,
        metalness: 0.06,
      }),
    );
    soilMesh = new THREE.InstancedMesh(soilGeo, soilMat, totalCells);
    soilMesh.castShadow = false;
    soilMesh.receiveShadow = true;

    for (let i = 0; i < totalCells; i++) {
      const hp = digHp ? digHp[i] : 0;
      applySoilCell(i, hp);
    }
    soilMesh.instanceMatrix.needsUpdate = true;
    if (soilMesh.instanceColor) soilMesh.instanceColor.needsUpdate = true;
    soilMesh.computeBoundingSphere();
    root.add(soilMesh);
  } else {
    // Exterior Sci-Fi Canyon Megastructures (surface maps only)
    const outerPillarGeo = trackGeo(new THREE.BoxGeometry(5, 28, 5));
    const outerPillarMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x111827,
        metalness: 0.6,
        roughness: 0.55,
      }),
    );
    const count = 32;
    const pillars = new THREE.InstancedMesh(outerPillarGeo, outerPillarMat, count);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const rx = 74 + (i % 3) * 14;
      const rz = 48 + (i % 2) * 12;
      dummy.position.set(Math.cos(angle) * rx, 11 + (i % 4) * 3, Math.sin(angle) * rz);
      dummy.rotation.y = angle;
      dummy.scale.set(1 + (i % 3) * 0.2, 0.8 + (i % 4) * 0.25, 1);
      dummy.updateMatrix();
      pillars.setMatrixAt(i, dummy.matrix);
    }
    pillars.instanceMatrix.needsUpdate = true;
    pillars.computeBoundingSphere();
    root.add(pillars);

    // Overhead Arena Light Trusses
    const trussGeo = trackGeo(new THREE.BoxGeometry(1.2, 0.8, 62));
    const barGeo = trackGeo(new THREE.BoxGeometry(0.6, 0.2, 48));
    for (const xPos of [-26, 0, 26]) {
      const truss = new THREE.Mesh(trussGeo, trimCapMat);
      truss.position.set(xPos, 16, 0);
      root.add(truss);
      const lightBar = new THREE.Mesh(
        barGeo,
        xPos < 0 ? redEmissiveMat : xPos > 0 ? blueEmissiveMat : amberEmissiveMat,
      );
      lightBar.position.set(xPos, 15.5, 0);
      root.add(lightBar);
    }
  }

  return {
    root,
    updateDigCell: (index: number, hp: number) => {
      if (!soilMesh) return;
      applySoilCell(index, hp);
      soilMesh.instanceMatrix.needsUpdate = true;
      if (soilMesh.instanceColor) soilMesh.instanceColor.needsUpdate = true;
    },
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

export function createGrenadeMesh(type: GadgetId): THREE.Group {
  const group = new THREE.Group();
  const accentHex = GADGETS[type].accentColor;

  const hullMat = new THREE.MeshStandardMaterial({
    color:
      type === 'frag'
        ? 0x334155
        : type === 'smoke'
          ? 0x475569
          : type === 'cryo'
            ? 0x0c4a6e
            : type === 'medkit'
              ? 0x064e3b
              : type === 'stim'
                ? 0x713f12
                : 0x2e1065,
    metalness: 0.72,
    roughness: 0.34,
  });
  const capMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.85,
    roughness: 0.25,
  });
  const ledMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 2.2,
    roughness: 0.2,
  });

  // 1. Ribbed canister hull
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.28, 12), hullMat);
  // 2. Top & bottom tactical collars
  const topCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.11, 0.06, 12), capMat);
  topCollar.position.y = 0.16;
  // 3. Safety spoon lever
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.03), capMat);
  lever.position.set(0.11, 0.05, 0);
  lever.rotation.z = -0.15;
  // 4. Glowing tactical LED band
  const ledBand = new THREE.Mesh(new THREE.CylinderGeometry(0.116, 0.116, 0.055, 12), ledMat);
  ledBand.position.y = 0.03;

  group.add(body, topCollar, lever, ledBand);
  return group;
}

export function createSmokeCloudGroup(radius: number): {
  group: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
} {
  const group = new THREE.Group();
  const materials: THREE.MeshStandardMaterial[] = [];
  const baseGeo = new THREE.SphereGeometry(1, 14, 10);

  const puffCount = 14;
  for (let i = 0; i < puffCount; i++) {
    const shade = 0.72 + (i % 4) * 0.06;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(shade * 0.88, shade * 0.92, shade),
      roughness: 0.95,
      metalness: 0.02,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    materials.push(mat);

    const mesh = new THREE.Mesh(baseGeo, mat);
    const angle = (i / puffCount) * Math.PI * 2;
    const ring = i < 4 ? 0.22 : 0.62;
    const dist = radius * ring * (0.7 + (i % 3) * 0.18);
    const py = i < 4 ? 1.55 + (i % 2) * 0.65 : 0.85 + (i % 3) * 0.72;
    const scale = radius * (i < 4 ? 0.56 : 0.42 + (i % 3) * 0.07);

    mesh.position.set(Math.cos(angle) * dist, py, Math.sin(angle) * dist);
    mesh.scale.set(scale * 1.12, scale * 0.88, scale * 1.12);
    group.add(mesh);
  }

  return { group, materials };
}

export interface ControlZoneVisual {
  group: THREE.Group;
  update: (
    owner: TeamId | 'neutral',
    captureTeam: TeamId | 'neutral',
    progress: number,
    contested: boolean,
    time: number,
  ) => void;
  dispose: () => void;
}

export function createControlZoneMesh(radius: number): ControlZoneVisual {
  const group = new THREE.Group();

  const outerRingGeo = new THREE.RingGeometry(radius - 0.24, radius, 56);
  const outerRingMat = new THREE.MeshBasicMaterial({
    color: 0x94a3b8,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.06;

  const progressDiscGeo = new THREE.CircleGeometry(radius - 0.24, 56);
  const progressDiscMat = new THREE.MeshBasicMaterial({
    color: 0x94a3b8,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const progressDisc = new THREE.Mesh(progressDiscGeo, progressDiscMat);
  progressDisc.rotation.x = -Math.PI / 2;
  progressDisc.position.y = 0.04;
  progressDisc.scale.setScalar(0.05);

  const beamGeo = new THREE.CylinderGeometry(0.45, 0.85, 7.5, 20, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x94a3b8,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 3.75;

  const coreGeo = new THREE.OctahedronGeometry(0.45, 0);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0x94a3b8,
    transparent: true,
    opacity: 0.85,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.y = 4.6;

  group.add(outerRing, progressDisc, beam, core);

  return {
    group,
    update: (owner, captureTeam, progress, contested, time) => {
      const hex = contested
        ? 0xf59e0b
        : owner === 'red'
          ? 0xef4444
          : owner === 'blue'
            ? 0x06b6d4
            : captureTeam === 'red'
              ? 0xf87171
              : captureTeam === 'blue'
                ? 0x22d3ee
                : 0x94a3b8;

      outerRingMat.color.setHex(hex);
      progressDiscMat.color.setHex(hex);
      beamMat.color.setHex(hex);
      coreMat.color.setHex(hex);

      const prog = Math.max(0.04, Math.min(1, progress));
      progressDisc.scale.setScalar(prog);
      progressDiscMat.opacity = owner !== 'neutral' ? 0.22 : 0.14 + prog * 0.14;
      outerRingMat.opacity = contested ? 0.55 + Math.sin(time * 10) * 0.3 : 0.8;
      beamMat.opacity = 0.16 + Math.sin(time * 3.5) * 0.05;

      core.rotation.y = time * 1.6;
      core.position.y = 4.6 + Math.sin(time * 2.8) * 0.22;
    },
    dispose: () => {
      outerRingGeo.dispose();
      progressDiscGeo.dispose();
      beamGeo.dispose();
      coreGeo.dispose();
      outerRingMat.dispose();
      progressDiscMat.dispose();
      beamMat.dispose();
      coreMat.dispose();
    },
  };
}



