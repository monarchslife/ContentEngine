# SOP: YouTube Breakout Title Research & Writing System

**Version:** 1.0  
**Objective:** Develop YouTube titles with a higher probability of outperforming a channel's normal reach by learning from observed breakout videos.

## 1. The Objective

We are not optimizing primarily for YouTube Search. We are studying titles designed to earn attention in a recommendation-driven environment.

The target is a title that makes a viewer who was not actively searching for the topic feel compelled to watch.

Our research focuses on breakout videos from creators who lack established audience advantages, particularly creators whose recent videos substantially outperform their previous performance.

The central question is:

**What made this particular video worth clicking on, despite the creator not having an established audience or substantial face value to rely on?**

The system must learn from observed winners, not invent formulas and retroactively justify them.

### Success criteria

A title should:

- Create a compelling reason to watch.
- Communicate a meaningful outcome, tension, revelation, or experience.
- Make the subject personally relevant to the intended viewer.
- Create curiosity that the video can genuinely satisfy.
- Be grounded in the video's actual content.
- Be evaluated against the channel's baseline, not just its absolute view count.

The objective is not to guarantee virality. It is to improve the quality of title selection through disciplined observation and testing.

---

## 2. Research Principles

### Rule 1: Winners are evidence, not proof

A successful title is an observation. It does not establish that every characteristic of that title caused its success.

For example:

**Observed title:** "You Are Broke Because You Are Too Smart"

**Reported performance:** 100,000 views in one week on a channel with approximately 1,000 subscribers.

What we can observe:

- The title addresses the viewer directly.
- It identifies a negative financial condition.
- It offers a causal explanation.
- Its proposed explanation contradicts the usual association between intelligence and success.

What we cannot establish from this example alone:

- That the word "you" caused the video to perform well.
- That causal titles consistently outperform other structures.
- That the title was the only significant factor.
- That the same title structure will perform equally well across different topics.

Record observations separately from hypotheses.

### Rule 2: Study outliers, not popularity alone

A video with one million views is not automatically a breakout.

Record, wherever available:

- Views at a specified age.
- Subscriber count when the video was published.
- The creator's previous video performance.
- The creator's usual performance range.
- The video's topic and format.
- Available traffic-source and impression data.

A video that receives 100,000 views against a 2,000-view baseline may be a more informative outlier than a video that receives one million views on a channel that normally receives five million.

Use performance relative to baseline whenever the data exists.

### Rule 3: Do not confuse correlation with causation

A title may be associated with a breakout without being its sole cause.

Topic demand, thumbnail, opening hook, audience selection, recommendation distribution, retention, viewer satisfaction, and timing can all contribute.

Our job is to identify promising title mechanisms and test their predictive value, not claim certainty where none exists.

### Rule 4: Do not invent patterns

Never create a title formula merely because it sounds psychologically convincing.

A proposed pattern must be linked to one or more specific observed examples. Its evidence level must be recorded.

One example supports a hypothesis. Repeated examples strengthen it. Comparisons with ordinary-performing videos help establish whether the pattern is actually discriminative.

---

## 3. The Swipe File

The research corpus lives in `data/swipe-file.json` (titles, reported views, ages, creators, mechanism tags and research questions). Titles and view counts were transcribed from supplied screenshots or conversation. Performance figures are observations, not independently verified analytics. Channel baselines are unknown unless stated.

---

## 4. Initial Taxonomy of Title Mechanisms

Use the following categories as provisional research labels, not as a list of proven formulas.

1. **Counterintuitive causality:** An unexpected cause is assigned to a familiar outcome.
2. **Transformation compression:** A large change is presented within a striking timeframe.
3. **Exclusive method:** A method is framed as uniquely effective or unusually powerful.
4. **Unconventional mechanism:** The solution sounds surprising, forbidden, or contrary to expectations.
5. **Emotional diagnosis:** An internal experience receives a clear explanation or interpretation.
6. **Universal desire:** A broadly desirable outcome is promised.
7. **Social stakes:** Approval, rejection, respect, attraction, or status is placed at risk.
8. **Named framework:** A compact rule, system, or method gives the subject a memorable structure.
9. **Belief reversal:** An established assumption is challenged.
10. **Attention exchange:** A small investment is exchanged for a valuable outcome.
11. **Identity contrast:** Two competing behaviours, identities, or states are placed in opposition.

A title may belong to multiple categories. The purpose of the taxonomy is to make comparison possible, not to pretend that human attention follows a single formula.

---

