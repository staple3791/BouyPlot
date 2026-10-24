'use strict';

// BuoyPlot: dependency-free, static sailing mark planner.
// The chart background uses live OpenStreetMap tiles; marks and navigation do not depend on those tiles.
const STORAGE_KEY = 'buoyplot-courses-v1';
const TILE_SIZE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;
const DEFAULT_VIEW = {lat: -33.82, lon: 151.235, zoom: 14}; // Starting map view: Sydney Harbour
const $ = id => document.getElementById(id);
const canvas = $('map');
const ctx = canvas.getContext('2d');
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const freshCourse = name => ({id:uid(), name, marks:[]});
const baseState = () => {const course = freshCourse('My sailing course'); return {version:1, courses:[course], activeCourseId:course.id};};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return baseState();
    const data = JSON.parse(raw);
    if(!data || !Array.isArray(data.courses) || !data.courses.length) return baseState();
    const courses = data.courses.filter(c => c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.marks)).slice(0,50).map(c => ({
      id:c.id, name:c.name.slice(0,80), marks:c.marks.filter(m => m && typeof m.id === 'string' && Number.isFinite(m.lat) && Number.isFinite(m.lon) && Math.abs(m.lat)<=90 && Math.abs(m.lon)<=180).slice(0,250).map(m => ({
        id:m.id, name:String(m.name || 'Mark').slice(0,60), lat:m.lat, lon:m.lon,
        laid:m.laid && Number.isFinite(m.laid.lat) && Number.isFinite(m.laid.lon) ? m.laid : null
      }))
    }));
    if(!courses.length) return baseState();
    return {version:1,courses,activeCourseId:courses.some(c=>c.id===data.activeCourseId)?data.activeCourseId:courses[0].id};
  } catch(e) { return baseState(); }
}
let state = loadState();
const getCourse = () => state.courses.find(c=>c.id===state.activeCourseId) || state.courses[0];
const getMark = () => getCourse().marks.find(m=>m.id===selectedId) || null;
let selectedId = null;
let mode = 'browse'; // browse, add, move
let view = {...DEFAULT_VIEW};
let mapWidth = 400;
let mapHeight = 400;
let renderPending = false;
let gpsWatch = null;
let gpsPoint = null;
let gpsError = '';
let followGPS = false;
let toastTimer = 0;
const tileCache = new Map();
const pointers = new Map();
let drag = null;
let pinchDistance = null;
let suppressTap = false;

function save() {
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }
  catch(e) { toast('Unable to save to device. Export a JSON backup.'); }
}
function toast(message) {
  const el=$('toast'); el.textContent=message; el.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3200);
}
function safeName(s) {return String(s||'').trim().slice(0,60);}
function toRad(deg) {return deg * Math.PI/180;}
function toDeg(rad) {return rad * 180/Math.PI;}
function distanceMeters(a,b) {
  const dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon);
  const h=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return 6371008.8 * 2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
function trueBearing(a,b) {
  const f1=toRad(a.lat),f2=toRad(b.lat),dl=toRad(b.lon-a.lon);
  const y=Math.sin(dl)*Math.cos(f2);
  const x=Math.cos(f1)*Math.sin(f2)-Math.sin(f1)*Math.cos(f2)*Math.cos(dl);
  return (toDeg(Math.atan2(y,x))+360)%360;
}
function formatDist(m) {return m<2000?`${Math.round(m)} m`:`${(m/1852).toFixed(2)} NM`;}
function splitDist(m) {if(m<2000)return [String(Math.round(m)),'m']; return [(m/1852).toFixed(2),'NM'];}
function prettyCoord(n) {return n.toFixed(6);}
function isValidCoord(lat,lon) {return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-85&&lat<=85&&lon>=-180&&lon<=180;}

