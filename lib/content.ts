// Reviews and mentors, edited in data/reviews.json and data/mentors.json (see data/README.md).
// Entries missing required fields are skipped, so a typo never breaks the page.
import reviewsRaw from "../data/reviews.json";
import mentorsRaw from "../data/mentors.json";
import { cleanMentors, cleanReviews, showMentors, showReviews } from "./content-rules.ts";

export type { Mentor, Review } from "./content-rules.ts";
export const REVIEWS = cleanReviews(reviewsRaw);
export const MENTORS = cleanMentors(mentorsRaw);
export const SHOW_REVIEWS = showReviews(REVIEWS);
export const SHOW_MENTORS = showMentors(MENTORS);
