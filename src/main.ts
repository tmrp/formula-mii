import {createIcons, Play, Pause, SkipBack, SkipForward, RotateCcw, Maximize2, ChevronDown, ArrowUpRight, Settings2, Info, X, Camera, CircleHelp, Flag, VolumeX, Leaf, Check, MapPin, Gauge, Keyboard, Scan, Video, UserRound, Navigation, Binoculars, Trophy, ChevronLeft, ChevronRight} from 'lucide';
import {ReplayEngine} from './engine';
import {ReplayScene} from './scene';
import {latest,clock,type Metadata,type CameraMode,type Driver} from './types';
import './style.css';
import './fonts.css';

const app=document.querySelector<HTMLDivElement>('#app')!;
const icon=(name:string,cls='')=>`<i data-lucide="${name}" ${cls?`class="${cls}"`:''}></i>`;
const icons=()=>createIcons({icons:{Play,Pause,SkipBack,SkipForward,RotateCcw,Maximize2,ChevronDown,ArrowUpRight,Settings2,Info,X,Camera,CircleHelp,Flag,VolumeX,Leaf,Check,MapPin,Gauge,Keyboard,Scan,Video,UserRound,Navigation,Binoculars,Trophy,ChevronLeft,ChevronRight}});
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
app.innerHTML=`
 <header class="header">
  <a class="brand" href="/" aria-label="Formula Mii home"><span class="brand-mark">f<span>m</span></span><span>formula<span class="brand-light">mii</span></span></a>
  <div class="header-center"><span class="green-dot"></span>A little world. A real race.</div>
  <div class="header-actions"><button class="text-button" id="about-button">${icon('info')}<span>About this replay</span></button><span class="header-divider"></span><button class="icon-button" id="settings-button" aria-label="Replay settings">${icon('settings-2')}</button></div>
 </header>
 <main>
  <section class="race-heading">
   <div><div class="eyebrow"><svg class="flag-brazil" aria-label="Brazil" viewBox="0 0 28 19"><rect width="28" height="19" rx="2" fill="#5c9966"/><path d="M14 3 24 9.5 14 16 4 9.5z" fill="#ead272"/><circle cx="14" cy="9.5" r="3.8" fill="#47748b"/><path d="M10.5 8.5q4-.5 7 2" fill="none" stroke="#e9f1d8" stroke-width=".8"/></svg> 2025 SEASON <span class="eyebrow-dot">·</span> ROUND 21</div><h1>São Paulo Grand Prix<span class="title-dot">.</span></h1><p>Interlagos, reimagined. Every lap. Every little driver.</p></div>
   <div class="race-stats"><div><span class="stat-label">RACE DAY</span><strong>09 Nov 2025</strong></div><div><span class="stat-label">THE CIRCUIT</span><strong>4.309 <small>km</small></strong></div><div><span class="stat-label">THE DISTANCE</span><strong>71 <small>laps</small></strong></div><span class="poc-badge">PLAYABLE REPLAY</span></div>
  </section>
  <div class="replay-shell">
   <aside class="standings">
    <div class="panel-title"><h2>Race order</h2><span class="live-tag"><span></span>REPLAY</span></div>
    <div class="standings-sub"><span id="lap-display">LAP 1 <em>/ 71</em></span><span id="race-state">ON TRACK</span></div>
    <div class="standing-columns"><span>POS</span><span>DRIVER</span><span>GAP</span></div>
    <div id="driver-list" class="driver-list" aria-label="Drivers. Select a driver to follow."></div>
    <div class="standing-footer">${icon('navigation')}<span>Pick a driver to follow their race</span></div>
   </aside>
   <section class="stage" aria-label="3D race player">
    <div id="scene" class="scene"></div>
    <div class="scene-vignette"></div>
    <div class="stage-top"><div class="location-chip">${icon('map-pin')}<span>AUTÓDROMO JOSÉ CARLOS PACE</span></div><button class="floating-button" id="fullscreen" aria-label="Enter fullscreen">${icon('maximize-2')}</button></div>
    <div class="camera-panel">
     <div class="camera-header"><span>${icon('camera')} CAMERA</span><span class="key-hint">C</span></div>
     <div class="camera-options" role="group" aria-label="Camera perspective">
      <button class="camera-option selected" data-camera="orbit">${icon('scan')}<span>Aerial</span><span class="camera-num">1</span></button>
      <button class="camera-option" data-camera="chase">${icon('navigation')}<span>Chase</span><span class="camera-num">2</span></button>
      <button class="camera-option" data-camera="onboard">${icon('gauge')}<span>Onboard</span><span class="camera-num">3</span></button>
      <button class="camera-option" data-camera="portrait">${icon('user-round')}<span>Driver</span><span class="camera-num">4</span></button>
      <button class="camera-option" data-camera="trackside">${icon('video')}<span>Trackside</span><span class="camera-num">5</span></button>
     </div>
     <div class="station-wrap" hidden><label for="station">TRACKSIDE CAMERA</label><select id="station"><option value="-1">Auto director</option></select><span id="station-name"></span></div>
    </div>
    <div class="scene-instruction" id="camera-instruction">${icon('scan')} Drag to explore <span>·</span> Scroll to zoom</div>
    <div class="track-sign"><span>INTERLAGOS</span><strong>São Paulo, Brasil</strong></div>
    <div class="focus-card" id="focus-card"><div class="avatar" id="avatar"></div><div class="focus-identity"><span class="focus-label">FOLLOWING <span id="focus-number">#4</span></span><strong id="focus-name">Lando Norris</strong><span id="focus-team">McLaren</span></div><div class="focus-divider"></div><div class="speed"><strong id="speed">0</strong><span>KM/H</span></div><div class="gear"><span>GEAR</span><strong id="gear">N</strong></div><div class="telemetry-bars"><span>THR <i><b id="throttle"></b></i></span><span>BRK <i><b id="brake"></b></i></span></div><span class="tire-chip" id="tire">M</span></div>
    <div class="minimap-wrap"><canvas id="minimap" width="360" height="240" aria-label="Track map with live driver positions"></canvas><span>TRACK MAP</span></div>
    <div id="status-note" class="status-note" hidden></div>
    <div class="loading" id="loading"><div class="loading-logo">fm</div><h2>A big race. A little world.</h2><p id="load-label">Loading the São Paulo replay…</p><div class="load-track"><span id="load-progress"></span></div><span class="loading-note">REAL TELEMETRY · 20 DRIVERS · 71 LAPS</span></div>
   </section>
  </div>
  <section class="transport" aria-label="Replay playback controls">
   <div class="timeline-top"><span class="replay-caption">${icon('flag')} THE FULL RACE <span id="event-caption">Lights out in São Paulo</span></span><span class="elapsed"><strong id="current-time">00:00</strong><span>/</span><span id="duration">1:33:11</span></span></div>
   <div class="timeline-wrap"><div class="timeline-events" id="timeline-events"></div><input id="timeline" class="timeline" type="range" min="0" max="5591" value="0" step="0.1" aria-label="Race timeline in seconds" disabled></div>
   <div class="timeline-labels"><span>START</span><span>LAP 18</span><span>HALFWAY</span><span>LAP 54</span><span>FINISH</span></div>
   <div class="transport-bottom"><div class="playback-buttons"><button class="icon-button" id="restart" aria-label="Restart replay" disabled>${icon('rotate-ccw')}</button><button class="icon-button" id="previous-lap" aria-label="Previous lap" disabled>${icon('skip-back')}</button><button class="play-button" id="play" aria-label="Play replay" disabled>${icon('play')}</button><button class="icon-button" id="next-lap" aria-label="Next lap" disabled>${icon('skip-forward')}</button><select id="rate" class="speed-select" aria-label="Playback speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1× speed</option><option value="2">2× speed</option><option value="4">4× speed</option><option value="8">8× speed</option><option value="16">16× speed</option><option value="32">32× speed</option><option value="64">64× speed</option></select></div><div class="lap-jump"><label for="lap-input">JUMP TO LAP</label><button id="lap-minus" class="icon-button small" aria-label="Jump to previous lap">${icon('chevron-left')}</button><input id="lap-input" type="number" min="1" max="71" value="1" aria-label="Jump to lap number"><button id="lap-plus" class="icon-button small" aria-label="Jump to next lap">${icon('chevron-right')}</button><span>/ 71</span></div><button class="keyboard-help" id="help-button">${icon('keyboard')}<span>Keyboard shortcuts</span></button></div>
  </section>
  <footer><span><span class="footer-dot"></span>Powered by real OpenF1 telemetry <a href="https://github.com/br-g/openf1" target="_blank" rel="noreferrer">${icon('arrow-up-right')}</a></span><span>Made small. Played big.<span class="footer-engine">RUST + WASM</span></span></footer>
 </main>
 <dialog id="dialog"><div class="dialog-header"><h2 id="dialog-title"></h2><button class="icon-button" id="dialog-close" aria-label="Close dialog">${icon('x')}</button></div><div id="dialog-content"></div></dialog>
`;
icons();
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
let meta:Metadata,engine:ReplayEngine,scene:ReplayScene,frame:Float32Array;
let time=0,playing=false,rate=1,focus=0,lastTick=performance.now(),lastUI=0,mode:CameraMode='orbit',ready=false;
const cameraModes:CameraMode[]=['orbit','chase','onboard','portrait','trackside'];
const rows=new Map<number,HTMLButtonElement>();let fps=0,frames=0,fpsStart=performance.now();
let dataGap=false;

