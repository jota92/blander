import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

const viewport = document.getElementById("viewport");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f0f14);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
camera.position.set(6, 5, 8);
camera.lookAt(new THREE.Vector3(0, 0, 0));

const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 7);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.set(2048, 2048);
scene.add(directionalLight);

const fillLight = new THREE.DirectionalLight(0x4455ff, 0.25);
fillLight.position.set(-6, 3, -4);
scene.add(fillLight);

const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x1d1d23,
  roughness: 0.95,
  metalness: 0.05,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const gridHelper = new THREE.GridHelper(20, 40, 0x3a3a46, 0x2b2b36);
scene.add(gridHelper);

const axesHelper = new THREE.AxesHelper(1.5);
axesHelper.position.y = 0.01;
scene.add(axesHelper);

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.08;
orbitControls.screenSpacePanning = true;
orbitControls.maxPolarAngle = Math.PI * 0.495;

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setSize(0.9);
transformControls.addEventListener("dragging-changed", (event) => {
  orbitControls.enabled = !event.value;
  if (event.value) {
    didChangeDuringDrag = false;
    if (editState.active && transformControls.object === editState.pivot) {
      beginEditTransform();
    }
  } else {
    if (editState.active && transformControls.object === editState.pivot) {
      applyPivotTransformDelta();
      editState.transformSnapshot = null;
    }
    if (didChangeDuringDrag) {
      commitHistory();
    }
    didChangeDuringDrag = false;
  }
});
transformControls.addEventListener("objectChange", () => {
  if (editState.active && transformControls.object === editState.pivot) {
    if (!editState.transformSnapshot) {
      beginEditTransform();
    }
    applyPivotTransformDelta();
    updateEditHelpers();
  } else {
    didChangeDuringDrag = true;
    updateInspector();
    updateEditHelpers();
  }
});
scene.add(transformControls);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const primitives = [];
const primitiveCounters = {
  cube: 0,
  sphere: 0,
  cylinder: 0,
  plane: 0,
};

const MAX_HISTORY = 50;
const history = [];
let historyIndex = -1;
let isRestoring = false;
let nextObjectId = 1;
let didChangeDuringDrag = false;

const editState = {
  active: false,
  object: null,
  helpers: [],
  selectedHelpers: [],
  selectionKeys: new Set(),
  pivot: new THREE.Object3D(),
  mode: "vertex",
  transformSnapshot: null,
};

scene.add(editState.pivot);
editState.pivot.visible = false;

const vertexHelperGeometry = new THREE.SphereGeometry(0.05, 16, 16);
const vertexHelperBaseColor = 0xfff176;
const vertexHelperSelectedColor = 0xff8f5a;
const vertexHelperMaterialTemplate = new THREE.MeshBasicMaterial({
  color: vertexHelperBaseColor,
  depthTest: false,
  depthWrite: false,
  transparent: true,
  opacity: 0.9,
});

const faceHelperGeometry = new THREE.CircleGeometry(0.14, 24);
const faceHelperBaseColor = 0x7a9cff;
const faceHelperSelectedColor = 0xff9f6f;
const faceHelperMaterialTemplate = new THREE.MeshBasicMaterial({
  color: faceHelperBaseColor,
  transparent: true,
  opacity: 0.65,
  depthTest: false,
  side: THREE.DoubleSide,
});

const helperBaseNormal = new THREE.Vector3(0, 0, 1);

const tempVertex = new THREE.Vector3();
const tempVertexB = new THREE.Vector3();
const tempVertexC = new THREE.Vector3();
const tempWorld = new THREE.Vector3();
const tempWorldB = new THREE.Vector3();
const tempWorldC = new THREE.Vector3();
const tempCenter = new THREE.Vector3();
const tempNormal = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempMatrix = new THREE.Matrix4();
const tempMatrixInverse = new THREE.Matrix4();
const tempDeltaMatrix = new THREE.Matrix4();

