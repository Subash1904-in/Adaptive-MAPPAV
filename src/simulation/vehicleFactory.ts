/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { VehicleType } from '../types/simulation';

// Shared materials for optimal WebGL performance and realistic car aesthetics
const tireRubberMat = new THREE.MeshStandardMaterial({
  color: 0x181c24,
  roughness: 0.85,
  metalness: 0.15,
});

const rimAlloyMat = new THREE.MeshStandardMaterial({
  color: 0xcfd8dc,
  roughness: 0.22,
  metalness: 0.9,
});

const brakeRotorMat = new THREE.MeshStandardMaterial({
  color: 0x90a4ae,
  roughness: 0.35,
  metalness: 0.85,
});

const brakeCaliperMat = new THREE.MeshStandardMaterial({
  color: 0xd32f2f, // Sporty red brake caliper
  roughness: 0.3,
  metalness: 0.4,
});

const glassTintedMat = new THREE.MeshPhysicalMaterial({
  color: 0x0a1120,
  roughness: 0.08,
  metalness: 0.92,
  transmission: 0.55,
  transparent: true,
  opacity: 0.88,
  ior: 1.52,
});

const chromeTrimMat = new THREE.MeshStandardMaterial({
  color: 0xf1f5f9,
  roughness: 0.12,
  metalness: 0.98,
});

const grilleMat = new THREE.MeshStandardMaterial({
  color: 0x0f172a,
  roughness: 0.7,
  metalness: 0.5,
});

// Lights
const headlightGlassMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
});

const headlightLensGlowMat = new THREE.MeshBasicMaterial({
  color: 0xe0f2fe,
});

const taillightOffMat = new THREE.MeshStandardMaterial({
  color: 0x7f1d1d,
  roughness: 0.5,
  metalness: 0.2,
});

const taillightBrakeMat = new THREE.MeshBasicMaterial({
  color: 0xff1744, // Glowing active brake light
});

const turnSignalAmberMat = new THREE.MeshBasicMaterial({
  color: 0xfbbf24, // Amber turn blinker
});

const sirenRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
const sirenBlueMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
const sirenAmberMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });

/**
 * Creates high-detail wheel assembly with alloy multi-spoke rim, tire, and brake rotor.
 */
function createDetailedWheel(scale = 1.0, isFront = false): THREE.Group {
  const wheelAssembly = new THREE.Group();
  wheelAssembly.name = isFront ? 'frontWheel' : 'rearWheel';

  // Rolling hub child group (spins around its X axis)
  const rollHub = new THREE.Group();
  rollHub.name = 'rollHub';

  // Rubber tire
  const tireGeo = new THREE.CylinderGeometry(0.42 * scale, 0.42 * scale, 0.28 * scale, 24);
  const tireMesh = new THREE.Mesh(tireGeo, tireRubberMat);
  tireMesh.rotation.z = Math.PI / 2;
  tireMesh.castShadow = true;
  rollHub.add(tireMesh);

  // Rim outer barrel
  const rimGeo = new THREE.CylinderGeometry(0.28 * scale, 0.28 * scale, 0.29 * scale, 20);
  const rimMesh = new THREE.Mesh(rimGeo, rimAlloyMat);
  rimMesh.rotation.z = Math.PI / 2;
  rollHub.add(rimMesh);

  // 5 Sporty Alloy Spokes
  const spokeGeo = new THREE.BoxGeometry(0.04 * scale, 0.24 * scale, 0.08 * scale);
  for (let s = 0; s < 5; s++) {
    const spoke = new THREE.Mesh(spokeGeo, rimAlloyMat);
    const angle = (s * Math.PI * 2) / 5;
    spoke.position.set(0, Math.sin(angle) * 0.12 * scale, Math.cos(angle) * 0.12 * scale);
    spoke.rotation.x = angle;
    rollHub.add(spoke);
  }

  // Center hubcap
  const capGeo = new THREE.CylinderGeometry(0.08 * scale, 0.08 * scale, 0.3 * scale, 12);
  const capMesh = new THREE.Mesh(capGeo, chromeTrimMat);
  capMesh.rotation.z = Math.PI / 2;
  rollHub.add(capMesh);

  wheelAssembly.add(rollHub);

  // Non-rolling brake caliper attached to axle
  const caliperGeo = new THREE.BoxGeometry(0.09 * scale, 0.15 * scale, 0.12 * scale);
  const caliper = new THREE.Mesh(caliperGeo, brakeCaliperMat);
  caliper.position.set(0, 0.12 * scale, 0);
  wheelAssembly.add(caliper);

  return wheelAssembly;
}