function updateCourseSelect() {
  const sel=$('courseSelect');sel.innerHTML='';
  state.courses.forEach(c=>{const option=document.createElement('option');option.value=c.id;option.textContent=c.name;sel.appendChild(option);});
  sel.value=state.activeCourseId;
}
function pickMark(id) {
  selectedId=id; mode='browse'; updateUI();
}
function updateUI() {
  const course=getCourse(), selected=getMark();
  $('markCount').textContent=course.marks.length;
  $('emptyState').hidden=course.marks.length>0;
  $('editSection').hidden=!selected;
  $('targetName').textContent=selected?selected.name:'Choose a mark';
  $('targetStatus').textContent=selected?(selected.laid?'Buoy laid':'Target ready'):'No mark selected';
  const isAdding=mode==='add',isMoving=mode==='move';
  $('addButton').classList.toggle('active',isAdding);
  $('addButton').innerHTML=isAdding?'× Cancel adding':'<span class="plus-icon">+</span> Add mark';
  $('moveButton').hidden=!selected;
  $('moveButton').textContent=isMoving?'× Cancel moving':'Move selected';
  $('mapInstruction').hidden=!(isAdding||isMoving);
  if(isAdding)$('mapInstruction').textContent='Tap the map where you want to set the next mark.';
  if(isMoving)$('mapInstruction').textContent=`Tap a new map position for ${selected?.name||'this mark'}.`;
  if(selected) {
    $('markName').value=selected.name;
    $('markLat').value=prettyCoord(selected.lat);
    $('markLon').value=prettyCoord(selected.lon);
    $('laidButton').textContent=selected.laid?'Clear laid record':'Record buoy laid here';
    $('laidDetail').textContent=selected.laid ? `Laid at ${prettyCoord(selected.laid.lat)}, ${prettyCoord(selected.laid.lon)}. Offset: ${formatDist(distanceMeters(selected, selected.laid))}.` : 'When you lay the buoy, record your current GPS position to compare it with the planned mark.';
  }
  renderList(); updateNavigation(); updateGpsStatus(); requestRender();
}
function renderList() {
  const list=$('markList');list.innerHTML='';
  getCourse().marks.forEach((mark,i)=>{
    const button=document.createElement('button');
    button.type='button';button.className=`mark-row${selectedId===mark.id?' selected':''}${mark.laid?' laid':''}`;
    const n=document.createElement('span');n.className='mark-number';n.textContent=i+1;
    const info=document.createElement('span');info.className='mark-info';
    const title=document.createElement('span');title.className='mark-title';title.textContent=mark.name;
    const sub=document.createElement('span');sub.className='mark-sub';sub.textContent=`${prettyCoord(mark.lat)}, ${prettyCoord(mark.lon)}`;
    info.append(title,sub);
    const right=document.createElement('span');right.className='mark-right';
    if(gpsPoint){const dist=document.createElement('span');dist.className='mark-dist';dist.textContent=formatDist(distanceMeters(gpsPoint,mark));right.appendChild(dist);}
    if(mark.laid){const done=document.createElement('span');done.className='mark-laid';done.textContent='LAID ✓';right.appendChild(done);}
    button.append(n,info,right);
    button.addEventListener('click',()=>pickMark(mark.id));list.appendChild(button);
  });
}
function updateNavigation() {
  const mark=getMark();
  if(mark&&gpsPoint) {
    const [num,unit]=splitDist(distanceMeters(gpsPoint,mark));
    $('distance').innerHTML=`${num}<span class="figure-unit"> ${unit}</span>`;
    $('bearing').innerHTML=`${Math.round(trueBearing(gpsPoint,mark)).toString().padStart(3,'0')}<span class="figure-unit">°</span>`;
    const accuracy=Math.round(gpsPoint.accuracy);
    $('navDetail').textContent=`GPS accuracy: ±${accuracy} m${accuracy>20?' (low precision: verify visually)':''}. Bearing is true north, not compass/magnetic.`;
  }else{
    $('distance').innerHTML='--<span class="figure-unit"> m</span>';
    $('bearing').innerHTML='--<span class="figure-unit">°</span>';
    $('navDetail').textContent=mark?'Start GPS to see your distance and bearing.':'Select a mark, then start GPS for live guidance.';
  }
}
function updateGpsStatus() {
  const el=$('gpsStatus');el.classList.toggle('active',gpsWatch!==null&&!!gpsPoint);
  el.classList.toggle('error',!!gpsError);
  el.innerHTML=`<span class="status-dot"></span> ${gpsError?'GPS unavailable':gpsWatch===null?'GPS off':gpsPoint?`GPS ±${Math.round(gpsPoint.accuracy)} m`:'Locating…'}`;
  $('gpsButton').classList.toggle('active',gpsWatch!==null);
  $('centreButton').classList.toggle('active',followGPS);
}
function addMark(lat,lon) {
  const course=getCourse();
  if(course.marks.length>=250){toast('This course has reached 250 marks.');return;}
  const numbers=course.marks.map(m=>Number((m.name.match(/^Mark (\d+)$/)||[])[1])).filter(Boolean);
  let n=1;while(numbers.includes(n))n++;
  const mark={id:uid(),name:`Mark ${n}`,lat,lon,laid:null};
  course.marks.push(mark);selectedId=mark.id;mode='browse';save();updateUI();toast(`${mark.name} added`);
}