let selectedObject = null;
let currentTransformMode = "translate";
const sceneList = document.getElementById("scene-list");
const nameField = document.getElementById("object-name");
const typeField = document.getElementById("object-type");
const deleteButton = document.getElementById("delete-object");
const vectorInputs = Array.from(document.querySelectorAll(".vector-input"));
const toggleEditButton = document.getElementById("toggle-edit-mode");
const subdivideButton = document.getElementById("subdivide-object");
const editModeButtons = Array.from(document.querySelectorAll("[data-edit-mode]"));

createVectorInputs();
setTransformMode("translate");
updateEditModeUI();

function createVectorInputs() {
  vectorInputs.forEach((container) => {
    const vector = container.dataset.vector;
    ["x", "y", "z"].forEach((axis) => {
      const label = document.createElement("label");
      label.textContent = axis.toUpperCase();

      const input = document.createElement("input");
      input.type = "number";
      input.step = vector === "rotation" ? "1" : "0.1";
      input.dataset.vector = vector;
      input.dataset.axis = axis;

      input.addEventListener("change", (event) => {
        if (!selectedObject) return;
        const value = parseFloat(event.target.value);
        if (Number.isNaN(value)) return;

        if (vector === "position") {
          selectedObject.position[axis] = value;
        } else if (vector === "rotation") {
          selectedObject.rotation[axis] = THREE.MathUtils.degToRad(value);
        } else if (vector === "scale") {
          selectedObject.scale[axis] = value;
        }

        commitHistory();
        updateEditHelpers();
      });

      label.appendChild(input);
      container.appendChild(label);
    });
  });
}

function updateRendererSize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;

  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", updateRendererSize);
updateRendererSize();

function animate() {
  requestAnimationFrame(animate);
  orbitControls.update();
  updateEditHelpers();
  renderer.render(scene, camera);
}

animate();

renderer.domElement.addEventListener("pointerdown", onPointerDown);

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "add-cube") addPrimitive("cube");
    if (action === "add-sphere") addPrimitive("sphere");
    if (action === "add-cylinder") addPrimitive("cylinder");
    if (action === "add-plane") addPrimitive("plane");
  });
});

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    setTransformMode(button.dataset.mode);
  });
});

deleteButton.addEventListener("click", deleteSelectedObject);

if (toggleEditButton) {
  toggleEditButton.addEventListener("click", toggleEditMode);
}

if (subdivideButton) {
  subdivideButton.addEventListener("click", subdivideSelectedObject);
}

editModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!editState.active) return;
    const mode = button.dataset.editMode;
    if (mode) {
      setEditComponentMode(mode);
    }
  });
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;

  const key = event.key.toLowerCase();

  if (key === "z") {
    if (event.shiftKey) {
      redo();
    } else {
      undo();
    }
    event.preventDefault();
    return;
  }

  if (key === "tab") {
    if (selectedObject) {
      toggleEditMode();
      event.preventDefault();
    }
    return;
  }

  if (key === "escape") {
    if (editState.active && editState.selectedHelpers.length > 0) {
      clearEditSelection();
      event.preventDefault();
    }
    return;
  }

  if (editState.active && key === "1") {
    setEditComponentMode("vertex");
    event.preventDefault();
    return;
  }

  if (editState.active && key === "3") {
    setEditComponentMode("face");
    event.preventDefault();
    return;
  }

  if (key === "g") {
    setTransformMode("translate");
  } else if (key === "r") {
    setTransformMode("rotate");
  } else if (key === "s") {
    setTransformMode("scale");
  } else if ((key === "x" || key === "delete") && selectedObject) {
    deleteSelectedObject();
  }
});

function addPrimitive(type) {
  primitiveCounters[type] += 1;
  const label = `${capitalize(type)} ${primitiveCounters[type]}`;

  let geometry;
  const material = new THREE.MeshStandardMaterial({
    color: randomThemeColor(),
    roughness: 0.4,
    metalness: 0.05,
  });

  switch (type) {
    case "cube":
      geometry = new THREE.BoxGeometry(1, 1, 1);
      break;
    case "sphere":
      geometry = new THREE.SphereGeometry(0.6, 32, 24);
      break;
    case "cylinder":
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32);
      break;
    case "plane":
      geometry = new THREE.PlaneGeometry(1.5, 1.5, 1, 1);
      break;
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1);
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = label;
  mesh.userData.originalEmissive = mesh.material.emissive.getHex();
  mesh.userData.type = capitalize(type);
  mesh.userData.primitiveType = type;
  mesh.userData.blId = nextObjectId++;
  mesh.castShadow = true;
  mesh.receiveShadow = type === "plane";

  mesh.position.set(0, type === "plane" ? 0.01 : 0.5, 0);
  if (type === "plane") {
    mesh.rotation.x = -Math.PI / 2;
    mesh.material.side = THREE.DoubleSide;
  }

  scene.add(mesh);
  primitives.push(mesh);
  selectObject(mesh);
  refreshSceneList();
  commitHistory();
}

