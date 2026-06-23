# SALIN-LAHI
**Olongapo City Digital Heritage Kiosk**
*DOST Smart City Program · Modern Library Movement*

---

## What is SALIN-LAHI?

SALIN-LAHI is an interactive kiosk app that teaches the history and culture of Olongapo City through eight themed heritage stations: Aeta History, Traditional Livelihood, Indigenous Music, Traditional Tools, Cultural Values, Olongapo Origins, Naval Heritage, and People & Culture.

Visitors explore each station by reading content, listening to audio narration, taking a quiz, and checking their score on a shared leaderboard. The name comes from the Filipino phrase meaning "to pass down through generations" — which is exactly what this app is designed to do.

It runs in a web browser (designed for a landscape tablet in kiosk mode) and uses Firebase for real-time data storage so every score and leaderboard update is shared across all devices instantly.

---

## File Structure

The app lives entirely inside the `public/` folder. These are the four main files:

### `public/index.html`
The skeleton of the entire app. Every screen — the idle screen, the dashboard, the Heritage Guide overlay, the quiz, the leaderboard, the timeline, the admin dashboard, and the presentation settings — exists as HTML in this one file. Screens are hidden or shown using CSS classes (`.overlay.open`) rather than loading new pages, which makes navigation feel instant.

### `public/styles.css`
All visual styling: layout, colors, fonts, and animations. The app uses three font families — **Fraunces** (for headings), **Space Grotesk** (for labels and UI chrome), and **Plus Jakarta Sans** (for body content). The color palette is built around Olongapo's city colors: red (`#bd001a`), gold (`#fcd400`), and dark charcoal (`#1b1c1b`).

### `public/app.js`
All the logic — everything that *happens* when you click, swipe, answer a question, or wait too long. This is where the quiz runs, narration plays, scores are saved, overlays open and close, the idle timer counts down, background music fades, and the admin dashboard does its work. It's written in plain JavaScript with no framework, which keeps it fast and easy to run on any browser without a build step.

### `public/firebase.js`
A separate module that handles all communication with Firebase (the cloud database). It exposes clean helper functions (`fbAddScore`, `fbGetScores`, `fbSetAdminPin`, etc.) so the rest of the app never has to know anything about how Firebase works internally. If the database structure ever changes, there's only one file to update.

Other important files in `public/`:
- `data.json` — all content: station text, quiz questions, fun facts, timeline events
- `config.js` — API keys (gitignored, never committed — see below)
- `config.example.js` — a placeholder version of config.js that is safe to commit
- `manifest.json` — makes the app installable as a Progressive Web App (PWA)
- `sw.js` — service worker for offline support
- `assets/` — images, audio files, background music

---

## How `data.json` Works

`data.json` is the single source of truth for all content. When the app loads, it fetches this file once and stores everything in memory.

The file has three main sections:

**`app` / `city`** — Basic metadata: app name, tagline, city stats (population, founded, mayor, etc.) shown in the City Overview panel.

**`sections`** — An array of eight objects, one per heritage station. Each section contains:
- `id` and `title` — used to identify the station in code and on labels
- `content` — the full text read aloud by TTS narration when a station is opened
- `fun_facts` — short highlight cards shown inside the station detail view
- `photo_url` and `audio` — the station photo and its MP3 narration file path
- `questions` — an array of quiz questions, each with:
  - `q` — the question text
  - `opts` — four answer options (an array of strings)
  - `ans` — the index (0–3) of the correct option

**`timeline`** — Historical events shown in the Photo Timeline overlay, each with a year, description, image, and optional audio narration.

To update station text, quiz questions, or timeline events, you only need to edit `data.json` — no JavaScript or HTML changes needed.

---

## Firebase and the Leaderboard

Firebase is a Google cloud service. SALIN-LAHI uses its **Firestore** database — a NoSQL store where data is organized into collections of documents (think: folders of JSON files).

### How scores are saved

When a student finishes a quiz and saves their score, the app builds an entry that looks like this:

```json
{
  "name": "Juan dela Cruz",
  "grade": "Grade 5 — OCES",
  "topic": "Aeta History",
  "score": 4,
  "total": 5,
  "pct": 80,
  "date": "Jun 19, 2026",
  "ts": 1750345200000,
  "wrong": [
    {
      "q": "What geological event exposed the land bridges the Aeta used?",
      "chosen": "The Bronze Age",
      "correct": "The Pleistocene Ice Age"
    }
  ]
}
```

The `wrong` field records every question the student got wrong — what they chose and what the right answer was. Perfect scores don't include it. This makes it possible to see which specific questions are tripping people up, not just overall scores.

### How the leaderboard works