/**
 * Creates high-detail automotive paint material with realistic clearcoat reflection.
 */
function createCarPaintMaterial(colorHex: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: colorHex,
    metalness: 0.82,
    roughness: 0.26,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    reflectivity: 0.85,
  });
}

/**
 * Builds realistic 3D vehicle with suspension chassis pivot, steerable front wheels,
 * rolling tires, dynamic brake lights, and turn signals.
 */
export function createVehicleMesh(type: VehicleType, customColor?: string): THREE.Group {
  const vehicleGroup = new THREE.Group();

  // Root chassis group for suspension pitch (dive/squat) & body roll
  const chassis = new THREE.Group();
  chassis.name = 'chassis';
  vehicleGroup.add(chassis);

  let bodyColorHex = 0x0284c7; // Default ocean blue
  if (customColor) {
    bodyColorHex = parseInt(customColor.replace('#', '0x'), 16);
  } else if (type === 'taxi') {
    bodyColorHex = 0xf59e0b; // Vibrant NYC Yellow
  } else if (type === 'police') {
    bodyColorHex = 0x0f172a; // Deep midnight interceptor
  } else if (type === 'ambulance') {
    bodyColorHex = 0xf8fafc; // Medical white
  } else if (type === 'fire_engine') {
    bodyColorHex = 0xdc2626; // Fire red
  } else if (type === 'vip_limo') {
    bodyColorHex = 0x020617; // Executive gloss black
  } else if (type === 'emergency') {
    bodyColorHex = 0xffffff;
  } else if (type === 'truck') {
    bodyColorHex = 0x2563eb;
  } else if (type === 'suv') {
    bodyColorHex = 0x334155;
  }

  const paintMat = createCarPaintMaterial(bodyColorHex);

  const wheels: THREE.Group[] = [];
  const frontWheels: THREE.Group[] = [];
  const taillights: THREE.Mesh[] = [];
  const blinkersLeft: THREE.Mesh[] = [];
  const blinkersRight: THREE.Mesh[] = [];

  if (type === 'fire_engine') {
    // -------------------------------------------------------------------------
    // Heavy Metropolitan Fire Rescue Engine (~8.0m length)
    // -------------------------------------------------------------------------
    const chassisGeo = new THREE.BoxGeometry(2.55, 0.85, 8.2);
    const chassisMesh = new THREE.Mesh(chassisGeo, paintMat);
    chassisMesh.position.y = 0.85;
    chassisMesh.castShadow = true;
    chassis.add(chassisMesh);

    // Front Crew Cab with beveled windshield frame
    const cabGeo = new THREE.BoxGeometry(2.48, 1.85, 2.4);
    const cabMesh = new THREE.Mesh(cabGeo, paintMat);
    cabMesh.position.set(0, 1.88, 2.8);
    cabMesh.castShadow = true;
    chassis.add(cabMesh);

    // Panoramic Windshield
    const windGeo = new THREE.BoxGeometry(2.32, 0.95, 0.1);
    const windMesh = new THREE.Mesh(windGeo, glassTintedMat);
    windMesh.position.set(0, 2.1, 4.02);
    chassis.add(windMesh);

    // Rear Compartments / Water Pump Body
    const bodyGeo = new THREE.BoxGeometry(2.52, 2.15, 5.2);
    const bodyMat = createCarPaintMaterial(0xb91c1c);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.set(0, 1.95, -1.1);
    bodyMesh.castShadow = true;
    chassis.add(bodyMesh);

    // Diamond plate chrome doors on sides
    for (let side of [-1.27, 1.27]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.4, 1.3), chromeTrimMat);
      door.position.set(side, 1.75, -1.1);
      chassis.add(door);
    }

    // Heavy Roof Rescue Ladder
    const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.16, 5.4), chromeTrimMat);
    ladder.position.set(0.65, 3.1, -1.0);
    ladder.castShadow = true;
    chassis.add(ladder);

    // 6 Heavy-Duty Wheels
    const wPositions = [
      { x: -1.28, z: 2.8, isFront: true },
      { x: 1.28, z: 2.8, isFront: true },
      { x: -1.28, z: -1.2, isFront: false },
      { x: 1.28, z: -1.2, isFront: false },
      { x: -1.28, z: -2.8, isFront: false },
      { x: 1.28, z: -2.8, isFront: false },
    ];
    wPositions.forEach((pos) => {
      const w = createDetailedWheel(1.25, pos.isFront);
      w.position.set(pos.x, 0.52, pos.z);
      chassis.add(w);
      wheels.push(w);
      if (pos.isFront) frontWheels.push(w);
    });

    // Roof Emergency Siren Lightbar
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.4), chromeTrimMat);
    bar.position.set(0, 2.92, 2.8);
    chassis.add(bar);

    const sL = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.25, 0.3), sirenRedMat);
    sL.position.set(-0.45, 3.05, 2.8);
    const sR = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.25, 0.3), sirenRedMat);
    sR.position.set(0.45, 3.05, 2.8);
    chassis.add(sL, sR);
  } else if (type === 'ambulance') {
    // -------------------------------------------------------------------------
    // Modern Paramedic Type III Ambulance Box
    // -------------------------------------------------------------------------
    const cabGeo = new THREE.BoxGeometry(2.2, 1.35, 2.4);
    const cab = new THREE.Mesh(cabGeo, paintMat);
    cab.position.set(0, 1.25, 1.6);
    cab.castShadow = true;
    chassis.add(cab);

    // Box Patient Compartment
    const boxGeo = new THREE.BoxGeometry(2.35, 2.05, 4.4);
    const box = new THREE.Mesh(boxGeo, paintMat);
    box.position.set(0, 1.65, -1.6);
    box.castShadow = true;
    chassis.add(box);

    // Red Cross and Chevrons
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.38, 0.35, 4.2), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    stripe.position.set(0, 1.7, -1.6);
    chassis.add(stripe);

    // Windshield & Side Windows
    const wind = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.75, 0.1), glassTintedMat);
    wind.position.set(0, 1.45, 2.81);
    chassis.add(wind);

    // 4 Wheels
    const wPositions = [
      { x: -1.15, z: 1.8, isFront: true },
      { x: 1.15, z: 1.8, isFront: true },
      { x: -1.15, z: -1.8, isFront: false },
      { x: 1.15, z: -1.8, isFront: false },
    ];
    wPositions.forEach((pos) => {
      const w = createDetailedWheel(1.15, pos.isFront);
      w.position.set(pos.x, 0.46, pos.z);
      chassis.add(w);
      wheels.push(w);
      if (pos.isFront) frontWheels.push(w);
    });

    // Strobe bar
    const barL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.3), sirenRedMat);
    barL.position.set(-0.6, 2.75, 0.3);
    const barR = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.3), sirenBlueMat);
    barR.position.set(0.6, 2.75, 0.3);
    chassis.add(barL, barR);
  } else if (type === 'vip_limo') {
    // -------------------------------------------------------------------------
    // Armored Presidential / Executive Limousine (~6.4m length)
    // -------------------------------------------------------------------------
    const lowerGeo = new THREE.BoxGeometry(2.05, 0.85, 6.4);
    const lower = new THREE.Mesh(lowerGeo, paintMat);
    lower.position.y = 0.65;
    lower.castShadow = true;
    chassis.add(lower);

    // Extended Cabin with privacy glass
    const cabGeo = new THREE.BoxGeometry(1.82, 0.85, 4.2);
    const cab = new THREE.Mesh(cabGeo, glassTintedMat);
    cab.position.set(0, 1.35, -0.4);
    chassis.add(cab);

    // Roof panel
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.1, 4.1), paintMat);
    roof.position.set(0, 1.8, -0.4);
    chassis.add(roof);

    // Front grille and flag mounts
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.1), chromeTrimMat);
    grille.position.set(0, 0.65, 3.22);
    chassis.add(grille);

    // 4 Wheels
    const wPositions = [
      { x: -1.05, z: 2.2, isFront: true },
      { x: 1.05, z: 2.2, isFront: true },
      { x: -1.05, z: -2.2, isFront: false },
      { x: 1.05, z: -2.2, isFront: false },
    ];
    wPositions.forEach((pos) => {
      const w = createDetailedWheel(1.05, pos.isFront);
      w.position.set(pos.x, 0.44, pos.z);
      chassis.add(w);
      wheels.push(w);
      if (pos.isFront) frontWheels.push(w);
    });
  } else {
    // -------------------------------------------------------------------------
    // Standard Vehicles: Sedan, SUV, Taxi, Police Interceptor
    // -------------------------------------------------------------------------
    const isSUV = type === 'suv';
    const isPolice = type === 'police';
    const isTaxi = type === 'taxi';

    const width = isSUV ? 2.1 : 1.95;
    const height = isSUV ? 1.05 : 0.88;
    const length = isSUV ? 4.8 : 4.6;

    // Sculpted lower aerodynamic body
    const lowerGeo = new THREE.BoxGeometry(width, height, length);
    const lower = new THREE.Mesh(lowerGeo, paintMat);
    lower.position.y = 0.68;
    lower.castShadow = true;
    chassis.add(lower);

    // Police wrap door panel
    if (isPolice) {
      const doorWhite = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.02, height * 0.8, length * 0.46),
        createCarPaintMaterial(0xffffff)
      );
      doorWhite.position.set(0, 0.68, 0.05);
      chassis.add(doorWhite);

      // Police push bar bumper guard
      const pushBar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.55, 0.2), grilleMat);
      pushBar.position.set(0, 0.65, length / 2 + 0.12);
      chassis.add(pushBar);
    }

    // Cabin Greenhouse & Windows
    const cabinW = width * 0.86;
    const cabinH = isSUV ? 0.98 : 0.82;
    const cabinL = length * 0.54;

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabinW, cabinH, cabinL), glassTintedMat);
    cabin.position.set(0, 0.68 + height / 2 + cabinH / 2 - 0.04, -0.2);
    cabin.castShadow = true;
    chassis.add(cabin);

    // Roof
    const roof = new THREE.Mesh(new THREE.BoxGeometry(cabinW * 0.96, 0.1, cabinL * 0.86), paintMat);
    roof.position.set(0, 0.68 + height / 2 + cabinH + 0.02, -0.2);
    chassis.add(roof);

    // Front Grille
    const grille = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 0.38, 0.12), isPolice ? grilleMat : chromeTrimMat);
    grille.position.set(0, 0.62, length / 2 + 0.04);
    chassis.add(grille);

    // Side Mirrors
    for (let side of [-1, 1]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.25), paintMat);
      mirror.position.set(side * (width / 2 + 0.1), 1.25, 0.8);
      chassis.add(mirror);
    }

    // 4 Sport Wheels
    const wX = width * 0.53;
    const wZFront = length * 0.32;
    const wZRear = -length * 0.32;
    const wPositions = [
      { x: -wX, z: wZFront, isFront: true },
      { x: wX, z: wZFront, isFront: true },
      { x: -wX, z: wZRear, isFront: false },
      { x: wX, z: wZRear, isFront: false },
    ];
    wPositions.forEach((pos) => {
      const w = createDetailedWheel(isSUV ? 1.12 : 1.0, pos.isFront);
      w.position.set(pos.x, 0.44, pos.z);
      chassis.add(w);
      wheels.push(w);
      if (pos.isFront) frontWheels.push(w);
    });

    // Taxi Roof Ad Sign
    if (isTaxi) {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.28, 0.32), new THREE.MeshBasicMaterial({ color: 0xfef08a }));
      sign.position.set(0, 0.68 + height / 2 + cabinH + 0.24, -0.2);
      chassis.add(sign);
    } else if (isPolice) {
      // Emergency Low-Profile LED Lightbar
      const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.25), chromeTrimMat);
      barBase.position.set(0, 0.68 + height / 2 + cabinH + 0.12, -0.2);
      chassis.add(barBase);

      const lightRed = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.22), sirenRedMat);
      lightRed.position.set(-0.26, 0.68 + height / 2 + cabinH + 0.22, -0.2);

      const lightBlue = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.22), sirenBlueMat);
      lightBlue.position.set(0.26, 0.68 + height / 2 + cabinH + 0.22, -0.2);

      chassis.add(lightRed, lightBlue);
    }
  }

  // ---------------------------------------------------------------------------
  // Universal Automotive Lighting: Headlights, Dynamic Taillights, Amber Blinkers
  // ---------------------------------------------------------------------------
  const halfLen = type === 'fire_engine' ? 4.1 : type === 'vip_limo' ? 3.2 : 2.3;
  const halfWid = 0.72;

  // Dual Projector Xenon Headlights
  const hl1 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.08), headlightLensGlowMat);
  hl1.position.set(-halfWid, 0.72, halfLen + 0.02);
  const hl2 = hl1.clone();
  hl2.position.set(halfWid, 0.72, halfLen + 0.02);
  chassis.add(hl1, hl2);

  // Dynamic LED Taillights (switch from off/running to bright brake light)
  const tl1 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.08), taillightBrakeMat);
  tl1.position.set(-halfWid, 0.74, -halfLen - 0.02);
  const tl2 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.08), taillightBrakeMat);
  tl2.position.set(halfWid, 0.74, -halfLen - 0.02);
  chassis.add(tl1, tl2);
  taillights.push(tl1, tl2);

  // Amber Turn Signal Blinkers
  const blinkerFL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.08), turnSignalAmberMat);
  blinkerFL.position.set(-halfWid - 0.2, 0.72, halfLen + 0.01);
  const blinkerFR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.08), turnSignalAmberMat);
  blinkerFR.position.set(halfWid + 0.2, 0.72, halfLen + 0.01);

  const blinkerRL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.08), turnSignalAmberMat);
  blinkerRL.position.set(-halfWid - 0.2, 0.74, -halfLen - 0.01);
  const blinkerRR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.08), turnSignalAmberMat);
  blinkerRR.position.set(halfWid + 0.2, 0.74, -halfLen - 0.01);

  blinkerFL.visible = false;
  blinkerFR.visible = false;
  blinkerRL.visible = false;
  blinkerRR.visible = false;

  chassis.add(blinkerFL, blinkerFR, blinkerRL, blinkerRR);
  blinkersLeft.push(blinkerFL, blinkerRL);
  blinkersRight.push(blinkerFR, blinkerRR);

  // Soft Ambient Grounding Contact Shadow
  const shadowGeo = new THREE.PlaneGeometry(2.7, halfLen * 2 + 0.6);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = 0.03;
  vehicleGroup.add(shadowMesh);

  // Attach dynamic animation refs to userData
  vehicleGroup.userData = {
    chassis,
    wheels,
    frontWheels,
    taillights,
    blinkersLeft,
    blinkersRight,
    wheelAngle: 0,
    steeringAngle: 0,
    pitchAngle: 0,
    rollAngle: 0,
  };

  return vehicleGroup;
}

