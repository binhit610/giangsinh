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
function getLinearSpline(lerp) {
  const points = [];
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
  const uniforms = {
    diffuseTexture:{ value:new THREE.TextureLoader().load(texture) },
    pointMultiplier:{ value: window.innerHeight/(2*Math.tan(30*Math.PI/180)) }
  };
  const _material=new THREE.ShaderMaterial({
    uniforms, vertexShader:_VS, fragmentShader:_FS,
    blending:THREE.AdditiveBlending, depthTest:true, depthWrite:false, transparent:true, vertexColors:true
  });
  let _particles=[];
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([],3));
  geometry.setAttribute('size', new THREE.Float32BufferAttribute([],1));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute([],4));
  geometry.setAttribute('angle', new THREE.Float32BufferAttribute([],1));
  const _points=new THREE.Points(geometry,_material);
  parent.add(_points);

  const alphaSpline=getLinearSpline((t,a,b)=>a+t*(b-a));
  alphaSpline.addPoint(0,0); alphaSpline.addPoint(0.6,1); alphaSpline.addPoint(1,0);
  const colorSpline=getLinearSpline((t,a,b)=>a.clone().lerp(b,t));
  colorSpline.addPoint(0,new THREE.Color(0xFFFFFF));
  colorSpline.addPoint(1,new THREE.Color(0xff8080));
  const sizeSpline=getLinearSpline((t,a,b)=>a+t*(b-a));
  sizeSpline.addPoint(0,0); sizeSpline.addPoint(1,1);

  const radius=0.5, maxLife=1.5, maxSize=3;
  let accumulator=0;
  function _AddParticles(timeElapsed){
    accumulator+=timeElapsed;
    const n=Math.floor(accumulator*rate);
    accumulator-=n/rate;
    for(let i=0;i<n;i++){
      const life=(Math.random()*0.75+0.25)*maxLife;
      _particles.push({
        position: new THREE.Vector3((Math.random()*1.5-1)*radius,(Math.random()*0.125-1)*radius,(Math.random()*1.5-1)*radius).add(emitter.position),
        size:(Math.random()*0.5+0.5)*maxSize, colour:new THREE.Color(), alpha:1, life, maxLife:life,
        rotation:Math.random()*2*Math.PI, rotationRate:Math.random()*0.01-0.005,
        velocity:new THREE.Vector3(0,1.5,0)
      });
    }
  }
  function _UpdateGeometry(){
    const positions=[],sizes=[],colours=[],angles=[];
    for(let p of _particles){
      positions.push(p.position.x,p.position.y,p.position.z);
      sizes.push(p.currentSize); angles.push(p.rotation);
      colours.push(p.colour.r,p.colour.g,p.colour.b,p.alpha);
    }
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('size',new THREE.Float32BufferAttribute(sizes,1));
    geometry.setAttribute('aColor',new THREE.Float32BufferAttribute(colours,4));
    geometry.setAttribute('angle',new THREE.Float32BufferAttribute(angles,1));
    geometry.attributes.position.needsUpdate=true;
    geometry.attributes.size.needsUpdate=true;
    geometry.attributes.aColor.needsUpdate=true;
    geometry.attributes.angle.needsUpdate=true;
  }
  _UpdateGeometry();
  function _UpdateParticles(timeElapsed){
    for(let p of _particles) p.life-=timeElapsed;
    _particles=_particles.filter(p=>p.life>0);
    for(let p of _particles){
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
    _particles.sort((a,b)=>{
      const d1=camera.position.distanceTo(a.position);
      const d2=camera.position.distanceTo(b.position);
      return d2-d1;
    });
  }
  function update(timeElapsed){ _AddParticles(timeElapsed); _UpdateParticles(timeElapsed); _UpdateGeometry(); }
  return { update };
}

// ----------- SCENE SETUP -----------
const canvas = document.querySelector('canvas.webgl');
const scene = new THREE.Scene();
const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();
const sizes = { width: window.innerWidth, height: window.innerHeight };
const camera = new THREE.PerspectiveCamera(10, sizes.width/sizes.height, 0.1, 1000);
const controls = new OrbitControls(camera, canvas);
const minPan = new THREE.Vector3(-5,-2,-5), maxPan = new THREE.Vector3(5,2,5);
let clock = new THREE.Clock(), mixer;
const renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true});
const effect = new OutlineEffect(renderer, {defaultThickness:0.0014,defaultColor:new THREE.Color(0x202020).toArray(),defaultAlpha:1,defaultVisible:true});
renderer.setSize(sizes.width, sizes.height);

