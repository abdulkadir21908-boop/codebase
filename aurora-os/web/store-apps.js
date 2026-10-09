var AuroraStore = {
  installed: [],
  loading: true,

  init: function() {
    var self = this;
    fetch('/api/store/installed').then(function(r) { return r.json(); }).then(function(d) {
      self.installed = d.installed || [];
      self.loading = false;
      self.registerInstalled();
      if (typeof AppManager !== 'undefined') AppManager.renderDock();
    }).catch(function() {
      self.loading = false;
    });
  },

  isInstalled: function(id) {
    return this.installed.indexOf(id) !== -1;
  },

  install: function(id) {
    if (this.installed.indexOf(id) === -1) this.installed.push(id);
    if (typeof AppManager !== 'undefined' && AppManager.apps[id]) AppManager.renderDock();
  },

  uninstall: function(id) {
    this.installed = this.installed.filter(function(x) { return x !== id; });
    if (typeof AppManager !== 'undefined') AppManager.renderDock();
  },

  registerInstalled: function() {
    var self = this;
    Object.keys(StoreApps).forEach(function(id) {
      if (self.isInstalled(id) && !AppManager.apps[id]) {
        AppManager.register(id, StoreApps[id]);
      }
    });
  }
};

var StoreApps = {};

StoreApps.weather = {
  name: 'Weather',
  icon: '&#127780;',
  color: 'linear-gradient(135deg,#74c7ec,#89dceb)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'weather', title: 'Weather', width: 400, height: 500 });
    var body = w.bodyEl;
    body.innerHTML = '<div style="position:absolute;inset:0;background:linear-gradient(160deg,#0a1628,#132240 40%,#1a3355);overflow-y:auto;display:flex;align-items:center;justify-content:center"><div style="text-align:center;color:#74c7ec"><div style="font-size:32px;margin-bottom:8px">&#127780;</div><div style="font-size:13px;opacity:.6">Loading weather...</div></div></div>';

    function load() {
    fetch('/api/weather').then(function(r) { return r.json(); }).then(function(d) {
      if (d.error) { body.innerHTML = '<div style="position:absolute;inset:0;background:#0a1628;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#f38ba8;gap:6px"><div style="font-size:36px">&#127780;</div><div>Weather unavailable</div><div style="font-size:11px;color:rgba(255,255,255,.35)">' + String(d.error).replace(/</g,'&lt;').slice(0,120) + '</div><button id="wx-retry" style="margin-top:6px;padding:6px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#cdd6f4;cursor:pointer;font-size:12px">Retry</button></div>'; var rb = body.querySelector('#wx-retry'); if (rb) rb.onclick = load; return; }
      var bgGrad = 'linear-gradient(160deg,#0a1628,#132240 40%,#1a3355)';
      if (d.temp_c > 30) bgGrad = 'linear-gradient(160deg,#2a1a08,#3d2a10 40%,#4a3018)';
      else if (d.temp_c < 5) bgGrad = 'linear-gradient(160deg,#0a1828,#102848 40%,#183860)';
      else if (d.desc && d.desc.toLowerCase().indexOf('rain') !== -1) bgGrad = 'linear-gradient(160deg,#0c1420,#182028 40%,#202838)';

      var condIcon = getWeatherIcon(d.code, d.desc);

      var h = '<div style="position:absolute;inset:0;background:' + bgGrad + ';overflow-y:auto;animation:wfIn .6s cubic-bezier(.2,.8,.3,1.2) both">';
      h += '<style>@keyframes wfIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}@keyframes wfPop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}</style>';

      h += '<div style="text-align:center;padding:32px 20px 20px;animation:wfPop .5s cubic-bezier(.2,.8,.3,1.2) .1s both">';
      h += '<div style="font-size:64px;line-height:1;margin-bottom:4px;filter:drop-shadow(0 4px 12px rgba(0,0,0,.3))">' + condIcon + '</div>';
      h += '<div style="font-size:56px;font-weight:200;color:#fff;line-height:1.1;text-shadow:0 2px 20px rgba(0,0,0,.3)">' + d.temp_c + '\u00b0</div>';
      h += '<div style="font-size:15px;color:rgba(255,255,255,.65);margin-top:4px">' + d.desc + '</div>';
      h += '<div style="font-size:13px;color:rgba(255,255,255,.4);margin-top:2px">' + d.city + ', ' + d.country + '</div>';
      h += '<div style="font-size:12px;color:rgba(255,255,255,.3);margin-top:4px">Feels like ' + d.feels_c + '\u00b0 \u00b7 H:' + (d.forecasts && d.forecasts[0] ? d.forecasts[0].max : '-') + '\u00b0 L:' + (d.forecasts && d.forecasts[0] ? d.forecasts[0].min : '-') + '\u00b0</div>';
      h += '</div>';

      h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:0 16px;animation:wfPop .5s cubic-bezier(.2,.8,.3,1.2) .2s both">';
      h += weatherStat('Humidity', d.humidity + '%', '&#128167;');
      h += weatherStat('Wind', d.wind_kmph + ' km/h', '&#127788;');
      h += weatherStat('UV Index', d.uv, '&#9728;&#65039;');
      h += weatherStat('Pressure', d.pressure + ' hPa', '&#9881;');
      h += weatherStat('Visibility', d.visibility_km + ' km', '&#128065;');
      h += weatherStat('Cloud Cover', d.cloud_cover + '%', '&#9729;');
      h += '</div>';

      if (d.forecasts && d.forecasts.length > 0) {
        h += '<div style="padding:20px 16px 8px;animation:wfPop .5s cubic-bezier(.2,.8,.3,1.2) .3s both">';
        h += '<div style="font-size:11px;color:rgba(255,255,255,.3);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px">7-Day Forecast</div>';
        d.forecasts.forEach(function(f, i) {
          var dayName = new Date(f.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
          var fIcon = getWeatherIcon(f.code, f.desc);
          h += '<div style="display:flex;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.04);animation:wfPop .4s cubic-bezier(.2,.8,.3,1.2) ' + (0.35 + i * 0.05) + 's both">';
          h += '<span style="width:44px;font-size:12px;color:rgba(255,255,255,.5)">' + (i === 0 ? 'Today' : dayName) + '</span>';
          h += '<span style="font-size:18px;margin:0 10px;width:28px;text-align:center">' + fIcon + '</span>';
          h += '<span style="font-size:12px;color:rgba(255,255,255,.45);flex:1">' + f.desc + '</span>';
          h += '<span style="font-size:12px;color:rgba(255,255,255,.3);margin-right:8px">' + f.min + '\u00b0</span>';
          h += '<span style="font-size:13px;color:#fff;font-weight:500">' + f.max + '\u00b0</span>';
          h += '</div>';
        });
        h += '</div>';
      }

      h += '<div style="text-align:center;padding:16px;font-size:10px;color:rgba(255,255,255,.15)">Updated ' + (d.observation || 'just now') + '</div>';
      h += '</div>';
      body.innerHTML = h;
    }).catch(function() {
      body.innerHTML = '<div style="position:absolute;inset:0;background:#0a1628;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#f38ba8"><div style="font-size:36px;margin-bottom:8px">&#127780;</div><div>Could not connect to weather service</div><div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:4px">Check your internet connection</div><button id="wx-retry2" style="margin-top:10px;padding:6px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#cdd6f4;cursor:pointer;font-size:12px">Retry</button></div>';
      var rb2 = body.querySelector('#wx-retry2');
      if (rb2) rb2.onclick = load;
    });
    }
    load();

    function weatherStat(label, value, icon) {
      return '<div style="background:rgba(255,255,255,.04);border-radius:12px;padding:12px 10px;text-align:center;border:1px solid rgba(255,255,255,.03)"><div style="font-size:16px;margin-bottom:4px">' + icon + '</div><div style="font-size:15px;font-weight:600;color:#fff">' + value + '</div><div style="font-size:9px;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.5px;margin-top:2px">' + label + '</div></div>';
    }

    function getWeatherIcon(code, desc) {
      code = String(code);
      var d = (desc || '').toLowerCase();
      if (d.indexOf('thunder') !== -1) return '&#127785;';
      if (d.indexOf('heavy rain') !== -1 || d.indexOf('torrential') !== -1) return '&#127783;&#65039;';
      if (d.indexOf('rain') !== -1 || d.indexOf('drizzle') !== -1 || d.indexOf('shower') !== -1) return '&#127782;';
      if (d.indexOf('snow') !== -1 || d.indexOf('sleet') !== -1 || d.indexOf('blizzard') !== -1) return '&#127784;';
      if (d.indexOf('fog') !== -1 || d.indexOf('mist') !== -1) return '&#127787;';
      if (d.indexOf('cloud') !== -1 && d.indexOf('part') !== -1) return '&#9925;';
      if (d.indexOf('overcast') !== -1 || d.indexOf('cloud') !== -1) return '&#9729;';
      if (d.indexOf('clear') !== -1 || d.indexOf('sunny') !== -1) return '&#9728;&#65039;';
      if (d.indexOf('part') !== -1) return '&#9925;';
      if (code.charAt(0) === '1') return '&#9728;&#65039;';
      if (code.charAt(0) === '2') return '&#9925;';
      if (code.charAt(0) === '3') return '&#9729;';
      if (code.charAt(0) === '4') return '&#9729;';
      if (code.charAt(0) === '5') return '&#127782;';
      if (code.charAt(0) === '6') return '&#127784;';
      if (code.charAt(0) === '7') return '&#127787;';
      return '&#127780;';
    }
  }
};

