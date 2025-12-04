import * as THREE from "https://esm.sh/three@0.151.3";
import { OrbitControls } from "https://esm.sh/three@0.151.3/addons/controls/OrbitControls.js";
import { OutlineEffect } from "https://esm.sh/three@0.151.3/addons/effects/OutlineEffect.js";
import { GLTFLoader } from "https://esm.sh/three@0.151.3/examples/jsm/loaders/GLTFLoader.js";

// ----------- SHADER PARTICLE ----------- 
const _VS = `
uniform float pointMultiplier;
attribute float size;
attribute float angle;
attribute vec4 aColor;
varying vec4 vColor;
varying vec2 vAngle;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = size * pointMultiplier / gl_Position.w;
  vAngle = vec2(cos(angle), sin(angle));
  vColor = aColor;
}`;
const _FS = `
uniform sampler2D diffuseTexture;
varying vec4 vColor;
varying vec2 vAngle;
void main() {
  vec2 coords = (gl_PointCoord - 0.5) * mat2(vAngle.x, vAngle.y, -vAngle.y, vAngle.x) + 0.5;
  gl_FragColor = texture2D(diffuseTexture, coords) * vColor;
}`;

// ----------- PARTICLE SYSTEM ----------- 
function getLinearSpline(lerp){
  const points=[];
  function addPoint(t,d){ points.push([t,d]); }
  function getValueAt(t){
    let p1=0;
    for(let i=0;i<points.length;i++){ if(points[i][0]>=t) break; p1=i; }
    const p2=Math.min(points.length-1,p1+1);
    if(p1==p2) return points[p1][1];
    return lerp((t-points[p1][0])/(points[p2][0]-points[p1][0]), points[p1][1], points[p2][1]);
  }
  return { addPoint, getValueAt };
}

function getParticleSystem(params){
  const {camera, emitter, parent, rate, texture}=params;
  const uniforms={
    diffuseTexture:{value:new THREE.TextureLoader().load(texture)},
    pointMultiplier:{value: window.innerHeight/(2*Math.tan(30*Math.PI/180))}
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader:_VS, fragmentShader:_FS,
    blending:THREE.AdditiveBlending, depthTest:true, depthWrite:false, transparent:true, vertexColors:true
  });

  let particles=[];
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([],3));
  geometry.setAttribute('size', new THREE.Float32BufferAttribute([],1));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute([],4));
  geometry.setAttribute('angle', new THREE.Float32BufferAttribute([],1));
  const points = new THREE.Points(geometry, material);
  parent.add(points);

  const alphaSpline = getLinearSpline((t,a,b)=>a+t*(b-a));
  alphaSpline.addPoint(0,0); alphaSpline.addPoint(0.6,1); alphaSpline.addPoint(1,0);
  const colorSpline = getLinearSpline((t,a,b)=>a.clone().lerp(b,t));
  colorSpline.addPoint(0,new THREE.Color(0xFFFFFF));
  colorSpline.addPoint(1,new THREE.Color(0xff8080));
  const sizeSpline = getLinearSpline((t,a,b)=>a+t*(b-a));
  sizeSpline.addPoint(0,0); sizeSpline.addPoint(1,1);

  const radius=0.5, maxLife=1.5, maxSize=3;
  let accumulator=0;

  function _AddParticles(timeElapsed){
    accumulator+=timeElapsed;
    const n=Math.floor(accumulator*rate);
    accumulator-=n/rate;
    for(let i=0;i<n;i++){
      const life=(Math.random()*0.75+0.25)*maxLife;
      particles.push({
        position: new THREE.Vector3((Math.random()*1.5-1)*radius,(Math.random()*0.125-1)*radius,(Math.random()*1.5-1)*radius).add(emitter.position),
        size:(Math.random()*0.5+0.5)*maxSize, colour:new THREE.Color(), alpha:1, life, maxLife:life,
        rotation:Math.random()*2*Math.PI, rotationRate:Math.random()*0.01-0.005,
        velocity:new THREE.Vector3(0,1.5,0)
      });
    }
  }

  function _UpdateGeometry(){
    const positions=[],sizes=[],colours=[],angles=[];
    for(let p of particles){
      positions.push(p.position.x,p.position.y,p.position.z);
      sizes.push(p.currentSize); angles.push(p.rotation);
      colours.push(p.colour.r,p.colour.g,p.colour.b,p.alpha);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes,1));
    geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colours,4));
    geometry.setAttribute('angle', new THREE.Float32BufferAttribute(angles,1));
    geometry.attributes.position.needsUpdate=true;
    geometry.attributes.size.needsUpdate=true;
    geometry.attributes.aColor.needsUpdate=true;
    geometry.attributes.angle.needsUpdate=true;
  }

  function _UpdateParticles(timeElapsed){
    for(let p of particles) p.life-=timeElapsed;
    particles=particles.filter(p=>p.life>0);
    for(let p of particles){
      const t=1-p.life/p.maxLife;
      p.rotation+=p.rotationRate;
      p.alpha=alphaSpline.getValueAt(t);
      p.currentSize=p.size*sizeSpline.getValueAt(t);
      p.colour.copy(colorSpline.getValueAt(t));
      p.position.add(p.velocity.clone().multiplyScalar(timeElapsed));
      const drag=p.velocity.clone().multiplyScalar(timeElapsed*0.1);
      drag.x=Math.sign(p.velocity.x)*Math.min(Math.abs(drag.x),Math.abs(p.velocity.x));
      drag.y=Math.sign(p.velocity.y)*Math.min(Math.abs(drag.y),Math.abs(p.velocity.y));
      drag.z=Math.sign(p.velocity.z)*Math.min(Math.abs(drag.z),Math.abs(p.velocity.z));
      p.velocity.sub(drag);
    }
    particles.sort((a,b)=>camera.position.distanceTo(b.position)-camera.position.distanceTo(a.position));
  }

  function update(timeElapsed){ _AddParticles(timeElapsed); _UpdateParticles(timeElapsed); _UpdateGeometry(); }
  return { update };
}