// --- Slippy map math (Web Mercator) ---
function worldPoint(lat,lon,zoom) {
  const scale=TILE_SIZE*2**zoom,clamped=Math.max(-85.05112878,Math.min(85.05112878,lat));
  const r=toRad(clamped);
  return {x:(lon+180)/360*scale,y:(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*scale};
}
function geoPoint(x,y,zoom) {
  const scale=TILE_SIZE*2**zoom;
  const n=Math.PI-2*Math.PI*y/scale;
  return {lat:toDeg(Math.atan(Math.sinh(n))),lon:((x/scale*360)%360+360)%360-180};
}
function mapPoint(lat,lon) {
  const c=worldPoint(view.lat,view.lon,view.zoom),p=worldPoint(lat,lon,view.zoom),worldWidth=TILE_SIZE*2**view.zoom;
  let dx=p.x-c.x;
  if(dx>worldWidth/2)dx-=worldWidth;
  if(dx<-worldWidth/2)dx+=worldWidth;
  return {x:mapWidth/2+dx,y:mapHeight/2+p.y-c.y};
}
function geoAt(x,y) {
  const center=worldPoint(view.lat,view.lon,view.zoom);
  return geoPoint(center.x+x-mapWidth/2,center.y+y-mapHeight/2,view.zoom);
}
function setCenter(lat,lon) {view.lat=Math.max(-85,Math.min(85,lat));view.lon=((lon+180)%360+360)%360-180;requestRender();}
function panBy(dx,dy) {
  const c=worldPoint(view.lat,view.lon,view.zoom);
  const dest=geoPoint(c.x-dx,c.y-dy,view.zoom);
  setCenter(dest.lat,dest.lon);followGPS=false;updateGpsStatus();
}
function changeZoom(delta,aroundX=mapWidth/2,aroundY=mapHeight/2) {
  const next=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,view.zoom+delta));if(next===view.zoom)return;
  const anchor=geoAt(aroundX,aroundY);view.zoom=next;
  const anchorWorld=worldPoint(anchor.lat,anchor.lon,next);
  const center=geoPoint(anchorWorld.x-(aroundX-mapWidth/2),anchorWorld.y-(aroundY-mapHeight/2),next);
  setCenter(center.lat,center.lon);
}
function resize() {
  const rect=canvas.getBoundingClientRect();
  mapWidth=Math.max(1,rect.width);mapHeight=Math.max(1,rect.height);
  const dpr=Math.min(3,window.devicePixelRatio||1);
  canvas.width=Math.round(mapWidth*dpr);canvas.height=Math.round(mapHeight*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  requestRender();
}
function requestRender() {
  if(renderPending)return;
  renderPending=true;
  requestAnimationFrame(()=>{renderPending=false;draw();});
}
function getTile(z,x,y) {
  const count=2**z;if(y<0||y>=count)return null;
  const xx=((x%count)+count)%count;
  const key=`${z}/${xx}/${y}`;
  let tile=tileCache.get(key);
  if(!tile) {
    const img=new Image();tile={img,ready:false,error:false};tileCache.set(key,tile);
    img.onload=()=>{tile.ready=true;requestRender();};
    img.onerror=()=>{tile.error=true;requestRender();};
    img.src=`https://tile.openstreetmap.org/${key}.png`;
    if(tileCache.size>350) {for(const [oldKey] of tileCache) {if(tileCache.size<=250)break;tileCache.delete(oldKey);}}
  }
  return tile;
}
function draw() {
  if(!mapWidth||!mapHeight)return;
  ctx.clearRect(0,0,mapWidth,mapHeight);
  ctx.fillStyle='#deedf0';ctx.fillRect(0,0,mapWidth,mapHeight);
  const c=worldPoint(view.lat,view.lon,view.zoom);
  const left=c.x-mapWidth/2,top=c.y-mapHeight/2;
  const minX=Math.floor(left/TILE_SIZE),minY=Math.floor(top/TILE_SIZE);
  const maxX=Math.ceil((left+mapWidth)/TILE_SIZE),maxY=Math.ceil((top+mapHeight)/TILE_SIZE);
  for(let x=minX;x<maxX;x++)for(let y=minY;y<maxY;y++) {
    const sx=Math.round(x*TILE_SIZE-left),sy=Math.round(y*TILE_SIZE-top);
    const tile=getTile(view.zoom,x,y);
    if(tile&&tile.ready)ctx.drawImage(tile.img,sx,sy,TILE_SIZE+0.5,TILE_SIZE+0.5);
    else {ctx.strokeStyle='#cbdee0';ctx.lineWidth=.7;ctx.strokeRect(sx,sy,TILE_SIZE,TILE_SIZE);}
  }
  const selected=getMark();
  if(selected&&gpsPoint) {
    const a=mapPoint(gpsPoint.lat,gpsPoint.lon),b=mapPoint(selected.lat,selected.lon);
    ctx.save();ctx.strokeStyle='#1f8793';ctx.lineWidth=2.5;ctx.setLineDash([9,7]);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore();
  }
  getCourse().marks.forEach((mark,i)=>{
    const {x,y}=mapPoint(mark.lat,mark.lon);
    if(x<-90||y<-60||x>mapWidth+90||y>mapHeight+90)return;
    const selectedMark=selectedId===mark.id;
    ctx.save();ctx.translate(x,y);
    if(selectedMark){ctx.fillStyle='rgba(6,117,125,.16)';ctx.beginPath();ctx.arc(0,-9,26,0,2*Math.PI);ctx.fill();}
    ctx.fillStyle=mark.laid?'#22866a':'#e58c35';ctx.strokeStyle='#fff';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(0,9);ctx.lineTo(-11,-5);ctx.arc(0,-10,13,Math.PI*.78,Math.PI*2.22);ctx.lineTo(11,-5);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 13px system-ui,sans-serif';
    ctx.fillText(String(i+1),0,-11);
    const label=mark.name.slice(0,24);ctx.font=`${selectedMark?'bold ':''}12px system-ui,sans-serif`;
    const width=ctx.measureText(label).width+14;
    roundRect(ctx,-width/2,14,width,24,6);ctx.fillStyle=selectedMark?'#102b39':'#fff';ctx.fill();
    ctx.strokeStyle='#dae9ea';ctx.lineWidth=1;ctx.stroke();
    ctx.fillStyle=selectedMark?'#fff':'#183541';ctx.fillText(label,0,26);
    ctx.restore();
  });
  if(gpsPoint){
    const p=mapPoint(gpsPoint.lat,gpsPoint.lon);
    const resolution=156543.03392*Math.cos(toRad(gpsPoint.lat))/2**view.zoom;
    const radius=Math.min(500,Math.max(6,gpsPoint.accuracy/resolution));
    ctx.fillStyle='rgba(46,126,226,.11)';ctx.strokeStyle='rgba(46,126,226,.23)';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle='#2885e7';ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.fill();ctx.stroke();
  }
  if(!navigator.onLine) {
    roundRect(ctx,14,mapHeight/2-20,Math.min(mapWidth-28,330),39,8);
    ctx.fillStyle='rgba(16,43,57,.88)';ctx.fill();
    ctx.fillStyle='#fff';ctx.font='12px system-ui,sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
    ctx.fillText('Offline: chart tiles may be unavailable',23,mapHeight/2);
  }
}
function roundRect(context,x,y,w,h,r) {
  context.beginPath();context.moveTo(x+r,y);context.arcTo(x+w,y,x+w,y+h,r);context.arcTo(x+w,y+h,x,y+h,r);context.arcTo(x,y+h,x,y,r);context.arcTo(x,y,x+w,y,r);context.closePath();
}
function pointEvent(e){const rect=canvas.getBoundingClientRect();return{x:e.clientX-rect.left,y:e.clientY-rect.top};}
function pointerGap(){const p=[...pointers.values()];if(p.length<2)return 0;return Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);}
function pointerMid(){const p=[...pointers.values()];return{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2};}
function handleTap(p) {
  const geo=geoAt(p.x,p.y);
  if(mode==='add'){addMark(geo.lat,geo.lon);return;}
  if(mode==='move'){
    const mark=getMark();if(!mark)return;
    mark.lat=geo.lat;mark.lon=geo.lon;mark.laid=null;mode='browse';save();updateUI();toast(`${mark.name} moved`);return;
  }
  let nearest=null,dist=28;
  for(const m of getCourse().marks){const pt=mapPoint(m.lat,m.lon);const d=Math.hypot(pt.x-p.x,pt.y-9-p.y);if(d<dist){nearest=m;dist=d;}}
  if(nearest)pickMark(nearest.id);
}
canvas.addEventListener('pointerdown',e=>{
  e.preventDefault();canvas.setPointerCapture(e.pointerId);
  const p=pointEvent(e);pointers.set(e.pointerId,p);
  if(pointers.size===1){drag={...p,startX:p.x,startY:p.y,moved:false};suppressTap=false;}
  else if(pointers.size===2){pinchDistance=pointerGap();drag=null;suppressTap=true;}
});
canvas.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId))return;
  const old=pointers.get(e.pointerId);const current=pointEvent(e);
  if(pointers.size===1 && drag){
    if(Math.hypot(current.x-drag.startX,current.y-drag.startY)>6)drag.moved=true;
    if(drag.moved)panBy(current.x-old.x,current.y-old.y);
  } else if(pointers.size===2){
    const before=pointerMid();pointers.set(e.pointerId,current);
    const after=pointerMid();panBy(after.x-before.x,after.y-before.y);
    const gap=pointerGap();if(pinchDistance){
      if(gap>pinchDistance*1.30){changeZoom(1,after.x,after.y);pinchDistance=gap;}
      if(gap<pinchDistance/1.30){changeZoom(-1,after.x,after.y);pinchDistance=gap;}
    }
    return;
  }
  pointers.set(e.pointerId,current);
});
function endPointer(e){
  const p=pointers.get(e.pointerId);if(!p)return;
  const isTap=pointers.size===1&&drag&&!drag.moved&&!suppressTap;
  pointers.delete(e.pointerId);
  if(pointers.size<=1){drag=null;pinchDistance=null;suppressTap=true;}
  if(isTap)handleTap(p);
}
canvas.addEventListener('pointerup',endPointer);
canvas.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);drag=null;pinchDistance=null;suppressTap=true;});
canvas.addEventListener('wheel',e=>{e.preventDefault();const p=pointEvent(e);changeZoom(e.deltaY<0?1:-1,p.x,p.y);},{passive:false});
canvas.addEventListener('dblclick',e=>{e.preventDefault();const p=pointEvent(e);changeZoom(1,p.x,p.y);});

