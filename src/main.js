import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const container = document.getElementById("canvas-container");

// ---------- RENDERER ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

// ---------- SCENE & CAMERA ----------
const scene = new THREE.Scene();

function createStarfieldTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");

  // Gradient night sky
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#020617"); // deep navy
  grad.addColorStop(0.5, "#0b1120"); // blue
  grad.addColorStop(1, "#1e1b4b"); // purple
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Stars
  const starColors = ["#e5e7eb", "#bae6fd", "#f9a8d4", "#a5b4fc"];
  for (let i = 0; i < 1200; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = Math.random() * 1.6 + 0.3;

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.closePath();

    ctx.fillStyle = starColors[Math.floor(Math.random() * starColors.length)];
    ctx.globalAlpha = 0.5 + Math.random() * 0.5;
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
  
}
// ---------- SKY DOME (STAR FIELD) ----------
// --- Cyberpunk starry background texture ---
const starTexture = createStarfieldTexture();
starTexture.mapping = THREE.EquirectangularReflectionMapping;
starTexture.colorSpace = THREE.SRGBColorSpace;  // better colors
scene.background = starTexture;



const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  3000
);

// Cinematic aerial over junction
camera.position.set(180, 110, 180);
camera.lookAt(0, 15, 0);

// ---------- CONTROLS ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

controls.minPolarAngle = Math.PI / 4;
controls.maxPolarAngle = Math.PI / 1.8;
controls.minDistance = 60;
controls.maxDistance = 260;

// ---------- PMREM FOR HDR ----------
const pmremGen = new THREE.PMREMGenerator(renderer);
pmremGen.compileEquirectangularShader();

// ---------- LOADERS ----------
const texLoader = new THREE.TextureLoader();

// ---------- ENV MAP LOADER ----------
async function loadEnvMap(url) {
  const ext = url.split(".").pop().toLowerCase();
  return new Promise((resolve, reject) => {
    if (ext === "hdr") {
      new RGBELoader()
        .setDataType(THREE.UnsignedByteType)
        .load(
          url,
          (tex) => {
            const envMap = pmremGen.fromEquirectangular(tex).texture;
            tex.dispose();
            resolve(envMap);
          },
          undefined,
          reject
        );
    } else if (ext === "exr") {
      new EXRLoader().load(
        url,
        (tex) => {
          const envMap = pmremGen.fromEquirectangular(tex).texture;
          tex.dispose();
          resolve(envMap);
        },
        undefined,
        reject
      );
    } else {
      reject(new Error("Unsupported env map format. Use .hdr or .exr"));
    }
  });
}

// ---------- CONSTANTS ----------
const ROAD_WIDTH = 40;
const SIDEWALK_WIDTH = 12;

const CITY_SIZE = 600;
const CITY_HALF = CITY_SIZE / 2;

// how far beyond the old city you extended buildings
const EXTRA_RING = 200;

// make roads long enough to cover the whole extended city
// 600 (city) + 2*600 (extra) + 400 margin = 2200
const ROAD_LENGTH = CITY_SIZE + EXTRA_RING * 2 + 400;

const ROAD_CORRIDOR = ROAD_WIDTH / 2 + SIDEWALK_WIDTH + 8;

const CAR_SPEED_MIN = 18;
const CAR_SPEED_MAX = 35;
const CAR_COUNT_PER_ROAD = 10;
const CAR_Y = 0.7; // slightly above road

const LANE_SPEEDS = {
  x1: 24, // +X direction, top lane
  x2: 24, // -X direction, bottom lane
  z1: 22, // +Z direction, right lane
  z2: 22, // -Z direction, left lane
};


// ---------- CITY GROUND ----------
const cityGroundMat = new THREE.MeshStandardMaterial({
  color: 0x050508,
  roughness: 0.95,
});
const cityGround = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  cityGroundMat
);
cityGround.rotation.x = -Math.PI / 2;
scene.add(cityGround);