// ----------- SCENE SETUP ----------- 
const canvas=document.querySelector('canvas.webgl');
const scene=new THREE.Scene();
const gltfLoader=new GLTFLoader();
const textureLoader=new THREE.TextureLoader();
const sizes={ width:window.innerWidth, height:window.innerHeight };
const camera=new THREE.PerspectiveCamera(10, sizes.width/sizes.height, 0.1, 1000);
const controls=new OrbitControls(camera, canvas);
const minPan=new THREE.Vector3(-5,-2,-5), maxPan=new THREE.Vector3(5,2,5);
let clock=new THREE.Clock();
const renderer=new THREE.WebGLRenderer({canvas, alpha:true, antialias:true});
const effect=new OutlineEffect(renderer, {defaultThickness:0.0014, defaultColor:new THREE.Color(0x202020).toArray()});
renderer.setSize(sizes.width, sizes.height);

// ----------- MATERIALS ----------- 
const bakedTexture = textureLoader.load('https://rawcdn.githack.com/ricardoolivaalonso/threejs-journey01/e3cfc35a8270972a21435ad885da2bab54ec2d11/baked.jpg');
bakedTexture.flipY=false;
const bakedMaterial = new THREE.MeshStandardMaterial({map:bakedTexture, side:THREE.DoubleSide, roughness:0.5});
const snowMaterial = new THREE.MeshPhysicalMaterial({color:0xeeeeee, roughness:0.6, metalness:0.1, reflectivity:0.75});
const windowMaterial = new THREE.MeshBasicMaterial({color:0xFFDCC2, side:THREE.DoubleSide});
const neonBaseMaterial = new THREE.MeshStandardMaterial({emissive:0xffffff, side:THREE.DoubleSide});
const neonMaterial = new THREE.ShaderMaterial({
  uniforms:{time:{value:1}, delay:{value:1}, colorSpeed:{value:5}, baseColor:{value:new THREE.Color(0xaa00ff)}, finalColor:{value:new THREE.Color(0xffccff)}},
  vertexShader: document.getElementById('vertexshaderCandle').textContent,
  fragmentShader: document.getElementById('fragmentshaderCandle').textContent
});
const neonMaterial2 = new THREE.ShaderMaterial({
  uniforms:{time:{value:1}, delay:{value:1}, colorSpeed:{value:5}, baseColor:{value:new THREE.Color(0xe39f9f)}, finalColor:{value:new THREE.Color(0xffffff)}},
  vertexShader: document.getElementById('vertexshaderCandle').textContent,
  fragmentShader: document.getElementById('fragmentshaderCandle').textContent
});
const fireMaterial = new THREE.MeshPhongMaterial({color:0xffdab9, side:THREE.DoubleSide});
fireMaterial.userData.outlineParameters={thickness:0};

