# Site content you can edit

Only add REAL reviews from real learners, with their permission. Never invent reviews or mentors.

## reviews.json
The Reviews section appears on the home page once there are **at least 3** valid entries.

```json
[
  { "name": "Amaka O.", "programme": "cloud", "year": 2026, "quote": "My mentor explained everything at my pace.", "photo": "amaka.webp" }
]
```
- `programme`: a programme slug from lib/config.ts (graphics, uiux, webdev, marketing, cybersecurity, cloud, devops, cloud-devops).
- `photo` is optional: put the image in `public/reviews/` and write only its file name.
- `quote`: up to 400 characters.

## mentors.json
The Mentors section appears once there is at least 1 valid entry.

```json
[
  { "name": "Tunde A.", "role": "Cloud & DevOps mentor", "bio": "Eight years building systems on AWS and Azure.", "programmes": ["cloud", "devops"], "photo": "tunde.webp" }
]
```
- `photo` is optional: put the image in `public/mentors/`.

Entries with a missing name, programme or quote (reviews), or a missing name or role (mentors), are skipped.
After editing, commit and push; the site rebuilds.
