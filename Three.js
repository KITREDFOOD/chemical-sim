import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";

const canvas=document.querySelector("#scene");
const workspace=document.querySelector("#workspace");
const scene=new THREE.Scene();
scene.background=new THREE.Color("#111827");

const camera=new THREE.PerspectiveCamera(45,1,.1,1000);
camera.position.set(5,6,10);

const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;

const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;
controls.target.set(0,0,0);

scene.add(new THREE.HemisphereLight(0xffffff,0x40506a,2));
const light=new THREE.DirectionalLight(0xffffff,2.5);
light.position.set(5,8,6);
scene.add(light);

const grid=new THREE.GridHelper(30,30,0x43536c,0x29364b);
grid.position.y=-2;
scene.add(grid);

const raycaster=new THREE.Raycaster();
const pointer=new THREE.Vector2();
const dropPlane=new THREE.Plane(new THREE.Vector3(0,0,1),0);
const dropPoint=new THREE.Vector3();

const elements={
 H:{name:"Hydrogen",color:"#eaf1fa",radius:.25,valence:1},
 C:{name:"Carbon",color:"#606b7b",radius:.39,valence:4},
 O:{name:"Oxygen",color:"#ed5555",radius:.36,valence:2},
 N:{name:"Nitrogen",color:"#507fe8",radius:.36,valence:3},
 Cl:{name:"Chlorine",color:"#8dc76c",radius:.45,valence:1},
 S:{name:"Sulfur",color:"#e9c84e",radius:.43,valence:2},
 F:{name:"Fluorine",color:"#75d99b",radius:.31,valence:1}
};

let atoms=[];
let bonds=[];
let selected=[];
let bondOrder=1;
let view="ball";
let nextId=0;
const atomMeshes=new Map();

const templates={
 Water:{atoms:[["O",0,0,0],["H",.8,.6,0],["H",-.8,.6,0]],bonds:[[0,1,1],[0,2,1]]},
 Methane:{atoms:[["C",0,0,0],["H",1,1,1],["H",-1,-1,1],["H",-1,1,-1],["H",1,-1,-1]],bonds:[[0,1,1],[0,2,1],[0,3,1],[0,4,1]]},
 "Carbon dioxide":{atoms:[["O",-1.1,0,0],["C",0,0,0],["O",1.1,0,0]],bonds:[[0,1,2],[1,2,2]]},
 Ammonia:{atoms:[["N",0,0,0],["H",.9,0,0],["H",-.45,.78,0],["H",-.45,-.78,0]],bonds:[[0,1,1],[0,2,1],[0,3,1]]},
 Oxygen:{atoms:[["O",-.55,0,0],["O",.55,0,0]],bonds:[[0,1,2]]},
 Nitrogen:{atoms:[["N",-.6,0,0],["N",.6,0,0]],bonds:[[0,1,3]]},
 "Hydrogen chloride":{atoms:[["H",-.5,0,0],["Cl",.5,0,0]],bonds:[[0,1,1]]}
};

function makePalette(){
 const palette=document.querySelector("#atomPalette");
 Object.entries(elements).forEach(([symbol,e])=>{
  const item=document.createElement("div");
  item.className="item";item.draggable=true;
  item.innerHTML=`<i class="atomIcon" style="background:${e.color}"></i>${symbol} · ${e.name}`;
  item.addEventListener("dragstart",ev=>{
   ev.dataTransfer.setData("application/x-molecule",JSON.stringify({type:"atom",symbol}));
   ev.dataTransfer.effectAllowed="copy";
  });
  palette.append(item);
 });
 const container=document.querySelector("#templates");
 Object.entries(templates).forEach(([name,t])=>{
  const item=document.createElement("div");
  item.className="item";item.draggable=true;
  item.textContent="⬡ "+name;
  item.addEventListener("dragstart",ev=>{
   ev.dataTransfer.setData("application/x-molecule",JSON.stringify({type:"template",name}));
   ev.dataTransfer.effectAllowed="copy";
  });
  container.append(item);
 });
}
makePalette();