// ---------- ROAD MATERIAL ----------
const roadMat = new THREE.MeshStandardMaterial({
  color: 0x202020,
  roughness: 0.75,
  metalness: 0.08,
  envMapIntensity: 0.5,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

// ---------- ROADS + SIDEWALKS + LANE MARKINGS ----------
const laneGroup = new THREE.Group();
scene.add(laneGroup);

const dashMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffffff,
  emissiveIntensity: 0.7,
  roughness: 0.4,
});
const edgeMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffffff,
  emissiveIntensity: 0.25,
  roughness: 0.5,
});

function addLanesX(zCenter) {
  const dashLength = 10;
  const dashWidth = 0.8;
  const dashGap = 14;

  // center dashed line along X
  for (
    let x = -ROAD_LENGTH / 2 + dashLength;
    x <= ROAD_LENGTH / 2 - dashLength;
    x += dashLength + dashGap
  ) {
    const dashGeo = new THREE.PlaneGeometry(dashLength, dashWidth);
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, 0.03, zCenter);
    laneGroup.add(dash);
  }

  // side edges along X
  const edgeWidth = 0.4;
  const edgeGeo = new THREE.PlaneGeometry(ROAD_LENGTH, edgeWidth);

  ["top", "bottom"].forEach((edge) => {
    const z =
      edge === "top"
        ? zCenter + ROAD_WIDTH / 2 - 1
        : zCenter - ROAD_WIDTH / 2 + 1;
    const edgeLine = new THREE.Mesh(edgeGeo, edgeMat);
    edgeLine.rotation.x = -Math.PI / 2;
    edgeLine.position.set(0, 0.029, z);
    laneGroup.add(edgeLine);
  });
}

function addLanesZ(xCenter) {
  const dashLength = 10;
  const dashWidth = 0.8;
  const dashGap = 14;

  // center dashed line along Z
  for (
    let z = -ROAD_LENGTH / 2 + dashLength;
    z <= ROAD_LENGTH / 2 - dashLength;
    z += dashLength + dashGap
  ) {
    const dashGeo = new THREE.PlaneGeometry(dashWidth, dashLength);
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(xCenter, 0.03, z);
    laneGroup.add(dash);
  }

  // side edges along Z
  const edgeWidth = 0.4;
  const edgeGeo = new THREE.PlaneGeometry(edgeWidth, ROAD_LENGTH);

  ["left", "right"].forEach((side) => {
    const x =
      side === "right"
        ? xCenter + ROAD_WIDTH / 2 - 1
        : xCenter - ROAD_WIDTH / 2 + 1;
    const edgeLine = new THREE.Mesh(edgeGeo, edgeMat);
    edgeLine.rotation.x = -Math.PI / 2;
    edgeLine.position.set(x, 0.029, 0);
    laneGroup.add(edgeLine);
  });
}

function createStraightRoadX(zCenter = 0) {
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_LENGTH, ROAD_WIDTH),
    roadMat
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.01, zCenter);
  scene.add(road);

  const sideMat = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.9,
  });
  const sideGeo = new THREE.PlaneGeometry(ROAD_LENGTH, SIDEWALK_WIDTH);

  const topSide = new THREE.Mesh(sideGeo, sideMat);
  topSide.rotation.x = -Math.PI / 2;
  topSide.position.set(
    0,
    0.015,
    zCenter + ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2
  );

  const bottomSide = topSide.clone();
  bottomSide.position.set(
    0,
    0.015,
    zCenter - ROAD_WIDTH / 2 - SIDEWALK_WIDTH / 2
  );

  scene.add(topSide, bottomSide);
  addLanesX(zCenter);
}

function createStraightRoadZ(xCenter = 0) {
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_LENGTH, ROAD_WIDTH),
    roadMat
  );
  road.rotation.x = -Math.PI / 2;
  road.rotation.y = Math.PI / 2;
  road.position.set(xCenter, 0.011, 0);
  scene.add(road);

  const sideMat = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.9,
  });
  const sideGeo = new THREE.PlaneGeometry(ROAD_LENGTH, SIDEWALK_WIDTH);

  const rightSide = new THREE.Mesh(sideGeo, sideMat);
  rightSide.rotation.x = -Math.PI / 2;
  rightSide.rotation.y = Math.PI / 2;
  rightSide.position.set(
    xCenter + ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2,
    0.016,
    0
  );

  const leftSide = rightSide.clone();
  leftSide.position.set(
    xCenter - ROAD_WIDTH / 2 - SIDEWALK_WIDTH / 2,
    0.016,
    0
  );

  scene.add(leftSide, rightSide);
  addLanesZ(xCenter);
}