// ----------- FIRE EMITTER ----------- 
const cube = new THREE.Mesh(new THREE.BoxGeometry(1,.01,.5), new THREE.MeshStandardMaterial({color:0xffffff}));
cube.position.set(0.1,-2.2,-1.6);
scene.add(cube);
const fireEffect = getParticleSystem({camera, emitter:cube, parent:scene, rate:200, texture:'https://rawcdn.githack.com/ricardoolivaalonso/threejs-journey01/e3cfc35a8270972a21435ad885da2bab54ec2d11/fire.png'});

let treeSmall, treeBig;

const treeModels = [
  { scale: 1.5, pos: new THREE.Vector3(2, -2.2, -1), rate: 80 },   // cây nhỏ bên phải
  { scale: 3, pos: new THREE.Vector3(-2, -2.2, -1), rate: 150 }    // cây bự bên trái
];

treeModels.forEach((t, i) => {
  gltfLoader.load('./models/christmas_tree.glb', (gltf) => {
    const obj = gltf.scene;
    scene.add(obj);
    obj.scale.set(t.scale, t.scale, t.scale);

    const box = new THREE.Box3().setFromObject(obj);
    const minY = box.min.y;
    obj.position.y += t.pos.y - minY;
    obj.position.x = t.pos.x;
    obj.position.z = t.pos.z;

    // particle emitter đặt gần tán cây
    const lightEmitter = new THREE.Object3D();
    lightEmitter.position.y = box.max.y * 0.8;
    obj.add(lightEmitter);

    obj.userData.lightsEffect = getParticleSystem({
      camera,
      emitter: lightEmitter,
      parent: obj,
      rate: t.rate,
      texture: 'https://rawcdn.githack.com/ricardoolivaalonso/threejs-journey01/e3cfc35a8270972a21435ad885da2bab54ec2d11/fire.png'
    });

    if(i===0) treeSmall = obj;
    else treeBig = obj;
  });
});

// ---------- tick() update particle lights ----------
function tick(){
  requestAnimationFrame(tick);
  const delta = clock.getDelta();

  mixers.forEach(m=>m.update(delta));
  neonMaterial.uniforms.time.value += 0.075;
  neonMaterial2.uniforms.time.value += 0.09;
  fireEffect.update(delta);

  if(treeSmall && treeSmall.userData.lightsEffect)
    treeSmall.userData.lightsEffect.update(delta);
  if(treeBig && treeBig.userData.lightsEffect)
    treeBig.userData.lightsEffect.update(delta);

  controls.update();
  controls.target.clamp(minPan, maxPan);
  renderer.render(scene, camera);
  effect.render(scene, camera);
}

// ----------- LIGHTS & CAMERA ----------- 
function getLights(){
  const amb = new THREE.AmbientLight("#ffffff",0.9); scene.add(amb);
  const dir = new THREE.DirectionalLight('#ffffff'); scene.add(dir); dir.position.set(-2,5,0); dir.intensity=0.35;
}
function getControls(){
  controls.enableDamping=true; controls.enableZoom=true; controls.enablePan=false;
  controls.minPolarAngle=Math.PI/5; controls.maxPolarAngle=Math.PI/2;
  if(sizes.width<768){controls.minDistance=18;controls.maxDistance=35;}else{controls.minDistance=20;controls.maxDistance=47;}
}
function getCamera(){
  camera.fov = sizes.width<768?22:10; camera.aspect=sizes.width/sizes.height; camera.updateProjectionMatrix();
  if(sizes.width<768){camera.position.set(15,8,25);}else{camera.position.set(35,8,36);} scene.add(camera);
}

