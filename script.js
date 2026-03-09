import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { loadMixamoAnimation } from './reference/loadMixamoAnimation.js';
import { imageList } from './imageList.js';

let camera, scene, renderer, controls;
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;

let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

// --- VRM & Animation Globals ---
let currentVrm = undefined;
let mixer = undefined;
let clock = new THREE.Clock();
// We'll attach the camera to a dummy object that follows the character
let cameraTarget = new THREE.Object3D();

let animActions = {};
let currentAnimName = 'idle';

// Define museum dimensions
const roomSize = 33;
const wallHeight = 20;

let isMobileMode = false;

// Device Selection Logic
document.getElementById('btn-pc').addEventListener('click', () => {
    document.getElementById('device-selection').style.display = 'none';
    document.getElementById('instructions-pc').style.display = 'block';
    isMobileMode = false;
    init();
});

document.getElementById('btn-mobile').addEventListener('click', () => {
    document.getElementById('ui-container').style.display = 'none';
    document.getElementById('mobile-ui').style.display = 'block';
    isMobileMode = true;
    init();
});

document.getElementById('btn-exit-mobile').addEventListener('click', () => {
    // Basic exit implementation
    location.reload();
});

function init() {
    // 1. Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f); // Dark space
    scene.fog = new THREE.Fog(0x0a0a0f, 10, 50);

    // 2. Camera setup
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.y = 2.5; // Eye level
    // Ensure camera rotation order is YXZ for FPS style looking
    camera.rotation.order = 'YXZ';

    // 3. Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    if (!isMobileMode) {
        // 4a. PC Controls setup (PointerLock for First Person)
        controls = new PointerLockControls(camera, document.body);

        const uiContainer = document.getElementById('ui-container');
        const crosshair = document.getElementById('crosshair');

        uiContainer.addEventListener('click', () => {
            controls.lock();
        });

        controls.addEventListener('lock', () => {
            uiContainer.style.display = 'none';
            crosshair.style.display = 'block';
        });

        controls.addEventListener('unlock', () => {
            uiContainer.style.display = 'flex';
            crosshair.style.display = 'none';
            document.getElementById('instructions-pc').style.display = 'block';
            document.getElementById('device-selection').style.display = 'none';
        });

        scene.add(controls.getObject());

        // Setup movement keys
        document.addEventListener('keydown', (event) => {
            switch (event.code) {
                case 'ArrowUp': case 'KeyW': moveForward = true; break;
                case 'ArrowLeft': case 'KeyA': moveLeft = true; break;
                case 'ArrowDown': case 'KeyS': moveBackward = true; break;
                case 'ArrowRight': case 'KeyD': moveRight = true; break;
            }
        });

        document.addEventListener('keyup', (event) => {
            switch (event.code) {
                case 'ArrowUp': case 'KeyW': moveForward = false; break;
                case 'ArrowLeft': case 'KeyA': moveLeft = false; break;
                case 'ArrowDown': case 'KeyS': moveBackward = false; break;
                case 'ArrowRight': case 'KeyD': moveRight = false; break;
            }
        });
    } else {
        // 4b. Mobile Controls setup
        // Set up Nipple.js joystick
        const joystickZone = document.getElementById('joystick-zone');
        const manager = nipplejs.create({
            zone: joystickZone,
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'white'
        });

        manager.on('move', (evt, data) => {
            const forward = data.vector.y;
            const turn = data.vector.x;

            // Map joystick vector to our movement flags
            if (forward > 0.5) { moveForward = true; moveBackward = false; }
            else if (forward < -0.5) { moveBackward = true; moveForward = false; }
            else { moveForward = false; moveBackward = false; }

            if (turn > 0.5) { moveRight = true; moveLeft = false; }
            else if (turn < -0.5) { moveLeft = true; moveRight = false; }
            else { moveLeft = false; moveRight = false; }
        });

        manager.on('end', () => {
            moveForward = false;
            moveBackward = false;
            moveLeft = false;
            moveRight = false;
        });

        // Touch Look Controls
        const lookZone = document.getElementById('look-zone');
        let isDragging = false;
        let previousTouch = null;

        lookZone.addEventListener('touchstart', (e) => {
            isDragging = true;
            previousTouch = e.touches[0];
        });

        lookZone.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const touch = e.touches[0];
            const movementX = touch.clientX - previousTouch.clientX;
            const movementY = touch.clientY - previousTouch.clientY;

            // Adjust sensitivity
            const sensitivity = 0.005;
            camera.rotation.y -= movementX * sensitivity;
            camera.rotation.x -= movementY * sensitivity;

            // Clamp pitch to prevent flipping
            camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));

            previousTouch = touch;
            e.preventDefault(); // Prevent scrolling
        }, { passive: false });

        lookZone.addEventListener('touchend', () => {
            isDragging = false;
            previousTouch = null;
        });
    }

    // 5. Lighting
    // Brighten the room overall with a HemisphereLight
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2.0); // Sky color, ground color, intensity
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    // Increase ambient light for better base visibility
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); // Bright white ambient
    scene.add(ambientLight);

    // Central bright point light
    const mainLight = new THREE.PointLight(0xfffae6, 3.0, 100); // Warm bright white
    mainLight.position.set(0, 12, 0);
    mainLight.castShadow = true;
    scene.add(mainLight);

    // 6. Build the Museum (Floor & Walls)
    buildRoom();

    // 7. Add 2D Art Gallery to the walls
    build2DGalleryWall();

    // 8. Add Pedestals and 3D Model placeholders
    build3DExhibition();

    // 9. Load VRM Avatar and Animation
    loadVRMAvatar();

    // Handle window resize
    window.addEventListener('resize', onWindowResize);

    // Start animation loop once initialized
    animate();
}