// main cross junction
createStraightRoadX(0);
createStraightRoadZ(0);

const cars = [];
const carGroup = new THREE.Group();
scene.add(carGroup);

const carColors = [
  0xff3355,
  0x38bdf8,
  0xa855f7,
  0xf97316,
  0x22c55e,
];

function spawnCarsX(zPos, direction = 1, laneKey = "x1") {
  const laneSpeed = LANE_SPEEDS[laneKey] || 22;
  const spacing = ROAD_LENGTH / CAR_COUNT_PER_ROAD;

  for (let i = 0; i < CAR_COUNT_PER_ROAD; i++) {
    const car = createCar(
      carColors[Math.floor(Math.random() * carColors.length)]
    );

    let xPos;
    if (direction > 0) {
      // left → right
      xPos = -ROAD_LENGTH / 2 + i * spacing;
    } else {
      // right → left
      xPos = ROAD_LENGTH / 2 - i * spacing;
    }

    car.position.set(
      xPos,
      CAR_Y,
      zPos + (direction > 0 ? -6 : 6)
    );

    car.rotation.y = direction > 0 ? 0 : Math.PI;
    car.userData.axis = "x";
    car.userData.direction = direction;
    car.userData.speed = laneSpeed;

    cars.push(car);
    carGroup.add(car);
  }
}


function spawnCarsZ(xPos, direction = 1, laneKey = "z1") {
  const laneSpeed = LANE_SPEEDS[laneKey] || 22;
  const spacing = ROAD_LENGTH / CAR_COUNT_PER_ROAD;

  for (let i = 0; i < CAR_COUNT_PER_ROAD; i++) {
    const car = createCar(
      carColors[Math.floor(Math.random() * carColors.length)]
    );

    let zPos;
    if (direction > 0) {
      // front → back (+Z)
      zPos = -ROAD_LENGTH / 2 + i * spacing;
    } else {
      // back → front (-Z)
      zPos = ROAD_LENGTH / 2 - i * spacing;
    }

    car.position.set(
      xPos + (direction > 0 ? 6 : -6),
      CAR_Y,
      zPos
    );

    car.rotation.y = direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    car.userData.axis = "z";
    car.userData.direction = direction;
    car.userData.speed = laneSpeed;

    cars.push(car);
    carGroup.add(car);
  }
}

// X road traffic
spawnCarsX(4, 1, "x1");
spawnCarsX(-4, -1, "x2");

// Z road traffic
spawnCarsZ(4, 1, "z1");
spawnCarsZ(-4, -1, "z2");


// ---------- BUILDINGS ----------
const buildings = new THREE.Group();
scene.add(buildings);

// base palette (under glass tint)
const palette = [
  new THREE.Color(0x020617),
  new THREE.Color(0x020617),
  new THREE.Color(0x0b1120),
  new THREE.Color(0x020617),
  new THREE.Color(0x0f172a),
];



function createWindowGridTexture(colorPalette) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#02040a";
  ctx.fillRect(0, 0, size, size);

  const rows = 16;
  const cols = 8;
  const cellW = size / cols;
  const cellH = size / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = Math.random() > 0.35;
      if (!lit) continue;

      const marginX = cellW * 0.15;
      const marginY = cellH * 0.18;

      const x = c * cellW + marginX;
      const y = r * cellH + marginY;
      const w = cellW - 2 * marginX;
      const h = cellH - 2 * marginY;

      const color =
        colorPalette[Math.floor(Math.random() * colorPalette.length)];
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9 - Math.random() * 0.3;
      ctx.fillRect(x, y, w, h);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

const windowGridTextureBlue = createWindowGridTexture([
  "#fef3c7",
  "#e0f2fe",
  "#a5b4fc",
]);
const windowGridTexturePink = createWindowGridTexture([
  "#fecaca",
  "#f9a8d4",
  "#fed7e2",
]);