/**
 * Dynamically switches vehicle taillights between idle running glow and bright active brake lights.
 */
export function setVehicleBrakingVisuals(mesh: THREE.Group, isBrakingOrStopped: boolean): void {
  const tl = mesh.userData?.taillights as THREE.Mesh[] | undefined;
  if (!tl || tl.length === 0) return;
  const mat = isBrakingOrStopped ? taillightBrakeMat : taillightOffMat;
  for (let i = 0; i < tl.length; i++) {
    if (tl[i].material !== mat) {
      tl[i].material = mat;
    }
  }
}

/**
 * Controls amber turn signal blinkers on front and rear corners,
 * including 4-way emergency hazard flashers.
 */
export function setVehicleTurnSignals(
  mesh: THREE.Group,
  turnDirection: 'none' | 'left' | 'right',
  blinkOn: boolean,
  hazardLights = false
): void {
  const left = mesh.userData?.blinkersLeft as THREE.Mesh[] | undefined;
  const right = mesh.userData?.blinkersRight as THREE.Mesh[] | undefined;

  if (hazardLights) {
    const show = blinkOn;
    if (left) for (let i = 0; i < left.length; i++) left[i].visible = show;
    if (right) for (let i = 0; i < right.length; i++) right[i].visible = show;
    return;
  }

  if (left) {
    const showLeft = turnDirection === 'left' && blinkOn;
    for (let i = 0; i < left.length; i++) {
      left[i].visible = showLeft;
    }
  }

  if (right) {
    const showRight = turnDirection === 'right' && blinkOn;
    for (let i = 0; i < right.length; i++) {
      right[i].visible = showRight;
    }
  }
}