function fitAll() {
  const positions=getCourse().marks.map(m=>({lat:m.lat,lon:m.lon}));
  if(gpsPoint)positions.push(gpsPoint);
  if(!positions.length){toast('Add marks or start GPS to fit the map.');return;}
  if(positions.length===1){view.zoom=Math.max(view.zoom,16);setCenter(positions[0].lat,positions[0].lon);return;}
  const maxLat=Math.max(...positions.map(p=>p.lat)),minLat=Math.min(...positions.map(p=>p.lat));
  const maxLon=Math.max(...positions.map(p=>p.lon)),minLon=Math.min(...positions.map(p=>p.lon));
  for(let z=MAX_ZOOM;z>=MIN_ZOOM;z--){
    const nw=worldPoint(maxLat,minLon,z),se=worldPoint(minLat,maxLon,z);
    if(se.x-nw.x<Math.max(80,mapWidth-120)&&se.y-nw.y<Math.max(80,mapHeight-120)){
      view.zoom=z;const mid=geoPoint((nw.x+se.x)/2,(nw.y+se.y)/2,z);setCenter(mid.lat,mid.lon);return;
    }
  }
  view.zoom=MIN_ZOOM;setCenter((minLat+maxLat)/2,(minLon+maxLon)/2);
}

// --- GPS ---
function startGps() {
  if(!navigator.geolocation){gpsError='Unsupported';toast('This browser does not offer device location.');updateGpsStatus();return;}
  if(!window.isSecureContext){gpsError='HTTPS required';toast('GPS requires HTTPS. Publish the app with GitHub Pages first.');updateGpsStatus();return;}
  gpsError='';gpsPoint=null;followGPS=true;
  const options={enableHighAccuracy:true,maximumAge:1000,timeout:20000};
  try {
    gpsWatch=navigator.geolocation.watchPosition(pos=>{
      const wasEmpty=!gpsPoint;
      gpsPoint={lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy,time:pos.timestamp};
      gpsError='';
      if(followGPS && (wasEmpty || gpsPoint))setCenter(gpsPoint.lat,gpsPoint.lon);
      updateGpsStatus();updateNavigation();renderList();requestRender();
    },err=>{
      gpsError=err.code===1?'Permission denied':err.code===2?'Position unavailable':'GPS timeout';
      updateGpsStatus();toast(`${gpsError}. Check Location Services and Safari site permissions.`);
    },options);
    updateGpsStatus();
  }catch(e){gpsError='GPS error';gpsWatch=null;updateGpsStatus();toast('Unable to start GPS on this device.');}
}
function stopGps(){if(gpsWatch!==null)navigator.geolocation.clearWatch(gpsWatch);gpsWatch=null;gpsPoint=null;gpsError='';followGPS=false;updateUI();}

