// Quotations on hope, motivation, focus and growth for the sign-in pages. One is shown at random on each visit.
// Only well-documented attributions are used; keep it that way when adding more.
export const QUOTES: { text: string; by: string; theme: "hope" | "motivation" | "focus" | "growth" }[] = [
  { text: "Education is the most powerful weapon which you can use to change the world.", by: "Nelson Mandela", theme: "hope" },
  { text: "Education is the passport to the future, for tomorrow belongs to those who prepare for it today.", by: "Malcolm X", theme: "motivation" },
  { text: "The beautiful thing about learning is that nobody can take it away from you.", by: "B.B. King", theme: "growth" },
  { text: "Intelligence plus character: that is the goal of true education.", by: "Martin Luther King Jr.", theme: "growth" },
  { text: "If I have seen further, it is by standing on the shoulders of giants.", by: "Isaac Newton", theme: "growth" },
  { text: "Wisdom is not a product of schooling but of the lifelong attempt to acquire it.", by: "Albert Einstein", theme: "growth" },
  { text: "I am always ready to learn, although I do not always like being taught.", by: "Winston Churchill", theme: "motivation" },
  { text: "Nothing in life is to be feared, it is only to be understood.", by: "Marie Curie", theme: "focus" },
  { text: "The roots of education are bitter, but the fruit is sweet.", by: "Aristotle", theme: "motivation" },
  { text: "The mind is not a vessel to be filled, but a fire to be kindled.", by: "Plutarch", theme: "growth" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", by: "Will Durant", theme: "focus" },
  { text: "Knowledge is power. Information is liberating. Education is the premise of progress, in every society, in every family.", by: "Kofi Annan", theme: "hope" },
  { text: "Optimism is the faith that leads to achievement. Nothing can be done without hope and confidence.", by: "Helen Keller", theme: "hope" },
  { text: "Hope is being able to see that there is light despite all of the darkness.", by: "Desmond Tutu", theme: "hope" },
  { text: "Concentrate all your thoughts upon the work at hand. The sun's rays do not burn until brought to a focus.", by: "Alexander Graham Bell", theme: "focus" },
  { text: "Success is to be measured not so much by the position that one has reached in life as by the obstacles which he has overcome.", by: "Booker T. Washington", theme: "motivation" },
  { text: "Real knowledge is to know the extent of one's ignorance.", by: "Confucius", theme: "growth" },
  { text: "Success isn't about how much money you make; it's about the difference you make in people's lives.", by: "Michelle Obama", theme: "motivation" },
];

// A different quotation from the one shown last time on this device.
export function pickQuote(last: number | null, rand = Math.random()): number {
  const n = QUOTES.length;
  const i = Math.floor(rand * n) % n;
  return last !== null && i === last ? (i + 1) % n : i;
}