// ----------- MODELS ----------- 
let mixers = [];
function getModels(){
  // model chính
  gltfLoader.load('https://rawcdn.githack.com/ricardoolivaalonso/threejs-journey01/e3cfc35a8270972a21435ad885da2bab54ec2d11/model.glb', (gltf)=>{
    gltf.scene.traverse(c=>{ if(c.material) c.material=bakedMaterial; });
    scene.add(gltf.scene);
    gltf.scene.position.set(0,-.3,0);
  });

  // model 2
  gltfLoader.load('https://rawcdn.githack.com/ricardoolivaalonso/threejs-journey01/e3cfc35a8270972a21435ad885da2bab54ec2d11/model2.glb', (gltf)=>{
    gltf.scene.traverse(c=>{
      if(c.material){
        if(c.material.name==='GiftBox'||c.name.toLowerCase().includes('gift')) c.material=new THREE.MeshPhysicalMaterial({color:0xffff00, roughness:0.5, metalness:0.3, reflectivity:0.7, side:THREE.DoubleSide});
        if(c.material.name=='SnowSimple') c.material=snowMaterial;
        if(c.material.name=='Window') c.material=windowMaterial;
        if(c.material.name=='NeonBase') c.material=neonBaseMaterial;
        if(c.material.name=='Neon.001') c.material=neonMaterial2;
        if(c.material.name=='Neon') c.material=neonMaterial;
        if(c.material.name=='Fire') c.material=fireMaterial;
      }
    });
    const mixerTemp = new THREE.AnimationMixer(gltf.scene);
    gltf.animations.forEach(clip => mixerTemp.clipAction(clip).play());
    mixers.push(mixerTemp);
    scene.add(gltf.scene);
    gltf.scene.position.set(0,-.3,0);
  });

 // ============ TẠO NGƯỜI TUYẾT GÓC TRÁI ============

// Nhóm chứa toàn bộ người tuyết
const snowman = new THREE.Group();

// --- Thân dưới ---
const bodyGeom = new THREE.SphereGeometry(0.35, 32, 32);
const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
const body = new THREE.Mesh(bodyGeom, whiteMat);
body.position.set(0, 0.35, 0);
snowman.add(body);

// --- Thân giữa ---
const midGeom = new THREE.SphereGeometry(0.25, 32, 32);
const mid = new THREE.Mesh(midGeom, whiteMat);
mid.position.set(0, 0.75, 0);
snowman.add(mid);

// --- Đầu ---
const headGeom = new THREE.SphereGeometry(0.18, 32, 32);
const head = new THREE.Mesh(headGeom, whiteMat);
head.position.set(0, 1.05, 0);
snowman.add(head);

// --- Mắt ---
const eyeGeom = new THREE.SphereGeometry(0.02, 16, 16);
const blackMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
const eye1 = new THREE.Mesh(eyeGeom, blackMat);
const eye2 = new THREE.Mesh(eyeGeom, blackMat);
eye1.position.set(0.06, 1.08, 0.15);
eye2.position.set(-0.06, 1.08, 0.15);
snowman.add(eye1, eye2);

// --- Mũi (cà rốt) ---
const noseGeom = new THREE.ConeGeometry(0.03, 0.15, 16);
const orangeMat = new THREE.MeshStandardMaterial({ color: 0xff6600 });
const nose = new THREE.Mesh(noseGeom, orangeMat);
nose.position.set(0, 1.05, 0.18);
nose.rotation.x = Math.PI / 2;
snowman.add(nose);

// --- Mũ ---
const hatTopGeom = new THREE.CylinderGeometry(0.15, 0.15, 0.25, 32);
const hatBrimGeom = new THREE.CylinderGeometry(0.22, 0.22, 0.05, 32);
const redMat = new THREE.MeshStandardMaterial({ color: 0xaa0000 });

const hatTop = new THREE.Mesh(hatTopGeom, redMat);
const hatBrim = new THREE.Mesh(hatBrimGeom, redMat);

hatTop.position.set(0, 1.28, 0);
hatBrim.position.set(0, 1.18, 0);

snowman.add(hatTop, hatBrim);

// --- Vị trí tổng thể (góc trái) ---
snowman.position.set(-1.5, -0.3, 0);  // << CHỈNH Ở ĐÂY ĐỂ ĐẶT VỊ TRÍ
snowman.scale.set(0.9, 0.9, 0.9);      // vừa kích thước không che gấu

// Thêm vào scene
scene.add(snowman);

}


// ----------- ANIMATION LOOP ----------- 
function tick(){
  requestAnimationFrame(tick);
  const delta = clock.getDelta();
  mixers.forEach(m=>m.update(delta));
  neonMaterial.uniforms.time.value += 0.075;
  neonMaterial2.uniforms.time.value += 0.09;
  fireEffect.update(0.016);
  if(tree && tree.userData.lightsEffect) tree.userData.lightsEffect.update(0.016);
  controls.update();
  controls.target.clamp(minPan, maxPan);
  renderer.render(scene, camera);
  effect.render(scene, camera);
}

// ----------- WINDOW RESIZE ----------- 
window.addEventListener('resize', ()=>{
  sizes.width=window.innerWidth; sizes.height=window.innerHeight;
  camera.aspect = sizes.width/sizes.height; camera.updateProjectionMatrix();
  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  getControls(); getCamera();
});

// ----------- INIT ----------- 
getModels(); getLights(); getControls(); getCamera(); tick();
