// The Offer Score card. Pure data and functions: runs on the server and in
// the browser (served at /lib/rubric.js).

export const DIMENSIONS = ["structure", "proof", "clarity", "presence", "fit"];

export const DIMENSION_LABEL = {
  structure: "Structure",
  proof: "Proof",
  clarity: "Clarity",
  presence: "Presence",
  fit: "Fit",
};

export const LEVEL_NAMES = ["Not yet", "Getting there", "Ready", "Strong"];

// Anchors from the printed card, so every scorer means the same thing by a 3.
export const ANCHORS = {
  structure: ["No clear start or end; wanders", "A start, but loses the thread", "Clear point, example, close", "Clear shape; listener could repeat the point back"],
  proof: ["Only claims (\"I am hardworking\")", "An example, but general or \"we\"", "One specific example with their own role", "Specific example with their role and a number or result"],
  clarity: ["Too fast, too quiet, or broken sentences", "Understandable with effort", "Easy to follow; pauses in the right places", "Easy to follow and easy to listen to; simple words, steady pace"],
  presence: ["Looks away, apologises, voice drops", "Polite but tentative; hedges every claim", "Steady eye contact, warm, owns their claims", "Warm and assertive throughout, including on the hard question"],
  fit: ["Answer could be for any job", "Mentions the role, loosely", "Connects the answer to this role or company", "Connects to the role and shows they know what the job involves"],
};

// When dimensions tie for weakest, default to the one that moves fastest.
// Proof and Structure move in days; Presence moves slowest.
const TIE_ORDER = ["proof", "structure", "fit", "clarity", "presence"];

export function total(levels) {
  return DIMENSIONS.reduce((sum, d) => sum + levels[d], 0);
}

export function lowest(levels) {
  const min = Math.min(...DIMENSIONS.map((d) => levels[d]));
  return TIE_ORDER.filter((d) => levels[d] === min);
}

export const weakest = (levels) => lowest(levels)[0];

export function validLevels(levels) {
  return Boolean(levels) && DIMENSIONS.every((d) => Number.isInteger(levels[d]) && levels[d] >= 1 && levels[d] <= 4);
}

// The student reads these, so they talk about the answer, never the person.
export const STRENGTH_STEMS = [
  "The first sentence made the point straight away.",
  "The example had a real role in it.",
  "The number in the result made it stick.",
  "The pace was steady and easy to follow.",
  "The pause before answering looked like thinking.",
  "The answer connected to the role at the end.",
  "The story kept its order: what happened, what was done, what changed.",
];

export const FIX_STEMS = [
  "Next rep: put the point in the first sentence.",
  "Next rep: say what you did, with 'I', not 'we'.",
  "Next rep: add one number to the result.",
  "Next rep: one idea per sentence, pause at full stops.",
  "Next rep: end with one line that links to the role.",
  "Next rep: cut it to 60 seconds; drop the CV list.",
  "Next rep: finish each sentence at full volume.",
];

