import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { tracks } from "./songs.js";

const firebaseConfig = {
  apiKey: "AIzaSyDNVK5ZzsVpEVpeWo9X34QNQ0MbVKXYvZU",
  authDomain: "song-491ab.firebaseapp.com",
  databaseURL: "https://song-491ab-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "song-491ab",
  storageBucket: "song-491ab.firebasestorage.app",
  messagingSenderId: "219818476821",
  appId: "1:219818476821:web:af092287536ca53a35d51c"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ── STATE ──
let currentUser=null,currentTrackIdx=-1,isPlaying=false,isShuffle=false,isRepeat=false,volume=0.8,isMuted=false;
let likedSet=new Set(),playlists={},filteredTracks=[...tracks],currentFilter='all';
let queue=[],ctxTrackIdx=-1,currentPlaylistId=null;
let sleepTimer=null,sleepEnd=0,sleepInterval=null;
let addSongModalPlaylistId=null,addSongModalSelected=new Set();
let durations={},avatarDataUrl='',plArtDataUrl='';
let currentLibTab='playlists';
let playCounts={},listenSeconds={},sessionStarted={},statsPeriod='all',playHistory=[];
const STATS_KEY='mova_stats_v1',HISTORY_KEY='mova_history_v1';

function loadStats(){try{const s=localStorage.getItem(STATS_KEY);if(s){const d=JSON.parse(s);playCounts=d.playCounts||{};listenSeconds=d.listenSeconds||{};}const h=localStorage.getItem(HISTORY_KEY);if(h){playHistory=JSON.parse(h)||[];}}catch(e){}}
function saveStats(){try{localStorage.setItem(STATS_KEY,JSON.stringify({playCounts,listenSeconds}));localStorage.setItem(HISTORY_KEY,JSON.stringify(playHistory.slice(-500)));}catch(e){}}
function recordPlay(trackId){playCounts[trackId]=(playCounts[trackId]||0)+1;sessionStarted[trackId]=Date.now();playHistory.push({trackId,timestamp:Date.now(),duration:0});saveStats();updateTotalPlaysUI();}
function recordListenTime(trackId,seconds){if(seconds<2)return;listenSeconds[trackId]=(listenSeconds[trackId]||0)+seconds;if(playHistory.length>0){const last=playHistory[playHistory.length-1];if(last.trackId===trackId)last.duration=seconds;}saveStats();}
function updateTotalPlaysUI(){const total=Object.values(playCounts).reduce((a,b)=>a+b,0);const el=document.getElementById('totalPlaysCount');if(el)el.textContent=total;}

const audio=document.getElementById('audioEl');
audio.volume=volume;
function userRef(u){return ref(db,'users/'+u);}
const SESSION_KEY='mova_session_v2';
function saveSession(u){localStorage.setItem(SESSION_KEY,u);}
function clearSession(){localStorage.removeItem(SESSION_KEY);}
function getSavedSession(){return localStorage.getItem(SESSION_KEY);}

(async()=>{
  const saved=getSavedSession();
  if(saved){try{const snap=await get(userRef(saved));if(snap.exists()){await loginWithData(saved,snap.val());return;}}catch(e){}clearSession();}
})();

// ══════════════════════════════
// IMAGE CROP ENGINE
// ══════════════════════════════
let cropImg=null,cropCtx=null,cropCallback=null;
let cropState={x:0,y:0,zoom:1,rotation:0,brightness:0,flipH:false,flipV:false};
let cropDrag={active:false,startX:0,startY:0,startImgX:0,startImgY:0};

window.openCropModal = (inputEl, context) => {
  const file = inputEl.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      cropImg = img;
      cropState = {x:0,y:0,zoom:1,rotation:0,brightness:0,flipH:false,flipV:false};
      document.getElementById('zoomSlider').value = 1;
      document.getElementById('rotateSlider').value = 0;
      document.getElementById('brightnessSlider').value = 0;
      document.getElementById('zoomVal').textContent = '1.0×';
      document.getElementById('rotateVal').textContent = '0°';
      document.getElementById('brightnessVal').textContent = '0';
      document.getElementById('flipHBtn').classList.remove('active');
      document.getElementById('flipVBtn').classList.remove('active');
      inputEl.value = '';
      cropCallback = context;
      setupCropCanvas();
      document.getElementById('cropModalOverlay').classList.add('open');
      drawCrop();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

function setupCropCanvas(){
  const canvas=document.getElementById('cropCanvas');
  cropCtx=canvas.getContext('2d');
  canvas.width=300;canvas.height=300;
  const vp=document.getElementById('cropViewport');
  vp.addEventListener('mousedown',onCropDragStart,{passive:false});
  vp.addEventListener('touchstart',onCropTouchStart,{passive:false});
  document.addEventListener('mousemove',onCropDragMove);
  document.addEventListener('mouseup',onCropDragEnd);
  document.addEventListener('touchmove',onCropTouchMove,{passive:false});
  document.addEventListener('touchend',onCropDragEnd);
  vp.addEventListener('wheel',onCropWheel,{passive:false});
}

function drawCrop(){
  if(!cropCtx||!cropImg)return;
  const s=300;
  cropCtx.clearRect(0,0,s,s);
  cropCtx.save();
  cropCtx.translate(s/2,s/2);
  cropCtx.rotate(cropState.rotation*Math.PI/180);
  cropCtx.scale(cropState.flipH?-1:1, cropState.flipV?-1:1);
  const zoom=cropState.zoom;
  const aspect=cropImg.width/cropImg.height;
  let iw,ih;
  if(aspect>=1){ih=s;iw=s*aspect;}else{iw=s;ih=s/aspect;}
  iw*=zoom;ih*=zoom;
  cropCtx.drawImage(cropImg,-iw/2+cropState.x,-ih/2+cropState.y,iw,ih);
  if(cropState.brightness!==0){
    const b=cropState.brightness;
    if(b>0){cropCtx.globalCompositeOperation='screen';cropCtx.fillStyle=`rgba(255,255,255,${b/200})`;cropCtx.beginPath();cropCtx.arc(0,0,s/2,0,Math.PI*2);cropCtx.fill();}
    else{cropCtx.globalCompositeOperation='multiply';cropCtx.fillStyle=`rgba(0,0,0,${-b/160})`;cropCtx.beginPath();cropCtx.arc(0,0,s/2,0,Math.PI*2);cropCtx.fill();}
  }
  cropCtx.restore();
}

function onCropDragStart(e){
  e.preventDefault();
  cropDrag.active=true;
  cropDrag.startX=e.clientX;
  cropDrag.startY=e.clientY;
  cropDrag.startImgX=cropState.x;
  cropDrag.startImgY=cropState.y;
  document.getElementById('cropViewport').classList.add('dragging');
}
function onCropTouchStart(e){
  if(e.touches.length!==1)return;
  e.preventDefault();
  const t=e.touches[0];
  cropDrag.active=true;
  cropDrag.startX=t.clientX;
  cropDrag.startY=t.clientY;
  cropDrag.startImgX=cropState.x;
  cropDrag.startImgY=cropState.y;
  document.getElementById('cropViewport').classList.add('dragging');
}
function onCropDragMove(e){
  if(!cropDrag.active)return;
  cropState.x=cropDrag.startImgX+(e.clientX-cropDrag.startX);
  cropState.y=cropDrag.startImgY+(e.clientY-cropDrag.startY);
  drawCrop();
}
function onCropTouchMove(e){
  if(!cropDrag.active||e.touches.length!==1)return;
  e.preventDefault();
  const t=e.touches[0];
  cropState.x=cropDrag.startImgX+(t.clientX-cropDrag.startX);
  cropState.y=cropDrag.startImgY+(t.clientY-cropDrag.startY);
  drawCrop();
}
function onCropDragEnd(){
  cropDrag.active=false;
  document.getElementById('cropViewport').classList.remove('dragging');
}
function onCropWheel(e){
  e.preventDefault();
  const delta=-e.deltaY*0.001;
  cropState.zoom=Math.max(1,Math.min(3,cropState.zoom+delta));
  document.getElementById('zoomSlider').value=cropState.zoom;
  document.getElementById('zoomVal').textContent=cropState.zoom.toFixed(1)+'×';
  drawCrop();
}

window.onZoomChange=(val)=>{cropState.zoom=parseFloat(val);document.getElementById('zoomVal').textContent=parseFloat(val).toFixed(1)+'×';drawCrop();};
window.onRotateChange=(val)=>{cropState.rotation=parseInt(val);document.getElementById('rotateVal').textContent=val+'°';drawCrop();};
window.onBrightnessChange=(val)=>{cropState.brightness=parseInt(val);const v=parseInt(val);document.getElementById('brightnessVal').textContent=(v>0?'+':'')+v;drawCrop();};
window.toggleFlipH=()=>{cropState.flipH=!cropState.flipH;document.getElementById('flipHBtn').classList.toggle('active',cropState.flipH);drawCrop();};
window.toggleFlipV=()=>{cropState.flipV=!cropState.flipV;document.getElementById('flipVBtn').classList.toggle('active',cropState.flipV);drawCrop();};
window.resetCrop=()=>{
  cropState={x:0,y:0,zoom:1,rotation:0,brightness:0,flipH:false,flipV:false};
  document.getElementById('zoomSlider').value=1;
  document.getElementById('rotateSlider').value=0;
  document.getElementById('brightnessSlider').value=0;
  document.getElementById('zoomVal').textContent='1.0×';
  document.getElementById('rotateVal').textContent='0°';
  document.getElementById('brightnessVal').textContent='0';
  document.getElementById('flipHBtn').classList.remove('active');
  document.getElementById('flipVBtn').classList.remove('active');
  drawCrop();
};

window.closeCropModal=()=>{
  document.getElementById('cropModalOverlay').classList.remove('open');
  const vp=document.getElementById('cropViewport');
  vp.removeEventListener('mousedown',onCropDragStart);
  vp.removeEventListener('touchstart',onCropTouchStart);
  document.removeEventListener('mousemove',onCropDragMove);
  document.removeEventListener('mouseup',onCropDragEnd);
  document.removeEventListener('touchmove',onCropTouchMove);
  document.removeEventListener('touchend',onCropDragEnd);
  vp.removeEventListener('wheel',onCropWheel);
};

window.saveCrop=async()=>{
  if(!cropCtx)return;
  const offscreen=document.createElement('canvas');
  offscreen.width=400;offscreen.height=400;
  const octx=offscreen.getContext('2d');
  const scale=400/300;
  octx.save();
  octx.beginPath();
  octx.arc(200,200,200,0,Math.PI*2);
  octx.clip();
  octx.translate(200,200);
  octx.rotate(cropState.rotation*Math.PI/180);
  octx.scale(cropState.flipH?-1:1,cropState.flipV?-1:1);
  const zoom=cropState.zoom;
  const aspect=cropImg.width/cropImg.height;
  let iw,ih;
  if(aspect>=1){ih=300;iw=300*aspect;}else{iw=300;ih=300/aspect;}
  iw*=zoom*scale;ih*=zoom*scale;
  octx.drawImage(cropImg,-iw/2+cropState.x*scale,-ih/2+cropState.y*scale,iw,ih);
  if(cropState.brightness!==0){
    const b=cropState.brightness;
    if(b>0){octx.globalCompositeOperation='screen';octx.fillStyle=`rgba(255,255,255,${b/200})`;octx.beginPath();octx.arc(0,0,200,0,Math.PI*2);octx.fill();}
    else{octx.globalCompositeOperation='multiply';octx.fillStyle=`rgba(0,0,0,${-b/160})`;octx.beginPath();octx.arc(0,0,200,0,Math.PI*2);octx.fill();}
  }
  octx.restore();
  const croppedUrl=offscreen.toDataURL('image/jpeg',0.92);
  const ctx=cropCallback;
  closeCropModal();
  if(ctx==='signup'){
    avatarDataUrl=croppedUrl;
    document.getElementById('avatarPreviewImg').src=croppedUrl;
    document.getElementById('avatarPreviewImg').style.display='block';
    document.getElementById('avatarPlaceholderSvg').style.display='none';
    showToast('Photo cropped ✓');
  } else if(ctx==='settings'){
    document.getElementById('settingsAvatar').src=croppedUrl;
    document.getElementById('topbarAvatar').src=croppedUrl;
    if(currentUser){
      currentUser.avatarUrl=croppedUrl;
      try{await update(userRef(currentUser.username),{avatarUrl:croppedUrl});showToast('Profile picture updated ✓');}
      catch{showToast('Saved locally — sync failed');}
    }
  }
};

// ── AUTH ──
window.togglePassVis=(inputId,iconEl)=>{const inp=document.getElementById(inputId);if(inp.type==='password'){inp.type='text';iconEl.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;}else{inp.type='password';iconEl.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;}};
window.validateUsername=(input)=>{const val=input.value,valid=/^[a-zA-Z0-9_]{3,20}$/.test(val);const e=document.getElementById('signupUsernameErr'),icon=document.getElementById('usernameCheckIcon');if(!val){e.style.display='none';icon.style.display='none';input.classList.remove('err');return;}if(!valid){e.textContent='3–20 chars, letters/numbers/underscore only';e.style.display='block';input.classList.add('err');icon.style.display='none';}else{e.style.display='none';input.classList.remove('err');icon.style.display='flex';}};
window.checkPwStrength=(input)=>{const pw=input.value,fill=document.getElementById('pwStrengthFill');let s=0;if(pw.length>=6)s++;if(pw.length>=10)s++;if(/[A-Z]/.test(pw))s++;if(/[0-9]/.test(pw))s++;if(/[^a-zA-Z0-9]/.test(pw))s++;fill.style.width=(s/5*100)+'%';fill.style.background=['#ff4444','#ff8800','#ffcc00','#99dd00','#1db954'][Math.min(s-1,4)]||'transparent';};
function showFieldErr(id,msg){const e=document.getElementById(id);e.textContent=msg;e.style.display='block';}
function hideFieldErr(id){document.getElementById(id).style.display='none';}
function setAuthLoading(type,loading){document.getElementById(type+'Btn').disabled=loading;document.getElementById(type+'BtnText').style.display=loading?'none':'block';document.getElementById(type+'Spinner').style.display=loading?'block':'none';}
function showAuthErr(msg){const el=document.getElementById('authErr');el.textContent=msg;el.style.display='block';el.style.animation='none';requestAnimationFrame(()=>{el.style.animation='shake .35s ease';});}
window.switchAuthTab=(tab)=>{document.getElementById('loginTab').classList.toggle('active',tab==='login');document.getElementById('signupTab').classList.toggle('active',tab==='signup');document.getElementById('loginForm').style.display=tab==='login'?'flex':'none';document.getElementById('signupForm').style.display=tab==='signup'?'flex':'none';document.getElementById('authErr').style.display='none';['loginUsernameErr','loginPassErr','signupUsernameErr','signupPhoneErr','signupPassErr','signupConfirmErr'].forEach(hideFieldErr);};

window.doSignup=async()=>{
  ['signupUsernameErr','signupPhoneErr','signupPassErr','signupConfirmErr'].forEach(hideFieldErr);
  document.getElementById('authErr').style.display='none';
  const username=document.getElementById('signupUsername').value.trim();
  const phone=document.getElementById('signupPhone').value.trim();
  const pass=document.getElementById('signupPass').value;
  const confirm=document.getElementById('signupConfirm').value;
  let e=false;
  if(!username){showFieldErr('signupUsernameErr','Username is required');e=true;}
  else if(!/^[a-zA-Z0-9_]{3,20}$/.test(username)){showFieldErr('signupUsernameErr','3–20 chars, letters/numbers/underscore only');e=true;}
  if(!phone){showFieldErr('signupPhoneErr','Mobile number is required');e=true;}
  else if(!/^\d{7,15}$/.test(phone.replace(/[\s\-+]/g,''))){showFieldErr('signupPhoneErr','Enter a valid mobile number');e=true;}
  if(!pass){showFieldErr('signupPassErr','Password is required');e=true;}
  else if(pass.length<6){showFieldErr('signupPassErr','Password must be at least 6 characters');e=true;}
  if(!confirm){showFieldErr('signupConfirmErr','Please confirm your password');e=true;}
  else if(pass!==confirm){showFieldErr('signupConfirmErr','Passwords do not match');e=true;}
  if(e)return;
  setAuthLoading('signup',true);
  try{const snap=await get(userRef(username));if(snap.exists()){showFieldErr('signupUsernameErr','Username already taken');setAuthLoading('signup',false);return;}const passwordHash=await hashPassword(pass);const userData={username,displayName:username,phone,passwordHash,avatarUrl:avatarDataUrl||'',liked:[],playlists:{},createdAt:Date.now()};await set(userRef(username),userData);saveSession(username);await loginWithData(username,userData);}
  catch(ex){showAuthErr('Sign up failed: '+(ex.message||'Try again'));setAuthLoading('signup',false);}
};

window.doLogin=async()=>{
  ['loginUsernameErr','loginPassErr'].forEach(hideFieldErr);
  document.getElementById('authErr').style.display='none';
  const username=document.getElementById('loginUsername').value.trim();
  const pass=document.getElementById('loginPass').value;
  if(!username){showFieldErr('loginUsernameErr','Username is required');return;}
  if(!pass){showFieldErr('loginPassErr','Password is required');return;}
  setAuthLoading('login',true);
  try{const snap=await get(userRef(username));if(!snap.exists()){showFieldErr('loginUsernameErr','Username not found');setAuthLoading('login',false);return;}const data=snap.val();const passwordHash=await hashPassword(pass);if(data.passwordHash!==passwordHash){showFieldErr('loginPassErr','Incorrect password');setAuthLoading('login',false);return;}saveSession(username);await loginWithData(username,data);}
  catch(ex){showAuthErr('Login failed: '+(ex.message||'Try again'));setAuthLoading('login',false);}
};

async function loginWithData(username,data){currentUser={username,displayName:data.displayName||username,phone:data.phone||'',avatarUrl:data.avatarUrl||''};likedSet=new Set(data.liked||[]);playlists=data.playlists||{};setAuthLoading('login',false);setAuthLoading('signup',false);loadStats();document.getElementById('authScreen').classList.remove('active');document.getElementById('appScreen').classList.add('active');applyUserUI();initApp();}

function applyUserUI(){const{username,displayName,phone,avatarUrl}=currentUser;const fallback=`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}`;const src=avatarUrl||fallback;document.getElementById('topbarAvatar').src=src;document.getElementById('settingsAvatar').src=src;document.getElementById('settingsProfileName').textContent=displayName;document.getElementById('settingsProfileSub').textContent=phone?` ${phone}`:`@${username}`;document.getElementById('settingsUsername').textContent=username;document.getElementById('settingsPhone').textContent=phone||'Not set';document.getElementById('likedCount').textContent=likedSet.size;document.getElementById('playlistCount').textContent=Object.keys(playlists).length;updateTotalPlaysUI();}

window.doLogout=()=>{if(currentTrackIdx>=0&&sessionStarted[tracks[currentTrackIdx].id]){const el=(Date.now()-sessionStarted[tracks[currentTrackIdx].id])/1000;recordListenTime(tracks[currentTrackIdx].id,el);}audio.pause();isPlaying=false;currentUser=null;likedSet.clear();playlists={};queue=[];clearSession();document.getElementById('appScreen').classList.remove('active');document.getElementById('authScreen').classList.add('active');document.getElementById('loginUsername').value='';document.getElementById('loginPass').value='';avatarDataUrl='';document.getElementById('avatarPreviewImg').style.display='none';document.getElementById('avatarPlaceholderSvg').style.display='block';switchAuthTab('login');};

async function saveUserData(){if(!currentUser)return;try{await update(userRef(currentUser.username),{liked:[...likedSet],playlists});}catch(e){}document.getElementById('likedCount').textContent=likedSet.size;document.getElementById('playlistCount').textContent=Object.keys(playlists).length;}

function initApp(){renderLibContent();filterTracks('all',null);renderQueueState();document.getElementById('plPlayBtn').onclick=()=>{if(currentPlaylistId)playPlaylist(currentPlaylistId);};document.getElementById('plAddSongsBtn').onclick=()=>{if(currentPlaylistId)openAddSongsModal(currentPlaylistId);};document.getElementById('plDeleteBtn').onclick=()=>{if(currentPlaylistId)confirmDeletePlaylist(currentPlaylistId);};}

window.goTab=(tab)=>{'home search library settings'.split(' ').forEach(t=>{document.getElementById('tab-'+t).classList.toggle('active',t===tab);document.getElementById(t+'Page').classList.toggle('active',t===tab);});if(tab==='search')setTimeout(()=>document.getElementById('searchInput').focus(),200);if(tab==='library')renderLibContent();if(tab==='settings')applyUserUI();};

function getGradient(id){const h=(id*37)%360;return `linear-gradient(135deg,hsl(${h},40%,18%),hsl(${(h+40)%360},50%,10%))`;}
function thumbHtml(track){if(track.cover)return `<img src="${track.cover}" alt="" onerror="this.style.display='none'">`;return `<div style="width:100%;height:100%;background:${getGradient(track.id)};display:flex;align-items:center;justify-content:center;font-size:18px">${['♪','♫','♬','♩'][track.id%4]}</div>`;}
function eqHtml(){return `<div class="eq-bars"><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div></div>`;}

function renderTrackRow(track,idx,globalIdx,container){const isActive=globalIdx===currentTrackIdx;const dur=durations[track.id]?fmtTime(durations[track.id]):'—';const row=document.createElement('div');row.className='track-item'+(isActive?' active':'');row.innerHTML=`<div class="track-num">${isActive&&isPlaying?eqHtml():`<span style="color:var(--txt3)">${idx+1}</span>`}</div><div class="track-item-art">${thumbHtml(track)}</div><div class="track-item-info"><div class="track-item-name">${track.name}</div><div class="track-item-artist">${track.artist}</div></div><div class="track-item-right"><span class="track-item-dur">${dur}</span><button class="track-more-btn" onclick="openCtxSheet(event,${globalIdx})"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button></div>`;row.addEventListener('click',e=>{if(e.target.closest('.track-more-btn'))return;playTrack(globalIdx);});container.appendChild(row);}
function renderTracks(list){const c=document.getElementById('trackList');c.innerHTML='';list.forEach((t,i)=>renderTrackRow(t,i,tracks.indexOf(t),c));}

window.playTrack=function(globalIdx){if(currentTrackIdx>=0&&sessionStarted[tracks[currentTrackIdx].id]){const el=(Date.now()-sessionStarted[tracks[currentTrackIdx].id])/1000;recordListenTime(tracks[currentTrackIdx].id,el);}currentTrackIdx=globalIdx;const track=tracks[globalIdx];audio.src=track.url;audio.load();audio.volume=isMuted?0:volume;audio.play().then(()=>{isPlaying=true;recordPlay(track.id);updateAllUI();renderTracks(filteredTracks);}).catch(()=>showToast('Could not load track'));};

function updateAllUI(){if(currentTrackIdx<0)return;const t=tracks[currentTrackIdx];document.getElementById('miniName').textContent=t.name;document.getElementById('miniArtist').textContent=t.artist;if(t.cover){document.getElementById('miniArtImg').src=t.cover;document.getElementById('miniArtImg').style.display='block';document.getElementById('miniArtPlaceholder').style.display='none';}else{document.getElementById('miniArtImg').style.display='none';document.getElementById('miniArtPlaceholder').style.display='block';}document.getElementById('npCardTitle').textContent=t.name;document.getElementById('npCardSub').textContent=`${t.artist} · ${t.album}`;if(t.cover){document.getElementById('npCardArtImg').src=t.cover;document.getElementById('npCardArtImg').style.display='block';document.getElementById('npCardArtPlaceholder').style.display='none';}else{document.getElementById('npCardArtImg').style.display='none';document.getElementById('npCardArtPlaceholder').style.display='block';}document.getElementById('npName').textContent=t.name;document.getElementById('npArtist').textContent=t.artist;if(t.cover){document.getElementById('npArtImg').src=t.cover;document.getElementById('npArtImg').style.display='block';document.getElementById('npArtPlaceholder').style.display='none';document.getElementById('npBg').style.backgroundImage=`url(${t.cover})`;}else{document.getElementById('npArtImg').style.display='none';document.getElementById('npArtPlaceholder').style.display='flex';document.getElementById('npArtPlaceholder').textContent=['♪','♫','♬','♩'][t.id%4];document.getElementById('npBg').style.backgroundImage='';}updatePlayIcons(isPlaying);updateLikeBtns();if(isPlaying)document.getElementById('npArt').classList.add('playing');else document.getElementById('npArt').classList.remove('playing');}

window.openNowPlaying=()=>{updateAllUI();document.getElementById('nowplayingOverlay').classList.add('open');};
window.closeNowPlaying=()=>document.getElementById('nowplayingOverlay').classList.remove('open');
window.openQueuePanel=()=>{renderQueuePanel();document.getElementById('queuePanelOverlay').classList.add('open');};
window.closeQueuePanel=()=>document.getElementById('queuePanelOverlay').classList.remove('open');

function renderQueuePanel(){const body=document.getElementById('queuePanelBody');body.innerHTML='';if(currentTrackIdx>=0){const t=tracks[currentTrackIdx];const ns=document.createElement('div');ns.innerHTML=`<div class="queue-now-playing"><div class="queue-now-label">Now Playing</div><div class="queue-now-track"><div class="queue-now-art">${thumbHtml(t)}</div><div><div class="queue-now-name">${t.name}</div><div class="queue-now-artist">${t.artist}</div></div></div></div>`;body.appendChild(ns);}const us=document.createElement('div');if(queue.length===0){us.innerHTML=`<div class="queue-up-next"><div class="queue-up-label">Up Next</div></div><div class="queue-empty"><div class="queue-empty-icon">🎵</div><div>Queue is empty</div><div style="font-size:11px;margin-top:4px;color:var(--txt3)">Use ⋮ on any song to add</div></div>`;}else{us.innerHTML=`<div class="queue-up-next"><div class="queue-up-label">Up Next — ${queue.length} song${queue.length!==1?'s':''}</div></div>`;queue.forEach((trackIdx,i)=>{const t=tracks[trackIdx];if(!t)return;const row=document.createElement('div');row.className='queue-track-item';row.innerHTML=`<div class="queue-track-art">${thumbHtml(t)}</div><div class="queue-track-info"><div class="queue-track-name">${t.name}</div><div class="queue-track-artist">${t.artist}</div></div><button class="queue-track-remove" onclick="removeFromQueue(${i})" title="Remove">✕</button>`;row.addEventListener('click',e=>{if(e.target.closest('.queue-track-remove'))return;queue.splice(0,i);const next=queue.shift();renderQueueState();playTrack(next);closeQueuePanel();});us.appendChild(row);});const cb=document.createElement('button');cb.className='queue-clear-btn';cb.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Clear Queue`;cb.onclick=()=>{queue=[];renderQueueState();renderQueuePanel();showToast('Queue cleared');};us.appendChild(cb);}body.appendChild(us);}
window.removeFromQueue=(i)=>{queue.splice(i,1);renderQueueState();renderQueuePanel();showToast('Removed from queue');};
function renderQueueState(){const btn=document.getElementById('miniQueueBtn');if(btn){btn.classList.toggle('has-queue',queue.length>0);btn.title=queue.length>0?`Queue (${queue.length})`:'Queue (empty)';}const badge=document.getElementById('queueCountBadge');if(badge)badge.textContent=queue.length;}

function updatePlayIcons(play){const pause=`<svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;const playIcon=`<svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M8 5v14l11-7z"/></svg>`;document.getElementById('miniPlayBtn').innerHTML=play?pause:playIcon;document.getElementById('npMainPlayBtn').innerHTML=play?`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`:`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;document.querySelector('.np-play-fab').innerHTML=play?`<svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`:`<svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M8 5v14l11-7z"/></svg>`;}
function updateLikeBtns(){if(currentTrackIdx<0)return;const liked=likedSet.has(tracks[currentTrackIdx].id);const f=liked?'var(--accent)':'none',s=liked?'var(--accent)':'currentColor';const heart=(sz)=>`<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="${f}" stroke="${s}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;document.getElementById('npCardLikeBtn').innerHTML=heart(16);document.getElementById('npCardLikeBtn').classList.toggle('liked',liked);document.getElementById('npLikeBtn').innerHTML=heart(24);document.getElementById('npLikeBtn').style.color=liked?'var(--accent)':'rgba(255,255,255,.5)';}

window.togglePlay=()=>{if(currentTrackIdx<0&&tracks.length){playTrack(0);return;}if(isPlaying){audio.pause();isPlaying=false;updatePlayIcons(false);document.getElementById('npArt').classList.remove('playing');if(currentTrackIdx>=0&&sessionStarted[tracks[currentTrackIdx].id]){const el=(Date.now()-sessionStarted[tracks[currentTrackIdx].id])/1000;recordListenTime(tracks[currentTrackIdx].id,el);delete sessionStarted[tracks[currentTrackIdx].id];}}else{audio.play();isPlaying=true;updatePlayIcons(true);document.getElementById('npArt').classList.add('playing');if(currentTrackIdx>=0)sessionStarted[tracks[currentTrackIdx].id]=Date.now();}};
window.nextTrack=()=>{if(!tracks.length)return;if(queue.length>0){const next=queue.shift();renderQueueState();playTrack(next);return;}playTrack(isShuffle?Math.floor(Math.random()*tracks.length):(currentTrackIdx+1)%tracks.length);};
window.prevTrack=()=>{if(audio.currentTime>3){audio.currentTime=0;return;}playTrack((currentTrackIdx-1+tracks.length)%tracks.length);};
window.toggleShuffle=()=>{isShuffle=!isShuffle;document.getElementById('npShuffleBtn').classList.toggle('active',isShuffle);showToast(isShuffle?'Shuffle on':'Shuffle off');};
window.toggleRepeat=()=>{isRepeat=!isRepeat;audio.loop=isRepeat;document.getElementById('npRepeatBtn').classList.toggle('active',isRepeat);showToast(isRepeat?'Repeat on':'Repeat off');};
window.toggleLike=()=>{if(currentTrackIdx<0)return;const t=tracks[currentTrackIdx];if(likedSet.has(t.id)){likedSet.delete(t.id);showToast('Removed from Liked Songs');}else{likedSet.add(t.id);showToast('Added to Liked Songs ♥');}updateLikeBtns();saveUserData();if(currentFilter==='liked')filterTracks('liked',null);};
document.getElementById('npProgBar').addEventListener('click',e=>{const pct=Math.max(0,Math.min(1,(e.clientX-e.currentTarget.getBoundingClientRect().left)/e.currentTarget.offsetWidth));if(audio.duration)audio.currentTime=pct*audio.duration;});
window.setVolume=e=>{const bar=e.currentTarget;volume=Math.max(0,Math.min(1,(e.clientX-bar.getBoundingClientRect().left)/bar.offsetWidth));audio.volume=isMuted?0:volume;document.getElementById('npVolFill').style.width=(volume*100)+'%';};
window.toggleMute=()=>{isMuted=!isMuted;audio.volume=isMuted?0:volume;document.getElementById('npMuteBtn').innerHTML=isMuted?`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;};
audio.addEventListener('timeupdate',()=>{if(!audio.duration)return;const pct=(audio.currentTime/audio.duration)*100;document.getElementById('miniProgFill').style.width=pct+'%';document.getElementById('npProgFill').style.width=pct+'%';document.getElementById('npCurTime').textContent=fmtTime(audio.currentTime);});
audio.addEventListener('loadedmetadata',()=>{document.getElementById('npTotTime').textContent=fmtTime(audio.duration);if(currentTrackIdx>=0)durations[tracks[currentTrackIdx].id]=audio.duration;});
audio.addEventListener('ended',()=>{if(!isRepeat)nextTrack();});
function fmtTime(s){if(!s||isNaN(s))return'0:00';return`${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;}
function fmtTimeVerbose(secs){if(!secs||secs<60)return`${Math.round(secs||0)}s`;const h=Math.floor(secs/3600),m=Math.floor((secs%3600)/60);if(h>0)return`${h}h ${m}m`;return`${m}m`;}

window.doSearch=(q)=>{const query=q.trim().toLowerCase();const empty=document.getElementById('searchEmpty'),results=document.getElementById('searchResults');if(!query){empty.style.display='flex';results.innerHTML='';return;}empty.style.display='none';results.innerHTML='';const found=tracks.filter(t=>t.name.toLowerCase().includes(query)||t.artist.toLowerCase().includes(query)||t.album.toLowerCase().includes(query));if(!found.length){results.innerHTML=`<div style="padding:24px;text-align:center;color:var(--txt3);font-size:14px">No results for "${q}"</div>`;return;}found.forEach((t,i)=>renderTrackRow(t,i,tracks.indexOf(t),results));};
window.filterTracks=(type,el)=>{
  if(el){document.querySelectorAll('#homeFilter .filter-chip').forEach(b=>b.classList.remove('active'));el.classList.add('active');}
  currentFilter=type;
  if(type==='all')filteredTracks=[...tracks];
  else if(type==='love')filteredTracks=tracks.filter(t=>t.category==='love');
  else if(type==='sad')filteredTracks=tracks.filter(t=>t.category==='sad');
  else if(type==='motivation')filteredTracks=tracks.filter(t=>t.category==='motivation');
  else if(type==='emotion')filteredTracks=tracks.filter(t=>t.category==='emotion');
  else if(type==='liked')filteredTracks=tracks.filter(t=>likedSet.has(t.id));
  const titles={all:'All Tracks',love:'Love Songs',sad:'Sad Songs',motivation:'Motivation',emotion:'Emotion',liked:'Liked Songs'};
  document.getElementById('sectionLabel').textContent=titles[type]||'All Tracks';
  renderTracks(filteredTracks);
};
window.openCtxSheet=(e,idx)=>{e.stopPropagation();ctxTrackIdx=idx;const t=tracks[idx];document.getElementById('ctxTrackName').textContent=t.name;document.getElementById('ctxTrackArtist').textContent=t.artist;document.getElementById('ctxTrackArt').src=t.cover||'';document.getElementById('ctxLikeLabel').textContent=likedSet.has(t.id)?'Unlike Song':'Like Song';document.getElementById('ctxSheet').classList.add('open');};
window.closeCtxSheet=()=>document.getElementById('ctxSheet').classList.remove('open');
window.ctxAddToQueue=()=>{if(ctxTrackIdx<0)return;queue.push(ctxTrackIdx);renderQueueState();showToast(`"${tracks[ctxTrackIdx].name}" added to queue`);};
window.ctxLike=()=>{const t=tracks[ctxTrackIdx];if(likedSet.has(t.id)){likedSet.delete(t.id);showToast('Removed from Liked Songs');}else{likedSet.add(t.id);showToast('Added to Liked Songs ♥');}if(ctxTrackIdx===currentTrackIdx)updateLikeBtns();saveUserData();if(currentFilter==='liked')filterTracks('liked',null);};
window.ctxPlayNext=()=>{if(ctxTrackIdx<0)return;queue.unshift(ctxTrackIdx);renderQueueState();showToast('Playing next');};
window.ctxAddToPlaylist=()=>{const ids=Object.keys(playlists);if(!ids.length){showToast('No playlists yet — create one in Library');closeCtxSheet();return;}const list=document.getElementById('plSubmenuList');list.innerHTML='';ids.forEach(id=>{const item=document.createElement('div');item.className='ctx-item';item.textContent=playlists[id].name;item.onclick=()=>{const pl=playlists[id];if(!pl.songIds)pl.songIds=[];if(!pl.songIds.includes(tracks[ctxTrackIdx].id)){pl.songIds.push(tracks[ctxTrackIdx].id);saveUserData();showToast(`Added to "${pl.name}"`);}else showToast('Already in playlist');document.getElementById('plSubmenuOverlay').classList.remove('open');closeCtxSheet();};list.appendChild(item);});document.getElementById('plSubmenuOverlay').classList.add('open');};

window.openSleepModal=()=>{document.querySelectorAll('.sleep-opt').forEach(o=>o.classList.remove('active'));openModal('sleepModal');};
window.setSleepTimer=(mins,el)=>{document.querySelectorAll('.sleep-opt').forEach(o=>o.classList.remove('active'));el.classList.add('active');sleepEnd=Date.now()+mins*60000;clearTimeout(sleepTimer);clearInterval(sleepInterval);sleepTimer=setTimeout(()=>{audio.pause();isPlaying=false;updatePlayIcons(false);showToast('Sleep timer ended — music stopped');document.getElementById('sleepIndicator').classList.remove('active');document.getElementById('sleepFieldValue').textContent='Off';clearInterval(sleepInterval);sleepTimer=null;},mins*60000);document.getElementById('sleepIndicator').classList.add('active');document.getElementById('sleepLabel').textContent=`${mins}m`;document.getElementById('sleepFieldValue').textContent=`${mins} min`;clearInterval(sleepInterval);sleepInterval=setInterval(()=>{const rem=Math.max(0,Math.round((sleepEnd-Date.now())/60000));document.getElementById('sleepLabel').textContent=`${rem}m`;document.getElementById('sleepFieldValue').textContent=rem>0?`${rem} min`:'Off';if(rem<=0)clearInterval(sleepInterval);},30000);showToast(`Sleep timer: ${mins} minutes`);};
window.cancelSleepTimer=()=>{clearTimeout(sleepTimer);clearInterval(sleepInterval);sleepTimer=null;document.getElementById('sleepIndicator').classList.remove('active');document.getElementById('sleepFieldValue').textContent='Off';document.querySelectorAll('.sleep-opt').forEach(o=>o.classList.remove('active'));closeModal('sleepModal');showToast('Sleep timer cancelled');};

window.switchLibTab=(tab,el)=>{currentLibTab=tab;document.querySelectorAll('.lib-tab').forEach(t=>t.classList.remove('active'));if(el)el.classList.add('active');renderLibContent();};
function renderLibContent(){const c=document.getElementById('libContent');c.innerHTML='';if(currentLibTab==='playlists'){const lc=document.createElement('div');lc.className='pl-card';lc.innerHTML=`<div class="pl-card-art liked-card-art"><svg width="22" height="22" viewBox="0 0 24 24" fill="var(--accent)"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div><div class="pl-card-info"><div class="pl-card-name">Liked Songs</div><div class="pl-card-sub">${likedSet.size} songs</div></div>`;lc.onclick=()=>{document.querySelectorAll('.lib-tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.lib-tab')[1].classList.add('active');switchLibTab('liked',null);};c.appendChild(lc);Object.entries(playlists).forEach(([id,pl])=>{const songs=(pl.songIds||[]).length;const card=document.createElement('div');card.className='pl-card';card.innerHTML=`<div class="pl-card-art">${pl.cover?`<img src="${pl.cover}" alt="">`:`<div style="width:100%;height:100%;background:${getGradient(id.length)};display:flex;align-items:center;justify-content:center;font-size:22px">🎵</div>`}</div><div class="pl-card-info"><div class="pl-card-name">${pl.name}</div><div class="pl-card-sub">${songs} song${songs!==1?'s':''}</div></div><button class="pl-card-more" onclick="event.stopPropagation()"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button>`;card.addEventListener('click',e=>{if(e.target.closest('.pl-card-more'))return;openPlDetail(id);});c.appendChild(card);});}else{const liked=tracks.filter(t=>likedSet.has(t.id));if(!liked.length){c.innerHTML='<div style="padding:40px;text-align:center;color:var(--txt3);font-size:14px">No liked songs yet</div>';return;}const tl=document.createElement('div');tl.className='track-list';liked.forEach((t,i)=>renderTrackRow(t,i,tracks.indexOf(t),tl));c.appendChild(tl);}}

window.openPlDetail=(id)=>{currentPlaylistId=id;const pl=playlists[id];if(!pl)return;document.getElementById('plDetailTopName').textContent=pl.name;document.getElementById('plDetailName').textContent=pl.name;const songs=(pl.songIds||[]).map(sid=>tracks.find(t=>t.id===sid)).filter(Boolean);document.getElementById('plDetailSub').textContent=`${songs.length} song${songs.length!==1?'s':''}`;document.getElementById('plDetailArt').src=pl.cover||`https://api.dicebear.com/7.x/shapes/svg?seed=${pl.name}`;const c=document.getElementById('plDetailTrackList');c.innerHTML='';songs.forEach((t,i)=>renderTrackRow(t,i,tracks.indexOf(t),c));document.getElementById('plDetailOverlay').classList.add('open');};
window.closePlDetail=()=>{document.getElementById('plDetailOverlay').classList.remove('open');renderLibContent();};
window.playPlaylist=(id)=>{const pl=playlists[id];if(!pl||!pl.songIds?.length){showToast('No songs in playlist');return;}const first=tracks.findIndex(t=>t.id===pl.songIds[0]);if(first>=0)playTrack(first);queue=pl.songIds.slice(1).map(sid=>tracks.findIndex(t=>t.id===sid)).filter(i=>i>=0);renderQueueState();closePlDetail();};
window.confirmDeletePlaylist=(id)=>{const pl=playlists[id];if(!pl)return;document.getElementById('deleteConfirmSub').textContent=`Delete "${pl.name}"? This cannot be undone.`;document.getElementById('deleteConfirmOk').onclick=()=>{delete playlists[id];saveUserData();closeDeleteConfirm();closePlDetail();showToast('Playlist deleted');};document.getElementById('deleteConfirmModal').classList.add('open');};
window.closeDeleteConfirm=()=>document.getElementById('deleteConfirmModal').classList.remove('open');

window.previewPlArt=(input)=>{const f=input.files[0];if(!f)return;const r=new FileReader();r.onload=e=>{plArtDataUrl=e.target.result;document.getElementById('plArtPreview').src=plArtDataUrl;document.getElementById('plArtPreview').style.display='block';document.getElementById('plArtPlaceholder').style.display='none';};r.readAsDataURL(f);};
window.openNewPlaylistModal=()=>{document.getElementById('newPlName').value='';plArtDataUrl='';document.getElementById('plArtPreview').style.display='none';document.getElementById('plArtPlaceholder').style.display='block';openModal('newPlaylistModal');};
window.createPlaylist=()=>{const name=document.getElementById('newPlName').value.trim();if(!name){showToast('Enter a playlist name');return;}const id='pl_'+Date.now();playlists[id]={name,cover:plArtDataUrl,songIds:[]};saveUserData();renderLibContent();closeModal('newPlaylistModal');showToast(`Playlist "${name}" created`);openPlDetail(id);};
window.openAddSongsModal=(plId)=>{addSongModalPlaylistId=plId;const pl=playlists[plId];addSongModalSelected=new Set(pl?.songIds||[]);document.getElementById('addSongsSearch').value='';renderAddSongsModal(tracks);openModal('addSongsModal');};
function renderAddSongsModal(list){const c=document.getElementById('addSongsList');c.innerHTML='';list.forEach(t=>{const row=document.createElement('div');row.className='modal-song-row';const checked=addSongModalSelected.has(t.id);row.innerHTML=`<div class="modal-song-check ${checked?'checked':''}">${checked?`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`:''}</div><div class="modal-song-thumb">${thumbHtml(t)}</div><div style="min-width:0;flex:1"><div style="font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.name}</div><div style="font-size:12px;color:var(--txt2)">${t.artist}</div></div>`;row.onclick=()=>{if(addSongModalSelected.has(t.id))addSongModalSelected.delete(t.id);else addSongModalSelected.add(t.id);renderAddSongsModal(list);};c.appendChild(row);});}
window.filterAddSongs=(q)=>{const query=q.toLowerCase();renderAddSongsModal(query?tracks.filter(t=>t.name.toLowerCase().includes(query)||t.artist.toLowerCase().includes(query)):tracks);};
window.saveAddedSongs=()=>{if(!addSongModalPlaylistId||!playlists[addSongModalPlaylistId])return;playlists[addSongModalPlaylistId].songIds=[...addSongModalSelected];saveUserData();if(currentPlaylistId===addSongModalPlaylistId)openPlDetail(addSongModalPlaylistId);closeModal('addSongsModal');showToast('Playlist updated');};

window.updateProfileAvatar=async(input)=>{const f=input.files[0];if(!f)return;const r=new FileReader();r.onload=async e=>{const url=e.target.result;document.getElementById('settingsAvatar').src=url;document.getElementById('topbarAvatar').src=url;if(currentUser){currentUser.avatarUrl=url;try{await update(userRef(currentUser.username),{avatarUrl:url});showToast('Profile picture updated');}catch{showToast('Failed to save');}}};r.readAsDataURL(f);};
window.openEditProfileModal=()=>{document.getElementById('editUsername').value=currentUser?.username||'';document.getElementById('editName').value=currentUser?.displayName||'';document.getElementById('editPhone').value=currentUser?.phone||'';openModal('editProfileModal');};
window.saveProfile=async()=>{const name=document.getElementById('editName').value.trim();const phone=document.getElementById('editPhone').value.trim();if(!name){showToast('Enter a display name');return;}try{await update(userRef(currentUser.username),{displayName:name,phone:phone||''});currentUser.displayName=name;currentUser.phone=phone;applyUserUI();closeModal('editProfileModal');showToast('Profile updated');}catch{showToast('Failed to update profile');}};

window.openStatsPage=()=>{renderStatsPage();document.getElementById('statsOverlay').classList.add('open');};
window.closeStatsPage=()=>document.getElementById('statsOverlay').classList.remove('open');
function getFilteredHistory(period){const now=Date.now();let cutoff=0;if(period==='week')cutoff=now-7*24*3600*1000;else if(period==='month')cutoff=now-30*24*3600*1000;else if('3months'===period)cutoff=now-90*24*3600*1000;return playHistory.filter(h=>h.timestamp>=cutoff);}
function getStatsForPeriod(period){if(period==='all'){const totalPlays=Object.values(playCounts).reduce((a,b)=>a+b,0);const totalSeconds=Object.values(listenSeconds).reduce((a,b)=>a+b,0);const songsPlayed=Object.keys(playCounts).filter(id=>playCounts[id]>0).length;const topTracks=Object.entries(playCounts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([id,count])=>({track:tracks.find(t=>t.id==id),count,secs:listenSeconds[id]||0})).filter(x=>x.track);return{totalPlays,totalSeconds,songsPlayed,topTracks};}else{const hist=getFilteredHistory(period);const pc={},ps={};hist.forEach(h=>{pc[h.trackId]=(pc[h.trackId]||0)+1;ps[h.trackId]=(ps[h.trackId]||0)+(h.duration||0);});const totalPlays=hist.length;const totalSeconds=Object.values(ps).reduce((a,b)=>a+b,0);const songsPlayed=Object.keys(pc).length;const topTracks=Object.entries(pc).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([id,count])=>({track:tracks.find(t=>t.id==id),count,secs:ps[id]||0})).filter(x=>x.track);return{totalPlays,totalSeconds,songsPlayed,topTracks};}}

function renderStatsPage(){const scroll=document.getElementById('statsScroll');scroll.innerHTML='';const stats=getStatsForPeriod(statsPeriod);const totalAllTimePlays=Object.values(playCounts).reduce((a,b)=>a+b,0);const periodTabsHtml=`<div style="padding:16px 16px 0;"><div class="stats-period-tabs"><button class="stats-period-tab ${statsPeriod==='week'?'active':''}" onclick="setStatsPeriod('week')">1 Week</button><button class="stats-period-tab ${statsPeriod==='month'?'active':''}" onclick="setStatsPeriod('month')">1 Month</button><button class="stats-period-tab ${statsPeriod==='3months'?'active':''}" onclick="setStatsPeriod('3months')">3 Months</button><button class="stats-period-tab ${statsPeriod==='all'?'active':''}" onclick="setStatsPeriod('all')">All Time</button></div></div>`;const heroHtml=`<div style="padding:0 16px 16px;"><div class="stats-hero"><div class="stats-hero-row"><div class="stats-hero-main"><div class="stats-big-num">${stats.totalPlays}</div><div class="stats-big-label">Total Plays</div></div><div class="stats-hero-side"><div class="stats-side-item"><div class="stats-side-num">${fmtTimeVerbose(stats.totalSeconds)}</div><div class="stats-side-label">Listening Time</div></div><div class="stats-side-item"><div class="stats-side-num">${stats.songsPlayed}</div><div class="stats-side-label">Songs Played</div></div></div></div></div></div>`;const avgPerDay=statsPeriod==='week'?(stats.totalPlays/7).toFixed(1):statsPeriod==='month'?(stats.totalPlays/30).toFixed(1):statsPeriod==='3months'?(stats.totalPlays/90).toFixed(1):(totalAllTimePlays/Math.max(1,Math.ceil((Date.now()-(playHistory[0]?.timestamp||Date.now()))/(86400000)))).toFixed(1);const miniCardsHtml=`<div class="stats-cards-row"><div class="stats-mini-card"><div class="stats-mini-icon" style="background:rgba(29,185,84,.12);"><svg width="18" height="18" viewBox="0 0 24 24" fill="var(--txt3)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div><div class="stats-mini-num" style="color:var(--accent)">${tracks.length}</div><div class="stats-mini-label">Songs in Library</div></div><div class="stats-mini-card"><div class="stats-mini-icon" style="background:rgba(74,158,255,.12);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg></div><div class="stats-mini-num" style="color:var(--stats-blue)">${avgPerDay}</div><div class="stats-mini-label">Avg plays/day</div></div><div class="stats-mini-card"><div class="stats-mini-icon" style="background:rgba(244,185,66,.12);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div><div class="stats-mini-num" style="color:var(--stats-gold)">${likedSet.size}</div><div class="stats-mini-label">Liked Songs</div></div><div class="stats-mini-card"><div class="stats-mini-icon" style="background:rgba(168,85,247,.12);"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div><div class="stats-mini-num" style="color:var(--stats-purple)">${Object.keys(playlists).length}</div><div class="stats-mini-label">Playlists</div></div></div>`;let topSongsHtml='';if(stats.topTracks.length===0){topSongsHtml=`<div class="stats-section"><div class="stats-section-title"> Top Songs <span class="badge" style="background:var(--bg3);color:var(--txt3)">0</span></div><div class="stats-empty"><div class="stats-empty-icon">🎧</div><div style="font-size:15px;font-weight:700;color:var(--txt2)">No plays yet</div><div style="font-size:13px;margin-top:6px">Start playing music to see your stats!</div></div></div>`;}else{const maxCount=stats.topTracks[0]?.count||1;const rankColors=['top1','top2','top3'];const songRows=stats.topTracks.map((item,i)=>{const pct=Math.round((item.count/maxCount)*100);return`<div class="stats-song-item"><div class="stats-song-rank ${rankColors[i]||''}">${i+1}</div><div class="stats-song-art">${thumbHtml(item.track)}</div><div class="stats-song-info"><div class="stats-song-name">${item.track.name}</div><div class="stats-song-artist">${item.track.artist}</div><div class="stats-prog-wrap"><div class="stats-prog-fill" style="width:${pct}%"></div></div></div><div class="stats-song-right"><div class="stats-play-count">${item.count}</div><div class="stats-play-label">play${item.count!==1?'s':''}</div>${item.secs>0?`<div class="stats-time-label">${fmtTimeVerbose(item.secs)}</div>`:''}</div></div>`;}).join('');topSongsHtml=`<div class="stats-section"><div class="stats-section-title"> Top Songs <span class="badge" style="background:var(--accent-dim);color:var(--accent)">${stats.topTracks.length}</span></div>${songRows}</div>`;}scroll.innerHTML=periodTabsHtml+heroHtml+miniCardsHtml+topSongsHtml;}
window.setStatsPeriod=(period)=>{statsPeriod=period;renderStatsPage();};

window.openModal=(id)=>document.getElementById(id).classList.add('open');
window.closeModal=(id)=>document.getElementById(id).classList.remove('open');
document.querySelectorAll('.modal-overlay').forEach(m=>{m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('open');});});

let toastT;
window.showToast=(msg)=>{const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2400);};
document.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;if(e.code==='Space'){e.preventDefault();togglePlay();}else if(e.code==='ArrowRight')nextTrack();else if(e.code==='ArrowLeft')prevTrack();else if(e.code==='Escape'){closeNowPlaying();closeQueuePanel();closeStatsPage();closeCropModal();}});
tracks.forEach(t=>{const a=new Audio();a.preload='metadata';a.src=t.url;a.addEventListener('loadedmetadata',()=>{durations[t.id]=a.duration;});});

// Register service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