function showDialog(title:string,html:string){el('dialog-title').textContent=title;el('dialog-content').innerHTML=html;el<HTMLDialogElement>('dialog').showModal();icons();}
el('dialog-close').onclick=()=>el<HTMLDialogElement>('dialog').close();el('dialog').onclick=e=>{if(e.target===el('dialog'))el<HTMLDialogElement>('dialog').close();};
el('about-button').onclick=()=>showDialog('A real race in a little world.',`<p>Replay the entire <strong>2025 São Paulo Grand Prix</strong> with all 20 drivers. Their paths, speed, gears, laps, positions, and pit stints come from <a href="https://github.com/br-g/openf1" target="_blank" rel="noreferrer">OpenF1</a>.</p><p>The cars and Mii-style avatars are a playful interpretation inspired by Wii Sports. Track elevation and scenery are stylized; this is a telemetry reconstruction, rather than broadcast footage or a physics simulation.</p><div class="about-grid"><div><strong>20</strong><span>little drivers</span></div><div><strong>71</strong><span>real laps</span></div><div><strong>5</strong><span>camera views</span></div></div><p>OpenF1 locations are sampled at approximately 3.7 Hz. Rust WebAssembly interpolates their positions; longer data gaps are held and then hidden until samples resume. Classification and final crossing times are derived from OpenF1 timing.</p><p>Raw data and the exported replay are archived in a local <strong>Turso</strong> database. The browser loads an immutable bundle, so no database credentials or live API calls are needed.</p><p class="muted">Independent fan project. Not affiliated with Formula 1 or Nintendo. Latest completed Brazilian race available when acquired on 13 October 2026.</p>`);
el('help-button').onclick=()=>showDialog('Take the controls.',`<div class="shortcut"><span>Play / pause</span><kbd>Space</kbd></div><div class="shortcut"><span>Seek 10 seconds</span><span><kbd>←</kbd> <kbd>→</kbd></span></div><div class="shortcut"><span>Previous / next lap</span><span><kbd>[</kbd> <kbd>]</kbd></span></div><div class="shortcut"><span>Switch camera</span><kbd>C</kbd></div><div class="shortcut"><span>Choose camera</span><kbd>1 — 5</kbd></div><div class="shortcut"><span>Fullscreen</span><kbd>F</kbd></div><p class="muted">In aerial view, drag to orbit, scroll to zoom, and right-drag to pan. Select any driver in the race order to follow them.</p>`);
el('settings-button').onclick=()=>{showDialog('Replay settings',`<label class="setting-row"><span><strong>Performance mode</strong><small>Lower resolution and simplified shadows</small></span><input id="low-quality" type="checkbox" ${scene?.quality==='low'?'checked':''}></label><p class="muted">Telemetry interpolation runs in Rust WebAssembly. The scene renders on your GPU. Performance mode is useful for phones and integrated graphics.</p><div class="engine-status"><span class="green-dot"></span><span>${ready?`Rust/WASM ready · ${playing?`${fps} FPS`:'Paused'} · ${scene.renderer.info.render.calls} draw calls`:'Preparing replay…'}</span></div>`);el<HTMLInputElement>('low-quality').onchange=e=>scene?.setQuality((e.target as HTMLInputElement).checked);};
function togglePlay(){if(!ready)return;if(time>=meta.duration)seek(0);playing=!playing;el('play').innerHTML=icon(playing?'pause':'play');el('play').setAttribute('aria-label',playing?'Pause replay':'Play replay');icons();}
function seek(t:number){if(!ready)return;time=Math.max(0,Math.min(meta.duration,t));scene.setFocus(focus);frame=engine.frame(time);updateUI();scene.update(frame,0);}
function lapAt(t:number,driver=meta.drivers[focus]){const lap=latest(driver.lap_events,t);return lap?.lap_number??1;}
function jumpLap(lap:number){if(!ready)return;const l=Math.max(1,Math.min(meta.total_laps,lap));const event=meta.drivers[focus].lap_events.find(e=>e.lap_number===l)??meta.drivers.find(d=>d.driver_number===4)?.lap_events.find(e=>e.lap_number===l);if(event)seek(event.time);}
function nextLap(){jumpLap(lapAt(time)+1);}function previousLap(){const current=latest(meta.drivers[focus].lap_events,time);jumpLap(lapAt(time)-(current&&time-current.time<3?1:0));}
el('play').onclick=togglePlay;el('restart').onclick=()=>seek(0);el('next-lap').onclick=nextLap;el('previous-lap').onclick=()=>{if(ready)previousLap();};
el<HTMLInputElement>('timeline').oninput=e=>seek(Number((e.target as HTMLInputElement).value));
el<HTMLSelectElement>('rate').onchange=e=>{rate=Number((e.target as HTMLSelectElement).value);};
el<HTMLInputElement>('lap-input').onchange=e=>jumpLap(Number((e.target as HTMLInputElement).value));el('lap-minus').onclick=()=>{if(ready)jumpLap(lapAt(time)-1);};el('lap-plus').onclick=()=>{if(ready)nextLap();};
function setCamera(m:CameraMode){mode=m;if(scene&&scene.mode!==m)scene.setMode(m);document.querySelectorAll<HTMLElement>('[data-camera]').forEach(b=>{const selected=b.dataset.camera===m;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});el('camera-instruction').innerHTML=m==='orbit'?`${icon('scan')} Drag to explore <span>·</span> Scroll to zoom`:m==='trackside'?`${icon('video')} Trackside cameras follow your selected driver`:m==='portrait'?`${icon('user-round')} A little face behind the wheel`:`${icon('navigation')} Following ${esc(meta?.drivers[focus].name_acronym??'driver')} <span>·</span> Choose a driver on the left`;document.querySelector<HTMLElement>('.station-wrap')!.hidden=m!=='trackside';icons();}
document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(b=>b.onclick=()=>setCamera(b.dataset.camera as CameraMode));
el<HTMLSelectElement>('station').onchange=e=>{scene.station=Number((e.target as HTMLSelectElement).value);scene.setMode('trackside');};
async function fullscreen(){if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('main')?.requestFullscreen();}
el('fullscreen').onclick=()=>void fullscreen().catch(()=>showDialog('Fullscreen unavailable','<p>Your browser does not allow fullscreen here. You can still use every replay control in this window.</p>'));
window.addEventListener('keydown',e=>{if(!ready||el<HTMLDialogElement>('dialog').open||['INPUT','SELECT','TEXTAREA','BUTTON'].includes((e.target as HTMLElement).tagName)||e.metaKey||e.ctrlKey||e.altKey)return;
 const key=e.key.toLowerCase();if([' ','arrowleft','arrowright','[',']','c','f','1','2','3','4','5'].includes(key))e.preventDefault();
 if(key===' ')togglePlay();else if(key==='arrowleft')seek(time-10);else if(key==='arrowright')seek(time+10);else if(key==='[')jumpLap(lapAt(time)-1);else if(key===']')nextLap();else if(key==='c')setCamera(cameraModes[(cameraModes.indexOf(mode)+1)%cameraModes.length]);else if(key==='f')void fullscreen().catch(()=>{});else if(/^[1-5]$/.test(key))setCamera(cameraModes[Number(key)-1]);
});