// Feedback aimed at the person ("lacks confidence") makes performance worse;
// feedback aimed at the task makes it better. Notes that judge the person are
// refused, even though the student never sees the note.
const PERSON_AIMED = [
  /\b(?:you|he|she|they)(?:'re| are| is| seems?)\s+(?:so\s+|too\s+|very\s+|quite\s+|not\s+)?(?:nervous|shy|lazy|weak|bad|slow|dull|unconfident|underconfident|average|poor|boring|scared|timid|arrogant)\b/i,
  /\b(?:be|get|act|sound)\s+more\s+confident\b/i,
  /\black(?:s|ing)?\s+(?:of\s+)?confidence\b/i,
  /\bnot\s+confident\b/i,
  /\blow\s+confidence\b/i,
  /\b(?:his|her|their|your)\s+(?:attitude|personality)\b/i,
  /\b(?:english|communication)\s+is\s+(?:bad|weak|poor|terrible)\b/i,
  /\b(?:introvert(?:ed)?|no\s+personality|hopeless|useless)\b/i,
];

export function lintNote(note = "") {
  return PERSON_AIMED.some((re) => re.test(note))
    ? "This note describes the person. Rewrite it about the answer: what the answer did, and what the next rep should change."
    : null;
}

export const READY_LINE = 15;

export const BANDS = [
  { label: "5 to 9", min: 5, max: 9 },
  { label: "10 to 12", min: 10, max: 12 },
  { label: "13 to 14", min: 13, max: 14 },
  { label: "15 to 20 (Ready)", min: 15, max: 20 },
];

export function band(t) {
  return BANDS.findIndex((b) => t >= b.min && t <= b.max);
}

// ---------- What the student reads about an answer (3AM-friend voice) ----------
// [level 1..4] -> { said: what this answer did, next: the one next rep }
export const STUDENT_LINES = {
  structure: [
    { said: "This answer went on a road trip with no map. Started somewhere, ended somewhere else. Totally normal on round one.", next: "Say your point in the very first sentence. Then one example. Then land it. Point, example, close. That's the whole trick, yaar." },
    { said: "The answer had a solid start, then lost the thread halfway. Like a voice note that forgot why it was recorded.", next: "Before you open your mouth, decide your last line. If you know where you're landing, you don't get lost on the way." },
    { said: "Point, example, close. Clean. The listener knew where they were the whole time.", next: "Make the point so sharp someone could repeat it back in one line." },
    { said: "This answer had a shape so clear the listener could repeat it back. That's rare. Seriously.", next: "Keep the shape, cut 10 seconds. Short and clear beats long and clear." },
  ],
  proof: [
    { said: "The answer said 'hardworking' but never showed it. Interviewers hear 'hardworking' about 400 times a day. They're tired.", next: "Swap one adjective for one real thing you did. A project, a fest, a part-time job, the family shop. Anything real counts." },
    { said: "There was an example in there, but it was blurry. Lots of 'we', not much 'I'.", next: "Say what YOU did. 'I wrote the test cases', not 'we did the project'. Your teammates aren't in the room." },
    { said: "One real example with your actual role in it. That's what makes an interviewer lean in.", next: "Add a number. How many, how fast, how much. '60 test cases, 14 bugs' hits different." },
    { said: "Real example, your role, a number. That's proof, not a claim. Chef's kiss.", next: "Try this same story on a different question. A good story answers three or four of them." },
  ],
  clarity: [
    { said: "The words were rushing out like they had a train to catch. Or they went too quiet to hear.", next: "Short sentences. Breathe at the full stops. Slow feels weird to you and sounds great to them." },
    { said: "The listener could follow, but had to work for it.", next: "One idea per sentence. If a sentence has an 'and' in the middle, cut it in two." },
    { said: "Easy to follow. The pauses landed in the right places.", next: "Swap any fancy word for the simple one you'd use with a friend. Simple English scores." },
    { said: "Easy to follow AND easy to listen to. Steady pace, simple words. That's a big deal.", next: "Do tonight's Newspaper Rep so this pace stays on autopilot." },
  ],
  presence: [
    { said: "The eyes went to the floor and the answer kept saying sorry for itself. Happens to literally everyone at first.", next: "Look at the interviewer's eyebrows (works, trust me) and finish every sentence at full volume." },
    { said: "Polite, but the answer kept hedging. 'I think maybe I kind of...' The thing you did deserves better than that.", next: "Say 'I did' instead of 'I think I helped'. Own the part you actually did." },
    { said: "Steady eye contact, warm, owned what it said. That's how a hire sounds.", next: "Keep the same warmth on the hardest question. That's where it counts." },
    { said: "Warm and sure, even on the tough one. That's the whole game.", next: "Keep it exactly like this on the hardest question of your next test." },
  ],
  fit: [
    { said: "This answer could have been for any job on earth. The interviewer wants to hear about THIS one.", next: "Add one line that links it to the role. 'That's exactly why this role pulls me in.'" },
    { said: "The role got a mention, but it was a quick wave from far away.", next: "Name one thing the job actually involves and connect your example to it." },
    { said: "The answer clicked into this role. That's exactly what the Pull is for.", next: "Read the company page for five minutes and add one specific thing you saw there." },
    { said: "Connected to the role and showed what the work actually is. Interviewers remember that.", next: "Try it on another company's question deck. Same skill, new room." },
  ],
};

// What the placement cell is told to do for a student whose weakest
// dimension is X. Professional voice: management reads this.
export const RECOMMENDED_ACTION = {
  structure: "Two timed reps on answer frames (Present, Proof, Pull; STAR) before the next drive.",
  proof: "Complete the Story Bank: add own role and a measurable result to at least two stories.",
  clarity: "Daily Newspaper Rep for one week; pace-and-pause drill in a trio.",
  presence: "Two panel hot-seats with faculty; full sentences, no hedging, warm close.",
  fit: "Attend the Drive Brief for the next company; prepare 'why this company' with three specifics.",
};