StoreApps.music = {
  name: 'Music',
  icon: '&#127925;',
  color: 'linear-gradient(135deg,#f38ba8,#eba0ac)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'music', title: 'Music', width: 480, height: 420 });
    var body = w.bodyEl;
    var tracks = [];
    var playing = -1;
    var audioPlaying = false;
    var loaded = false;
    var audioEl = document.createElement('audio');
    audioEl.preload = 'metadata';
    audioEl.addEventListener('timeupdate', function() {
      var bar = body.querySelector('#mu-progress');
      if (bar && audioEl.duration) bar.style.width = (audioEl.currentTime / audioEl.duration * 100) + '%';
      var tc = body.querySelector('#mu-time');
      if (tc) tc.textContent = fmtTime(audioEl.currentTime) + ' / ' + fmtTime(audioEl.duration);
    });
    audioEl.addEventListener('ended', function() {
      if (playing < tracks.length - 1) playTrack(playing + 1);
      else { audioPlaying = false; render(); }
    });
    audioEl.addEventListener('error', function() {
      audioPlaying = false;
      render();
      var toast = body.querySelector('#mu-err');
      if (toast) { toast.style.display = 'block'; setTimeout(function() { if (toast) toast.style.display = 'none'; }, 3000); }
    });
    function fmtTime(t) {
      if (!isFinite(t) || t == null) return '0:00';
      t = Math.floor(t);
      return Math.floor(t / 60) + ':' + (t % 60 < 10 ? '0' : '') + (t % 60);
    }
    function playTrack(i) {
      if (i < 0 || i >= tracks.length) return;
      playing = i;
      audioEl.src = '/api/audio?path=' + encodeURIComponent(tracks[i].path);
      audioEl.play().then(function() { audioPlaying = true; render(); }).catch(function() { audioPlaying = false; render(); });
      render();
    }
    function togglePlay() {
      if (playing < 0) { if (tracks.length) playTrack(0); return; }
      if (audioEl.paused) { audioEl.play().catch(function() {}); audioPlaying = true; }
      else { audioEl.pause(); audioPlaying = false; }
      render();
    }

    function render() {
      var h = '<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:linear-gradient(160deg,#1a0a12,#2a1020 50%,#1a0a18)">';
      h += '<div style="padding:16px 20px 12px;border-bottom:1px solid rgba(255,255,255,.05);flex-shrink:0">';
      h += '<h2 style="font-size:18px;font-weight:600;color:#fff;margin-bottom:2px">Music</h2>';
      h += '<div style="font-size:11px;color:rgba(255,255,255,.3)">' + tracks.length + ' tracks in library</div>';
      h += '</div>';
      h += '<div style="flex:1;overflow-y:auto">';
      if (tracks.length === 0) {
        if (!loaded) {
          h += '<div style="text-align:center;padding:50px 20px;color:rgba(255,255,255,.3)"><div style="font-size:40px;margin-bottom:8px">&#127925;</div><div>Scanning for music files...</div><div style="font-size:11px;margin-top:4px">Checking your Downloads and Music folders</div></div>';
        } else {
          h += '<div style="text-align:center;padding:50px 20px;color:rgba(255,255,255,.3)"><div style="font-size:40px;margin-bottom:8px">&#127925;</div><div>No music files found</div><div style="font-size:11px;margin-top:4px">Add .mp3, .wav, .flac or .ogg files to your Music or Downloads folder</div></div>';
        }
      } else {
        tracks.forEach(function(s, i) {
          var isPlaying = playing === i;
          h += '<div class="mu-row" data-idx="' + i + '" style="display:flex;align-items:center;padding:10px 20px;cursor:pointer;transition:all .2s ease;border-bottom:1px solid rgba(255,255,255,.03);background:' + (isPlaying ? 'rgba(243,139,168,.1)' : 'transparent') + '">';
          h += '<div style="width:38px;height:38px;border-radius:8px;background:' + (isPlaying ? 'linear-gradient(135deg,#f38ba8,#cba6f7)' : 'rgba(255,255,255,.06)') + ';display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;transition:all .3s ease;box-shadow:' + (isPlaying ? '0 2px 12px rgba(243,139,168,.3)' : 'none') + '">' + (isPlaying && audioPlaying ? '&#10074;&#10074;' : '&#9655;') + '</div>';
          h += '<div style="flex:1;margin-left:12px;min-width:0"><div style="font-size:13px;color:' + (isPlaying ? '#f38ba8' : '#fff') + ';font-weight:' + (isPlaying ? '500' : '400') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escS(s.name) + '</div>';
          h += '<div style="font-size:11px;color:rgba(255,255,255,.35);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + s.ext + ' \u00b7 ' + fmtSize(s.size) + '</div></div>';
          h += '</div>';
        });
      }
      h += '</div>';
      if (playing >= 0 && tracks[playing]) {
        h += '<div style="padding:12px 20px;background:rgba(0,0,0,.4);border-top:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:12px;flex-shrink:0;backdrop-filter:blur(10px)">';
        h += '<div style="width:42px;height:42px;border-radius:10px;background:linear-gradient(135deg,#f38ba8,#cba6f7);display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 4px 16px rgba(243,139,168,.3);animation:muPulse 2s ease infinite">&#9835;</div>';
        h += '<div style="flex:1;min-width:0"><div style="font-size:13px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escS(tracks[playing].name) + '</div><div id="mu-time" style="font-size:11px;color:rgba(255,255,255,.4)">0:00 / 0:00</div></div>';
        h += '<button class="mu-ctrl" data-action="prev" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:18px;cursor:pointer;padding:6px;transition:color .2s" onmouseenter="this.style.color=\'#fff\'" onmouseleave="this.style.color=\'rgba(255,255,255,.5)\'">&#9198;</button>';
        h += '<button class="mu-ctrl" data-action="toggle" style="background:none;border:none;color:#f38ba8;font-size:22px;cursor:pointer;padding:6px">' + (audioPlaying ? '&#10074;&#10074;' : '&#9655;') + '</button>';
        h += '<button class="mu-ctrl" data-action="stop" title="Stop" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:16px;cursor:pointer;padding:6px">&#9632;</button>';
        h += '<button class="mu-ctrl" data-action="next" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:18px;cursor:pointer;padding:6px;transition:color .2s" onmouseenter="this.style.color=\'#fff\'" onmouseleave="this.style.color=\'rgba(255,255,255,.5)\'">&#9197;</button>';
        h += '</div>';
        h += '<div id="mu-seek" title="Seek" style="height:10px;margin:0 20px 12px;flex-shrink:0;display:flex;align-items:center;cursor:pointer"><div style="height:3px;flex:1;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden"><div style="height:100%;width:0%;background:linear-gradient(90deg,#f38ba8,#cba6f7);border-radius:2px" id="mu-progress"></div></div></div>';
        h += '<div id="mu-err" style="display:none;margin:0 20px 12px;padding:6px 10px;background:rgba(243,139,168,.12);border:1px solid rgba(243,139,168,.3);border-radius:8px;font-size:11px;color:#f38ba8;flex-shrink:0">Could not play this file (missing or unsupported format).</div>';
      }
      h += '</div>';
      body.innerHTML = h;
      body.querySelectorAll('.mu-row').forEach(function(el) {
        el.onclick = function() {
          var idx = parseInt(el.getAttribute('data-idx'));
          if (idx === playing && audioPlaying) { togglePlay(); }
          else if (idx === playing) { togglePlay(); }
          else { playTrack(idx); }
        };
      });
      body.querySelectorAll('.mu-ctrl').forEach(function(el) {
        el.onclick = function() {
          var act = el.getAttribute('data-action');
          if (act === 'toggle') { togglePlay(); }
          else if (act === 'stop') { audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load(); playing = -1; audioPlaying = false; render(); }
          else if (act === 'next') { playTrack(Math.min(tracks.length - 1, playing + 1)); }
          else if (act === 'prev') { playTrack(Math.max(0, playing - 1)); }
        };
      });
      var seek = body.querySelector('#mu-seek');
      if (seek) {
        seek.onclick = function(e) {
          if (!audioEl.duration) return;
          var r = seek.getBoundingClientRect();
          var frac = (e.clientX - r.left) / r.width;
          audioEl.currentTime = frac * audioEl.duration;
        };
      }
    }

    function fmtSize(b) {
      if (b < 1024) return b + ' B';
      if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
      if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
      return (b / 1073741824).toFixed(2) + ' GB';
    }
    function escS(s) { return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''; }

    render();
    fetch('/api/music/scan').then(function(r) { return r.json(); }).then(function(d) {
      tracks = d.tracks || [];
      loaded = true;
      render();
    }).catch(function() { loaded = true; render(); });
    w.onClose = function() { try { audioEl.pause(); } catch (e) {} };
  }
};

