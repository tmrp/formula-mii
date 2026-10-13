import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Metadata,CameraMode,Driver} from './types';

const v=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);
const mat=(color:THREE.ColorRepresentation)=>new THREE.MeshStandardMaterial({color,roughness:0.85,metalness:0});
function mesh(g:THREE.BufferGeometry,m:THREE.Material,parent:THREE.Object3D,x=0,y=0,z=0){const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
function box(parent:THREE.Object3D,m:THREE.Material,x:number,y:number,z:number,w:number,h:number,d:number){return mesh(new THREE.BoxGeometry(w,h,d),m,parent,x,y,z);}
function sphere(parent:THREE.Object3D,m:THREE.Material,x:number,y:number,z:number,r:number,sx=1,sy=1,sz=1){const o=mesh(new THREE.SphereGeometry(r,12,10),m,parent,x,y,z);o.scale.set(sx,sy,sz);return o;}
function mergeGroup(group:THREE.Group){
 const byMat=new Map<THREE.Material,THREE.BufferGeometry[]>();group.updateMatrixWorld(true);
 for(const child of [...group.children])if(child instanceof THREE.Mesh){const geo=child.geometry.clone();geo.applyMatrix4(child.matrix);const m=child.material as THREE.Material;byMat.set(m,[...(byMat.get(m)??[]),geo]);group.remove(child);child.geometry.dispose();}
 for(const [m,geometries]of byMat){const g=mergeGeometries(geometries,false);if(g)mesh(g,m,group);geometries.forEach(g=>g.dispose());}
}

// Each avatar is built from actual 3D geometry; the drivers remain visible in onboard/portrait views.
export function createCar(driver:Driver,index:number):THREE.Group {
 const car=new THREE.Group();const color=mat(`#${driver.team_colour||'ee7b25'}`);const dark=mat('#263b37');const tire=mat('#222a29');const silver=mat('#9faeaa');const cream=mat('#f9f8e9');
 box(car,color,0,1.1,0,3,1.3,5.8);box(car,color,0,0.8,3.4,1.25,0.65,3.6);
 box(car,dark,0,0.55,5.25,5.9,0.28,1.1);box(car,color,0,0.85,5.35,5.8,0.18,0.6);
 box(car,dark,0,2,-3.5,5.5,0.28,1.15);box(car,color,0,2.3,-3.45,5.3,0.25,1.15);
 for(const x of [-2.3,2.3])for(const z of [-2.15,3.1]){
  const wheel=mesh(new THREE.CylinderGeometry(1.05,1.05,1.05,12),tire,car,x,1.05,z);wheel.rotation.z=Math.PI/2;
  const rim=mesh(new THREE.CylinderGeometry(0.58,0.58,1.08,12),silver,car,x,1.05,z);rim.rotation.z=Math.PI/2;
  box(car,dark,x/2,0.9,z,1.5,0.18,0.35);
 }
 box(car,color,-1.8,1,0,0.85,0.9,3.2);box(car,color,1.8,1,0,0.85,0.9,3.2);
 box(car,dark,0,1.95,-0.45,2,0.25,2.9);
 const skin=mat(['#edba8e','#f1cba7','#e7b48c','#cb956e','#dfac83'][index%5]);const hair=mat(['#49392a','#755033','#332b28','#c89655','#5a3a29'][index%5]);
 sphere(car,color,0,2.6,-0.6,1.05,1,0.95,0.65);
 sphere(car,skin,0,4,-0.6,1.52,0.95,1.08,0.85);
 sphere(car,skin,-1.4,4,-0.6,0.27);sphere(car,skin,1.4,4,-0.6,0.27);
 sphere(car,hair,0,4.93,-0.95,1.36,1.02,0.58,0.83);
 for(let k=0;k<4;k++)sphere(car,hair,-0.85+k*0.55,4.9,0.17,0.4,1,0.75,0.9);
 for(const x of [-0.48,0.48]){sphere(car,cream,x,4.03,0.59,0.27,0.85,1,0.45);sphere(car,dark,x,4,0.71,0.14,0.8,1.1,0.35);const eyebrow=box(car,hair,x,4.43,0.63,0.57,0.11,0.1);eyebrow.rotation.z=x<0?0.06:-0.06;}
 sphere(car,skin,0,3.7,0.73,0.24,0.7,1,0.7);
 const smile=mesh(new THREE.TorusGeometry(0.28,0.045,5,12,Math.PI),dark,car,0,3.49,0.6);smile.rotation.z=Math.PI;
 for(const x of [-0.95,0.95])sphere(car,skin,x,2.8,0.45,0.32);
 mesh(new THREE.TorusGeometry(0.55,0.12,6,12),dark,car,0,2.7,0.9).rotation.x=-0.65;
 mergeGroup(car);return car;
}

export class ReplayScene {
 readonly renderer:THREE.WebGLRenderer;
 readonly scene=new THREE.Scene();readonly camera=new THREE.PerspectiveCamera(42,1,1,20000);
 readonly controls:OrbitControls;readonly cars:THREE.Group[]=[];
 readonly track:THREE.Vector3[];readonly center:THREE.Vector3;readonly extent:number;
 mode:CameraMode='orbit';focus=0;station=-1;quality='high';
 private cameraSnap=true;private shadowLight:THREE.DirectionalLight;private observer:ResizeObserver;
 private stations:{position:THREE.Vector3;name:string;point:THREE.Vector3}[]=[];private autoStation=0;
 private cameraTarget=new THREE.Vector3();private desiredPosition=new THREE.Vector3();private lastHeading=new Array(20).fill(0);
 private carLayers:THREE.InstancedMesh[]=[];private carMatrix=new THREE.Matrix4();
 private dirty=true;
 private focusRing:THREE.Mesh;private halo:THREE.Sprite;
 onStationChange?:(name:string)=>void;
 constructor(readonly container:HTMLElement,readonly meta:Metadata){
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.setClearColor('#cfe3e2');
  this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.2;
  container.append(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','3D race replay. Drag to orbit and scroll to zoom in the aerial camera.');
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=0.08;this.controls.maxPolarAngle=Math.PI/2.12;this.controls.minDistance=24;this.controls.maxDistance=3600;
  this.controls.addEventListener('change',()=>{this.dirty=true;});
  this.track=meta.track.points.map(p=>v(p[0],0.7,p[1]));
  const bounds=new THREE.Box3().setFromPoints(this.track);this.center=bounds.getCenter(new THREE.Vector3());this.extent=Math.max(bounds.max.x-bounds.min.x,bounds.max.z-bounds.min.z);
  this.scene.fog=new THREE.Fog('#cfe3e2',this.extent*1.5,this.extent*4);
  this.scene.add(new THREE.HemisphereLight('#fff9dc','#4b7252',2.7));
  this.shadowLight=new THREE.DirectionalLight('#fff3d9',3.2);this.shadowLight.position.copy(this.center).add(v(400,750,200));this.shadowLight.target.position.copy(this.center);this.scene.add(this.shadowLight,this.shadowLight.target);
  this.shadowLight.castShadow=true;this.shadowLight.shadow.mapSize.set(2048,2048);this.shadowLight.shadow.camera.left=-this.extent;this.shadowLight.shadow.camera.right=this.extent;this.shadowLight.shadow.camera.top=this.extent;this.shadowLight.shadow.camera.bottom=-this.extent;this.shadowLight.shadow.camera.far=3000;this.shadowLight.shadow.bias=-0.0005;
  this.buildWorld();
  this.mergeStaticWorld();
  for(let i=0;i<meta.drivers.length;i++){const car=createCar(meta.drivers[i],i);this.cars.push(car);this.scene.add(car);}
  // All twenty cars share seven instanced geometry layers. Colors still differ per driver.
  const templates=this.cars[0].children as THREE.Mesh[];
  templates.forEach((template,j)=>{const material=(template.material as THREE.MeshStandardMaterial).clone();material.color.set('#ffffff');const layer=new THREE.InstancedMesh(template.geometry.clone(),material,meta.drivers.length);layer.castShadow=true;layer.receiveShadow=true;layer.frustumCulled=false;this.cars.forEach((car,i)=>layer.setColorAt(i,((car.children[j] as THREE.Mesh).material as THREE.MeshStandardMaterial).color));this.carLayers.push(layer);this.scene.add(layer);});
  this.cars.forEach(car=>{for(const child of [...car.children] as THREE.Mesh[]){child.geometry.dispose();(child.material as THREE.Material).dispose();car.remove(child);}});
  this.focusRing=mesh(new THREE.RingGeometry(6.8,7.4,36),new THREE.MeshBasicMaterial({color:'#f9fbe5',transparent:true,opacity:0.8,side:THREE.DoubleSide,depthWrite:false}),this.scene);this.focusRing.rotation.x=-Math.PI/2;
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fcfff5';ctx.beginPath();ctx.roundRect(5,5,118,45,18);ctx.fill();ctx.fillStyle='#274b3a';ctx.font='bold 28px sans-serif';ctx.textAlign='center';ctx.fillText('FOLLOW',64,37);
  this.halo=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false}));this.halo.scale.set(20,10,1);this.scene.add(this.halo);
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);this.resize();this.overview();
 }
 private mergeStaticWorld(){
  this.scene.updateMatrixWorld(true);const batches=new Map<string,{material:THREE.Material;geometries:THREE.BufferGeometry[];objects:THREE.Mesh[]}>();
  this.scene.traverse(obj=>{if(!(obj instanceof THREE.Mesh)||obj instanceof THREE.InstancedMesh)return;const material=obj.material as THREE.MeshStandardMaterial;const key=`${material.type}:${material.color.getHex()}:${material.side}`;const batch=batches.get(key)??{material,geometries:[],objects:[]};batch.geometries.push(obj.geometry.clone().applyMatrix4(obj.matrixWorld));batch.objects.push(obj);batches.set(key,batch);});
  for(const batch of batches.values()){const geometry=mergeGeometries(batch.geometries,false);if(!geometry)continue;const material=batch.material.clone();for(const obj of batch.objects){obj.parent?.remove(obj);obj.geometry.dispose();}const merged=mesh(geometry,material,this.scene);merged.matrixAutoUpdate=false;batch.geometries.forEach(g=>g.dispose());}
 }
 private buildWorld(){
  const radius=this.extent*0.86;const island=mesh(new THREE.CylinderGeometry(radius,radius*0.93,55,64),mat('#829c68'),this.scene,this.center.x,-29,this.center.z);
  island.receiveShadow=true;mesh(new THREE.CylinderGeometry(radius*0.935,radius*0.875,12,64),mat('#d0ccb1'),this.scene,this.center.x,-62,this.center.z);
  const land=mesh(new THREE.CircleGeometry(radius,64),mat('#9ebf7a'),this.scene,this.center.x,-0.1,this.center.z);land.rotation.x=-Math.PI/2;
  const curve=new THREE.CatmullRomCurve3(this.track,true,'centripetal');const points=curve.getPoints(1600);
  const ribbon=(width:number,y:number,color:string)=>{
   const pos:number[]=[],idx:number[]=[];
   for(let i=0;i<points.length;i++){const p=points[i];const tangent=points[(i+1)%points.length].clone().sub(points[Math.max(0,i-1)]).normalize();const normal=v(-tangent.z,0,tangent.x).multiplyScalar(width/2);pos.push(p.x+normal.x,y,p.z+normal.z,p.x-normal.x,y,p.z-normal.z);if(i<points.length-1){const n=i*2;idx.push(n,n+1,n+2,n+1,n+3,n+2);}}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();const material=mat(color);material.side=THREE.DoubleSide;mesh(g,material,this.scene);
  };
  ribbon(29,0.05,'#b6ca99');ribbon(20,0.12,'#f4eed8');ribbon(17,0.18,'#677472');
  const curbGeos:THREE.BufferGeometry[][]=[[],[]];
  for(let i=0;i<points.length-1;i+=5){const a=points[i],b=points[Math.min(i+5,points.length-1)];const dir=b.clone().sub(a);for(const sign of [-1,1]){const normal=v(-dir.z,0,dir.x).normalize().multiplyScalar(sign*9.25);const g=new THREE.BoxGeometry(1.4,0.3,dir.length());const m=new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5).add(normal).setY(0.22),new THREE.Quaternion().setFromAxisAngle(v(0,1,0),Math.atan2(dir.x,dir.z)),v(1,1,1));g.applyMatrix4(m);curbGeos[Math.floor(i/5)%2].push(g);}}
  curbGeos.forEach((g,i)=>{const merged=mergeGeometries(g,false);if(merged)mesh(merged,mat(i?'#f8f7e5':'#e89983'),this.scene);g.forEach(x=>x.dispose());});
  // Simple pit lane beside the real start/finish segment.
  const start=this.track[0];const tangent=this.track[Math.min(5,this.track.length-1)].clone().sub(start).normalize();const normal=v(-tangent.z,0,tangent.x);
  const pit=new THREE.Group();pit.position.copy(start).addScaledVector(normal,35);pit.rotation.y=Math.atan2(tangent.x,tangent.z);this.scene.add(pit);
  box(pit,mat('#6e7975'),0,0.15,18,15,0.3,210);box(pit,mat('#e9e8db'),15,8,10,17,16,190);box(pit,mat('#38534a'),15,18,10,22,3,195);
  const glass=mat('#9ac8c1');for(let i=0;i<16;i++){box(pit,glass,5.9,6,-77+i*11,0.3,7,8);box(pit,mat(i%2?'#e7eddb':'#dde4d1'),6.5,15,-77+i*11,0.5,2.5,8);}
  const gantry=new THREE.Group();gantry.position.copy(start);gantry.rotation.y=Math.atan2(tangent.x,tangent.z);this.scene.add(gantry);
  const white=mat('#f4f4de');box(gantry,white,-13,10,0,1.5,20,2);box(gantry,white,13,10,0,1.5,20,2);box(gantry,mat('#244936'),0,20,0,28,5,2);
  const sign=this.textSprite('FORMULA MII','#244936','#eef3d8',24,5);sign.position.set(0,20,1.1);gantry.add(sign);
  for(let x=-8;x<8;x+=2)for(let z=0;z<3;z++){box(gantry,mat((Math.floor(x/2)+z)%2?'#ecedda':'#324b41'),x,0.35,z*2,2,0.03,2);}
  // Instanced trees: hundreds of props in three draw calls.
  let seed=19;const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
  const treePoints:THREE.Vector3[]=[];
  for(let i=0;i<800&&treePoints.length<200;i++){const angle=random()*Math.PI*2,dist=Math.sqrt(random())*radius*0.93;const p=v(this.center.x+Math.cos(angle)*dist,0,this.center.z+Math.sin(angle)*dist);if(this.track.some(t=>t.distanceTo(p)<33))continue;if(p.distanceTo(pit.position)<130)continue;treePoints.push(p);}
  const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(1.3,1.9,10,6),mat('#a18d6f'),treePoints.length);const crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(9,1),mat('#528664'),treePoints.length);const tops=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(6.5,1),mat('#79a768'),treePoints.length);
  treePoints.forEach((p,i)=>{const scale=0.7+random()*0.7;const q=new THREE.Quaternion().setFromAxisAngle(v(0,1,0),random()*6.28);trunks.setMatrixAt(i,new THREE.Matrix4().compose(p.clone().setY(5*scale),q,v(scale,scale,scale)));crowns.setMatrixAt(i,new THREE.Matrix4().compose(p.clone().setY(13*scale),q,v(scale,scale,scale)));tops.setMatrixAt(i,new THREE.Matrix4().compose(p.clone().setY(21*scale),q,v(scale,scale,scale)));});
  for(const obj of [trunks,crowns,tops]){obj.castShadow=true;obj.receiveShadow=true;this.scene.add(obj);}
  const seating=new THREE.Group();const seatingPoint=this.track[Math.floor(this.track.length*0.84)];seating.position.copy(seatingPoint).add(v(45,0,0));this.scene.add(seating);
  const seats=[mat('#e7e9d8'),mat('#78a7a2'),mat('#deb995')];for(let row=0;row<6;row++)box(seating,seats[row%3],row*4,2+row*3,0,5,3,110);box(seating,mat('#f1eedb'),9,24,0,38,2,118);
  const lake=mesh(new THREE.CircleGeometry(1,48),mat('#8cbfc0'),this.scene,this.center.x+radius*0.53,0.02,this.center.z+radius*0.15);lake.rotation.x=-Math.PI/2;lake.scale.set(110,65,1);
  const city=new THREE.Group();this.scene.add(city);const cityMats=[mat('#e0e5dc'),mat('#c8d7d0'),mat('#b2c9c4')];
  for(let i=0;i<35;i++){const a=Math.PI*1.1+i*0.038;const h=25+random()*80;box(city,cityMats[i%3],this.center.x+Math.cos(a)*radius*0.84,h/2,this.center.z+Math.sin(a)*radius*0.84,18+random()*22,h,18+random()*16);}
  const cloudGeo=new THREE.SphereGeometry(1,10,8);const cloudMat=new THREE.MeshBasicMaterial({color:'#f5faf2'});const cloudMesh=new THREE.InstancedMesh(cloudGeo,cloudMat,40);
  for(let i=0;i<40;i++){const angle=Math.floor(i/4)*0.628;const p=v(this.center.x+Math.cos(angle)*(radius+150)+(i%4)*35,180+(i%3)*15,this.center.z+Math.sin(angle)*(radius+150));cloudMesh.setMatrixAt(i,new THREE.Matrix4().compose(p,new THREE.Quaternion(),v(45,22,27)));}this.scene.add(cloudMesh);
  const names=['Senna S · Turn 1','Curva do Sol · Turn 3','Reta Oposta · Turn 4','Ferradura · Turn 6','Pinheirinho · Turn 8','Bico de Pato · Turn 10','Junção · Turn 12','Finish straight'];
  const fractions=[0.06,0.14,0.28,0.42,0.52,0.64,0.77,0.95];
  fractions.forEach((f,i)=>{const n=Math.floor(f*this.track.length),point=this.track[n];const t=this.track[(n+3)%this.track.length].clone().sub(point).normalize();const normal=v(-t.z,0,t.x);const pos=point.clone().addScaledVector(normal,i%2?65:-65).add(v(0,24,0));this.stations.push({position:pos,name:names[i],point});const tower=new THREE.Group();tower.position.copy(pos).setY(0);box(tower,mat('#dce6d0'),0,10,0,2,20,2);box(tower,mat('#3c6651'),0,21,0,5,3,3);this.scene.add(tower);});
 }
 private textSprite(text:string,bg:string,fg:string,w:number,h:number){const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d')!;ctx.fillStyle=bg;ctx.fillRect(0,0,512,128);ctx.fillStyle=fg;ctx.textAlign='center';ctx.font='bold 48px sans-serif';ctx.fillText(text,256,83);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c)}));s.scale.set(w,h,1);return s;}
 overview(){this.controls.target.copy(this.center);this.camera.position.copy(this.center).add(v(this.extent*0.6,this.extent*0.86,this.extent*0.8));this.camera.lookAt(this.center);this.camera.updateMatrixWorld();
  for(let attempt=0;attempt<5;attempt++){let largest=0;this.track.forEach(p=>{const projected=p.clone().project(this.camera);largest=Math.max(largest,Math.abs(projected.x),Math.abs(projected.y));});if(largest<=0.83)break;this.camera.position.sub(this.center).multiplyScalar(largest/0.83).add(this.center);this.camera.lookAt(this.center);this.camera.updateMatrixWorld();}
  this.controls.update();}
 setMode(mode:CameraMode){this.mode=mode;this.controls.enabled=mode==='orbit';this.cameraSnap=true;this.dirty=true;if(mode==='orbit'){this.camera.fov=42;this.camera.updateProjectionMatrix();this.overview();}}
 setFocus(index:number){this.focus=index;this.cameraSnap=true;this.dirty=true;}
 setQuality(low:boolean){this.quality=low?'low':'high';this.renderer.setPixelRatio(low?1:Math.min(devicePixelRatio,1.5));this.renderer.shadowMap.enabled=!low;this.resize();this.dirty=true;}
 get stationNames(){return this.stations.map(s=>s.name);}
 update(frame:Float32Array,dt:number,force=true){
  for(let i=0;i<this.cars.length;i++){const k=i*16,car=this.cars[i];car.position.set(frame[k],0.3,frame[k+1]);this.lastHeading[i]=frame[k+3];car.rotation.y=this.lastHeading[i];car.visible=frame[k+12]>0;car.updateMatrix();if(car.visible)this.carMatrix.copy(car.matrix);else this.carMatrix.makeScale(0,0,0);this.carLayers.forEach(layer=>layer.setMatrixAt(i,this.carMatrix));}
  this.carLayers.forEach(layer=>{layer.instanceMatrix.needsUpdate=true;});
  const car=this.cars[this.focus],pos=car.position;this.focusRing.position.copy(pos).setY(0.4);this.focusRing.visible=car.visible;this.halo.position.copy(pos).add(v(0,13,0));this.halo.visible=car.visible&&this.mode==='orbit';
  if(this.mode==='orbit')this.controls.update();else{
   const dir=v(Math.sin(car.rotation.y),0,Math.cos(car.rotation.y));this.cameraTarget.copy(pos).add(v(0,3,0));let fov=48;
   if(this.mode==='chase'){this.desiredPosition.copy(pos).addScaledVector(dir,-42).add(v(16,22,0));this.cameraTarget.addScaledVector(dir,22);}
   else if(this.mode==='onboard'){this.desiredPosition.copy(pos).addScaledVector(dir,1.8).add(v(0,5.6,0));this.cameraTarget.addScaledVector(dir,75).setY(3.8);fov=76;}
   else if(this.mode==='portrait'){this.desiredPosition.copy(pos).addScaledVector(dir,14).add(v(5,6.5,0));this.cameraTarget.setY(3.5);fov=42;}
   else{
    let station=this.station;
    if(station<0){let nearest=0,dist=Infinity;this.stations.forEach((s,i)=>{const d=s.point.distanceTo(pos);if(d<dist){nearest=i;dist=d;}});if(this.stations[this.autoStation].point.distanceTo(pos)>dist+60){this.autoStation=nearest;this.cameraSnap=true;}station=this.autoStation;}
    const s=this.stations[station];this.desiredPosition.copy(s.position);this.cameraTarget.setY(3);fov=THREE.MathUtils.clamp(2400/s.position.distanceTo(pos),16,58);this.onStationChange?.(s.name);
   }
   const alpha=this.cameraSnap?1:1-Math.exp(-dt*8);this.camera.position.lerp(this.desiredPosition,alpha);this.camera.lookAt(this.cameraTarget);this.camera.fov=fov;this.camera.updateProjectionMatrix();this.cameraSnap=false;
  }
  if(force||this.dirty){this.renderer.render(this.scene,this.camera);this.dirty=false;return true;}return false;
 }
 resize(){const {width,height}=this.container.getBoundingClientRect();if(!width||!height)return;this.renderer.setSize(width,height);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.dirty=true;}
 dispose(){this.observer.disconnect();this.controls.dispose();this.scene.traverse(obj=>{if(obj instanceof THREE.Mesh){obj.geometry.dispose();const materials=Array.isArray(obj.material)?obj.material:[obj.material];materials.forEach(m=>m.dispose());}});this.renderer.dispose();}
}
