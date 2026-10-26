// Ko-Labz 3D: a galaxy of projects (one star system each) and the system view
// where every need is a planet on the minor or major ring.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const MINOR_R = 6, MAJOR_R = 10;
const COL = {
  minor: new THREE.Color('#00d4ff'), major: new THREE.Color('#b06bff'),
  pending: new THREE.Color('#ffb52e'), done: new THREE.Color('#ffffff'), gold: new THREE.Color('#ffd36b')
};

const NOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx; vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_); vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw); vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3))); p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){float f=0.0;float a=0.5;for(int i=0;i<5;i++){f+=a*snoise(p);p*=2.02;a*=0.5;}return f;}
`;

const SURFACE_VERT = /* glsl */`
varying vec3 vPos; varying vec3 vWorld; varying vec3 vNormalW;
void main(){
  vPos = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

function sunMaterial(colorA, colorB) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(colorA) }, uB: { value: new THREE.Color(colorB) }, uHeat: { value: 1.6 } },
    vertexShader: SURFACE_VERT,
    fragmentShader: NOISE + /* glsl */`
      uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform float uHeat;
      varying vec3 vPos; varying vec3 vWorld; varying vec3 vNormalW;
      void main(){
        vec3 p = normalize(vPos);
        float n = fbm(p*2.2 + vec3(uTime*0.04, uTime*0.03, 0.0));
        float g = fbm(p*7.0 - vec3(0.0, uTime*0.09, uTime*0.05));
        float t = clamp(0.55 + n*0.7 + g*0.35, 0.0, 1.0);
        vec3 col = mix(uA, uB, t);
        float spots = smoothstep(0.35, 0.6, g*0.5+0.5);
        col = mix(col, uB*1.4, spots*0.4);
        vec3 V = normalize(cameraPosition - vWorld);
        float rim = pow(1.0 - max(dot(vNormalW, V), 0.0), 2.2);
        col += uB * rim * 1.4;
        gl_FragColor = vec4(col * uHeat, 1.0);
      }`
  });
}

function planetMaterial(seed) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uSeed: { value: seed }, uColor: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() }, uEnergy: { value: 0.4 }, uHover: { value: 0 }
    },
    vertexShader: SURFACE_VERT,
    fragmentShader: NOISE + /* glsl */`
      uniform float uTime; uniform float uSeed; uniform vec3 uColor; uniform vec3 uGlow; uniform float uEnergy; uniform float uHover;
      varying vec3 vPos; varying vec3 vWorld; varying vec3 vNormalW;
      void main(){
        vec3 p = normalize(vPos);
        float warp = fbm(p*2.0 + uSeed);
        float bands = sin(p.y*9.0 + warp*4.0 + uTime*0.15)*0.5 + 0.5;
        float detail = fbm(p*6.0 + uSeed*1.7)*0.5 + 0.5;
        vec3 base = mix(uColor*0.12, uColor*0.85, bands*0.7 + detail*0.3);
        vec3 L = normalize(-vWorld);
        float lambert = max(dot(vNormalW, L), 0.0)*0.85 + 0.15;
        vec3 V = normalize(cameraPosition - vWorld);
        float rim = pow(1.0 - max(dot(vNormalW, V), 0.0), 2.5);
        vec3 col = base*lambert + uGlow*rim*(1.2 + uHover*1.5) + uColor*uEnergy*0.35;
        gl_FragColor = vec4(col, 1.0);
      }`
  });
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const GLOW = glowTexture();

function glowSprite(color, scale, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(scale);
  return s;
}

function arcGeometry(radius, ratio, tube = 0.05) {
  const arc = Math.max(0.0001, ratio) * Math.PI * 2;
  return new THREE.TorusGeometry(radius, tube, 8, Math.max(8, Math.ceil(220 * ratio)), arc);
}

