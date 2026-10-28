/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { VehicleType } from '../types/simulation';

// Shared materials for optimal WebGL performance
const tireMat = new THREE.MeshStandardMaterial({
  color: 0x111827,
  roughness: 0.9,
  metalness: 0.1,
});

const rimMat = new THREE.MeshStandardMaterial({
  color: 0x94a3b8,
  roughness: 0.3,
  metalness: 0.8,
});

const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x0f172a,
  roughness: 0.1,
  metalness: 0.9,
  transmission: 0.6,
  transparent: true,
  opacity: 0.9,
});

const headlightMat = new THREE.MeshBasicMaterial({
  color: 0xfef08a,
});

const taillightMat = new THREE.MeshBasicMaterial({
  color: 0xef4444,
});

const chromeMat = new THREE.MeshStandardMaterial({
  color: 0xe2e8f0,
  roughness: 0.15,
  metalness: 0.95,
});

const sirenRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
const sirenBlueMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
const sirenAmberMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });

/**
 * Creates a wheel assembly with tire, rim, and hub.
 */
function createWheel(scale = 1.0): THREE.Group {
  const wheelGroup = new THREE.Group();

  // Rubber tire
  const tireGeo = new THREE.CylinderGeometry(0.42 * scale, 0.42 * scale, 0.3 * scale, 16);
  const tireMesh = new THREE.Mesh(tireGeo, tireMat);
  tireMesh.rotation.z = Math.PI / 2;
  tireMesh.castShadow = true;
  wheelGroup.add(tireMesh);

  // Wheel rim
  const rimGeo = new THREE.CylinderGeometry(0.26 * scale, 0.26 * scale, 0.31 * scale, 12);
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.rotation.z = Math.PI / 2;
  wheelGroup.add(rimMesh);

  return wheelGroup;
}

/**
 * Builds a multi-part procedural 3D vehicle with specialized geometry for each vehicle class.
 */