function loadVRMAvatar() {
    const loader = new GLTFLoader();

    // Install VRMLoaderPlugin
    loader.register((parser) => {
        return new VRMLoaderPlugin(parser);
    });

    loader.load(
        'models/Goi3D.vrm',
        (gltf) => {
            const vrm = gltf.userData.vrm;
            if (!vrm) return;

            // Look away from the camera
            vrm.scene.rotation.y = Math.PI;

            currentVrm = vrm;
            scene.add(vrm.scene);

            // Add camera target for 3rd person chase cam
            cameraTarget.position.set(0, 1.5, -3); // Behind and slightly above character
            vrm.scene.add(cameraTarget);

            // Create mixer once
            mixer = new THREE.AnimationMixer(currentVrm.scene);

            // Load idle animation
            loadMixamoAnimation('models/idle.fbx', currentVrm).then((clip) => {
                const action = mixer.clipAction(clip);
                animActions['idle'] = action;
                action.play();
                currentAnimName = 'idle';
            });
            // Load walk animation
            loadMixamoAnimation('models/Walking.fbx', currentVrm).then((clip) => {
                const action = mixer.clipAction(clip);
                animActions['walk'] = action;
            });
        },
        // Progress
        (progress) => console.log('Loading VRM...', 100.0 * (progress.loaded / progress.total), '%'),
        // Error
        (error) => console.error(error)
    );
}


function buildRoom() {
    // Floor
    const floorGeo = new THREE.PlaneGeometry(roomSize, roomSize);
    const floorMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a24,
        roughness: 0.1, // Shiny floor
        metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Grid helper on floor to make it look cool/cyberpunk
    const gridHelper = new THREE.GridHelper(roomSize, 40, 0x333344, 0x111116);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Walls
    const wallGeo = new THREE.PlaneGeometry(roomSize, wallHeight);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.9 });

    const wallsData = [
        { rotY: 0, posZ: -roomSize / 2 }, // North Wall
        { rotY: Math.PI, posZ: roomSize / 2 }, // South Wall
        { rotY: Math.PI / 2, posX: -roomSize / 2 }, // West Wall
        { rotY: -Math.PI / 2, posX: roomSize / 2 } // East Wall
    ];

    wallsData.forEach(data => {
        const wall = new THREE.Mesh(wallGeo, wallMat);
        if (data.rotY) wall.rotation.y = data.rotY;
        if (data.posZ) wall.position.z = data.posZ;
        if (data.posX) wall.position.x = data.posX;
        wall.position.y = wallHeight / 2;
        wall.receiveShadow = true;
        scene.add(wall);
    });
}

let galleryFrames = [];
let currentGalleryIndex = 0;
let lastGalleryUpdateTime = 0;
const textureLoader = new THREE.TextureLoader();