function selectObject(object) {
  if (selectedObject === object) return;

  if (editState.active && (!object || editState.object !== object)) {
    exitEditMode();
  }

  if (selectedObject) {
    selectedObject.material.emissive.setHex(selectedObject.userData.originalEmissive || 0x000000);
  }

  selectedObject = object || null;

  if (selectedObject) {
    selectedObject.userData.originalEmissive = selectedObject.material.emissive.getHex();
    selectedObject.material.emissive.setHex(0x4b5dff);
    if (!editState.active) {
      transformControls.attach(selectedObject);
    }
  } else {
    transformControls.detach();
  }

  updateInspector();
  refreshSceneList();
  updateEditModeUI();
}

function deleteSelectedObject() {
  if (!selectedObject) return;

  exitEditMode();

  scene.remove(selectedObject);
  transformControls.detach();

  const index = primitives.indexOf(selectedObject);
  if (index !== -1) {
    primitives.splice(index, 1);
  }

  selectedObject = null;
  updateInspector();
  refreshSceneList();
  commitHistory();
}

function refreshSceneList() {
  sceneList.innerHTML = "";
  primitives.forEach((mesh) => {
    const item = document.createElement("li");
    item.className = `scene-item${mesh === selectedObject ? " active" : ""}`;

    const nameSpan = document.createElement("span");
    nameSpan.textContent = mesh.name;

    const typeSpan = document.createElement("span");
    typeSpan.textContent = mesh.userData.type;

    item.appendChild(nameSpan);
    item.appendChild(typeSpan);

    item.addEventListener("click", () => selectObject(mesh));
    sceneList.appendChild(item);
  });
}

function updateInspector() {
  updateEditModeUI();

  if (!selectedObject) {
    nameField.textContent = "-";
    typeField.textContent = "-";
    deleteButton.disabled = true;
    vectorInputs.forEach((container) => {
      container.querySelectorAll("input").forEach((input) => {
        input.value = "";
        input.disabled = true;
      });
    });
    return;
  }

  nameField.textContent = selectedObject.name;
  typeField.textContent = selectedObject.userData.type;
  deleteButton.disabled = false;

  vectorInputs.forEach((container) => {
    const vector = container.dataset.vector;
    container.querySelectorAll("input").forEach((input) => {
      const axis = input.dataset.axis;
      input.disabled = false;
      if (vector === "position") {
        input.value = selectedObject.position[axis].toFixed(2);
      } else if (vector === "rotation") {
        input.value = THREE.MathUtils.radToDeg(selectedObject.rotation[axis]).toFixed(1);
      } else if (vector === "scale") {
        input.value = selectedObject.scale[axis].toFixed(2);
      }
    });
  });
}

function onPointerDown(event) {
  if (event.button !== 0) return;

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  if (editState.active && editState.helpers.length > 0) {
    const helperIntersects = raycaster.intersectObjects(editState.helpers, false);
    if (helperIntersects.length > 0) {
      const primary = helperIntersects[0].object;
      selectEditHelper(primary, {
        additive: event.shiftKey && !(event.ctrlKey || event.metaKey),
        toggle: event.ctrlKey || event.metaKey,
      });
      return;
    }

    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
      clearEditSelection();
    }
  }
  const intersects = raycaster.intersectObjects(primitives);

  if (intersects.length > 0) {
    selectObject(intersects[0].object);
  } else {
    selectObject(null);
  }
}

function setTransformMode(mode) {
  currentTransformMode = mode;
  transformControls.setMode(mode);
  updateModeButtonState(mode);
}

