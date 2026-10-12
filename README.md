# ContentEngine: Breakout Title Lab

Put in a video idea, get 3 YouTube titles back. Each one uses a different title mechanism from the breakout swipe file, and comes with the precedents behind it, an evidence level, the SOP's 12-point score, an audit and the open unknowns.

## Run it

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # your Claude API key
npm start                            # http://localhost:3000
```

Or from the terminal:

```bash
npm run titles -- "why over-preparing for conversations makes you sound fake"
```

Inside Claude Code you can skip the API key entirely: `/youtube-titles <your idea>`.

## How it works

- `docs/SOP.md` is the research and writing SOP. It goes to Claude as the system prompt.
- `data/swipe-file.json` is the evidence: every observed breakout title with its recorded views, age, creator and mechanism tags. **Add new breakouts here** and the tool uses them immediately.
- Claude returns structured JSON. `src/postprocess.js` then enforces the SOP rules in code so they can't be talked around:
  - precedent IDs that aren't in the swipe file are dropped, and view counts are re-attached from the file (no invented numbers);
  - evidence level is computed from the cited precedents and capped at "repeated examples" because the corpus has no controls yet;
  - totals and score bands are computed, not taken from the model;
  - it flags titles that reuse a mechanism or copy a precedent's wording.
- Every run is appended to `logs/decisions.jsonl` (SOP step 8) with `outcome: null`, ready for you to fill in 24h / 7d / 28d results.

Settings: `TITLE_MODEL` (default `claude-opus-5-5`), `TITLE_EFFORT` (default `high`), `PORT` (default 3000).

## Tests

```bash
npm test
```

---

# The Offer Room (test version, eyes only)

Student tools for the Offer Room placement program. Being built one part at a time; the test student is **Badal**.

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # for Claude scoring (optional; without it the coach scores all five)
npm run offer-room          # http://localhost:3100
```

On first run it creates three logins (Badal, Yogesh, placement cell) with random PINs and writes them to `offer-room/data/FIRST-RUN-LOGINS.txt`. Everything under `offer-room/data/` (database, recordings, logins) is git-ignored.

Forgot a PIN or locked out? `npm run offer-room:pin -- badal` prints a fresh PIN (works for any login). Restart the app to clear a lockout.

**Built so far**

- **Part 7: Management dashboard.** Log in as `placementcell` (coaches can open it too from their console). Professional and confidential to the placement cell: headline figures (students measured, average Offer Score Day 1 to Final, share at or above Ready, average movement, students needing support), movement by dimension, score distribution by band, a support-priority list (below Ready first, lowest score first, with the focus area and a recommended action; searchable, sortable, filterable), a department table, scoring integrity (how often coaches changed Claude's levels, per dimension), delivery numbers, and the method and its limits. Print it as a report, or download the register as CSV. It never shows profiles, transcripts, recordings, notes or override reasons.
- **Part 6: Badal's Offer Score page.** Once a test is scored, the student's room links to `/score`: the answer's total against the Ready line, the one next rep (the weakest dimension, in the 3AM voice), what worked and what to try next, each of the five dimensions in plain words, and, after the Final, what moved since Day 1. No rank, no batch average, no notes, and nothing about who scored what or what was changed.
- **Part 5: Claude scores four dimensions.** When the last answer is submitted, the server sends the student's profile, the three questions, the transcripts and the delivery numbers to Claude, which scores Structure, Proof, Clarity and Fit (1 to 4) with a quoted piece of evidence and a reason about the answer, and suggests one strength and one fix from the fixed lists. The coach's card opens pre-filled with Claude's levels; the coach scores Presence from the video. Changing one of Claude's levels requires a reason (also refused if it describes the person), and the score keeps Claude's original levels and every change with its reason. "Ask Claude again" re-runs it. With no transcript for any answer, Claude is skipped and the coach scores all five. Settings: `ANTHROPIC_API_KEY` (required to turn it on), `OFFER_ROOM_MODEL` (default `claude-opus-5-5`), `OFFER_ROOM_EFFORT` (default `high`), `OFFER_ROOM_AI=off` to disable. Rough cost: a few rupees per test.
- **Part 4: Room check and live transcript.** Every sitting starts with a 15-second room check: 5 seconds of quiet (background noise), then the student reads one line aloud (voice level, voice against background, and whether the browser's transcript caught the words), while the camera is checked for darkness, light behind the face and blur. Noise, voice and light block the test until fixed; blur and transcript only warn. After three failed tries the student may continue, and the coach sees that. The server re-checks the numbers itself. One check covers the whole sitting: a pass gives the open page a session token that every answer must carry, so questions in the same session don't repeat it, while a reload or a later visit needs a fresh check. During each answer the browser's built-in speech recognition (Chrome works best) writes down what is said, and the audio gives delivery numbers: time to first word, pauses over 2 seconds, loudness, plus words per minute and filler words from the transcript. The coach sees the room check, each transcript and its delivery numbers. Thresholds live in `offer-room/src/roomcheck.js`.
- **Part 3: Onboarding.** Before the first test unlocks, the student fills a four-step profile (degree and branch, target role in their own words plus role family, dream companies, relocation and night shifts, projects and other proof) and uploads a PDF resume, or ticks "no resume yet". Yogesh sees the profile and can open the resume on the scoring screen. Claude will judge Fit against this profile. Resumes are stored under `offer-room/data/resumes/` (`OFFER_ROOM_RESUMES` to move them).
- **Part 2: Yogesh scores it.** Log in as `yogesh` to reach the coach console: open or close the test window (Day 1, Final, Closed), see tests waiting to be scored, play the three recorded answers next to their questions, and score once on the Offer Score card (five dimensions, 1 to 4, with the card's anchors). The total and the gap to the Ready line (15) show live; the weakest dimension is picked automatically, and when two tie, Yogesh chooses. One strength and one fix come from fixed task-language stems (the student reads these). The private note refuses wording about the person ("lacks confidence") and asks for wording about the answer. Re-scoring replaces the earlier score.
- **Part 1: the Three-Minute Test.** Badal logs in on phone or PC, agrees to recording, checks camera and mic, then answers three questions (60s introduction, 90s story, 30s curveball), each recorded in the browser and uploaded. No retakes, parts in order, Day 1 and Final draw different questions.

**Hosting notes:** needs Node 22+, HTTPS (browsers only allow camera and mic on secure pages) and a persistent disk for `offer-room/data/`. Set `NODE_ENV=production` so session cookies are marked Secure. `OFFER_ROOM_DB` and `OFFER_ROOM_CLIPS` move the database and recordings elsewhere.