function build2DGalleryWall() {
    const cols = 5;
    const rows = 2;
    const framesPerWall = cols * rows; // 10 per wall
    const totalFrames = Math.min(framesPerWall * 4, imageList.length); // 40 frames max
    if (totalFrames === 0) return;

    const usableLength = roomSize - 10; // padding from corners
    const rowHeights = [7, 3]; // top row, bottom row (Y positions)

    // Wall definitions
    const wallDefs = [
        { wallIndex: 0, rotY: 0 },         // North
        { wallIndex: 1, rotY: -Math.PI / 2 }, // East
        { wallIndex: 2, rotY: Math.PI },    // South
        { wallIndex: 3, rotY: Math.PI / 2 }  // West
    ];

    let frameIndex = 0;
    for (let w = 0; w < 4; w++) {
        const def = wallDefs[w];
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                if (frameIndex >= totalFrames) break;

                const frameGeo = new THREE.BoxGeometry(1, 1, 0.2);
                const frameMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5 });
                const frame = new THREE.Mesh(frameGeo, frameMat);

                const imgGeo = new THREE.PlaneGeometry(1, 1);
                const imgMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
                const imgPlane = new THREE.Mesh(imgGeo, imgMat);

                imgPlane.position.z = 0.11;
                frame.add(imgPlane);

                // Horizontal position along the wall
                const t = (cols === 1) ? 0 : (col / (cols - 1)) * usableLength - usableLength / 2;
                const posY = rowHeights[row];

                let posX = 0, posZ = 0;
                if (w === 0) { // North Wall
                    posX = t;
                    posZ = -roomSize / 2 + 0.2;
                } else if (w === 1) { // East Wall
                    posX = roomSize / 2 - 0.2;
                    posZ = t;
                } else if (w === 2) { // South Wall
                    posX = -t;
                    posZ = roomSize / 2 - 0.2;
                } else { // West Wall
                    posX = -roomSize / 2 + 0.2;
                    posZ = -t;
                }

                frame.position.set(posX, posY, posZ);
                frame.rotation.y = def.rotY;
                frame.castShadow = true;

                // Spotlight (one per column, only on top row to avoid duplicates)
                if (row === 0) {
                    const spotLight = new THREE.SpotLight(0xffffee, 5.0, 20, Math.PI / 4, 0.4, 1);
                    if (w === 0) spotLight.position.set(posX, 12, posZ + 5);
                    if (w === 1) spotLight.position.set(posX - 5, 12, posZ);
                    if (w === 2) spotLight.position.set(posX, 12, posZ - 5);
                    if (w === 3) spotLight.position.set(posX + 5, 12, posZ);
                    spotLight.target = frame;
                    scene.add(spotLight);
                }

                scene.add(frame);
                galleryFrames.push({ frame, imgPlane });
                frameIndex++;
            }
        }
    }

    updateGalleryImages();
    lastGalleryUpdateTime = performance.now();
}

function updateGalleryImages() {
    if (imageList.length === 0 || galleryFrames.length === 0) return;
    const usableLength = roomSize - 4;
    const maxImageWidth = (usableLength / 5) * 0.8; // 80% of per-column spacing

    for (let i = 0; i < galleryFrames.length; i++) {
        let imageSrc = imageList[(currentGalleryIndex + i) % imageList.length];

        textureLoader.load(imageSrc, (texture) => {
            const frameObj = galleryFrames[i];
            const imgAspect = texture.image.width / texture.image.height;

            let planeHeight = 3.0;
            let planeWidth = planeHeight * imgAspect;

            if (planeWidth > maxImageWidth) {
                planeWidth = maxImageWidth;
                planeHeight = planeWidth / imgAspect;
            }

            // Adjust scale of the geometries based on aspect ratio
            frameObj.frame.scale.set(planeWidth + 0.4, planeHeight + 0.4, 1);
            frameObj.imgPlane.scale.set(planeWidth / (planeWidth + 0.4), planeHeight / (planeHeight + 0.4), 1);

            if (frameObj.imgPlane.material.map) {
                frameObj.imgPlane.material.map.dispose();
            }

            frameObj.imgPlane.material.map = texture;
            frameObj.imgPlane.material.needsUpdate = true;
            if (imageSrc.toLowerCase().endsWith('.png')) {
                frameObj.imgPlane.material.transparent = true;
            } else {
                frameObj.imgPlane.material.transparent = false;
            }
        }, undefined, (err) => {
            console.error('Error loading texture:', imageSrc, err);
        });
    }

    currentGalleryIndex = (currentGalleryIndex + galleryFrames.length) % imageList.length;
}

