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
const POINT_TYPES=['buoy','pin','boat'];
const normalizeType=type=>POINT_TYPES.includes(type)?type:'buoy';
const defaultLayout=()=>({windFrom:45,windVisible:true,lineLength:80,legLength:350,leewardOffset:50,autoAlignMarks:true,squareToWind:false});
const normalizeLayout=x=>({windFrom:Number.isFinite(Number(x?.windFrom))?((Math.round(Number(x.windFrom))%360)+360)%360:45,windVisible:x?.windVisible!==false,lineLength:validLength(x?.lineLength,10,2000,80),legLength:validLength(x?.legLength,10,10000,350),leewardOffset:validLength(x?.leewardOffset,0,2000,50),autoAlignMarks:x?.autoAlignMarks!==false,squareToWind:x?.squareToWind===true});
function validLength(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:fallback;}
const freshCourse = name => ({id:uid(), name, marks:[],layout:defaultLayout()});
const baseState = () => {const course = freshCourse('My sailing course'); return {version:2,courses:[course], activeCourseId:course.id};};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return baseState();
    const data = JSON.parse(raw);
    if(!data || !Array.isArray(data.courses) || !data.courses.length) return baseState();
    const courses = data.courses.filter(c => c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.marks)).slice(0,50).map(c => ({
      id:c.id, name:c.name.slice(0,80),layout:normalizeLayout(c.layout), marks:c.marks.filter(m => m && typeof m.id === 'string' && Number.isFinite(m.lat) && Number.isFinite(m.lon) && Math.abs(m.lat)<=90 && Math.abs(m.lon)<=180).slice(0,250).map(m => ({
        id:m.id, name:String(m.name || 'Mark').slice(0,60), lat:m.lat, lon:m.lon, type:normalizeType(m.type),generatedRole:['windward','leeward'].includes(m.generatedRole)?m.generatedRole:null,
        laid:m.laid && Number.isFinite(m.laid.lat) && Number.isFinite(m.laid.lon) ? m.laid : null
      }))
    }));
    if(!courses.length) return baseState();
    return {version:2,courses,activeCourseId:courses.some(c=>c.id===data.activeCourseId)?data.activeCourseId:courses[0].id};
  } catch(e) { return baseState(); }
}
let state = loadState();
const getCourse = () => state.courses.find(c=>c.id===state.activeCourseId) || state.courses[0];
const getMark = () => getCourse().marks.find(m=>m.id===selectedId) || null;
let selectedId = null;
let mode = 'browse'; // browse, add, move, course
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
const windCanvas=$('windLayer');
const windCtx=windCanvas.getContext('2d');
let windLast=0;
let windTick=0;
let windAnimationId=0;
let sheetState='peek';
let sheetDrag=null;
const SHEET_STATES=['peek','half','full'];
function sheetHeights(){
  const h=$('workspace').clientHeight||700;
  const peek=104,full=Math.max(peek+60,h-10);
  return {peek,half:Math.min(full-90,Math.max(peek+85,Math.round(h*.48))),full};
}
function visibleSheetHeight(){return window.innerWidth<=760?sheetHeights()[sheetState]:0;}
function visibleMapHeight(){return window.innerWidth<=760?Math.max(120,mapHeight-visibleSheetHeight()):mapHeight;}
function mapCenterY(){return visibleMapHeight()/2;}
function setSheetState(next){
  if(!SHEET_STATES.includes(next))return;
  sheetState=next;
  const height=sheetHeights()[sheetState];
  $('workspace').style.setProperty('--sheet-visible',height+'px');
  $('workspace').dataset.sheet=sheetState;
  $('sheetHandle').setAttribute('aria-expanded',String(sheetState!=='peek'));
  $('sheetHandle').setAttribute('aria-label',sheetState==='full'?'Collapse course controls':'Expand course controls');
  requestRender();
}
function cycleSheet(){setSheetState(sheetState==='peek'?'half':sheetState==='half'?'full':'peek');}
function updateSheetSummary(){
  const mark=getMark();
  $('sheetSummary').textContent=mark?mark.name:'Swipe up to plan your course';
  $('sheetMiniNav').textContent=mark&&gpsPoint?formatDist(distanceMeters(gpsPoint,mark)):getCourse().marks.length+' points';
}
const sheetHandle=$('sheetHandle');
sheetHandle.addEventListener('pointerdown',e=>{
  if(window.innerWidth>760)return;
  e.preventDefault();sheetHandle.setPointerCapture(e.pointerId);
  sheetDrag={id:e.pointerId,y:e.clientY,initial:sheetHeights()[sheetState],current:sheetHeights()[sheetState],moved:false};
  $('workspace').classList.add('sheet-dragging');
});
sheetHandle.addEventListener('pointermove',e=>{
  if(!sheetDrag||e.pointerId!==sheetDrag.id)return;
  const heights=sheetHeights();
  sheetDrag.current=Math.max(heights.peek,Math.min(heights.full,sheetDrag.initial+sheetDrag.y-e.clientY));
  if(Math.abs(e.clientY-sheetDrag.y)>9)sheetDrag.moved=true;
  $('workspace').style.setProperty('--sheet-visible',sheetDrag.current+'px');
  requestRender();
});
function endSheetPointer(e){
  if(!sheetDrag||sheetDrag.id!==e.pointerId)return;
  const previous=sheetDrag;
  sheetDrag=null;
  $('workspace').classList.remove('sheet-dragging');
  if(!previous.moved){cycleSheet();return;}
  const heights=sheetHeights();
  const nearest=SHEET_STATES.reduce((a,b)=>Math.abs(heights[a]-previous.current)<Math.abs(heights[b]-previous.current)?a:b);
  setSheetState(nearest);
}
sheetHandle.addEventListener('pointerup',endSheetPointer);
sheetHandle.addEventListener('pointercancel',endSheetPointer);
sheetHandle.addEventListener('keydown',e=>{
  if(!['Enter',' ','ArrowDown','ArrowUp'].includes(e.key))return;
  e.preventDefault();
  if(e.key==='ArrowDown')setSheetState(sheetState==='full'?'half':'peek');
  else if(e.key==='ArrowUp')setSheetState(sheetState==='peek'?'half':'full');
  else cycleSheet();
});

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
function compass(deg) {return ['N','NE','E','SE','S','SW','W','NW'][Math.round(((deg%360)+360)%360/45)%8];}
function paddedBearing(deg) {return String(Math.round(deg)%360).padStart(3,'0')+'°';}
// Geodesic forward projection: from a known point, bearing clockwise from true north, and distance in metres.
function destination(point,bearing,metres) {
  const r=6371008.8, a=metres/r, b=toRad(bearing),lat1=toRad(point.lat),lon1=toRad(point.lon);
  const lat2=Math.asin(Math.sin(lat1)*Math.cos(a)+Math.cos(lat1)*Math.sin(a)*Math.cos(b));
  const lon2=lon1+Math.atan2(Math.sin(b)*Math.sin(a)*Math.cos(lat1),Math.cos(a)-Math.sin(lat1)*Math.sin(lat2));
  return {lat:toDeg(lat2),lon:((toDeg(lon2)+540)%360)-180};
}
function linePoints(){const marks=getCourse().marks;return {boat:marks.find(m=>m.type==='boat'),pin:marks.find(m=>m.type==='pin')};}
function startMidpoint(){
  const {boat,pin}=linePoints();if(!boat||!pin)return null;
  return destination(boat,trueBearing(boat,pin),distanceMeters(boat,pin)/2);
}
function maxPointsReached(count){if(getCourse().marks.length+count>250){toast('Maximum 250 course points reached.');return true;}return false;}


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
  updateLayoutControls();
  $('emptyState').hidden=course.marks.length>0;
  $('editSection').hidden=!selected;
  $('targetName').textContent=selected?selected.name:'Choose a mark';
  $('targetStatus').textContent=selected?(selected.laid?'Buoy laid':'Target ready'):'No mark selected';
  const isAdding=mode==='add',isMoving=mode==='move';
  $('addButton').classList.toggle('active',isAdding);
  $('addButton').innerHTML=isAdding?'× Cancel':'<span class="plus-icon">+</span> Add point';
  $('moveButton').hidden=!selected;
  $('moveButton').textContent=isMoving?'× Cancel moving':'Move selected';
  $('mapInstruction').hidden=!(isAdding||isMoving);
  if(isAdding)$('mapInstruction').textContent=`Tap the map to place ${typeLabel($('addType').value).toLowerCase()}.`;
  if(isMoving)$('mapInstruction').textContent=`Tap a new map position for ${selected?.name||'this mark'}.`;
  if(selected) {
    $('markName').value=selected.name;
    $('markType').value=selected.type||'buoy';
    $('markLat').value=prettyCoord(selected.lat);
    $('markLon').value=prettyCoord(selected.lon);
    $('laidButton').textContent=selected.laid?'Clear position record':selected.type==='boat'?'Record boat here':'Record mark laid here';
    $('laidDetail').textContent=selected.laid ? `Recorded at ${prettyCoord(selected.laid.lat)}, ${prettyCoord(selected.laid.lon)}. Offset: ${formatDist(distanceMeters(selected, selected.laid))}.` : selected.type==='boat'?'Record the boat’s actual GPS position once anchored, if useful.':'When you lay the mark, record its actual GPS position to compare with the plan.';
  }
  $('courseDragButton').classList.toggle('active',mode==='course');
  $('courseDragButton').setAttribute('aria-pressed',String(mode==='course'));
  $('planModeToggle').classList.toggle('active',mode==='course');
  $('planModeToggle').setAttribute('aria-pressed',String(mode==='course'));
  $('planModeToggle').textContent=mode==='course'?'Move course: On':'Move course: Off';
  if(mode==='course'){$('mapInstruction').hidden=false;$('mapInstruction').textContent='Drag the start line to move the start boat, pin and linked W/L marks together.';}
  renderList(); updateNavigation(); updateGpsStatus(); updateSheetSummary();requestRender();
}
function renderList() {
  const list=$('markList');list.innerHTML='';
  getCourse().marks.forEach((mark,i)=>{
    const button=document.createElement('button');
    button.type='button';button.className=`mark-row${selectedId===mark.id?' selected':''}${mark.laid?' laid':''}`;
    const n=document.createElement('span');n.className='mark-number '+(mark.type||'buoy');n.textContent=mark.type==='boat'?'⛵':mark.type==='pin'?'P':String(i+1);
    const info=document.createElement('span');info.className='mark-info';
    const title=document.createElement('span');title.className='mark-title';title.textContent=mark.name;
    const sub=document.createElement('span');sub.className='mark-sub';sub.textContent=`${prettyCoord(mark.lat)}, ${prettyCoord(mark.lon)}`;
    const kind=document.createElement('span');kind.className='mark-kind';kind.textContent=typeLabel(mark.type)+' · ';
    sub.prepend(kind);info.append(title,sub);
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
function typeLabel(t){return ({buoy:'Orange mark',pin:'Pin end',boat:'Start boat'})[normalizeType(t)];}
function addMark(lat,lon) {
  const course=getCourse();
  const type=normalizeType($('addType').value);
  if((type==='pin'||type==='boat')&&course.marks.some(m=>m.type===type)){toast(`There is already a ${typeLabel(type).toLowerCase()}. Select it to move it.`);return;}
  if(course.marks.length>=250){toast('This course has reached 250 marks.');return;}
  const numbers=course.marks.map(m=>Number((m.name.match(/^Mark (\d+)$/)||[])[1])).filter(Boolean);
  let n=1;while(numbers.includes(n))n++;
  const mark={id:uid(),name:type==='boat'?'Start boat':type==='pin'?'Pin end':`Mark ${n}`,lat,lon,laid:null,type,generatedRole:null};
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
  return {x:mapWidth/2+dx,y:mapCenterY()+p.y-c.y};
}
function geoAt(x,y) {
  const center=worldPoint(view.lat,view.lon,view.zoom);
  return geoPoint(center.x+x-mapWidth/2,center.y+y-mapCenterY(),view.zoom);
}
function setCenter(lat,lon) {view.lat=Math.max(-85,Math.min(85,lat));view.lon=((lon+180)%360+360)%360-180;requestRender();}
function panBy(dx,dy) {
  const c=worldPoint(view.lat,view.lon,view.zoom);
  const dest=geoPoint(c.x-dx,c.y-dy,view.zoom);
  setCenter(dest.lat,dest.lon);followGPS=false;updateGpsStatus();
}
function changeZoom(delta,aroundX=mapWidth/2,aroundY=mapCenterY()) {
  const next=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,view.zoom+delta));if(next===view.zoom)return;
  const anchor=geoAt(aroundX,aroundY);view.zoom=next;
  const anchorWorld=worldPoint(anchor.lat,anchor.lon,next);
  const center=geoPoint(anchorWorld.x-(aroundX-mapWidth/2),anchorWorld.y-(aroundY-mapCenterY()),next);
  setCenter(center.lat,center.lon);
}
function resize() {
  const rect=canvas.getBoundingClientRect();
  mapWidth=Math.max(1,rect.width);mapHeight=Math.max(1,rect.height);
  const dpr=Math.min(3,window.devicePixelRatio||1);
  canvas.width=Math.round(mapWidth*dpr);canvas.height=Math.round(mapHeight*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  windCanvas.width=Math.round(mapWidth*dpr);windCanvas.height=Math.round(mapHeight*dpr);windCtx.setTransform(dpr,0,0,dpr,0,0);
  requestRender();drawWindOverlay();
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
  const left=c.x-mapWidth/2,top=c.y-mapCenterY();
  const minX=Math.floor(left/TILE_SIZE),minY=Math.floor(top/TILE_SIZE);
  const maxX=Math.ceil((left+mapWidth)/TILE_SIZE),maxY=Math.ceil((top+mapHeight)/TILE_SIZE);
  for(let x=minX;x<maxX;x++)for(let y=minY;y<maxY;y++) {
    const sx=Math.round(x*TILE_SIZE-left),sy=Math.round(y*TILE_SIZE-top);
    const tile=getTile(view.zoom,x,y);
    if(tile&&tile.ready)ctx.drawImage(tile.img,sx,sy,TILE_SIZE+0.5,TILE_SIZE+0.5);
    else {ctx.strokeStyle='#cbdee0';ctx.lineWidth=.7;ctx.strokeRect(sx,sy,TILE_SIZE,TILE_SIZE);}
  }
  // Start line and windward guide stay visible even when flowing wind particles are off.
  const {boat,pin}=linePoints();const mid=startMidpoint();
  if(boat&&pin){
    const a=mapPoint(boat.lat,boat.lon),b=mapPoint(pin.lat,pin.lon);
    ctx.save();ctx.lineWidth=5;ctx.strokeStyle='#ffffff';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    ctx.lineWidth=2.5;ctx.strokeStyle='#176981';ctx.setLineDash([8,6]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore();
    if(mode==='course'){
      const centre=mapPoint(mid.lat,mid.lon);
      ctx.save();ctx.fillStyle='#107b87';ctx.strokeStyle='#fff';ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(centre.x,centre.y,17,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(centre.x-8,centre.y);ctx.lineTo(centre.x+8,centre.y);
      ctx.moveTo(centre.x,centre.y-8);ctx.lineTo(centre.x,centre.y+8);ctx.stroke();ctx.restore();
    }
  }
  if(mid){
    const end=destination(mid,getCourse().layout.windFrom,getCourse().layout.legLength);
    const a=mapPoint(mid.lat,mid.lon),b=mapPoint(end.lat,end.lon);
    ctx.save();ctx.strokeStyle='rgba(19,128,149,.64)';ctx.setLineDash([7,9]);ctx.lineWidth=1.7;
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore();
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
    ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.lineJoin='round';
    if(mark.type==='boat') {
      ctx.fillStyle=mark.laid?'#22866a':'#143e54';
      ctx.beginPath();ctx.moveTo(-15,-11);ctx.lineTo(15,-11);ctx.lineTo(10,-1);ctx.lineTo(-10,-1);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,-13);ctx.lineTo(0,-28);ctx.moveTo(-9,-13);ctx.lineTo(10,-13);ctx.stroke();
      ctx.strokeStyle='#143e54';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,-28);ctx.lineTo(-7,-21);ctx.lineTo(0,-21);ctx.stroke();
    } else {
      ctx.fillStyle=mark.laid?'#22866a':'#e58c35';
      ctx.beginPath();ctx.moveTo(0,9);ctx.lineTo(-11,-5);ctx.arc(0,-10,13,Math.PI*.78,Math.PI*2.22);ctx.lineTo(11,-5);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 13px system-ui,sans-serif';
      ctx.fillText(mark.type==='pin'?'P':String(i+1),0,-11);
    }
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
    mark.lat=geo.lat;mark.lon=geo.lon;mark.laid=null;if(mark.generatedRole)getCourse().layout.autoAlignMarks=false;mode='browse';save();updateUI();toast(`${mark.name} moved`);return;
  }
  const nearest=pointNear(p); 
  if(nearest)pickMark(nearest.id);
}
function nearStartLine(p){
  const {boat,pin}=linePoints();if(!boat||!pin)return false;
  const a=mapPoint(boat.lat,boat.lon),b=mapPoint(pin.lat,pin.lon);
  const x=b.x-a.x,y=b.y-a.y,length=x*x+y*y;
  if(length<1)return Math.hypot(p.x-a.x,p.y-a.y)<30;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/length));
  return Math.hypot(p.x-(a.x+t*x),p.y-(a.y+t*y))<25;
}
function shiftCourseGroup(dragState,current){
  const start=worldPoint(dragState.startGeo.lat,dragState.startGeo.lon,view.zoom);
  const here=worldPoint(geoAt(current.x,current.y).lat,geoAt(current.x,current.y).lon,view.zoom);
  const dx=here.x-start.x,dy=here.y-start.y;
  for(const original of dragState.originalPoints){
    const mark=getCourse().marks.find(m=>m.id===original.id);if(!mark)continue;
    const world=worldPoint(original.lat,original.lon,view.zoom);
    const moved=geoPoint(world.x+dx,world.y+dy,view.zoom);
    mark.lat=moved.lat;mark.lon=moved.lon;
  }
  requestRender();
}
function pointNear(p){
  let nearest=null,dist=30;
  for(const m of getCourse().marks){const pt=mapPoint(m.lat,m.lon);const d=Math.hypot(pt.x-p.x,pt.y-12-p.y);if(d<dist){nearest=m;dist=d;}}
  return nearest;
}
canvas.addEventListener('pointerdown',e=>{
  e.preventDefault();canvas.setPointerCapture(e.pointerId);
  const p=pointEvent(e);pointers.set(e.pointerId,p);
  if(pointers.size===1){
    const candidate=['browse','course'].includes(mode)?pointNear(p):null;
    const groupDrag=mode==='course'&&((candidate&&['boat','pin'].includes(candidate.type))||nearStartLine(p));
    const originalPoints=groupDrag?getCourse().marks.filter(m=>m.type==='boat'||m.type==='pin'||m.generatedRole).map(m=>({id:m.id,lat:m.lat,lon:m.lon})):null;
    drag={...p,startX:p.x,startY:p.y,moved:false,markId:groupDrag?null:candidate?.id||null,groupDrag,startGeo:geoAt(p.x,p.y),originalPoints};
    suppressTap=false;
  }
  else if(pointers.size===2){pinchDistance=pointerGap();drag=null;suppressTap=true;}
});
canvas.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId))return;
  const old=pointers.get(e.pointerId);const current=pointEvent(e);
  if(pointers.size===1 && drag){
    if(Math.hypot(current.x-drag.startX,current.y-drag.startY)>6)drag.moved=true;
    if(drag.moved) {
      if(drag.groupDrag)shiftCourseGroup(drag,current);
      else if(drag.markId){const mark=getCourse().marks.find(m=>m.id===drag.markId);if(mark){const geo=geoAt(current.x,current.y);mark.lat=geo.lat;mark.lon=geo.lon;requestRender();}}
      else panBy(current.x-old.x,current.y-old.y);
    }
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
  const draggedMark=pointers.size===1&&drag?.moved&&drag.markId?getCourse().marks.find(m=>m.id===drag.markId):null;
  const draggedGroup=pointers.size===1&&drag?.moved&&drag.groupDrag;
  pointers.delete(e.pointerId);
  if(draggedGroup){
    getCourse().marks.filter(m=>m.type==='boat'||m.type==='pin'||m.generatedRole).forEach(m=>m.laid=null);
    save();updateUI();toast('Start line and linked marks moved');
  }
  if(draggedMark){
    draggedMark.laid=null;
    if(draggedMark.generatedRole&&getCourse().layout.autoAlignMarks){getCourse().layout.autoAlignMarks=false;toast('Auto-update paused to preserve manual mark position');}
    else toast(`${draggedMark.name} moved`);
    selectedId=draggedMark.id;save();updateUI();
  }
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
    if(se.x-nw.x<Math.max(80,mapWidth-120)&&se.y-nw.y<Math.max(70,visibleMapHeight()-140)){
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
  if(!c.marks.length){toast('Add a point before exporting GPX.');return;}
  let gpx=`<?xml version="1.0" encoding="utf-8"?>\n<gpx version="1.1" creator="BuoyPlot" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${xmlEsc(c.name)}</name></metadata>\n`;
  for(const m of c.marks){
    gpx+=`  <wpt lat="${m.lat.toFixed(8)}" lon="${m.lon.toFixed(8)}"><name>${xmlEsc(m.name)}</name><sym>${m.type==='boat'?'Boat Ramp':'Buoy'}</sym><type>${xmlEsc(normalizeType(m.type))}</type></wpt>\n`;
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
      if(![1,2].includes(parsed.version)||!Array.isArray(parsed.courses)||!parsed.courses.length)throw new Error('Invalid BuoyPlot backup');
      const normalized=parsed.courses.filter(c=>c&&Array.isArray(c.marks)&&typeof c.name==='string').map(c=>({
        id:uid(),name:c.name.slice(0,80),layout:normalizeLayout(c.layout),marks:c.marks.filter(m=>m&&isValidCoord(Number(m.lat),Number(m.lon))).slice(0,250).map(m=>({
          id:uid(),name:safeName(m.name)||'Mark',lat:Number(m.lat),lon:Number(m.lon),type:normalizeType(m.type),generatedRole:['windward','leeward'].includes(m.generatedRole)?m.generatedRole:null,laid:m.laid&&isValidCoord(Number(m.laid.lat),Number(m.laid.lon))?{lat:Number(m.laid.lat),lon:Number(m.laid.lon),accuracy:Number(m.laid.accuracy)||0,time:String(m.laid.time||'')}:null
        }))
      })).slice(0,50);
      if(!normalized.length)throw new Error('No courses found');
      if(!confirm(`Import ${normalized.length} course(s) from this backup? Existing courses will be kept.`))return;
      state.courses.push(...normalized);state.activeCourseId=normalized[0].id;selectedId=null;mode='browse';save();updateCourseSelect();updateUI();fitAll();toast('Backup imported');
    }catch(e){toast('Could not import: not a valid BuoyPlot JSON backup.');}
  };
  reader.readAsText(file);
}