## 5. SOP: Creating a Title for a New Video

### Step 1: Establish the video's actual substance

Before researching titles, document:

- The video's central thesis.
- The problem, desire, or experience it addresses.
- The specific explanation, method, or insight it delivers.
- The intended viewer.
- The strongest defensible outcome or revelation.
- What the video does not establish.

Do not write titles before understanding the actual content. This prevents clickbait promises that the video cannot fulfil.

### Step 2: Identify the strongest viewer-facing proposition

Determine what is most compelling about the video's substance.

Possible propositions include:

- A problem has an unexpected cause.
- A desirable outcome may be easier to achieve than assumed.
- A familiar method is ineffective or incomplete.
- A private experience has a name or explanation.
- A common belief is mistaken.
- A small behavioural change has meaningful consequences.
- A useful technique can solve a specific problem.

These are prompts for analysis, not mandatory title structures.

Select a proposition only when the content supports it.

### Step 3: Search the swipe file for relevant precedents

Find observed winners with similar:

- Audience motivations.
- Viewer problems or desires.
- Subject matter.
- Title mechanisms.
- Degree of promise.
- Creator and channel circumstances, where known.

Do not select examples merely because they contain similar words.

A video about financial anxiety and a video about social awkwardness might both use counterintuitive causality, but that does not establish that they will perform similarly.

### Step 4: Extract the mechanism from each precedent

For every relevant example, record:

- The exact title.
- Its observed performance and measurement age.
- Its source and evidence quality.
- The title feature being investigated.
- The reason that feature might create interest.
- Alternative explanations for the video's performance.
- Whether similar examples support or contradict the hypothesis.

Do not reverse-engineer a formula from a single example and immediately call it a rule.

### Step 5: Select a mechanism based on evidence and relevance

Choose the most relevant, best-supported mechanism for the video.

If several mechanisms seem plausible, rank them based on the evidence in the swipe file and the video's actual proposition.

If the evidence is insufficient to rank them confidently, say so. Do not manufacture certainty.

### Step 6: Write one primary title

Write the single title that best communicates the selected proposition through the selected mechanism.

Evaluate it against these questions:

1. Does it make a specific and meaningful claim?
2. Is the claim supported by the video?
3. Is the viewer's reason to care immediately apparent?
4. Does the title create a meaningful question, tension, or expectation?
5. Does it resemble a relevant observed precedent in mechanism, rather than merely in wording?
6. Is the language natural and easy to understand?
7. Does it promise something the opening and body of the video actually deliver?

If the title fails, diagnose the specific failure and revise it. Do not generate a pile of unrelated alternatives.

### Step 7: Audit the title

Check for:

- Unsupported claims.
- Exaggerated timeframes or outcomes.
- Generic language that hides the video's actual value.
- Unnecessary jargon.
- A mismatch between the title and content.
- A pattern selected only because it sounds clever.
- A claim that depends on invented details.
- A title that imitates the wording of a precedent without preserving its underlying mechanism.

### Step 8: Record the decision

Save the selected title, its rationale, the supporting precedents, the evidence level, and the hypothesis being tested.

After publication, record the actual outcome against the appropriate channel and video-age baseline.

Do not change the historical rationale simply because the video performs well or poorly.

---

## 6. What the AI Agent Must Never Do

### Prohibited behaviour 1: Inventing evidence

Never fabricate:

- View counts.
- Subscriber counts.
- Upload dates.
- CTR or retention figures.
- Channel history.
- Thumbnail characteristics.
- Creator intentions.
- Viewer psychology presented as established fact.

If the information is not supplied or verified, mark it as unknown.

### Prohibited behaviour 2: Inventing a pattern and presenting it as proven

Do not write statements such as:

"Titles with the word 'because' go viral."

The observed evidence supports a narrower statement:

"The title 'You Are Broke Because You Are Too Smart' uses a causal structure that links an undesirable outcome to a counterintuitive explanation. This is a hypothesis worth testing against comparable winners and controls."

Use the narrower statement unless stronger evidence becomes available.

### Prohibited behaviour 3: Generating variations without a reason

Do not automatically return 10, 20, or 50 title variations.

Do not replace research with synonym substitution.

Do not generate multiple titles simply to make the response look productive.

Write one primary title after evaluating the content and relevant evidence.

Generate alternatives only when there is a specific analytical reason, such as comparing two genuinely different, evidence-backed mechanisms. If alternatives are requested, explain the distinction between them and do not imply that either is a proven winner.

