// The student's onboarding profile. Shared by server and browser
// (served at /lib/profile.js). Claude later judges Fit against it.

export const DEGREES = ["B.Tech / B.E.", "BCA", "B.Sc", "BBA", "B.Com", "BA", "MBA", "MCA", "M.Tech", "Other"];

export const ROLE_FAMILIES = [
  "Software development",
  "Software testing / QA",
  "Data and analytics",
  "IT support and operations",
  "Sales / business development",
  "Customer success and support",
  "Banking and finance operations",
  "HR and recruitment",
  "Marketing",
  "Consulting / business analyst",
  "Core engineering (mechanical, civil, electrical)",
  "Other",
];

export const YES_NO_DEPENDS = ["Yes", "No", "Depends"];
export const LANGUAGES = ["English", "Hindi", "Punjabi", "Other"];
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

const LIMITS = {
  degree: 40, branch: 80, college: 120, gradYear: 4, roleFamily: 80, roleText: 160,
  companies: 160, relocation: 10, nightShifts: 10, projects: 1500, otherProof: 1500,
};

// Keeps only known fields, trimmed and capped. Never throws: drafts can be partial.
export function cleanProfile(input = {}) {
  const out = {};
  for (const [k, max] of Object.entries(LIMITS)) {
    if (input[k] != null) out[k] = String(input[k]).trim().slice(0, max);
  }
  out.languages = Array.isArray(input.languages)
    ? input.languages.filter((l) => LANGUAGES.includes(l))
    : [];
  out.noResume = input.noResume === true;
  return out;
}

// Returns the list of things still missing, in the student's voice.
export function missing(profile = {}, hasResume = false) {
  const gaps = [];
  if (!DEGREES.includes(profile.degree)) gaps.push("your degree");
  if (!profile.branch) gaps.push("your branch or specialisation");
  if (!/^20\d\d$/.test(profile.gradYear || "")) gaps.push("the year you graduate");
  if (!ROLE_FAMILIES.includes(profile.roleFamily)) gaps.push("the kind of role you want");
  if (!profile.roleText) gaps.push("the role in your own words");
  if (!YES_NO_DEPENDS.includes(profile.relocation)) gaps.push("relocation");
  if (!YES_NO_DEPENDS.includes(profile.nightShifts)) gaps.push("night shifts");
  if (!profile.projects) gaps.push("at least one project or internship");
  if (!hasResume && !profile.noResume) gaps.push("your resume (or tick 'no resume yet')");
  return gaps;
}