The leaderboard queries the `salinlahi_scores` collection ordered by score percentage descending, then by timestamp ascending (so ties go to whoever scored first). It shows the top 100 entries. Because Firestore is a live cloud database, a score saved on one tablet appears on all devices the next time the leaderboard is opened.

### Security rules

`firestore.rules` controls who can read and write. The app signs visitors in anonymously (no login required), and the rules allow anyone signed in to read scores and create new ones — but not edit or delete. Only the Admin Dashboard (protected by PIN) can delete entries.

---

## Admin Dashboard

The Admin Dashboard is accessed through the **Admin Access** button on the bottom bar. Tapping it shows a PIN pad. Enter the correct 4-digit PIN and the dashboard opens.

The PIN is stored in Firestore, not hardcoded — so it can be changed without editing the source code. It's loaded into memory at startup and compared locally when the user types it in.

Inside the dashboard, admins can:
- Browse all submitted scores with search and filter by topic or grade
- Delete individual scores or clear everything
- View statistics: total attempts, average score, per-topic breakdowns
- Change the Admin PIN or the Presentation PIN
- Adjust the idle timeout duration
- Use the AI Insights panel (see below)

---

## Groq AI Insights

Inside the Admin Dashboard is an **AI Insights** panel powered by [Groq](https://groq.com) — a service that runs large language models extremely fast.

### What it does

When an admin clicks **Generate**:

1. All quiz scores are aggregated into a plain-text summary — total attempts, average score, per-topic averages, per-grade averages
2. That summary is sent to Groq's API with a prompt asking it to act as an educational data analyst
3. Groq runs the **Llama 3.1 8B** model and returns a JSON response in under a second
4. The app parses the JSON and displays three cards: **Strengths**, **Weaknesses**, and **Areas to Improve**

### Why it's useful

Without AI, you'd have to read through hundreds of rows of scores to spot something like "Grade 3 students consistently struggle with Naval Heritage questions." The AI reads all of it and writes a clear summary in seconds.

Admins can filter by topic (e.g., "Aeta History only") or change the analysis type (General Overview, Where Students Struggle, By Grade Level, Score Trends, Teaching Recommendations) to get different angles on the same data.

### The API key

The Groq API key lives in `public/config.js`, which is excluded from Git (listed in `.gitignore`). A safe placeholder file called `public/config.example.js` is committed to the repo instead. Anyone setting up the app from scratch needs to create their own `public/config.js` with a real Groq API key — never commit the real key.

---

## Heritage Guide TTS (Text-to-Speech)

When a student opens a heritage station, the app reads the station content aloud automatically using the browser's built-in **Web Speech API** — no external service, no internet needed.

Long texts are split into smaller chunks before being sent to the speech engine, because some browsers cut off narration after a certain number of characters. As the narration plays, the current sentence is highlighted on screen by estimating word timing based on character length.

TTS works fully offline because it uses the device's own voice engine.

---

## Timeline Audio Narration

The Photo Timeline overlay shows historical photos with descriptions. Each slide can have an associated MP3 file. When a slide appears, its MP3 plays automatically. When the user moves to the next slide, the current audio stops and the new one begins — so the timeline works as a guided audio tour, not just a slideshow.

---

## Background Music

Background music plays through an HTML `<audio>` element routed through the browser's **Web Audio API** (using a GainNode for volume control). This is important because iOS Safari ignores the standard `audio.volume` property — using a GainNode is the only reliable way to control volume on iPhone and iPad.

Music volume depends on what's on screen:

| Screen | Volume |
|---|---|
| Idle / attract screen | 40% |
| Dashboard (no overlay open) | 20% |
| Any overlay open (Heritage Guide, Quiz, Timeline, etc.) | 0% — silent |
| Station audio or TTS playing | 0% — silent |

The mute button in the bottom bar is independent of this logic. If someone manually mutes the music, it stays muted even as they navigate between screens and back to the dashboard.

---

## Idle / Attract Mode

If no interaction is detected for 60 seconds, the app automatically returns to the idle/attract screen — a fullscreen animated background with ambient sound. This is standard kiosk behavior: it ensures the app never gets stuck on a half-finished quiz or an open overlay if someone walks away.

Any touch or click on the idle screen returns to the dashboard and restarts the idle timer.


---

## Running and Deploying

**To run locally:**
```bash
firebase serve
```
This starts a local server at `http://localhost:5000` pointed at the real Firestore project. You need to have `firebase-tools` installed (`npm install -g firebase-tools`) and be logged in (`firebase login`).

**To deploy to production:**
```bash
firebase deploy
```
This publishes the `public/` folder to Firebase Hosting and updates Firestore security rules.

Before running either command, make sure `public/config.js` exists with a valid Groq API key (copy `public/config.example.js` and fill it in).

The live app is at: **https://salin-lahi-apsd.web.app**
