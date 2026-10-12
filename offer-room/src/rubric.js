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