function addAtom(symbol,pos){
 if(!elements[symbol])return;
 const atom={id:nextId++,symbol,pos:new THREE.Vector3(...pos)};
 atoms.push(atom);
 const geometry=new THREE.SphereGeometry(elements[symbol].radius,32,24);
 const material=new THREE.MeshStandardMaterial({
  color:elements[symbol].color,roughness:.3,metalness:.05
 });
 const mesh=new THREE.Mesh(geometry,material);
 mesh.position.copy(atom.pos);
 mesh.userData.atom=atom;
 mesh.userData.baseScale=1;
 scene.add(mesh);
 atomMeshes.set(atom.id,mesh);
 update();
 return atom;
}

function addBond(a,b,order=1){
 if(a===b)return false;
 if(bonds.some(x=>(x.a===a&&x.b===b)||(x.a===b&&x.b===a))){
  say("These atoms are already connected.");return false;
 }
 const usedA=bonds.filter(x=>x.a===a||x.b===a).reduce((s,x)=>s+x.order,0);
 const usedB=bonds.filter(x=>x.a===b||x.b===b).reduce((s,x)=>s+x.order,0);
 if(usedA+order>elements[a.symbol].valence||
    usedB+order>elements[b.symbol].valence){
  say("That bond exceeds an atom's simplified valence capacity.");return false;
 }
 bonds.push({a,b,order});
 drawBonds();update();
 return true;
}

function addTemplate(name,pos){
 const t=templates[name];
 if(!t)return;
 const made=t.atoms.map(([s,x,y,z])=>addAtom(s,[pos[0]+x,pos[1]+y,pos[2]+z]));
 t.bonds.forEach(([a,b,o])=>addBond(made[a],made[b],o));
 say(name+" added to workspace.");
}

function drawBonds(){
 scene.children.filter(x=>x.userData.isBond).forEach(x=>scene.remove(x));
 bonds.forEach(b=>{
  const start=b.a.pos,end=b.b.pos;
  const direction=new THREE.Vector3().subVectors(end,start);
  const length=direction.length();
  if(length<.001)return;
  const axis=new THREE.Vector3(0,0,1);
  const quaternion=new THREE.Quaternion().setFromUnitVectors(axis,direction.normalize());
  for(let i=0;i<b.order;i++){
   const offset=(i-(b.order-1)/2)*.14;
   const geometry=new THREE.CylinderGeometry(.055,.055,length,12);
   const material=new THREE.MeshStandardMaterial({color:0xc2d0df,roughness:.45});
   const mesh=new THREE.Mesh(geometry,material);
   mesh.position.copy(start).add(end).multiplyScalar(.5);
   mesh.position.x+=offset;
   mesh.quaternion.copy(quaternion);
   mesh.userData.isBond=true;
   scene.add(mesh);
  }
 });
}

function setView(mode){
 view=mode;
 document.querySelectorAll("#ball,#space,#lewis").forEach(b=>b.classList.remove("active"));
 document.querySelector("#"+mode).classList.add("active");
 atoms.forEach(a=>{
  const mesh=atomMeshes.get(a.id);
  const r=elements[a.symbol].radius;
  mesh.scale.setScalar(mode==="space"?1.85:1);
  mesh.material.color.set(mode==="lewis"?"#70d6bd":elements[a.symbol].color);
  mesh.material.wireframe=false;
 });
 drawBonds();
}
["ball","space","lewis"].forEach(id=>
 document.querySelector("#"+id).onclick=()=>setView(id)
);

function selectAtom(atom){
 if(selected.includes(atom)){
  selected=selected.filter(x=>x!==atom);
 }else{
  if(selected.length>=2)selected.shift();
  selected.push(atom);
 }
 refreshSelection();
}
function refreshSelection(){
 atoms.forEach(a=>{
  const mesh=atomMeshes.get(a.id);
  const isSelected=selected.includes(a);
  mesh.material.emissive.set(isSelected?"#245c56":"#000000");
  mesh.material.emissiveIntensity=isSelected?.8:0;
 });
 const box=document.querySelector("#selectedInfo");
 if(!selected.length){
  box.textContent="No atoms selected.";
 }else{
  box.innerHTML=selected.map(a=>
   `<b>${elements[a.symbol].name} (${a.symbol})</b><br>Atom ID: ${a.id}<br>Valence electrons: ${{H:1,C:4,O:6,N:5,Cl:7,S:6,F:7}[a.symbol]}`
  ).join("<hr>");
 }
}

