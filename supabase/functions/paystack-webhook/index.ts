// Deploy: supabase functions deploy paystack-webhook --no-verify-jwt
// Secrets: PAYSTACK_SECRET_KEY, RESEND_API_KEY, MAIL_FROM, SHEET_URL
// Then set the Paystack dashboard webhook URL to this function's URL.
import { createHmac } from "node:crypto";

const FEES: Record<string, number> = { graphics: 350000, devops: 450000 }; // naira

// Put your real resource links here. Sent only after payment is verified.
const RESOURCES: Record<string, { name: string; links: [string, string][] }> = {
  graphics: { name: "Graphics Design", links: [["Welcome guide", "https://example.com/graphics-guide"]] },
  devops: { name: "DevOps Engineer", links: [["Welcome guide", "https://example.com/devops-guide"]] },
};

Deno.serve(async (req) => {
  const raw = await req.text();
  const sig = createHmac("sha512", Deno.env.get("PAYSTACK_SECRET_KEY")!).update(raw).digest("hex");
  if (sig !== req.headers.get("x-paystack-signature")) return new Response("Invalid signature", { status: 401 });

  const evt = JSON.parse(raw);
  if (evt.event !== "charge.success") return new Response("ignored");

  const { reference, amount, customer, metadata } = evt.data;
  const prog = RESOURCES[metadata?.programme];
  if (!prog || amount < FEES[metadata.programme] * 100) return new Response("amount or programme mismatch");

  const items = prog.links.map(([t, u]) => `<li><a href="${u}">${t}</a></li>`).join("");
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("MAIL_FROM"),
      to: customer.email,
      subject: `Welcome to SMA: ${prog.name}`,
      html: `<p>Hi ${metadata.name ?? ""},</p><p>Your payment is confirmed. Here are your learning resources:</p><ul>${items}</ul><p>Your mentor will contact you to schedule your first session.</p>`,
    }),
  });

  await fetch(Deno.env.get("SHEET_URL")!, {
    method: "POST",
    body: JSON.stringify({ action: "paid", reference }),
  });

  return new Response("ok");
});