function build3DExhibition() {
    // Array to hold our spinning placeholders so we can animate them
    window.spinningModels = [];

    const placements = [
        { x: -8, z: 0, color: 0xff3366, type: 'crystal' },
        { x: 0, z: -8, color: 0x00c6ff, type: 'torus' },
        { x: 8, z: 0, color: 0xccff00, type: 'sphere' }
    ];

    placements.forEach(pos => {
        // Pedestal
        const pedGeo = new THREE.CylinderGeometry(1, 1, 2, 32);
        const pedMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.2,
            metalness: 0.8
        });
        const pedestal = new THREE.Mesh(pedGeo, pedMat);
        pedestal.position.set(pos.x, 1, pos.z);
        pedestal.receiveShadow = true;
        pedestal.castShadow = true;
        scene.add(pedestal);

        // Highlight for pedestal
        const pedLight = new THREE.PointLight(pos.color, 1, 8);
        pedLight.position.set(pos.x, 3, pos.z);
        scene.add(pedLight);

        // --- PLACEHOLDER PRIMITIVE FOR 3D ART ---
        // This is where you will load your FBX or OBJ files!
        /* 
        const loader = new FBXLoader();
        loader.load( 'path/to/your/model.fbx', function ( object ) {
            object.position.set(pos.x, 2.5, pos.z);
            object.scale.set(0.01, 0.01, 0.01); // Adjust scale!
            scene.add( object );
            window.spinningModels.push(object); // Optional: if you want it to spin
        }); 
        */

        // Generating a cool stylized primitive instead
        let placeholderGeo;
        if (pos.type === 'crystal') {
            placeholderGeo = new THREE.IcosahedronGeometry(1, 0);
        } else if (pos.type === 'torus') {
            placeholderGeo = new THREE.TorusGeometry(0.7, 0.2, 16, 100);
        } else {
            placeholderGeo = new THREE.SphereGeometry(1, 32, 32);
        }

        const placeholderMat = new THREE.MeshPhysicalMaterial({
            color: pos.color,
            metalness: 0.9,
            roughness: 0.1,
            clearcoat: 1.0,
            clearcoatRoughness: 0.1
        });

        const placeholder = new THREE.Mesh(placeholderGeo, placeholderMat);
        placeholder.position.set(pos.x, 3.5, pos.z);
        placeholder.castShadow = true;

        scene.add(placeholder);
        window.spinningModels.push(placeholder);
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    // Update the animation mixer
    if (mixer) {
        mixer.update(delta);
    }

    // Update VRM (for physics like hair/clothes if applicable)
    if (currentVrm) {
        currentVrm.update(delta);
    }

    // VRM Character Movement Logic
    if (currentVrm) {
        let isMoving = false;
        const speed = 3.0; // Reduced from 8.0 for a slower, realistic walking pace

        // Reset velocity explicitly for direct input application
        velocity.set(0, 0, 0);

        if (!isMobileMode && controls.isLocked === true) {
            if (moveForward || moveBackward || moveLeft || moveRight) isMoving = true;

            // Determine local movement direction
            direction.z = Number(moveBackward) - Number(moveForward); // Z generally points "back" in ThreeJS, so Forward is -Z
            direction.x = Number(moveRight) - Number(moveLeft);
            direction.normalize();

            if (isMoving) {
                velocity.z = direction.z * speed * delta;
                velocity.x = direction.x * speed * delta;
            }

        } else if (isMobileMode) {
            if (moveForward || moveBackward || moveLeft || moveRight) isMoving = true;

            direction.z = Number(moveBackward) - Number(moveForward);
            direction.x = Number(moveRight) - Number(moveLeft);
            direction.normalize();

            if (isMoving) {
                velocity.z = direction.z * speed * delta;
                velocity.x = direction.x * speed * delta;
            }
        }

        if (isMoving) {
            // 1. Calculate the movement vector relative to the Camera's Y rotation
            // We use atan2(x, z) where z is Forward (-1) or Backward (1), x is Left (-1) or Right (1)
            // Note that in ThreeJS, -Z is forward.
            // Our direct inputs are:
            // W -> moveForward -> direction.z = -1
            // S -> moveBackward -> direction.z = 1
            // A -> moveLeft -> direction.x = -1
            // D -> moveRight -> direction.x = 1

            // The absolute heading of the movement in LOCAL space relative to the camera
            // atan2(x, z) expects x, y. By providing (direction.x, direction.z), it gives us the angle
            // 0 is +Z (Back), PI is -Z (Forward), PI/2 is +X (Right), -PI/2 is -X (Left)
            const moveAngle = Math.atan2(direction.x, direction.z);

            // The world-space rotation angle the character should move towards
            const cameraY = camera.rotation.y;
            // The final angle is the camera's Y plus the movement angle offset
            const targetRotation = cameraY + moveAngle;

            // 2. Rotate character smoothly towards the target rotation
            // We use lerp to make it look natural instead of instantly snapping

            // Handle edge case where rotation wraps around -PI to PI
            let currentY = currentVrm.scene.rotation.y;
            let diff = targetRotation - currentY;
            // Normalize difference to [-PI, PI]
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;

            currentVrm.scene.rotation.y += diff * 10 * delta; // Turn speed

            // 3. Move the character in World Space based on the calculated rotation
            // We know the velocity magnitude, just move forward along the targetRotation angle
            const moveSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);

            // Math.sin / Math.cos uses math standards where +X is 0 degrees, but ThreeJS rotation Y is flipped
            currentVrm.scene.position.x += Math.sin(targetRotation) * moveSpeed;
            currentVrm.scene.position.z += Math.cos(targetRotation) * moveSpeed;
        }

        applyCollision(currentVrm.scene.position);

        // Handle Animation Blending
        if (isMoving && currentAnimName !== 'walk' && animActions['walk']) {
            const nextAction = animActions['walk'];
            const prevAction = animActions['idle'];
            if (prevAction) {
                nextAction.reset().play();
                prevAction.crossFadeTo(nextAction, 0.2, true);
            } else {
                nextAction.play();
            }
            currentAnimName = 'walk';
        } else if (!isMoving && currentAnimName !== 'idle' && animActions['idle']) {
            const nextAction = animActions['idle'];
            const prevAction = animActions['walk'];
            if (prevAction) {
                nextAction.reset().play();
                prevAction.crossFadeTo(nextAction, 0.2, true);
            } else {
                nextAction.play();
            }
            currentAnimName = 'idle';
        }

        // Third Person Camera Follow ensuring character is always perfectly centered
        const distance = 3.0;
        const heightOffset = 1.0;

        const cameraDir = new THREE.Vector3();
        camera.getWorldDirection(cameraDir);

        // Center the target on the character's torso
        const targetPosition = currentVrm.scene.position.clone();
        targetPosition.y += heightOffset;

        // Push camera back exactly along its looking direction so character is centered
        targetPosition.addScaledVector(cameraDir, -distance);

        // Hard copy for perfect centering (prevents drifting out of frame during mouse rotation)
        camera.position.copy(targetPosition);
    }

    function applyCollision(pos) {
        // Prevent walking outside boundaries
        const boundary = (roomSize / 2) - 2;
        if (pos.x < -boundary) pos.x = -boundary;
        if (pos.x > boundary) pos.x = boundary;
        if (pos.z < -boundary) pos.z = -boundary;
        if (pos.z > boundary) pos.z = boundary;
    }

    // Update 2D Gallery Images every 5 seconds
    if (time - lastGalleryUpdateTime > 5000) {
        if (typeof updateGalleryImages === 'function') {
            updateGalleryImages();
        }
        lastGalleryUpdateTime = time;
    }

    // Spin the 3D placeholder models
    if (window.spinningModels) {
        window.spinningModels.forEach((model, index) => {
            model.rotation.y += 0.01 + (index * 0.005);
            model.rotation.x += 0.005;
        });
    }

    prevTime = time;
    renderer.render(scene, camera);
}