StoreApps.photos = {
  name: 'Photos',
  icon: '&#128247;',
  color: 'linear-gradient(135deg,#a6e3a1,#94e2d5)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'photos', title: 'Photos', width: 620, height: 480 });
    var body = w.bodyEl;
    var allPhotos = [];
    var viewIdx = -1;
    var photoLoaded = false;

    function renderGrid() {
      body.onkeydown = null;
      var h = '<div style="position:absolute;inset:0;overflow-y:auto;background:#0c0c14">';
      h += '<div style="padding:16px 20px 12px;display:flex;align-items:center;gap:10px">';
      h += '<h2 style="font-size:18px;font-weight:600;color:#cdd6f4;margin:0">Photos</h2>';
      h += '<span style="font-size:11px;color:#6c7086" id="photo-count"></span></div>';
      if (allPhotos.length === 0) {
        if (!photoLoaded) {
          h += '<div style="text-align:center;padding:60px 20px;color:#6c7086"><div style="font-size:48px;margin-bottom:12px">&#128247;</div>';
          h += '<div style="font-size:14px">Scanning for photos...</div>';
          h += '<div style="font-size:12px;margin-top:4px">Checking Pictures, Downloads and Desktop</div></div>';
        } else {
          h += '<div style="text-align:center;padding:60px 20px;color:#6c7086;animation:phFade .5s ease both"><div style="font-size:48px;margin-bottom:12px">&#128247;</div>';
          h += '<div style="font-size:14px">No photos found</div>';
          h += '<div style="font-size:12px;margin-top:4px">Add .jpg or .png images to your Downloads or Pictures folder,<br>then close and reopen Photos</div></div>';
        }
      } else {
        h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:3px;padding:0 12px 12px">';
        for (var i = 0; i < allPhotos.length; i++) {
          var p = allPhotos[i];
          var src = '/api/photo?path=' + encodeURIComponent(p.path);
          h += '<div class="photo-thumb" data-idx="' + i + '" style="aspect-ratio:1;border-radius:6px;overflow:hidden;cursor:pointer;position:relative;transition:transform .25s cubic-bezier(.2,.8,.3,1.2);background:#181825;animation:phPop .4s cubic-bezier(.2,.8,.3,1.2) ' + (i * 0.03) + 's both">';
          h += '<img src="' + src + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;transition:transform .3s ease" onerror="this.parentElement.style.display=\'none\'">';
          h += '<div style="position:absolute;bottom:0;left:0;right:0;padding:4px 6px;background:linear-gradient(transparent,rgba(0,0,0,.7));opacity:0;transition:opacity .2s" class="photo-hover">';
          h += '<div style="font-size:9px;color:rgba(255,255,255,.9)">' + escS(p.name) + '</div>';
          h += '</div></div>';
        }
        h += '</div>';
      }
      h += '<style>@keyframes phFade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@keyframes phPop{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}</style></div>';
      body.innerHTML = h;
      var cnt = body.querySelector('#photo-count');
      if (cnt) cnt.textContent = allPhotos.length + ' photos';
      body.querySelectorAll('.photo-thumb').forEach(function(el) {
        el.onmouseenter = function() { var hv = el.querySelector('.photo-hover'); if(hv) hv.style.opacity='1'; el.style.transform='scale(1.04)'; };
        el.onmouseleave = function() { var hv = el.querySelector('.photo-hover'); if(hv) hv.style.opacity='0'; el.style.transform=''; };
        el.onclick = function() { showFull(parseInt(el.getAttribute('data-idx'))); };
      });
    }

    function showFull(idx) {
      viewIdx = idx;
      var p = allPhotos[idx];
      var src = '/api/photo?path=' + encodeURIComponent(p.path);
      var h = '<div style="position:absolute;inset:0;background:#0c0c14;display:flex;flex-direction:column;animation:phFade .3s ease both">';
      h += '<div style="display:flex;align-items:center;padding:8px 12px;gap:8px;background:rgba(18,18,28,.95);border-bottom:1px solid rgba(255,255,255,.04);flex-shrink:0">';
      h += '<button id="ph-back" style="background:none;border:none;color:#89b4fa;font-size:20px;cursor:pointer;padding:4px 8px;border-radius:6px;transition:background .2s" onmouseenter="this.style.background=\'rgba(137,180,250,.1)\'" onmouseleave="this.style.background=\'none\'">&#8249;</button>';
      h += '<div style="flex:1;min-width:0"><div style="font-size:13px;color:#cdd6f4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escS(p.name) + '</div>';
      h += '<div style="font-size:10px;color:#6c7086">' + p.folder + ' \u00b7 ' + p.date + '</div></div>';
      h += '<span style="font-size:11px;color:#6c7086">' + (idx+1) + ' / ' + allPhotos.length + '</span>';
      h += '<button id="ph-prev" style="background:none;border:none;color:#cdd6f4;font-size:16px;cursor:pointer;padding:4px 8px;border-radius:6px;transition:background .2s" onmouseenter="this.style.background=\'rgba(255,255,255,.06)\'" onmouseleave="this.style.background=\'none\'">&#8249;</button>';
      h += '<button id="ph-next" style="background:none;border:none;color:#cdd6f4;font-size:16px;cursor:pointer;padding:4px 8px;border-radius:6px;transition:background .2s" onmouseenter="this.style.background=\'rgba(255,255,255,.06)\'" onmouseleave="this.style.background=\'none\'">&#8250;</button>';
      h += '</div>';
      h += '<div style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:8px">';
      h += '<img src="' + src + '" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;animation:phFade .3s ease both">';
      h += '</div></div>';
      body.innerHTML = h;
      body.querySelector('#ph-back').onclick = function() { viewIdx = -1; renderGrid(); };
      body.querySelector('#ph-prev').onclick = function() { if (idx > 0) showFull(idx - 1); };
      body.querySelector('#ph-next').onclick = function() { if (idx < allPhotos.length - 1) showFull(idx + 1); };
      body.onkeydown = function(e) {
        if (e.key === 'ArrowLeft' && idx > 0) showFull(idx - 1);
        else if (e.key === 'ArrowRight' && idx < allPhotos.length - 1) showFull(idx + 1);
        else if (e.key === 'Escape') { viewIdx = -1; renderGrid(); }
      };
      body.setAttribute('tabindex', '0');
      body.focus();
    }

    function escS(s) { return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''; }

    renderGrid();
    fetch('/api/photos').then(function(r) { return r.json(); }).then(function(d) {
      allPhotos = d.photos || [];
      photoLoaded = true;
      renderGrid();
    }).catch(function() {
      photoLoaded = true;
      body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#f38ba8;gap:8px"><div style="font-size:36px">&#128247;</div><div>Failed to load photos</div><button id="ph-retry" style="margin-top:4px;padding:6px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#cdd6f4;cursor:pointer;font-size:12px">Retry</button></div>';
      var rb = body.querySelector('#ph-retry');
      if (rb) rb.onclick = function() { photoLoaded = false; renderGrid(); fetch('/api/photos').then(function(r){return r.json();}).then(function(d){ allPhotos = d.photos || []; photoLoaded = true; renderGrid(); }).catch(function(){ photoLoaded = true; renderGrid(); }); };
    });
  }
};

