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
      return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function resolveAuth(showScreen) {
      const splash = document.getElementById('splashScreen');
      const authEl = document.getElementById('authScreen');
      const appEl  = document.getElementById('appScreen');
      if (showScreen === 'app') {
        appEl.classList.add('active');
        requestAnimationFrame(() => requestAnimationFrame(() => { appEl.classList.add('visible'); splash.classList.add('hidden'); }));
      } else {
        authEl.classList.add('active');
        requestAnimationFrame(() => requestAnimationFrame(() => { authEl.classList.add('visible'); splash.classList.add('hidden'); }));
      }
    }

    // ── STATE ──
    let currentUser = null, currentTrackIdx = -1, isPlaying = false, isShuffle = false, isRepeat = false, volume = 0.8, isMuted = false;
    let likedSet = new Set(), playlists = {}, filteredTracks = [...tracks], currentFilter = 'all';
    let queue = [], ctxTrackIdx = -1, currentPlaylistId = null;
    let addSongModalPlaylistId = null, addSongModalSelected = new Set();
    let durations = {}, avatarDataUrl = '', plArtDataUrl = '';
    let currentLibTab = 'playlists';
    let playCounts = {}, listenSeconds = {}, sessionStarted = {}, statsPeriod = 'all', playHistory = [];
    const STATS_KEY = 'mova_stats_v1', HISTORY_KEY = 'mova_history_v1';
    let lpTrackIdx = -1;
    let plDetailIsLiked = false;

    // ══════════════════════════════════════════════════════
    //  SLEEP TIMER
    // ══════════════════════════════════════════════════════
    let sleepEnd = 0;
    let sleepTimeoutId = null;
    let sleepTickId = null;

    function fmtSleep(secs) {
      const s = Math.max(0, Math.floor(secs));
      const m = Math.floor(s / 60);
      const ss = (s % 60).toString().padStart(2, '0');
      return `${m}:${ss}`;
    }

    function sleepTick() {
      const rem = (sleepEnd - Date.now()) / 1000;
      if (rem <= 0) {
        updateSleepDisplay(0);
        return;
      }
      updateSleepDisplay(rem);
    }

    function updateSleepDisplay(remSecs) {
      const formatted = fmtSleep(remSecs);
      const label = document.getElementById('sleepLabel');
      if (label) label.textContent = formatted;
      const field = document.getElementById('sleepFieldValue');
      if (field) field.textContent = remSecs > 0 ? formatted : 'Off';
      const cdEl = document.getElementById('npCountdown');
      const row = document.getElementById('npCountdownRow');
      if (cdEl) cdEl.textContent = remSecs > 0 ? formatted : '0:00';
      if (row) {
        if (remSecs > 0) {
          row.classList.add('sleep-active');
          row.style.display = 'flex';
        } else {
          row.classList.remove('sleep-active');
          row.style.display = 'none';
        }
      }
      const iconEl = document.getElementById('npCountdownIcon');
      if (iconEl) {
        if (remSecs > 0) {
          iconEl.setAttribute('stroke', 'var(--accent)');
        } else {
          iconEl.setAttribute('stroke', 'rgba(255,255,255,0.5)');
        }
      }
    }

    function clearSleepTimer() {
      clearTimeout(sleepTimeoutId);
      clearInterval(sleepTickId);
      sleepTimeoutId = null;
      sleepTickId = null;
      sleepEnd = 0;
    }

    function stopSleepUI() {
      const indicator = document.getElementById('sleepIndicator');
      if (indicator) indicator.classList.remove('active');
      const field = document.getElementById('sleepFieldValue');
      if (field) field.textContent = 'Off';
      const row = document.getElementById('npCountdownRow');
      if (row) {
        row.classList.remove('sleep-active');
        row.style.display = 'none';
      }
      const iconEl = document.getElementById('npCountdownIcon');
      if (iconEl) iconEl.setAttribute('stroke', 'rgba(255,255,255,0.5)');
    }

    window.setSleepTimer = (mins, el) => {
      clearSleepTimer();
      document.querySelectorAll('.sleep-opt').forEach(o => o.classList.remove('active'));
      if (el) el.classList.add('active');
      const ms = mins * 60 * 1000;
      sleepEnd = Date.now() + ms;
      const indicator = document.getElementById('sleepIndicator');
      if (indicator) indicator.classList.add('active');
      updateSleepDisplay(mins * 60);
      sleepTickId = setInterval(sleepTick, 1000);
      sleepTimeoutId = setTimeout(() => {
        clearInterval(sleepTickId);
        sleepTickId = null;
        audio.pause();
        isPlaying = false;
        updatePlayIcons(false);
        updateMediaSessionPlaybackState('paused');
        showToast('Sleep timer ended — music stopped 💤');
        stopSleepUI();
        document.querySelectorAll('.sleep-opt').forEach(o => o.classList.remove('active'));
      }, ms);
      showToast(`Sleep timer: ${mins} min ⏱`);
    };

    window.cancelSleepTimer = () => {
      clearSleepTimer();
      stopSleepUI();
      document.querySelectorAll('.sleep-opt').forEach(o => o.classList.remove('active'));
      showToast('Sleep timer cancelled');
      closeModal('sleepModal');
    };

    window.openSleepModal = () => openModal('sleepModal');

    // ── MEDIA SESSION & HELPERS ──
    function updateMediaSession(track) {
      if (!('mediaSession' in navigator)) return;
      const artworkSrc = track.cover || 'logo.png';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.name || 'Unknown Title', artist: track.artist || 'Unknown Artist',
        album: track.album || 'MY Song',
        artwork: [96,128,192,256,384,512].map(s => ({ src: artworkSrc, sizes: `${s}x${s}`, type: 'image/jpeg' })),
      });
      navigator.mediaSession.setActionHandler('play', () => { if (!isPlaying) togglePlay(); });
      navigator.mediaSession.setActionHandler('pause', () => { if (isPlaying) togglePlay(); });
      navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
      navigator.mediaSession.setActionHandler('seekbackward', (d) => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); syncMediaSessionPosition(); });
      navigator.mediaSession.setActionHandler('seekforward', (d) => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (d.seekOffset || 10)); syncMediaSessionPosition(); });
      navigator.mediaSession.setActionHandler('seekto', (d) => { if (d.seekTime !== undefined && audio.duration) { audio.currentTime = d.seekTime; syncMediaSessionPosition(); } });
      navigator.mediaSession.setActionHandler('stop', () => { audio.pause(); audio.currentTime = 0; isPlaying = false; updatePlayIcons(false); updateMediaSessionPlaybackState('none'); });
    }
    function updateMediaSessionPlaybackState(state) { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state; }
    function syncMediaSessionPosition() {
      if (!('mediaSession' in navigator)) return;
      if (!audio.duration || isNaN(audio.duration)) return;
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) }); } catch (e) {}
    }

    // ── STATS ──
    function loadStats() {
      try { const s = localStorage.getItem(STATS_KEY); if (s) { const d = JSON.parse(s); playCounts = d.playCounts || {}; listenSeconds = d.listenSeconds || {}; } const h = localStorage.getItem(HISTORY_KEY); if (h) { playHistory = JSON.parse(h) || []; } } catch (e) {}
    }
    function saveStats() {
      try { localStorage.setItem(STATS_KEY, JSON.stringify({ playCounts, listenSeconds })); localStorage.setItem(HISTORY_KEY, JSON.stringify(playHistory.slice(-500))); } catch (e) {}
    }
    function recordPlay(trackId) { playCounts[trackId] = (playCounts[trackId] || 0) + 1; sessionStarted[trackId] = Date.now(); playHistory.push({ trackId, timestamp: Date.now(), duration: 0 }); saveStats(); updateTotalPlaysUI(); }
    function recordListenTime(trackId, seconds) { if (seconds < 2) return; listenSeconds[trackId] = (listenSeconds[trackId] || 0) + seconds; if (playHistory.length > 0) { const last = playHistory[playHistory.length - 1]; if (last.trackId === trackId) last.duration = seconds; } saveStats(); }
    function updateTotalPlaysUI() { const total = Object.values(playCounts).reduce((a, b) => a + b, 0); const el = document.getElementById('totalPlaysCount'); if (el) el.textContent = total; }

    // ── AUDIO ──
    const audio = document.getElementById('audioEl');
    audio.volume = volume;

    function userRef(u) { return ref(db, 'users/' + u); }
    const SESSION_KEY = 'mova_session_v2';
    function saveSession(u) { localStorage.setItem(SESSION_KEY, u); }
    function clearSession() { localStorage.removeItem(SESSION_KEY); }
    function getSavedSession() { return localStorage.getItem(SESSION_KEY); }

    (async () => {
      const saved = getSavedSession();
      if (saved) {
        try { const snap = await get(userRef(saved)); if (snap.exists()) { await loginWithData(saved, snap.val()); return; } } catch (e) {}
        clearSession();
      }
      resolveAuth('auth');
    })();

    // ── CROP ENGINE ──
    let cropImg = null, cropCtx = null, cropCallback = null;
    let cropState = { x: 0, y: 0, zoom: 1, rotation: 0, brightness: 0, flipH: false, flipV: false };
    let cropDrag = { active: false, startX: 0, startY: 0, startImgX: 0, startImgY: 0 };

    window.openCropModal = (inputEl, context) => {
      const file = inputEl.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          cropImg = img; cropState = { x: 0, y: 0, zoom: 1, rotation: 0, brightness: 0, flipH: false, flipV: false };
          document.getElementById('zoomSlider').value = 1; document.getElementById('rotateSlider').value = 0; document.getElementById('brightnessSlider').value = 0;
          document.getElementById('zoomVal').textContent = '1.0×'; document.getElementById('rotateVal').textContent = '0°'; document.getElementById('brightnessVal').textContent = '0';
          document.getElementById('flipHBtn').classList.remove('active'); document.getElementById('flipVBtn').classList.remove('active');
          inputEl.value = ''; cropCallback = context; setupCropCanvas(); document.getElementById('cropModalOverlay').classList.add('open'); drawCrop();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    };
    function setupCropCanvas() {
      const canvas = document.getElementById('cropCanvas'); cropCtx = canvas.getContext('2d'); canvas.width = 300; canvas.height = 300;
      const vp = document.getElementById('cropViewport');
      vp.addEventListener('mousedown', onCropDragStart, { passive: false }); vp.addEventListener('touchstart', onCropTouchStart, { passive: false });
      document.addEventListener('mousemove', onCropDragMove); document.addEventListener('mouseup', onCropDragEnd);
      document.addEventListener('touchmove', onCropTouchMove, { passive: false }); document.addEventListener('touchend', onCropDragEnd);
      vp.addEventListener('wheel', onCropWheel, { passive: false });
    }
    function drawCrop() {
      if (!cropCtx || !cropImg) return;
      const s = 300; cropCtx.clearRect(0, 0, s, s); cropCtx.save(); cropCtx.translate(s / 2, s / 2);
      cropCtx.rotate(cropState.rotation * Math.PI / 180); cropCtx.scale(cropState.flipH ? -1 : 1, cropState.flipV ? -1 : 1);
      const zoom = cropState.zoom; const aspect = cropImg.width / cropImg.height;
      let iw, ih; if (aspect >= 1) { ih = s; iw = s * aspect; } else { iw = s; ih = s / aspect; } iw *= zoom; ih *= zoom;
      cropCtx.drawImage(cropImg, -iw / 2 + cropState.x, -ih / 2 + cropState.y, iw, ih);
      if (cropState.brightness !== 0) { const b = cropState.brightness; if (b > 0) { cropCtx.globalCompositeOperation = 'screen'; cropCtx.fillStyle = `rgba(255,255,255,${b / 200})`; cropCtx.beginPath(); cropCtx.arc(0, 0, s / 2, 0, Math.PI * 2); cropCtx.fill(); } else { cropCtx.globalCompositeOperation = 'multiply'; cropCtx.fillStyle = `rgba(0,0,0,${-b / 160})`; cropCtx.beginPath(); cropCtx.arc(0, 0, s / 2, 0, Math.PI * 2); cropCtx.fill(); } }
      cropCtx.restore();
    }
    function onCropDragStart(e) { e.preventDefault(); cropDrag.active = true; cropDrag.startX = e.clientX; cropDrag.startY = e.clientY; cropDrag.startImgX = cropState.x; cropDrag.startImgY = cropState.y; document.getElementById('cropViewport').classList.add('dragging'); }
    function onCropTouchStart(e) { if (e.touches.length !== 1) return; e.preventDefault(); const t = e.touches[0]; cropDrag.active = true; cropDrag.startX = t.clientX; cropDrag.startY = t.clientY; cropDrag.startImgX = cropState.x; cropDrag.startImgY = cropState.y; document.getElementById('cropViewport').classList.add('dragging'); }
    function onCropDragMove(e) { if (!cropDrag.active) return; cropState.x = cropDrag.startImgX + (e.clientX - cropDrag.startX); cropState.y = cropDrag.startImgY + (e.clientY - cropDrag.startY); drawCrop(); }
    function onCropTouchMove(e) { if (!cropDrag.active || e.touches.length !== 1) return; e.preventDefault(); const t = e.touches[0]; cropState.x = cropDrag.startImgX + (t.clientX - cropDrag.startX); cropState.y = cropDrag.startImgY + (t.clientY - cropDrag.startY); drawCrop(); }
    function onCropDragEnd() { cropDrag.active = false; document.getElementById('cropViewport').classList.remove('dragging'); }
    function onCropWheel(e) { e.preventDefault(); const delta = -e.deltaY * 0.001; cropState.zoom = Math.max(1, Math.min(3, cropState.zoom + delta)); document.getElementById('zoomSlider').value = cropState.zoom; document.getElementById('zoomVal').textContent = cropState.zoom.toFixed(1) + '×'; drawCrop(); }
    window.onZoomChange = (val) => { cropState.zoom = parseFloat(val); document.getElementById('zoomVal').textContent = parseFloat(val).toFixed(1) + '×'; drawCrop(); };
    window.onRotateChange = (val) => { cropState.rotation = parseInt(val); document.getElementById('rotateVal').textContent = val + '°'; drawCrop(); };
    window.onBrightnessChange = (val) => { cropState.brightness = parseInt(val); const v = parseInt(val); document.getElementById('brightnessVal').textContent = (v > 0 ? '+' : '') + v; drawCrop(); };
    window.toggleFlipH = () => { cropState.flipH = !cropState.flipH; document.getElementById('flipHBtn').classList.toggle('active', cropState.flipH); drawCrop(); };
    window.toggleFlipV = () => { cropState.flipV = !cropState.flipV; document.getElementById('flipVBtn').classList.toggle('active', cropState.flipV); drawCrop(); };
    window.resetCrop = () => {
      cropState = { x: 0, y: 0, zoom: 1, rotation: 0, brightness: 0, flipH: false, flipV: false };
      document.getElementById('zoomSlider').value = 1; document.getElementById('rotateSlider').value = 0; document.getElementById('brightnessSlider').value = 0;
      document.getElementById('zoomVal').textContent = '1.0×'; document.getElementById('rotateVal').textContent = '0°'; document.getElementById('brightnessVal').textContent = '0';
      document.getElementById('flipHBtn').classList.remove('active'); document.getElementById('flipVBtn').classList.remove('active'); drawCrop();
    };
    window.closeCropModal = () => {
      document.getElementById('cropModalOverlay').classList.remove('open');
      const vp = document.getElementById('cropViewport');
      vp.removeEventListener('mousedown', onCropDragStart); vp.removeEventListener('touchstart', onCropTouchStart);
      document.removeEventListener('mousemove', onCropDragMove); document.removeEventListener('mouseup', onCropDragEnd);
      document.removeEventListener('touchmove', onCropTouchMove); document.removeEventListener('touchend', onCropDragEnd);
      vp.removeEventListener('wheel', onCropWheel);
    };
    window.saveCrop = async () => {
      if (!cropCtx) return;
      const offscreen = document.createElement('canvas'); offscreen.width = 400; offscreen.height = 400;
      const octx = offscreen.getContext('2d'); const scale = 400 / 300;
      octx.save(); octx.beginPath(); octx.arc(200, 200, 200, 0, Math.PI * 2); octx.clip();
      octx.translate(200, 200); octx.rotate(cropState.rotation * Math.PI / 180); octx.scale(cropState.flipH ? -1 : 1, cropState.flipV ? -1 : 1);
      const zoom = cropState.zoom; const aspect = cropImg.width / cropImg.height;
      let iw, ih; if (aspect >= 1) { ih = 300; iw = 300 * aspect; } else { iw = 300; ih = 300 / aspect; } iw *= zoom * scale; ih *= zoom * scale;
      octx.drawImage(cropImg, -iw / 2 + cropState.x * scale, -ih / 2 + cropState.y * scale, iw, ih);
      if (cropState.brightness !== 0) { const b = cropState.brightness; if (b > 0) { octx.globalCompositeOperation = 'screen'; octx.fillStyle = `rgba(255,255,255,${b / 200})`; octx.beginPath(); octx.arc(0, 0, 200, 0, Math.PI * 2); octx.fill(); } else { octx.globalCompositeOperation = 'multiply'; octx.fillStyle = `rgba(0,0,0,${-b / 160})`; octx.beginPath(); octx.arc(0, 0, 200, 0, Math.PI * 2); octx.fill(); } }
      octx.restore();
      const croppedUrl = offscreen.toDataURL('image/jpeg', 0.92);
      const ctx = cropCallback; closeCropModal();
      if (ctx === 'signup') {
        avatarDataUrl = croppedUrl;
        document.getElementById('avatarPreviewImg').src = croppedUrl; document.getElementById('avatarPreviewImg').style.display = 'block'; document.getElementById('avatarPlaceholderSvg').style.display = 'none'; showToast('Photo cropped ✓');
      } else if (ctx === 'settings') {
        document.getElementById('settingsAvatar').src = croppedUrl; document.getElementById('topbarAvatar').src = croppedUrl;
        if (currentUser) { currentUser.avatarUrl = croppedUrl; try { await update(userRef(currentUser.username), { avatarUrl: croppedUrl }); showToast('Profile picture updated ✓'); } catch { showToast('Saved locally — sync failed'); } }
      }
    };

    // ── AUTH ──
    window.togglePassVis = (inputId, iconEl) => {
      const inp = document.getElementById(inputId);
      if (inp.type === 'password') { inp.type = 'text'; iconEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`; }
      else { inp.type = 'password'; iconEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`; }
    };
    window.validateUsername = (input) => {
      const val = input.value, valid = /^[a-zA-Z0-9_]{3,20}$/.test(val);
      const e = document.getElementById('signupUsernameErr'), icon = document.getElementById('usernameCheckIcon');
      if (!val) { e.style.display = 'none'; icon.style.display = 'none'; input.classList.remove('err'); return; }
      if (!valid) { e.textContent = '3–20 chars, letters/numbers/underscore only'; e.style.display = 'block'; input.classList.add('err'); icon.style.display = 'none'; }
      else { e.style.display = 'none'; input.classList.remove('err'); icon.style.display = 'flex'; }
    };
    window.checkPwStrength = (input) => {
      const pw = input.value, fill = document.getElementById('pwStrengthFill');
      let s = 0; if (pw.length >= 6) s++; if (pw.length >= 10) s++; if (/[A-Z]/.test(pw)) s++; if (/[0-9]/.test(pw)) s++; if (/[^a-zA-Z0-9]/.test(pw)) s++;
      fill.style.width = (s / 5 * 100) + '%'; fill.style.background = ['#ff4444','#ff8800','#ffcc00','#99dd00','#1db954'][Math.min(s-1,4)] || 'transparent';
    };
    function showFieldErr(id, msg) { const e = document.getElementById(id); e.textContent = msg; e.style.display = 'block'; }
    function hideFieldErr(id) { document.getElementById(id).style.display = 'none'; }
    function setAuthLoading(type, loading) { document.getElementById(type+'Btn').disabled = loading; document.getElementById(type+'BtnText').style.display = loading?'none':'block'; document.getElementById(type+'Spinner').style.display = loading?'block':'none'; }
    function showAuthErr(msg) { const el = document.getElementById('authErr'); el.textContent = msg; el.style.display = 'block'; el.style.animation = 'none'; requestAnimationFrame(() => { el.style.animation = 'shake .35s ease'; }); }
    window.switchAuthTab = (tab) => {
      document.getElementById('loginTab').classList.toggle('active', tab==='login'); document.getElementById('signupTab').classList.toggle('active', tab==='signup');
      document.getElementById('loginForm').style.display = tab==='login'?'flex':'none'; document.getElementById('signupForm').style.display = tab==='signup'?'flex':'none';
      document.getElementById('authErr').style.display = 'none';
      ['loginUsernameErr','loginPassErr','signupUsernameErr','signupPhoneErr','signupPassErr','signupConfirmErr'].forEach(hideFieldErr);
    };
    window.doSignup = async () => {
      ['signupUsernameErr','signupPhoneErr','signupPassErr','signupConfirmErr'].forEach(hideFieldErr); document.getElementById('authErr').style.display = 'none';
      const username = document.getElementById('signupUsername').value.trim(); const phone = document.getElementById('signupPhone').value.trim();
      const pass = document.getElementById('signupPass').value; const confirm = document.getElementById('signupConfirm').value;
      let e = false;
      if (!username) { showFieldErr('signupUsernameErr','Username is required'); e=true; } else if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) { showFieldErr('signupUsernameErr','3–20 chars, letters/numbers/underscore only'); e=true; }
      if (!phone) { showFieldErr('signupPhoneErr','Mobile number is required'); e=true; } else if (!/^\d{7,15}$/.test(phone.replace(/[\s\-+]/g,''))) { showFieldErr('signupPhoneErr','Enter a valid mobile number'); e=true; }
      if (!pass) { showFieldErr('signupPassErr','Password is required'); e=true; } else if (pass.length < 6) { showFieldErr('signupPassErr','Password must be at least 6 characters'); e=true; }
      if (!confirm) { showFieldErr('signupConfirmErr','Please confirm your password'); e=true; } else if (pass !== confirm) { showFieldErr('signupConfirmErr','Passwords do not match'); e=true; }
      if (e) return;
      setAuthLoading('signup', true);
      try {
        const snap = await get(userRef(username)); if (snap.exists()) { showFieldErr('signupUsernameErr','Username already taken'); setAuthLoading('signup',false); return; }
        const passwordHash = await hashPassword(pass);
        const userData = { username, displayName: username, phone, passwordHash, avatarUrl: avatarDataUrl||'', liked:[], playlists:{}, createdAt:Date.now() };
        await set(userRef(username), userData); saveSession(username); await loginWithData(username, userData);
      } catch (ex) { showAuthErr('Sign up failed: '+(ex.message||'Try again')); setAuthLoading('signup',false); }
    };
    window.doLogin = async () => {
      ['loginUsernameErr','loginPassErr'].forEach(hideFieldErr); document.getElementById('authErr').style.display = 'none';
      const username = document.getElementById('loginUsername').value.trim(); const pass = document.getElementById('loginPass').value;
      if (!username) { showFieldErr('loginUsernameErr','Username is required'); return; }
      if (!pass) { showFieldErr('loginPassErr','Password is required'); return; }
      setAuthLoading('login', true);
      try {
        const snap = await get(userRef(username)); if (!snap.exists()) { showFieldErr('loginUsernameErr','Username not found'); setAuthLoading('login',false); return; }
        const data = snap.val(); const passwordHash = await hashPassword(pass);
        if (data.passwordHash !== passwordHash) { showFieldErr('loginPassErr','Incorrect password'); setAuthLoading('login',false); return; }
        saveSession(username); await loginWithData(username, data);
      } catch (ex) { showAuthErr('Login failed: '+(ex.message||'Try again')); setAuthLoading('login',false); }
    };
    async function loginWithData(username, data) {
      currentUser = { username, displayName: data.displayName||username, phone: data.phone||'', avatarUrl: data.avatarUrl||'' };
      likedSet = new Set(data.liked||[]); playlists = data.playlists||{};
      setAuthLoading('login',false); setAuthLoading('signup',false); loadStats();
      const authEl = document.getElementById('authScreen'); authEl.classList.remove('active', 'visible');
      resolveAuth('app'); applyUserUI(); initApp();
    }
    function applyUserUI() {
      const { username, displayName, phone, avatarUrl } = currentUser;
      const fallback = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}`;
      const src = avatarUrl || fallback;
      document.getElementById('topbarAvatar').src = src; document.getElementById('settingsAvatar').src = src;
      document.getElementById('settingsProfileName').textContent = displayName;
      document.getElementById('settingsProfileSub').textContent = phone ? ` ${phone}` : `@${username}`;
      document.getElementById('settingsUsername').textContent = username; document.getElementById('settingsPhone').textContent = phone || 'Not set';
      document.getElementById('likedCount').textContent = likedSet.size; document.getElementById('playlistCount').textContent = Object.keys(playlists).length;
      updateTotalPlaysUI();
    }
    window.doLogout = () => {
      if (currentTrackIdx >= 0 && sessionStarted[tracks[currentTrackIdx].id]) {
        const el = (Date.now() - sessionStarted[tracks[currentTrackIdx].id]) / 1000;
        recordListenTime(tracks[currentTrackIdx].id, el);
      }
      clearSleepTimer();
      audio.pause(); isPlaying = false; currentUser = null; likedSet.clear(); playlists = {}; queue = []; clearSession();
      document.documentElement.classList.remove('has-session');
      if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
      const appEl = document.getElementById('appScreen'); const authEl = document.getElementById('authScreen');
      appEl.classList.remove('active', 'visible'); authEl.classList.add('active');
      requestAnimationFrame(() => requestAnimationFrame(() => authEl.classList.add('visible')));
      document.getElementById('loginUsername').value = ''; document.getElementById('loginPass').value = ''; avatarDataUrl = '';
      document.getElementById('avatarPreviewImg').style.display = 'none'; document.getElementById('avatarPlaceholderSvg').style.display = 'block';
      switchAuthTab('login');
    };
    async function saveUserData() {
      if (!currentUser) return;
      try { await update(userRef(currentUser.username), { liked: [...likedSet], playlists }); } catch (e) {}
      document.getElementById('likedCount').textContent = likedSet.size;
      document.getElementById('playlistCount').textContent = Object.keys(playlists).length;
    }

    function initApp() {
      renderLibContent(); filterTracks('all', null); renderQueueState();
      document.getElementById('plPlayBtn').onclick = () => { if (currentPlaylistId) playPlaylist(currentPlaylistId); else if (plDetailIsLiked) playLikedSongs(); };
      document.getElementById('plAddSongsBtn').onclick = () => { if (currentPlaylistId && !plDetailIsLiked) openAddSongsModal(currentPlaylistId); };
      document.getElementById('plDeleteBtn').onclick = () => { if (currentPlaylistId && !plDetailIsLiked) confirmDeletePlaylist(currentPlaylistId); };
      const progInput = document.getElementById('npProgInput');
      if (progInput) progInput.addEventListener('input', () => seekFromInput(progInput.value));
      const volInput = document.getElementById('npVolInput');
      if (volInput) { volInput.value = volume * 100; syncVolSliderTrack(volume * 100); volInput.addEventListener('input', () => setVolumeFromInput(volInput.value)); }
      checkDeepLink();
    }

    window.goTab = (tab) => {
      'home search library settings'.split(' ').forEach(t => {
        document.getElementById('tab-' + t).classList.toggle('active', t === tab);
        document.getElementById(t + 'Page').classList.toggle('active', t === tab);
      });
      if (tab === 'search') setTimeout(() => document.getElementById('searchInput').focus(), 200);
      if (tab === 'library') renderLibContent();
      if (tab === 'settings') applyUserUI();
    };

    function getGradient(id) { const h = (id * 37) % 360; return `linear-gradient(135deg,hsl(${h},40%,18%),hsl(${(h+40)%360},50%,10%))`; }
    function thumbHtml(track) {
      if (track.cover) return `<img src="${track.cover}" alt="" onerror="this.style.display='none'">`;
      return `<div style="width:100%;height:100%;background:${getGradient(track.id)};display:flex;align-items:center;justify-content:center;font-size:18px">${['♪','♫','♬','♩'][track.id%4]}</div>`;
    }
    function eqHtml() { return `<div class="eq-bars"><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div></div>`; }

    function calcTotalDuration(trackList) {
      let total = 0;
      trackList.forEach(t => { if (durations[t.id]) total += durations[t.id]; });
      return total;
    }
    function fmtTotalDuration(secs) {
      if (!secs || secs < 1) return null;
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      if (h > 0) return `${h}h ${m}m`;
      if (m > 0) return `${m}m ${s}s`;
      return `${s}s`;
    }
    function updatePlDetailDuration(trackList) {
      const el = document.getElementById('plDetailDuration');
      const txt = document.getElementById('plDetailDurationText');
      const total = calcTotalDuration(trackList);
      const label = fmtTotalDuration(total);
      if (label) { txt.textContent = label; el.style.display = 'inline-flex'; }
      else { el.style.display = 'none'; }
    }

    // GESTURE / DOUBLE-TAP (no heart animation)
    function attachGestures(cardEl, globalIdx) {
      let lpTimer = null, dtTimer = null, tapCount = 0, isLongPress = false, isDragging = false, dragTimer = null;
      let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
      const LONG_PRESS_MS = 550, DRAG_HOLD_MS = 1000, SWIPE_MIN_PX = 55, SWIPE_MAX_Y = 60, DOUBLE_TAP_MS = 280;

      cardEl.addEventListener('touchstart', (e) => {
        if (e.target.closest('.grid-card-more')) return;
        const touch = e.touches[0];
        touchStartX = touch.clientX; touchStartY = touch.clientY; touchStartTime = Date.now();
        isLongPress = false; isDragging = false;
        lpTimer = setTimeout(() => { isLongPress = true; clearTimeout(dragTimer); cancelTap(); if (navigator.vibrate) navigator.vibrate(15); openLpModal(globalIdx); }, LONG_PRESS_MS);
        dragTimer = setTimeout(() => { if (isLongPress) return; isDragging = true; clearTimeout(lpTimer); if (navigator.vibrate) navigator.vibrate([12, 40, 12]); startDragMode(cardEl, globalIdx, touch.clientX, touch.clientY); }, DRAG_HOLD_MS);
      }, { passive: true });

      cardEl.addEventListener('touchmove', (e) => {
        const touch = e.touches[0];
        const dx = touch.clientX - touchStartX, dy = touch.clientY - touchStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 10) { clearTimeout(lpTimer); if (!isDragging) clearTimeout(dragTimer); }
        if (isDragging) { e.preventDefault(); moveDragGhost(touch.clientX, touch.clientY); checkDropZone(touch.clientX, touch.clientY); }
        else {
          const absX = Math.abs(dx), absY = Math.abs(dy);
          if (absX > 15 && absX > absY) {
            const ind = cardEl.querySelector('.swipe-indicator');
            if (ind) { if (dx > 0) { ind.className = 'swipe-indicator right visible'; ind.innerHTML = '▶ Play Next'; } else { ind.className = 'swipe-indicator left visible'; ind.innerHTML = 'Add to Queue ✚'; } }
          }
        }
      }, { passive: false });

      cardEl.addEventListener('touchend', (e) => {
        clearTimeout(lpTimer); clearTimeout(dragTimer);
        const ind = cardEl.querySelector('.swipe-indicator'); if (ind) ind.className = 'swipe-indicator';
        if (isDragging) { isDragging = false; const touch = e.changedTouches[0]; finishDrag(globalIdx, touch.clientX, touch.clientY); return; }
        if (isLongPress) { isLongPress = false; return; }
        const dx = e.changedTouches[0].clientX - touchStartX, dy = e.changedTouches[0].clientY - touchStartY;
        const absX = Math.abs(dx), absY = Math.abs(dy), elapsed = Date.now() - touchStartTime;
        if (absX >= SWIPE_MIN_PX && absY < SWIPE_MAX_Y && elapsed < 450) { if (dx > 0) swipePlayNext(globalIdx); else swipeAddToQueue(globalIdx); return; }
        tapCount++;
        if (tapCount === 1) { dtTimer = setTimeout(() => { tapCount = 0; }, DOUBLE_TAP_MS); }
        else if (tapCount >= 2) { clearTimeout(dtTimer); tapCount = 0; doubleTapLike(globalIdx, cardEl, e.changedTouches[0]); }
      }, { passive: true });

      cardEl.addEventListener('touchcancel', () => {
        clearTimeout(lpTimer); clearTimeout(dragTimer);
        const ind = cardEl.querySelector('.swipe-indicator'); if (ind) ind.className = 'swipe-indicator';
        if (isDragging) { isDragging = false; endDragMode(); }
      }, { passive: true });

      function cancelTap() { clearTimeout(dtTimer); tapCount = 0; }
    }

    // DOUBLE TAP LIKE (without floating heart)
    function doubleTapLike(idx, cardEl, touch) {
      const t = tracks[idx]; const wasLiked = likedSet.has(t.id);
      if (!wasLiked) { likedSet.add(t.id); showToast('Added to Liked Songs ❤️'); }
      else { likedSet.delete(t.id); showToast('Removed from Liked Songs 💔'); }
      if (idx === currentTrackIdx) updateLikeBtns();
      saveUserData(); if (currentFilter === 'liked') filterTracks('liked', null);
      const ripple = document.createElement('div'); ripple.className = 'dt-ripple'; cardEl.appendChild(ripple); ripple.addEventListener('animationend', () => ripple.remove());
      // no floating heart
    }

    // DRAG & DROP
    const dragGhost = document.getElementById('dragGhost'), dropZone = document.getElementById('queueDropZone');
    let isDragActive = false, dragSourceCard = null, dropZoneRect = null;
    function startDragMode(cardEl, idx, clientX, clientY) {
      const t = tracks[idx]; isDragActive = true; dragSourceCard = cardEl; cardEl.classList.add('drag-source');
      document.getElementById('dragGhostImg').src = t.cover || ''; document.getElementById('dragGhostName').textContent = t.name; document.getElementById('dragGhostArtist').textContent = t.artist;
      moveDragGhost(clientX, clientY); requestAnimationFrame(() => dragGhost.classList.add('visible'));
      dropZone.classList.add('visible'); dropZoneRect = null; setTimeout(() => { dropZoneRect = dropZone.getBoundingClientRect(); }, 80);
      showToast('Drag to the queue zone below 🎵');
    }
    function moveDragGhost(clientX, clientY) { dragGhost.style.left = (clientX - 80) + 'px'; dragGhost.style.top = (clientY - 40) + 'px'; if (!dropZoneRect) dropZoneRect = dropZone.getBoundingClientRect(); }
    function checkDropZone(clientX, clientY) {
      if (!dropZoneRect) return;
      const pad = 24;
      const inside = clientX >= dropZoneRect.left - pad && clientX <= dropZoneRect.right + pad && clientY >= dropZoneRect.top - pad && clientY <= dropZoneRect.bottom + pad;
      dropZone.classList.toggle('hover', inside);
    }
    function finishDrag(idx, clientX, clientY) {
      endDragMode(); if (!dropZoneRect) dropZoneRect = dropZone.getBoundingClientRect();
      const pad = 36;
      const dropped = clientX >= dropZoneRect.left - pad && clientX <= dropZoneRect.right + pad && clientY >= dropZoneRect.top - pad && clientY <= dropZoneRect.bottom + pad;
      if (dropped) { queue.push(idx); renderQueueState(); dropZone.classList.add('success'); setTimeout(() => dropZone.classList.remove('success'), 600); showToast(`Added to Queue 🎵`); }
    }
    function endDragMode() { isDragActive = false; dragGhost.classList.remove('visible'); dropZone.classList.remove('visible', 'hover'); if (dragSourceCard) { dragSourceCard.classList.remove('drag-source'); dragSourceCard = null; } }

    function swipePlayNext(idx) { queue.unshift(idx); renderQueueState(); showSwipeFeedback('▶ Playing next', 'right-feedback'); }
    function swipeAddToQueue(idx) { queue.push(idx); renderQueueState(); showSwipeFeedback('✚ Added to Queue', 'left-feedback'); }
    let swipeFeedbackTimer = null;
    function showSwipeFeedback(msg, cls) {
      const el = document.getElementById('swipeFeedback'); el.textContent = msg; el.className = `swipe-feedback ${cls} show`;
      clearTimeout(swipeFeedbackTimer); swipeFeedbackTimer = setTimeout(() => { el.classList.remove('show'); }, 1500);
      showToast(msg);
    }

    // GRID / SEARCH RENDERING
    function renderGridCard(track, globalIdx, container) {
      const isActive = globalIdx === currentTrackIdx;
      const card = document.createElement('div'); card.className = 'grid-card' + (isActive ? ' active' : ''); card.dataset.idx = globalIdx;
      const artHtml = track.cover
        ? `<img src="${track.cover}" alt="" onerror="this.parentElement.innerHTML='<div class=grid-card-art-placeholder>${['♪','♫','♬','♩'][track.id%4]}</div>'">`
        : `<div class="grid-card-art-placeholder" style="background:${getGradient(track.id)}">${['♪','♫','♬','♩'][track.id%4]}</div>`;
      card.innerHTML = `
        <div class="grid-card-art">${artHtml}
          <div class="grid-card-playing-badge">${eqHtml()}</div>
          <div class="swipe-indicator right"></div>
          <div class="swipe-indicator left"></div>
        </div>
        <div class="grid-card-info">
          <div class="grid-card-name">${track.name}</div>
          <div class="grid-card-artist">${track.artist}</div>
        </div>
        <button class="grid-card-more" onclick="openCtxSheet(event,${globalIdx})" title="More options">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
        </button>`;
      card.addEventListener('click', e => { if (e.target.closest('.grid-card-more')) return; playTrack(globalIdx); });
      attachGestures(card, globalIdx);
      container.appendChild(card);
    }

    function renderGrid(list) {
      const grid = document.getElementById('trackGrid'); grid.innerHTML = '';
      const countEl = document.getElementById('sectionCount'); if (countEl) countEl.textContent = list.length + ' songs';
      list.forEach(t => renderGridCard(t, tracks.indexOf(t), grid));
    }

    function renderTrackRow(track, idx, globalIdx, container, opts = {}) {
      const isActive = globalIdx === currentTrackIdx;
      const dur = durations[track.id] ? fmtTime(durations[track.id]) : '—';
      const row = document.createElement('div'); row.className = 'track-item' + (isActive ? ' active' : '');
      const removeBtn = opts.onRemove
        ? `<button class="track-remove-pl-btn" title="Remove from playlist"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`
        : '';
      row.innerHTML = `<div class="track-num">${isActive && isPlaying ? eqHtml() : `<span style="color:var(--txt3)">${idx+1}</span>`}</div>
        <div class="track-item-art">${thumbHtml(track)}</div>
        <div class="track-item-info"><div class="track-item-name">${track.name}</div><div class="track-item-artist">${track.artist}</div></div>
        <div class="track-item-right">
          <span class="track-item-dur">${dur}</span>
          ${removeBtn}
          <button class="track-more-btn" onclick="openCtxSheet(event,${globalIdx})">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
        </div>`;
      row.addEventListener('click', e => { if (e.target.closest('.track-more-btn') || e.target.closest('.track-remove-pl-btn')) return; playTrack(globalIdx); });
      if (opts.onRemove) {
        const btn = row.querySelector('.track-remove-pl-btn');
        btn.addEventListener('click', e => { e.stopPropagation(); opts.onRemove(track.id); });
      }
      container.appendChild(row);
    }

    // PLAYBACK ENGINE
    window.playTrack = function(globalIdx) {
      if (currentTrackIdx >= 0 && sessionStarted[tracks[currentTrackIdx].id]) {
        const el = (Date.now() - sessionStarted[tracks[currentTrackIdx].id]) / 1000;
        recordListenTime(tracks[currentTrackIdx].id, el);
      }
      currentTrackIdx = globalIdx;
      const track = tracks[globalIdx];
      audio.src = track.url; audio.load(); audio.volume = isMuted ? 0 : volume;
      audio.play().then(() => {
        isPlaying = true; recordPlay(track.id); updateAllUI(); renderGrid(filteredTracks);
        updateMediaSession(track); updateMediaSessionPlaybackState('playing');
      }).catch(() => showToast('Could not load track'));
    };

    function updateAllUI() {
      if (currentTrackIdx < 0) return;
      const t = tracks[currentTrackIdx];
      document.getElementById('miniName').textContent   = t.name;
      document.getElementById('miniArtist').textContent = t.artist;
      if (t.cover) { document.getElementById('miniArtImg').src = t.cover; document.getElementById('miniArtImg').style.display = 'block'; document.getElementById('miniArtPlaceholder').style.display = 'none'; }
      else { document.getElementById('miniArtImg').style.display = 'none'; document.getElementById('miniArtPlaceholder').style.display = 'block'; }
      document.getElementById('npCardTitle').textContent = t.name;
      document.getElementById('npCardSub').textContent   = `${t.artist} · ${t.album}`;
      if (t.cover) { document.getElementById('npCardArtImg').src = t.cover; document.getElementById('npCardArtImg').style.display = 'block'; document.getElementById('npCardArtPlaceholder').style.display = 'none'; }
      else { document.getElementById('npCardArtImg').style.display = 'none'; document.getElementById('npCardArtPlaceholder').style.display = 'block'; }
      document.getElementById('npName').textContent   = t.name;
      document.getElementById('npArtist').textContent = t.artist;
      if (t.cover) { document.getElementById('npArtImg').src = t.cover; document.getElementById('npArtImg').style.display = 'block'; document.getElementById('npArtPlaceholder').style.display = 'none'; document.getElementById('npBg').style.backgroundImage = `url(${t.cover})`; }
      else { document.getElementById('npArtImg').style.display = 'none'; document.getElementById('npArtPlaceholder').style.display = 'flex'; document.getElementById('npArtPlaceholder').textContent = ['♪','♫','♬','♩'][t.id%4]; document.getElementById('npBg').style.backgroundImage = ''; }
      updatePlayIcons(isPlaying); updateLikeBtns();
    }

    window.openNowPlaying  = () => { updateAllUI(); document.getElementById('nowplayingOverlay').classList.add('open'); };
    window.closeNowPlaying = () => document.getElementById('nowplayingOverlay').classList.remove('open');
    window.openQueuePanel  = () => { renderQueuePanel(); document.getElementById('queuePanelOverlay').classList.add('open'); };
    window.closeQueuePanel = () => document.getElementById('queuePanelOverlay').classList.remove('open');
    function renderQueuePanel() {
      const body = document.getElementById('queuePanelBody'); body.innerHTML = '';
      if (currentTrackIdx >= 0) {
        const t = tracks[currentTrackIdx];
        const ns = document.createElement('div');
        ns.innerHTML = `<div class="queue-now-playing"><div class="queue-now-label">Now Playing</div><div class="queue-now-track"><div class="queue-now-art">${thumbHtml(t)}</div><div><div class="queue-now-name">${t.name}</div><div class="queue-now-artist">${t.artist}</div></div></div></div>`;
        body.appendChild(ns);
      }
      const us = document.createElement('div');
      if (queue.length === 0) {
        us.innerHTML = `<div class="queue-up-next"><div class="queue-up-label">Up Next</div></div><div class="queue-empty"><div class="queue-empty-icon">🎵</div><div>Queue is empty</div><div style="font-size:11px;margin-top:4px;color:var(--txt3)">Long-press or swipe any song to add</div></div>`;
      } else {
        us.innerHTML = `<div class="queue-up-next"><div class="queue-up-label">Up Next — ${queue.length} song${queue.length!==1?'s':''}</div></div>`;
        queue.forEach((trackIdx, i) => {
          const t = tracks[trackIdx]; if (!t) return;
          const row = document.createElement('div'); row.className = 'queue-track-item';
          row.innerHTML = `<div class="queue-track-art">${thumbHtml(t)}</div><div class="queue-track-info"><div class="queue-track-name">${t.name}</div><div class="queue-track-artist">${t.artist}</div></div><button class="queue-track-remove" onclick="removeFromQueue(${i})" title="Remove">✕</button>`;
          row.addEventListener('click', e => { if (e.target.closest('.queue-track-remove')) return; queue.splice(0, i); const next = queue.shift(); renderQueueState(); playTrack(next); closeQueuePanel(); });
          us.appendChild(row);
        });
        const cb = document.createElement('button'); cb.className = 'queue-clear-btn';
        cb.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Clear Queue`;
        cb.onclick = () => { queue = []; renderQueueState(); renderQueuePanel(); showToast('Queue cleared'); };
        us.appendChild(cb);
      }
      body.appendChild(us);
    }
    window.removeFromQueue = (i) => { queue.splice(i,1); renderQueueState(); renderQueuePanel(); showToast('Removed from queue'); };
    function renderQueueState() {
      const btn = document.getElementById('miniQueueBtn');
      if (btn) { btn.classList.toggle('has-queue', queue.length>0); btn.title = queue.length>0?`Queue (${queue.length})`:'Queue (empty)'; }
      const badge = document.getElementById('queueCountBadge'); if (badge) badge.textContent = queue.length;
    }
    function updatePlayIcons(play) {
      const pauseSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
      const playSvg  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M8 5v14l11-7z"/></svg>`;
      document.getElementById('miniPlayBtn').innerHTML = play ? pauseSvg : playSvg;
      document.getElementById('npMainPlayBtn').innerHTML = play
        ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
        : `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      document.querySelector('.np-play-fab').innerHTML = play
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M8 5v14l11-7z"/></svg>`;
      document.querySelectorAll('.grid-card.active .eq-bars').forEach(el => el.classList.toggle('paused', !play));
    }
    function updateLikeBtns() {
      if (currentTrackIdx < 0) return;
      const liked = likedSet.has(tracks[currentTrackIdx].id);
      const f = liked ? 'var(--accent)' : 'none', s = liked ? 'var(--accent)' : 'currentColor';
      const heart = (sz) => `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="${f}" stroke="${s}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
      document.getElementById('npCardLikeBtn').innerHTML = heart(16); document.getElementById('npCardLikeBtn').classList.toggle('liked', liked);
      document.getElementById('npLikeBtn').innerHTML = heart(24); document.getElementById('npLikeBtn').classList.toggle('liked', liked);
    }
    window.togglePlay = () => {
      if (currentTrackIdx < 0 && tracks.length) { playTrack(0); return; }
      if (isPlaying) {
        audio.pause(); isPlaying = false; updatePlayIcons(false); updateMediaSessionPlaybackState('paused');
        if (currentTrackIdx >= 0 && sessionStarted[tracks[currentTrackIdx].id]) {
          const el = (Date.now() - sessionStarted[tracks[currentTrackIdx].id]) / 1000;
          recordListenTime(tracks[currentTrackIdx].id, el); delete sessionStarted[tracks[currentTrackIdx].id];
        }
      } else {
        audio.play(); isPlaying = true; updatePlayIcons(true); updateMediaSessionPlaybackState('playing');
        if (currentTrackIdx >= 0) sessionStarted[tracks[currentTrackIdx].id] = Date.now();
      }
    };
    window.nextTrack = () => {
      if (!tracks.length) return;
      if (queue.length > 0) { const next = queue.shift(); renderQueueState(); playTrack(next); return; }
      playTrack(isShuffle ? Math.floor(Math.random()*tracks.length) : (currentTrackIdx+1)%tracks.length);
    };
    window.prevTrack = () => {
      if (audio.currentTime > 3) { audio.currentTime = 0; return; }
      playTrack((currentTrackIdx-1+tracks.length)%tracks.length);
    };
    window.toggleShuffle = () => { isShuffle = !isShuffle; document.getElementById('npShuffleBtn').classList.toggle('active',isShuffle); showToast(isShuffle?'Shuffle on':'Shuffle off'); };
    window.toggleRepeat  = () => { isRepeat = !isRepeat; audio.loop = isRepeat; document.getElementById('npRepeatBtn').classList.toggle('active',isRepeat); showToast(isRepeat?'Repeat on':'Repeat off'); };
    window.toggleLike = () => {
      if (currentTrackIdx < 0) return;
      const t = tracks[currentTrackIdx];
      if (likedSet.has(t.id)) { likedSet.delete(t.id); showToast('Removed from Liked Songs'); }
      else { likedSet.add(t.id); showToast('Added to Liked Songs ♥'); }
      updateLikeBtns(); saveUserData(); if (currentFilter === 'liked') filterTracks('liked', null);
    };
    window.seekFromInput = (value) => {
      if (!audio.duration) return;
      audio.currentTime = (value/100)*audio.duration;
      document.getElementById('npProgFill').style.width = value + '%';
      syncMediaSessionPosition();
    };
    document.getElementById('npProgBar').addEventListener('click', e => {
      if (e.target.id === 'npProgInput') return;
      const pct = Math.max(0, Math.min(1, (e.clientX - e.currentTarget.getBoundingClientRect().left)/e.currentTarget.offsetWidth));
      if (audio.duration) { audio.currentTime = pct * audio.duration; syncMediaSessionPosition(); }
    });
    function syncVolSliderTrack(value) { const el = document.getElementById('npVolInput'); if (el) el.style.setProperty('--vol-pct', value+'%'); }
    window.setVolumeFromInput = (value) => { volume = value/100; if (!isMuted) audio.volume = volume; syncVolSliderTrack(value); };
    window.toggleMute = () => {
      isMuted = !isMuted; audio.volume = isMuted ? 0 : volume;
      const muteBtn = document.getElementById('npMuteBtn'); if (!muteBtn) return;
      if (isMuted) { muteBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`; muteBtn.style.opacity='1'; }
      else { muteBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg>`; muteBtn.style.opacity='0.6'; }
    };
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration) return;
      const pct = (audio.currentTime/audio.duration)*100;
      document.getElementById('miniProgFill').style.width = pct+'%';
      document.getElementById('npProgFill').style.width   = pct+'%';
      const progInput = document.getElementById('npProgInput');
      if (progInput && !progInput.matches(':active')) progInput.value = pct;
      document.getElementById('npCurTime').textContent = fmtTime(audio.currentTime);
      if (Math.floor(audio.currentTime) % 1 === 0) syncMediaSessionPosition();
    });
    audio.addEventListener('loadedmetadata', () => {
      document.getElementById('npTotTime').textContent = fmtTime(audio.duration);
      if (currentTrackIdx >= 0) {
        durations[tracks[currentTrackIdx].id] = audio.duration;
        if (document.getElementById('plDetailOverlay').classList.contains('open')) {
          if (plDetailIsLiked) { updatePlDetailDuration(tracks.filter(t => likedSet.has(t.id))); }
          else if (currentPlaylistId && playlists[currentPlaylistId]) {
            updatePlDetailDuration((playlists[currentPlaylistId].songIds||[]).map(sid => tracks.find(t => t.id === sid)).filter(Boolean));
          }
        }
      }
      const progInput = document.getElementById('npProgInput'); if (progInput) progInput.value = 0;
      syncMediaSessionPosition();
    });
    audio.addEventListener('ended', () => { if (!isRepeat) nextTrack(); });
    audio.addEventListener('play',  () => updateMediaSessionPlaybackState('playing'));
    audio.addEventListener('pause', () => updateMediaSessionPlaybackState('paused'));
    function fmtTime(s) { if (!s||isNaN(s)) return '0:00'; return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`; }
    function fmtTimeVerbose(secs) { if (!secs||secs<60) return `${Math.round(secs||0)}s`; const h=Math.floor(secs/3600),m=Math.floor((secs%3600)/60); if(h>0) return `${h}h ${m}m`; return `${m}m`; }

    window.doSearch = (q) => {
      const query = q.trim().toLowerCase();
      const empty = document.getElementById('searchEmpty'), results = document.getElementById('searchResults');
      if (!query) { empty.style.display='flex'; results.innerHTML=''; return; }
      empty.style.display='none'; results.innerHTML='';
      const found = tracks.filter(t => t.name.toLowerCase().includes(query)||t.artist.toLowerCase().includes(query)||t.album.toLowerCase().includes(query));
      if (!found.length) { results.innerHTML=`<div style="padding:24px;text-align:center;color:var(--txt3);font-size:14px">No results for "${q}"</div>`; return; }
      found.forEach((t,i) => renderTrackRow(t,i,tracks.indexOf(t),results));
    };
    window.filterTracks = (type, el) => {
      if (el) { document.querySelectorAll('#homeFilter .filter-chip').forEach(b => b.classList.remove('active')); el.classList.add('active'); }
      currentFilter = type;
      if (type==='all') filteredTracks = [...tracks];
      else if (type==='love') filteredTracks = tracks.filter(t => t.category==='love');
      else if (type==='sad') filteredTracks = tracks.filter(t => t.category==='sad');
      else if (type==='motivation') filteredTracks = tracks.filter(t => t.category==='motivation');
      else if (type==='emotion') filteredTracks = tracks.filter(t => t.category==='emotion');
      else if (type==='liked') filteredTracks = tracks.filter(t => likedSet.has(t.id));
      const titles = { all:'All Tracks', love:'Love Songs', sad:'Sad Songs', motivation:'Motivation', emotion:'Emotion', liked:'Liked Songs' };
      document.getElementById('sectionLabel').textContent = titles[type]||'All Tracks';
      renderGrid(filteredTracks);
    };
    window.openCtxSheet = (e, idx) => {
      e.stopPropagation(); ctxTrackIdx = idx;
      const t = tracks[idx];
      document.getElementById('ctxTrackName').textContent   = t.name;
      document.getElementById('ctxTrackArtist').textContent = t.artist;
      document.getElementById('ctxTrackArt').src = t.cover||'';
      document.getElementById('ctxLikeLabel').textContent = likedSet.has(t.id)?'Unlike Song':'Like Song';
      document.getElementById('ctxSheet').classList.add('open');
    };
    window.closeCtxSheet = () => document.getElementById('ctxSheet').classList.remove('open');
    window.ctxAddToQueue = () => { if (ctxTrackIdx<0) return; queue.push(ctxTrackIdx); renderQueueState(); showToast(`"${tracks[ctxTrackIdx].name}" added to queue`); };
    window.ctxLike = () => {
      const t = tracks[ctxTrackIdx];
      if (likedSet.has(t.id)) { likedSet.delete(t.id); showToast('Removed from Liked Songs'); }
      else { likedSet.add(t.id); showToast('Added to Liked Songs ♥'); }
      if (ctxTrackIdx===currentTrackIdx) updateLikeBtns();
      saveUserData(); if (currentFilter==='liked') filterTracks('liked',null);
    };
    window.ctxPlayNext = () => { if (ctxTrackIdx<0) return; queue.unshift(ctxTrackIdx); renderQueueState(); showToast('Playing next'); };
    window.ctxAddToPlaylist = () => {
      const ids = Object.keys(playlists);
      if (!ids.length) { showToast('No playlists yet — create one in Library'); closeCtxSheet(); return; }
      const list = document.getElementById('plSubmenuList'); list.innerHTML = '';
      ids.forEach(id => {
        const item = document.createElement('div'); item.className='ctx-item'; item.textContent=playlists[id].name;
        item.onclick = () => {
          const pl = playlists[id]; if (!pl.songIds) pl.songIds=[];
          if (!pl.songIds.includes(tracks[ctxTrackIdx].id)) { pl.songIds.push(tracks[ctxTrackIdx].id); saveUserData(); showToast(`Added to "${pl.name}"`); }
          else showToast('Already in playlist');
          document.getElementById('plSubmenuOverlay').classList.remove('open'); closeCtxSheet();
        };
        list.appendChild(item);
      });
      document.getElementById('plSubmenuOverlay').classList.add('open');
    };
    window.switchLibTab = (tab, el) => { currentLibTab=tab; document.querySelectorAll('.lib-tab').forEach(t=>t.classList.remove('active')); if(el) el.classList.add('active'); renderLibContent(); };
    function renderLibContent() {
      const c = document.getElementById('libContent'); c.innerHTML='';
      if (currentLibTab==='playlists') {
        const lc = document.createElement('div'); lc.className='pl-card';
        lc.innerHTML=`<div class="pl-card-art liked-card-art"><svg viewBox="0 0 24 24" width="28" height="28" fill="white" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div><div class="pl-card-info"><div class="pl-card-name">Liked Songs</div><div class="pl-card-sub">${likedSet.size} songs</div></div>`;
        lc.onclick = () => openLikedSongsDetail();
        c.appendChild(lc);
        Object.entries(playlists).forEach(([id,pl]) => {
          const songs=(pl.songIds||[]).length;
          const card=document.createElement('div'); card.className='pl-card';
          card.innerHTML=`<div class="pl-card-art">${pl.cover?`<img src="${pl.cover}" alt="">`:`<div style="width:100%;height:100%;background:${getGradient(id.length)};display:flex;align-items:center;justify-content:center;font-size:22px">🎵</div>`}</div><div class="pl-card-info"><div class="pl-card-name">${pl.name}</div><div class="pl-card-sub">${songs} song${songs!==1?'s':''}</div></div><button class="pl-card-more" onclick="event.stopPropagation()"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button>`;
          card.addEventListener('click', e => { if(e.target.closest('.pl-card-more')) return; openPlDetail(id); });
          c.appendChild(card);
        });
      } else {
        const liked=tracks.filter(t=>likedSet.has(t.id));
        if (!liked.length) { c.innerHTML='<div style="padding:40px;text-align:center;color:var(--txt3);font-size:14px">No liked songs yet — double-tap any song to like it!</div>'; return; }
        const tl=document.createElement('div'); tl.className='track-list';
        liked.forEach((t,i)=>renderTrackRow(t,i,tracks.indexOf(t),tl));
        c.appendChild(tl);
      }
    }
    function openLikedSongsDetail() {
      plDetailIsLiked = true; currentPlaylistId = null;
      const liked = tracks.filter(t => likedSet.has(t.id));
      document.getElementById('plDetailTopName').textContent = 'Liked Songs';
      document.getElementById('plDetailName').textContent = 'Liked Songs';
      document.getElementById('plDetailSub').textContent = `${liked.length} song${liked.length !== 1 ? 's' : ''}`;
      document.getElementById('plDetailArt').style.display = 'none';
      updatePlDetailDuration(liked);
      document.getElementById('plAddSongsBtn').style.display = 'none';
      document.getElementById('plDeleteBtn').style.display = 'none';
      const c = document.getElementById('plDetailTrackList'); c.innerHTML = '';
      liked.forEach((t, i) => renderTrackRow(t, i, tracks.indexOf(t), c));
      document.getElementById('plDetailOverlay').classList.add('open');
    }
    function playLikedSongs() {
      const liked = tracks.filter(t => likedSet.has(t.id));
      if (!liked.length) { showToast('No liked songs yet'); return; }
      playTrack(tracks.indexOf(liked[0]));
      queue = liked.slice(1).map(t => tracks.indexOf(t));
      renderQueueState(); closePlDetail();
    }
    window.openPlDetail = (id) => {
      plDetailIsLiked = false; currentPlaylistId = id;
      const pl = playlists[id]; if (!pl) return;
      document.getElementById('plDetailTopName').textContent = pl.name;
      document.getElementById('plDetailName').textContent = pl.name;
      const songs = (pl.songIds||[]).map(sid=>tracks.find(t=>t.id===sid)).filter(Boolean);
      document.getElementById('plDetailSub').textContent = `${songs.length} song${songs.length!==1?'s':''}`;
      document.getElementById('plDetailArt').src = pl.cover || `https://api.dicebear.com/7.x/shapes/svg?seed=${pl.name}`;
      document.getElementById('plDetailArt').style.display = 'block';
      document.getElementById('plAddSongsBtn').style.display = '';
      document.getElementById('plDeleteBtn').style.display = '';
      updatePlDetailDuration(songs);
      const c = document.getElementById('plDetailTrackList'); c.innerHTML = '';
      songs.forEach((t, i) => renderTrackRow(t, i, tracks.indexOf(t), c, { onRemove: (songId) => removeSongFromPlaylist(id, songId) }));
      document.getElementById('plDetailOverlay').classList.add('open');
    };
    function removeSongFromPlaylist(plId, songId) {
      const pl = playlists[plId]; if (!pl || !pl.songIds) return;
      pl.songIds = pl.songIds.filter(id => id !== songId);
      saveUserData();
      showToast('Song removed from playlist');
      const songs = (pl.songIds||[]).map(sid => tracks.find(t => t.id === sid)).filter(Boolean);
      document.getElementById('plDetailSub').textContent = `${songs.length} song${songs.length!==1?'s':''}`;
      updatePlDetailDuration(songs);
      const c = document.getElementById('plDetailTrackList'); c.innerHTML = '';
      songs.forEach((t, i) => renderTrackRow(t, i, tracks.indexOf(t), c, { onRemove: (sid) => removeSongFromPlaylist(plId, sid) }));
    }
    window.confirmDeletePlaylist = (id) => {
      const pl = playlists[id]; if (!pl) return;
      document.getElementById('deleteConfirmTitle').textContent = `Delete "${pl.name}"?`;
      document.getElementById('deleteConfirmSub').textContent   = 'This playlist will be permanently deleted. Songs will not be affected.';
      document.getElementById('deleteConfirmModal').classList.add('open');
      document.getElementById('deleteConfirmOk').onclick = () => {
        delete playlists[id];
        saveUserData();
        closeDeleteConfirm();
        closePlDetail();
        renderLibContent();
        showToast(`"${pl.name}" deleted`);
      };
    };
    window.closeDeleteConfirm = () => document.getElementById('deleteConfirmModal').classList.remove('open');
    window.closePlDetail = () => document.getElementById('plDetailOverlay').classList.remove('open');
    window.openNewPlaylistModal = () => {
      document.getElementById('newPlName').value = '';
      document.getElementById('plArtPreview').style.display = 'none';
      document.getElementById('plArtPlaceholder').style.display = 'block';
      plArtDataUrl = '';
      openModal('newPlaylistModal');
    };
    window.previewPlArt = (input) => {
      const file = input.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        plArtDataUrl = e.target.result;
        document.getElementById('plArtPreview').src = plArtDataUrl;
        document.getElementById('plArtPreview').style.display = 'block';
        document.getElementById('plArtPlaceholder').style.display = 'none';
      };
      reader.readAsDataURL(file);
    };
    window.createPlaylist = () => {
      const name = document.getElementById('newPlName').value.trim();
      if (!name) { showToast('Please enter a playlist name'); return; }
      const id = 'pl_' + Date.now();
      playlists[id] = { name, cover: plArtDataUrl || '', songIds: [], createdAt: Date.now() };
      saveUserData(); closeModal('newPlaylistModal'); renderLibContent();
      showToast(`Playlist "${name}" created`);
    };
    window.openAddSongsModal = (plId) => {
      addSongModalPlaylistId = plId;
      addSongModalSelected = new Set(playlists[plId]?.songIds || []);
      renderAddSongsList(tracks);
      openModal('addSongsModal');
    };
    function renderAddSongsList(list) {
      const c = document.getElementById('addSongsList'); c.innerHTML = '';
      list.forEach(t => {
        const row = document.createElement('div'); row.className = 'modal-song-row';
        const checked = addSongModalSelected.has(t.id);
        row.innerHTML = `<div class="modal-song-check${checked?' checked':''}"></div>
          <div class="modal-song-thumb">${thumbHtml(t)}</div>
          <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.name}</div><div style="font-size:11px;color:var(--txt3)">${t.artist}</div></div>`;
        row.addEventListener('click', () => {
          if (addSongModalSelected.has(t.id)) { addSongModalSelected.delete(t.id); row.querySelector('.modal-song-check').classList.remove('checked'); }
          else { addSongModalSelected.add(t.id); row.querySelector('.modal-song-check').classList.add('checked'); }
        });
        c.appendChild(row);
      });
    }
    window.filterAddSongs = (q) => {
      const query = q.trim().toLowerCase();
      renderAddSongsList(query ? tracks.filter(t => t.name.toLowerCase().includes(query) || t.artist.toLowerCase().includes(query)) : tracks);
    };
    window.saveAddedSongs = () => {
      if (!addSongModalPlaylistId) return;
      playlists[addSongModalPlaylistId].songIds = [...addSongModalSelected];
      saveUserData(); closeModal('addSongsModal');
      openPlDetail(addSongModalPlaylistId);
      showToast('Playlist updated');
    };
    function playPlaylist(id) {
      const pl = playlists[id]; if (!pl) return;
      const songs = (pl.songIds||[]).map(sid => tracks.find(t => t.id === sid)).filter(Boolean);
      if (!songs.length) { showToast('No songs in playlist'); return; }
      playTrack(tracks.indexOf(songs[0]));
      queue = songs.slice(1).map(t => tracks.indexOf(t));
      renderQueueState(); closePlDetail();
    }
    window.openStatsPage  = () => { renderStatsPage(); document.getElementById('statsOverlay').classList.add('open'); };
    window.closeStatsPage = () => document.getElementById('statsOverlay').classList.remove('open');
    function getFilteredHistory(period) {
      const now = Date.now();
      const cutoffs = { week: 7*86400000, month: 30*86400000, year: 365*86400000 };
      if (period === 'all') return playHistory;
      return playHistory.filter(e => (now - e.timestamp) <= cutoffs[period]);
    }
    function renderStatsPage() {
      const scroll = document.getElementById('statsScroll'); scroll.innerHTML = '';
      const history = getFilteredHistory(statsPeriod);
      const periods = [['all','All Time'],['week','This Week'],['month','This Month'],['year','This Year']];
      const tabsDiv = document.createElement('div'); tabsDiv.style.cssText = 'padding:16px 16px 0;';
      const tabsRow = document.createElement('div'); tabsRow.className = 'stats-period-tabs';
      periods.forEach(([val, label]) => {
        const btn = document.createElement('button'); btn.className = 'stats-period-tab' + (statsPeriod === val ? ' active' : '');
        btn.textContent = label; btn.onclick = () => { statsPeriod = val; renderStatsPage(); };
        tabsRow.appendChild(btn);
      });
      tabsDiv.appendChild(tabsRow); scroll.appendChild(tabsDiv);
      const countMap = {}, timeMap = {};
      history.forEach(e => {
        countMap[e.trackId] = (countMap[e.trackId] || 0) + 1;
        timeMap[e.trackId]  = (timeMap[e.trackId]  || 0) + (e.duration || 0);
      });
      const totalPlays = history.length;
      const totalSecs  = Object.values(timeMap).reduce((a,b) => a+b, 0);
      const uniqueSongs = Object.keys(countMap).length;
      const hero = document.createElement('div'); hero.className = 'stats-hero'; hero.style.margin = '16px';
      hero.innerHTML = `
        <div class="stats-period-tabs" style="margin-bottom:16px;display:none"></div>
        <div class="stats-hero-row">
          <div class="stats-hero-main">
            <div class="stats-big-num">${totalPlays}</div>
            <div class="stats-big-label">Total Plays</div>
          </div>
          <div class="stats-hero-side">
            <div class="stats-side-item"><div class="stats-side-num">${fmtTimeVerbose(totalSecs)}</div><div class="stats-side-label">Listen Time</div></div>
            <div class="stats-side-item"><div class="stats-side-num">${uniqueSongs}</div><div class="stats-side-label">Unique Songs</div></div>
          </div>
        </div>`;
      scroll.appendChild(hero);
      const cardsRow = document.createElement('div'); cardsRow.className = 'stats-cards-row';
      const miniCards = [
        { icon:'❤️', bg:'rgba(255,82,82,.15)', num: likedSet.size, label:'Liked Songs' },
        { icon:'🎵', bg:'rgba(29,185,84,.15)',  num: tracks.length, label:'Total Songs' },
        { icon:'📋', bg:'rgba(244,185,66,.15)', num: Object.keys(playlists).length, label:'Playlists' },
        { icon:'🔥', bg:'rgba(255,140,0,.15)',  num: Object.keys(countMap).filter(id => countMap[id] >= 3).length, label:'Often Played' },
      ];
      miniCards.forEach(mc => {
        const card = document.createElement('div'); card.className = 'stats-mini-card';
        card.innerHTML = `<div class="stats-mini-icon" style="background:${mc.bg}">${mc.icon}</div><div class="stats-mini-num">${mc.num}</div><div class="stats-mini-label">${mc.label}</div>`;
        cardsRow.appendChild(card);
      });
      scroll.appendChild(cardsRow);
      if (totalPlays === 0) {
        const empty = document.createElement('div'); empty.className = 'stats-empty';
        empty.innerHTML = `<div class="stats-empty-icon">🎵</div><div style="font-size:16px;font-weight:700;color:var(--txt2)">No plays yet</div><div style="font-size:13px;margin-top:6px">Start listening to see your stats</div>`;
        scroll.appendChild(empty); return;
      }
      const sorted = Object.entries(countMap).sort((a,b) => b[1]-a[1]).slice(0,15);
      const maxCount = sorted[0]?.[1] || 1;
      const sec = document.createElement('div'); sec.className = 'stats-section';
      sec.innerHTML = `<div class="stats-section-title">Top Songs <span class="badge" style="background:var(--accent-dim);color:var(--accent)">${sorted.length}</span></div>`;
      sorted.forEach(([trackId, count], i) => {
        const t = tracks.find(t => t.id === parseInt(trackId)); if (!t) return;
        const secs = timeMap[trackId] || 0;
        const rankCls = i===0?'top1':i===1?'top2':i===2?'top3':'';
        const item = document.createElement('div'); item.className = 'stats-song-item';
        item.innerHTML = `
          <div class="stats-song-rank ${rankCls}">${i+1}</div>
          <div class="stats-song-art">${thumbHtml(t)}</div>
          <div class="stats-song-info">
            <div class="stats-song-name">${t.name}</div>
            <div class="stats-song-artist">${t.artist}</div>
            <div class="stats-prog-wrap"><div class="stats-prog-fill" style="width:${(count/maxCount*100).toFixed(1)}%"></div></div>
          </div>
          <div class="stats-song-right">
            <div class="stats-play-count">${count}</div>
            <div class="stats-play-label">plays</div>
            ${secs > 0 ? `<div class="stats-time-label">${fmtTimeVerbose(secs)}</div>` : ''}
          </div>`;
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => { closeStatsPage(); playTrack(tracks.indexOf(t)); });
        sec.appendChild(item);
      });
      scroll.appendChild(sec);
    }
    window.openEditProfileModal = () => {
      document.getElementById('editUsername').value = currentUser.username;
      document.getElementById('editName').value     = currentUser.displayName;
      document.getElementById('editPhone').value    = currentUser.phone || '';
      openModal('editProfileModal');
    };
    window.saveProfile = async () => {
      const name  = document.getElementById('editName').value.trim();
      const phone = document.getElementById('editPhone').value.trim();
      if (!name) { showToast('Display name cannot be empty'); return; }
      currentUser.displayName = name; currentUser.phone = phone;
      try { await update(userRef(currentUser.username), { displayName: name, phone }); } catch (e) {}
      applyUserUI(); closeModal('editProfileModal'); showToast('Profile updated ✓');
    };
    window.openModal  = (id) => document.getElementById(id).classList.add('open');
    window.closeModal = (id) => document.getElementById(id).classList.remove('open');
    let toastTimer = null;
    window.showToast = (msg) => {
      const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
    };

    // LP & info fixes
    function openLpModal(idx) {
      lpTrackIdx = idx;
      const t = tracks[idx];
      document.getElementById('lpTitle').textContent = t.name;
      document.getElementById('lpArtist').textContent = t.artist;
      document.getElementById('lpArtImg').src = t.cover || '';
      document.getElementById('lpQueueSub').textContent = queue.length > 0 ? `${queue.length} song${queue.length !== 1 ? 's' : ''} in queue` : 'Queue is empty';
      const liked = likedSet.has(t.id);
      document.getElementById('lpLikeLabel').textContent = liked ? 'Unlike Song' : 'Like Song';
      const icon = document.getElementById('lpLikeIcon');
      icon.innerHTML = liked
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="#ff5252" stroke="#ff5252" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff5252" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
      document.getElementById('lpModalOverlay').classList.add('open');
    }
    window.closeLpModal = () => { document.getElementById('lpModalOverlay').classList.remove('open'); lpTrackIdx = -1; };
    window.lpPlayNow    = () => { if (lpTrackIdx < 0) return; playTrack(lpTrackIdx); closeLpModal(); };
    window.lpPlayNext   = () => { if (lpTrackIdx < 0) return; queue.unshift(lpTrackIdx); renderQueueState(); showToast(`Playing next: ${tracks[lpTrackIdx].name}`); closeLpModal(); };
    window.lpAddToQueue = () => { if (lpTrackIdx < 0) return; queue.push(lpTrackIdx); renderQueueState(); showToast(`Added to queue: ${tracks[lpTrackIdx].name}`); closeLpModal(); };
    window.lpToggleLike = () => {
      if (lpTrackIdx < 0) return;
      const t = tracks[lpTrackIdx];
      if (likedSet.has(t.id)) { likedSet.delete(t.id); showToast('Removed from Liked Songs 💔'); }
      else { likedSet.add(t.id); showToast('Added to Liked Songs ❤️'); }
      if (lpTrackIdx === currentTrackIdx) updateLikeBtns();
      saveUserData(); if (currentFilter === 'liked') filterTracks('liked', null);
      closeLpModal();
    };
    window.lpAddToPlaylist = () => {
      if (lpTrackIdx < 0) return;
      ctxTrackIdx = lpTrackIdx; closeLpModal();
      const ids = Object.keys(playlists);
      if (!ids.length) { showToast('No playlists yet — create one in Library'); return; }
      const list = document.getElementById('plSubmenuList'); list.innerHTML = '';
      ids.forEach(id => {
        const item = document.createElement('div'); item.className = 'ctx-item'; item.textContent = playlists[id].name;
        item.onclick = () => {
          const pl = playlists[id]; if (!pl.songIds) pl.songIds = [];
          if (!pl.songIds.includes(tracks[ctxTrackIdx].id)) { pl.songIds.push(tracks[ctxTrackIdx].id); saveUserData(); showToast(`Added to "${pl.name}"`); }
          else showToast('Already in playlist');
          document.getElementById('plSubmenuOverlay').classList.remove('open');
        };
        list.appendChild(item);
      });
      document.getElementById('plSubmenuOverlay').classList.add('open');
    };
    window.lpShareSong = () => {
      if (lpTrackIdx < 0) return;
      const t = tracks[lpTrackIdx];
      const base = window.location.href.split('#')[0];
      const deepLink = `${base}#play=${t.id}`;
      if (navigator.share) {
        navigator.share({ title: `${t.name} — ${t.artist}`, text: `🎵 Listen to "${t.name}" by ${t.artist} on MY Song`, url: deepLink }).catch(() => {});
      } else {
        navigator.clipboard?.writeText(deepLink).then(() => showToast('Song link copied! 🔗')).catch(() => showToast('Link: ' + deepLink));
      }
      closeLpModal();
    };
    window.lpSongInfo = () => {
      if (lpTrackIdx < 0) return;
      const t = tracks[lpTrackIdx];
      document.getElementById('siTitle').textContent    = t.name;
      document.getElementById('siArtist').textContent   = t.artist;
      document.getElementById('siAlbum').textContent    = t.album || '—';
      document.getElementById('siCategory').textContent = t.category ? (t.category.charAt(0).toUpperCase() + t.category.slice(1)) : '—';
      document.getElementById('siDuration').textContent = durations[t.id] ? fmtTime(durations[t.id]) : '—';
      document.getElementById('siPlayCount').textContent = `${playCounts[t.id] || 0} plays`;
      document.getElementById('siListenTime').textContent = listenSeconds[t.id] ? fmtTimeVerbose(listenSeconds[t.id]) : '—';
      document.getElementById('siLikedStatus').textContent = likedSet.has(t.id) ? '❤️ Liked' : 'Not Liked';
      document.getElementById('siArtImg').src = t.cover || '';
      closeLpModal();
      document.getElementById('songInfoOverlay').classList.add('open');
    };
    window.closeSongInfo = () => document.getElementById('songInfoOverlay').classList.remove('open');

    function checkDeepLink() {
      const hash = window.location.hash;
      if (!hash) return;
      const match = hash.match(/^#play=(\d+)/);
      if (match) {
        const songId = parseInt(match[1], 10);
        const idx = tracks.findIndex(t => t.id === songId);
        if (idx >= 0) {
          setTimeout(() => { playTrack(idx); openNowPlaying(); }, 600);
        }
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
