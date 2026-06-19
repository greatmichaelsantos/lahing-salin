/* SALIN-LAHI — app.js — main application logic */
"use strict";

// window._db and window._fbReady are set by firebase.js (loads first as a module)

      // ── State ──
      var DATA = null;
      var cur = 0;
      var quizState = {};
      var lbFilter = "all";
      var ttsChunks = [],
        ttsIdx = 0,
        ttsUtt = null,
        ttsWords = [],
        ttsChunkOffsets = [],
        _ttsActiveWord = null,
        _ttsWordTimer = null,
        _audioWordTimings = null,   // per-word start times (sec) built from weighted char model
        _ttsTimingSource = null;    // {title, content} stored at station open for lazy timing build
      var _tlActiveSlide = -1;      // index of the timeline slide whose MP3 is playing (-1 = none)
      var currentSection = null;

      // ── Background Audio Controller ──
      var BGAudio = (function () {
        var VOLS = { idle: 0.40, active: 0.20, tts: 0.05, off: 0 };
        var _state = "idle";
        var _muted = false;
        var _ready = false;
        // Web Audio API — used for volume control on all platforms.
        // iOS Safari ignores el.volume writes, so we route through a GainNode instead.
        var _actx = null;
        var _gain = null;

        function _audio() { return document.getElementById("bg-audio"); }

        function _initWebAudio(el) {
          if (_gain) return;
          try {
            var Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            _actx = new Ctx();
            var src = _actx.createMediaElementSource(el);
            _gain = _actx.createGain();
            _gain.gain.value = 0;
            src.connect(_gain);
            _gain.connect(_actx.destination);
          } catch (e) {
            console.warn("BGAudio: WebAudio init failed —", e.message);
            _actx = null; _gain = null;
          }
        }

        function _fadeTo(target, ms) {
          target = Math.min(1, Math.max(0, target));
          if (_gain && _actx) {
            // Always resume in case iOS suspended the context during SpeechSynthesis
            if (_actx.state !== "running") _actx.resume();
            var now = _actx.currentTime;
            // cancelScheduledValues(0) clears all pending events including any
            // past-time setValueAtTime events left over from TTS state
            _gain.gain.cancelScheduledValues(0);
            _gain.gain.setValueAtTime(_gain.gain.value, now);
            _gain.gain.linearRampToValueAtTime(target, now + ms / 1000);
            return;
          }
          // Fallback for browsers without Web Audio
          var el = _audio();
          if (!el) return;
          el.volume = target;
        }

        function _applyVolume() {
          var target = _muted ? 0 : (VOLS[_state] != null ? VOLS[_state] : 0.50);
          if (_gain && _actx) {
            if (_state === "tts") {
              // iOS suspends AudioContext when SpeechSynthesis starts, so a scheduled
              // linearRamp never fires during TTS. Cancel all pending events and pin
              // the gain at time 0 — past-time events fire on the next processing tick
              // regardless of whether the context is currently running or suspended.
              _gain.gain.cancelScheduledValues(0);
              _gain.gain.setValueAtTime(target, 0);
              if (_actx.state !== "running") _actx.resume();
            } else {
              _fadeTo(target, 700);
            }
            return;
          }
          var el = _audio();
          if (el) el.muted = _muted;
          _fadeTo(target, 700);
        }

        function _updateBtn() {
          var btn = document.getElementById("btn-mute");
          if (!btn) return;
          if (_muted) {
            btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">volume_off</span> Muted';
            btn.style.color = "#bd001a";
            btn.style.borderColor = "#bd001a";
          } else {
            btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">volume_up</span> Music';
            btn.style.color = "#926e6b";
            btn.style.borderColor = "#a8a9ad";
          }
        }

        function start() {
          var el = _audio();
          if (!el || _ready) return;
          _initWebAudio(el);
          el.volume = 1; // el.volume is irrelevant once GainNode is active; set to 1 so gain has full range
          var p = el.play();
          if (p && typeof p.then === "function") {
            p.then(function () {
              _ready = true;
              if (_actx && _actx.state === "suspended") _actx.resume();
              _applyVolume();
            }).catch(function (err) {
              console.warn("BGAudio: play() blocked —", err.message);
              document.addEventListener("touchstart", _bgAudioFirstStart, { passive: true });
              document.addEventListener("mousedown", _bgAudioFirstStart);
              document.addEventListener("click", _bgAudioFirstStart);
            });
          } else {
            _ready = true;
            if (_actx && _actx.state === "suspended") _actx.resume();
            _applyVolume();
          }
        }

        function setState(s) {
          var changed = _state !== s;
          _state = s;
          // Always re-apply when entering TTS to force the volume change on every trigger
          if (_ready && (changed || s === "tts")) _applyVolume();
        }

        function toggleMute() {
          _muted = !_muted;
          if (!_ready) start();
          _applyVolume();
          _updateBtn();
        }

        return { start: start, setState: setState, toggleMute: toggleMute };
      }());

      // Recalculates which BGAudio volume level is appropriate for current state.
      // Music plays only on the idle screen (cur=0) and clean dashboard (cur=1, no overlay).
      // Any open overlay silences it completely; mute state is independent and preserved.
      function bgAudioUpdate() {
        if (cur === 0) { BGAudio.setState("idle"); return; }
        if (document.querySelector(".overlay.open")) { BGAudio.setState("off"); return; }
        if (ttsActive) { BGAudio.setState("tts"); return; }
        BGAudio.setState("active");
      }

      // ── Slider ──
      var track = document.getElementById("track");
      function goTo(idx, animate) {
        cur = idx;
        if (animate === false) track.style.transition = "none";
        track.style.transform = "translateX(-" + cur * 100 + "vw)";
        if (animate === false)
          requestAnimationFrame(function () {
            track.style.transition = "";
          });
        if (cur === 1) {
          startIdleTimer();
        } else {
          clearTimeout(idleTimer);
        }
        bgAudioUpdate();
      }
      // ── Fullscreen ──
      var _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

      // iOS: resize #app to match the actual visual viewport so content is never
      // hidden behind Safari's address bar or bottom toolbar.
      function _iosResizeApp() {
        var vv = window.visualViewport;
        if (!vv) return;
        var app = document.getElementById("app");
        if (!app) return;
        app.style.top    = vv.offsetTop  + "px";
        app.style.left   = vv.offsetLeft + "px";
        app.style.width  = vv.width      + "px";
        app.style.height = vv.height     + "px";
      }

      if (_isIOS && window.visualViewport) {
        window.visualViewport.addEventListener("resize", _iosResizeApp);
        window.visualViewport.addEventListener("scroll", _iosResizeApp);
        _iosResizeApp(); // apply immediately on load
      }

      function _iosTryImmersive() {
        // Collapse Safari address bar: requires body to be scrollable by ≥1px
        document.body.style.minHeight = (window.innerHeight + 1) + "px";
        window.scrollTo(0, 1);
        setTimeout(function () {
          document.body.style.minHeight = "";
          _iosResizeApp();
        }, 300);
        // Try orientation lock (works in some WebViews; silently fails in Safari)
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock("landscape").catch(function () {});
        }
      }

      function tryFullscreen() {
        if (_isIOS) {
          _iosTryImmersive();
          return;
        }
        // Android / desktop: standard Fullscreen API
        var el = document.documentElement;
        var req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
        if (req && !document.fullscreenElement && !document.webkitFullscreenElement) {
          req.call(el).catch(function () {});
        }
      }

      // Android / desktop: re-enter fullscreen if user exits (kiosk behaviour)
      if (!_isIOS) {
        document.addEventListener("fullscreenchange", function () {
          if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            setTimeout(tryFullscreen, 800);
          }
        });
        document.addEventListener("webkitfullscreenchange", function () {
          if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            setTimeout(tryFullscreen, 800);
          }
        });
      }

      document.getElementById("idle").addEventListener("click", function () {
        tryFullscreen();
        goTo(1);
      });

      // Swipe idle ↔ dashboard
      var sx = 0,
        sy = 0;
      document.addEventListener(
        "touchstart",
        function (e) {
          sx = e.touches[0].clientX;
          sy = e.touches[0].clientY;
        },
        { passive: true },
      );
      document.addEventListener(
        "touchend",
        function (e) {
          if (document.querySelector(".overlay.open")) return;
          var dx = e.changedTouches[0].clientX - sx;
          var dy = e.changedTouches[0].clientY - sy;
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
            if (dx < 0 && cur === 0) { tryFullscreen(); goTo(1); }
            if (dx > 0 && cur === 1) goTo(0);
          }
        },
        { passive: true },
      );

      // ── Overlay helpers ──
      function openOverlay(id) {
        document.getElementById(id).classList.add("open");
        bgAudioUpdate();
      }
      function closeOverlay(id) {
        ttsStop();
        if (id === "ov-detail") { stationAudioStop(); stopCarousel(); }
        document.getElementById(id).classList.remove("open");
        bgAudioUpdate();
      }
      function goBack() {
        stationAudioStop();
        ttsStop();
        closeOverlay("ov-detail");
        openOverlay("ov-guide");
      }

      // ── Toast ──
      function showToast(msg) {
        var t = document.getElementById("toast");
        t.textContent = msg;
        t.style.display = "block";
        setTimeout(function () {
          t.style.display = "none";
        }, 3000);
      }

      // ── Idle auto-return 60s ──
      var idleTimer;
      var IDLE_TIMEOUT = 60000; // 60 seconds

      var ttsActive = false; // tracks whether TTS is currently speaking

      function resetIdle() {
        clearTimeout(idleTimer);
        if (ttsActive) return; // don't start countdown while audio is playing
        idleTimer = setTimeout(function () {
          document.querySelectorAll(".overlay.open").forEach(function (ov) {
            ov.classList.remove("open");
          });
          ttsActive = false; // prevent resumeIdleTimer loop when ttsStop fires
          ttsStop();
          goTo(0);
        }, IDLE_TIMEOUT);
      }

      function pauseIdleTimer() {
        // called when TTS starts — stop the countdown
        ttsActive = true;
        clearTimeout(idleTimer);
        bgAudioUpdate();
      }

      function resumeIdleTimer() {
        // called when TTS ends/stops — restart the countdown
        ttsActive = false;
        resetIdle();
        bgAudioUpdate();
      }

      // reset on any user interaction
      document.addEventListener("touchstart", resetIdle, { passive: true });
      document.addEventListener("mousedown", resetIdle);
      document.addEventListener("touchend", resetIdle, { passive: true });

      // Start background music on first interaction (browser autoplay policy)
      function _bgAudioFirstStart() { BGAudio.start(); }
      document.addEventListener("touchstart", _bgAudioFirstStart, { once: true, passive: true });
      document.addEventListener("mousedown",  _bgAudioFirstStart, { once: true });
      document.addEventListener("click",      _bgAudioFirstStart, { once: true });

      // start the timer immediately when on dashboard
      function startIdleTimer() {
        resetIdle();
      }

      // ── Load data.json ──
      fetch("data.json")
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          DATA = d;
          init();
        })
        .catch(function () {
          alert(
            "Could not load data.json. Make sure both files are in the same folder.",
          );
        });

      function init() {
        _loadAdminPin();
        _loadPresPin();
        apLoadConfig();
        _loadPresFlow();
        buildCityPreview();
        buildGuidePreview();
        buildCity();
        buildGuide();
        buildTimeline();
        buildQuizSelect();
        updateLeaderboardPreview();
        wireButtons();
        wireAdmin();
        // Retry once Firebase module has had time to initialise
        setTimeout(updateLeaderboardPreview, 2500);
        // Handle PWA shortcut URLs (?section=guide, ?section=quiz, etc.)
        var section = new URLSearchParams(window.location.search).get("section");
        if (section) {
          goTo(1, false);
          var _shortcutMap = { guide: "ov-guide", quiz: "ov-quiz", city: "ov-city", timeline: "ov-timeline", leaderboard: "ov-lb" };
          if (_shortcutMap[section]) setTimeout(function () { openOverlay(_shortcutMap[section]); }, 120);
        }
      }

      function g(id) {
        return document.getElementById(id);
      }

      // ── Auto Play ──
      var AP_DEFAULTS = {
        initialWait: 0,
        loop: false,
        steps: [
          { type: "idle",    duration: 5000 },
          { type: "station", id: "aeta-history", waitAfter: 3000 }
        ]
      };

      var AP_SCREENS = [
        { value: "idle",                 label: "Idle Screen"              },
        { value: "dashboard",            label: "Dashboard"                },
        { value: "guide",                label: "Heritage Guide"           },
        { value: "station:aeta-history", label: "Station A — Aeta History" },
        { value: "station:livelihood",   label: "Station B — Livelihood"   },
        { value: "station:music",        label: "Station C — Music"        },
        { value: "station:tools",        label: "Station D — Tools"        },
        { value: "station:values",       label: "Station E — Values"       },
        { value: "station:origins",      label: "Station F — Origins"      },
        { value: "station:naval",        label: "Station G — Naval"        },
        { value: "station:culture",      label: "Station H — Culture"      },
        { value: "timeline",             label: "Timeline"                 },
        { value: "quiz",                 label: "Quiz"                     },
      ];

      var _apState    = "stopped"; // "stopped" | "running" | "paused"
      var _apConfig   = null;
      var _apTimer    = null;
      var _apStepIdx  = 0;
      var _apEndedHandler = null; // ref for station-audio "ended" listener

      function apLoadConfig() {
        try {
          var saved = localStorage.getItem("salin-lahi-ap-config");
          if (saved) { _apConfig = JSON.parse(saved); return; }
        } catch (e) {}
        _apConfig = JSON.parse(JSON.stringify(AP_DEFAULTS));
      }

      function apSaveConfig(obj) {
        _apConfig = obj;
        try { localStorage.setItem("salin-lahi-ap-config", JSON.stringify(obj)); } catch (e) {}
      }

      function _apGetStationId() {
        var step = (_apConfig.steps || []).find(function(s) { return s.type === "station"; });
        if (step && step.id) return step.id;
        return DATA && DATA.sections && DATA.sections[0] ? DATA.sections[0].id : null;
      }

      function apStart() {
        if (_apState === "running" || _apState === "paused") return;
        if (!_apConfig) apLoadConfig();
        _apState = "running";
        _apStepIdx = 0;
        // Close any open overlay (e.g. ov-presentation) before the countdown
        document.querySelectorAll(".overlay.open").forEach(function (ov) { ov.classList.remove("open"); });
        stationAudioStop(); ttsStop();
        goTo(1, true);
        bgAudioUpdate();
        _apShowOverlay(true);
        _apSetStatus("Starting…");
        _apSyncAdminBtns();
        _apUpdateBtn();
        clearTimeout(idleTimer);
        var wait = (_apConfig.initialWait != null) ? _apConfig.initialWait : 5000;
        _apSetStatus("Starting in " + (wait / 1000).toFixed(1).replace(".0","") + "s");
        _apTimer = setTimeout(function () { _apRunStep(0); }, wait);
      }

      function apPause() {
        if (_apState !== "running") return;
        _apState = "paused";
        clearTimeout(_apTimer);
        _apTimer = null;
        var audio = g("station-audio");
        if (audio && !audio.paused) audio.pause();
        _apSetStatus("Paused");
        _apSyncOverlayBtns();
        _apSyncAdminBtns();
      }

      function apResume() {
        if (_apState !== "paused") return;
        _apState = "running";
        _apSyncOverlayBtns();
        _apSyncAdminBtns();
        var step = (_apConfig.steps || [])[_apStepIdx];
        if (step && step.type === "station") {
          // Re-attach ended handler and resume audio
          var audio = g("station-audio");
          if (audio) {
            if (_apEndedHandler) { audio.removeEventListener("ended", _apEndedHandler); }
            _apEndedHandler = _apMakeEndedHandler(_apStepIdx);
            audio.addEventListener("ended", _apEndedHandler);
            audio.play().catch(function () {});
          }
          _apSetStatus("Station: " + (step.id || ""));
        } else {
          // Re-run the current timed step from scratch
          _apRunStep(_apStepIdx);
        }
      }

      function apStop() {
        _apState = "stopped";
        clearTimeout(_apTimer);
        _apTimer = null;
        if (_apEndedHandler) {
          var audio = g("station-audio");
          if (audio) audio.removeEventListener("ended", _apEndedHandler);
          _apEndedHandler = null;
        }
        _apShowOverlay(false);
        document.querySelectorAll(".overlay.open").forEach(function (ov) { ov.classList.remove("open"); });
        stationAudioStop();
        ttsStop();
        goTo(1);
        bgAudioUpdate();
        resetIdle();
        _apUpdateBtn();
        _apSyncAdminBtns();
      }

      function _apMakeEndedHandler(idx) {
        return function () {
          var audio = g("station-audio");
          if (audio) audio.removeEventListener("ended", _apEndedHandler);
          _apEndedHandler = null;
          if (_apState !== "running") return;
          var step = (_apConfig.steps || [])[idx];
          var waitAfter = (step && step.waitAfter != null) ? step.waitAfter : 3000;
          _apTimer = setTimeout(function () { _apRunStep(idx + 1); }, waitAfter);
        };
      }

      function _apRunStep(idx) {
        if (_apState !== "running") return;
        clearTimeout(_apTimer);
        var steps = _apConfig.steps || [];
        if (idx >= steps.length) {
          apStop();
          return;
        }
        _apStepIdx = idx;
        var step = steps[idx];

        function advance() { _apRunStep(idx + 1); }

        if (step.type === "idle") {
          document.querySelectorAll(".overlay.open").forEach(function (ov) { ov.classList.remove("open"); });
          stationAudioStop(); ttsStop();
          goTo(0, true);
          _apSetStatus("Idle Screen");
          _apTimer = setTimeout(advance, step.duration || 1000);

        } else if (step.type === "dashboard") {
          document.querySelectorAll(".overlay.open").forEach(function (ov) { ov.classList.remove("open"); });
          stationAudioStop(); ttsStop();
          goTo(1, true);
          _apSetStatus("Dashboard");
          _apTimer = setTimeout(advance, step.duration || 300);

        } else if (step.type === "guide") {
          stationAudioStop(); ttsStop();
          goTo(1, true);
          document.querySelectorAll(".overlay.open").forEach(function (ov) { if (ov.id !== "ov-guide") ov.classList.remove("open"); });
          g("ov-guide").classList.add("open");
          bgAudioUpdate();
          _apSetStatus("Heritage Guide");
          _apTimer = setTimeout(advance, step.duration || 300);

        } else if (step.type === "station") {
          var sectionId = step.id || _apGetStationId();
          if (!sectionId) { advance(); return; }
          // Close ALL open overlays before navigating — prevents stale timeline/quiz/etc. bleeding through
          document.querySelectorAll(".overlay.open").forEach(function (ov) { ov.classList.remove("open"); });
          stationAudioStop(); ttsStop();
          goTo(1, true);
          openSection(sectionId);
          _apSetStatus("Station: " + sectionId);
          var audio = g("station-audio");
          if (audio) {
            if (_apEndedHandler) audio.removeEventListener("ended", _apEndedHandler);
            _apEndedHandler = _apMakeEndedHandler(idx);
            audio.addEventListener("ended", _apEndedHandler);
          }

        } else if (step.type === "timeline") {
          stationAudioStop(); ttsStop();
          goTo(1, true);
          document.querySelectorAll(".overlay.open").forEach(function (ov) { ov.classList.remove("open"); });
          openOverlay("ov-timeline");
          _apSetStatus("Timeline");
          _apTimer = setTimeout(advance, step.duration || 1000);

        } else if (step.type === "quiz") {
          stationAudioStop(); ttsStop();
          goTo(1, true);
          document.querySelectorAll(".overlay.open").forEach(function (ov) { ov.classList.remove("open"); });
          resetQuizSelect();
          openOverlay("ov-quiz");
          _apSetStatus("Quiz");
          _apTimer = setTimeout(advance, step.duration || 1000);

        } else if (step.type === "wait") {
          _apSetStatus("Waiting…");
          _apTimer = setTimeout(advance, step.duration || 1000);
        }
      }

      function _apShowOverlay(show) {
        var el = g("ap-overlay");
        if (!el) return;
        el.style.display = show ? "flex" : "none";
      }

      function _apSetStatus(text) {
        var el = g("ap-status-text");
        if (el) el.textContent = "Presentation — " + text;
        var adminEl = g("ap-admin-status");
        if (adminEl) { adminEl.textContent = text; adminEl.className = "settings-msg ok"; }
      }

      function _apSyncOverlayBtns() {
        var pause  = g("ap-pause-btn");
        var resume = g("ap-resume-btn");
        if (pause)  pause.style.display  = _apState === "running" ? "" : "none";
        if (resume) resume.style.display = _apState === "paused"  ? "" : "none";
      }

      function _apSyncAdminBtns() {
        var startBtn  = g("ap-admin-start-btn");
        var pauseBtn  = g("ap-admin-pause-btn");
        var resumeBtn = g("ap-admin-resume-btn");
        var stopBtn   = g("ap-admin-stop-btn");
        var running   = _apState === "running";
        var paused    = _apState === "paused";
        var active    = running || paused;
        if (startBtn)  startBtn.disabled  = active;
        if (pauseBtn)  { pauseBtn.disabled = !running; pauseBtn.style.display = paused ? "none" : ""; }
        if (resumeBtn) { resumeBtn.disabled = !paused;  resumeBtn.style.display = paused ? "" : "none"; }
        if (stopBtn)   stopBtn.disabled  = !active;
      }

      function _apUpdateBtn() {
        var btn = g("btn-autoplay");
        if (!btn) return;
        var active = _apState === "running" || _apState === "paused";
        btn.innerHTML = active
          ? '<span class="material-symbols-outlined" style="font-size:16px">stop_circle</span> Stop'
          : '<span class="material-symbols-outlined" style="font-size:16px">slideshow</span> Auto Play';
        btn.style.color       = active ? "#bd001a" : "#1a6e3a";
        btn.style.borderColor = active ? "#bd001a" : "#a8a9ad";
      }

      // ── Flow Builder helpers ──

      function _apStepToScreenVal(step) {
        if (step.type === "station") return "station:" + (step.id || "aeta-history");
        return step.type;
      }

      function _apStepWaitSec(step) {
        if (step.type === "station") return Math.round((step.waitAfter || 0) / 1000);
        return Math.round((step.duration || 0) / 1000);
      }

      function _apScreenToStep(screenVal, waitSec) {
        if (screenVal.startsWith("station:")) {
          return { type: "station", id: screenVal.split(":")[1], waitAfter: waitSec * 1000 };
        }
        return { type: screenVal, duration: waitSec * 1000 };
      }

      function _apOptionsHTML(selectedVal) {
        return AP_SCREENS.map(function (s) {
          return '<option value="' + s.value + '"' + (s.value === selectedVal ? " selected" : "") + '>' + s.label + '</option>';
        }).join("");
      }

      function _apMakeStepRow(step, idx, total) {
        var screenVal = _apStepToScreenVal(step);
        var waitSec   = _apStepWaitSec(step);
        var isStation = step.type === "station";
        var div = document.createElement("div");
        div.className = "ap-step-row";
        div.setAttribute("data-idx", idx);
        div.style.cssText = "display:flex;align-items:center;gap:8px;background:#f8f9fb;border:1.5px solid #e2e5ec;border-radius:12px;padding:10px 12px;flex-wrap:wrap;transition:border-color 0.15s";
        div.innerHTML =
          '<span style="font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:11px;color:#aaa;min-width:20px;text-align:center">' + (idx + 1) + '</span>' +
          '<select class="ap-step-screen" style="flex:1;min-width:160px;padding:8px 10px;border-radius:8px;border:1.5px solid #d0d4df;font-family:\'Space Grotesk\',sans-serif;font-size:13px;font-weight:600;background:#fff;cursor:pointer">' +
            _apOptionsHTML(screenVal) +
          '</select>' +
          '<span style="font-family:\'Space Grotesk\',sans-serif;font-size:12px;color:#888;white-space:nowrap">⏱ ' + (isStation ? "wait after" : "stay for") + '</span>' +
          '<input type="number" class="ap-step-wait" min="0" max="9999" value="' + waitSec + '" style="width:64px;padding:8px 8px;border-radius:8px;border:1.5px solid #d0d4df;font-family:\'Space Grotesk\',sans-serif;font-size:13px;font-weight:700;text-align:center">' +
          '<span style="font-family:\'Space Grotesk\',sans-serif;font-size:12px;color:#888">sec</span>' +
          '<button class="ap-step-up" title="Move up" style="width:30px;height:30px;border-radius:8px;border:1.5px solid #d0d4df;background:#fff;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;' + (idx === 0 ? "opacity:0.3;pointer-events:none" : "") + '">↑</button>' +
          '<button class="ap-step-down" title="Move down" style="width:30px;height:30px;border-radius:8px;border:1.5px solid #d0d4df;background:#fff;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;' + (idx === total - 1 ? "opacity:0.3;pointer-events:none" : "") + '">↓</button>' +
          '<button class="ap-step-remove" title="Remove step" style="width:30px;height:30px;border-radius:8px;border:1.5px solid #f0b0b0;background:#fff6f6;color:#bd001a;cursor:pointer;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center">×</button>';

        // Update label when screen changes
        div.querySelector(".ap-step-screen").onchange = function () {
          var isS = this.value.startsWith("station:");
          var label = div.querySelector("span:nth-child(3)");
          if (label) label.textContent = "⏱ " + (isS ? "wait after" : "stay for");
        };
        div.querySelector(".ap-step-up").onclick = function () { _apMoveStep(idx, -1); };
        div.querySelector(".ap-step-down").onclick = function () { _apMoveStep(idx, 1); };
        div.querySelector(".ap-step-remove").onclick = function () { _apRemoveStep(idx); };
        return div;
      }

      function _apReadFlowFromUI() {
        var countdown = parseInt((g("ap-countdown-input") || {}).value || "0", 10) || 0;
        var list = g("ap-steps-list");
        var rows = list ? list.querySelectorAll(".ap-step-row") : [];
        var steps = [];
        rows.forEach(function (row) {
          var screenEl = row.querySelector(".ap-step-screen");
          var waitEl   = row.querySelector(".ap-step-wait");
          var screenVal = screenEl ? screenEl.value : "idle";
          var waitSec   = parseInt(waitEl ? waitEl.value : "0", 10) || 0;
          steps.push(_apScreenToStep(screenVal, waitSec));
        });
        return { initialWait: countdown * 1000, loop: false, steps: steps };
      }

      function _apBuildFlowUI() {
        if (!_apConfig) apLoadConfig();
        var countdownEl = g("ap-countdown-input");
        if (countdownEl) countdownEl.value = Math.round((_apConfig.initialWait || 0) / 1000);
        var list = g("ap-steps-list");
        if (!list) return;
        list.innerHTML = "";
        var steps = _apConfig.steps || [];
        steps.forEach(function (step, idx) {
          list.appendChild(_apMakeStepRow(step, idx, steps.length));
        });
        _apBuildNavGrid();
      }

      function _apRemoveStep(idx) {
        var config = _apReadFlowFromUI();
        config.steps.splice(idx, 1);
        _apConfig = config;
        _apBuildFlowUI();
      }

      function _apMoveStep(idx, dir) {
        var config = _apReadFlowFromUI();
        var steps = config.steps;
        var newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= steps.length) return;
        var tmp = steps[idx]; steps[idx] = steps[newIdx]; steps[newIdx] = tmp;
        _apConfig = config;
        _apBuildFlowUI();
      }

      function _apBuildNavGrid() {
        var grid = g("ap-nav-grid");
        if (!grid) return;
        grid.innerHTML = "";
        var colors = {
          idle:      { bg: "#f0f0f0", color: "#444",    border: "#d0d0d0" },
          dashboard: { bg: "#e8eeff", color: "#1a3488",  border: "#b0bce8" },
          guide:     { bg: "#e8eeff", color: "#1a3488",  border: "#b0bce8" },
          station:   { bg: "#e8f5ee", color: "#1a6e3a",  border: "#a0d4b0" },
          timeline:  { bg: "#fff8e0", color: "#7a5800",  border: "#e8d080" },
          quiz:      { bg: "#f0e8ff", color: "#5a1a8a",  border: "#c0a0e0" },
        };
        AP_SCREENS.forEach(function (screen) {
          var category = screen.value.startsWith("station:") ? "station" : screen.value;
          var c = colors[category] || colors.idle;
          var btn = document.createElement("button");
          btn.textContent = screen.label;
          btn.title = "Navigate to " + screen.label;
          btn.style.cssText = "background:" + c.bg + ";color:" + c.color + ";border:1.5px solid " + c.border + ";border-radius:10px;padding:10px 12px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:12px;letter-spacing:0.04em;cursor:pointer;text-align:left;transition:all 0.15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
          btn.onclick = function () { apNavigateTo(screen.value); };
          grid.appendChild(btn);
        });
      }

      function apNavigateTo(screenVal) {
        if (screenVal === "idle") {
          document.querySelectorAll(".overlay.open").forEach(function (ov) { ov.classList.remove("open"); });
          stationAudioStop(); ttsStop();
          goTo(0, true);
        } else if (screenVal === "dashboard") {
          document.querySelectorAll(".overlay.open").forEach(function (ov) { ov.classList.remove("open"); });
          stationAudioStop(); ttsStop();
          goTo(1, true);
        } else if (screenVal === "guide") {
          goTo(1, true);
          document.querySelectorAll(".overlay.open").forEach(function (ov) { if (ov.id !== "ov-guide") ov.classList.remove("open"); });
          g("ov-guide").classList.add("open");
        } else if (screenVal.startsWith("station:")) {
          var sId = screenVal.split(":")[1];
          goTo(1, true);
          if (!g("ov-guide").classList.contains("open")) g("ov-guide").classList.add("open");
          openSection(sId);
        } else if (screenVal === "timeline") {
          goTo(1, true);
          document.querySelectorAll(".overlay.open").forEach(function (ov) { ov.classList.remove("open"); });
          openOverlay("ov-timeline");
          setTimeout(function () {
            var car = g("tl-carousel");
            if (!car) return;
            tlAudioToggle(Math.round(car.scrollLeft / car.clientWidth));
          }, 120);
        } else if (screenVal === "quiz") {
          goTo(1, true);
          document.querySelectorAll(".overlay.open").forEach(function (ov) { ov.classList.remove("open"); });
          resetQuizSelect();
          openOverlay("ov-quiz");
        }
        bgAudioUpdate();
        resetIdle();
        closeOverlay("ov-admin");
      }

      // ── Wire buttons ──
      function wireButtons() {
        g("btn-city").onclick = function () {
          openOverlay("ov-city");
        };
        g("btn-guide").onclick = function () {
          openOverlay("ov-guide");
        };
        g("btn-quiz").onclick = function () {
          resetQuizSelect();
          openOverlay("ov-quiz");
        };
        g("btn-timeline").onclick = function () {
          openOverlay("ov-timeline");
          // Auto-play whichever slide is currently showing
          setTimeout(function () {
            var car = g("tl-carousel");
            if (!car) return;
            var idx = Math.round(car.scrollLeft / car.clientWidth);
            tlAudioToggle(idx);
          }, 120);
        };
        g("btn-lb").onclick = async function () {
          openOverlay("ov-lb");
          await buildLeaderboard();
        };
        g("btn-mute").onclick = BGAudio.toggleMute;
        g("ap-pause-btn").onclick  = apPause;
        g("ap-resume-btn").onclick = apResume;
        g("ap-stop-btn").onclick   = apStop;
        g("q-next").onclick = nextQ;
        g("save-btn").onclick = saveScore;
        g("skip-btn").onclick = function () {
          closeOverlay("ov-quiz");
        };
        g("quiz-back-btn").onclick = function () {
          closeOverlay("ov-quiz");
        };
        g("btn-go-idle").onclick = function () {
          clearTimeout(idleTimer);
          goTo(0);
        };
      }

      // ── City preview on dashboard tile ──
      function buildCityPreview() {
        var c = DATA.city;
        g("city-preview").textContent =
          c.province + " · " + c.region + " · Pop. " + c.population;
      }

      function buildGuidePreview() {
        g("guide-preview").textContent =
          DATA.sections.length +
          " cultural topics — from the Aeta to the Smart City era.";
      }

      // ── City Overview ──
      function _cityMayorInitials(name) {
        var words = (name || "").split(" ").filter(function (w) {
          return w && !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w) && !/^[a-z]\.?$/i.test(w);
        });
        if (!words.length) return "?";
        var first = words[0][0];
        var last = words.length > 1 ? words[words.length - 1][0] : "";
        return (first + last).toUpperCase();
      }

      // ── City Stat Modal ──
      var CITY_STATS = {
        mayor: {
          bg: "#1a3488", text: "#fff", accent: "#fcd400", shadow: "#0e1f52",
          emoji: "🏛️", title: "City Mayor", sub: "Rolen C. Paulino Jr.",
body: "The mayor is like the <strong>captain</strong> of the whole city! Mayor <strong>Rolen C. Paulino Jr.</strong> leads Olongapo and makes important decisions to help the city grow and improve. Think of the mayor as a school principal... but for <em>the entire city</em>! 🏛️ He is currently serving his second consecutive term after winning re-election in 2025 and was recognized in 2026 as one of Central Luzon’s top-performing city mayors."        },
        population: {
          bg: "#bd001a", text: "#fff", accent: "#fcd400", shadow: "#7a0011",
          emoji: "👥", title: "Population", sub: "233,000+ people",
          body: "More than <strong>233,000 people</strong> call Olongapo home! 🤯 To help you picture that — if you filled the biggest indoor arena in the Philippines (about 20,000 seats) over and over again, you'd need <strong>more than 11 arenas</strong> packed full of people just to fit everyone who lives here. With that many neighbors, there's always something exciting happening somewhere in the city!"
        },
        barangays: {
          bg: "#fcd400", text: "#221b00", accent: "#bd001a", shadow: "#9a8000",
          emoji: "🏘️", title: "Barangays", sub: "17 neighborhoods",
          body: "A <strong>barangay</strong> is like a neighborhood with its very own mini-government and a leader called a <em>Barangay Captain</em>! Olongapo City is divided into <strong>17 barangays</strong> — each with its own community, its own character, and its own little story. Think of it like <strong>17 mini-villages</strong> all teaming up to build one amazing city together! 🤝 Which barangay are you from?"
        },
        founded: {
          bg: "#2e54c2", text: "#fff", accent: "#fcd400", shadow: "#1a3488",
          emoji: "🎂", title: "Founded", sub: "June 1, 1966",
          body: "On <strong>June 1, 1966</strong>, a special law called <em>Republic Act No. 4645</em> officially made Olongapo an independent chartered city! Before that, it was just a small municipality. It's like a kid finally growing up and going independent! 🎉 Every year on June 1st, Olongapo celebrates its <strong>City Founding Anniversary</strong> — so the city has already had more than <strong>58 birthday parties!</strong>"
        },
        area: {
          bg: "#ffffff", text: "#1b1c1b", accent: "#bd001a", shadow: "#c0c0c0",
          emoji: "🗺️", title: "City Area", sub: "104.53 sq km",
          body: "Olongapo stretches across <strong>104.53 square kilometers</strong> of land — that's about the size of <strong>14,600 full-size basketball courts</strong> laid side by side! 🏀 The city runs from lush green mountains in the west all the way to the sparkling shores of <em>Subic Bay</em> in the east. Lots of space for adventures, discoveries, and lots of amazing people!"
        },
        region: {
          bg: "#2e54c2", text: "#fff", accent: "#fcd400", shadow: "#1a3488",
          emoji: "🌏", title: "Region III", sub: "Central Luzon",
          body: "<strong>Central Luzon</strong> (Region III) is a group of <strong>7 provinces</strong> in the heart of Luzon island — Aurora, Bataan, Bulacan, Nueva Ecija, Pampanga, Tarlac, and Zambales. Olongapo City is in Zambales, which is part of this region! Central Luzon is nicknamed the <em>\"Rice Granary of the Philippines\"</em> 🌾 because it grows so much of the country's food supply. Go Region III! 💪"
        },
        province: {
          bg: "#fcd400", text: "#221b00", accent: "#bd001a", shadow: "#9a8000",
          emoji: "🌋", title: "Province", sub: "Zambales",
          body: "<strong>Zambales</strong> is the province where Olongapo City calls home! It stretches along the west coast of Luzon, right beside the beautiful <em>South China Sea</em> 🌊. Zambales is famous for its stunning beaches 🏖️, sweet mango farms 🥭, and the mighty <strong>Mount Pinatubo</strong> — one of the most famous volcanoes in the entire world! Olongapo runs its own city government, but it still proudly calls Zambales its home province."
        }
      };

      function showCityStat(key) {
        var s = CITY_STATS[key];
        if (!s) return;
        pauseIdleTimer();
        var modal = document.getElementById("city-stat-modal");
        var box   = modal.querySelector(".csm-box");
        box.style.background = s.bg;
        box.style.color      = s.text;
        box.querySelector(".csm-rule").style.background = s.accent;
        var btn = box.querySelector(".csm-close-btn");
        btn.style.background = s.accent;
        btn.style.color      = s.accent === "#fcd400" ? "#221b00" : "#fff";
        btn.style.boxShadow  = "0 4px 0 " + s.shadow;
        box.querySelector(".csm-emoji").textContent = s.emoji;
        box.querySelector(".csm-title").textContent = s.title;
        box.querySelector(".csm-sub").textContent   = s.sub;
        box.querySelector(".csm-body").innerHTML    = s.body;
        modal.classList.add("open");
      }

      function closeCityStat() {
        document.getElementById("city-stat-modal").classList.remove("open");
        resumeIdleTimer();
      }

      function openIndigModal() {
        var m = g("indig-modal");
        if (m) m.style.display = "flex";
        pauseIdleTimer();
      }
      function closeIndigModal() {
        var m = g("indig-modal");
        if (m) m.style.display = "none";
        resumeIdleTimer();
      }
      function toggleIndmCard(card) {
        var body = card.querySelector(".indm-type-body");
        var chevron = card.querySelector(".indm-chevron");
        var open = card.classList.toggle("indm-open");
        if (body) body.style.maxHeight = open ? body.scrollHeight + "px" : "0";
        if (chevron) chevron.style.transform = open ? "rotate(180deg)" : "";
      }

      function buildCity() {
        var c = DATA.city;
        var regionParts = (c.region || "").split("—");
        var regionRoman = (regionParts[0] || "").replace(/region/i, "").trim();
        var regionName = (regionParts[1] || "").trim();
        var areaParts = (c.area || "").split(" ");
        var areaNum = areaParts[0] || c.area;
        var areaUnit = areaParts.slice(1).join(" ");
        var foundedMatch = (c.founded || "").match(/\d{4}/);
        var foundedYear = foundedMatch ? foundedMatch[0] : c.founded;

        var html = "";
        html += '<div class="cty-root">';
        html += '<div class="cty-main">';

        // Hero
        html += '<div class="cty-hero">';
        html +=
          '<img src="assets/homepage/ulo-ng-apo.jpg" alt="' + c.name + '">';
        html += '<div class="cty-hero-grad"><div>';
        html +=
          '<div class="cty-hero-badge">🇵🇭 Independent Chartered City</div>';
        html += '<div class="cty-hero-title">' + c.name + "</div>";
        html +=
          '<div class="cty-hero-sub">' +
          c.province +
          " &middot; " +
          c.region +
          "</div></div>";
        html +=
          '<div class="cty-hero-loc"><span class="material-symbols-outlined">location_on</span> Subic Bay, Philippines</div>';
        html += "</div></div>";

        // Bottom row: About / Quick Facts / Map + Mayor
        html += '<div class="cty-bottom">';

        html += '<div class="cty-card cty-about">';
        html += '<div class="cty-about-label">About ' + c.name + "</div>";
        html += '<div class="cty-about-text">' + c.description + "</div>";
        html += "</div>";

        html += '<div class="cty-card cty-facts">';
        html +=
          '<div class="cty-facts-title"><span class="material-symbols-outlined">checklist</span> Quick Facts</div>';
        html += '<div class="cty-facts-list">';
        var facts = [
          ["Founded", c.founded],
          ["Province", c.province],
          ["Region", c.region],
          ["Area", c.area],
          ["City Type", "Independent"],
          ["Mayor", c.mayor],
        ];
        facts.forEach(function (f) {
          html +=
            '<div class="cty-fact-row"><span class="cty-fact-k">' +
            f[0] +
            '</span><span class="cty-fact-v">' +
            f[1] +
            "</span></div>";
        });
        html += "</div></div>";

        html += '<div class="cty-mapcol">';
        html += '<div class="cty-card cty-maptile">';
        html +=
          '<div class="cty-maptile-title"><span class="material-symbols-outlined">map</span> Location</div>';
        html +=
          '<div class="cty-map-img-wrap"><img src="assets/map.png" alt="Map of ' +
          c.name +
          '"></div>';
        html +=
          '<div class="cty-maptile-loc"><span class="material-symbols-outlined">location_on</span> Central Luzon</div>';
        html += "</div>";
        html += '<div class="cty-mayor-card" onclick="showCityStat(\'mayor\')">';
        html +=
          '<div class="cty-mayor-avatar">' +
          _cityMayorInitials(c.mayor) +
          "</div>";
        html +=
          '<div><div class="cty-mayor-label">City Mayor</div><div class="cty-mayor-name">' +
          c.mayor +
          "</div></div>";
        html += "</div></div>"; // mayor-card, mapcol

        html += "</div>"; // cty-bottom
        html += "</div>"; // cty-main

        // Sidebar stat tiles
        html += '<div class="cty-sidebar">';
        html +=
          '<div class="cty-stat cty-stat-red" onclick="showCityStat(\'population\')"><div class="cty-stat-icon"><span class="material-symbols-outlined">groups</span></div><div class="cty-stat-val">' +
          c.population +
          '</div><div class="cty-stat-lbl">Population</div></div>';
        html +=
          '<div class="cty-stat cty-stat-yellow" onclick="showCityStat(\'barangays\')"><div class="cty-stat-icon"><span class="material-symbols-outlined">location_city</span></div><div class="cty-stat-val">' +
          c.barangays +
          '</div><div class="cty-stat-lbl">Barangays</div></div>';
        html +=
          '<div class="cty-stat cty-stat-blue" onclick="showCityStat(\'founded\')"><div class="cty-stat-icon"><span class="material-symbols-outlined">event</span></div><div class="cty-stat-val">' +
          foundedYear +
          '</div><div class="cty-stat-lbl">Founded</div></div>';
        html +=
          '<div class="cty-stat cty-stat-white" onclick="showCityStat(\'area\')"><div class="cty-stat-icon"><span class="material-symbols-outlined">map</span></div><div class="cty-stat-val cty-stat-val-sm">' +
          areaNum +
          '</div><div class="cty-stat-lbl">' +
          areaUnit +
          "</div></div>";
        html +=
          '<div class="cty-stat cty-stat-navy" onclick="showCityStat(\'region\')"><div class="cty-stat-region">Region</div><div class="cty-stat-val">' +
          regionRoman +
          '</div><div class="cty-stat-lbl">' +
          regionName +
          "</div></div>";
        html +=
          '<div class="cty-stat cty-stat-yellow" onclick="showCityStat(\'province\')"><div class="cty-stat-icon"><span class="material-symbols-outlined">flag</span></div><div class="cty-stat-val cty-stat-val-sm">' +
          c.province +
          '</div><div class="cty-stat-lbl">Province</div></div>';
        html += "</div>"; // cty-sidebar

        html += "</div>"; // cty-root
        g("city-body").innerHTML = html;
      }

      // ── Heritage Guide ──
      var COLORS = [
        "#FAEE04", // A — Aeta History
        "#9D231E", // B — Traditional Livelihood
        "#4262AD", // C — Indigenous Music
        "#18A549", // D — Traditional Tools
        "#55C8F4", // E — Cultural Values
        "#B64499", // F — Olongapo Origins
        "#E1E1E1", // G — Naval Heritage
        "#FFD400", // H — People & Local Culture
      ];
      function buildGuide() {
        var html = "";
        DATA.sections.forEach(function (s, i) {
          var c = COLORS[i % COLORS.length];
          var preview = s.content.split("\n\n")[0].substring(0, 90) + "...";
          html += '<div class="exp-card-wrap" style="background:' + c + '">';
          html += '<div class="exp-card" data-id="' + s.id + '">';
          html +=
            '<div class="exp-card-stripe" style="background:#fff"></div>';
          html += '<div class="exp-card-inner">';
          html +=
            '<div class="exp-card-icon" style="background:#fff;color:#555">' +
            sectionEmoji(s.id) +
            "</div>";
          html += '<div class="exp-card-body">';
          html +=
            '<div class="exp-card-station" style="color:#555">' +
            s.station +
            "</div>";
          html += '<div class="exp-card-title">' + s.title + "</div>";
          html += '<div class="exp-card-preview">' + preview + "</div>";
          html += "</div></div>";
          html +=
            '<div class="exp-card-footer"><span class="exp-card-cta">Read More</span><span class="exp-card-arrow">›</span></div></div></div>';
        });
        g("guide-body").innerHTML = html;
        g("guide-body")
          .querySelectorAll(".exp-card")
          .forEach(function (card) {
            card.onclick = function () {
              openSection(this.getAttribute("data-id"));
            };
          });
      }

      // ── Per-station fun fact styles ──
      var FF_STYLES = {
        "aeta-history": [
          { bg:"#EBF5FB", border:"#C5DCF0", iBg:"rgba(41,128,185,0.15)", iColor:"#2471A3", tColor:"#1A5276",
            svg:'<line x1="12" y1="2" x2="12" y2="22"/><path d="M2 7l5 5-5 5"/><path d="M22 7l-5 5 5 5"/><path d="M7 2l5 5 5-5"/><path d="M7 22l5-5 5 5"/>' },
          { bg:"#EAFAF1", border:"#ABECC6", iBg:"rgba(39,174,96,0.15)", iColor:"#1E8449", tColor:"#1A5E37",
            svg:'<path d="M17 8C8 10 5.9 16.17 3.82 22h.06c6.02.05 16.02-2.98 14.92-15z"/><path d="M17 8h.5c1.38 0 2.5 1.12 2.5 2.5v.5"/>' }
        ],
        "livelihood": [
          { bg:"#F4ECF7", border:"#D7BDE2", iBg:"rgba(142,68,173,0.15)", iColor:"#8E44AD", tColor:"#6C3483",
            svg:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
          { bg:"#FEF9E7", border:"#FAD7A0", iBg:"rgba(230,126,34,0.15)", iColor:"#E67E22", tColor:"#B7770D",
            svg:'<path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v10"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>' }
        ],
        "music": [
          { bg:"#EBF5FB", border:"#C5DCF0", iBg:"rgba(36,113,163,0.15)", iColor:"#2471A3", tColor:"#1A5276",
            svg:'<path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/>' },
          { bg:"#F4ECF7", border:"#D7BDE2", iBg:"rgba(142,68,173,0.15)", iColor:"#8E44AD", tColor:"#6C3483",
            svg:'<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>' }
        ],
        "tools": [
          { bg:"#EBF5FB", border:"#A9D2ED", iBg:"rgba(26,82,118,0.15)", iColor:"#1A5276", tColor:"#154360",
            svg:'<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>' },
          { bg:"#FEF5E7", border:"#FAD4A8", iBg:"rgba(211,84,0,0.15)", iColor:"#CA6F1E", tColor:"#935116",
            svg:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' }
        ],
        "values": [
          { bg:"#EAFAF1", border:"#ABECC6", iBg:"rgba(39,174,96,0.15)", iColor:"#1E8449", tColor:"#1A5E37",
            svg:'<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>' },
          { bg:"#FEF9E7", border:"#FAD7A0", iBg:"rgba(230,126,34,0.15)", iColor:"#D4AC0D", tColor:"#9A7D0A",
            svg:'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' }
        ],
        "origins": [
          { bg:"#FDEDEC", border:"#F5B7B1", iBg:"rgba(192,21,46,0.15)", iColor:"#C0152E", tColor:"#922B21",
            svg:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
          { bg:"#EBF5FB", border:"#A9D2ED", iBg:"rgba(26,82,118,0.15)", iColor:"#1A5276", tColor:"#154360",
            svg:'<circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/>' }
        ],
        "naval": [
          { bg:"#EAFAF1", border:"#ABECC6", iBg:"rgba(39,174,96,0.15)", iColor:"#1E8449", tColor:"#1A5E37",
            svg:'<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>' },
          { bg:"#FEF9E7", border:"#FAD7A0", iBg:"rgba(200,151,58,0.15)", iColor:"#B7860B", tColor:"#9A7D0A",
            svg:'<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' }
        ],
        "culture": [
          { bg:"#FEF9E7", border:"#FAD7A0", iBg:"rgba(200,151,58,0.15)", iColor:"#B7860B", tColor:"#9A7D0A",
            svg:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
          { bg:"#FDEDEC", border:"#F5B7B1", iBg:"rgba(192,21,46,0.15)", iColor:"#C0152E", tColor:"#922B21",
            svg:'<circle cx="12" cy="12" r="10"/><path d="M12 8l-4 4 4 4"/><path d="M16 12H8"/>' }
        ]
      };

      // ── Carousel state ──
      var _carouselTimer = null;
      var _carouselImages = [];
      var _carouselIdx = 0;

      function getStationImages(s) {
        if (!s.photo_url) return [];
        var base = s.photo_url.replace(/(\d+)\.\w+$/, "");
        var ext = s.photo_url.match(/\.\w+$/)[0];
        return [1,2,3,4,5].map(function(n){ return base + n + ext; });
      }

      function stopCarousel() {
        if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
      }

      function _setCarouselSlide(idx, fade) {
        _carouselIdx = idx;
        var img = g("detail-img");
        var dots = g("detail-hero-dots");
        if (!img) return;
        if (fade) {
          img.style.opacity = "0";
          setTimeout(function () {
            img.src = _carouselImages[idx];
            img.style.opacity = "1";
          }, 420);
        } else {
          img.src = _carouselImages[idx];
          img.style.opacity = _carouselImages[idx] ? "1" : "0";
        }
        if (dots) {
          var els = dots.querySelectorAll(".hs-hero-dot");
          for (var i = 0; i < els.length; i++) {
            els[i].classList.toggle("active", i === idx);
          }
        }
      }

      function startCarousel(images) {
        stopCarousel();
        _carouselImages = images || [];
        var img = g("detail-img");
        var dots = g("detail-hero-dots");
        if (!_carouselImages.length) {
          if (img) { img.src = ""; img.style.opacity = "0"; }
          if (dots) dots.innerHTML = "";
          return;
        }
        if (dots) {
          dots.innerHTML = "";
          _carouselImages.forEach(function (_, i) {
            var d = document.createElement("button");
            d.className = "hs-hero-dot" + (i === 0 ? " active" : "");
            d.setAttribute("aria-label", "Image " + (i + 1));
            (function (idx) {
              d.onclick = function () { _setCarouselSlide(idx, false); };
            }(i));
            dots.appendChild(d);
          });
        }
        _setCarouselSlide(0, false);
        if (_carouselImages.length > 1) {
          _carouselTimer = setInterval(function () {
            _setCarouselSlide((_carouselIdx + 1) % _carouselImages.length, true);
          }, 4000);
        }
      }

      function applyFFStyles(stationId) {
        var styles = FF_STYLES[stationId];
        if (!styles) return;
        function applyOne(cardId, iconId, titleId, s) {
          var card = g(cardId), icon = g(iconId), title = g(titleId);
          if (card) { card.style.background = s.bg; card.style.borderColor = s.border; }
          if (icon) {
            icon.style.background = s.iBg;
            icon.style.color = s.iColor;
            icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + s.svg + '</svg>';
          }
          if (title) title.style.color = s.tColor;
        }
        applyOne("detail-ff1-card", "detail-ff1-icon", "detail-ff1-title", styles[0]);
        applyOne("detail-ff2-card", "detail-ff2-icon", "detail-ff2-title", styles[1]);
      }

      function sectionEmoji(id) {
        var map = {
          "aeta-history": "🏹",
          livelihood:     "🎋",
          music:          "🎵",
          tools:          "🏹",
          values:         "❤️",
          origins:        "🏛️",
          naval:          "⚓",
          culture:        "🎉",
        };
        return map[id] || "📖";
      }

      function openSection(id) {
        var s = DATA.sections.find(function (x) {
          return x.id === id;
        });
        currentSection = s;

        // Station badges
        var stationLabel = s.station || "";
        g("detail-station-badge").textContent = stationLabel;
        g("detail-about-badge").textContent = stationLabel;

        // Titles
        g("detail-title").textContent = s.title;
        g("detail-about-title").textContent = s.title;

        // Hero carousel
        startCarousel(getStationImages(s));

        // Main content text
        g("detail-text").textContent = s.content;

        // Indigenous Culture block — only for Station A
        var indigBlock = g("detail-indig-block");
        if (indigBlock) indigBlock.style.display = id === "aeta-history" ? "block" : "none";

        // Fun facts
        var ff = s.fun_facts || [];
        g("detail-ff1-title").textContent = ff[0] ? ff[0].title : "";
        g("detail-ff1-text").textContent  = ff[0] ? ff[0].text  : "";
        g("detail-ff2-title").textContent = ff[1] ? ff[1].title : "";
        g("detail-ff2-text").textContent  = ff[1] ? ff[1].text  : "";
        applyFFStyles(s.id);

        // Reset audio bar
        var seekBar = g("detail-audio-seek");
        if (seekBar) { seekBar.value = 0; seekBar.style.setProperty("--p", "0%"); }
        g("detail-audio-time").textContent = "0:00";
        _setListenBtnState("paused");

        // Load audio file
        var audio = g("station-audio");
        audio.src = s.audio || "";
        audio.currentTime = 0;

        audio.onplay = function () {
          pauseIdleTimer();
          _setListenBtnState("playing");
        };
        audio.onpause = function () {
          resumeIdleTimer();
          _setListenBtnState("paused");
        };
        audio.onended = function () {
          resumeIdleTimer();
          var sb = g("detail-audio-seek");
          if (sb) { sb.value = 0; sb.style.setProperty("--p", "0%"); }
          g("detail-audio-time").textContent = "0:00";
          _setListenBtnState("paused");
        };
        audio.ontimeupdate = function () {
          if (audio.duration) {
            var pct = (audio.currentTime / audio.duration) * 100;
            var sb = g("detail-audio-seek");
            if (sb) { sb.value = pct; sb.style.setProperty("--p", pct + "%"); }
            g("detail-audio-time").textContent = _fmtTime(audio.currentTime);
          }
        };

        // Wire seek slider
        var seekEl = g("detail-audio-seek");
        if (seekEl) {
          seekEl.oninput = function () {
            if (audio.duration) {
              audio.currentTime = (seekEl.value / 100) * audio.duration;
            }
          };
        }

        // Wire play/stop buttons
        g("detail-listen-btn").onclick = stationAudioToggle;
        g("detail-mini-play").onclick   = stationAudioToggle;

        // Quiz button
        g("detail-quiz-btn").onclick = function () {
          stationAudioStop();
          closeOverlay("ov-detail");
          resetQuizSelect();
          startQuiz(s.id);
          openOverlay("ov-quiz");
        };

        closeOverlay("ov-guide");
        openOverlay("ov-detail");
        showToast("Station: " + s.station);

        // Auto-play audio (gracefully ignore autoplay policy blocks)
        if (s.audio) {
          audio.play().catch(function () {});
        }
      }

      function stationAudioToggle() {
        var audio = g("station-audio");
        if (!audio) return;
        if (audio.paused) {
          audio.play().catch(function () {});
        } else {
          audio.pause();
        }
      }

      function stationAudioStop() {
        var audio = g("station-audio");
        if (!audio) return;
        audio.pause();
        audio.currentTime = 0;
        var sb2 = g("detail-audio-seek");
        var time = g("detail-audio-time");
        if (sb2) { sb2.value = 0; sb2.style.setProperty("--p", "0%"); }
        if (time) time.textContent = "0:00";
        _setListenBtnState("paused");
      }

      function _setListenBtnState(state) {
        var playPath = '<path d="M8 5v14l11-7z"></path>';
        var pausePath = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
        var iconPath = state === "playing" ? pausePath : playPath;
        var listenLabel = state === "playing" ? "Listening..." : "Listen to the story";
        var iconEl = g("detail-listen-icon");
        var labelEl = g("detail-listen-label");
        var miniBtn = g("detail-mini-play");
        if (iconEl)   iconEl.innerHTML  = '<svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">' + iconPath + "</svg>";
        if (labelEl)  labelEl.textContent = listenLabel;
        if (miniBtn)  miniBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">' + iconPath + "</svg>";
      }

      function _fmtTime(secs) {
        var m = Math.floor(secs / 60);
        var s = Math.floor(secs % 60);
        return m + ":" + (s < 10 ? "0" + s : s);
      }

      // ── TTS word highlighting helpers ──
      function _renderTtsWords(el, text) {
        el.innerHTML = "";
        var arr = [];
        var re = /(\S+)/g, m, lastEnd = 0;
        while ((m = re.exec(text)) !== null) {
          if (m.index > lastEnd) {
            el.appendChild(document.createTextNode(text.slice(lastEnd, m.index)));
          }
          var span = document.createElement("span");
          span.className = "hs-tts-word";
          span.textContent = m[1];
          el.appendChild(span);
          arr.push({ start: m.index, end: m.index + m[1].length, span: span });
          lastEnd = m.index + m[1].length;
        }
        if (lastEnd < text.length) {
          el.appendChild(document.createTextNode(text.slice(lastEnd)));
        }
        return arr;
      }

      function _ttsHighlightAt(absIdx) {
        if (_ttsActiveWord) { _ttsActiveWord.classList.remove("hs-tts-active"); _ttsActiveWord = null; }
        var best = null;
        for (var i = 0; i < ttsWords.length; i++) {
          var w = ttsWords[i];
          if (w.start <= absIdx && absIdx < w.end) { best = w; break; }
          if (w.start > absIdx) { best = ttsWords[i > 0 ? i - 1 : 0]; break; }
        }
        if (!best && ttsWords.length) best = ttsWords[ttsWords.length - 1];
        if (best) {
          best.span.classList.add("hs-tts-active");
          _ttsActiveWord = best.span;
          best.span.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }

      // Build per-word start timestamps from a weighted character model.
      // Each word's share of the total duration is proportional to its letter count
      // (proxy for syllables) plus a pause bonus for trailing punctuation.
      // A title-end pause is added before the description starts.
      function _buildAudioTimings(title, content, duration) {
        function wWeight(w) {
          var letters = w.replace(/[^a-zA-Z]/g, "").length || 1;
          // sentence-end pause ≈ 0.5–0.8 s; clause pause ≈ 0.2–0.3 s
          var pause = /[.!?]$/.test(w) ? 9 : /[,;:\-—]$/.test(w) ? 4 : 0;
          return letters + pause;
        }
        var titleWords = (title.trim().match(/\S+/g) || []);
        var descWords  = (content.match(/\S+/g) || []);
        var titleW  = titleWords.reduce(function (s, w) { return s + wWeight(w); }, 0);
        // ElevenLabs inserts a ~0.6 s pause between title and body;
        // represent it as weight equivalent to ~12 letter-chars.
        var TITLE_PAUSE = 12;
        var descWeights = descWords.map(wWeight);
        var descW = descWeights.reduce(function (a, b) { return a + b; }, 0);
        var totalW = titleW + TITLE_PAUSE + descW;
        var secPer = duration / totalW;
        var titleDur = (titleW + TITLE_PAUSE) * secPer;
        var timings = [];
        var cum = titleDur;
        for (var i = 0; i < descWeights.length; i++) {
          timings.push(cum);
          cum += descWeights[i] * secPer;
        }
        return timings;
      }

      // ── TTS ──
      function ttsPlay() {
        if (!window.speechSynthesis) {
          alert("Text-to-speech not supported on this device.");
          return;
        }
        pauseIdleTimer(); // pause idle countdown while listening
        window.speechSynthesis.cancel();
        var _detailEl = g("detail-text");
        var raw = _detailEl ? (_detailEl.innerText || _detailEl.textContent) : "";
        if (!raw.trim()) return;
        var _tp = g("tts-play"), _ts = g("tts-stop"), _tst = g("tts-status");
        if (_tp)  _tp.style.display  = "none";
        if (_ts)  _ts.style.display  = "inline-flex";
        if (_tst) _tst.textContent   = "Reading aloud...";

        // Render word spans for karaoke highlighting
        if (_detailEl) ttsWords = _renderTtsWords(_detailEl, raw);
        else ttsWords = [];
        if (_ttsActiveWord) { _ttsActiveWord.classList.remove("hs-tts-active"); _ttsActiveWord = null; }

        var sents = raw.match(/[^.!?\n]+[.!?\n]*/g) || [raw];
        ttsChunks = [];
        var buf = "";
        sents.forEach(function (s, i) {
          buf += s;
          if (buf.length > 180 || i === sents.length - 1) {
            if (buf.trim()) ttsChunks.push(buf.trim());
            buf = "";
          }
        });

        // Compute each chunk's start position in raw (for onboundary mapping)
        ttsChunkOffsets = [];
        var _searchFrom = 0;
        for (var ci = 0; ci < ttsChunks.length; ci++) {
          var _fi = raw.indexOf(ttsChunks[ci], _searchFrom);
          ttsChunkOffsets.push(_fi >= 0 ? _fi : _searchFrom);
          _searchFrom = _fi >= 0 ? _fi + ttsChunks[ci].length : _searchFrom + ttsChunks[ci].length;
        }

        ttsIdx = 0;
        function next() {
          if (ttsIdx >= ttsChunks.length) {
            ttsStop();
            return;
          }
          ttsUtt = new SpeechSynthesisUtterance(ttsChunks[ttsIdx]);
          ttsUtt.lang = "en-US";
          ttsUtt.rate = 0.88;
          ttsUtt.volume = 1.0;
          var vv = window.speechSynthesis.getVoices(),
            pick = null;
          for (var i = 0; i < vv.length; i++) {
            if (!vv[i].lang || vv[i].lang.indexOf("en") !== 0) continue;
            if (!pick) pick = vv[i];
            if (vv[i].name.indexOf("Google US") >= 0) {
              pick = vv[i];
              break;
            }
            if (vv[i].name.indexOf("Google") >= 0) pick = vv[i];
          }
          if (pick) ttsUtt.voice = pick;
          ttsIdx++;
          (function (chunkIdx) {
            var chunkText = ttsChunks[chunkIdx] || "";
            // Pre-compute word start positions within the chunk for fallback timer
            var cwStarts = [];
            var re2 = /\S+/g, m2;
            while ((m2 = re2.exec(chunkText)) !== null) cwStarts.push(m2.index);

            var boundaryFired = false;

            ttsUtt.onboundary = function (e) {
              if (e.name !== "word") return;
              boundaryFired = true;
              if (_ttsWordTimer) { clearInterval(_ttsWordTimer); _ttsWordTimer = null; }
              _ttsHighlightAt((ttsChunkOffsets[chunkIdx] || 0) + e.charIndex);
            };

            ttsUtt.onstart = function () {
              // If onboundary hasn't fired within 350ms, fall back to a timer
              setTimeout(function () {
                if (boundaryFired || !cwStarts.length) return;
                var wi = 0;
                var msPerWord = Math.round(60000 / (130 * 0.88)); // ~524ms @ rate 0.88
                _ttsWordTimer = setInterval(function () {
                  if (boundaryFired) { clearInterval(_ttsWordTimer); _ttsWordTimer = null; return; }
                  if (wi >= cwStarts.length) { clearInterval(_ttsWordTimer); _ttsWordTimer = null; return; }
                  _ttsHighlightAt((ttsChunkOffsets[chunkIdx] || 0) + cwStarts[wi]);
                  wi++;
                }, msPerWord);
              }, 350);
            };

            ttsUtt.onend = function () {
              if (_ttsWordTimer) { clearInterval(_ttsWordTimer); _ttsWordTimer = null; }
              setTimeout(next, 80);
            };
            ttsUtt.onerror = function (e) {
              if (_ttsWordTimer) { clearInterval(_ttsWordTimer); _ttsWordTimer = null; }
              if (e.error !== "interrupted") ttsStop();
            };
          }(ttsIdx - 1));
          window.speechSynthesis.speak(ttsUtt);
        }
        if (window.speechSynthesis.getVoices().length > 0) {
          next();
        } else {
          window.speechSynthesis.onvoiceschanged = function () {
            window.speechSynthesis.onvoiceschanged = null;
            next();
          };
          setTimeout(function () {
            if (ttsIdx === 0) next();
          }, 600);
        }
      }
      function ttsStop() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (_ttsWordTimer) { clearInterval(_ttsWordTimer); _ttsWordTimer = null; }
        ttsChunks = [];
        ttsIdx = 9999;
        if (_ttsActiveWord) { _ttsActiveWord.classList.remove("hs-tts-active"); _ttsActiveWord = null; }
        var p = g("tts-play"),
          s = g("tts-stop"),
          st = g("tts-status");
        if (p) p.style.display = "inline-flex";
        if (s) s.style.display = "none";
        if (st) st.textContent = "";
        tlAudioStop();
        // only resume idle timer if we're not already going to idle
        if (ttsActive) resumeIdleTimer();
      }

      function tlTtsPlay() {
        if (!window.speechSynthesis) {
          alert("Text-to-speech not supported on this device.");
          return;
        }
        pauseIdleTimer();
        window.speechSynthesis.cancel();
        var carousel = g("tl-carousel");
        var index = Math.round(carousel.scrollLeft / carousel.clientWidth);
        var item = TL_ITEMS[index] || TL_ITEMS[0];
        var raw =
          item.year +
          ". " +
          item.title +
          ". " +
          item.sub +
          ". " +
          item.body +
          " Did you know? " +
          item.did;
        g("tl-tts-play").style.display = "none";
        g("tl-tts-stop").style.display = "inline-flex";
        g("tl-tts-status").textContent = "Reading aloud...";
        var sents = raw.match(/[^.!?\n]+[.!?\n]*/g) || [raw];
        ttsChunks = [];
        var buf = "";
        sents.forEach(function (s, i) {
          buf += s;
          if (buf.length > 180 || i === sents.length - 1) {
            if (buf.trim()) ttsChunks.push(buf.trim());
            buf = "";
          }
        });
        ttsIdx = 0;
        function next() {
          if (ttsIdx >= ttsChunks.length) {
            ttsStop();
            return;
          }
          ttsUtt = new SpeechSynthesisUtterance(ttsChunks[ttsIdx]);
          ttsUtt.lang = "en-US";
          ttsUtt.rate = 0.88;
          ttsUtt.volume = 1.0;
          var vv = window.speechSynthesis.getVoices(),
            pick = null;
          for (var i = 0; i < vv.length; i++) {
            if (!vv[i].lang || vv[i].lang.indexOf("en") !== 0) continue;
            if (!pick) pick = vv[i];
            if (vv[i].name.indexOf("Google US") >= 0) {
              pick = vv[i];
              break;
            }
            if (vv[i].name.indexOf("Google") >= 0) pick = vv[i];
          }
          if (pick) ttsUtt.voice = pick;
          ttsIdx++;
          ttsUtt.onend = function () {
            setTimeout(next, 80);
          };
          ttsUtt.onerror = function (e) {
            if (e.error !== "interrupted") ttsStop();
          };
          window.speechSynthesis.speak(ttsUtt);
        }
        if (window.speechSynthesis.getVoices().length > 0) {
          next();
        } else {
          window.speechSynthesis.onvoiceschanged = function () {
            window.speechSynthesis.onvoiceschanged = null;
            next();
          };
          setTimeout(function () {
            if (ttsIdx === 0) next();
          }, 600);
        }
      }

      // ── Quiz ──
      function buildQuizSelect() {
        var h = "";
        DATA.sections.forEach(function (s, i) {
          var c = COLORS[i % COLORS.length];
          h += '<div class="exp-card-wrap" style="background:' + c + '">';
          h +=
            '<button class="quiz-topic-btn" data-id="' + s.id + '">';
          h +=
            '<div class="quiz-topic-name">' +
            sectionEmoji(s.id) +
            " " +
            s.title +
            "</div>";
          h +=
            '<div class="quiz-topic-count">' +
            s.questions.length +
            " questions</div></button></div>";
        });
        g("quiz-select-btns").innerHTML = h;
        g("quiz-select-btns")
          .querySelectorAll(".quiz-topic-btn")
          .forEach(function (b) {
            b.onclick = function () {
              startQuiz(this.getAttribute("data-id"));
            };
          });
      }

      function resetQuizSelect() {
        g("quiz-select").style.display = "block";
        g("quiz-active").style.display = "none";
        g("q-result").style.display = "none";
      }

      function startQuiz(id) {
        var s = DATA.sections.find(function (x) {
          return x.id === id;
        });
        quizState = {
          section: s,
          qs: shuffle(s.questions.slice()),
          cur: 0,
          score: 0,
          answers: [],
        };
        g("quiz-select").style.display = "none";
        g("q-result").style.display = "none";
        g("quiz-active").style.display = "flex";
        g("q-topic").textContent = s.title;
        // chip styled via CSS
        renderQ();
      }

      function renderQ() {
        var q = quizState.qs[quizState.cur],
          total = quizState.qs.length;
        g("q-fill").style.width = (quizState.cur / total) * 100 + "%";
        g("q-num").textContent =
          "Question " + (quizState.cur + 1) + " of " + total;
        g("q-text").textContent = q.q;
        g("q-fb").textContent = "";
        g("q-fb").className = "q-fb";
        g("q-next").style.display = "none";
        var h = "";
        q.opts.forEach(function (o, i) {
          h += '<button class="q-opt" data-i="' + i + '">' + o + "</button>";
        });
        g("q-opts").innerHTML = h;
        g("q-opts")
          .querySelectorAll(".q-opt")
          .forEach(function (b) {
            b.onclick = function () {
              answerQ(parseInt(this.getAttribute("data-i")));
            };
          });
      }

      function answerQ(idx) {
        var q = quizState.qs[quizState.cur];
        var btns = document.querySelectorAll(".q-opt");
        btns.forEach(function (b) {
          b.classList.add("disabled");
        });
        var ok = idx === q.ans;
        btns[idx].classList.add(ok ? "correct" : "wrong");
        if (!ok) btns[q.ans].classList.add("correct");
        quizState.answers.push({
          q: q.q,
          correct: ok,
          chosen: idx,
          expected: q.ans,
          chosenText: q.opts[idx],
          expectedText: q.opts[q.ans],
        });
        var fb = g("q-fb");
        if (ok) {
          fb.textContent = "✓ Correct! Well done.";
          fb.className = "q-fb ok";
          quizState.score++;
        } else {
          fb.textContent = "✗ Correct answer: " + q.opts[q.ans];
          fb.className = "q-fb bad";
        }
        g("q-next").style.display = "block";
      }

      function nextQ() {
        quizState.cur++;
        if (quizState.cur >= quizState.qs.length) showResult();
        else renderQ();
      }

      function showResult() {
        g("quiz-active").style.display = "none";
        g("q-result").style.display = "block";
        var s = quizState.score,
          t = quizState.qs.length,
          p = Math.round((s / t) * 100);
        g("r-score").textContent = s;
        g("r-total").textContent = t;
        g("r-emoji").textContent = p >= 80 ? "🏆" : p >= 60 ? "👍" : "📚";
        g("r-msg").textContent =
          p >= 80
            ? "Excellent! You know your Olongapo heritage!"
            : p >= 60
              ? "Good job! Keep exploring our culture."
              : "Keep learning! SALIN-LAHI has more to share.";
        g("v-name").value = "";
        g("v-grade").value = "";
        var btn = g("save-btn");
        btn.textContent = "🏆 Save My Score";
        btn.disabled = false;
      }

      async function saveScore() {
        var name  = g("v-name").value.trim()  || "Anonymous";
        var grade = g("v-grade").value.trim() || "-";
        var now   = new Date();
        var wrong = quizState.answers
          .filter(function (a) { return !a.correct; })
          .map(function (a) { return { q: a.q, chosen: a.chosenText, correct: a.expectedText }; });
        var entry = {
          name:    name,
          grade:   grade,
          topic:   quizState.section.title,
          topicId: quizState.section.id,
          score:   quizState.score,
          total:   quizState.qs.length,
          pct:     Math.round((quizState.score / quizState.qs.length) * 100),
          date:    now.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }),
          ts:      now.getTime(),
        };
        if (wrong.length > 0) entry.wrong = wrong;
        var btn = g("save-btn");
        btn.textContent = "Saving…";
        btn.disabled = true;

        // If auth hasn't resolved yet, wait up to 10 s for the firebase-ready event
        if (!window._fbReady) {
          var ready = await new Promise(function (resolve) {
            var settled = false;
            function finish(ok) {
              if (settled) return;
              settled = true;
              window.removeEventListener("firebase-ready", onReady);
              window.removeEventListener("firebase-error", onErr);
              resolve(ok);
            }
            function onReady() { finish(true);  }
            function onErr()   { finish(false); }
            window.addEventListener("firebase-ready", onReady);
            window.addEventListener("firebase-error", onErr);
            setTimeout(function () { finish(false); }, 10000);
          });
          if (!ready) {
            showToast("Could not connect to server — score not saved.");
            btn.textContent = "🏆 Save My Score";
            btn.disabled = false;
            return;
          }
        }

        try {
          await window.fbAddScore(entry);
          closeOverlay("ov-quiz");
          openOverlay("ov-lb");
          await buildLeaderboard();
          await updateLeaderboardPreview();
          showToast("Score saved! 🏆");
        } catch (e) {
          console.error("Firestore write failed:", e);
          showToast("Could not save — check your connection.");
          btn.textContent = "🏆 Save My Score";
          btn.disabled = false;
        }
      }

      // ── Leaderboard ──
      async function updateLeaderboardPreview() {
        try {
          if (!window._fbReady) {
            // Re-run once Firebase auth resolves instead of staying stuck on "Loading…"
            g("lb-preview").textContent = "Loading scores…";
            g("quiz-player-count").textContent = "+?";
            window.addEventListener("firebase-ready", function handler() {
              window.removeEventListener("firebase-ready", handler);
              updateLeaderboardPreview();
            });
            return;
          }
          var scores = await window.fbGetScores();
          var top = scores[0];
          g("lb-preview").textContent = top
            ? "Top: " + (top.name || "Anonymous") + " · " + top.score + "/" + top.total + " (" + top.pct + "%)"
            : "No scores yet";
          g("quiz-player-count").textContent = "+" + scores.length;
        } catch (e) {
          g("lb-preview").textContent = "Scores unavailable offline";
          g("quiz-player-count").textContent = "+0";
        }
      }

      async function buildLeaderboard() {
        // ── Topic filter dropdown ──
        var opts = '<option value="all"' + (lbFilter === "all" ? " selected" : "") + ">All Topics</option>";
        DATA.sections.forEach(function (s) {
          opts +=
            '<option value="' +
            s.id +
            '"' +
            (lbFilter === s.id ? " selected" : "") +
            ">" +
            s.title +
            "</option>";
        });
        g("lb-filters").innerHTML = '<select id="lb-topic-select">' + opts + "</select>";
        g("lb-topic-select").onchange = function () {
          lbFilter = this.value;
          buildLeaderboard();
        };

        var tb = g("lb-rows");
        var empty = g("lb-empty");
        tb.innerHTML =
          '<tr><td colspan="6" style="text-align:center;color:#926e6b;padding:28px">Loading scores…</td></tr>';
        empty.style.display = "none";

        var scores;
        try {
          scores =
            typeof window.fbGetScores === "function"
              ? await window.fbGetScores()
              : [];
        } catch (e) {
          tb.innerHTML = "";
          empty.innerHTML =
            '<div style="font-size:48px;margin-bottom:12px">📡</div>Scores unavailable offline. Check your connection.';
          empty.style.display = "block";
          return;
        }

        if (lbFilter !== "all")
          scores = scores.filter(function (s) {
            return s.topicId === lbFilter;
          });

        if (!scores.length) {
          tb.innerHTML = "";
          empty.innerHTML =
            '<div style="font-size:48px;margin-bottom:12px">🏺</div>No scores yet. Take the quiz!';
          empty.style.display = "block";
          return;
        }
        empty.style.display = "none";
        var h = "";
        scores.slice(0, 20).forEach(function (s, i) {
          var rc = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "rn";
          var medal =
            i === 0 ? "1st" : i === 1 ? "2nd" : i === 2 ? "3rd" : i + 1 + "th";
          h +=
            '<tr><td><span class="rank-badge ' +
            rc +
            '">' +
            medal +
            "</span></td><td>" +
            (s.name || "Anonymous") +
            "</td>";
          h +=
            '<td style="color:#926e6b;font-size:12px">' +
            (s.grade || "-") +
            "</td>";
          h +=
            '<td style="color:#5d3f3c;font-size:12px">' +
            (s.topic || "-") +
            "</td>";
          h +=
            '<td><span class="score-pill">' +
            s.score +
            "/" +
            s.total +
            " (" +
            s.pct +
            "%)</span></td>";
          h +=
            '<td style="color:#926e6b;font-size:12px">' +
            (s.date || "-") +
            "</td></tr>";
        });
        tb.innerHTML = h;
      }

      // ── Timeline ──
      var TL_ITEMS = [
        {
          color: "#22C55E",
          icon: "🏹",
          year: "Before 1500s",
          title: "Aeta Ancestral Domain",
          sub: "The Gently Sloping Shore",
          body: "Long before colonial intervention, the area was the ancestral domain of the Aeta people. In the Sambal language, the region was called 'olang-gapo' — meaning a 'gently sloping shore,' describing the natural coastal landscape.",
          did: "The Legend of Ulo ng Apo: A wise chieftain named Apo led the village with fairness and justice. Rival tribes abducted and beheaded him. When his head was found impaled on a bamboo pole, the villagers rallied with 'Ulo ng Apo!' — a cry for unity that remains central to Olongapo's identity.",
        },
        {
          color: "#EF6C5C",
          icon: "⚓",
          year: "1884 – 1898",
          title: "Arsenal de Olongapo",
          sub: "Spain's Pacific Stronghold",
          body: "In 1884, King Alfonso XII declared Subic Bay as Spain's primary naval stronghold. Construction of the Arsenal de Olongapo began on March 8, 1885. Engineers dredged the harbor and built a drainage canal that turned the naval station into an island for defense.",
          did: "The Spanish Gate (West Gate), built in 1885, remains the ONLY surviving 19th-century remnant of this era. It was declared a historical landmark in 2013.",
        },
        {
          color: "#38BDF8",
          icon: "🦅",
          year: "1899 – 1941",
          title: "US Naval Reservation",
          sub: "Roosevelt's Pacific Base",
          body: "After the Spanish-American War, the United States took control of the Philippines. In 1901, the US Navy established Naval Station Olongapo on the former Spanish arsenal grounds. The base expanded rapidly as America's strategic Pacific hub.",
          did: "During this era, Olongapo was an independent enclave — a US naval reservation completely separate from Philippine civil governance, with its own police, courts, and infrastructure.",
        },
        {
          color: "#F5A623",
          icon: "🇵🇭",
          year: "1945 – 1959",
          title: "Post-War & Liberation",
          sub: "Rising from the Ashes",
          body: "Olongapo was devastated during World War II. Both the Japanese occupation (1941-1945) and the Allied liberation caused severe damage. After liberation, the US Navy rebuilt the base into one of the largest overseas American installations in the world.",
          did: "On July 7, 1959, Olongapo was officially turned over to Philippine jurisdiction by the United States, ending decades of American direct administration.",
        },
        {
          color: "#8B5CF6",
          icon: "🏙️",
          year: "June 1, 1966",
          title: "City of Olongapo",
          sub: "Chartered & Independent",
          body: "Republic Act No. 4645, signed on June 1, 1966, officially converted Olongapo from a municipality into an independent chartered city. This date is celebrated annually as the city's founding anniversary.",
          did: "Mayor James Leonard T. Gordon became the first mayor of the newly chartered Olongapo City. He helped take care of the young city and make it grow. And because the Subic Bay Naval Base was nearby, the city developed very quickly.",
        },
        {
          color: "#06B6A4",
          icon: "🕊️",
          year: "September 16, 1991",
          title: "Treaty Rejection & Transformation",
          sub: "The Base Closes, The City Rises",
          body: "The Philippine Senate rejected the extension of the Military Bases Agreement in 1991, and the US Navy formally withdrew from Subic Bay in November 1992. The Subic Bay Metropolitan Authority (SBMA) was created to convert the base into a special economic zone.",
          did: "The base closure was initially feared as an economic disaster. Instead, under SBMA leadership, Subic Bay Freeport became one of the most successful conversion stories in modern history — attracting billions in investment.",
        },
        {
          color: "#A3E635",
          icon: "🤖",
          year: "2010s – Present",
          title: "Smart City Era",
          sub: "DOST Innovation & Digital Heritage",
          body: "Olongapo City is now at the forefront of the DOST Smart City initiative. Projects like SALIN-LAHI use robotics and interactive technology to preserve and transmit indigenous and local heritage knowledge to younger generations through the Modern Library Movement.",
          did: 'SALIN-LAHI (meaning "passing down heritage through generations") represents Olongapo\'s commitment: honoring its past while building a technologically advanced, culturally proud future.',
        },
      ];

      // Exact filenames per slide — extensions and names vary per image
      var TL_IMAGES = [
        ["timeline-1a.png","timeline-1b.jpg","timeline-1c.jpg","timeline-1d.jpg","timeline-1e.jpg","timeline-1f.jpg","timeline-1g.jpg","timeline-1h.jpg","timeline-1i.jpg","timeline-1j.jpg"],
        ["timeline-2a.jpg","timeline-2b.jpg","timeline-2c.jpg","timeline-2d.jpg","timeline-2e.jpg","timeline-2f.jpg","timeline-2g.jpg","timeline-2h.jpg","timeline-2i.jpg","timeline-2j.jpg"],
        ["timeline-3a.jpg","timeline-3b.jpg","timeline-3c.jpg","timeline-3d.jpg","timeline-3e.jpg","timeline-3f.jpg","timeline-3g.jpg","timeline-3h.jpg","timeline-3i.jpg","timeline-3j.jpg"],
        ["timeline-4a.jpg","timeline-4b.jpg","timeline-4c.jpg","timeline-4d.jpg","timeline-4e.jpg","timeline-4f.jpg","timeline-4g.jpg","timeline-4h.jpg","timeline-4i.jpg","timeline-4j.jpg"],
        ["timeline-5a.jpg","timeline-5b.jpg","timeline-5c.jpg","timeline-5d.jpg","timeline-5e.jpg","timeline-5f.jpg","timeline-5g.jpg","timeline-5h.jpg","timeline-5i.jpg","timeline-5j.jpg"],
        ["timeline-6a.jpg","timeline-6b.jpg","timeline-6c.jpg","timeline-6d.jpg","timeline-6e.jpg","timeline-6f.jpg","timeline-6g.jpg","timeline-6h.jpg","timeline-6i.jpg","timeline-6j.jpg"],
        ["timeline-7a.jpg","timeline-7b.jpg","timeline-7c.jpg","timeline-7d.jpg","timeline-7e.jpg","timeline-7f.jpg","timeline-7g.jpg","timeline-7h.jpg","timeline-7i.jpg","timeline-7j.jpg"],
      ];

      function _tlSlide(index) {
        var carousel = g("tl-carousel");
        return (carousel && index >= 0) ? carousel.querySelectorAll(".tl-slide")[index] : null;
      }

      function _tlSetBtnState(index, playing) {
        var slide = _tlSlide(index);
        if (!slide) return;
        var playPath  = '<path d="M8 5v14l11-7z"></path>';
        var pausePath = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
        var svgBig  = '<svg width="9"  height="9"  viewBox="0 0 24 24" fill="currentColor">' + (playing ? pausePath : playPath) + '</svg>';
        var svgMini = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">' + (playing ? pausePath : playPath) + '</svg>';
        var icon  = slide.querySelector(".tl-listen-icon");
        var label = slide.querySelector(".hs-listen-label");
        var mini  = slide.querySelector(".tl-mini-play");
        if (icon)  icon.innerHTML    = svgBig;
        if (label) label.textContent = playing ? "Listening..." : "Listen to the story";
        if (mini)  mini.innerHTML    = svgMini;
      }

      function _tlSetPhotoActive(slideIndex, imgIndex) {
        var slide = _tlSlide(slideIndex);
        if (!slide) return;
        var photos = slide.querySelectorAll(".tl-photo");
        photos.forEach(function (p, i) { p.classList.toggle("active", i === imgIndex); });
      }

      function _tlUpdateSeek(index, pct, seconds) {
        var slide = _tlSlide(index);
        if (!slide) return;
        var seekEl = slide.querySelector(".tl-audio-seek");
        var timeEl = slide.querySelector(".tl-audio-time");
        if (seekEl) { seekEl.value = pct; seekEl.style.setProperty("--p", pct + "%"); }
        if (timeEl) timeEl.textContent = _fmtTime(seconds);
      }

      function tlAudioStop() {
        var audio = g("tl-audio");
        if (!audio) return;
        _tlSetBtnState(_tlActiveSlide, false);
        _tlUpdateSeek(_tlActiveSlide, 0, 0);
        _tlSetPhotoActive(_tlActiveSlide, 0);
        _tlActiveSlide = -1;
        audio.pause();
        audio.currentTime = 0;
      }

      function tlAudioToggle(index) {
        var audio = g("tl-audio");
        if (!audio) return;
        if (_tlActiveSlide === index) {
          if (audio.paused) {
            pauseIdleTimer();
            _tlSetBtnState(index, true);
            audio.play().catch(function () {});
          } else {
            _tlSetBtnState(index, false);
            audio.pause();
          }
          return;
        }
        // Stop previous slide
        _tlSetBtnState(_tlActiveSlide, false);
        _tlUpdateSeek(_tlActiveSlide, 0, 0);
        _tlSetPhotoActive(_tlActiveSlide, 0);
        _tlActiveSlide = -1;
        audio.pause();
        audio.currentTime = 0;
        // Start new slide
        audio.src = "assets/timeline/timeline-" + (index + 1) + "/timeline-" + (index + 1) + ".mp3";
        _tlActiveSlide = index;
        pauseIdleTimer();
        _tlSetBtnState(index, true);
        audio.play().catch(function () {});
      }

      function buildTimeline() {
        var carousel = g("tl-carousel");
        var dotsWrap = g("tl-dots");
        if (!carousel || !dotsWrap) return;

        var slides = "";
        var dots = "";
        TL_ITEMS.forEach(function (item, i) {
          var strip = '<div class="tl-photo-strip">';
          TL_IMAGES[i].forEach(function (filename, li) {
            strip += '<img class="tl-photo' + (li === 0 ? " active" : "") + '" src="assets/timeline/timeline-' + (i + 1) + "/" + filename + '" alt="' + item.title + " " + (li + 1) + '" />';
          });
          strip += "</div>";
          slides += '<section class="tl-slide" aria-label="' + item.year + '">';
          slides += strip;
          slides += '<div class="tl-info' + (i % 2 ? " tl-info-red" : "") + '">';
          slides += '<div class="tl-year">' + item.year + "</div>";
          slides += '<div class="tl-rule"></div>';
          slides +=
            '<div><div class="tl-title">' +
            item.title +
            '</div><div class="tl-sub">' +
            item.sub +
            "</div></div>";
          slides += '<div class="tl-body">' + item.body + "</div>";
          slides +=
            '<div class="tl-fact"><div class="tl-fact-label">Did You Know?</div>';
          slides += '<div class="tl-fact-text">' + item.did + "</div></div>";
          slides +=
            '<button class="hs-listen-btn tl-listen-btn" type="button">' +
            '<span class="tl-listen-icon"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg></span>' +
            '<span class="hs-listen-label">Listen to the story</span>' +
            "</button>";
          slides +=
            '<div class="hs-audio-bar tl-audio-bar">' +
            '<button class="hs-mini-play tl-mini-play" type="button" aria-label="Play audio">' +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>' +
            "</button>" +
            '<input type="range" class="hs-audio-seek tl-audio-seek" value="0" min="0" max="100" step="0.1" aria-label="Audio seek">' +
            '<span class="hs-audio-time tl-audio-time">0:00</span>' +
            "</div>";
          slides += "</div></section>";
          dots +=
            '<button class="tl-dot' +
            (i === 0 ? " active" : "") +
            '" type="button" aria-label="Go to timeline slide ' +
            (i + 1) +
            '" data-i="' +
            i +
            '"></button>';
        });
        carousel.innerHTML = slides;
        dotsWrap.innerHTML = dots;

        // Wire per-slide listen button, mini-play, and seek input
        carousel.querySelectorAll(".tl-slide").forEach(function (slide, i) {
          var btn    = slide.querySelector(".tl-listen-btn");
          var mini   = slide.querySelector(".tl-mini-play");
          var seekEl = slide.querySelector(".tl-audio-seek");
          if (btn)    btn.onclick    = function () { tlAudioToggle(i); };
          if (mini)   mini.onclick   = function () { tlAudioToggle(i); };
          if (seekEl) seekEl.oninput = function () {
            var a = g("tl-audio");
            if (a && a.duration) a.currentTime = (seekEl.value / 100) * a.duration;
          };
        });

        // Timeline audio events
        var tlAudio = g("tl-audio");
        if (tlAudio) {
          tlAudio.onplay  = function () { pauseIdleTimer(); };
          tlAudio.onpause = function () { resumeIdleTimer(); };
          tlAudio.onended = function () {
            resumeIdleTimer();
            _tlSetBtnState(_tlActiveSlide, false);
            _tlUpdateSeek(_tlActiveSlide, 0, 0);
            _tlSetPhotoActive(_tlActiveSlide, 0);
            _tlActiveSlide = -1;
          };
          tlAudio.ontimeupdate = function () {
            if (!tlAudio.duration) return;
            var pct = (tlAudio.currentTime / tlAudio.duration) * 100;
            _tlUpdateSeek(_tlActiveSlide, pct, tlAudio.currentTime);
            if (_tlActiveSlide >= 0) {
              var imgIndex = Math.floor((tlAudio.currentTime / tlAudio.duration) * 10) % 10;
              _tlSetPhotoActive(_tlActiveSlide, imgIndex);
            }
          };
        }

        var prev = g("tl-prev");
        var next = g("tl-next");
        var dotBtns = dotsWrap.querySelectorAll(".tl-dot");

        function setTimelineDot(index) {
          dotBtns.forEach(function (dot, i) {
            dot.classList.toggle("active", i === index);
          });
        }

        function goTimeline(delta) {
          var index = Math.round(carousel.scrollLeft / carousel.clientWidth);
          var nextIndex = (index + delta + TL_ITEMS.length) % TL_ITEMS.length;
          ttsStop();
          carousel.scrollTo({
            left: nextIndex * carousel.clientWidth,
            behavior: "smooth",
          });
          setTimelineDot(nextIndex);
        }

        prev.onclick = function () {
          goTimeline(-1);
        };
        next.onclick = function () {
          goTimeline(1);
        };
        dotBtns.forEach(function (dot) {
          dot.onclick = function () {
            ttsStop();
            var index = parseInt(this.getAttribute("data-i"), 10);
            carousel.scrollTo({
              left: index * carousel.clientWidth,
              behavior: "smooth",
            });
            setTimelineDot(index);
          };
        });
        var tlLastScrollIndex = 0;
        carousel.onscroll = function () {
          var index = Math.round(carousel.scrollLeft / carousel.clientWidth);
          setTimelineDot(index);
          if (index !== tlLastScrollIndex) {
            tlLastScrollIndex = index;
            ttsStop();
            tlAudioToggle(index);
          }
        };
        return;

        var html = "";
        TL_ITEMS.forEach(function (item) {
          html += '<div class="tl-item">';
          html +=
            '<div class="tl-node" style="background:' +
            item.color +
            ";border-color:" +
            item.color +
            '"><span class="tl-node-icon">' +
            item.icon +
            "</span></div>";
          html +=
            '<div class="tl-card" style="border-left:4px solid ' +
            item.color +
            '">';
          html +=
            '<div class="tl-card-year" style="color:' +
            item.color +
            '">' +
            item.year +
            "</div>";
          html += '<div class="tl-card-title">' + item.title + "</div>";
          html += '<div class="tl-card-sub">' + item.sub + "</div>";
          html += '<div class="tl-card-body">' + item.body + "</div>";
          html +=
            '<div class="tl-card-legend" style="border-color:' +
            item.color +
            "44;background:" +
            item.color +
            '0d">';
          html +=
            '<div class="tl-legend-label" style="color:' +
            item.color +
            '">📌 Did You Know?</div>';
          html += '<div class="tl-legend-text">' + item.did + "</div></div>";
          html += "</div></div>";
        });
        g("tl-events").innerHTML = html;
      }

      // ── Storage: replaced by Firebase Firestore (see firebase.js) ──
      // window.fbAddScore(entry) — writes one document to salinlahi_scores
      // window.fbGetScores()    — reads up to 100 scores ordered by pct DESC, ts ASC

      // ── Shuffle ──
      function shuffle(a) {
        for (var i = a.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = a[i];
          a[i] = a[j];
          a[j] = t;
        }
        return a;
      }

      // Init slider
      goTo(0, false);

      // ── Idle fullscreen crossfade ──
      var IDLE_IMAGES = [
        "assets/homepage/3-krus.jpg",
        "assets/homepage/aeta3.jpg",
        "assets/homepage/barretto.jpg",
        "assets/homepage/kalaklan-lighthouse.jpg",
        "assets/homepage/ulo-ng-apo.jpg",
        "assets/homepage/triangle.jpg",
        "assets/homepage/aeta1.jpg",
        "assets/homepage/bagong-palengke.jpg",
        "assets/homepage/kalapati.jpg",
        "assets/homepage/marikit.jpg",
      ];

      var idleCur = 0;
      var idleImgs = [];

      function startIdleCycle() {
        var container = document.getElementById("idle");
        // create all img elements before the overlay
        var overlay = container.querySelector(".idle-overlay");
        IDLE_IMAGES.forEach(function (src, i) {
          var img = document.createElement("img");
          img.src = src;
          img.alt = "";
          img.className = "idle-bg";
          if (i === 0) img.classList.add("visible");
          container.insertBefore(img, overlay);
          idleImgs.push(img);
        });
        // cycle every 3.5s — store handle so we can restart if needed
        var idleCycleInterval = null;
        function startCycleInterval() {
          if (idleCycleInterval) clearInterval(idleCycleInterval);
          idleCycleInterval = setInterval(function () {
            idleImgs[idleCur].classList.remove("visible");
            idleCur = (idleCur + 1) % idleImgs.length;
            idleImgs[idleCur].classList.add("visible");
          }, 3500);
        }
        startCycleInterval();
        // restart interval when page becomes visible again (e.g. iPad wakes)
        document.addEventListener("visibilitychange", function () {
          if (!document.hidden) startCycleInterval();
        });
      }

      // ════════════════════════════════════════════
      // ADMIN DASHBOARD
      // ════════════════════════════════════════════
      var ADMIN_PIN = "1234";        // fallback — overwritten by Firestore on load
      var PRESENTATION_PIN = "4321"; // fallback — overwritten by Firestore on load
      var pinBuffer = "";
      var adminScores = [];
      var adminLastSync = null;
      var adminFilterSearch = "";
      var adminFilterTopic = "all";

      // ── Load PINs from Firestore ──
      function _loadAdminPin() {
        function _fetch() {
          if (!window.fbGetAdminPin) return;
          window.fbGetAdminPin().then(function (pin) {
            if (pin) ADMIN_PIN = pin;
          }).catch(function () {});
        }
        if (window._fbReady) {
          _fetch();
        } else {
          window.addEventListener("firebase-ready", function handler() {
            window.removeEventListener("firebase-ready", handler);
            _fetch();
          });
        }
      }

      function _loadPresPin() {
        function _fetch() {
          if (!window.fbGetPresPin) return;
          window.fbGetPresPin().then(function (pin) {
            if (pin) PRESENTATION_PIN = pin;
          }).catch(function () {});
        }
        if (window._fbReady) {
          _fetch();
        } else {
          window.addEventListener("firebase-ready", function handler() {
            window.removeEventListener("firebase-ready", handler);
            _fetch();
          });
        }
      }

      function _loadPresFlow() {
        function _fetch() {
          if (!window.fbGetPresFlow) return;
          window.fbGetPresFlow().then(function (flow) {
            if (flow) {
              _apConfig = flow;
              // Persist to localStorage so it survives offline restarts
              try { localStorage.setItem("salin-lahi-ap-config", JSON.stringify(flow)); } catch (e) {}
            }
          }).catch(function () {});
        }
        if (window._fbReady) {
          _fetch();
        } else {
          window.addEventListener("firebase-ready", function handler() {
            window.removeEventListener("firebase-ready", handler);
            _fetch();
          });
        }
      }

      // ── PIN Modal ──
      function openPinModal() {
        pinBuffer = "";
        updatePinDots();
        g("pin-error").textContent = "";
        g("admin-pin-modal").style.display = "flex";
      }

      function closePinModal() {
        pinBuffer = "";
        updatePinDots();
        g("admin-pin-modal").style.display = "none";
      }

      function pinDigit(d) {
        if (pinBuffer.length >= 4) return;
        pinBuffer += String(d);
        updatePinDots();
        if (pinBuffer.length === 4) setTimeout(submitPin, 150);
      }

      function pinDelete() {
        if (!pinBuffer.length) return;
        pinBuffer = pinBuffer.slice(0, -1);
        updatePinDots();
      }

      function pinClear() {
        pinBuffer = "";
        updatePinDots();
      }

      function updatePinDots() {
        document.querySelectorAll(".pin-dot").forEach(function (dot, i) {
          dot.classList.toggle("filled", i < pinBuffer.length);
        });
      }

      function submitPin() {
        if (pinBuffer === ADMIN_PIN) {
          closePinModal();
          openAdminDashboard();
        } else if (pinBuffer === PRESENTATION_PIN) {
          closePinModal();
          openPresentationDashboard();
        } else {
          var dotsEl = g("pin-dots");
          dotsEl.classList.add("shake");
          g("pin-error").textContent = "Incorrect PIN";
          setTimeout(function () {
            dotsEl.classList.remove("shake");
            pinBuffer = "";
            updatePinDots();
            g("pin-error").textContent = "";
          }, 800);
        }
      }

      function openPresentationDashboard() {
        openOverlay("ov-presentation");
        _apBuildFlowUI();
        _apSyncAdminBtns();
      }

      // ── Admin overlay ──
      async function openAdminDashboard() {
        openOverlay("ov-admin");
        showAdminTab("scores");
        await loadAdminScores();
      }

      async function loadAdminScores() {
        g("admin-scores-tbody").innerHTML =
          '<tr><td colspan="8" style="text-align:center;color:#926e6b;padding:28px">Connecting to Firebase…</td></tr>';
        try {
          // Wait for auth to resolve if it hasn't yet (up to 10 s)
          if (!window._fbReady) {
            var ready = await new Promise(function (resolve) {
              var settled = false;
              function finish(ok) {
                if (settled) return;
                settled = true;
                window.removeEventListener("firebase-ready", onReady);
                window.removeEventListener("firebase-error", onErr);
                resolve(ok);
              }
              function onReady() { finish(true);  }
              function onErr()   { finish(false); }
              window.addEventListener("firebase-ready", onReady);
              window.addEventListener("firebase-error", onErr);
              setTimeout(function () { finish(false); }, 10000);
            });
            if (!ready) throw new Error("Could not connect to Firebase. Check your internet connection.");
          }
          adminScores = await window.fbGetAllScores();
          window._adminScores = adminScores;
          adminLastSync = new Date();
          renderAdminTable();
          renderAdminStats();
          g("info-last-sync").textContent = adminLastSync.toLocaleString("en-PH");
        } catch (e) {
          g("admin-scores-tbody").innerHTML =
            '<tr><td colspan="8" style="text-align:center;color:#bd001a;padding:28px">Error: ' +
            e.message +
            "</td></tr>";
        }
      }

      function buildAdminTopicDropdown() {
        var seen = {};
        var opts = '<option value="all">All Topics</option>';
        adminScores.forEach(function (s) {
          if (s.topicId && !seen[s.topicId]) {
            seen[s.topicId] = true;
            opts +=
              '<option value="' +
              s.topicId +
              '">' +
              (s.topic || s.topicId) +
              "</option>";
          }
        });
        g("admin-topic-filter").innerHTML = opts;
        g("admin-topic-filter").value = adminFilterTopic;
      }

      function getAdminFiltered() {
        var q = adminFilterSearch.toLowerCase().trim();
        var tid = adminFilterTopic;
        return adminScores.filter(function (s) {
          var matchSearch =
            !q ||
            (s.name || "").toLowerCase().indexOf(q) >= 0 ||
            (s.grade || "").toLowerCase().indexOf(q) >= 0;
          var matchTopic = tid === "all" || s.topicId === tid;
          return matchSearch && matchTopic;
        });
      }

      function renderAdminTable() {
        buildAdminTopicDropdown();
        var rows = getAdminFiltered();

        if (!rows.length) {
          g("admin-scores-tbody").innerHTML =
            '<tr><td colspan="8" style="text-align:center;color:#926e6b;padding:28px">No scores found.</td></tr>';
          return;
        }

        var h = "";
        rows.forEach(function (s, i) {
          var dt = s.ts
            ? new Date(s.ts).toLocaleString("en-PH", {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : s.date || "—";
          var docId = s._docId || "";
          h += "<tr>";
          h += "<td>" + (i + 1) + "</td>";
          h += "<td>" + (s.name || "Anonymous") + "</td>";
          h += "<td>" + (s.grade || "—") + "</td>";
          h += "<td>" + (s.topic || "—") + "</td>";
          h += "<td>" + s.score + "/" + s.total + "</td>";
          h += "<td>" + s.pct + "%</td>";
          h += "<td>" + dt + "</td>";
          h +=
            '<td><button class="admin-del-btn" data-docid="' +
            docId +
            '">🗑 Delete</button></td>';
          h += "</tr>";
        });
        g("admin-scores-tbody").innerHTML = h;

        // Wire inline-confirm delete buttons
        g("admin-scores-tbody")
          .querySelectorAll(".admin-del-btn")
          .forEach(function (btn) {
            btn.onclick = function () {
              var row = this.closest("tr");
              var docId = this.getAttribute("data-docid");
              var cell = this.parentElement;
              cell.innerHTML =
                '<span style="display:flex;gap:6px;align-items:center">' +
                '<button class="admin-del-yes" data-docid="' + docId + '">Yes, delete</button>' +
                '<button class="admin-del-no">Cancel</button>' +
                "</span>";
              cell.querySelector(".admin-del-yes").onclick = async function () {
                if (!docId) { showToast("Cannot delete: missing doc ID."); return; }
                try {
                  await window.fbDeleteScore(docId);
                  adminScores = adminScores.filter(function (s) {
                    return s._docId !== docId;
                  });
                  row.remove();
                  renderAdminStats();
                  updateLeaderboardPreview();
                  showToast("Score deleted.");
                } catch (e) {
                  showToast("Delete failed: " + e.message);
                  renderAdminTable();
                }
              };
              cell.querySelector(".admin-del-no").onclick = function () {
                renderAdminTable();
              };
            };
          });
      }

      function renderAdminStats() {
        var scores = adminScores;
        var total = scores.length;
        var avgPct =
          total
            ? (
                scores.reduce(function (sum, s) {
                  return sum + (s.pct || 0);
                }, 0) / total
              ).toFixed(1) + "%"
            : "—";
        var perfects = scores.filter(function (s) {
          return s.pct === 100;
        }).length;
        var now = Date.now();
        var today = scores.filter(function (s) {
          return s.ts && now - s.ts < 86400000;
        }).length;

        var topicCounts = {};
        scores.forEach(function (s) {
          if (s.topic) topicCounts[s.topic] = (topicCounts[s.topic] || 0) + 1;
        });
        var popularTopic = "—";
        var maxCount = 0;
        Object.keys(topicCounts).forEach(function (k) {
          if (topicCounts[k] > maxCount) {
            maxCount = topicCounts[k];
            popularTopic = k;
          }
        });

        var cards = [
          { val: total, lbl: "Total Attempts" },
          { val: avgPct, lbl: "Avg. Score" },
          { val: perfects, lbl: "Perfect Scores" },
          { val: today, lbl: "Scores Today" },
          { val: popularTopic, lbl: "Most Popular Topic" },
        ];
        g("admin-stat-cards").innerHTML = cards
          .map(function (c) {
            return (
              '<div class="stat-card">' +
              '<div class="stat-card-val">' + c.val + "</div>" +
              '<div class="stat-card-lbl">' + c.lbl + "</div>" +
              "</div>"
            );
          })
          .join("");

        // CSS bar chart
        var sorted = Object.keys(topicCounts).sort(function (a, b) {
          return topicCounts[b] - topicCounts[a];
        });
        var maxBar = Math.max(1, sorted.length ? topicCounts[sorted[0]] : 1);
        var barHtml = sorted
          .map(function (topic) {
            var count = topicCounts[topic];
            var pct = Math.round((count / maxBar) * 100);
            return (
              '<div class="bar-row">' +
              '<div class="bar-label" title="' + topic + '">' + topic + "</div>" +
              '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
              '<div class="bar-count">' + count + "</div>" +
              "</div>"
            );
          })
          .join("");
        g("admin-bar-rows").innerHTML =
          barHtml ||
          '<p style="color:#926e6b;font-family:\'Space Grotesk\',sans-serif;font-size:15px">No data yet.</p>';
      }

      function exportAdminCSV() {
        var rows = getAdminFiltered();
        var lines = [["#", "Name", "Grade", "Topic", "Score", "Total", "Pct%", "Date & Time"].join(",")];
        rows.forEach(function (s, i) {
          var dt = s.ts
            ? new Date(s.ts).toLocaleString("en-PH")
            : s.date || "";
          lines.push(
            [
              i + 1,
              '"' + (s.name || "Anonymous").replace(/"/g, '""') + '"',
              '"' + (s.grade || "").replace(/"/g, '""') + '"',
              '"' + (s.topic || "").replace(/"/g, '""') + '"',
              s.score,
              s.total,
              s.pct,
              '"' + dt.replace(/"/g, '""') + '"',
            ].join(",")
          );
        });
        var blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download =
          "salinlahi_scores_" + new Date().toISOString().slice(0, 10) + ".csv";
        a.click();
      }

      function showAdminTab(tab) {
        ["scores", "stats", "analytics", "settings"].forEach(function (t) {
          g("admin-tab-" + t).style.display = t === tab ? "" : "none";
        });
        document.querySelectorAll(".admin-tab-btn").forEach(function (btn) {
          btn.classList.toggle("on", btn.getAttribute("data-tab") === tab);
        });
        if (tab === "settings") {
          g("info-project-id").textContent = window.fbProjectId || "—";
          g("info-last-sync").textContent = adminLastSync
            ? adminLastSync.toLocaleString("en-PH")
            : "—";
          g("idle-input").value = Math.round(IDLE_TIMEOUT / 1000);
        }
        if (tab === "analytics") {
          buildAnalytics();
        }
      }

      // ── Analytics Tab ──
      var analyticsTopicVal = "all";

      function escHtml(str) {
        return String(str)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function buildAnalytics() {
        var el = g("analytics-content");
        if (!el) return;
        var scores = window._adminScores || adminScores || [];
        if (!scores.length) {
          el.innerHTML = '<div class="analytics-empty">Switch to the Scores tab first to load data, then come back here.</div>';
          return;
        }

        var filtered = analyticsTopicVal === "all"
          ? scores
          : scores.filter(function (s) { return s.topicId === analyticsTopicVal; });

        if (!filtered.length) {
          el.innerHTML = '<div class="analytics-empty">No attempts recorded for this topic yet.</div>';
          return;
        }

        var total = filtered.length;
        var avgScore = (filtered.reduce(function (a, s) { return a + (s.pct || 0); }, 0) / total).toFixed(1);
        var perfect = filtered.filter(function (s) { return s.pct >= 100; }).length;

        var html = "";

        // ── Stat chips ──
        html += '<div class="analytics-stat-chips">';
        html += '<div class="analytics-chip"><div class="analytics-chip-val">' + total + '</div><div class="analytics-chip-label">Total Attempts</div></div>';
        html += '<div class="analytics-chip"><div class="analytics-chip-val">' + avgScore + '%</div><div class="analytics-chip-label">Average Score</div></div>';
        html += '<div class="analytics-chip"><div class="analytics-chip-val">' + perfect + '</div><div class="analytics-chip-label">Perfect Scores</div></div>';
        html += '</div>';

        // ── Per-question breakdown (topic-specific only) ──
        if (analyticsTopicVal !== "all" && DATA && DATA.sections) {
          var section = DATA.sections.find(function (s) { return s.id === analyticsTopicVal; });
          if (section && section.questions && section.questions.length) {
            html += '<div class="analytics-section-title">Question Breakdown</div>';

            section.questions.forEach(function (q, idx) {
              // Collect all wrong-answer entries for this question
              var wrongEntries = [];
              filtered.forEach(function (score) {
                if (score.wrong && Array.isArray(score.wrong)) {
                  score.wrong.forEach(function (w) {
                    if (w.q === q.q) wrongEntries.push(w);
                  });
                }
              });

              var wrongCount = wrongEntries.length;
              var correctCount = total - wrongCount;
              var pct = total > 0 ? Math.round(correctCount / total * 100) : 0;
              var correctText = q.opts[q.ans];

              // Build per-option counts
              var dist = {};
              q.opts.forEach(function (opt) { dist[opt] = 0; });
              dist[correctText] += correctCount;
              wrongEntries.forEach(function (w) {
                if (dist.hasOwnProperty(w.chosen)) {
                  dist[w.chosen]++;
                }
              });

              var maxCount = Math.max.apply(null, q.opts.map(function (o) { return dist[o] || 0; }));
              var pctColor = pct >= 80 ? "#16a34a" : pct >= 60 ? "#d97706" : "#dc2626";

              html += '<div class="analytics-q-card">';
              html += '<div class="analytics-q-header">';
              html += '<span class="analytics-q-label">Q' + (idx + 1) + ' of ' + section.questions.length + '</span>';
              html += '<span class="analytics-q-pct" style="color:' + pctColor + '">' + pct + '% correct</span>';
              html += '</div>';
              html += '<div class="analytics-q-text">' + escHtml(q.q) + '</div>';

              q.opts.forEach(function (opt, oi) {
                var count = dist[opt] || 0;
                var barPct = maxCount > 0 ? Math.round(count / maxCount * 100) : 0;
                var isCorrect = oi === q.ans;
                var letter = String.fromCharCode(65 + oi);

                html += '<div class="analytics-bar-row' + (isCorrect ? " is-correct" : "") + '">';
                html += '<span class="analytics-bar-letter">' + letter + '</span>';
                html += '<div class="analytics-bar-wrap">';
                html += '<div class="analytics-bar-fill ' + (isCorrect ? "analytics-bar-fill-correct" : "analytics-bar-fill-wrong") + '" style="width:' + barPct + '%"></div>';
                html += '<span class="analytics-bar-label">' + escHtml(opt) + (isCorrect ? " ✓" : "") + '</span>';
                html += '</div>';
                html += '<span class="analytics-bar-count">' + count + '</span>';
                html += '</div>';
              });

              html += '<div class="analytics-q-foot">' + correctCount + ' of ' + total + ' answered correctly</div>';
              html += '</div>';
            });
          }
        }

        // ── Overall Summary ──
        html += '<div class="analytics-section-title" style="margin-top:20px">Overall Summary</div>';
        html += '<div class="analytics-overall">';

        var excellent = filtered.filter(function (s) { return s.pct >= 80; }).length;
        var good      = filtered.filter(function (s) { return s.pct >= 60 && s.pct < 80; }).length;
        var needs     = filtered.filter(function (s) { return s.pct < 60; }).length;

        html += '<div class="analytics-overall-row"><span class="analytics-overall-key">Total Attempts</span><span class="analytics-overall-val">' + total + '</span></div>';
        html += '<div class="analytics-overall-row"><span class="analytics-overall-key">Average Score</span><span class="analytics-overall-val">' + avgScore + '%</span></div>';
        html += '<div class="analytics-overall-row"><span class="analytics-overall-key">Perfect Scores (100%)</span><span class="analytics-overall-val">' + perfect + ' (' + (total > 0 ? Math.round(perfect / total * 100) : 0) + '%)</span></div>';
        html += '<div class="analytics-overall-row"><span class="analytics-overall-key" style="color:#16a34a">Excellent (80–100%)</span><span class="analytics-overall-val" style="color:#16a34a">' + excellent + '</span></div>';
        html += '<div class="analytics-overall-row"><span class="analytics-overall-key" style="color:#d97706">Good (60–79%)</span><span class="analytics-overall-val" style="color:#d97706">' + good + '</span></div>';
        html += '<div class="analytics-overall-row"><span class="analytics-overall-key" style="color:#dc2626">Needs Improvement (&lt;60%)</span><span class="analytics-overall-val" style="color:#dc2626">' + needs + '</span></div>';

        // By grade
        var byGrade = {};
        filtered.forEach(function (s) {
          var gr = s.grade || "Unknown";
          if (!byGrade[gr]) byGrade[gr] = { count: 0, totalPct: 0 };
          byGrade[gr].count++;
          byGrade[gr].totalPct += (s.pct || 0);
        });
        var gradeEntries = Object.entries(byGrade).sort(function (a, b) { return b[1].count - a[1].count; });
        if (gradeEntries.length) {
          html += '<div class="analytics-overall-row" style="padding-bottom:4px"><span class="analytics-overall-key">By Grade Level</span></div>';
          html += '<div class="analytics-subrows">';
          gradeEntries.forEach(function (e) {
            var gr = e[0], gd = e[1];
            html += '<div class="analytics-grade-row"><span class="analytics-grade-key">' + escHtml(gr) + '</span><span class="analytics-grade-val">' + gd.count + ' attempt' + (gd.count !== 1 ? "s" : "") + " · avg " + (gd.totalPct / gd.count).toFixed(1) + "%</span></div>";
          });
          html += '</div>';
        }

        // By topic (All Topics view only)
        if (analyticsTopicVal === "all") {
          var byTopic = {};
          filtered.forEach(function (s) {
            var tid = s.topicId || "unknown";
            if (!byTopic[tid]) byTopic[tid] = { topic: s.topic || tid, count: 0, totalPct: 0 };
            byTopic[tid].count++;
            byTopic[tid].totalPct += (s.pct || 0);
          });
          var topicEntries = Object.entries(byTopic).sort(function (a, b) {
            return (b[1].totalPct / b[1].count) - (a[1].totalPct / a[1].count);
          });
          if (topicEntries.length) {
            html += '<div class="analytics-overall-row" style="padding-bottom:4px"><span class="analytics-overall-key">By Topic (avg score)</span></div>';
            html += '<div class="analytics-subrows">';
            topicEntries.forEach(function (e) {
              var td = e[1];
              html += '<div class="analytics-grade-row"><span class="analytics-grade-key">' + escHtml(td.topic) + '</span><span class="analytics-grade-val">' + td.count + ' attempt' + (td.count !== 1 ? "s" : "") + " · avg " + (td.totalPct / td.count).toFixed(1) + "%</span></div>";
            });
            html += '</div>';
          }
        }

        html += '</div>'; // analytics-overall

        el.innerHTML = html;
      }

      // ── AI Insights (Groq) ──
      var GROQ_API_KEY = window.GROQ_API_KEY || "";
      var groqScopeVal = "all";
      var groqAnalysisTypeVal = "struggling";

      function buildWrongStats(filtered, topicId) {
        var isAllTopics = !topicId || topicId === "all";
        var totalAttempts = filtered.length;

        // Collect wrong counts per question; track topic label for all-topics view
        var wrongCounts = {};
        filtered.forEach(function (score) {
          if (!score.wrong || !Array.isArray(score.wrong)) return;
          score.wrong.forEach(function (w) {
            var key = w.q;
            if (!wrongCounts[key]) {
              wrongCounts[key] = { count: 0, topChoices: {}, correct: w.correct, topic: score.topic || score.topicId || "" };
            }
            wrongCounts[key].count++;
            wrongCounts[key].topChoices[w.chosen] = (wrongCounts[key].topChoices[w.chosen] || 0) + 1;
          });
        });

        if (isAllTopics) {
          // Sort by wrong count descending, return top 12 most-missed questions
          var sorted = Object.entries(wrongCounts).sort(function (a, b) { return b[1].count - a[1].count; }).slice(0, 12);
          if (!sorted.length) return "  (no wrong-answer data recorded yet)";
          return sorted.map(function (e) {
            var q = e[0], d = e[1];
            var pct = totalAttempts > 0 ? Math.round((1 - d.count / totalAttempts) * 100) : 0;
            var topWrong = Object.entries(d.topChoices).sort(function (a, b) { return b[1] - a[1]; })[0];
            return "  [" + d.topic + "] \"" + q + "\" — " + d.count + " wrong (" + pct + "% correct)" +
              (topWrong ? " | Most chosen wrong: \"" + topWrong[0] + "\"" : "");
          }).join("\n");
        }

        // Topic-specific: use DATA questions so 100%-correct ones appear too
        var section = DATA && DATA.sections ? DATA.sections.find(function (s) { return s.id === topicId; }) : null;
        var lines = [];
        if (section && section.questions && section.questions.length) {
          section.questions.forEach(function (q, idx) {
            var d = wrongCounts[q.q];
            var wrongCount = d ? d.count : 0;
            var pct = totalAttempts > 0 ? Math.round((totalAttempts - wrongCount) / totalAttempts * 100) : 0;
            var line = "  Q" + (idx + 1) + " (" + pct + "% correct, " + wrongCount + " wrong out of " + totalAttempts + "): \"" + q.q + "\"";
            if (d && d.count > 0) {
              var topWrong = Object.entries(d.topChoices).sort(function (a, b) { return b[1] - a[1]; })[0];
              line += " | Most chosen wrong: \"" + topWrong[0] + "\"";
            }
            lines.push(line);
          });
        } else {
          Object.entries(wrongCounts).sort(function (a, b) { return b[1].count - a[1].count; }).forEach(function (e) {
            var d = e[1];
            var pct = totalAttempts > 0 ? Math.round((totalAttempts - d.count) / totalAttempts * 100) : 0;
            var topWrong = Object.entries(d.topChoices).sort(function (a, b) { return b[1] - a[1]; })[0];
            var line = "  (" + pct + "% correct, " + d.count + " wrong): \"" + e[0] + "\"";
            if (topWrong) line += " | Most chosen wrong: \"" + topWrong[0] + "\"";
            lines.push(line);
          });
        }
        return lines.length ? lines.join("\n") : "  (no wrong-answer data recorded yet)";
      }

      function buildScoreSummary(scores, scope) {
        var filtered = scope === "all" ? scores : scores.filter(function (s) { return s.topicId === scope; });
        if (!filtered.length) return "No score data available for the selected scope.";
        var total = filtered.length;
        var avg = (filtered.reduce(function (a, s) { return a + (s.pct || 0); }, 0) / total).toFixed(1);
        var perfect = filtered.filter(function (s) { return s.pct >= 100; }).length;
        var byGrade = {};
        filtered.forEach(function (s) {
          var gr = s.grade || "Unknown";
          if (!byGrade[gr]) byGrade[gr] = { count: 0, totalPct: 0 };
          byGrade[gr].count++;
          byGrade[gr].totalPct += (s.pct || 0);
        });
        var gradeLines = Object.entries(byGrade).map(function (e) {
          return "  - " + e[0] + ": " + e[1].count + " attempts, avg " + (e[1].totalPct / e[1].count).toFixed(1) + "%";
        }).join("\n") || "  (no grade data)";

        var parts = [
          "Total attempts: " + total,
          "Average score: " + avg + "%",
          "Perfect scores: " + perfect,
          "By grade level:\n" + gradeLines
        ];

        if (scope !== "all") {
          var section = DATA && DATA.sections ? DATA.sections.find(function (s) { return s.id === scope; }) : null;
          parts.unshift("Topic: " + (section ? section.title : scope));
        } else {
          var byTopic = {};
          filtered.forEach(function (s) {
            var tid = s.topicId || "unknown";
            if (!byTopic[tid]) byTopic[tid] = { topic: s.topic || tid, count: 0, totalPct: 0 };
            byTopic[tid].count++;
            byTopic[tid].totalPct += (s.pct || 0);
          });
          parts.push("By topic (avg score):\n" + Object.values(byTopic).map(function (t) {
            return "  - " + t.topic + ": " + t.count + " attempts, avg " + (t.totalPct / t.count).toFixed(1) + "%";
          }).join("\n"));
        }

        // Always include wrong-answer breakdown
        parts.push("Questions students got wrong most (sorted by wrong count):\n" + buildWrongStats(filtered, scope === "all" ? "all" : scope));

        return parts.join("\n");
      }

      function buildGroqPrompt(summary, analysisType) {
        var isTopicScope = groqScopeVal !== "all";
        var focusMap = {
          general:         "Summarize overall performance. Highlight which questions or topics had the most wrong answers and what misconceptions those reveal.",
          struggling:      "Focus specifically on where students got the most answers wrong. For each high-miss question, name the concept being tested and explain the likely misconception based on the most common wrong answer chosen.",
          grade:           "Analyze how wrong-answer rates differ across grade levels. Which grade struggles most and on which topics?",
          trends:          "Analyze score trends and wrong-answer patterns over time.",
          recommendations: "Based on the questions students got wrong most, give concrete teaching recommendations. Name the specific concepts to re-teach and suggest how to address the most common misconception for each."
        };
        var focus = focusMap[analysisType] || focusMap.struggling;
        var systemMsg = "You are an educational data analyst for SALIN-LAHI, a cultural heritage quiz kiosk about Olongapo City, Philippines. " +
          "You will receive student quiz performance data including the questions students missed most, wrong-answer counts, and the most common incorrect answer chosen for each question. " +
          "Respond ONLY with a valid JSON object in this exact format (no markdown, no extra text):\n" +
          '{"strengths":["point 1","point 2","point 3"],"weaknesses":["point 1","point 2","point 3"],"improvements":["point 1","point 2","point 3"]}\n' +
          "Focus weaknesses on the specific concepts behind the most-missed questions — describe the concept, not the question number. " +
          "Each point under 28 words. 2–4 points per array.";
        return { system: systemMsg, user: focus + "\n\nDATA:\n" + summary };
      }

      function showGroqLoading() {
        var ph = g("groq-placeholder"), ld = g("groq-loading"), err = g("groq-error"), cards = g("groq-cards");
        if (ph) ph.style.display = "none";
        if (ld) ld.style.display = "block";
        if (err) err.style.display = "none";
        if (cards) {
          cards.style.display = "none";
          ["groq-card-strengths","groq-card-weaknesses","groq-card-improve"].forEach(function(id) {
            var el = g(id); if (el) el.innerHTML = "";
          });
        }
      }

      function showGroqError(msg) {
        var ph = g("groq-placeholder"), ld = g("groq-loading"), cards = g("groq-cards"), err = g("groq-error");
        if (ph) ph.style.display = "none";
        if (ld) ld.style.display = "none";
        if (cards) cards.style.display = "none";
        if (err) { err.style.display = "block"; err.textContent = "⚠ " + msg; }
      }

      function showGroqCards(rawText) {
        var ld = g("groq-loading"), err = g("groq-error"), ph = g("groq-placeholder"), cards = g("groq-cards");
        if (ld) ld.style.display = "none";
        if (err) err.style.display = "none";
        if (ph) ph.style.display = "none";
        var parsed;
        try {
          parsed = JSON.parse(rawText.replace(/^```[a-z]*\n?/gim, "").replace(/```$/gim, "").trim());
        } catch (e) {
          showGroqError("AI returned unexpected format. Try again.");
          return;
        }
        function renderList(arr) {
          if (!Array.isArray(arr) || !arr.length) return "<li>No data.</li>";
          return arr.map(function (item) { return "<li>" + String(item).replace(/</g,"&lt;").replace(/>/g,"&gt;") + "</li>"; }).join("");
        }
        var s = g("groq-card-strengths"), w = g("groq-card-weaknesses"), i = g("groq-card-improve");
        if (s) s.innerHTML = "<ul>" + renderList(parsed.strengths) + "</ul>";
        if (w) w.innerHTML = "<ul>" + renderList(parsed.weaknesses) + "</ul>";
        if (i) i.innerHTML = "<ul>" + renderList(parsed.improvements) + "</ul>";
        if (cards) cards.style.display = "flex";
      }

      async function generateInsights() {
        var scores = window._adminScores || adminScores;
        if (!scores || !scores.length) {
          showGroqError("No scores loaded yet. Open the Scores tab first, then click Generate.");
          return;
        }
        var summary = buildScoreSummary(scores, groqScopeVal);
        var prompt = buildGroqPrompt(summary, groqAnalysisTypeVal);
        showGroqLoading();
        try {
          var res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_API_KEY },
            body: JSON.stringify({
              model: "llama-3.1-8b-instant",
              messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
              max_tokens: groqScopeVal !== "all" ? 600 : 400,
              temperature: 0.6
            })
          });
          if (!res.ok) {
            var errData = await res.json().catch(function () { return {}; });
            throw new Error(errData.error && errData.error.message ? errData.error.message : "HTTP " + res.status);
          }
          var data = await res.json();
          showGroqCards(data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content.trim()
            : '{"strengths":[],"weaknesses":[],"improvements":[]}');
        } catch (e) {
          showGroqError(e.message);
        }
      }

      function wireAdmin() {
        function safe(id, fn) {
          var el = g(id);
          if (el) fn(el); else console.warn("[wireAdmin] missing element #" + id);
        }

        // PIN modal
        safe("btn-admin", function(el) { el.onclick = openPinModal; });
        safe("pin-cancel", function(el) { el.onclick = closePinModal; });
        safe("pin-key-clear", function(el) { el.onclick = pinClear; });
        safe("pin-key-del", function(el) { el.onclick = pinDelete; });
        document.querySelectorAll(".pin-key[data-d]").forEach(function (btn) {
          btn.onclick = function () {
            pinDigit(this.getAttribute("data-d"));
          };
        });

        // Tab switching
        document.querySelectorAll(".admin-tab-btn").forEach(function (btn) {
          btn.onclick = function () {
            showAdminTab(this.getAttribute("data-tab"));
          };
        });

        // Search
        safe("admin-search", function(el) {
          el.oninput = function () {
            adminFilterSearch = this.value;
            renderAdminTable();
          };
        });

        // Topic filter
        safe("admin-topic-filter", function(el) {
          el.onchange = function () {
            adminFilterTopic = this.value;
            renderAdminTable();
          };
        });

        // Export CSV
        safe("admin-export-btn", function(el) { el.onclick = exportAdminCSV; });

        // Clear all — show confirm box
        safe("admin-clear-btn", function(el) {
          el.onclick = function () {
            var box = g("clear-confirm-box");
            var inp = g("clear-confirm-input");
            var okBtn = g("clear-ok-btn");
            if (box) box.classList.add("open");
            if (inp) inp.value = "";
            if (okBtn) { okBtn.textContent = "Delete All"; okBtn.disabled = false; }
          };
        });
        safe("clear-cancel-btn", function(el) {
          el.onclick = function () {
            var box = g("clear-confirm-box");
            if (box) box.classList.remove("open");
          };
        });
        safe("clear-ok-btn", function(el) {
          el.onclick = async function () {
            var inp = g("clear-confirm-input");
            if (!inp || inp.value !== "CLEAR") {
              showToast('Type CLEAR exactly to confirm.');
              return;
            }
            el.textContent = "Deleting…";
            el.disabled = true;
            try {
              await window.fbClearAllScores();
              adminScores = [];
              var box = g("clear-confirm-box");
              if (box) box.classList.remove("open");
              renderAdminTable();
              renderAdminStats();
              updateLeaderboardPreview();
              showToast("All scores cleared.");
            } catch (e) {
              showToast("Clear failed: " + e.message);
              el.textContent = "Delete All";
              el.disabled = false;
            }
          };
        });

        // Change PIN
        safe("pin-save-btn", function(el) {
          el.onclick = async function () {
            var spEl = g("pin-secret-pw");
            var npEl = g("pin-new");
            var cpEl = g("pin-confirm-input2");
            var msg  = g("pin-save-msg");
            var sp = spEl ? spEl.value : "";
            var np = npEl ? npEl.value.trim() : "";
            var cp = cpEl ? cpEl.value.trim() : "";
            if (sp !== "aplus") {
              if (msg) { msg.textContent = "Incorrect secret password."; msg.className = "settings-msg err"; }
              return;
            }
            if (!/^\d{4}$/.test(np)) {
              if (msg) { msg.textContent = "PIN must be exactly 4 digits."; msg.className = "settings-msg err"; }
              return;
            }
            if (np !== cp) {
              if (msg) { msg.textContent = "PINs do not match."; msg.className = "settings-msg err"; }
              return;
            }
            el.disabled = true;
            try {
              await window.fbSetAdminPin(np);
              ADMIN_PIN = np;
              if (spEl) spEl.value = "";
              if (npEl) npEl.value = "";
              if (cpEl) cpEl.value = "";
              if (msg) { msg.textContent = "PIN saved — active on all devices."; msg.className = "settings-msg ok"; }
            } catch (e) {
              if (msg) { msg.textContent = "Save failed: " + e.message; msg.className = "settings-msg err"; }
            } finally {
              el.disabled = false;
            }
          };
        });

        // Presentation PIN change
        safe("pres-pin-save-btn", function(el) {
          el.onclick = async function () {
            var spEl = g("pres-pin-secret-pw");
            var npEl = g("pres-pin-new");
            var cpEl = g("pres-pin-confirm");
            var msg  = g("pres-pin-save-msg");
            var sp = spEl ? spEl.value : "";
            var np = npEl ? npEl.value.trim() : "";
            var cp = cpEl ? cpEl.value.trim() : "";
            if (sp !== "aplus") {
              if (msg) { msg.textContent = "Incorrect secret password."; msg.className = "settings-msg err"; }
              return;
            }
            if (!/^\d{4}$/.test(np)) {
              if (msg) { msg.textContent = "PIN must be exactly 4 digits."; msg.className = "settings-msg err"; }
              return;
            }
            if (np !== cp) {
              if (msg) { msg.textContent = "PINs do not match."; msg.className = "settings-msg err"; }
              return;
            }
            el.disabled = true;
            try {
              await window.fbSetPresPin(np);
              PRESENTATION_PIN = np;
              if (spEl) spEl.value = "";
              if (npEl) npEl.value = "";
              if (cpEl) cpEl.value = "";
              if (msg) { msg.textContent = "Presentation PIN saved — active on all devices."; msg.className = "settings-msg ok"; }
            } catch (e) {
              if (msg) { msg.textContent = "Save failed: " + e.message; msg.className = "settings-msg err"; }
            } finally {
              el.disabled = false;
            }
          };
        });

        // Analytics topic select
        safe("analytics-topic-select", function(el) {
          el.onchange = function () {
            analyticsTopicVal = this.value;
            buildAnalytics();
          };
        });

        // AI Insights
        safe("groq-analyze-btn", function(el) { el.onclick = generateInsights; });
        function wireGroqDropdown(ddId, onSelect) {
          var dd = g(ddId);
          if (!dd) return;
          var trigger = dd.querySelector(".groq-dd-trigger");
          var label   = dd.querySelector(".groq-dd-label");
          var items   = dd.querySelectorAll(".groq-dd-item");
          if (trigger) {
            trigger.onclick = function(e) {
              e.stopPropagation();
              document.querySelectorAll(".groq-dd.open").forEach(function(el) { if (el !== dd) el.classList.remove("open"); });
              dd.classList.toggle("open");
            };
          }
          items.forEach(function(item) {
            item.onclick = function(e) {
              e.stopPropagation();
              items.forEach(function(i) { i.classList.remove("selected"); });
              item.classList.add("selected");
              if (label) label.textContent = item.textContent.trim();
              onSelect(item.getAttribute("data-value"));
              dd.classList.remove("open");
            };
          });
        }
        wireGroqDropdown("groq-scope-dd", function(val) { groqScopeVal = val; });
        wireGroqDropdown("groq-type-dd",  function(val) { groqAnalysisTypeVal = val; });
        document.addEventListener("click", function() {
          document.querySelectorAll(".groq-dd.open").forEach(function(el) { el.classList.remove("open"); });
        });

        // Idle timer
        safe("idle-apply-btn", function(el) {
          el.onclick = function () {
            var val = parseInt(g("idle-input") ? g("idle-input").value : "0", 10);
            var msg = g("idle-msg");
            if (isNaN(val) || val < 10 || val > 600) {
              if (msg) { msg.textContent = "Enter a value between 10 and 600 seconds."; msg.className = "settings-msg err"; }
              return;
            }
            IDLE_TIMEOUT = val * 1000;
            resetIdle();
            if (msg) { msg.textContent = "Idle timeout set to " + val + "s."; msg.className = "settings-msg ok"; }
          };
        });

        // ── Presentation tab ──
        safe("ap-admin-start-btn",  function(el) { el.onclick = apStart; });
        safe("ap-admin-pause-btn",  function(el) { el.onclick = apPause; });
        safe("ap-admin-resume-btn", function(el) { el.onclick = apResume; });
        safe("ap-admin-stop-btn",   function(el) { el.onclick = apStop; });

        safe("ap-add-step-btn", function(el) {
          el.onclick = function () {
            var config = _apReadFlowFromUI();
            config.steps.push({ type: "idle", duration: 3000 });
            _apConfig = config;
            _apBuildFlowUI();
          };
        });

        safe("ap-flow-save-btn", function(el) {
          el.onclick = function () {
            var config = _apReadFlowFromUI();
            apSaveConfig(config);
            var msg = g("ap-flow-msg");
            if (msg) { msg.textContent = "Flow saved locally."; msg.className = "settings-msg ok"; setTimeout(function(){ msg.textContent = ""; }, 2500); }
          };
        });

        safe("ap-flow-save-default-btn", function(el) {
          el.onclick = async function () {
            var config = _apReadFlowFromUI();
            var msg = g("ap-flow-msg");
            el.disabled = true;
            try {
              await window.fbSetPresFlow(config);
              apSaveConfig(config);
              if (msg) { msg.textContent = "Default flow saved — synced to all devices."; msg.className = "settings-msg ok"; setTimeout(function(){ msg.textContent = ""; }, 3000); }
            } catch (e) {
              if (msg) { msg.textContent = "Save failed: " + e.message; msg.className = "settings-msg err"; }
            } finally {
              el.disabled = false;
            }
          };
        });

        safe("ap-flow-reset-btn", function(el) {
          el.onclick = async function () {
            var msg = g("ap-flow-msg");
            el.disabled = true;
            try {
              var firestoreFlow = window.fbGetPresFlow ? await window.fbGetPresFlow() : null;
              var flow = firestoreFlow || JSON.parse(JSON.stringify(AP_DEFAULTS));
              apSaveConfig(flow);
              _apBuildFlowUI();
              var label = firestoreFlow ? "Loaded saved default flow." : "Reset to factory default.";
              if (msg) { msg.textContent = label; msg.className = "settings-msg ok"; setTimeout(function(){ msg.textContent = ""; }, 2500); }
            } catch (e) {
              apSaveConfig(JSON.parse(JSON.stringify(AP_DEFAULTS)));
              _apBuildFlowUI();
              if (msg) { msg.textContent = "Reset to factory default."; msg.className = "settings-msg ok"; setTimeout(function(){ msg.textContent = ""; }, 2500); }
            } finally {
              el.disabled = false;
            }
          };
        });

      }

      startIdleCycle();