StoreApps.clock_app = {
  name: 'Clock',
  icon: '&#128336;',
  color: 'linear-gradient(135deg,#f9e2af,#fab387)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'clock_app', title: 'Clock', width: 360, height: 400 });
    var body = w.bodyEl;
    var tab = 'clock';
    var stopwatchStart = 0, stopwatchRunning = false, stopwatchElapsed = 0;
    var timerSeconds = 0, timerRunning = false, timerInterval = null;
    var timerDone = false;
    function beep() {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        var ctx = new AC();
        [0, 0.35, 0.7].forEach(function(delay) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.frequency.value = 880;
          var t0 = ctx.currentTime + delay;
          g.gain.setValueAtTime(0.001, t0);
          g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.05);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
          o.start(t0); o.stop(t0 + 0.32);
        });
      } catch (e) {}
    }
    var timerStart = 0;
    var swInterval = null;
    var clockInterval = null;

    function render() {
      var h = '<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg)">';
      h += '<div style="display:flex;gap:4px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0">';
      ['clock','stopwatch','timer'].forEach(function(t) {
        h += '<button class="ck-tab" data-tab="' + t + '" style="flex:1;padding:7px;border-radius:8px;border:none;background:' + (tab === t ? 'rgba(137,180,250,.15)' : 'rgba(255,255,255,.04)') + ';color:' + (tab === t ? 'var(--accent)' : 'var(--text3)') + ';font-size:12px;cursor:pointer;font-family:var(--font);transition:all .2s ease">' + t.charAt(0).toUpperCase() + t.slice(1) + '</button>';
      });
      h += '</div>';
      h += '<div style="flex:1;display:flex;align-items:center;justify-content:center">';
      if (tab === 'clock') {
        var now = new Date();
        var timeStr = (now.getHours() < 10 ? '0' : '') + now.getHours() + ':' + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes() + ':' + (now.getSeconds() < 10 ? '0' : '') + now.getSeconds();
        h += '<div style="text-align:center"><div style="font-size:52px;font-weight:200;font-family:var(--mono);color:var(--text);letter-spacing:2px">' + timeStr + '</div>';
        h += '<div style="font-size:13px;color:var(--text3);margin-top:4px">' + now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + '</div></div>';
      } else if (tab === 'stopwatch') {
        var elapsed = stopwatchRunning ? stopwatchElapsed + (Date.now() - stopwatchStart) : stopwatchElapsed;
        var ms = Math.floor((elapsed % 1000) / 10);
        var s = Math.floor(elapsed / 1000) % 60;
        var m = Math.floor(elapsed / 60000);
        var display = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + '.' + (ms < 10 ? '0' : '') + ms;
        h += '<div style="text-align:center"><div style="font-size:46px;font-weight:200;font-family:var(--mono);color:var(--text);letter-spacing:2px">' + display + '</div>';
        h += '<div style="display:flex;gap:10px;justify-content:center;margin-top:20px">';
        h += '<button class="ck-btn" data-action="sw-toggle" style="padding:10px 32px;border-radius:24px;border:none;background:' + (stopwatchRunning ? 'rgba(243,139,168,.2)' : 'rgba(166,227,161,.2)') + ';color:' + (stopwatchRunning ? 'var(--red)' : 'var(--green)') + ';font-size:14px;cursor:pointer;font-family:var(--font);transition:all .2s cubic-bezier(.2,.8,.3,1.2);box-shadow:' + (stopwatchRunning ? '0 2px 12px rgba(243,139,168,.2)' : '0 2px 12px rgba(166,227,161,.2)') + '">' + (stopwatchRunning ? 'Stop' : 'Start') + '</button>';
        h += '<button class="ck-btn" data-action="sw-reset" style="padding:10px 24px;border-radius:24px;border:none;background:rgba(255,255,255,.06);color:var(--text3);font-size:14px;cursor:pointer;font-family:var(--font);transition:all .2s ease">Reset</button>';
        h += '</div></div>';
      } else if (tab === 'timer') {
        var tLeft = timerRunning ? Math.max(0, timerSeconds - Math.floor((Date.now() - timerStart) / 1000)) : timerSeconds;
        var tM = Math.floor(tLeft / 60);
        var tS = tLeft % 60;
        var progress = timerRunning && timerSeconds > 0 ? ((timerSeconds - tLeft) / timerSeconds * 100) : 0;
        h += '<div style="text-align:center"><div style="position:relative;width:160px;height:160px;margin:0 auto">';
        h += '<svg viewBox="0 0 160 160" style="width:100%;height:100%;transform:rotate(-90deg)"><circle cx="80" cy="80" r="72" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="6"/>';
        h += '<circle cx="80" cy="80" r="72" fill="none" stroke="' + (tLeft <= 10 && timerRunning ? '#f38ba8' : 'var(--accent)') + '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + (progress * 4.52) + ' 452" style="transition:stroke-dasharray .5s linear,stroke .3s ease"/></svg>';
        h += '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:200;font-family:var(--mono);color:' + (tLeft <= 10 && timerRunning ? '#f38ba8' : 'var(--text)') + '">' + (tM < 10 ? '0' : '') + tM + ':' + (tS < 10 ? '0' : '') + tS + '</div></div>';
        h += '<div style="display:flex;gap:10px;justify-content:center;margin-top:20px">';
        if (!timerRunning && timerSeconds === 0) {
          if (timerDone) h += '<div style="display:inline-block;margin-bottom:12px;padding:6px 18px;border-radius:16px;background:rgba(243,139,168,.15);border:1px solid rgba(243,139,168,.35);color:#f38ba8;font-size:13px;font-weight:600;animation:ckFlash 1s ease infinite">&#9200; Time\u2019s up!</div><div style="height:0"></div><style>@keyframes ckFlash{0%,100%{opacity:1}50%{opacity:.45}}</style>';
          [{s:60,l:'1m'},{s:180,l:'3m'},{s:300,l:'5m'},{s:600,l:'10m'},{s:900,l:'15m'},{s:1800,l:'30m'}].forEach(function(opt) {
            h += '<button class="ck-btn" data-action="timer-set" data-secs="' + opt.s + '" style="padding:8px 14px;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text3);font-size:12px;cursor:pointer;font-family:var(--font);transition:all .2s ease" onmouseenter="this.style.background=\'rgba(137,180,250,.1)\'" onmouseleave="this.style.background=\'rgba(255,255,255,.04)\'">' + opt.l + '</button>';
          });
        } else {
          h += '<button class="ck-btn" data-action="timer-toggle" style="padding:10px 32px;border-radius:24px;border:none;background:' + (timerRunning ? 'rgba(243,139,168,.2)' : 'rgba(166,227,161,.2)') + ';color:' + (timerRunning ? 'var(--red)' : 'var(--green)') + ';font-size:14px;cursor:pointer;font-family:var(--font);transition:all .2s cubic-bezier(.2,.8,.3,1.2)">' + (timerRunning ? 'Pause' : 'Start') + '</button>';
          h += '<button class="ck-btn" data-action="timer-reset" style="padding:10px 24px;border-radius:24px;border:none;background:rgba(255,255,255,.06);color:var(--text3);font-size:14px;cursor:pointer;font-family:var(--font);transition:all .2s ease">Reset</button>';
        }
        h += '</div></div>';
      }
      h += '</div></div>';
      body.innerHTML = h;
      body.querySelectorAll('.ck-tab').forEach(function(el) { el.onclick = function() { tab = el.getAttribute('data-tab'); render(); }; });
      body.querySelectorAll('.ck-btn').forEach(function(el) {
        el.onclick = function() {
          var action = el.getAttribute('data-action');
          if (action === 'sw-toggle') {
            if (stopwatchRunning) { stopwatchElapsed += Date.now() - stopwatchStart; stopwatchRunning = false; if (swInterval) clearInterval(swInterval); }
            else { stopwatchStart = Date.now(); stopwatchRunning = true; swInterval = setInterval(render, 50); }
            render();
          } else if (action === 'sw-reset') {
            stopwatchRunning = false; stopwatchElapsed = 0; if (swInterval) clearInterval(swInterval); render();
          } else if (action === 'timer-set') {
            timerSeconds = parseInt(el.getAttribute('data-secs')); timerDone = false; render();
          } else if (action === 'timer-toggle') {
            if (timerRunning) { timerRunning = false; if (timerInterval) clearInterval(timerInterval); }
            else { timerStart = Date.now(); timerRunning = true; timerDone = false; timerInterval = setInterval(function() {
              var left = timerSeconds - Math.floor((Date.now() - timerStart) / 1000);
              if (left <= 0) { timerRunning = false; timerSeconds = 0; timerDone = true; clearInterval(timerInterval); beep(); }
              render();
            }, 500); }
            render();
          } else if (action === 'timer-reset') {
            timerRunning = false; timerSeconds = 0; timerDone = false; if (timerInterval) clearInterval(timerInterval); render();
          }
        };
      });
    }
    render();
    clockInterval = setInterval(function() { if (tab === 'clock') render(); }, 1000);
    w.onClose = function() { if (swInterval) clearInterval(swInterval); if (timerInterval) clearInterval(timerInterval); if (clockInterval) clearInterval(clockInterval); };
  }
};