export function createVehicleMesh(type: VehicleType, customColor?: string): THREE.Group {
  const vehicleGroup = new THREE.Group();

  let bodyColorHex = 0x0284c7;
  if (customColor) {
    bodyColorHex = parseInt(customColor.replace('#', '0x'), 16);
  } else if (type === 'taxi') {
    bodyColorHex = 0xf59e0b;
  } else if (type === 'police') {
    bodyColorHex = 0x0f172a;
  } else if (type === 'ambulance') {
    bodyColorHex = 0xf8fafc;
  } else if (type === 'fire_engine') {
    bodyColorHex = 0xdc2626;
  } else if (type === 'vip_limo') {
    bodyColorHex = 0x020617;
  } else if (type === 'emergency') {
    bodyColorHex = 0xffffff;
  } else if (type === 'truck') {
    bodyColorHex = 0x3b82f6;
  } else if (type === 'suv') {
    bodyColorHex = 0x334155;
  }

  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColorHex,
    roughness: 0.35,
    metalness: 0.65,
  });

  if (type === 'fire_engine') {
    // Heavy Fire Rescue Engine (Length ~7.6m, Height ~2.8m)
    const chassisGeo = new THREE.BoxGeometry(2.5, 0.8, 7.8);
    const chassisMesh = new THREE.Mesh(chassisGeo, bodyMat);
    chassisMesh.position.y = 0.75;
    chassisMesh.castShadow = true;
    vehicleGroup.add(chassisMesh);

    // Front Crew Cab
    const cabGeo = new THREE.BoxGeometry(2.4, 1.8, 2.2);
    const cabMesh = new THREE.Mesh(cabGeo, bodyMat);
    cabMesh.position.set(0, 1.8, 2.6);
    cabMesh.castShadow = true;
    vehicleGroup.add(cabMesh);

    // Windshield
    const windGeo = new THREE.BoxGeometry(2.2, 0.9, 0.1);
    const windMesh = new THREE.Mesh(windGeo, glassMat);
    windMesh.position.set(0, 2.0, 3.71);
    vehicleGroup.add(windMesh);

    // Rear Equipment Compartments & Water Tank
    const equipGeo = new THREE.BoxGeometry(2.45, 2.0, 4.8);
    const equipMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.4, metalness: 0.4 });
    const equipMesh = new THREE.Mesh(equipGeo, equipMat);
    equipMesh.position.set(0, 1.85, -1.0);
    equipMesh.castShadow = true;
    vehicleGroup.add(equipMesh);

    // Chrome Roll-up Doors on side
    const doorGeo = new THREE.BoxGeometry(2.48, 1.3, 1.2);
    const doorMesh = new THREE.Mesh(doorGeo, chromeMat);
    doorMesh.position.set(0, 1.7, -1.0);
    vehicleGroup.add(doorMesh);

    // Roof Rescue Ladder
    const ladderGeo = new THREE.BoxGeometry(0.8, 0.15, 5.0);
    const ladderMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9 });
    const ladderMesh = new THREE.Mesh(ladderGeo, ladderMat);
    ladderMesh.position.set(0.6, 2.95, -1.0);
    vehicleGroup.add(ladderMesh);

    // 6 Heavy Wheels
    const wheelPositions = [
      { x: -1.25, z: 2.7 },
      { x: 1.25, z: 2.7 },
      { x: -1.25, z: -1.2 },
      { x: 1.25, z: -1.2 },
      { x: -1.25, z: -2.6 },
      { x: 1.25, z: -2.6 },
    ];
    wheelPositions.forEach((pos) => {
      const wheel = createWheel(1.2);
      wheel.position.set(pos.x, 0.5, pos.z);
      vehicleGroup.add(wheel);
    });

    // Dual Emergency Siren Lightbars
    const barGeo = new THREE.BoxGeometry(1.6, 0.2, 0.35);
    const barMesh = new THREE.Mesh(barGeo, sirenRedMat);
    barMesh.position.set(0, 2.8, 2.6);
    vehicleGroup.add(barMesh);

    // Front chrome bumper
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.4, 0.2), chromeMat);
    bumper.position.set(0, 0.7, 4.0);
    vehicleGroup.add(bumper);
  } else if (type === 'ambulance') {
    // Paramedic High-Roof Emergency Van
    const chassisGeo = new THREE.BoxGeometry(2.3, 0.6, 6.2);
    const chassisMesh = new THREE.Mesh(chassisGeo, bodyMat);
    chassisMesh.position.y = 0.55;
    chassisMesh.castShadow = true;
    vehicleGroup.add(chassisMesh);

    // Patient Module Box
    const boxGeo = new THREE.BoxGeometry(2.3, 2.1, 4.2);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.3 });
    const boxMesh = new THREE.Mesh(boxGeo, boxMat);
    boxMesh.position.set(0, 1.8, -0.9);
    boxMesh.castShadow = true;
    vehicleGroup.add(boxMesh);

    // Red Paramedic Stripe along side
    const stripeGeo = new THREE.BoxGeometry(2.32, 0.3, 4.2);
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 });
    const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
    stripeMesh.position.set(0, 1.7, -0.9);
    vehicleGroup.add(stripeMesh);

    // Driver Cab
    const cabGeo = new THREE.BoxGeometry(2.2, 1.6, 1.9);
    const cabMesh = new THREE.Mesh(cabGeo, boxMat);
    cabMesh.position.set(0, 1.55, 2.0);
    cabMesh.castShadow = true;
    vehicleGroup.add(cabMesh);

    // Windshield
    const windGeo = new THREE.BoxGeometry(2.0, 0.8, 0.1);
    const windMesh = new THREE.Mesh(windGeo, glassMat);
    windMesh.position.set(0, 1.7, 2.96);
    vehicleGroup.add(windMesh);

    // 4 Wheels
    const wheels = [
      { x: -1.15, z: 2.1 },
      { x: 1.15, z: 2.1 },
      { x: -1.15, z: -1.8 },
      { x: 1.15, z: -1.8 },
    ];
    wheels.forEach((pos) => {
      const wheel = createWheel(1.05);
      wheel.position.set(pos.x, 0.44, pos.z);
      vehicleGroup.add(wheel);
    });

    // Roof Emergency Beacon Bar (Dual Red/White)
    const barR = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.3), sirenRedMat);
    barR.position.set(-0.45, 2.9, 0.8);
    const barW = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.3), sirenBlueMat);
    barW.position.set(0.45, 2.9, 0.8);
    vehicleGroup.add(barR, barW);
  } else if (type === 'vip_limo') {
    // Extended Armored Presidential Limousine (Length ~6.4m)
    const length = 6.4;
    const width = 2.0;
    const height = 0.9;

    const lowerGeo = new THREE.BoxGeometry(width, height, length);
    const lowerMesh = new THREE.Mesh(lowerGeo, bodyMat);
    lowerMesh.position.y = 0.65;
    lowerMesh.castShadow = true;
    vehicleGroup.add(lowerMesh);

    // Extended Tinted Cabin
    const cabinGeo = new THREE.BoxGeometry(width * 0.88, 0.82, length * 0.68);
    const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
    cabinMesh.position.set(0, 0.65 + height / 2 + 0.41 - 0.05, -0.2);
    cabinMesh.castShadow = true;
    vehicleGroup.add(cabinMesh);

    // Roof shell
    const roofGeo = new THREE.BoxGeometry(width * 0.84, 0.1, length * 0.66);
    const roofMesh = new THREE.Mesh(roofGeo, bodyMat);
    roofMesh.position.set(0, 0.65 + height / 2 + 0.82 + 0.01, -0.2);
    vehicleGroup.add(roofMesh);

    // Grille
    const grilleMesh = new THREE.Mesh(new THREE.BoxGeometry(width * 0.8, 0.4, 0.1), chromeMat);
    grilleMesh.position.set(0, 0.6, length / 2 + 0.04);
    vehicleGroup.add(grilleMesh);

    // Wheels (6 wheels for heavy armored limo)
    const wheels = [
      { x: -width * 0.52, z: length * 0.36 },
      { x: width * 0.52, z: length * 0.36 },
      { x: -width * 0.52, z: -length * 0.22 },
      { x: width * 0.52, z: -length * 0.22 },
      { x: -width * 0.52, z: -length * 0.38 },
      { x: width * 0.52, z: -length * 0.38 },
    ];
    wheels.forEach((pos) => {
      const wheel = createWheel(1.0);
      wheel.position.set(pos.x, 0.42, pos.z);
      vehicleGroup.add(wheel);
    });

    // Hidden Grille Strobes
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.1), sirenRedMat);
    s1.position.set(-0.35, 0.65, length / 2 + 0.1);
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.1), sirenBlueMat);
    s2.position.set(0.35, 0.65, length / 2 + 0.1);
    vehicleGroup.add(s1, s2);
  } else if (type === 'truck') {
    // Delivery Truck / Box Truck
    const chassisGeo = new THREE.BoxGeometry(2.3, 0.6, 6.4);
    const chassisMesh = new THREE.Mesh(chassisGeo, tireMat);
    chassisMesh.position.y = 0.55;
    chassisMesh.castShadow = true;
    vehicleGroup.add(chassisMesh);

    const cabGeo = new THREE.BoxGeometry(2.2, 1.8, 1.8);
    const cabMesh = new THREE.Mesh(cabGeo, bodyMat);
    cabMesh.position.set(0, 1.6, 1.9);
    cabMesh.castShadow = true;
    vehicleGroup.add(cabMesh);

    const windGeo = new THREE.BoxGeometry(2.0, 0.9, 0.1);
    const windMesh = new THREE.Mesh(windGeo, glassMat);
    windMesh.position.set(0, 1.8, 2.81);
    vehicleGroup.add(windMesh);

    const cargoGeo = new THREE.BoxGeometry(2.35, 2.4, 4.3);
    const cargoMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, metalness: 0.3 });
    const cargoMesh = new THREE.Mesh(cargoGeo, cargoMat);
    cargoMesh.position.set(0, 1.9, -1.05);
    cargoMesh.castShadow = true;
    vehicleGroup.add(cargoMesh);

    const wheelPositions = [
      { x: -1.15, z: 2.0 },
      { x: 1.15, z: 2.0 },
      { x: -1.15, z: -1.2 },
      { x: 1.15, z: -1.2 },
      { x: -1.15, z: -2.4 },
      { x: 1.15, z: -2.4 },
    ];
    wheelPositions.forEach((pos) => {
      const wheel = createWheel();
      wheel.position.set(pos.x, 0.42, pos.z);
      vehicleGroup.add(wheel);
    });
  } else {
    // Standard Vehicles: Sedan, SUV, Taxi, Police, Emergency
    const isSUV = type === 'suv';
    const isPolice = type === 'police';
    const isEmergency = type === 'emergency' || isPolice;
    const isTaxi = type === 'taxi';

    const width = isSUV ? 2.05 : 1.9;
    const height = isSUV ? 1.05 : 0.85;
    const length = isSUV ? 4.6 : 4.4;

    const lowerGeo = new THREE.BoxGeometry(width, height, length);
    const lowerMesh = new THREE.Mesh(lowerGeo, bodyMat);
    lowerMesh.position.y = 0.65;
    lowerMesh.castShadow = true;
    vehicleGroup.add(lowerMesh);

    // If police, add white door panel wrap
    if (isPolice) {
      const doorPanelGeo = new THREE.BoxGeometry(width + 0.02, height * 0.75, length * 0.45);
      const doorWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
      const doorPanel = new THREE.Mesh(doorPanelGeo, doorWhiteMat);
      doorPanel.position.set(0, 0.65, 0);
      vehicleGroup.add(doorPanel);
    }

    const cabinLength = length * 0.52;
    const cabinWidth = width * 0.88;
    const cabinHeight = isSUV ? 0.95 : 0.78;
    const cabinGeo = new THREE.BoxGeometry(cabinWidth, cabinHeight, cabinLength);
    const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
    cabinMesh.position.set(0, 0.65 + height / 2 + cabinHeight / 2 - 0.05, -0.2);
    cabinMesh.castShadow = true;
    vehicleGroup.add(cabinMesh);

    const roofGeo = new THREE.BoxGeometry(cabinWidth * 0.95, 0.12, cabinLength * 0.85);
    const roofMesh = new THREE.Mesh(roofGeo, bodyMat);
    roofMesh.position.set(0, 0.65 + height / 2 + cabinHeight + 0.02, -0.2);
    vehicleGroup.add(roofMesh);

    const grilleGeo = new THREE.BoxGeometry(width * 0.7, 0.35, 0.12);
    const grilleMesh = new THREE.Mesh(grilleGeo, isPolice ? tireMat : chromeMat);
    grilleMesh.position.set(0, 0.6, length / 2 + 0.04);
    vehicleGroup.add(grilleMesh);

    // Wheels
    const halfW = width * 0.52;
    const wheelZFront = length * 0.32;
    const wheelZRear = -length * 0.32;
    const wheels = [
      { x: -halfW, z: wheelZFront },
      { x: halfW, z: wheelZFront },
      { x: -halfW, z: wheelZRear },
      { x: halfW, z: wheelZRear },
    ];
    wheels.forEach((pos) => {
      const wheel = createWheel();
      wheel.position.set(pos.x, 0.42, pos.z);
      vehicleGroup.add(wheel);
    });

    if (isTaxi) {
      const signGeo = new THREE.BoxGeometry(0.8, 0.25, 0.3);
      const signMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
      const signMesh = new THREE.Mesh(signGeo, signMat);
      signMesh.position.set(0, 0.65 + height / 2 + cabinHeight + 0.22, -0.2);
      vehicleGroup.add(signMesh);
    } else if (isEmergency) {
      // Emergency lightbar (Blue & Red)
      const barBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.12, 0.24),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8 })
      );
      barBase.position.set(0, 0.65 + height / 2 + cabinHeight + 0.15, -0.2);
      vehicleGroup.add(barBase);

      const lightRed = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.2), sirenRedMat);
      lightRed.position.set(-0.25, 0.65 + height / 2 + cabinHeight + 0.25, -0.2);

      const lightBlue = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.2), sirenBlueMat);
      lightBlue.position.set(0.25, 0.65 + height / 2 + cabinHeight + 0.25, -0.2);

      vehicleGroup.add(lightRed, lightBlue);
    }
  }

  // Headlights and Taillights for all vehicles
  const hl1 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.08), headlightMat);
  hl1.position.set(-0.65, 0.72, 2.2);
  const hl2 = hl1.clone();
  hl2.position.set(0.65, 0.72, 2.2);
  vehicleGroup.add(hl1, hl2);

  const tl1 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.08), taillightMat);
  tl1.position.set(-0.65, 0.75, -2.2);
  const tl2 = tl1.clone();
  tl2.position.set(0.65, 0.75, -2.2);
  vehicleGroup.add(tl1, tl2);

  // Soft Contact Shadow Grounding Disc
  const shadowGeo = new THREE.PlaneGeometry(2.6, 5.4);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = 0.03;
  vehicleGroup.add(shadowMesh);

  return vehicleGroup;
}