function avatar(d:Driver,index:number){return `<div class="mii-head" style="--skin:${['#edba8e','#f1cba7','#e7b48c','#cb956e','#dfac83'][index%5]};--hair:${['#49392a','#755033','#332b28','#c89655','#5a3a29'][index%5]}"><i class="mii-hair"></i><i class="mii-eye left"></i><i class="mii-eye right"></i><i class="mii-mouth"></i></div><div class="mii-body" style="background:#${d.team_colour}"></div>`;}
function selectDriver(index:number){focus=index;scene.setFocus(index);const d=meta.drivers[index];el('focus-name').textContent=`${d.first_name} ${d.last_name}`;el('focus-team').textContent=d.team_name;el('focus-number').textContent=`#${d.driver_number}`;el('avatar').innerHTML=avatar(d,index);el('avatar').style.background=`#${d.team_colour}25`;el('focus-card').style.setProperty('--team',`#${d.team_colour}`);rows.forEach((row,i)=>{row.classList.toggle('following',i===index);row.setAttribute('aria-pressed',String(i===index));});setCamera(mode);updateUI();}
function gapLabel(d:Driver,position:number){if(d.retired&&time>d.active_until)return 'OUT';if(position===1)return 'LEADER';const gap=latest(d.intervals??[],time)?.gap_to_leader;if(typeof gap==='number')return `+${gap.toFixed(1)}`;if(typeof gap==='string')return gap.replace(' LAP','L');return '—';}
function updateUI(){
 if(!ready)return;const t=el<HTMLInputElement>('timeline');t.value=String(time);t.style.setProperty('--progress',`${time/meta.duration*100}%`);el('current-time').textContent=clock(time);
 const lead=meta.drivers.find(d=>latest(d.position_events,time)?.position===1)??meta.drivers[0];const leaderLap=lapAt(time,lead);
 el('lap-display').innerHTML=`LAP ${Math.min(leaderLap,71)} <em>/ 71</em>`;if(document.activeElement!==el('lap-input'))el<HTMLInputElement>('lap-input').value=String(lapAt(time));
 const ranking=meta.drivers.map((d,i)=>({d,i,p:latest(d.position_events,time)?.position??i+1})).sort((a,b)=>a.p-b.p||a.i-b.i);
 ranking.forEach(({d,i,p},order)=>{const row=rows.get(i)!;row.style.order=String(order);row.querySelector('.driver-pos')!.textContent=String(p).padStart(2,'0');row.querySelector('.driver-gap')!.textContent=gapLabel(d,p);row.classList.toggle('retired',d.retired&&time>d.active_until);});
 frame=engine.frame(time);const k=focus*16;el('speed').textContent=frame[k+13]>3?'—':String(Math.round(frame[k+4]));el('gear').textContent=frame[k+7]>0?String(Math.round(frame[k+7])):'N';el('throttle').style.width=`${frame[k+5]}%`;el('brake').style.width=`${frame[k+6]?100:0}%`;
 const d=meta.drivers[focus],lap=lapAt(time,d);const stint=d.stints?.find(s=>s.lap_start<=lap&&s.lap_end>=lap);const compound=stint?.compound??'';const tire=el('tire');tire.textContent=compound[0]??'—';tire.setAttribute('title',compound||'No tyre data');tire.style.color=compound==='SOFT'?'#c66253':compound==='HARD'?'#627468':'#b09339';
 const events=meta.events.filter(e=>e.time>=0&&e.time<=time);const event=events[events.length-1];el('event-caption').textContent=event?event.message:time<3?'Lights out in São Paulo':'Racing at Interlagos';
 const lastSafety=events.filter(e=>e.category==='SafetyCar'||/SAFETY CAR|VSC/.test(e.message)).at(-1);const safety=lastSafety&& !/IN THIS LAP|ENDING|ENDED|WITHDRAWN/.test(lastSafety.message)&& /DEPLOYED/.test(lastSafety.message);
 el('race-state').textContent=time>=meta.duration?'FINISHED':safety?'SAFETY CAR':'ON TRACK';el('race-state').classList.toggle('yellow',!!safety);
 const out=d.retired&&time>d.active_until;dataGap=frame[k+13]>3;const note=el('status-note');note.hidden=!(out||dataGap);note.textContent=out?`${d.name_acronym} retired · select another driver to follow`:dataGap?`${d.name_acronym} · telemetry gap (${Math.round(frame[k+13])}s)` :'';
 drawMap(ranking);(window as unknown as {__replay:unknown}).__replay={time,playing,focus,mode,driver:d.name_acronym,lap,ready,fps,wasm:true,speed:frame[k+4],carPosition:[frame[k],frame[k+1]],visible:scene.cars.filter(c=>c.visible).length};
}