StoreApps.textedit = {
  name: 'TextEdit',
  icon: '&#9998;',
  color: 'linear-gradient(135deg,#cdd6f4,#bac2de)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'textedit', title: 'TextEdit', width: 520, height: 400 });
    var body = w.bodyEl;
    var btnStyle = 'padding:5px 10px;border-radius:6px;border:none;background:rgba(255,255,255,.05);color:var(--text3);font-size:12px;cursor:pointer;font-family:var(--font);transition:all .15s ease';
    body.innerHTML = '<div style="position:absolute;inset:0;display:flex;flex-direction:column">' +
      '<div style="display:flex;align-items:center;padding:6px 12px;gap:4px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0;flex-wrap:wrap">' +
      '<button id="te-open" style="' + btnStyle + '" title="Open a text file">Open</button>' +
      '<button id="te-save" style="' + btnStyle + '" title="Save to a file">Save</button>' +
      '<input id="te-path" type="text" placeholder="filename.txt" style="flex:1;min-width:80px;padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text);font-size:12px;font-family:var(--font);outline:none">' +
      '<span id="te-status" style="font-size:11px;color:var(--text3)"></span>' +
      '<div style="width:1px;height:16px;background:rgba(255,255,255,.08);margin:0 4px"></div>' +
      '<button style="' + btnStyle + '" onclick="document.execCommand(\'bold\')" onmouseenter="this.style.background=\'rgba(255,255,255,.1)\'" onmouseleave="this.style.background=\'rgba(255,255,255,.05)\'"><b>B</b></button>' +
      '<button style="' + btnStyle + '" onclick="document.execCommand(\'italic\')" onmouseenter="this.style.background=\'rgba(255,255,255,.1)\'" onmouseleave="this.style.background=\'rgba(255,255,255,.05)\'"><i>I</i></button>' +
      '<button style="' + btnStyle + '" onclick="document.execCommand(\'underline\')" onmouseenter="this.style.background=\'rgba(255,255,255,.1)\'" onmouseleave="this.style.background=\'rgba(255,255,255,.05)\'"><u>U</u></button>' +
      '<div style="width:1px;height:16px;background:rgba(255,255,255,.08);margin:0 4px"></div>' +
      '<button style="' + btnStyle + '" onclick="document.execCommand(\'justifyLeft\')" onmouseenter="this.style.background=\'rgba(255,255,255,.1)\'" onmouseleave="this.style.background=\'rgba(255,255,255,.05)\'">&#8676;</button>' +
      '<button style="' + btnStyle + '" onclick="document.execCommand(\'justifyCenter\')" onmouseenter="this.style.background=\'rgba(255,255,255,.1)\'" onmouseleave="this.style.background=\'rgba(255,255,255,.05)\'">&#8596;</button>' +
      '<button style="' + btnStyle + '" onclick="document.execCommand(\'justifyRight\')" onmouseenter="this.style.background=\'rgba(255,255,255,.1)\'" onmouseleave="this.style.background=\'rgba(255,255,255,.05)\'">&#8677;</button>' +
      '<div style="width:1px;height:16px;background:rgba(255,255,255,.08);margin:0 4px"></div>' +
      '<button style="' + btnStyle + '" onclick="document.execCommand(\'insertUnorderedList\')" onmouseenter="this.style.background=\'rgba(255,255,255,.1)\'" onmouseleave="this.style.background=\'rgba(255,255,255,.05)\'">&#8226;</button>' +
      '<button style="' + btnStyle + '" onclick="document.execCommand(\'insertOrderedList\')" onmouseenter="this.style.background=\'rgba(255,255,255,.1)\'" onmouseleave="this.style.background=\'rgba(255,255,255,.05)\'">1.</button>' +
      '</div>' +
      '<style>[contenteditable][data-ph]:empty:before{content:attr(data-ph);color:var(--text3);opacity:.5;pointer-events:none}</style>' +
      '<div id="te-editor" contenteditable="true" data-ph="Start typing... (Open a file above, or write and Save it)" style="flex:1;padding:16px 20px;font-size:14px;line-height:1.8;color:var(--text);outline:none;overflow-y:auto;font-family:var(--font);caret-color:var(--accent)"></div>' +
      '<div style="display:flex;align-items:center;gap:12px;padding:5px 14px;border-top:1px solid rgba(255,255,255,.06);flex-shrink:0;font-size:11px;color:var(--text3)"><span id="te-count">0 words</span><span style="flex:1"></span><span>plain text via file APIs</span></div>' +
      '</div>';
    var editor = body.querySelector('#te-editor');
    var pathEl = body.querySelector('#te-path');
    var statusEl = body.querySelector('#te-status');
    var countEl = body.querySelector('#te-count');
    var homeDir = '';
    fetch('/api/files/list').then(function(r) { return r.json(); }).then(function(d) {
      if (d && d.path) homeDir = d.path.replace(/\\/g, '/');
    }).catch(function() {});
    function setStatus(msg, ok) {
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = ok ? 'var(--green)' : 'var(--red)'; }
    }
    function updateCount() {
      var t = editor.innerText || '';
      var words = t.trim() ? t.trim().split(/\s+/).length : 0;
      if (countEl) countEl.textContent = words + (words === 1 ? ' word' : ' words');
    }
    editor.oninput = updateCount;
    body.querySelector('#te-save').onclick = function() {
      var name = (pathEl.value || '').trim() || 'untitled.txt';
      if (name.charAt(0) === '~' && homeDir) name = homeDir + name.slice(1);
      if (name.indexOf('/') === -1 && name.indexOf('\\') === -1 && !/^[A-Za-z]:/.test(name)) {
        name = (homeDir ? homeDir + '/Documents/' : '') + name;
      }
      setStatus('Saving...', true);
      fetch('/api/files/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: name, content: editor.innerText || '' }) })
        .then(function(r) { return r.json(); }).then(function(d) {
          if (d.ok) { pathEl.value = d.path || name; setStatus('Saved', true); }
          else setStatus('Save failed: ' + (d.error || 'unknown'), false);
        }).catch(function() { setStatus('Save failed (offline?)', false); });
    };
    body.querySelector('#te-open').onclick = function() {
      var name = (pathEl.value || '').trim();
      if (!name) { name = prompt('Open file — enter path:', (homeDir ? homeDir + '/Documents/' : '')); if (!name) return; }
      if (name.charAt(0) === '~' && homeDir) name = homeDir + name.slice(1);
      setStatus('Opening...', true);
      fetch('/api/files/read?path=' + encodeURIComponent(name))
        .then(function(r) { return r.json(); }).then(function(d) {
          if (d.error || d.content == null) { setStatus('Open failed: ' + (d.error || 'not found'), false); return; }
          editor.innerText = d.content;
          pathEl.value = d.path || name;
          updateCount();
          setStatus('Opened', true);
        }).catch(function() { setStatus('Open failed (offline?)', false); });
    };
  }
};

StoreApps.calculator2 = {
  name: 'Scientific Calc',
  icon: '&#129518;',
  color: 'linear-gradient(135deg,#cba6f7,#b4befe)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'calculator2', title: 'Scientific Calculator', width: 320, height: 460 });
    var body = w.bodyEl;
    var display = '0';
    var prev = null;
    var op = null;
    var fresh = true;

    function fmt(n) {
      if (typeof n !== 'number' || isNaN(n) || !isFinite(n)) return 'Error';
      if (n !== 0 && (Math.abs(n) >= 1e12 || Math.abs(n) < 1e-9)) return n.toExponential(6);
      return String(parseFloat(n.toPrecision(12)));
    }
    function num() { return parseFloat(display); }
    function calcBin(a, b, o) {
      if (o === 'plus') return fmt(a + b);
      if (o === 'minus') return fmt(a - b);
      if (o === 'mul') return fmt(a * b);
      if (o === 'div') return b !== 0 ? fmt(a / b) : 'Error';
      if (o === 'pow') return fmt(Math.pow(a, b));
      return fmt(b);
    }
    function opSymbol(o) {
      if (o === 'plus') return '+';
      if (o === 'minus') return '\u2212';
      if (o === 'mul') return '\u00d7';
      if (o === 'div') return '\u00f7';
      if (o === 'pow') return '^';
      return o || '';
    }
    function press(v) {
      if (display === 'Error' && v !== 'C' && v !== 'back') { display = '0'; prev = null; op = null; fresh = true; }
      if (/^[0-9]$/.test(v)) {
        if (fresh) { display = v; fresh = false; }
        else { display = display === '0' ? v : (display + v).slice(0, 15); }
      } else if (v === 'dot') {
        if (fresh) { display = '0.'; fresh = false; }
        else if (display.indexOf('.') === -1) { display += '.'; }
      } else if (v === 'C') { display = '0'; prev = null; op = null; fresh = true; }
      else if (v === 'back') { display = display.length > 1 ? display.slice(0, -1) : '0'; if (display === '-' || display === '') display = '0'; }
      else if (v === 'neg') { if (display !== '0') display = display.charAt(0) === '-' ? display.slice(1) : '-' + display; }
      else if (v === 'sq') { display = fmt(Math.pow(num(), 2)); fresh = true; }
      else if (v === 'sqrt') { display = num() < 0 ? 'Error' : fmt(Math.sqrt(num())); fresh = true; }
      else if (v === 'sin') { display = fmt(Math.sin(num())); fresh = true; }
      else if (v === 'cos') { display = fmt(Math.cos(num())); fresh = true; }
      else if (v === 'tan') { display = fmt(Math.tan(num())); fresh = true; }
      else if (v === 'pi') { display = fmt(Math.PI); fresh = true; }
      else if (v === 'e') { display = fmt(Math.E); fresh = true; }
      else if (v === 'pct') { display = fmt(num() / 100); fresh = true; }
      else if (['plus','minus','mul','div','pow'].indexOf(v) !== -1) {
        if (prev !== null && op && !fresh) display = calcBin(parseFloat(prev), num(), op);
        prev = display; op = v; fresh = true;
      } else if (v === 'eq') {
        if (prev !== null && op) {
          display = calcBin(parseFloat(prev), num(), op);
          prev = null; op = null; fresh = true;
        }
      }
      render();
    }

    function render() {
      var h = '<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:#1a1a2e;padding:8px">';
      h += '<div style="text-align:right;padding:12px 16px 4px;font-size:12px;font-family:var(--mono);color:rgba(255,255,255,.35);min-height:18px">' + (prev !== null && op ? prev + ' ' + opSymbol(op) : '&nbsp;') + '</div>';
      h += '<div style="text-align:right;padding:0 16px 4px;font-size:36px;font-family:var(--mono);color:' + (display === 'Error' ? '#f38ba8' : '#fff') + ';word-break:break-all;min-height:56px;display:flex;align-items:flex-end;justify-content:flex-end;letter-spacing:1px">' + display + '</div>';
      h += '<div style="text-align:right;padding:0 16px 10px;font-size:10px;color:rgba(255,255,255,.3)">trig in radians</div>';
      var btns = [
        [{t:'sin',v:'sin'},{t:'cos',v:'cos'},{t:'tan',v:'tan'},{t:'&#8730;',v:'sqrt'}],
        [{t:'&#960;',v:'pi'},{t:'e',v:'e'},{t:'x\u00b2',v:'sq'},{t:'x\u02b8',v:'pow'}],
        [{t:'C',v:'C'},{t:'\u00f7',v:'div'},{t:'\u00d7',v:'mul'},{t:'%',v:'pct'}],
        [{t:'7',v:'7'},{t:'8',v:'8'},{t:'9',v:'9'},{t:'\u2212',v:'minus'}],
        [{t:'4',v:'4'},{t:'5',v:'5'},{t:'6',v:'6'},{t:'+',v:'plus'}],
        [{t:'1',v:'1'},{t:'2',v:'2'},{t:'3',v:'3'},{t:'=',v:'eq'}],
        [{t:'0',v:'0'},{t:'.',v:'dot'},{t:'\u2190',v:'back'},{t:'\u00b1',v:'neg'}]
      ];
      btns.forEach(function(row) {
        h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:5px">';
        row.forEach(function(b) {
          var isNum = /^[0-9.]$/.test(b.t);
          var isOp = ['plus','minus','mul','div'].indexOf(b.v) !== -1;
          var isFunc = ['sin','cos','tan','sqrt','pi','e','sq','pow'].indexOf(b.v) !== -1;
          var bg = isNum ? 'rgba(255,255,255,.08)' : isOp ? 'rgba(137,180,250,.2)' : isFunc ? 'rgba(203,166,247,.15)' : b.v === 'eq' ? 'rgba(166,227,161,.25)' : 'rgba(255,255,255,.04)';
          var col = isOp ? 'var(--accent)' : b.v === 'eq' ? 'var(--green)' : isFunc ? 'var(--purple)' : 'var(--text)';
          h += '<button class="sc-btn" data-val="' + b.v + '" style="padding:13px;border-radius:10px;border:none;background:' + bg + ';color:' + col + ';font-size:15px;cursor:pointer;font-family:var(--font);transition:all .12s cubic-bezier(.2,.8,.3,1.2);box-shadow:0 2px 4px rgba(0,0,0,.15)" onmousedown="this.style.transform=\'scale(.93)\';this.style.boxShadow=\'0 0 0 rgba(0,0,0,0)\'" onmouseup="this.style.transform=\'\';this.style.boxShadow=\'0 2px 4px rgba(0,0,0,.15)\'" onmouseleave="this.style.transform=\'\';this.style.boxShadow=\'0 2px 4px rgba(0,0,0,.15)\'">' + b.t + '</button>';
        });
        h += '</div>';
      });
      h += '</div>';
      body.innerHTML = h;
      body.querySelectorAll('.sc-btn').forEach(function(btn) {
        btn.onclick = function() { press(btn.getAttribute('data-val')); };
      });
    }
    render();
    body.setAttribute('tabindex', '0');
    body.onkeydown = function(e) {
      var k = e.key;
      if (/^[0-9]$/.test(k)) press(k);
      else if (k === '.') press('dot');
      else if (k === '+') press('plus');
      else if (k === '-') press('minus');
      else if (k === '*') press('mul');
      else if (k === '/') { e.preventDefault(); press('div'); }
      else if (k === '%') press('pct');
      else if (k === '^') press('pow');
      else if (k === 'Enter' || k === '=') { e.preventDefault(); press('eq'); }
      else if (k === 'Backspace') press('back');
      else if (k === 'Escape') press('C');
      else return;
      e.stopPropagation();
    };
    w.onClose = function() { body.onkeydown = null; };
  }
};

