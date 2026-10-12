// Workbook content. `ask` lines are spoken by a recruiter: formal and heavy.
// `tip` lines are the friend at 3AM: simple, warm, a little funny.

export const SIX_STORIES = [
  { id: 1, title: "A problem I solved", answers: "Problem solving, initiative, 'your biggest achievement', strengths", tip: "Anything that was broken and you fixed it. A bug, a fest budget, the shop's billing mess. It counts." },
  { id: 2, title: "A team that disagreed", answers: "Teamwork, conflict, handling difficult people, communication", tip: "That group assignment where everyone wanted something different? Gold. Tell what YOU did about it." },
  { id: 3, title: "A time I failed", answers: "Failure, weakness, learning, 'a mistake you made'", tip: "Pick a real one, not a fake 'I worked too hard'. What broke, what you learned, what you do differently now." },
  { id: 4, title: "A time I took charge", answers: "Leadership, ownership, initiative without authority", tip: "Nobody asked you, you did it anyway. NSS camp, a club event, organising the trip. Yes, that's leadership." },
  { id: 5, title: "A deadline or pressure", answers: "Pressure, time management, stress, prioritising", tip: "The night before submission. Exam week plus a fest. How you got it done is the story." },
  { id: 6, title: "My project, deep", answers: "Technical or project round, 'what have you built', 'explain your work'", tip: "Your minor or major project, or the internship for BBA, BCom, BA folks. Know your part cold." },
];

// Question -> the story that answers it best. Drives the 3-second drill.
export const STORY_DRILL = [
  { ask: "Tell me about a time you solved a difficult problem.", story: 1 },
  { ask: "What would you describe as your most significant achievement to date?", story: 1 },
  { ask: "Describe a situation in which members of your team disagreed. How did you handle it?", story: 2 },
  { ask: "Tell me about a time you had to work with a difficult colleague.", story: 2 },
  { ask: "Describe a mistake you made and what you learned from it.", story: 3 },
  { ask: "What is your greatest weakness, and what are you doing about it?", story: 3 },
  { ask: "Give me an example of a time you showed leadership without formal authority.", story: 4 },
  { ask: "Tell me about a time you took ownership of something that was not your responsibility.", story: 4 },
  { ask: "Describe a time you had to deliver under a tight deadline.", story: 5 },
  { ask: "How do you prioritise when several tasks are due at once?", story: 5 },
  { ask: "Walk me through the most substantial project you have worked on.", story: 6 },
  { ask: "What exactly was your contribution to that project?", story: 6 },
];

export const HR_QUESTIONS = [
  { id: "why_company", ask: "Why do you want to join our organisation?", tip: "Three specifics: what they do, one thing you saw or read about them, what you'd do there. 'Reputed MNC' is banned, sorry." },
  { id: "why_hire", ask: "Why should we hire you over the other candidates?", tip: "One strength. One 30-second proof story. One line linking it to the role. Done." },
  { id: "strength", ask: "What would you say is your greatest strength?", tip: "ONE strength, not five. Then a story that shows it." },
  { id: "weakness", ask: "What is your greatest weakness?", tip: "A real one that won't sink the job, plus what you're doing about it right now. 'Perfectionist' fools nobody." },
  { id: "five_years", ask: "Where do you see yourself in five years?", tip: "The skills you want to build inside THIS company and the work you want to be trusted with." },
  { id: "relocation", ask: "Are you willing to relocate and work night shifts if required?", tip: "Honest answer. If there's a real limit, say it now. A lie here turns into a resignation later." },
  { id: "branch_switch", ask: "Your degree is in a different discipline. Why are you moving into this field?", tip: "What pulled you in, what you did about it (course, project), and what your branch gives you that others don't have." },
  { id: "bond", ask: "Are you prepared to sign the service agreement?", tip: "Know the terms before you walk in. Then answer straight." },
  { id: "gap", ask: "I see a backlog in your record. Could you explain it?", tip: "Own it in one sentence, say what changed, move to proof. Never blame anyone. Swap 'backlog' for gap year or low marks if that's yours." },
  { id: "college", ask: "Tell me about your college.", tip: "Something good and true about it. Never roast your own college in an interview, even if the canteen deserves it." },
  { id: "salary", ask: "What are your salary expectations?", tip: "Campus roles: 'I understand the package for this role is fixed; I'm here for the role.' That's it." },
  { id: "other_offers", ask: "Do you currently hold any other offers?", tip: "Honest and short." },
  { id: "higher_studies", ask: "Do you have plans for higher studies or to join a family business?", tip: "Honest, then commitment: what you'll give this job while you're here." },
  { id: "not_on_cv", ask: "Tell me something about yourself that is not on your CV.", tip: "A short story from your Story Bank that shows character. Not your zodiac sign." },
  { id: "know_us", ask: "What do you know about our company and its leadership?", tip: "Five minutes of reading before every drive. Know what they do and who runs it." },
  { id: "questions", ask: "Do you have any questions for us?", tip: "Two prepared questions about the work, the training or the team. Never 'no'." },
];

// Three-Minute Test decks. Recruiter voice.
export const THREE_MINUTE_TEST = [
  { part: "Part 1", seconds: 60, deck: ["Tell me about yourself."] },
  {
    part: "Part 2",
    seconds: 90,
    deck: [
      "Tell me about a time you solved a problem.",
      "Describe a time you worked in a team that disagreed.",
      "Tell me about a time you failed.",
      "Describe a time you took charge without being asked.",
      "Tell me about a time you worked under pressure to meet a deadline.",
    ],
  },
  {
    part: "Part 3",
    seconds: 30,
    deck: [
      "Why should we hire you over the candidate after you?",
      "Are you comfortable with relocation and night shifts?",
      "What is your biggest weakness?",
      "Why are you leaving your branch for this role?",
      "If we offered you the role today, what would you do in your first month?",
    ],
  },
];

export const NEWSPAPER_PROMPT =
  "Read one paragraph of an English newspaper out loud. Then look away and retell it in 30 seconds. Listen back once. That's it. Five minutes. Every day between sessions.";

export const ESSAY_TOPICS = [
  "Should companies hire freshers based on skills tests rather than marks?",
  "Is remote work good for people starting their careers?",
  "Should social media platforms verify the age of every user?",
  "Is artificial intelligence creating more jobs than it removes?",
  "Should every graduate do one year of community service?",
];

export const ROUTINE = [
  { when: "The night before", what: "Say your intro and two stories out loud once. Read the company page. Lay out documents and clothes. Then sleep, seriously." },
  { when: "In the waiting room", what: "Read your three true facts. Breathe out slowly a few times. Don't rehearse new answers now, the old ones are better." },
  { when: "Walking in", what: "Greet, thank them, sit when asked. Your first sentence is the one you know best." },
  { when: "Each question", what: "One-second pause before answering. It looks like thinking. Because it is." },
];

export const RECOVERY_LINES = [
  { when: "Mind goes blank", say: "Let me take a second to think about that." },
  { when: "Didn't get the question", say: "Could you repeat the question, please?" },
  { when: "Started badly", say: "Let me put that more clearly." },
];

export const VIDEO_CHECKLIST = [
  "Camera at eye level. Stack books under the phone if you have to.",
  "Look at the lens when talking, at the screen when listening.",
  "Light in front of your face, not behind you.",
  "Head and shoulders in frame, plain background.",
  "Earphones with a mic. Quiet room. Test 30 minutes before.",
  "A little more expression than in person. Screens flatten everyone.",
];

export const TOOLS = ["intro", "stories", "hr", "project", "newspaper", "nerves", "drives", "essay"];