function rand(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function createScene(container, labelsEl, hooks) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010204);
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 2000);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.55, 0.66);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- backdrop: nebula + starfield ----------
  const nebula = new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uOct: { value: 5 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: NOISE + `
        uniform float uTime; uniform int uOct; varying vec3 vDir;
        float fbmN(vec3 p){float f=0.0;float a=0.5;for(int i=0;i<5;i++){if(i>=uOct)break;f+=a*snoise(p);p*=2.02;a*=0.5;}return f;}
        void main(){
          vec3 d = normalize(vDir);
          float n = fbmN(d*2.2 + vec3(0.0, uTime*0.004, 0.0));
          float m = fbmN(d*4.5 + 11.0);
          float band = exp(-pow(d.y*2.6 + n*0.6, 2.0));
          vec3 violet = vec3(0.20, 0.05, 0.42), cyan = vec3(0.0, 0.22, 0.34), rose = vec3(0.32, 0.03, 0.14);
          vec3 col = mix(violet, cyan, smoothstep(-0.3, 0.5, n));
          col = mix(col, rose, smoothstep(0.25, 0.7, m)*0.5);
          float a = (0.10 + 0.55*band) * smoothstep(-0.6, 0.6, n + m*0.5);
          gl_FragColor = vec4(col * a, 1.0);
        }`
    })
  );
  scene.add(nebula);

  const stars = (() => {
    const N = 4200, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), phase = new Float32Array(N), size = new Float32Array(N);
    const r = rand(7);
    for (let i = 0; i < N; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, rad = 300 + r() * 500;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(th) * s * rad, u * rad * 0.8, Math.sin(th) * s * rad], i * 3);
      const tint = r();
      const c = tint < 0.15 ? [0.6, 0.85, 1] : tint < 0.25 ? [1, 0.8, 0.6] : tint < 0.3 ? [0.85, 0.7, 1] : [1, 1, 1];
      col.set(c, i * 3); phase[i] = r() * 6.28; size[i] = 0.6 + Math.pow(r(), 6) * 3.2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() } },
      vertexShader: `attribute float phase; attribute float size; attribute vec3 color; uniform float uTime; uniform float uPR; varying vec3 vC; varying float vA;
        void main(){ vC = color; vA = 0.55 + 0.45*sin(uTime*1.3 + phase*3.0);
          vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size*uPR*2.0; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); if(d>0.5) discard; float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vC*a*vA*1.4, 1.0); }`
    });
    const p = new THREE.Points(g, m); p.frustumCulled = false; scene.add(p); return p;
  })();

  // ---------- views ----------
  const galaxy = new THREE.Group(); scene.add(galaxy);
  const system = new THREE.Group(); scene.add(system); system.visible = false;

  // Galactic disc: spiral arms of dust behind the project stars.
  const disc = (() => {
    const N = 9000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const r = rand(42), a = new THREE.Color('#5b2bff'), b = new THREE.Color('#00d4ff'), c = new THREE.Color('#ff4fa0');
    for (let i = 0; i < N; i++) {
      const arm = i % 3, t = Math.pow(r(), 0.7), rad = 2 + t * 46;
      const ang = arm * (Math.PI * 2 / 3) + rad * 0.17 + (r() - 0.5) * (0.9 - t * 0.4);
      const spread = (r() - 0.5) * (1.5 + t * 3);
      pos.set([Math.cos(ang) * rad + spread, (r() - 0.5) * (1.4 - t), Math.sin(ang) * rad + spread], i * 3);
      const k = new THREE.Color().copy(a).lerp(b, t).lerp(c, r() < 0.08 ? 0.8 : 0);
      col.set([k.r, k.g, k.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    galaxy.add(p);
    const core = glowSprite(new THREE.Color('#bba0ff'), 16, 0.8); galaxy.add(core);
    const core2 = glowSprite(new THREE.Color('#ffffff'), 5, 0.9); galaxy.add(core2);
    return p;
  })();

  const lightSun = new THREE.PointLight(0xffffff, 40, 120, 1.5); system.add(lightSun);
  system.add(new THREE.AmbientLight(0x223344, 0.6));

  // ---------- camera rig ----------
  const rig = {
    target: new THREE.Vector3(), yaw: 0.6, pitch: 0.75, dist: 60,
    tTarget: new THREE.Vector3(), tYaw: 0.6, tPitch: 0.75, tDist: 60,
    minDist: 3, maxDist: 120, idle: 0
  };
  function placeCamera(dt) {
    const k = 1 - Math.exp(-dt * 5);
    rig.target.lerp(rig.tTarget, k);
    rig.yaw += (rig.tYaw - rig.yaw) * k;
    rig.pitch += (rig.tPitch - rig.pitch) * k;
    rig.dist += (rig.tDist - rig.dist) * k;
    const cp = Math.cos(rig.pitch);
    camera.position.set(
      rig.target.x + rig.dist * cp * Math.sin(rig.yaw),
      rig.target.y + rig.dist * Math.sin(rig.pitch),
      rig.target.z + rig.dist * cp * Math.cos(rig.yaw)
    );
    camera.lookAt(rig.target);
  }

  // ---------- state ----------
  let hub = null;
  let view = 'galaxy';
  let currentProjectId = null;
  let selected = null; // { kind: 'sun' } | { kind: 'need', id }
  let hovered = null;
  const galaxyNodes = new Map(); // projectId -> node
  let planets = new Map(); // needId -> planet
  let sun = null, rings = null;
  const fx = [];
  const tweens = [];
  const labels = new Map();
  let showArchived = false;
  // The most recent warp request wins; a newer one cancels one still in flight.
  let warping = false, warpTimer = null;
  function warpAfter(ms, fn) { clearTimeout(warpTimer); warping = true; warpTimer = setTimeout(() => { warping = false; warpTimer = null; fn(); }, ms); }
  function cancelWarp() { clearTimeout(warpTimer); warpTimer = null; warping = false; }

  function tween(dur, update, done, ease = t => 1 - Math.pow(1 - t, 3)) {
    const tw = { t: 0, dur, update, done, ease }; tweens.push(tw); return tw;
  }

  // ---------- labels ----------
  function label(key, html, cls = '') {
    let el = labels.get(key);
    if (!el) {
      el = document.createElement('div'); el.className = `scene-label ${cls}`; labelsEl.appendChild(el); labels.set(key, el);
      el.addEventListener('click', (e) => { e.stopPropagation(); if (!warping) el._onClick?.(); });
    }
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
    el.className = `scene-label ${cls}`;
    el._seen = true;
    return el;
  }
  function clearLabels() { for (const el of labels.values()) el.remove(); labels.clear(); }
  function sweepLabels() {
    for (const [k, el] of labels) { if (!el._seen) { el.remove(); labels.delete(k); } el._seen = false; }
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tmpV = new THREE.Vector3();
  function placeLabel(el, obj, offsetY) {
    obj.getWorldPosition(tmpV); tmpV.y += offsetY;
    const camDist = tmpV.distanceTo(camera.position);
    tmpV.project(camera);
    const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.15 && Math.abs(tmpV.y) < 1.15;
    el.style.display = vis ? '' : 'none';
    if (!vis) return;
    const x = (tmpV.x * 0.5 + 0.5) * window.innerWidth, y = (-tmpV.y * 0.5 + 0.5) * window.innerHeight;
    el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    // Labels that drift under the title bar or the console fade out instead of fighting the HUD.
    const under = y < 120 || y > window.innerHeight - (window.innerWidth < 860 ? 360 : 250);
    el.style.opacity = String(under ? 0.12 : THREE.MathUtils.clamp(1.4 - camDist / 70, 0.25, 1));
    el.style.pointerEvents = under ? 'none' : '';
  }

  // ---------- galaxy ----------
  function galaxySlot(i) {
    if (i === 0) return new THREE.Vector3(9, 0.6, 2);
    const a = i * 2.39996 + 0.4, r = 9 + Math.sqrt(i) * 7.5;
    return new THREE.Vector3(Math.cos(a) * r, Math.sin(i * 1.7) * 1.4, Math.sin(a) * r);
  }

  function visibleProjects() { return (hub?.projects || []).filter(p => showArchived || !p.archived); }

  function buildGalaxy() {
    galaxySig = galaxySignature();
    for (const n of galaxyNodes.values()) { galaxy.remove(n.group); n.dispose(); }
    galaxyNodes.clear();
    visibleProjects().forEach((p, i) => {
      const owner = hub.players.find(x => x.id === p.ownerId);
      const color = new THREE.Color(owner?.color || '#00d4ff');
      const group = new THREE.Group(); group.position.copy(galaxySlot(i));
      const size = 0.7 + Math.min(p.needs.length, 14) * 0.05;
      const hot = new THREE.Color().copy(color).lerp(new THREE.Color('#ffffff'), 0.55);
      const star = new THREE.Mesh(new THREE.SphereGeometry(size, 48, 32), sunMaterial(color.clone().multiplyScalar(0.6), hot));
      group.add(star);
      const corona = glowSprite(color, size * 7, 0.7); group.add(corona);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(size * 2.4, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData = { kind: 'project', id: p.id }; group.add(hit);
      const ringBase = new THREE.Mesh(new THREE.TorusGeometry(size * 2.3, 0.015, 6, 128), new THREE.MeshBasicMaterial({ color: 0x223344, transparent: true, opacity: 0.6 }));
      ringBase.rotation.x = Math.PI / 2; group.add(ringBase);
      const prog = new THREE.Mesh(arcGeometry(size * 2.3, 0, 0.04), new THREE.MeshBasicMaterial({ color: new THREE.Color('#00d4ff').multiplyScalar(2.2) }));
      prog.rotation.x = Math.PI / 2; group.add(prog);
      const dots = new THREE.Group(); group.add(dots);
      const dotMeshes = p.needs.map((n, k) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(n.ring === 'major' ? 0.13 : 0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        m.userData = { r: size * (n.ring === 'major' ? 3.4 : 2.9), a: k * 2.4, s: 0.25 + (k % 3) * 0.08 };
        dots.add(m); return m;
      });
      galaxy.add(group);
      const node = {
        group, star, corona, prog, dots, dotMeshes, hit, size, ratio: 0, shown: 0, projectId: p.id,
        dispose() { group.traverse(o => { o.geometry?.dispose(); if (o.material && o.material !== GLOW) o.material.dispose?.(); }); }
      };
      galaxyNodes.set(p.id, node);
    });
    refreshGalaxy();
  }

  function refreshGalaxy() {
    for (const p of visibleProjects()) {
      const node = galaxyNodes.get(p.id); if (!node) continue;
      const done = p.needs.filter(n => n.status === 'fulfilled').length;
      node.ratio = p.needs.length ? done / p.needs.length : 0;
      node.complete = !!p.completedAt;
      node.archived = p.archived;
      p.needs.forEach((n, k) => {
        const m = node.dotMeshes[k]; if (!m) return;
        const c = n.status === 'fulfilled' ? COL.done : n.status === 'pending' ? COL.pending : COL[n.ring];
        m.material.color.copy(c).multiplyScalar(n.status === 'fulfilled' ? 2.5 : 1.6);
      });
      node.star.material.uniforms.uHeat.value = node.complete ? 2.6 : p.archived ? 0.5 : 1.5;
      if (node.complete) node.corona.material.color.copy(COL.gold);
    }
  }

  // Rebuild the galaxy when anything structural changes: projects, need counts, owner colours.
  let galaxySig = '';
  function galaxySignature() {
    return visibleProjects().map(p => `${p.id}:${p.needs.length}:${hub.players.find(x => x.id === p.ownerId)?.color || ''}`).join('|');
  }

  // ---------- system ----------
  function clearSystem() {
    system.traverse(o => { if (o === lightSun) return; o.geometry?.dispose(); o.material?.dispose?.(); });
    for (const c of [...system.children]) if (c !== lightSun && !c.isAmbientLight) system.remove(c);
    planets = new Map(); sun = null; rings = null; tweens.length = 0;
  }

  function buildSystem(project) {
    clearSystem();
    const owner = hub.players.find(x => x.id === project.ownerId);
    const ownerColor = new THREE.Color(owner?.color || '#ffcc33');
    const warm = new THREE.Color('#ffb347'), white = new THREE.Color('#fff4d6');

    // Core star: the project itself.
    const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(2, 96, 64), sunMaterial(warm.clone().lerp(ownerColor, 0.25), white));
    sunMesh.userData = { kind: 'sun', id: project.id };
    system.add(sunMesh);
    const corona = glowSprite(new THREE.Color('#ffb347'), 16, 0.45); system.add(corona);
    const corona2 = glowSprite(ownerColor, 26, 0.25); system.add(corona2);
    sun = { mesh: sunMesh, corona, corona2 };

    // Rings: base line, tick marks, progress arc.
    const mkRing = (r, color) => {
      const base = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 256), new THREE.MeshBasicMaterial({ color: 0x1b2a3a }));
      base.rotation.x = Math.PI / 2; system.add(base);
      const tickPos = [];
      for (let i = 0; i < 120; i++) {
        const a = (i / 120) * Math.PI * 2, len = i % 10 === 0 ? 0.35 : 0.12;
        tickPos.push(Math.cos(a) * (r - len), 0, Math.sin(a) * (r - len), Math.cos(a) * (r + len * 0.3), 0, Math.sin(a) * (r + len * 0.3));
      }
      const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tickPos, 3));
      const ticks = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending }));
      system.add(ticks);
      const arc = new THREE.Mesh(arcGeometry(r, 0), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.6) }));
      arc.rotation.x = Math.PI / 2; system.add(arc);
      return { r, arc, ticks, ratio: 0, shown: 0, color };
    };
    rings = { minor: mkRing(MINOR_R, COL.minor), major: mkRing(MAJOR_R, COL.major) };

    // Asteroid belt between the rings.
    const belt = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.06, 0), new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.9, metalness: 0.1 }), 520);
    const r = rand(project.seed || 3), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 520; i++) {
      const a = r() * Math.PI * 2, rad = 7.6 + r() * 1.0 + (r() - 0.5) * 0.6, s = 0.4 + r() * 1.8;
      e.set(r() * 6, r() * 6, r() * 6); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(Math.cos(a) * rad, (r() - 0.5) * 0.35, Math.sin(a) * rad), q, new THREE.Vector3(s, s * (0.6 + r()), s));
      belt.setMatrixAt(i, m4);
    }
    belt.userData.spin = 0.008; system.add(belt);
    rings.belt = belt;

    // Planets: one per need.
    for (const ring of ['minor', 'major']) {
      const list = project.needs.filter(n => n.ring === ring);
      list.forEach((need, i) => {
        const size = ring === 'minor' ? 0.38 : 0.6;
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 48, 32), planetMaterial((project.seed % 97) + i * 3.1 + (ring === 'major' ? 50 : 0)));
        mesh.userData = { kind: 'need', id: need.id };
        const g = new THREE.Group(); g.add(mesh); system.add(g);
        const glow = glowSprite(COL[ring], size * 5, 0.35); g.add(glow);
        const halo = new THREE.Mesh(new THREE.TorusGeometry(size * 1.7, 0.025, 6, 96), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        halo.rotation.x = Math.PI / 2.4; halo.visible = false; g.add(halo);
        const moon = new THREE.Mesh(new THREE.SphereGeometry(size * 0.22, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        moon.visible = false; g.add(moon);
        const probe = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.2, 0), new THREE.MeshBasicMaterial({ color: COL.pending.clone().multiplyScalar(2) }));
        probe.visible = false; g.add(probe);
        planets.set(need.id, {
          need, ring, group: g, mesh, glow, halo, moon, probe, size,
          angle: (i / list.length) * Math.PI * 2 + (ring === 'major' ? 0.5 : 0),
          radius: ring === 'minor' ? MINOR_R : MAJOR_R,
          speed: ring === 'minor' ? 0.035 : 0.022, scale: 1, energy: 0.4
        });
      });
    }

    // Selection reticle.
    const ret = new THREE.Mesh(new THREE.RingGeometry(1, 1.06, 64, 1, 0, Math.PI * 1.6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#00d4ff').multiplyScalar(2), side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    const ret2 = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.18, 64, 1, 0, Math.PI * 0.6), ret.material);
    const reticle = new THREE.Group(); reticle.add(ret, ret2); reticle.visible = false; system.add(reticle);
    rings.reticle = reticle;

    refreshSystem(project, true);
  }

  function refreshSystem(project, instant = false) {
    if (!rings) return;
    for (const ring of ['minor', 'major']) {
      const list = project.needs.filter(n => n.ring === ring);
      const done = list.filter(n => n.status === 'fulfilled').length;
      rings[ring].ratio = list.length ? done / list.length : 0;
      rings[ring].arc.visible = list.length > 0;
      if (instant) { rings[ring].shown = rings[ring].ratio; setArc(rings[ring]); }
    }
    for (const need of project.needs) {
      const pl = planets.get(need.id); if (!pl) continue;
      pl.need = need;
      const mat = pl.mesh.material.uniforms;
      const helper = hub.players.find(x => x.id === need.fulfilledBy);
      if (need.status === 'fulfilled') {
        mat.uColor.value.copy(COL.done); mat.uGlow.value.copy(helper ? new THREE.Color(helper.color) : COL.done);
        pl.energy = 1.8; pl.glow.material.color.copy(helper ? new THREE.Color(helper.color) : COL.done); pl.glow.material.opacity = 0.6;
        pl.halo.visible = true; pl.halo.material.color.set(helper?.color || '#ffffff').multiplyScalar(2);
        pl.moon.visible = true; pl.moon.material.color.set(helper?.color || '#ffffff').multiplyScalar(1.6);
        pl.probe.visible = false;
      } else if (need.status === 'pending') {
        mat.uColor.value.copy(COL[pl.ring]).lerp(COL.pending, 0.6); mat.uGlow.value.copy(COL.pending);
        pl.energy = 0.9; pl.glow.material.color.copy(COL.pending); pl.glow.material.opacity = 0.45;
        pl.halo.visible = false; pl.moon.visible = false;
        const offer = hub.contributions.find(c => c.needId === need.id && c.status === 'pending');
        const who = hub.players.find(x => x.id === offer?.playerId);
        pl.probe.visible = true; pl.probe.material.color.set(who?.color || '#ffb52e').multiplyScalar(2);
      } else {
        mat.uColor.value.copy(COL[pl.ring]); mat.uGlow.value.copy(COL[pl.ring]);
        pl.energy = 0.35; pl.glow.material.color.copy(COL[pl.ring]); pl.glow.material.opacity = 0.3;
        pl.halo.visible = false; pl.moon.visible = false; pl.probe.visible = false;
      }
    }
    if (sun) sun.mesh.material.uniforms.uHeat.value = project.completedAt ? 2.2 : 1.2;
    if (sun && project.completedAt) sun.corona.material.color.copy(COL.gold);
  }

  function setArc(r) {
    r.arc.geometry.dispose();
    r.arc.geometry = arcGeometry(r.r, r.shown);
  }

  // ---------- effects ----------
  function burst(pos, color, count = 60, speed = 3, life = 1.4, size = 0.18) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3), v = [];
    for (let i = 0; i < count; i++) {
      p.set([pos.x, pos.y, pos.z], i * 3);
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      v.push(d);
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), size, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const pts = new THREE.Points(g, m); scene.add(pts);
    fx.push({ kind: 'burst', obj: pts, v, life, max: life });
  }
  function shockwave(radius, color, y = 0) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 128), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = y; m.scale.setScalar(radius); scene.add(m);
    fx.push({ kind: 'wave', obj: m, r0: radius, life: 1.6, max: 1.6 });
  }

  function onEvents(events) {
    if (!events?.length) return;
    for (const ev of events) {
      if (view === 'system' && ev.projectId === currentProjectId) {
        if (ev.kind === 'fulfilled') {
          const pl = planets.get(ev.needId);
          const who = hub.players.find(x => x.id === ev.playerId);
          if (pl) { const wp = new THREE.Vector3(); pl.mesh.getWorldPosition(wp); burst(wp, who?.color || '#00d4ff', 90, 2.6); burst(wp, '#ffffff', 30, 1.2, 1, 0.12); }
        }
        if (ev.kind === 'offer') {
          const pl = planets.get(ev.needId);
          if (pl) { const wp = new THREE.Vector3(); pl.mesh.getWorldPosition(wp); burst(wp, '#ffb52e', 36, 1.4, 1.1, 0.12); }
        }
        if (ev.kind === 'ring') shockwave(ev.ring === 'minor' ? MINOR_R : MAJOR_R, ev.ring === 'minor' ? '#00d4ff' : '#b06bff');
        if (ev.kind === 'complete') supernova();
      } else if (view === 'galaxy' && ev.projectId) {
        const node = galaxyNodes.get(ev.projectId);
        if (node && (ev.kind === 'fulfilled' || ev.kind === 'complete')) burst(node.group.position, ev.kind === 'complete' ? '#ffd36b' : '#00d4ff', ev.kind === 'complete' ? 200 : 50, ev.kind === 'complete' ? 5 : 2);
      }
    }
  }

  function supernova() {
    if (!sun) return;
    const s = sun, h = s.mesh.material.uniforms.uHeat;
    tween(2.6, t => { h.value = 2.2 + Math.sin(t * Math.PI) * 9; s.corona.scale.setScalar(16 + Math.sin(t * Math.PI) * 30); }, () => { h.value = 2.2; s.corona.scale.setScalar(18); });
    burst(new THREE.Vector3(), '#ffd36b', 500, 9, 2.6, 0.22);
    burst(new THREE.Vector3(), '#ffffff', 200, 5, 2, 0.16);
    shockwave(3, '#ffd36b'); setTimeout(() => shockwave(MINOR_R, '#00d4ff'), 250); setTimeout(() => shockwave(MAJOR_R, '#b06bff'), 500);
  }

  // ---------- view switching ----------
  const flash = document.getElementById('warp-flash');
  function warpFlash() { flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on'); }

  function enterSystem(projectId, { instant = false } = {}) {
    const project = hub?.projects.find(p => p.id === projectId); if (!project) return;
    cancelWarp();
    const node = galaxyNodes.get(projectId);
    const go = () => {
      view = 'system'; currentProjectId = projectId; selected = null; clearLabels();
      galaxy.visible = false; system.visible = true;
      buildSystem(project);
      rig.target.set(0, 0, 0); rig.tTarget.set(0, -0.5, 0);
      rig.dist = instant ? 22 : 4; rig.tDist = 22; rig.tPitch = 0.82; rig.pitch = instant ? 0.82 : 1.1;
      rig.minDist = 4; rig.maxDist = 45;
      if (!instant) warpFlash();
      hooks.onView?.('system', projectId);
    };
    if (instant || view !== 'galaxy' || !node) return go();
    rig.tTarget.copy(node.group.position); rig.tDist = 2.2;
    hooks.onSound?.('warp');
    warpAfter(650, () => { if (hub.projects.some(p => p.id === projectId)) go(); });
  }

  function enterGalaxy({ instant = false } = {}) {
    const from = currentProjectId;
    const go = () => {
      view = 'galaxy'; selected = null; currentProjectId = null; clearLabels();
      clearSystem(); system.visible = false; galaxy.visible = true;
      buildGalaxy();
      const node = from && galaxyNodes.get(from);
      rig.minDist = 6; rig.maxDist = 140;
      if (node && !instant) { rig.target.copy(node.group.position); rig.dist = 3; warpFlash(); } else if (instant) { rig.target.set(0, 0, 0); rig.dist = 62; }
      rig.tTarget.set(0, 0, 0); rig.tDist = Math.max(48, 30 + Math.sqrt(galaxyNodes.size) * 14); rig.tPitch = 0.72;
      hooks.onView?.('galaxy', null);
    };
    const wasWarping = warping;
    cancelWarp();
    if (instant || view === 'galaxy') { if (wasWarping) { rig.tTarget.set(0, 0, 0); rig.tDist = Math.max(48, 30 + Math.sqrt(galaxyNodes.size) * 14); } return wasWarping ? undefined : go(); }
    rig.tDist = 48; hooks.onSound?.('warp');
    warpAfter(420, go);
  }

  function select(sel) {
    selected = sel;
    if (view !== 'system') return;
    if (!sel) { rig.tTarget.set(0, -0.5, 0); rig.tDist = 22; rig.tPitch = 0.82; }
    else if (sel.kind === 'sun') { rig.tTarget.set(0, 0, 0); rig.tDist = 9; rig.tPitch = 0.55; }
    else { const pl = planets.get(sel.id); if (pl) { rig.tDist = 6 + pl.size * 2; rig.tPitch = 0.6; } }
  }

  function focusProject(projectId) {
    const node = galaxyNodes.get(projectId);
    if (node && view === 'galaxy') { rig.tTarget.copy(node.group.position); rig.tDist = 14; }
  }

  // ---------- input ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null, pointerNdc = null, pinch = null;
  const touches = new Map();
  const el = renderer.domElement;
  const spread = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  el.addEventListener('pointerdown', e => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture(e.pointerId);
    if (touches.size === 2) { pinch = { d: spread(), dist: rig.tDist }; down = null; return; }
    down = { x: e.clientX, y: e.clientY, yaw: rig.tYaw, pitch: rig.tPitch, moved: false };
  });
  const lift = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
  el.addEventListener('pointercancel', e => { lift(e); down = null; });
  el.addEventListener('pointermove', e => {
    pointerNdc = { x: (e.clientX / window.innerWidth) * 2 - 1, y: -(e.clientY / window.innerHeight) * 2 + 1 };
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) { rig.tDist = THREE.MathUtils.clamp(pinch.dist * pinch.d / Math.max(20, spread()), rig.minDist, rig.maxDist); rig.idle = 0; return; }
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) > 4) down.moved = true;
    rig.tYaw = down.yaw - dx * 0.006;
    rig.tPitch = THREE.MathUtils.clamp(down.pitch + dy * 0.004, 0.08, 1.45);
    rig.idle = 0;
  });
  el.addEventListener('pointerup', e => {
    const wasPinch = !!pinch; lift(e);
    const wasClick = down && !down.moved && !wasPinch && !warping; down = null;
    if (!wasClick) return;
    const hit = pick(e.clientX, e.clientY);
    if (view === 'galaxy') {
      if (hit) { hooks.onSound?.('select'); hooks.onPickProject?.(hit.id); } else hooks.onPickProject?.(null);
    } else {
      if (hit?.kind === 'sun') hooks.onSelect?.({ kind: 'sun' });
      else if (hit?.kind === 'need') hooks.onSelect?.({ kind: 'need', id: hit.id });
      else hooks.onSelect?.(null);
    }
  });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    rig.tDist = THREE.MathUtils.clamp(rig.tDist * (1 + Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0012), rig.minDist, rig.maxDist);
    rig.idle = 0;
  }, { passive: false });

  function pickables() {
    if (view === 'galaxy') return [...galaxyNodes.values()].map(n => n.hit);
    return [sun?.mesh, ...[...planets.values()].map(p => p.mesh)].filter(Boolean);
  }
  function pick(x, y) {
    ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables(), false)[0];
    return hit ? hit.object.userData : null;
  }

  // ---------- frame loop ----------
  const clock = new THREE.Clock();
  let quality = 'high';
  let frames = 0, fpsT = 0, lowStreak = 0;
  function frame() {
    requestAnimationFrame(frame);
    window.__kolabzFrames = (window.__kolabzFrames || 0) + 1;
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    rig.idle += dt;
    if (view === 'galaxy' && rig.idle > 6 && !down) rig.tYaw += dt * 0.03;

    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i]; tw.t += dt / tw.dur;
      // A tween must never take the frame loop down with it.
      try { tw.update(tw.ease(Math.min(tw.t, 1))); if (tw.t >= 1) { tweens.splice(i, 1); tw.done?.(); } }
      catch (e) { tweens.splice(i, 1); console.warn('[ko-labz] dropped an animation:', e.message); }
    }

    nebula.material.uniforms.uTime.value = t;
    stars.material.uniforms.uTime.value = t;

    if (view === 'galaxy') {
      disc.rotation.y += dt * 0.01;
      const vis = visibleProjects();
      vis.forEach(p => {
        const n = galaxyNodes.get(p.id); if (!n) return;
        n.star.material.uniforms.uTime.value = t;
        n.shown += (n.ratio - n.shown) * Math.min(1, dt * 3);
        if (Math.abs(n.ratio - n.shown) > 0.001 || !n._arcInit) { n.prog.geometry.dispose(); n.prog.geometry = arcGeometry(n.size * 2.3, n.shown, 0.04); n._arcInit = true; }
        n.prog.material.color.copy(n.complete ? COL.gold : COL.minor).multiplyScalar(2.4);
        n.dotMeshes.forEach(m => { const u = m.userData; u.a += dt * u.s; m.position.set(Math.cos(u.a) * u.r, 0, Math.sin(u.a) * u.r); });
        const isHover = hovered?.id === p.id;
        const sc = isHover ? 1.18 : 1; n.group.scale.lerp(tmpV.set(sc, sc, sc), 0.15);
        n.corona.material.opacity = (n.complete ? 0.95 : 0.6) + Math.sin(t * 1.5 + n.size * 9) * 0.08;
        const owner = hub.players.find(x => x.id === p.ownerId);
        const done = p.needs.filter(x => x.status === 'fulfilled').length;
        const pend = p.needs.filter(x => x.status === 'pending').length;
        const lab = label(`g:${p.id}`,
          `<div class="sl-title">${esc(p.title)}</div><div class="sl-sub"><i style="background:${esc(owner?.color || '#888')}"></i>${esc(owner?.name || 'UNCLAIMED')} · ${done}/${p.needs.length}${pend ? ` · <b class="amber">${pend} waiting</b>` : ''}${p.completedAt ? ' · <b class="gold">COMPLETE</b>' : ''}</div>`,
          `galaxy ${isHover ? 'hover' : ''} ${p.archived ? 'archived' : ''}`);
        lab._onClick = () => hooks.onPickProject?.(p.id);
        placeLabel(lab, n.group, n.size * 2.6);
      });
    } else if (rings) {
      const project = hub.projects.find(p => p.id === currentProjectId);
      if (sun) {
        sun.mesh.material.uniforms.uTime.value = t;
        sun.mesh.rotation.y += dt * 0.05;
        sun.corona.material.opacity = 0.42 + Math.sin(t * 1.2) * 0.05;
        const s = (selected?.kind === 'sun' || hovered?.kind === 'sun') ? 1.06 : 1;
        sun.mesh.scale.lerp(tmpV.set(s, s, s), 0.1);
      }
      for (const ring of ['minor', 'major']) {
        const r = rings[ring];
        if (Math.abs(r.ratio - r.shown) > 0.0015) { r.shown += (r.ratio - r.shown) * Math.min(1, dt * 2.5); setArc(r); }
        r.ticks.rotation.y += dt * (ring === 'minor' ? 0.02 : -0.012);
      }
      rings.belt.rotation.y += dt * rings.belt.userData.spin;
      for (const pl of planets.values()) {
        pl.angle += dt * pl.speed;
        pl.group.position.set(Math.cos(pl.angle) * pl.radius, 0, Math.sin(pl.angle) * pl.radius);
        const u = pl.mesh.material.uniforms; u.uTime.value = t;
        const isSel = selected?.kind === 'need' && selected.id === pl.need.id;
        const isHov = hovered?.kind === 'need' && hovered.id === pl.need.id;
        u.uHover.value += ((isSel || isHov ? 1 : 0) - u.uHover.value) * 0.15;
        const pulse = pl.need.status === 'pending' ? 0.25 * Math.sin(t * 4) : 0;
        u.uEnergy.value = pl.energy + pulse;
        pl.scale += ((isSel ? 1.45 : isHov ? 1.15 : 1) - pl.scale) * 0.12;
        pl.mesh.scale.setScalar(pl.scale);
        pl.mesh.rotation.y += dt * 0.3;
        pl.halo.rotation.z += dt * 0.6;
        const ma = t * 1.4 + pl.angle * 3;
        pl.moon.position.set(Math.cos(ma) * pl.size * 2.1, Math.sin(ma) * pl.size * 0.6, Math.sin(ma) * pl.size * 2.1);
        const pa = t * 2.6;
        pl.probe.position.set(Math.cos(pa) * pl.size * 1.9, 0.2, Math.sin(pa) * pl.size * 1.9);
        pl.probe.rotation.y += dt * 4;
        const st = pl.need.status;
        const helper = st === 'fulfilled' ? hub.players.find(x => x.id === pl.need.fulfilledBy) : null;
        const chip = st === 'fulfilled' ? `<b class="ok">FULFILLED</b>${helper ? ` · ${esc(helper.name)}` : ''}` : st === 'pending' ? '<b class="amber">OFFER WAITING</b>' : `<b class="${pl.ring}">${pl.ring.toUpperCase()}</b> · OPEN`;
        const lab = label(`n:${pl.need.id}`, `<div class="sl-title">${esc(pl.need.title)}</div><div class="sl-sub">${chip}</div>`, `need ${pl.ring} ${st} ${isSel ? 'sel' : ''} ${isHov ? 'hover' : ''}`);
        lab._onClick = () => hooks.onSelect?.({ kind: 'need', id: pl.need.id });
        placeLabel(lab, pl.group, pl.size * pl.scale + 0.35);
        if (isSel) {
          rings.reticle.visible = true;
          rings.reticle.position.copy(pl.group.position);
          rings.reticle.quaternion.copy(camera.quaternion);
          rings.reticle.scale.setScalar(pl.size * pl.scale * 1.6);
          rings.reticle.children[0].rotation.z += dt * 1.2; rings.reticle.children[1].rotation.z -= dt * 2;
          rings.reticle.children[0].material.color.copy(st === 'fulfilled' ? COL.done : st === 'pending' ? COL.pending : COL[pl.ring]).multiplyScalar(2);
          rig.tTarget.copy(pl.group.position);
        }
      }
      if (!(selected?.kind === 'need' && planets.has(selected.id))) rings.reticle.visible = false;
      if (project && sun) {
        const lab = label('core', `<div class="sl-title">${esc(project.title)}</div><div class="sl-sub">PROJECT CORE · tap for briefing</div>`, `core ${selected?.kind === 'sun' ? 'sel' : ''}`);
        lab._onClick = () => hooks.onSelect?.({ kind: 'sun' });
        placeLabel(lab, sun.mesh, 2.7);
      }
    }
    sweepLabels();

    // Hover picking, once a frame.
    if (pointerNdc && !down) {
      ray.setFromCamera(ndc.set(pointerNdc.x, pointerNdc.y), camera);
      const h = ray.intersectObjects(pickables(), false)[0];
      const next = h ? h.object.userData : null;
      if ((next?.id) !== (hovered?.id) || next?.kind !== hovered?.kind) { hovered = next; if (next) hooks.onSound?.('hover'); }
      el.style.cursor = hovered ? 'pointer' : 'grab';
    }

    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.life -= dt; const k = Math.max(0, f.life / f.max);
      if (f.kind === 'burst') {
        const a = f.obj.geometry.attributes.position.array;
        for (let j = 0; j < f.v.length; j++) { a[j * 3] += f.v[j].x * dt; a[j * 3 + 1] += f.v[j].y * dt; a[j * 3 + 2] += f.v[j].z * dt; f.v[j].multiplyScalar(0.985); }
        f.obj.geometry.attributes.position.needsUpdate = true; f.obj.material.opacity = k;
      } else { f.obj.scale.setScalar(f.r0 * (1 + (1 - k) * 0.6)); f.obj.material.opacity = k; }
      if (f.life <= 0) { scene.remove(f.obj); f.obj.geometry.dispose(); f.obj.material.dispose(); fx.splice(i, 1); }
    }

    placeCamera(dt);
    if (quality === 'low') renderer.render(scene, camera); else composer.render(dt);

    frames++; fpsT += dt;
    if (fpsT > 2) {
      const fps = frames / fpsT; frames = 0; fpsT = 0;
      hooks.onFps?.(fps);
      if (quality === 'high' && fps < 28) { if (++lowStreak >= 3) hooks.onSlow?.(); } else lowStreak = 0;
    }
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight);
  });

  frame();

  return {
    get view() { return view; },
    get projectId() { return currentProjectId; },
    setHub(next, events) {
      const first = !hub; hub = next;
      if (first) { buildGalaxy(); rig.dist = 140; rig.tDist = Math.max(48, 30 + Math.sqrt(galaxyNodes.size) * 14); hooks.onView?.('galaxy', null); return; }
      if (view === 'galaxy') {
        if (galaxySignature() !== galaxySig) buildGalaxy(); else refreshGalaxy();
      } else {
        const project = hub.projects.find(p => p.id === currentProjectId);
        if (!project) { enterGalaxy({ instant: true }); return; }
        const ids = project.needs.map(n => n.id).join();
        if (ids !== [...planets.keys()].join()) buildSystem(project); else refreshSystem(project);
        if (selected?.kind === 'need' && !planets.has(selected.id)) select(null);
      }
      onEvents(events);
    },
    enterSystem, enterGalaxy, select, focusProject,
    setShowArchived(v) { showArchived = v; if (view === 'galaxy') buildGalaxy(); },
    setQuality(q) {
      quality = q; lowStreak = 0;
      renderer.setPixelRatio(q === 'low' ? 1 : Math.min(window.devicePixelRatio, 1.75));
      renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight);
      stars.material.uniforms.uPR.value = renderer.getPixelRatio();
      nebula.material.uniforms.uOct.value = q === 'low' ? 2 : 5;
    },
    nudge(dx) { rig.tYaw += dx; },
    zoom(f) { rig.tDist = THREE.MathUtils.clamp(rig.tDist * f, rig.minDist, rig.maxDist); }
  };
}