function createGlassMaterialBlue() {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x88ccff),
    metalness: 0.0,
    roughness: 0.08,
    transmission: 1.0,
    thickness: 0.7,
    envMapIntensity: 1.6,
    clearcoat: 1.0,
    clearcoatRoughness: 0.15,
    transparent: true,
    opacity: 0.9,
    map: windowGridTextureBlue,
    emissiveMap: windowGridTextureBlue,
    emissive: new THREE.Color(0x9bdcff),
    emissiveIntensity: 0.9,
  });
}

function createGlassMaterialPink() {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xff99cc),
    metalness: 0.0,
    roughness: 0.08,
    transmission: 1.0,
    thickness: 0.7,
    envMapIntensity: 1.6,
    clearcoat: 1.0,
    clearcoatRoughness: 0.15,
    transparent: true,
    opacity: 0.9,
    map: windowGridTexturePink,
    emissiveMap: windowGridTexturePink,
    emissive: new THREE.Color(0xff77c7),
    emissiveIntensity: 0.9,
  });
}

function createBuilding(x, z) {
  const width = 6 + Math.random() * 10;
  const depth = 6 + Math.random() * 8;
  const height = 18 + Math.random() * 70;

  const geom = new THREE.BoxGeometry(width, height, depth);

  // --- SIDE MATERIAL (glass with windows, same as before) ---
  let sideMat;
  if (Math.random() < 0.5) {
    sideMat = createGlassMaterialBlue();
  } else {
    sideMat = createGlassMaterialPink();
  }

  // --- ROOF & BOTTOM MATERIAL (plain, no windows) ---
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x020617,      // very dark
    metalness: 0.3,
    roughness: 0.85,
    envMapIntensity: 0.4,
  });

  // Per-face materials: [right, left, top, bottom, front, back]
  const b = new THREE.Mesh(geom, [
    sideMat,  // +X
    sideMat,  // -X
    roofMat,  // +Y (top)
    roofMat,  // -Y (bottom)
    sideMat,  // +Z
    sideMat,  // -Z
  ]);

  b.position.set(
    x + (Math.random() - 0.5) * 4,
    height / 2,
    z + (Math.random() - 0.5) * 4
  );
  b.rotation.y = (Math.random() - 0.5) * 0.08;
  b.castShadow = true;
  b.receiveShadow = true;
  b.userData = {
    h: Math.round(height),
    w: Math.round(width),
    d: Math.round(depth),
  };
  return b;
}
function createCar(color = 0xff3355) {
  const car = new THREE.Group();

  // body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 1.1, 2),
    new THREE.MeshStandardMaterial({
      color,
      metalness: 0.6,
      roughness: 0.35,
      emissive: color,
      emissiveIntensity: 0.15,
    })
  );
  body.position.y = 0.55;
  car.add(body);

  // cabin
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.9, 1.6),
    new THREE.MeshStandardMaterial({
      color: 0x111827,
      metalness: 0.9,
      roughness: 0.25,
    })
  );
  cabin.position.set(0, 1.1, -0.1);
  car.add(cabin);

  // headlights glow
  const headLightMat = new THREE.MeshStandardMaterial({
    emissive: 0xf8fafc,
    emissiveIntensity: 2.5,
    transparent: true,
    opacity: 0.9,
  });

  const leftLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.2, 0.15),
    headLightMat
  );
  leftLight.position.set(-1.3, 0.5, 1);
  car.add(leftLight);

  const rightLight = leftLight.clone();
  rightLight.position.x = 1.3;
  car.add(rightLight);

  car.castShadow = true;
  

  return car;
}


// fill 4 city blocks around the cross roads
// fill a much larger area with buildings so the city feels endless
const STEP = 30;
// how far beyond the old city you want buildings

for (let x = -CITY_HALF - EXTRA_RING; x <= CITY_HALF + EXTRA_RING; x += STEP) {
  for (let z = -CITY_HALF - EXTRA_RING; z <= CITY_HALF + EXTRA_RING; z += STEP) {
    // keep the central cross roads clear
    if (Math.abs(z) < ROAD_CORRIDOR || Math.abs(x) < ROAD_CORRIDOR) continue;

    const b = createBuilding(x, z);
    buildings.add(b);
  }
}