let mapPoints:{x:number;y:number}[]=[],mapScale=1,mapMinX=0,mapMinY=0,mapOffsetX=0,mapOffsetY=0;
function prepareMap(){const points=meta.track.points;mapMinX=Math.min(...points.map(p=>p[0]));mapMinY=Math.min(...points.map(p=>p[1]));const w=Math.max(...points.map(p=>p[0]))-mapMinX,h=Math.max(...points.map(p=>p[1]))-mapMinY;mapScale=Math.min(310/w,175/h);mapOffsetX=(360-w*mapScale)/2;mapOffsetY=(220-h*mapScale)/2;mapPoints=points.map(p=>({x:mapOffsetX+(p[0]-mapMinX)*mapScale,y:mapOffsetY+(p[1]-mapMinY)*mapScale}));}
function drawMap(ranking:{d:Driver;i:number;p:number}[]){const ctx=el<HTMLCanvasElement>('minimap').getContext('2d')!;ctx.clearRect(0,0,360,240);ctx.beginPath();mapPoints.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.strokeStyle='#58745d40';ctx.lineWidth=7;ctx.stroke();ctx.strokeStyle='#fcfff1';ctx.lineWidth=3;ctx.stroke();ranking.forEach(({d,i})=>{const k=i*16;if(!frame[k+12])return;const x=mapOffsetX+(frame[k]-mapMinX)*mapScale,y=mapOffsetY+(frame[k+1]-mapMinY)*mapScale;ctx.beginPath();ctx.arc(x,y,i===focus?7:4,0,Math.PI*2);ctx.fillStyle=`#${d.team_colour}`;ctx.fill();if(i===focus){ctx.lineWidth=2.5;ctx.strokeStyle='#fcfff1';ctx.stroke();}});}