/**
 * Updates dynamic vehicle physical kinematics:
 *  - Wheel hubs roll forward/reverse proportional to speed.
 *  - Front wheel assemblies turn left/right with steering angle.
 *  - Chassis suspension pitches forward during braking and squats during acceleration.
 *  - Chassis body rolls outward into turns according to lateral acceleration.
 */
export function updateVehicleKinematicsVisuals(
  mesh: THREE.Group,
  speed: number,
  dt: number,
  steeringAngle: number,
  accelG: number,
  lateralAccelG: number
): void {
  const ud = mesh.userData;
  if (!ud) return;

  // 1. Wheel hub rolling around axle (radius ~0.42m)
  const rollStep = (speed * dt) / 0.42;
  ud.wheelAngle = ((ud.wheelAngle || 0) + rollStep) % (Math.PI * 2);

  if (ud.wheels && Array.isArray(ud.wheels)) {
    for (let i = 0; i < ud.wheels.length; i++) {
      const rollHub = ud.wheels[i].getObjectByName('rollHub');
      if (rollHub) {
        rollHub.rotation.x = ud.wheelAngle;
      }
    }
  }

  // 2. Steerable front wheels yaw rotation
  ud.steeringAngle = THREE.MathUtils.lerp(ud.steeringAngle || 0, steeringAngle, Math.min(1.0, dt * 12.0));
  if (ud.frontWheels && Array.isArray(ud.frontWheels)) {
    for (let i = 0; i < ud.frontWheels.length; i++) {
      ud.frontWheels[i].rotation.y = ud.steeringAngle;
    }
  }

  // 3. Chassis suspension pitch (dive on brake, squat on acceleration)
  // Negative acceleration (braking) causes forward dive (+ pitch)
  const targetPitch = THREE.MathUtils.clamp(-accelG * 0.12, -0.06, 0.08);
  ud.pitchAngle = THREE.MathUtils.lerp(ud.pitchAngle || 0, targetPitch, Math.min(1.0, dt * 8.0));

  // 4. Chassis suspension body roll (rolls into turn centrifugal lean)
  const targetRoll = THREE.MathUtils.clamp(-lateralAccelG * 0.08, -0.07, 0.07);
  ud.rollAngle = THREE.MathUtils.lerp(ud.rollAngle || 0, targetRoll, Math.min(1.0, dt * 8.0));

  if (ud.chassis) {
    ud.chassis.rotation.x = ud.pitchAngle;
    ud.chassis.rotation.z = ud.rollAngle;
  }
}