function updateModeButtonState(activeMode) {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === activeMode);
  });
}

function randomThemeColor() {
  const palette = [0xff8f5a, 0x7a9cff, 0x9c86ff, 0x5ad4ff, 0xffc15a];
  return palette[Math.floor(Math.random() * palette.length)];
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function canEditMesh(mesh) {
  return Boolean(mesh?.geometry?.attributes?.position);
}

function toggleEditMode() {
  if (!selectedObject || !canEditMesh(selectedObject)) return;

  if (editState.active && editState.object === selectedObject) {
    exitEditMode();
  } else {
    enterEditMode(selectedObject);
  }
}

function enterEditMode(mesh) {
  if (!canEditMesh(mesh)) return;

  exitEditMode();

  editState.active = true;
  editState.object = mesh;
  editState.helpers = [];

  const positionAttr = mesh.geometry.attributes.position;
  mesh.updateMatrixWorld(true);

  for (let i = 0; i < positionAttr.count; i += 1) {
    const helperMaterial = helperTemplateMaterial.clone();
    const helper = new THREE.Mesh(helperGeometry, helperMaterial);
    helper.renderOrder = 10;
    helper.userData.vertexIndex = i;
    helper.userData.isVertexHelper = true;
    scene.add(helper);
    editState.helpers.push(helper);
  }

  transformControls.detach();
  clearVertexSelection();
  updateEditHelpers();
  updateEditModeUI();
}

function exitEditMode() {
  if (!editState.active) return;

  clearVertexSelection();

  editState.helpers.forEach((helper) => {
    if (helper.parent) {
      helper.parent.remove(helper);
    }
    helper.material.dispose();
  });
  editState.helpers.length = 0;

  editState.active = false;
  editState.object = null;

  if (selectedObject) {
    transformControls.attach(selectedObject);
  }

  updateModeButtonState(currentTransformMode);
  updateEditModeUI();
}

function clearVertexSelection() {
  if (editState.selectedHelper) {
    editState.selectedHelper.material.color.setHex(helperBaseColor);
    editState.selectedHelper = null;
  }

  if (transformControls.object?.userData?.isVertexHelper) {
    transformControls.detach();
  }

  updateModeButtonState(currentTransformMode);
}

function selectVertexHelper(helper) {
  if (!editState.active) return;

  updateEditHelpers();

  if (editState.selectedHelper) {
    editState.selectedHelper.material.color.setHex(helperBaseColor);
  }

  editState.selectedHelper = helper;
  helper.material.color.setHex(helperSelectedColor);

  transformControls.attach(helper);
  transformControls.setMode(currentTransformMode);
  updateModeButtonState(currentTransformMode);
}

function updateEditModeUI() {
  if (toggleEditButton) {
    const canToggle = Boolean(selectedObject && canEditMesh(selectedObject));
    toggleEditButton.disabled = !canToggle;
    toggleEditButton.textContent = editState.active ? "オブジェクトモード (Tab)" : "編集モード (Tab)";
    toggleEditButton.classList.toggle("active", editState.active);
    toggleEditButton.setAttribute("aria-pressed", editState.active ? "true" : "false");
  }

  if (subdivideButton) {
    subdivideButton.disabled = !(selectedObject && canEditMesh(selectedObject));
  }
}

function updateEditHelpers() {
  if (!editState.active || !editState.object || editState.helpers.length === 0) return;
  const mesh = editState.object;
  const positionAttr = mesh.geometry.attributes.position;
  if (!positionAttr) return;

  mesh.updateMatrixWorld(true);

  for (let i = 0; i < editState.helpers.length; i += 1) {
    const helper = editState.helpers[i];
    const index = helper.userData.vertexIndex;
    tempVertex.fromBufferAttribute(positionAttr, index);
    tempWorld.copy(tempVertex);
    mesh.localToWorld(tempWorld);
    helper.position.copy(tempWorld);
  }
}

function applyVertexHelperChange(helper) {
  if (!editState.active || !editState.object) return;
  const mesh = editState.object;
  const positionAttr = mesh.geometry.attributes.position;
  if (!positionAttr) return;

  const index = helper.userData.vertexIndex;
  const localPosition = helper.position.clone();
  mesh.worldToLocal(localPosition);
  positionAttr.setXYZ(index, localPosition.x, localPosition.y, localPosition.z);
  positionAttr.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
  if (mesh.geometry.boundingBox) {
    mesh.geometry.computeBoundingBox();
  }
}

function subdivideSelectedObject() {
  if (!selectedObject || !canEditMesh(selectedObject)) return;

  const target = selectedObject;
  const wasEditing = editState.active && editState.object === target;

  if (wasEditing) {
    exitEditMode();
  }

  const subdivided = createSubdividedGeometry(target.geometry);
  target.geometry.dispose();
  target.geometry = subdivided;

  if (target.userData.primitiveType === "plane") {
    target.material.side = THREE.DoubleSide;
  }

  if (wasEditing) {
    enterEditMode(target);
  } else {
    updateEditHelpers();
  }

  updateInspector();
  commitHistory();
}

function createSubdividedGeometry(geometry) {
  const source = geometry.clone();
  const base = source.toNonIndexed();
  const positionAttr = base.attributes.position;
  const uvAttr = base.attributes.uv;

  const newPositions = [];
  const newUVs = uvAttr ? [] : null;

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const mid01 = new THREE.Vector3();
  const mid12 = new THREE.Vector3();
  const mid20 = new THREE.Vector3();

  const uv0 = new THREE.Vector2();
  const uv1 = new THREE.Vector2();
  const uv2 = new THREE.Vector2();
  const uv01 = new THREE.Vector2();
  const uv12 = new THREE.Vector2();
  const uv20 = new THREE.Vector2();

  const pushTriangle = (array, a, b, c) => {
    array.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  const pushUvTriangle = (array, a, b, c) => {
    array.push(a.x, a.y, b.x, b.y, c.x, c.y);
  };

  for (let i = 0; i < positionAttr.count; i += 3) {
    v0.fromBufferAttribute(positionAttr, i);
    v1.fromBufferAttribute(positionAttr, i + 1);
    v2.fromBufferAttribute(positionAttr, i + 2);

    mid01.copy(v0).add(v1).multiplyScalar(0.5);
    mid12.copy(v1).add(v2).multiplyScalar(0.5);
    mid20.copy(v2).add(v0).multiplyScalar(0.5);

    pushTriangle(newPositions, v0, mid01, mid20);
    pushTriangle(newPositions, mid01, v1, mid12);
    pushTriangle(newPositions, mid20, mid12, v2);
    pushTriangle(newPositions, mid01, mid12, mid20);

    if (newUVs) {
      uv0.fromBufferAttribute(uvAttr, i);
      uv1.fromBufferAttribute(uvAttr, i + 1);
      uv2.fromBufferAttribute(uvAttr, i + 2);

      uv01.copy(uv0).add(uv1).multiplyScalar(0.5);
      uv12.copy(uv1).add(uv2).multiplyScalar(0.5);
      uv20.copy(uv2).add(uv0).multiplyScalar(0.5);

      pushUvTriangle(newUVs, uv0, uv01, uv20);
      pushUvTriangle(newUVs, uv01, uv1, uv12);
      pushUvTriangle(newUVs, uv20, uv12, uv2);
      pushUvTriangle(newUVs, uv01, uv12, uv20);
    }
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(newPositions, 3)
  );

  if (newUVs) {
    result.setAttribute("uv", new THREE.Float32BufferAttribute(newUVs, 2));
  }

  result.computeVertexNormals();
  result.computeBoundingSphere();
  result.computeBoundingBox();

  source.dispose();
  base.dispose();

  return result;
}

function captureState() {
  return {
    objects: primitives.map((mesh) => {
      const positionAttr = mesh.geometry.attributes.position;
      const normalAttr = mesh.geometry.attributes.normal;
      const uvAttr = mesh.geometry.attributes.uv;
      const indexAttr = mesh.geometry.index;

      return {
        id: mesh.userData.blId,
        primitiveType: mesh.userData.primitiveType,
        displayType: mesh.userData.type,
        name: mesh.name,
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
        position: mesh.position.toArray(),
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
        scale: mesh.scale.toArray(),
        material: {
          color: mesh.material.color.getHex(),
          emissive: mesh.userData.originalEmissive ?? mesh.material.emissive.getHex(),
          roughness: mesh.material.roughness,
          metalness: mesh.material.metalness,
          side: mesh.material.side,
        },
        geometry: {
          position: positionAttr ? Array.from(positionAttr.array) : [],
          normal: normalAttr ? Array.from(normalAttr.array) : null,
          uv: uvAttr ? Array.from(uvAttr.array) : null,
          index: indexAttr ? Array.from(indexAttr.array) : null,
        },
      };
    }),
    selectedId: selectedObject ? selectedObject.userData.blId : null,
    counters: { ...primitiveCounters },
    transformMode: currentTransformMode,
    nextObjectId,
  };
}

function commitHistory() {
  if (isRestoring) return;

  const snapshot = captureState();
  const hash = JSON.stringify(snapshot);
  if (historyIndex >= 0 && history[historyIndex]?.__hash === hash) {
    return;
  }

  history.splice(historyIndex + 1);
  snapshot.__hash = hash;
  history.push(snapshot);

  if (history.length > MAX_HISTORY) {
    history.shift();
  }

  historyIndex = history.length - 1;
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  restoreState(history[historyIndex]);
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex += 1;
  restoreState(history[historyIndex]);
}

function restoreState(state) {
  if (!state) return;

  isRestoring = true;

  exitEditMode();

  if (transformControls.object) {
    transformControls.detach();
  }

  primitives.forEach((mesh) => {
    if (mesh.parent) {
      mesh.parent.remove(mesh);
    }
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
  primitives.length = 0;

  const countersFromState = state.counters || {};
  Object.keys(primitiveCounters).forEach((key) => {
    primitiveCounters[key] = countersFromState[key] || 0;
  });

  state.objects.forEach((data) => {
    const mesh = rebuildMeshFromState(data);
    scene.add(mesh);
    primitives.push(mesh);
    if (!(data.primitiveType in primitiveCounters)) {
      primitiveCounters[data.primitiveType] = countersFromState[data.primitiveType] || 0;
    }
  });

  nextObjectId = state.nextObjectId ?? computeNextObjectId();

  let targetSelection = null;
  if (typeof state.selectedId === "number") {
    targetSelection = primitives.find((mesh) => mesh.userData.blId === state.selectedId) || null;
  }

  refreshSceneList();
  selectObject(targetSelection);

  if (state.transformMode) {
    setTransformMode(state.transformMode);
  }

  isRestoring = false;
  refreshSceneList();
  updateInspector();
}

function rebuildMeshFromState(data) {
  const geometry = new THREE.BufferGeometry();
  if (data.geometry.position?.length) {
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(data.geometry.position), 3)
    );
  }

  if (data.geometry.normal?.length) {
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(new Float32Array(data.geometry.normal), 3)
    );
  }

  if (data.geometry.uv?.length) {
    geometry.setAttribute(
      "uv",
      new THREE.BufferAttribute(new Float32Array(data.geometry.uv), 2)
    );
  }

  if (data.geometry.index?.length) {
    geometry.setIndex(data.geometry.index);
  }

  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: data.material.color,
    roughness: data.material.roughness,
    metalness: data.material.metalness,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = data.name;
  mesh.position.fromArray(data.position);
  mesh.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
  mesh.scale.fromArray(data.scale);
  mesh.castShadow = data.castShadow;
  mesh.receiveShadow = data.receiveShadow;
  mesh.userData.type = data.displayType;
  mesh.userData.primitiveType = data.primitiveType;
  mesh.userData.blId = data.id;
  mesh.userData.originalEmissive = data.material.emissive ?? 0x000000;
  mesh.material.emissive.setHex(data.material.emissive ?? 0x000000);
  mesh.material.side = data.material.side ?? THREE.FrontSide;

  if (data.primitiveType === "plane") {
    mesh.material.side = THREE.DoubleSide;
  }

  return mesh;
}

function computeNextObjectId() {
  return primitives.reduce((max, mesh) => Math.max(max, mesh.userData.blId || 0), 0) + 1;
}

commitHistory();