// ---------- NEON STREET LAMPS ----------
function addStreetLampsX(zCenter) {
  for (let x = -ROAD_LENGTH / 2 + 20; x <= ROAD_LENGTH / 2 - 20; x += 48) {
    const poleGeom = new THREE.BoxGeometry(0.4, 6, 0.4);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x050815 });
    const poleLeft = new THREE.Mesh(poleGeom, poleMat);
    const poleRight = poleLeft.clone();

    poleLeft.position.set(x, 3, zCenter + ROAD_WIDTH / 2 + 4);
    poleRight.position.set(x, 3, zCenter - ROAD_WIDTH / 2 - 4);
    scene.add(poleLeft, poleRight);

    const lampMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 2,
      metalness: 0.8,
      roughness: 0.25,
    });
    const lampGeom = new THREE.BoxGeometry(0.4, 1.4, 0.4);
    const lampLeft = new THREE.Mesh(lampGeom, lampMat);
    const lampRight = lampLeft.clone();
    lampLeft.position.set(x, 6.8, zCenter + ROAD_WIDTH / 2 + 4);
    lampRight.position.set(x, 6.8, zCenter - ROAD_WIDTH / 2 - 4);
    scene.add(lampLeft, lampRight);

    const light1 = new THREE.PointLight(0x38bdf8, 1.4, 50, 2);
    const light2 = new THREE.PointLight(0xa855f7, 1.4, 50, 2);
    light1.position.copy(lampLeft.position);
    light2.position.copy(lampRight.position);
    scene.add(light1, light2);
  }
}

function addStreetLampsZ(xCenter) {
  for (let z = -ROAD_LENGTH / 2 + 20; z <= ROAD_LENGTH / 2 - 20; z += 48) {
    const poleGeom = new THREE.BoxGeometry(0.4, 6, 0.4);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x050815 });
    const poleFront = new THREE.Mesh(poleGeom, poleMat);
    const poleBack = poleFront.clone();

    poleFront.position.set(xCenter + ROAD_WIDTH / 2 + 4, 3, z);
    poleBack.position.set(xCenter - ROAD_WIDTH / 2 - 4, 3, z);
    scene.add(poleFront, poleBack);

    const lampMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 2,
      metalness: 0.8,
      roughness: 0.25,
    });
    const lampGeom = new THREE.BoxGeometry(0.4, 1.4, 0.4);
    const lampFront = new THREE.Mesh(lampGeom, lampMat);
    const lampBack = lampFront.clone();
    lampFront.position.set(xCenter + ROAD_WIDTH / 2 + 4, 6.8, z);
    lampBack.position.set(xCenter - ROAD_WIDTH / 2 - 4, 6.8, z);
    scene.add(lampFront, lampBack);

    const light1 = new THREE.PointLight(0x38bdf8, 1.4, 50, 2);
    const light2 = new THREE.PointLight(0xa855f7, 1.4, 50, 2);
    light1.position.copy(lampFront.position);
    light2.position.copy(lampBack.position);
    scene.add(light1, light2);
  }
}

addStreetLampsX(0);
addStreetLampsZ(0);

// ---------- CLEAR ANY STRAY WALLS / PILLARS IN THE JUNCTION ----------
function clearJunctionObstacles() {
  const R = ROAD_WIDTH * 1.4; // area around center to keep clean
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const toRemove = [];

  scene.traverse((obj) => {
    if (!obj.isMesh) return;

    box.setFromObject(obj);
    box.getSize(size);

    // skip flat stuff (roads, lane marks, ground)
    if (size.y < 2) return;

    // if this object's bounding box does NOT intersect the central square, ignore
    if (box.min.x > R || box.max.x < -R || box.min.z > R || box.max.z < -R) {
      return;
    }

    // anything tall intersecting the central square is suspicious → remove
    toRemove.push(obj);
  });

  toRemove.forEach((o) => {
    if (o.parent) o.parent.remove(o);
  });

  console.log("Cleared junction obstacles:", toRemove.length);
}

clearJunctionObstacles();

