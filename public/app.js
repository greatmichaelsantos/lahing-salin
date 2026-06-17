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
        var VOLS = { idle: 0.40, active: 0.20, tts: 0.05 };
        var _state  = "idle";
        var _muted  = false;
        var _ready  = false;   // true after first successful play()
        var _fadeTimer = null;

        function _audio() { return document.getElementById("bg-audio"); }

        function _fadeTo(target, ms) {
          var el = _audio();
          if (!el) return;
          if (_fadeTimer) { clearInterval(_fadeTimer); _fadeTimer = null; }
          var from  = el.volume;
          var delta = target - from;
          if (Math.abs(delta) < 0.001) { el.volume = target; return; }
          var steps = Math.max(1, Math.round(ms / 40));
          var step  = 0;
          _fadeTimer = setInterval(function () {
            step++;
            var t = step / steps;
            var eased = 1 - Math.pow(1 - t, 2); // ease-out quad
            el.volume = Math.min(1, Math.max(0, from + delta * eased));
            if (step >= steps) {
              el.volume = target;
              clearInterval(_fadeTimer);
              _fadeTimer = null;
            }
          }, 40);
        }

        function _applyVolume() {
          _fadeTo(_muted ? 0 : (VOLS[_state] || 0.50), 700);
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
          el.volume = 0;
          var p = el.play();
          if (p && typeof p.then === "function") {
            p.then(function () {
              _ready = true;
              _applyVolume();
            }).catch(function (err) {
              console.warn("BGAudio: play() blocked —", err.message);
              // Re-register so the next interaction retries
              document.addEventListener("touchstart", _bgAudioFirstStart, { passive: true });
              document.addEventListener("mousedown", _bgAudioFirstStart);
              document.addEventListener("click", _bgAudioFirstStart);
            });
          } else {
            // Older browsers return undefined — assume it worked
            _ready = true;
            _applyVolume();
          }
        }

        function setState(s) {
          if (_state === s) return;
          _state = s;
          if (_ready) _applyVolume();
        }

        function toggleMute() {
          _muted = !_muted;
          if (!_ready) start();
          _applyVolume();
          _updateBtn();
        }

        return { start: start, setState: setState, toggleMute: toggleMute };
      }());

      // Recalculates which BGAudio volume level is appropriate for current state
      function bgAudioUpdate() {
        if (ttsActive) { BGAudio.setState("tts"); return; }
        BGAudio.setState(cur === 0 ? "idle" : "active");
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
      function tryFullscreen() {
        var el = document.documentElement;
        var req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
        if (req && !document.fullscreenElement && !document.webkitFullscreenElement) {
          req.call(el).catch(function () {});
        }
      }

      // Re-enter fullscreen if user exits (e.g. presses Escape) — kiosk behaviour
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
          body: "The mayor is like the <strong>captain</strong> of the whole city! Mayor Rolen C. Paulino Jr. leads the city government and makes big decisions — like where to build new roads, parks, and schools. Think of the mayor as a school principal... but for <em>the entire city</em>! 🗳️ The mayor is chosen by the people through elections, which means every single vote really counts."
        },
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
        "#38BDF8",
        "#F5A623",
        "#EF6C5C",
        "#8B5CF6",
        "#22C55E",
        "#06B6A4",
        "#F472B6",
        "#FB923C",
        "#A3E635",
      ];
      function buildGuide() {
        var html = "";
        DATA.sections.forEach(function (s, i) {
          var c = COLORS[i % COLORS.length];
          var preview = s.content.split("\n\n")[0].substring(0, 90) + "...";
          html += '<div class="exp-card" data-id="' + s.id + '">';
          html +=
            '<div class="exp-card-stripe" style="background:' + c + '"></div>';
          html += '<div class="exp-card-inner">';
          html +=
            '<div class="exp-card-icon" style="background:' +
            c +
            "22;color:" +
            c +
            '">' +
            sectionEmoji(s.id) +
            "</div>";
          html += '<div class="exp-card-body">';
          html +=
            '<div class="exp-card-station" style="color:' +
            c +
            '">' +
            s.station +
            "</div>";
          html += '<div class="exp-card-title">' + s.title + "</div>";
          html += '<div class="exp-card-preview">' + preview + "</div>";
          html += "</div></div>";
          html +=
            '<div class="exp-card-footer"><span class="exp-card-cta">Read More</span><span class="exp-card-arrow">›</span></div></div>';
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
        DATA.sections.forEach(function (s) {
          h +=
            '<button class="quiz-topic-btn" data-id="' +
            s.id +
            '" style="border-color:' +
            s.color +
            '44">';
          h +=
            '<div class="quiz-topic-name" style="color:' +
            s.color +
            '">' +
            sectionEmoji(s.id) +
            " " +
            s.title +
            "</div>";
          h +=
            '<div class="quiz-topic-count">' +
            s.questions.length +
            " questions</div></button>";
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
        // timeline-1: a=png, b-j=jpg
        ["timeline-1a.png","timeline-1b.jpg","timeline-1c.jpg","timeline-1d.jpg","timeline-1e.jpg","timeline-1f.jpg","timeline-1g.jpg","timeline-1h.jpg","timeline-1i.jpg","timeline-1j.jpg"],
        // timeline-2: all jpg
        ["timeline-2a.jpg","timeline-2b.jpg","timeline-2c.jpg","timeline-2d.jpg","timeline-2e.jpg","timeline-2f.jpg","timeline-2g.jpg","timeline-2h.jpg","timeline-2i.jpg","timeline-2j.jpg"],
        // timeline-3: all jpg
        ["timeline-3a.jpg","timeline-3b.jpg","timeline-3c.jpg","timeline-3d.jpg","timeline-3e.jpg","timeline-3f.jpg","timeline-3g.jpg","timeline-3h.jpg","timeline-3i.jpg","timeline-3j.jpg"],
        // timeline-4: all jpg
        ["timeline-4a.jpg","timeline-4b.jpg","timeline-4c.jpg","timeline-4d.jpg","timeline-4e.jpg","timeline-4f.jpg","timeline-4g.jpg","timeline-4h.jpg","timeline-4i.jpg","timeline-4j.jpg"],
        // timeline-5: all jpg
        ["timeline-5a.jpg","timeline-5b.jpg","timeline-5c.jpg","timeline-5d.jpg","timeline-5e.jpg","timeline-5f.jpg","timeline-5g.jpg","timeline-5h.jpg","timeline-5i.jpg","timeline-5j.jpg"],
        // timeline-6: a-e=jpg, f=png, g-j=jpg
        ["timeline-6a.jpg","timeline-6b.jpg","timeline-6c.jpg","timeline-6d.jpg","timeline-6e.jpg","timeline-6f.png","timeline-6g.jpg","timeline-6h.jpg","timeline-6i.jpg","timeline-6j.jpg"],
        // timeline-7: a=png, b-d=jpg, e=filename typo on disk, f-g=jpg, h=jpeg, i-j=jpg
        ["timeline-7a.png","timeline-7b.jpg","timeline-7c.jpg","timeline-7d.jpg","timetine-7e.jpg","timeline-7f.jpg","timeline-7g.jpg","timeline-7h.jpg","timeline-7i.jpg","timeline-7j.jpg"],
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
      var ADMIN_PIN = "1234"; // TODO: change this PIN
      var pinBuffer = "";
      var adminScores = [];
      var adminLastSync = null;
      var adminFilterSearch = "";
      var adminFilterTopic = "all";

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

      // ── Admin overlay ──
      async function openAdminDashboard() {
        openOverlay("ov-admin");
        showAdminTab("scores");
        await loadAdminScores();
        if (window._adminScores && window._adminScores.length > 0) {
          generateInsights();
        } else {
          setTimeout(function () {
            if (window._adminScores && window._adminScores.length > 0) generateInsights();
          }, 1500);
        }
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
        ["scores", "stats", "settings"].forEach(function (t) {
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
      }

      // ── AI Insights (Groq) ──
      function buildScoreSummary(scores, scope) {
        var filtered = scope === "all" ? scores : scores.filter(function (s) { return s.topicId === scope; });
        if (!filtered.length) return "No score data available for the selected topic.";
        var total = filtered.length;
        var avg = (filtered.reduce(function (a, s) { return a + (s.pct || 0); }, 0) / total).toFixed(1);
        var perfect = filtered.filter(function (s) { return s.pct >= 100; }).length;
        var byTopic = {};
        filtered.forEach(function (s) {
          var tid = s.topicId || "unknown";
          if (!byTopic[tid]) byTopic[tid] = { topic: s.topic || tid, count: 0, totalPct: 0 };
          byTopic[tid].count++;
          byTopic[tid].totalPct += (s.pct || 0);
        });
        var topicLines = Object.values(byTopic).map(function (t) {
          return "  - " + t.topic + ": " + t.count + " attempts, avg " + (t.totalPct / t.count).toFixed(1) + "%";
        }).join("\n");
        var byGrade = {};
        filtered.forEach(function (s) {
          var gr = s.grade || "Unknown";
          if (!byGrade[gr]) byGrade[gr] = { count: 0, totalPct: 0 };
          byGrade[gr].count++;
          byGrade[gr].totalPct += (s.pct || 0);
        });
        var gradeLines = Object.values(byGrade).length
          ? Object.entries(byGrade).map(function (e) {
              return "  - Grade " + e[0] + ": " + e[1].count + " attempts, avg " + (e[1].totalPct / e[1].count).toFixed(1) + "%";
            }).join("\n")
          : "  (no grade data)";
        return [
          "Total attempts: " + total,
          "Average score: " + avg + "%",
          "Perfect scores: " + perfect,
          "By topic:\n" + topicLines,
          "By grade level:\n" + gradeLines
        ].join("\n");
      }

      function buildGroqPrompt(summary, analysisType) {
        var focusMap = {
          general: "Provide a general overview of student performance.",
          struggling: "Identify where students struggle most. Which topics have the lowest average scores?",
          grade: "Analyze performance differences across grade levels.",
          trends: "Analyze score trends and patterns.",
          recommendations: "Provide concrete teaching recommendations based on this data."
        };
        var focus = focusMap[analysisType] || "Provide a general overview.";
        var systemMsg = "You are an educational data analyst for SALIN-LAHI, a cultural heritage quiz kiosk about Olongapo City. " +
          "You will receive student quiz performance data. Respond ONLY with a valid JSON object in this exact format (no markdown, no extra text):\n" +
          '{"strengths":["point 1","point 2","point 3"],"weaknesses":["point 1","point 2","point 3"],"improvements":["point 1","point 2","point 3"]}\n' +
          "Each array must have 2–4 short, practical bullet points. Keep each point under 20 words.";
        var userMsg = focus + "\n\nDATA:\n" + summary;
        return { system: systemMsg, user: userMsg };
      }

      var GROQ_API_KEY = window.GROQ_API_KEY || "";
      var groqScopeVal = "all";
      var groqAnalysisTypeVal = "general";

      function showGroqLoading() {
        var ph = g("groq-placeholder");
        var ld = g("groq-loading");
        var err = g("groq-error");
        var cards = g("groq-cards");
        if (ph) ph.style.display = "none";
        if (ld) ld.style.display = "block";
        if (err) err.style.display = "none";
        if (cards) {
          cards.style.display = "none";
          var s = g("groq-card-strengths");
          var w = g("groq-card-weaknesses");
          var i = g("groq-card-improve");
          if (s) s.innerHTML = "";
          if (w) w.innerHTML = "";
          if (i) i.innerHTML = "";
        }
      }

      function showGroqError(msg) {
        console.error("[Groq] Error:", msg);
        var ph = g("groq-placeholder");
        var ld = g("groq-loading");
        var cards = g("groq-cards");
        var err = g("groq-error");
        if (ph) ph.style.display = "none";
        if (ld) ld.style.display = "none";
        if (cards) cards.style.display = "none";
        if (err) {
          err.style.display = "block";
          err.textContent = "⚠ " + msg;
        }
      }

      function showGroqCards(rawText) {
        console.log("[Groq] Raw response:", rawText.substring(0, 200));
        var ld = g("groq-loading");
        var err = g("groq-error");
        var ph = g("groq-placeholder");
        var cards = g("groq-cards");
        if (ld) ld.style.display = "none";
        if (err) err.style.display = "none";
        if (ph) ph.style.display = "none";

        var parsed;
        try {
          var clean = rawText.replace(/^```[a-z]*\n?/gim, "").replace(/```$/gim, "").trim();
          parsed = JSON.parse(clean);
        } catch (e) {
          console.error("[Groq] JSON parse failed. Raw text:", rawText);
          showGroqError("AI returned unexpected format. Try again.");
          return;
        }

        function renderList(arr) {
          if (!Array.isArray(arr) || !arr.length) return "<li>No data.</li>";
          return arr.map(function (item) {
            return "<li>" + String(item).replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</li>";
          }).join("");
        }

        var s = g("groq-card-strengths");
        var w = g("groq-card-weaknesses");
        var i = g("groq-card-improve");
        if (s) s.innerHTML = "<ul>" + renderList(parsed.strengths) + "</ul>";
        if (w) w.innerHTML = "<ul>" + renderList(parsed.weaknesses) + "</ul>";
        if (i) i.innerHTML = "<ul>" + renderList(parsed.improvements) + "</ul>";

        if (cards) cards.style.display = "flex";
      }

      async function generateInsights() {
        console.log("[Groq] generateInsights() called");
        var scores = window._adminScores || adminScores;
        console.log("[Groq] Score count:", scores ? scores.length : 0);

        if (!scores || !scores.length) {
          showGroqError("No scores loaded yet. Open the Scores tab first, then click Generate.");
          return;
        }

        var scope = groqScopeVal;
        var analysisType = groqAnalysisTypeVal;
        var summary = buildScoreSummary(scores, scope);
        var prompt = buildGroqPrompt(summary, analysisType);

        showGroqLoading();
        console.log("[Groq] Sending request to Groq API… model: llama-3.1-8b-instant");

        try {
          var res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + GROQ_API_KEY
            },
            body: JSON.stringify({
              model: "llama-3.1-8b-instant",
              messages: [
                { role: "system", content: prompt.system },
                { role: "user",   content: prompt.user   }
              ],
              max_tokens: 400,
              temperature: 0.6
            })
          });
          console.log("[Groq] HTTP status:", res.status);
          if (!res.ok) {
            var errData = await res.json().catch(function () { return {}; });
            throw new Error(errData.error && errData.error.message ? errData.error.message : "HTTP " + res.status);
          }
          var data = await res.json();
          var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
            ? data.choices[0].message.content.trim()
            : '{"strengths":[],"weaknesses":[],"improvements":[]}';
          showGroqCards(text);
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
          el.onclick = function () {
            var npEl = g("pin-new");
            var cpEl = g("pin-confirm-input2");
            var msg = g("pin-save-msg");
            var np = npEl ? npEl.value.trim() : "";
            var cp = cpEl ? cpEl.value.trim() : "";
            if (!/^\d{4}$/.test(np)) {
              if (msg) { msg.textContent = "PIN must be exactly 4 digits."; msg.className = "settings-msg err"; }
              return;
            }
            if (np !== cp) {
              if (msg) { msg.textContent = "PINs do not match."; msg.className = "settings-msg err"; }
              return;
            }
            ADMIN_PIN = np;
            if (npEl) npEl.value = "";
            if (cpEl) cpEl.value = "";
            if (msg) { msg.textContent = "PIN updated for this session."; msg.className = "settings-msg ok"; }
          };
        });

        // Generate button — also wired via onclick= in HTML as backup
        safe("groq-analyze-btn", function(el) { el.onclick = generateInsights; });

        // Custom dropdowns
        function wireGroqDropdown(ddId, onSelect) {
          var dd = g(ddId);
          if (!dd) { console.warn("[wireAdmin] missing dropdown #" + ddId); return; }
          var trigger = dd.querySelector(".groq-dd-trigger");
          var label = dd.querySelector(".groq-dd-label");
          var items = dd.querySelectorAll(".groq-dd-item");
          if (trigger) {
            trigger.onclick = function(e) {
              e.stopPropagation();
              document.querySelectorAll(".groq-dd.open").forEach(function(el) {
                if (el !== dd) el.classList.remove("open");
              });
              dd.classList.toggle("open");
            };
          }
          items.forEach(function(item) {
            item.onclick = function(e) {
              e.stopPropagation();
              items.forEach(function(i) { i.classList.remove("selected"); });
              item.classList.add("selected");
              if (label) label.textContent = item.textContent;
              onSelect(item.getAttribute("data-value"));
              dd.classList.remove("open");
            };
          });
        }
        wireGroqDropdown("groq-scope-dd", function(val) { groqScopeVal = val; });
        wireGroqDropdown("groq-type-dd", function(val) { groqAnalysisTypeVal = val; });
        document.addEventListener("click", function() {
          document.querySelectorAll(".groq-dd.open").forEach(function(el) {
            el.classList.remove("open");
          });
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
      }

      startIdleCycle();
