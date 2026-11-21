// Which notices are urgent, and which emails a person may turn off. Shared by the Worker and the dashboards.
const URGENT = /^(reminder\.(1h|15m)|meet\.(link|missing)|session\.(rescheduled|cancelled)|attendance\.pending|payment\.)/;
export const priorityOf = (kind: string): "urgent" | "normal" => (URGENT.test(kind) ? "urgent" : "normal");
export const categoryOf = (kind: string): "reminders" | "updates" | "essential" =>
  kind.startsWith("reminder.") ? "reminders" : /^(resource\.|announcement)/.test(kind) ? "updates" : "essential";