// ---------- ROUNDABOUT ISLAND WITH “BUNNY'S CITY” ----------
function createTextTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  // --- Background: subtle dark gradient ---
  const bgGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  bgGrad.addColorStop(0, "#020617");
  bgGrad.addColorStop(1, "#030712");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // --- Neon border (orange–pink, but not too crazy) ---
  ctx.save();
  ctx.strokeStyle = "#fb923c";        // warm orange
  ctx.lineWidth = 8;
  ctx.shadowColor = "rgba(251, 146, 60, 0.8)";
  ctx.shadowBlur = 25;
  ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);
  ctx.restore();

  // ---------- "BUNNY'S" (top, horizontal) ----------
  // ---------- "BUNNY'S" (top, horizontal) ----------
const titleGrad = ctx.createLinearGradient(0, 0, canvas.width, 0);
titleGrad.addColorStop(0, "#f9a8d4"); // light building pink
titleGrad.addColorStop(1, "#ec4899"); // deep pink

ctx.font = "bold 140px system-ui, sans-serif";
ctx.textAlign = "center";
ctx.textBaseline = "middle";

ctx.fillStyle = titleGrad;
ctx.shadowColor = "rgba(236, 72, 153, 0.9)"; // pink glow
ctx.shadowBlur = 40;

const titleX = canvas.width / 2;
const titleY = canvas.height * 0.28;
ctx.fillText("CYBER", titleX, titleY);

// subtle metallic edge
ctx.lineWidth = 2;
ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
ctx.strokeText("CYBER", titleX, titleY);


  // ---------- "CITY" (vertical) ----------
  // ---------- "CITY" (vertical) ----------
const letters = ["P", "U", "N", "K"];
const xCenter = canvas.width / 2;
let y = canvas.height * 0.45;
const step = 75;

ctx.font = "bold 110px system-ui, sans-serif";
ctx.fillStyle = "#fbcfe8"; // soft pink (matches buildings)
ctx.shadowColor = "rgba(236, 72, 153, 0.9)";
ctx.shadowBlur = 30;

letters.forEach((ch) => {
  ctx.fillText(ch, xCenter, y);
  y += step;
});


  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}



// keep this global so we can animate it
// globals for animation
// globals for animation
let floatingBoard;
let floatingBoardBaseY = 0;

function createRoundabout() {
  const roundaboutGroup = new THREE.Group();

  const radius = 14;
  const islandHeight = 0.8;

  // central island
  const islandGeo = new THREE.CylinderGeometry(radius, radius, islandHeight, 64);
  const islandMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.6,
    metalness: 0.3,
    emissive: 0x0f172a,
    emissiveIntensity: 0.4,
  });
  const island = new THREE.Mesh(islandGeo, islandMat);
  island.position.set(0, islandHeight / 2 + 0.04, 0);
  island.receiveShadow = true;
  roundaboutGroup.add(island);

  // neon ring on top
  const ringGeo = new THREE.TorusGeometry(radius - 1.5, 0.4, 16, 64);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    emissive: 0xffedd5,
    emissiveIntensity: 1.7,
    metalness: 0.4,
    roughness: 0.25,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = island.position.y + islandHeight / 2 + 0.05;
  roundaboutGroup.add(ring);

  // floating metallic sign card (no pole)
  const boardTex = createTextTexture();
  const boardWidth = 24;
  const boardHeight = 20;  // taller so full "CITY" fits
  const boardGeo = new THREE.PlaneGeometry(boardWidth, boardHeight);
  const boardMat = new THREE.MeshPhysicalMaterial({
  map: boardTex,
  transparent: true,
  side: THREE.DoubleSide,
  metalness: 0.9,          // still metallic
  roughness: 0.25,         // a bit more rough → less mirror
  envMapIntensity: 1.6,    // toned down reflections
  clearcoat: 1.0,
  clearcoatRoughness: 0.12,
  emissive: new THREE.Color(0x111827),  // very dark blue-grey
  emissiveIntensity: 0.25,              // soft, not dominating
});


  const board = new THREE.Mesh(boardGeo, boardMat);

  const baseY = island.position.y + 11.0;
  board.position.set(0, baseY, 0);
  board.rotation.y = Math.PI / 2;

  roundaboutGroup.add(board);

  // glow from the centre of island
  const coreLight = new THREE.PointLight(0xfbbf24, 1.8, 80, 2);
  coreLight.position.set(0, island.position.y + 2, 0);
  roundaboutGroup.add(coreLight);

  scene.add(roundaboutGroup);

  floatingBoard = board;
  floatingBoardBaseY = baseY;
}