document.querySelector("#makeBond").onclick=()=>{
 if(selected.length!==2){say("Select exactly two atoms first.");return;}
 if(addBond(selected[0],selected[1],bondOrder)){
  say("Bond created.");
  selected=[];
  refreshSelection();
 }
};

["single","double","triple"].forEach((id,i)=>{
 document.querySelector("#"+id).onclick=()=>{
  bondOrder=i+1;
  ["single","double","triple"].forEach(x=>document.querySelector("#"+x).classList.remove("active"));
  document.querySelector("#"+id).classList.add("active");
 };
});

function deleteSelected(){
 if(!selected.length)return;
 const ids=new Set(selected.map(a=>a.id));
 atoms=atoms.filter(a=>!ids.has(a.id));
 bonds=bonds.filter(b=>!ids.has(b.a.id)&&!ids.has(b.b.id));
 selected.forEach(a=>{
  scene.remove(atomMeshes.get(a.id));
  atomMeshes.delete(a.id);
 });
 selected=[];
 drawBonds();refreshSelection();update();
 say("Selected atoms deleted.");
}
document.querySelector("#delete").onclick=deleteSelected;

function clearAll(){
 atoms=[];bonds=[];selected=[];
 atomMeshes.forEach(m=>scene.remove(m));
 atomMeshes.clear();
 drawBonds();refreshSelection();update();
 say("Workspace cleared.");
}
document.querySelector("#clear").onclick=clearAll;

function update(){
 const counts={};
 atoms.forEach(a=>counts[a.symbol]=(counts[a.symbol]||0)+1);
 const formula=Object.entries(counts)
  .sort(([a],[b])=>({C:0,H:1}[a]??2)-({C:0,H:1}[b]??2))
  .map(([s,n])=>s+(n>1?n:"")).join("")||"—";
 document.querySelector("#formula").textContent=formula;
 document.querySelector("#atomCount").textContent=atoms.length;
 document.querySelector("#bondCount").textContent=bonds.length;
 const invalid=atoms.some(a=>{
  const used=bonds.filter(b=>b.a===a||b.b===a).reduce((s,b)=>s+b.order,0);
  return used>elements[a.symbol].valence;
 });
 document.querySelector("#validity").textContent=invalid?"Check valence":"No valence overflow";
}

function say(msg){document.querySelector("#status").textContent=msg;}

function resize(){
 const w=workspace.clientWidth,h=workspace.clientHeight;
 camera.aspect=w/h;camera.updateProjectionMatrix();
 renderer.setSize(w,h,false);
}
new ResizeObserver(resize).observe(workspace);
resize();

canvas.addEventListener("pointerdown",e=>{
 if(e.button!==0)return;
 const rect=canvas.getBoundingClientRect();
 pointer.x=((e.clientX-rect.left)/rect.width)*2-1;
 pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;
 raycaster.setFromCamera(pointer,camera);
 const hits=raycaster.intersectObjects([...atomMeshes.values()]);
 if(hits.length){
  selectAtom(hits[0].object.userData.atom);
 }
});

workspace.addEventListener("dragover",e=>{
 e.preventDefault();
 document.querySelector("#dropmsg").style.display="flex";
});
workspace.addEventListener("dragleave",e=>{
 if(!workspace.contains(e.relatedTarget))
  document.querySelector("#dropmsg").style.display="none";
});
workspace.addEventListener("drop",e=>{
 e.preventDefault();
 document.querySelector("#dropmsg").style.display="none";
 const data=e.dataTransfer.getData("application/x-molecule");
 if(!data)return;
 const item=JSON.parse(data);
 const rect=canvas.getBoundingClientRect();
 pointer.x=((e.clientX-rect.left)/rect.width)*2-1;
 pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;
 raycaster.setFromCamera(pointer,camera);
 raycaster.ray.intersectPlane(dropPlane,dropPoint);
 if(item.type==="atom"){
  addAtom(item.symbol,[dropPoint.x,dropPoint.y,0]);
  say(item.symbol+" added.");
 }else if(item.type==="template"){
  addTemplate(item.name,[dropPoint.x,dropPoint.y,0]);
 }
});

document.querySelector("#reset").onclick=()=>{
 camera.position.set(5,6,10);
 controls.target.set(0,0,0);
 controls.update();
};

function animate(){
 requestAnimationFrame(animate);
 controls.update();
 renderer.render(scene,camera);
}
animate();
update();