// --- Export / backup ---
function downloadText(name,text,mime) {
  const blob=new Blob([text],{type:mime}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2500);
}
function fileSafeName(text){return (text||'course').toLowerCase().replace(/[^a-z0-9\-_]+/g,'-').replace(/^-|-$/g,'').slice(0,55)||'course';}
function xmlEsc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function exportGPX(){
  const c=getCourse();
  if(!c.marks.length){toast('Add a mark before exporting GPX.');return;}
  let gpx=`<?xml version="1.0" encoding="utf-8"?>\n<gpx version="1.1" creator="BuoyPlot" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${xmlEsc(c.name)}</name></metadata>\n`;
  for(const m of c.marks){
    gpx+=`  <wpt lat="${m.lat.toFixed(8)}" lon="${m.lon.toFixed(8)}"><name>${xmlEsc(m.name)}</name><sym>Buoy</sym></wpt>\n`;
  }
  gpx+='</gpx>\n';downloadText(`${fileSafeName(c.name)}.gpx`,gpx,'application/gpx+xml');toast('GPX waypoints exported');
}
function exportJSON(){
  downloadText('buoyplot-backup.json',JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2),'application/json');
  toast('Backup exported');
}
function importJSON(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const parsed=JSON.parse(String(reader.result));
      if(parsed.version!==1||!Array.isArray(parsed.courses)||!parsed.courses.length)throw new Error('Invalid BuoyPlot backup');
      const normalized=parsed.courses.filter(c=>c&&Array.isArray(c.marks)&&typeof c.name==='string').map(c=>({
        id:uid(),name:c.name.slice(0,80),marks:c.marks.filter(m=>m&&isValidCoord(Number(m.lat),Number(m.lon))).slice(0,250).map(m=>({
          id:uid(),name:safeName(m.name)||'Mark',lat:Number(m.lat),lon:Number(m.lon),laid:m.laid&&isValidCoord(Number(m.laid.lat),Number(m.laid.lon))?{lat:Number(m.laid.lat),lon:Number(m.laid.lon),accuracy:Number(m.laid.accuracy)||0,time:String(m.laid.time||'')}:null
        }))
      })).slice(0,50);
      if(!normalized.length)throw new Error('No courses found');
      if(!confirm(`Import ${normalized.length} course(s) from this backup? Existing courses will be kept.`))return;
      state.courses.push(...normalized);state.activeCourseId=normalized[0].id;selectedId=null;mode='browse';save();updateCourseSelect();updateUI();fitAll();toast('Backup imported');
    }catch(e){toast('Could not import: not a valid BuoyPlot JSON backup.');}
  };
  reader.readAsText(file);
}