// ----------- MATERIALS -----------
const bakedTexture = textureLoader.load('https://rawcdn.githack.com/ricardoolivaalonso/threejs-journey01/e3cfc35a8270972a21435ad885da2bab54ec2d11/baked.jpg'); bakedTexture.flipY=false;
const bakedMaterial = new THREE.MeshStandardMaterial({map:bakedTexture,side:THREE.DoubleSide,roughness:0.5});
const snowMaterial = new THREE.MeshPhysicalMaterial({color:0xeeeeee,roughness:0.6,metalness:0.1,reflectivity:0.75});
const windowMaterial = new THREE.MeshBasicMaterial({color:0xFFDCC2,side:THREE.DoubleSide});
const neonBaseMaterial = new THREE.MeshStandardMaterial({emissive:0xffffff,side:THREE.DoubleSide});
const neonMaterial = new THREE.ShaderMaterial({
  uniforms:{time:{value:1},delay:{value:1},colorSpeed:{value:5},baseColor:{value:new THREE.Color(0xaa00ff)},finalColor:{value:new THREE.Color(0xffccff)}},
  vertexShader: document.getElementById('vertexshaderCandle').textContent,
  fragmentShader: document.getElementById('fragmentshaderCandle').textContent
});
const neonMaterial2 = new THREE.ShaderMaterial({
  uniforms:{time:{value:1},delay:{value:1},colorSpeed:{value:5},baseColor:{value:new THREE.Color(0xe39f9f)},finalColor:{value:new THREE.Color(0xffffff)}},
  vertexShader: document.getElementById('vertexshaderCandle').textContent,
  fragmentShader: document.getElementById('fragmentshaderCandle').textContent
});
const fireMaterial = new THREE.MeshPhongMaterial({color:0xffdab9,side:THREE.DoubleSide}); fireMaterial.userData.outlineParameters={thickness:0};

// ----------- FIRE EMITTER -----------
const cube = new THREE.Mesh(new THREE.BoxGeometry(1,.01,.5),new THREE.MeshStandardMaterial({color:0xffffff}));
cube.position.set(0.1,-2.2,-1.6);
scene.add(cube);
const fireEffect = getParticleSystem({camera,emitter:cube,parent:scene,rate:200,texture:'https://rawcdn.githack.com/ricardoolivaalonso/threejs-journey01/e3cfc35a8270972a21435ad885da2bab54ec2d11/fire.png'});

// ----------- TREE MODEL GLB -----------
let tree;
gltfLoader.load('./models/merry_christmas.glb', (gltf) => {
    tree = gltf.scene;
    tree.scale.set(1.5,1.5,1.5);
    tree.position.set(2,-2.2,-1);
    scene.add(tree);

    const lightEmitter = new THREE.Object3D();
    lightEmitter.position.y = 0;
    tree.add(lightEmitter);

    tree.userData.lightsEffect = getParticleSystem({
        camera,
        emitter: lightEmitter,
        parent: tree,
        rate: 100,
        texture: 'https://rawcdn.githack.com/ricardoolivaalonso/threejs-journey01/e3cfc35a8270972a21435ad885da2bab54ec2d11/fire.png'
    });
});

// ----------- LIGHTS & CONTROLS -----------
const getLights=()=>{ 
  const amb = new THREE.AmbientLight("#ffffff",0.9); scene.add(amb); 
  const dir = new THREE.DirectionalLight('#ffffff'); scene.add(dir); dir.position.set(-2,5,0); dir.intensity=0.35; 
}
const getControls=()=>{ 
  controls.enableDamping=true; controls.enableZoom=true; controls.enablePan=false; 
  controls.minPolarAngle=Math.PI/5; controls.maxPolarAngle=Math.PI/2;
  if(sizes.width<768){controls.minDistance=18;controls.maxDistance=35;}else{controls.minDistance=20;controls.maxDistance=47;} 
}
const getCamera=()=>{ 
  camera.fov = sizes.width<768?22:10; camera.aspect = sizes.width/sizes.height; camera.updateProjectionMatrix(); 
  if(sizes.width<768){camera.position.set(15,8,25);}else{camera.position.set(35,8,36);} scene.add(camera); 
}

// ----------- ANIMATION LOOP -----------
const tick = ()=>{
  window.requestAnimationFrame(tick);
  const delta = clock.getDelta();
  fireEffect.update(0.016);
  if(tree && tree.userData.lightsEffect) tree.userData.lightsEffect.update(0.016);
  controls.update();
  controls.target.clamp(minPan,maxPan);
  renderer.render(scene,camera);
  effect.render(scene,camera);
}

// ----------- WINDOW RESIZE -----------
window.addEventListener('resize',()=>{
  sizes.width=window.innerWidth; sizes.height=window.innerHeight;
  camera.aspect=sizes.width/sizes.height; camera.updateProjectionMatrix();
  renderer.setSize(sizes.width,sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  getControls(); getCamera();
});

// ----------- INIT -----------
getLights(); getControls(); getCamera();
tick();