StoreApps.books = {
  name: 'Books',
  icon: '&#128218;',
  color: 'linear-gradient(135deg,#fab387,#f9e2af)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'books', title: 'Books', width: 440, height: 400 });
    var body = w.bodyEl;
    var books = [
      { title: 'Aurora OS User Guide', author: 'Aurora Team', color: '#89b4fa', progress: 100, desc: 'Complete guide to using Aurora OS' },
      { title: 'Getting Started', author: 'Aurora Team', color: '#a6e3a1', progress: 75, desc: 'Quick start tutorial for new users' },
      { title: 'Terminal Commands', author: 'Aurora Team', color: '#cba6f7', progress: 42, desc: 'Master the Aurora shell' },
      { title: 'Customization Guide', author: 'Aurora Team', color: '#f38ba8', progress: 0, desc: 'Personalize your desktop experience' },
      { title: 'Developer Handbook', author: 'Aurora Team', color: '#f9e2af', progress: 18, desc: 'Build apps for the Aurora Store' }
    ];
    function getProgress(i) {
      try {
        var saved = JSON.parse(localStorage.getItem('aurora_books_progress') || '{}');
        if (saved[i] != null) return Math.max(0, Math.min(100, saved[i]));
      } catch (e) {}
      return books[i].progress;
    }
    function setProgress(i, v) {
      v = Math.max(0, Math.min(100, Math.round(v)));
      books[i].progress = v;
      try {
        var saved = JSON.parse(localStorage.getItem('aurora_books_progress') || '{}');
        saved[i] = v;
        localStorage.setItem('aurora_books_progress', JSON.stringify(saved));
      } catch (e) {}
    }
    function chaptersFor(b) {
      return [
        { t: 'Chapter 1 — Introduction', p: 'Welcome to "' + b.title + '". ' + b.desc + '. This opening chapter lays out what you will learn and how to get the most out of this book inside Aurora OS.' },
        { t: 'Chapter 2 — Core Concepts', p: 'The core ideas are simpler than they look. Take them one at a time, try each example on your own desktop, and revisit anything that feels unfamiliar.' },
        { t: 'Chapter 3 — Going Further', p: 'Once the basics click, this chapter shows practical workflows, shortcuts, and tips that experienced Aurora users rely on every day.' }
      ];
    }
    function renderList() {
      var h = '<div style="position:absolute;inset:0;overflow-y:auto;background:var(--bg)">';
      h += '<div style="padding:16px 20px 12px"><h2 style="font-size:18px;font-weight:600">Books</h2><div style="font-size:11px;color:var(--text3)">' + books.length + ' books in library</div></div>';
      h += '<div style="padding:0 16px">';
      books.forEach(function(b, i) {
        var p = getProgress(i);
        h += '<div class="bk-row" data-idx="' + i + '" style="display:flex;gap:14px;padding:14px;border-radius:12px;cursor:pointer;transition:all .2s ease;margin-bottom:4px;animation:phPop .4s cubic-bezier(.2,.8,.3,1.2) ' + (i * 0.06) + 's both" onmouseenter="this.style.background=\'rgba(255,255,255,.04)\';this.style.transform=\'translateX(4px)\'" onmouseleave="this.style.background=\'\';this.style.transform=\'\'">';
        h += '<div style="width:44px;height:60px;border-radius:6px;background:' + b.color + ';flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 4px 12px rgba(0,0,0,.3)">&#128218;</div>';
        h += '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:500">' + b.title + '</div>';
        h += '<div style="font-size:11px;color:var(--text3)">' + b.author + '</div>';
        h += '<div style="font-size:11px;color:var(--text3);margin-top:1px;opacity:.7">' + b.desc + '</div>';
        if (p > 0) {
          h += '<div style="display:flex;align-items:center;gap:8px;margin-top:8px"><div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><div style="height:100%;width:' + p + '%;background:linear-gradient(90deg,' + b.color + ',' + b.color + 'aa);border-radius:2px;transition:width .5s ease"></div></div>';
          h += '<span style="font-size:10px;color:var(--text3)">' + p + '%</span></div>';
        } else {
          h += '<div style="font-size:10px;color:var(--text3);margin-top:6px;opacity:.5">Not started — click to read</div>';
        }
        h += '</div></div>';
      });
      h += '</div></div>';
      body.innerHTML = h;
      body.querySelectorAll('.bk-row').forEach(function(el) {
        el.onclick = function() { showReader(parseInt(el.getAttribute('data-idx'))); };
      });
    }
    function showReader(i) {
      var b = books[i];
      var p = getProgress(i);
      var chs = chaptersFor(b);
      var h = '<div style="position:absolute;inset:0;overflow-y:auto;background:var(--bg);animation:phFade .3s ease both">';
      h += '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.06);position:sticky;top:0;background:var(--bg);z-index:2">';
      h += '<button id="bk-back" style="background:none;border:none;color:var(--accent);font-size:20px;cursor:pointer;padding:4px 8px">&#8249;</button>';
      h += '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + b.title + '</div><div style="font-size:11px;color:var(--text3)">' + b.author + '</div></div>';
      h += '<span style="font-size:11px;color:var(--text3)">' + p + '%</span></div>';
      h += '<div style="padding:20px 24px;max-width:520px;margin:0 auto">';
      h += '<div style="width:88px;height:120px;border-radius:8px;background:' + b.color + ';display:flex;align-items:center;justify-content:center;font-size:40px;margin:0 auto 12px;box-shadow:0 8px 24px rgba(0,0,0,.35)">&#128218;</div>';
      h += '<div style="font-size:11px;color:var(--text3);margin-bottom:14px;text-align:center">' + b.desc + '</div>';
      chs.forEach(function(c) {
        h += '<div style="font-size:14px;font-weight:600;margin:16px 0 6px">' + c.t + '</div>';
        h += '<p style="font-size:13px;line-height:1.8;color:var(--text2)">' + c.p + '</p>';
      });
      h += '<div style="display:flex;align-items:center;gap:10px;margin:22px 0 8px;padding:14px;background:rgba(255,255,255,.03);border-radius:12px;border:1px solid rgba(255,255,255,.05)">';
      h += '<button id="bk-minus" style="padding:8px 16px;border-radius:8px;border:none;background:rgba(255,255,255,.06);color:var(--text);font-size:14px;cursor:pointer">−</button>';
      h += '<div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden"><div style="height:100%;width:' + p + '%;background:' + b.color + ';border-radius:3px"></div></div>';
      h += '<button id="bk-plus" style="padding:8px 16px;border-radius:8px;border:none;background:rgba(255,255,255,.06);color:var(--text);font-size:14px;cursor:pointer">+</button>';
      h += '</div><div style="font-size:11px;color:var(--text3);text-align:center;margin-bottom:20px">Reading progress ' + p + '% — saved on this machine</div>';
      h += '</div></div>';
      body.innerHTML = h;
      body.querySelector('#bk-back').onclick = renderList;
      body.querySelector('#bk-minus').onclick = function() { setProgress(i, getProgress(i) - 10); showReader(i); };
      body.querySelector('#bk-plus').onclick = function() { setProgress(i, getProgress(i) + 10); showReader(i); };
    }
    renderList();
  }
};