// --- Controls ---
$('newCourse').addEventListener('click',()=>{
  const name=prompt('New course name:',`Course ${state.courses.length+1}`);if(name===null)return;
  if(!safeName(name)){toast('Please enter a course name.');return;}
  if(state.courses.length>=50){toast('Maximum 50 courses on this device.');return;}
  const course=freshCourse(safeName(name));state.courses.push(course);state.activeCourseId=course.id;selectedId=null;mode='browse';save();updateCourseSelect();updateUI();toast('Course created');
});
$('courseSelect').addEventListener('change',e=>{
  state.activeCourseId=e.target.value;selectedId=null;mode='browse';save();updateUI();if(getCourse().marks.length)fitAll();
});
$('renameCourse').addEventListener('click',()=>{
  const c=getCourse();const name=prompt('Rename this course:',c.name);if(name===null)return;
  if(!safeName(name)){toast('Please enter a course name.');return;}
  c.name=safeName(name);save();updateCourseSelect();toast('Course renamed');
});
$('addButton').addEventListener('click',()=>{mode=mode==='add'?'browse':'add';updateUI();});
$('moveButton').addEventListener('click',()=>{if(!getMark())return;mode=mode==='move'?'browse':'move';updateUI();});
$('saveMark').addEventListener('click',()=>{
  const mark=getMark();if(!mark)return;
  const name=safeName($('markName').value),lat=Number($('markLat').value),lon=Number($('markLon').value);
  if(!name){toast('Please enter a mark name.');return;}
  if(!$('markLat').value.trim()||!$('markLon').value.trim()||!isValidCoord(lat,lon)){
    toast('Enter valid latitude and longitude coordinates.');return;
  }
  mark.name=name;mark.lat=lat;mark.lon=lon;save();updateUI();toast('Mark updated');
});
$('deleteMark').addEventListener('click',()=>{
  const mark=getMark();if(!mark)return;
  if(!confirm(`Delete ${mark.name}?`))return;
  getCourse().marks=getCourse().marks.filter(m=>m.id!==mark.id);
  selectedId=null;mode='browse';save();updateUI();toast('Mark deleted');
});
$('laidButton').addEventListener('click',()=>{
  const mark=getMark();if(!mark)return;
  if(mark.laid){if(!confirm(`Clear the actual laid position for ${mark.name}?`))return;mark.laid=null;save();updateUI();return;}
  if(!gpsPoint){toast('Start GPS and wait for a location fix first.');return;}
  if(gpsPoint.accuracy>25&&!confirm(`GPS accuracy is only ±${Math.round(gpsPoint.accuracy)} m. Record this position anyway?`))return;
  mark.laid={lat:gpsPoint.lat,lon:gpsPoint.lon,accuracy:gpsPoint.accuracy,time:new Date().toISOString()};
  save();updateUI();toast(`Laid position recorded (${formatDist(distanceMeters(mark,mark.laid))} from target)`);
});
$('gpsButton').addEventListener('click',()=>gpsWatch===null?startGps():stopGps());
$('centreButton').addEventListener('click',()=>{
  if(!gpsPoint){toast('Start GPS to centre on your position.');return;}
  followGPS=true;setCenter(gpsPoint.lat,gpsPoint.lon);updateGpsStatus();
});
$('zoomIn').addEventListener('click',()=>changeZoom(1));
$('zoomOut').addEventListener('click',()=>changeZoom(-1));
$('fitButton').addEventListener('click',fitAll);
$('exportGpx').addEventListener('click',exportGPX);
$('backupJson').addEventListener('click',exportJSON);
$('restoreJson').addEventListener('click',()=>$('importFile').click());
$('importFile').addEventListener('change',e=>{importJSON(e.target.files?.[0]);e.target.value='';});
window.addEventListener('offline',()=>{toast('Offline: previously opened map tiles may be missing. GPS may still work.');requestRender();});
window.addEventListener('online',()=>{tileCache.clear();requestRender();});
window.addEventListener('resize',resize);
if(window.ResizeObserver)new ResizeObserver(resize).observe(canvas);
if('serviceWorker' in navigator && window.isSecureContext)navigator.serviceWorker.register('./sw.js').catch(()=>{});

// Initialise. If the device has a saved course, show the marks instead of the default harbour view.
updateCourseSelect();updateUI();resize();
if(getCourse().marks.length)fitAll();
