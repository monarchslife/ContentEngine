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