StoreApps.emoji = {
  name: 'Emoji Viewer',
  icon: '&#128578;',
  color: 'linear-gradient(135deg,#f9e2af,#f38ba8)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'emoji', title: 'Emoji Viewer', width: 400, height: 380 });
    var body = w.bodyEl;
    var emojiSets = {
      'Smileys': ['\ud83d\ude00','\ud83d\ude03','\ud83d\ude04','\ud83d\ude01','\ud83d\ude06','\ud83d\ude05','\ud83d\ude02','\ud83e\udd23','\ud83d\ude0a','\ud83d\ude07','\ud83d\ude42','\ud83d\ude43','\ud83d\ude09','\ud83d\ude0c','\ud83d\ude0d','\ud83e\udd70','\ud83d\ude18','\ud83d\ude17','\ud83d\ude19','\ud83d\ude0b','\ud83d\ude1b','\ud83d\ude1c','\ud83e\udd2a','\ud83d\ude1d','\ud83e\udd11','\ud83e\udd17','\ud83e\udd2d','\ud83e\udd2b','\ud83e\udd14'],
      'Gestures': ['\ud83d\udc4d','\ud83d\udc4e','\ud83d\udc4b','\ud83e\udd18','\ud83e\udd19','\ud83d\udc4c','\ud83e\udd1a','\ud83e\udd1b','\ud83e\udd1c','\ud83d\udc4f','\ud83d\ude4c','\ud83e\udd32','\ud83e\udd1f','\ud83d\udc46','\ud83d\udc47','\ud83d\udc48','\ud83d\udc49','\ud83d\udc4a','\ud83e\udd33','\ud83e\udec1','\ud83e\udd1e'],
      'Hearts': ['\u2764\ufe0f','\ud83e\udde1','\ud83d\udc95','\ud83d\udc94','\ud83d\udc93','\ud83d\udc9e','\ud83d\udc9d','\ud83d\udc9f','\ud83d\udc9c','\ud83d\udda4','\ud83e\ude77','\ud83e\ude75','\ud83e\ude76'],
      'Nature': ['\ud83c\udf31','\ud83c\udf32','\ud83c\udf33','\ud83c\udf34','\ud83c\udf35','\ud83c\udf37','\ud83c\udf38','\ud83c\udf39','\ud83c\udf3a','\ud83c\udf3b','\ud83c\udf3c','\ud83c\udf3d','\ud83c\udf3e','\ud83c\udf3f','\ud83c\udf40','\ud83c\udf41','\ud83c\udf42','\ud83c\udf43','\ud83c\udf44','\ud83c\udf45','\ud83c\udf46','\ud83c\udf47','\ud83c\udf48','\ud83c\udf49','\ud83c\udf4a','\ud83c\udf4b','\ud83c\udf4c','\ud83c\udf4d','\ud83c\udf4e','\ud83c\udf4f'],
      'Objects': ['\ud83d\udca1','\ud83d\udca2','\ud83d\udca7','\ud83d\udca8','\ud83d\udca9','\ud83d\udcaa','\u2b50','\ud83c\udf1f','\ud83c\udf08','\ud83c\udf0a','\ud83c\udf0b','\ud83c\udf0c','\ud83c\udf0d','\ud83c\udf0e','\ud83c\udf0f','\ud83c\udf10','\ud83c\udf11','\ud83c\udf12','\ud83c\udf13','\ud83c\udf14','\ud83c\udf15','\ud83c\udf16','\ud83c\udf17','\ud83c\udf18'],
      'Food': ['\ud83c\udf4e','\ud83c\udf4d','\ud83c\udf4f','\ud83c\udf50','\ud83c\udf51','\ud83c\udf52','\ud83c\udf53','\ud83e\uded0','\ud83e\uded1','\ud83c\udf54','\ud83c\udf55','\ud83c\udf56','\ud83c\udf57','\ud83c\udf58','\ud83c\udf59','\ud83c\udf5a','\ud83c\udf5b','\ud83c\udf5c','\ud83c\udf5d','\ud83c\udf5e','\ud83c\udf5f','\ud83c\udf60','\ud83c\udf61','\ud83c\udf62']
    };
    var curSet = 'Smileys';
    var h = '<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg)">';
    h += '<div style="display:flex;gap:3px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.06);overflow-x:auto;flex-shrink:0">';
    Object.keys(emojiSets).forEach(function(k) {
      h += '<button class="em-tab" data-set="' + k + '" style="padding:5px 12px;border-radius:8px;border:none;background:' + (curSet === k ? 'rgba(137,180,250,.15)' : 'rgba(255,255,255,.04)') + ';color:' + (curSet === k ? 'var(--accent)' : 'var(--text3)') + ';font-size:12px;cursor:pointer;white-space:nowrap;font-family:var(--font);transition:all .2s ease">' + k + '</button>';
    });
    h += '</div>';
    h += '<div id="em-grid" style="flex:1;overflow-y:auto;padding:12px;display:grid;grid-template-columns:repeat(7,1fr);gap:4px;align-content:start">';
    h += gridHTML();
    h += '</div>';
    h += '<div id="em-toast" style="position:absolute;bottom:40px;left:50%;transform:translateX(-50%);padding:8px 20px;background:rgba(30,30,46,.95);border-radius:10px;font-size:12px;color:#a6e3a1;opacity:0;transition:all .3s cubic-bezier(.2,.8,.3,1.2);pointer-events:none;border:1px solid rgba(166,227,161,.2);box-shadow:0 4px 20px rgba(0,0,0,.3)">&#10003; Copied!</div>';
    h += '</div>';
    body.innerHTML = h;
    function gridHTML() {
      var g = '';
      (emojiSets[curSet] || []).forEach(function(e) {
        g += '<div class="em-item" data-e="' + e + '" style="text-align:center;font-size:24px;padding:8px;border-radius:10px;cursor:pointer;transition:all .2s cubic-bezier(.2,.8,.3,1.2)" onmouseenter="this.style.background=\'rgba(255,255,255,.06)\';this.style.transform=\'scale(1.25)\'" onmouseleave="this.style.background=\'\';this.style.transform=\'\'">' + e + '</div>';
      });
      return g;
    }
    function bindEmojiItems() {
      body.querySelectorAll('.em-item').forEach(function(el) {
        el.onclick = function() {
          var e = el.getAttribute('data-e');
          if (navigator.clipboard) navigator.clipboard.writeText(e).catch(function(){});
          var toast = body.querySelector('#em-toast');
          if (toast) { toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) translateY(-4px)'; setTimeout(function() { toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%)'; }, 1500); }
        };
      });
    }
    body.querySelectorAll('.em-tab').forEach(function(el) { el.onclick = function() { curSet = el.getAttribute('data-set'); renderEmoji(); }; });
    bindEmojiItems();
    function renderEmoji() {
      body.querySelectorAll('.em-tab').forEach(function(el) {
        var isActive = el.getAttribute('data-set') === curSet;
        el.style.background = isActive ? 'rgba(137,180,250,.15)' : 'rgba(255,255,255,.04)';
        el.style.color = isActive ? 'var(--accent)' : 'var(--text3)';
      });
      var grid = body.querySelector('#em-grid');
      if (grid) { grid.innerHTML = gridHTML(); }
      bindEmojiItems();
    }
  }
};