createRoundabout();


// ---------- POSTPROCESSING ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.7,
  0.4,
  0.15
);
bloomPass.threshold = 0.15;
bloomPass.strength = 1.0;
bloomPass.radius = 0.45;
composer.addPass(bloomPass);

// ---------- RAYCAST CLICK INFO ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
window.addEventListener("pointerdown", (ev) => {
  pointer.x = (ev.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(ev.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(buildings.children, false);
  if (hits.length) {
    const b = hits[0].object;
    const info = document.getElementById("infoBox");
    info.innerHTML = `<strong>Height:</strong> ${b.userData.h} m<br>
<strong>Width:</strong> ${b.userData.w} m<br>
<strong>Depth:</strong> ${b.userData.d} m`;
  }
});

// ---------- RESPONSIVE ----------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- WASD MOVEMENT ----------
const move = { forward: false, back: false, left: false, right: false };
window.addEventListener("keydown", (e) => {
  if (e.key === "w" || e.key === "ArrowUp") move.forward = true;
  if (e.key === "s" || e.key === "ArrowDown") move.back = true;
  if (e.key === "a" || e.key === "ArrowLeft") move.left = true;
  if (e.key === "d" || e.key === "ArrowRight") move.right = true;
});
window.addEventListener("keyup", (e) => {
  if (e.key === "w" || e.key === "ArrowUp") move.forward = false;
  if (e.key === "s" || e.key === "ArrowDown") move.back = false;
  if (e.key === "a" || e.key === "ArrowLeft") move.left = false;
  if (e.key === "d" || e.key === "ArrowRight") move.right = false;
});

function stepCamera(delta) {
  const speed = 40 * delta;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  if (move.forward) camera.position.addScaledVector(forward, speed);
  if (move.back) camera.position.addScaledVector(forward, -speed);
  if (move.left) camera.position.addScaledVector(right, -speed);
  if (move.right) camera.position.addScaledVector(right, speed);
}

// ---------- TOGGLE DAY / NIGHT ----------

document.getElementById("resetCam").addEventListener("click", () => {
  camera.position.set(180, 110, 180);
  controls.target.set(0, 15, 0);
});

// ---------- LOAD ENV MAP ----------
const HDRI_PATH = "/assets/env/shanghai_bund_4k.exr";
loadEnvMap(HDRI_PATH)
  .then((env) => {
    scene.environment = env;
    console.log("Environment map applied");
  })
  .catch((err) => console.error("Env load error", err));

// ---------- ANIMATION LOOP ----------
// ---------- ANIMATION LOOP ----------
let last = performance.now();
function animate(now) {
  const delta = (now - last) / 1000;
  last = now;

  controls.update();
  stepCamera(delta);

  if (camera.position.y < 5) camera.position.y = 5;

  // === Bunny's City board animation ===
  if (floatingBoard) {
    const t = now * 0.0012;          // time factor

    // up–down floating
    const floatOffset = Math.sin(t) * 0.7;
    floatingBoard.position.y = floatingBoardBaseY + floatOffset;

    // slow spin so all roads see the board
    const spinSpeed = 0.35;          // tweak this for faster/slower spin
    floatingBoard.rotation.y = t * spinSpeed;
  }
   cars.forEach((car) => {
  const speed = car.userData.speed * delta;

  if (car.userData.axis === "x") {
    car.position.x += speed * car.userData.direction;

    if (car.position.x > ROAD_LENGTH / 2) {
      car.position.x = -ROAD_LENGTH / 2;
    }
    if (car.position.x < -ROAD_LENGTH / 2) {
      car.position.x = ROAD_LENGTH / 2;
    }
  }

  if (car.userData.axis === "z") {
    car.position.z += speed * car.userData.direction;

    if (car.position.z > ROAD_LENGTH / 2) {
      car.position.z = -ROAD_LENGTH / 2;
    }
    if (car.position.z < -ROAD_LENGTH / 2) {
      car.position.z = ROAD_LENGTH / 2;
    }
  }
});

  composer.render();
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