async function init(){try{
 const compressed='DecompressionStream' in window;const response=await fetch(compressed?'/replay/metadata.json.gz':'/replay/metadata.json');if(!response.ok)throw new Error('The race bundle is not available.');
 let metadataBytes=new Uint8Array(await response.arrayBuffer());if(compressed&&metadataBytes[0]===0x1f&&metadataBytes[1]===0x8b)metadataBytes=new Uint8Array(await new Response(new Blob([metadataBytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());meta=JSON.parse(new TextDecoder().decode(metadataBytes));
 el('duration').textContent=clock(meta.duration);document.querySelectorAll('.timeline-labels span').forEach((label,i)=>{if(i>0&&i<4)label.textContent=clock(meta.duration*i/4);});el<HTMLInputElement>('timeline').max=String(meta.duration);
 engine=await ReplayEngine.load(meta,f=>{el('load-progress').style.width=`${f*100}%`;el('load-label').textContent=`Loading real race telemetry · ${Math.round(f*100)}%`;});
 el('load-label').textContent='Building your little Interlagos…';await new Promise(r=>setTimeout(r,30));scene=new ReplayScene(el('scene'),meta);
 scene.onStationChange=name=>{el('station-name').textContent=name;};scene.stationNames.forEach((name,i)=>el<HTMLSelectElement>('station').add(new Option(name,String(i))));
 meta.drivers.forEach((d,i)=>{const row=document.createElement('button');row.className='driver-row';row.dataset.driver=String(d.driver_number);row.setAttribute('aria-label',`Follow ${d.full_name}`);row.innerHTML=`<span class="driver-pos">${String(i+1).padStart(2,'0')}</span><span class="team-line" style="background:#${d.team_colour}"></span><span class="driver-info"><strong>${esc(d.name_acronym)}</strong><small>${esc(d.team_name)}</small></span><span class="driver-gap">—</span>`;row.onclick=()=>selectDriver(i);rows.set(i,row);el('driver-list').append(row);});
 const keyEvents=meta.events.filter(e=>e.time>=0&&e.time<=meta.duration&&/SAFETY CAR DEPLOYED|VIRTUAL SAFETY CAR DEPLOYED|CHEQUERED|RED FLAG/.test(e.message));keyEvents.forEach(e=>{const b=document.createElement('button');b.className='event-marker';b.style.left=`${e.time/meta.duration*100}%`;b.title=`${clock(e.time)} · ${e.message}`;b.setAttribute('aria-label',`Jump to ${e.message} at ${clock(e.time)}`);b.onclick=()=>seek(e.time);el('timeline-events').append(b);});
 prepareMap();ready=true;el('loading').classList.add('loaded');setTimeout(()=>el('loading').remove(),600);document.querySelectorAll<HTMLButtonElement|HTMLInputElement>('.transport [disabled]').forEach(b=>b.disabled=false);
 focus=Math.max(0,meta.drivers.findIndex(d=>d.driver_number===4));selectDriver(focus);setCamera('orbit');frame=engine.frame(0);scene.update(frame,0);icons();
 let renderedTime=-1;const render=(now:number)=>{const delta=Math.min((now-lastTick)/1000,1);lastTick=now;if(playing){time=Math.min(meta.duration,time+delta*rate);if(time>=meta.duration){playing=false;el('play').innerHTML=icon('play');el('play').setAttribute('aria-label','Play replay');icons();}}frame=engine.frame(time);if(scene.update(frame,delta,time!==renderedTime))frames++;renderedTime=time;if(now-fpsStart>1000){fps=Math.round(frames*1000/(now-fpsStart));frames=0;fpsStart=now;}if(now-lastUI>100){updateUI();lastUI=now;}requestAnimationFrame(render);};lastTick=performance.now();requestAnimationFrame(render);
 document.addEventListener('visibilitychange',()=>{lastTick=performance.now();});
}catch(error){el('load-label').textContent=error instanceof Error?error.message:'The replay could not be loaded.';el('loading').innerHTML+=`<button class="retry-button" onclick="location.reload()">Try again</button>`;console.error(error);}}
void init();