### Prohibited behaviour 4: Retroactive rationalization

Do not observe a title that performed well and then claim that its capitalization, word count, punctuation, or another feature caused the result without comparative evidence.

Record what is visible first. Hypothesize second. Test third.

### Prohibited behaviour 5: Copying the precedent instead of learning from it

A precedent should inform the underlying mechanism, not become a template to fill with new nouns.

Do not assume that because a creator's title succeeded, its structure will work in a different context.

### Prohibited behaviour 6: Treating views as sufficient evidence

A high view count alone does not establish:

- The degree of breakout relative to baseline.
- The contribution of the title.
- The title's generalizability.
- The mechanism's predictive value.

Record missing information and qualify the conclusion.

### Prohibited behaviour 7: Forcing every title into the taxonomy

If no existing category fits, mark the example as unclassified or propose a new provisional category.

A taxonomy should adapt to evidence. Evidence should not be distorted to fit a taxonomy.

### Prohibited behaviour 8: Overstating certainty

Use evidence-calibrated language:

- **Observed:** Directly visible in the source.
- **Hypothesis:** A plausible interpretation requiring further evidence.
- **Supported pattern:** Repeated observations, with meaningful comparisons.
- **Predictive pattern:** Demonstrated performance on new examples or held-out data.

Do not label a pattern predictive merely because it explains several existing winners.

---

## 7. Evaluation Framework

Score each proposed title from 0 to 2 on each criterion.

| Criterion | 0 | 1 | 2 |
|---|---|---|---|
| Content fidelity | Misleading | Partially supported | Fully supported |
| Proposition clarity | Unclear | Understandable with effort | Immediately clear |
| Viewer relevance | Weak | Moderate | Strong |
| Curiosity or tension | Absent | Present but generic | Specific and meaningful |
| Precedent relevance | No relevant evidence | Indirect precedent | Relevant observed precedent |
| Language quality | Awkward | Acceptable | Natural and concise |

**Maximum score: 12.**

Interpretation:

- **0–5:** Rework the title.
- **6–8:** Review the weak dimensions before selecting.
- **9–10:** Strong candidate for consideration.
- **11–12:** Strong candidate for testing, not a guarantee of performance.

This is a decision aid, not a validated prediction model. A high score must not be represented as a quantified probability of going viral.

---

## 8. Post-Publication Learning Loop

After publishing a video, collect the available data at consistent intervals.

Recommended checkpoints:

- 24 hours.
- 7 days.
- 28 days.

For each checkpoint, record:

- Views and impressions.
- CTR, where available.
- Traffic sources.
- Average view duration or percentage viewed.
- Subscriber count and historical baseline.
- Whether the video exceeded the expected performance range.
- Any known packaging changes.

Compare videos with appropriate controls, accounting for topic, format, audience, channel, and upload age wherever possible.

A breakout with strong Browse or Suggested distribution provides different evidence from a video whose views primarily come from Search or external traffic.

Do not conclude that a title mechanism caused the result solely because a video received more views than expected.

Over time, evaluate whether each mechanism helps distinguish outliers from ordinary-performing videos on examples that were not used to create the original hypothesis.

---

## 9. Standard Output Format for the AI Agent

Whenever asked to title a new video, return the following:

1. **Video proposition** — One sentence describing what the video genuinely delivers.
2. **Relevant precedents** — List only the most relevant examples from the swipe file, with their observed performance and source context.
3. **Mechanism selected** — Name the mechanism and explain why it fits the video's substance and intended viewer.
4. **Evidence level** — State whether the choice is based on a single observation, repeated examples, comparative evidence, or validated predictive performance.
5. **Primary title** — Provide one title.
6. **Title audit** — Briefly explain why it accurately represents the content, creates a compelling reason to watch, and avoids unsupported claims.
7. **Remaining uncertainty** — State the most important unknowns that could affect performance.

If no relevant precedent exists, explicitly say that the title is based on a new hypothesis rather than pretending the swipe file validates it.

---

## 10. Final Operating Principle

The system must optimize for evidence-backed decisions, not the quantity of titles it generates.

The process is:

**Observe outliers → Record exact evidence → Identify candidate mechanisms → Compare against controls → Apply to the actual video → Select one title → Measure results → Update the model.**

The ultimate goal is not to memorize viral titles. It is to develop a growing body of evidence about why certain titles earn attention from viewers who were not already looking for the video.

A good title can be compelling without following a known pattern. A known pattern can fail in a different context. The system must remain capable of recognizing both possibilities.
