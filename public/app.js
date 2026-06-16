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
        ttsUtt = null;
      var currentSection = null;

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
      }
      document.getElementById("idle").addEventListener("click", function () {
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
            if (dx < 0 && cur === 0) goTo(1);
            if (dx > 0 && cur === 1) goTo(0);
          }
        },
        { passive: true },
      );

      // ── Overlay helpers ──
      function openOverlay(id) {
        document.getElementById(id).classList.add("open");
      }
      function closeOverlay(id) {
        ttsStop();
        document.getElementById(id).classList.remove("open");
      }
      function goBack() {
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
      }

      function resumeIdleTimer() {
        // called when TTS ends/stops — restart the countdown
        ttsActive = false;
        resetIdle();
      }

      // reset on any user interaction
      document.addEventListener("touchstart", resetIdle, { passive: true });
      document.addEventListener("mousedown", resetIdle);
      document.addEventListener("touchend", resetIdle, { passive: true });

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
        };
        g("btn-lb").onclick = async function () {
          openOverlay("ov-lb");
          await buildLeaderboard();
        };
        g("tts-play").onclick = ttsPlay;
        g("tts-stop").onclick = ttsStop;
        g("tl-tts-play").onclick = tlTtsPlay;
        g("tl-tts-stop").onclick = ttsStop;
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
      function buildCity() {
        var c = DATA.city;
        var html = "";
        html +=
          '<div class="city-hero"><img src="assets/homepage/ulo-ng-apo.jpg"' +
          c.photo_url +
          '" alt="' +
          c.name +
          '" onerror="this.src=\'\'">';
        html +=
          '<div class="city-hero-overlay"><div class="city-hero-title">' +
          c.name +
          "</div>";
        html +=
          '<div class="city-hero-sub">' +
          c.province +
          " &middot; " +
          c.region +
          "</div></div></div>";
        html += '<div class="city-pad">';
        html += '<div class="stat-row">';
        html +=
          '<div class="stat-box" style="background:rgba(245,166,35,.12);border:1px solid rgba(245,166,35,.3)"><div class="stat-box-val" style="color:#F5A623">' +
          c.population +
          '</div><div class="stat-box-lbl">Population</div></div>';
        html +=
          '<div class="stat-box" style="background:rgba(245,166,35,.12);border:1px solid rgba(245,166,35,.3)"><div class="stat-box-val" style="color:#F5A623">' +
          c.barangays +
          '</div><div class="stat-box-lbl">Barangays</div></div>';
        html +=
          '<div class="stat-box" style="background:rgba(245,166,35,.12);border:1px solid rgba(245,166,35,.3)"><div class="stat-box-val" style="color:#F5A623">1966</div><div class="stat-box-lbl">City Founded</div></div>';
        html += "</div>";
        html +=
          '<div class="map-box"><img src="' +
          c.map_photo +
          '" alt="Map" onerror="this.style.display=\'none\'"><div class="map-box-lbl">📍 Olongapo City, Zambales — Central Luzon, Philippines</div></div>';
        html += '<div class="city-desc">' + c.description + "</div>";
        html += '<div class="facts-box">';
        html += '<div class="facts-head">Quick Facts</div>';
        var facts = [
          ["Founded", c.founded],
          ["Province", c.province],
          ["Region", c.region],
          ["Area", c.area],
          ["Mayor", c.mayor],
        ];
        facts.forEach(function (f) {
          html +=
            '<div class="fact-row"><span class="fact-k">' +
            f[0] +
            '</span><span class="fact-v">' +
            f[1] +
            "</span></div>";
        });
        html += "</div></div>";
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

      function sectionEmoji(id) {
        var map = {
          location: "🗺️",
          aeta: "🏹",
          history: "⛪",
          navy: "⚓",
          independence: "🕊️",
          culture: "🎉",
          demographics: "👥",
          tourism: "🏖️",
          smartcity: "🤖",
        };
        return map[id] || "📖";
      }

      function openSection(id) {
        var s = DATA.sections.find(function (x) {
          return x.id === id;
        });
        currentSection = s;
        g("detail-topbar-title").textContent = s.title;
        g("detail-station").textContent = s.station;
        g("detail-title").textContent = s.title;
        g("detail-caption").textContent = s.photo_caption || "";
        var img = g("detail-img");
        img.src = s.photo_url || "";
        img.onerror = function () {
          g("detail-hero").style.display = "none";
        };
        g("detail-hero").style.display = "";
        var paras = s.content.split("\n\n"),
          h = "";
        paras.forEach(function (p) {
          if (p.trim()) h += "<p>" + p.trim() + "</p>";
        });
        g("detail-text").innerHTML = h;
        g("tts-play").style.display = "inline-flex";
        g("tts-stop").style.display = "none";
        g("tts-status").textContent = "";
        g("detail-quiz-btn").onclick = function () {
          closeOverlay("ov-detail");
          resetQuizSelect();
          startQuiz(s.id);
          openOverlay("ov-quiz");
        };
        closeOverlay("ov-guide");
        openOverlay("ov-detail");
        showToast("Station: " + s.station);
      }

      // ── TTS ──
      function ttsPlay() {
        if (!window.speechSynthesis) {
          alert("Text-to-speech not supported on this device.");
          return;
        }
        pauseIdleTimer(); // pause idle countdown while listening
        window.speechSynthesis.cancel();
        var raw = g("detail-text").innerText || g("detail-text").textContent;
        if (!raw.trim()) return;
        g("tts-play").style.display = "none";
        g("tts-stop").style.display = "inline-flex";
        g("tts-status").textContent = "Reading aloud...";
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
      function ttsStop() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        ttsChunks = [];
        ttsIdx = 9999;
        var p = g("tts-play"),
          s = g("tts-stop"),
          st = g("tts-status");
        if (p) p.style.display = "inline-flex";
        if (s) s.style.display = "none";
        if (st) st.textContent = "";
        var tlp = g("tl-tts-play"),
          tls = g("tl-tts-stop"),
          tlst = g("tl-tts-status");
        if (tlp) tlp.style.display = "inline-flex";
        if (tls) tls.style.display = "none";
        if (tlst) tlst.textContent = "";
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
          year: "February 9, 1966",
          title: "City of Olongapo",
          sub: "Chartered & Independent",
          body: "Republic Act No. 4645, signed on February 9, 1966, officially converted Olongapo from a municipality into an independent chartered city. This date is celebrated annually as the city's founding anniversary.",
          did: "Mayor Catalino Cahigan Ramos served as the first elected mayor of the newly chartered Olongapo City, overseeing its rapid urban development under the presence of the nearby US Naval Base.",
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

      function buildTimeline() {
        var carousel = g("tl-carousel");
        var dotsWrap = g("tl-dots");
        if (!carousel || !dotsWrap) return;

        var slides = "";
        var dots = "";
        TL_ITEMS.forEach(function (item, i) {
          var imgExt = i === 0 || i === 6 ? "png" : "jpg";
          var imgSrc = "assets/timeline/timeline-" + (i + 1) + "." + imgExt;
          slides += '<section class="tl-slide" aria-label="' + item.year + '">';
          slides +=
            '<img class="tl-slide-img" src="' +
            imgSrc +
            '" alt="' +
            item.title +
            '" />';
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

      var GROQ_API_KEY = "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";
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