StoreApps.diskutil = {
  name: 'Disk Utility',
  icon: '&#128190;',
  color: 'linear-gradient(135deg,#6c7086,#585b70)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'diskutil', title: 'Disk Utility', width: 440, height: 380 });
    var body = w.bodyEl;
    body.innerHTML = '<div style="position:absolute;inset:0;overflow-y:auto;background:var(--bg);display:flex;align-items:center;justify-content:center"><div style="text-align:center;color:var(--text3)"><div style="font-size:32px;margin-bottom:8px">&#128190;</div>Loading disk info...</div></div>';

    function load() {
    fetch('/api/system/stats').then(function(r){return r.json()}).then(function(d) {
      if (d.error || !d.disk_total) {
        body.innerHTML = '<div style="position:absolute;inset:0;overflow-y:auto;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:var(--red)"><div style="font-size:32px">&#128190;</div><div>Could not read disk info</div><div style="font-size:11px;color:var(--text3)">' + (d.error ? String(d.error).replace(/</g,'&lt;').slice(0,120) : 'no data') + '</div><button id="du-retry" style="margin-top:6px;padding:6px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:var(--text);cursor:pointer;font-size:12px;font-family:var(--font)">Retry</button></div>';
        var drb = body.querySelector('#du-retry');
        if (drb) drb.onclick = load;
        return;
      }
      var used = d.disk_used || 0;
      var total = d.disk_total || 0;
      var free = total - used;
      function fmt(b) { if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';if(b<1073741824)return(b/1048576).toFixed(1)+' MB';return(b/1073741824).toFixed(1)+' GB'; }
      var pct = total > 0 ? (used/total*100) : 0;
      var pctColor = pct > 90 ? '#f38ba8' : pct > 70 ? '#f9e2af' : '#89b4fa';
      var h = '<div style="position:absolute;inset:0;overflow-y:auto;background:var(--bg);animation:phFade .5s ease both">';
      h += '<div style="padding:24px;text-align:center">';
      h += '<div style="width:140px;height:140px;border-radius:50%;border:10px solid rgba(255,255,255,.04);position:relative;margin:0 auto 20px;animation:phPop .6s cubic-bezier(.2,.8,.3,1.2) .1s both">';
      h += '<svg viewBox="0 0 140 140" style="position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)"><circle cx="70" cy="70" r="58" fill="none" stroke="' + pctColor + '" stroke-width="10" stroke-dasharray="' + (pct*3.644) + ' 364" stroke-linecap="round" style="transition:stroke-dasharray 1s cubic-bezier(.2,.8,.3,1.2)"/><circle cx="70" cy="70" r="58" fill="none" stroke="rgba(255,255,255,.04)" stroke-width="10"/></svg>';
      h += '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column"><div style="font-size:28px;font-weight:600">' + pct.toFixed(0) + '%</div><div style="font-size:10px;color:var(--text3)">used</div></div>';
      h += '</div>';
      h += '<div style="font-size:14px;color:var(--text2);margin-bottom:4px">' + fmt(used) + ' of ' + fmt(total) + '</div>';
      h += '<div style="font-size:12px;color:var(--text3)">' + fmt(free) + ' available</div></div>';
      h += '<div style="padding:0 20px">';
      h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">';
      [{l:'Used',v:fmt(used),c:pctColor},{l:'Free',v:fmt(free),c:'#a6e3a1'},{l:'Total',v:fmt(total),c:'var(--text2)'}].forEach(function(item, i) {
        h += '<div style="padding:14px;background:rgba(255,255,255,.03);border-radius:12px;text-align:center;border:1px solid rgba(255,255,255,.04);animation:phPop .4s cubic-bezier(.2,.8,.3,1.2) ' + (0.2 + i * 0.08) + 's both"><div style="font-size:20px;font-weight:600;color:' + item.c + '">' + item.v + '</div><div style="font-size:10px;color:var(--text3);margin-top:2px">' + item.l + '</div></div>';
      });
      h += '</div>';
      h += '<div style="padding:0 4px">';
      h += '<div style="height:10px;border-radius:5px;background:rgba(255,255,255,.04);overflow:hidden;margin-bottom:16px">';
      h += '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,' + pctColor + ',' + pctColor + 'cc);border-radius:5px;transition:width 1s cubic-bezier(.2,.8,.3,1.2)"></div></div>';
      [{l:'System',v:fmt(total * 0.15),c:'#89b4fa'},{l:'Apps',v:fmt(total * 0.25),c:'#cba6f7'},{l:'User Data',v:fmt(total * 0.4),c:'#a6e3a1'},{l:'Cache',v:fmt(total * 0.1),c:'#f9e2af'},{l:'Free Space',v:fmt(free),c:'#6c7086'}].forEach(function(seg) {
        h += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0"><div style="width:10px;height:10px;border-radius:3px;background:' + seg.c + ';flex-shrink:0"></div><span style="flex:1;font-size:12px;color:var(--text3)">' + seg.l + '</span><span style="font-size:12px;color:var(--text2)">' + seg.v + '</span></div>';
      });
      h += '</div></div></div>';
      body.innerHTML = h;
    }).catch(function() {
      body.innerHTML = '<div style="position:absolute;inset:0;overflow-y:auto;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:var(--red)"><div style="font-size:32px">&#128190;</div><div>Could not reach system service</div><div style="font-size:11px;color:var(--text3)">Check your connection</div><button id="du-retry2" style="margin-top:6px;padding:6px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:var(--text);cursor:pointer;font-size:12px;font-family:var(--font)">Retry</button></div>';
      var drb2 = body.querySelector('#du-retry2');
      if (drb2) drb2.onclick = load;
    });
    }
    load();
  }
};

StoreApps.maps = {
  name: 'Maps',
  icon: '&#128506;',
  color: 'linear-gradient(135deg,#a6e3a1,#40a02b)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'maps', title: 'Maps', width: 520, height: 420 });
    var body = w.bodyEl;
    var mapsURL = 'https://www.openstreetmap.org/export/embed.html?bbox=-0.5,51.0,0.5,52.0&layer=mapnik';
    body.innerHTML = '<div style="position:absolute;inset:0;background:#111;overflow:hidden;display:flex;flex-direction:column">' +
      '<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(18,18,28,.95);border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0">' +
      '<span style="font-size:12px;color:var(--text3)">OpenStreetMap · London area</span><span style="flex:1"></span>' +
      '<button id="maps-open" style="padding:4px 14px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:var(--text);font-size:11px;cursor:pointer;font-family:var(--font)">Open in Edge</button>' +
      '</div>' +
      '<div style="flex:1;position:relative">' +
      '<iframe id="maps-frame" src="' + mapsURL + '" style="width:100%;height:100%;border:none;filter:invert(.9) hue-rotate(180deg) saturate(.7) brightness(1.1)"></iframe>' +
      '<div id="maps-fallback" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--text3);text-align:center;padding:20px"><div style="font-size:36px">&#128506;</div><div style="font-size:13px">Map could not be loaded (network blocked?)</div><div style="font-size:11px">Use “Open in Edge” to view the full map.</div></div>' +
      '</div></div>';
    body.querySelector('#maps-open').onclick = function() { window.open('https://www.openstreetmap.org/#map=10/51.5/-0.1', '_blank'); };
    var mframe = body.querySelector('#maps-frame');
    if (mframe) {
      var mapTimer = setTimeout(function() {
        try {
          var doc = mframe.contentDocument || (mframe.contentWindow && mframe.contentWindow.document);
          if (!doc || !doc.body || !doc.body.innerHTML) showMapsFallback();
        } catch (e) { /* cross-origin means it loaded fine */ }
      }, 8000);
      mframe.onload = function() { clearTimeout(mapTimer); };
      mframe.onerror = function() { clearTimeout(mapTimer); showMapsFallback(); };
    }
    function showMapsFallback() {
      var fb = body.querySelector('#maps-fallback');
      if (fb) { fb.style.display = 'flex'; }
      if (mframe) mframe.style.display = 'none';
    }
  }
};

StoreApps.weather2 = {
  name: 'Stocks',
  icon: '&#128200;',
  color: 'linear-gradient(135deg,#a6e3a1,#40a02b)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'weather2', title: 'Stocks', width: 400, height: 400 });
    var body = w.bodyEl;
    var names = { AAPL: 'Apple Inc.', GOOGL: 'Alphabet Inc.', MSFT: 'Microsoft Corp.', AMZN: 'Amazon.com Inc.', NVDA: 'NVIDIA Corp.', TSLA: 'Tesla Inc.', META: 'Meta Platforms', 'BTC-USD': 'Bitcoin' };

    function renderStocks(stocks) {
      var h = '<div style="position:absolute;inset:0;overflow-y:auto;background:var(--bg)">';
      h += '<div style="padding:16px 20px 8px;display:flex;align-items:center;justify-content:space-between"><h2 style="font-size:18px;font-weight:600">Stocks</h2><span style="font-size:10px;color:var(--text3)">Live data</span></div>';
      stocks.forEach(function(s, i) {
        var col = s.change >= 0 ? 'var(--green)' : 'var(--red)';
        var arrow = s.change >= 0 ? '&#9650;' : '&#9660;';
        var nm = names[s.sym] || s.sym;
        var priceStr = s.price >= 1000 ? s.price.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) : s.price.toFixed(2);
        h += '<div class="st-row" style="display:flex;align-items:center;padding:14px 20px;border-bottom:1px solid rgba(255,255,255,.03);cursor:pointer;transition:background .2s ease" onmouseenter="this.style.background=\'rgba(255,255,255,.03)\'" onmouseleave="this.style.background=\'\'">';
        h += '<div style="width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--text3);margin-right:12px;flex-shrink:0">' + s.sym.substring(0, 3) + '</div>';
        h += '<div style="flex:1"><div style="font-size:14px;font-weight:600">' + s.sym + '</div><div style="font-size:11px;color:var(--text3)">' + nm + '</div></div>';
        h += '<div style="text-align:right"><div style="font-size:14px;font-weight:500">$' + priceStr + '</div>';
        h += '<div style="font-size:11px;color:' + col + '">' + arrow + ' ' + (s.change >= 0 ? '+' : '') + s.change.toFixed(2) + ' (' + (s.pct >= 0 ? '+' : '') + s.pct.toFixed(2) + '%)</div></div>';
        h += '</div>';
      });
      h += '</div>';
      body.innerHTML = h;
    }

    function loadStocks() {
      body.innerHTML = '<div style="position:absolute;inset:0;overflow-y:auto;background:var(--bg);display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:13px">Loading stocks...</div>';
      fetch('/api/stocks').then(function(r){return r.json()}).then(function(data){
        if (Array.isArray(data) && data.length > 0 && data.some(function(s){ return s.price > 0; })) renderStocks(data);
        else if (Array.isArray(data) && data.length > 0) renderStocks(data);
        else {
          body.innerHTML = '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text3);gap:6px"><div style="font-size:36px">&#128200;</div><div style="font-size:13px">No stock data right now</div><button id="st-retry" style="margin-top:6px;padding:6px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:var(--text);cursor:pointer;font-size:12px;font-family:var(--font)">Retry</button></div>';
          var rb = body.querySelector('#st-retry');
          if (rb) rb.onclick = loadStocks;
        }
      }).catch(function(){
        body.innerHTML = '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text3);gap:6px"><div style="font-size:36px">&#128200;</div><div style="font-size:13px">Could not load stock data</div><div style="font-size:11px">Check your internet connection</div><button id="st-retry2" style="margin-top:6px;padding:6px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:var(--text);cursor:pointer;font-size:12px;font-family:var(--font)">Retry</button></div>';
        var rb2 = body.querySelector('#st-retry2');
        if (rb2) rb2.onclick = loadStocks;
      });
    }
    loadStocks();
  }
};

StoreApps.terminal2 = {
  name: 'iTerm',
  icon: '&#128187;',
  color: 'linear-gradient(135deg,#1e1e2e,#313244)',
  create: function(mgr) {
    mgr.open('terminal');
  }
};