// --- Wind layer and wind-aligned racecourse geometry ---
function updateLayoutControls(){
  const layout=getCourse().layout||(getCourse().layout=defaultLayout());
  $('windDirection').value=layout.windFrom;
  $('windSlider').value=layout.windFrom;
  $('windVisible').checked=layout.windVisible;
  $('autoAlignMarks').checked=layout.autoAlignMarks;
  $('squareToWind').checked=layout.squareToWind;
  $('lineLength').value=layout.lineLength;
  $('legLength').value=layout.legLength;
  $('leewardOffset').value=layout.leewardOffset;
  $('windBadge').textContent=`${paddedBearing(layout.windFrom)} ${compass(layout.windFrom)}`;
  $('windMapStatus').textContent=`WIND FROM ${paddedBearing(layout.windFrom)} ${compass(layout.windFrom)}`;
  $('windMapStatus').hidden=!layout.windVisible;
  document.querySelectorAll('[data-wind]').forEach(btn=>btn.classList.toggle('active',Number(btn.dataset.wind)===layout.windFrom));
  const {boat,pin}=linePoints();
  const current=boat&&pin?`Start line: ${formatDist(distanceMeters(boat,pin))}, bearing ${paddedBearing(trueBearing(boat,pin))}.`:
    !boat&&!pin?'Place a start boat and pin end to define the start line.':`Add ${boat?'the pin end':'the start boat'} to finish the start line.`;
  $('startLineSummary').textContent=current;
  drawWindOverlay();scheduleWindAnimation();
}
function syncGeneratedMarks(){
  const mid=startMidpoint();if(!mid)return;
  const l=getCourse().layout;
  for(const m of getCourse().marks){
    let target=null;
    if(m.generatedRole==='windward')target=destination(mid,l.windFrom,l.legLength);
    if(m.generatedRole==='leeward')target=destination(mid,(l.windFrom+180)%360,l.leewardOffset);
    if(target){m.lat=target.lat;m.lon=target.lon;}
  }
}
function squareLineAroundMiddle(){
  const mid=startMidpoint();if(!mid)return false;
  const {boat,pin}=linePoints();const l=getCourse().layout;
  const original=trueBearing(boat,pin);
  const choices=[(l.windFrom+90)%360,(l.windFrom+270)%360];
  const along=choices.sort((a,b)=>Math.abs(((a-original+540)%360)-180)-Math.abs(((b-original+540)%360)-180))[0];
  const newBoat=destination(mid,(along+180)%360,l.lineLength/2);
  const newPin=destination(mid,along,l.lineLength/2);
  Object.assign(boat,newBoat);Object.assign(pin,newPin);
  return true;
}
function updateLinkedGeometry({square=false}={}){
  if(square&&getCourse().layout.squareToWind)squareLineAroundMiddle();
  if(getCourse().layout.autoAlignMarks)syncGeneratedMarks();
}
function toggleCourseDrag(){
  mode=mode==='course'?'browse':'course';
  if(mode==='course'&&!startMidpoint()){mode='browse';toast('Place both start boat and pin to move the whole start line.');}
  updateUI();
  if(mode==='course'&&window.innerWidth<=760)setSheetState('peek');
}
function setWindDirection(value){
  const n=Number(value);if(!Number.isFinite(n))return;
  getCourse().layout.windFrom=((Math.round(n)%360)+360)%360;
  updateLinkedGeometry({square:true});save();updateUI();
}
function syncLayoutNumbers(){
  const l=getCourse().layout;
  l.lineLength=validLength($('lineLength').value,10,2000,l.lineLength);
  l.legLength=validLength($('legLength').value,10,10000,l.legLength);
  l.leewardOffset=validLength($('leewardOffset').value,0,2000,l.leewardOffset);
  updateLinkedGeometry({square:true});save();updateUI();
}
function drawWindOverlay(){
  windCtx.clearRect(0,0,mapWidth,mapHeight);
  const l=getCourse().layout;
  if(!l.windVisible||!mapWidth||!mapHeight)return;
  const heading=toRad((l.windFrom+180)%360); // Wind-from direction becomes a moving TO arrow.
  const dx=Math.sin(heading),dy=-Math.cos(heading);
  const nx=-dy,ny=dx;
  // Screen-aligned grid rather than geographical wind speeds; direction only, not a forecast.
  const spacing=92;
  windCtx.save();windCtx.strokeStyle='rgba(4,110,140,.65)';windCtx.lineWidth=1.9;windCtx.lineCap='round';windCtx.lineJoin='round';
  for(let y=-spacing;y<mapHeight+spacing;y+=spacing){
    for(let x=-spacing;x<mapWidth+spacing;x+=spacing){
      const phase=((windTick+((x+y)*.055))%spacing+spacing)%spacing-spacing/2;
      const cx=x+dx*phase,cy=y+dy*phase;
      const ax=cx-dx*12,ay=cy-dy*12,bx=cx+dx*12,by=cy+dy*12;
      windCtx.beginPath();windCtx.moveTo(ax,ay);windCtx.lineTo(bx,by);windCtx.stroke();
      windCtx.beginPath();windCtx.moveTo(bx,by);windCtx.lineTo(bx-dx*6+nx*4,by-dy*6+ny*4);windCtx.moveTo(bx,by);windCtx.lineTo(bx-dx*6-nx*4,by-dy*6-ny*4);windCtx.stroke();
    }
  }
  windCtx.restore();
}
function scheduleWindAnimation(){
  if(windAnimationId)return;
  if(!getCourse().layout.windVisible||document.hidden||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  windAnimationId=requestAnimationFrame(function tick(time){
    if(!getCourse().layout.windVisible||document.hidden){windAnimationId=0;return;}
    windAnimationId=requestAnimationFrame(tick);
    if(time-windLast<70)return;
    const elapsed=Math.min(time-windLast||70,120);windLast=time;
    windTick=(windTick+elapsed*.028)%92;
    drawWindOverlay();
  });
}
function alignPinToWind(){
  syncLayoutNumbers();
  const {boat,pin}=linePoints();if(!boat||!pin){toast('Place both a start boat and pin end first.');return;}
  const d=getCourse().layout.windFrom;
  const port=(d+90)%360,starboard=(d+270)%360;
  const best=[port,starboard].sort((a,b)=>{
    const orig=trueBearing(boat,pin);
    return Math.abs(((a-orig+540)%360)-180)-Math.abs(((b-orig+540)%360)-180);
  })[0];
  const next=destination(boat,best,getCourse().layout.lineLength);
  pin.lat=next.lat;pin.lon=next.lon;pin.laid=null;
  if(getCourse().layout.autoAlignMarks)syncGeneratedMarks();
  selectedId=pin.id;save();updateUI();fitAll();toast('Pin aligned perpendicular to the wind');
}
function generateWL(){
  syncLayoutNumbers();
  const middle=startMidpoint();if(!middle){toast('Add a start boat and pin end first.');return;}
  const l=getCourse().layout;
  const positions=[{role:'windward',name:'Windward',pos:destination(middle,l.windFrom,l.legLength)},
                   {role:'leeward',name:'Leeward',pos:destination(middle,(l.windFrom+180)%360,l.leewardOffset)}];
  const needed=positions.filter(item=>!getCourse().marks.some(m=>m.generatedRole===item.role)).length;
  if(maxPointsReached(needed))return;
  if(positions.some(item=>getCourse().marks.some(m=>m.generatedRole===item.role))&&!confirm('Update the existing generated windward/leeward positions? This replaces their planned coordinates.'))return;
  for(const item of positions){
    let mark=getCourse().marks.find(m=>m.generatedRole===item.role);
    if(mark){mark.lat=item.pos.lat;mark.lon=item.pos.lon;mark.laid=null;mark.type='buoy';}
    else getCourse().marks.push({id:uid(),name:item.name,lat:item.pos.lat,lon:item.pos.lon,type:'buoy',laid:null,generatedRole:item.role});
  }
  save();selectedId=getCourse().marks.find(m=>m.generatedRole==='windward')?.id||null;updateUI();fitAll();toast('Windward and leeward marks positioned');
}
$('windDirection').addEventListener('change',e=>{if(e.target.value==='')return;setWindDirection(e.target.value);});
$('windSlider').addEventListener('input',e=>setWindDirection(e.target.value));
document.querySelectorAll('[data-wind]').forEach(btn=>btn.addEventListener('click',()=>setWindDirection(btn.dataset.wind)));
$('windVisible').addEventListener('change',e=>{getCourse().layout.windVisible=e.target.checked;save();updateLayoutControls();});
for(const id of ['lineLength','legLength','leewardOffset']) $(id).addEventListener('change',syncLayoutNumbers);
$('alignPin').addEventListener('click',alignPinToWind);
$('squareLine').addEventListener('click',()=>{
  syncLayoutNumbers();if(!squareLineAroundMiddle()){toast('Place a start boat and pin first.');return;}
  if(getCourse().layout.autoAlignMarks)syncGeneratedMarks();
  save();updateUI();fitAll();toast('Start line squared to wind around its centre');
});
$('autoAlignMarks').addEventListener('change',e=>{
  getCourse().layout.autoAlignMarks=e.target.checked;
  if(e.target.checked)syncGeneratedMarks();save();updateUI();
});
$('squareToWind').addEventListener('change',e=>{
  getCourse().layout.squareToWind=e.target.checked;
  if(e.target.checked)updateLinkedGeometry({square:true});save();updateUI();
});
$('planModeToggle').addEventListener('click',toggleCourseDrag);
$('courseDragButton').addEventListener('click',toggleCourseDrag);
$('generateCourse').addEventListener('click',generateWL);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){windLast=0;scheduleWindAnimation();}});

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
$('moveButton').addEventListener('click',()=>{if(!getMark())return;mode=mode==='move'?'browse':'move';updateUI();if(mode==='move'&&window.innerWidth<=760)setSheetState('peek');});
$('addType').addEventListener('change',()=>{if(mode==='add')updateUI();});
$('saveMark').addEventListener('click',()=>{
  const mark=getMark();if(!mark)return;
  const name=safeName($('markName').value),lat=Number($('markLat').value),lon=Number($('markLon').value);
  if(!name){toast('Please enter a mark name.');return;}
  if(!$('markLat').value.trim()||!$('markLon').value.trim()||!isValidCoord(lat,lon)){
    toast('Enter valid latitude and longitude coordinates.');return;
  }
  const nextType=normalizeType($('markType').value);
  if(nextType!=='buoy'&&getCourse().marks.some(m=>m.id!==mark.id&&m.type===nextType)){toast(`Only one ${typeLabel(nextType).toLowerCase()} per course.`);return;}
  mark.name=name;mark.lat=lat;mark.lon=lon;mark.type=nextType;mark.generatedRole=null;save();updateUI();toast('Point updated');
});
$('deleteMark').addEventListener('click',()=>{
  const mark=getMark();if(!mark)return;
  if(!confirm(`Delete ${mark.name}?`))return;
  getCourse().marks=getCourse().marks.filter(m=>m.id!==mark.id);
  selectedId=null;mode='browse';save();updateUI();toast('Mark deleted');
});
$('atGpsButton').addEventListener('click',()=>{
  const mark=getMark();if(!mark)return;
  if(!gpsPoint){toast('Start GPS and wait for a fix first.');return;}
  if(gpsPoint.accuracy>25&&!confirm(`GPS accuracy is ±${Math.round(gpsPoint.accuracy)} m. Move this point anyway?`))return;
  mark.lat=gpsPoint.lat;mark.lon=gpsPoint.lon;mark.laid=null;if(mark.generatedRole)getCourse().layout.autoAlignMarks=false;save();updateUI();toast(`${mark.name} moved to GPS position`);
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
window.addEventListener('resize',()=>{setSheetState(sheetState);resize();});
if(window.ResizeObserver)new ResizeObserver(resize).observe(canvas);
if('serviceWorker' in navigator && window.isSecureContext)navigator.serviceWorker.register('./sw.js').catch(()=>{});

// Initialise. If the device has a saved course, show the marks instead of the default harbour view.
setSheetState('peek');updateCourseSelect();updateUI();resize();
if(getCourse().marks.length)fitAll();
