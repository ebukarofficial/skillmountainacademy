// Which notices are urgent, and which emails a person may turn off. Shared by the Worker and the dashboards.
const URGENT = /^(reminder\.(1h|15m)|meet\.(link|missing)|session\.(rescheduled|cancelled)|attendance\.pending|payment\.)/;
export const priorityOf = (kind: string): "urgent" | "normal" => (URGENT.test(kind) ? "urgent" : "normal");
export const categoryOf = (kind: string): "reminders" | "updates" | "essential" =>
  kind.startsWith("reminder.") ? "reminders" : /^(resource\.|announcement)/.test(kind) ? "updates" : "essential";

// Which email card a notice uses (see src/server/email.ts).
export const designOf = (kind: string): "reminder" | "payment" | "graduation" | "notification" =>
  /^(reminder\.|session\.)/.test(kind) ? "reminder" : kind.startsWith("payment.") ? "payment" : kind === "programme.completed" ? "graduation" : "notification";
