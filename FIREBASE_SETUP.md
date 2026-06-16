# Firebase Setup — SALIN-LAHI Kiosk

Follow these steps once to connect the kiosk to Firestore so quiz scores are shared across all devices.

---

## 1. Create a Firebase Project

1. Go to [https://console.firebase.google.com/](https://console.firebase.google.com/)
2. Click **Add project** → name it (e.g. `salin-lahi`) → click **Create project**
3. Skip Google Analytics if you prefer

---

## 2. Register a Web App & Paste the Config

1. In the project overview click the **`</>`** Web icon → **Add app**
2. Name the app (e.g. `salin-lahi-kiosk`) and click **Register app**
3. Firebase shows a `firebaseConfig` object — copy it
4. Open `index.html` and find the block near the very bottom:

```js
// TODO: Replace the placeholder values below with your Firebase project config.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  ...
};
```

5. Replace every `"YOUR_..."` value with the values from step 3

---

## 3. Enable Anonymous Authentication

1. Firebase Console → **Build → Authentication → Get started**
2. **Sign-in method** tab → click **Anonymous** → toggle **Enable** → **Save**

---

## 4. Create the Firestore Database

1. Firebase Console → **Build → Firestore Database → Create database**
2. Choose **Start in production mode** (the rules file below locks it down)
3. Pick a region close to the Philippines — recommended: **`asia-southeast1` (Singapore)**

---

## 5. Deploy the Security Rules

### Option A — Firebase CLI (recommended for repeatability)

```bash
npm install -g firebase-tools
firebase login
firebase init firestore   # select your project; use "firestore.rules" when asked for the rules file
firebase deploy --only firestore:rules
```

### Option B — Firebase Console

1. Firestore → **Rules** tab
2. Replace the default content with everything in `firestore.rules`
3. Click **Publish**

---

## 6. Create the Required Composite Index

The leaderboard query orders by **`pct` DESC** then **`ts` ASC**, which requires a composite index.

**Easiest way:** open the kiosk in a browser, click the Leaderboard tile, then check the browser DevTools console. Firebase will log a direct URL to auto-create the index — just click it and confirm.

**Manual way:**
1. Firestore → **Indexes** tab → **Composite** → **Create index**
2. Fill in:
   - Collection ID: `salinlahi_scores`
   - Field 1: `pct` — **Descending**
   - Field 2: `ts` — **Ascending**
   - Query scope: **Collection**
3. Click **Create index** (takes ~1 minute to build)

---

## 7. Clearing Scores (Admin Only)

Because the security rules block client-side deletes, museum staff must clear scores through the Firebase Console:

1. Firestore → **Data** tab
2. Select the `salinlahi_scores` collection
3. Delete individual documents, or use **Delete collection** to wipe all scores

---

## Document Schema

Each quiz result is stored as a Firestore document with these fields:

| Field     | Type   | Description                          |
|-----------|--------|--------------------------------------|
| `name`    | string | Player name (defaults to "Anonymous") |
| `grade`   | string | Grade & school (optional)            |
| `topic`   | string | Quiz topic title                     |
| `topicId` | string | Quiz topic ID (for leaderboard filter)|
| `score`   | number | Correct answers                      |
| `total`   | number | Total questions                      |
| `pct`     | number | Percentage (0–100)                   |
| `date`    | string | Formatted date string (en-PH locale) |
| `ts`      | number | Unix timestamp (ms) from Date.now()  |
