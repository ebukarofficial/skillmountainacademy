/**
 * SMA applications, payment checks and emails. Runs on Google, no other server needed.
 * This script lives in the Google Sheet that your registration Google Form saves its answers to.
 *
 * SETUP
 * 1. Open the Google Sheet linked to your Form (Form > Responses > Link to Sheets).
 * 2. Extensions > Apps Script. Paste this file over everything there.
 * 3. Project Settings (gear) > Script Properties > add  PAYSTACK_SECRET = your Paystack SECRET key (sk_live_...).
 * 4. Fill in CURRICULUM, CALENDLY_CLASSES and (optional) CLASS_LINK below.
 * 5. Run setup() once (Run button) and accept the permissions. It adds two timers:
 *      - every 5 minutes it checks Paystack payments
 *      - when you type PAID in the Status column, it sends the welcome email (for bank transfers)
 * 6. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the URL into NEXT_PUBLIC_SHEET_URL.
 *    After any later edit: Deploy > Manage deployments > Edit > New version.
 * 7. Run sendTestWelcome() once to see exactly what a learner receives (it goes to ADMIN_EMAIL).
 *
 * Emails are sent from the Google account that owns this script. Use skillmountainacademy@gmail.com.
 * The Form must have these 5 short-answer questions with EXACTLY these titles: Full name, Email, Phone, Programme, Reference.
 *
 * HOW PAYMENT WORKS
 *  - Paystack: the site calls this script right after payment. It confirms the payment with Paystack, marks the row PAID
 *    and sends the welcome email. Bank-transfer confirmations inside Paystack are caught by the 5-minute timer.
 *  - Bank transfer: the learner gets an "application received" email with the bank details and sends their teller.
 *    When you have confirmed the money in your UBA account, type PAID in the Status column of that row on the
 *    "Form Responses 1" tab. The welcome email is sent automatically (once only).
 */

var SHEET_NAME = "Form Responses 1";                 // the tab the Google Form writes to
var APPS_SHEET = "Applications";                     // full application details are saved here
var ADMIN_EMAIL = "skillmountainacademy@gmail.com";  // gets a notice for every confirmed payment

// Fees in naira (the discounted price the learner pays). The server uses these, never the amount sent by the browser.
var FEES = {
  "Graphics Design": 350000,
  "DevOps Engineering": 450000,
  "Cloud Engineering": 450000,
  "Cybersecurity": 650000,
  "Digital Marketing": 300000,
  "IELTS Training": 200000
};

// Google Drive link to each curriculum (share as "Anyone with the link can view"). Replace the examples.
var CURRICULUM = {
  "Graphics Design": "https://drive.google.com/REPLACE-graphics-curriculum",
  "DevOps Engineering": "https://drive.google.com/REPLACE-devops-curriculum",
  "Cloud Engineering": "https://drive.google.com/REPLACE-cloud-curriculum",
  "Cybersecurity": "https://drive.google.com/REPLACE-cybersecurity-curriculum",
  "Digital Marketing": "https://drive.google.com/REPLACE-marketing-curriculum",
  "IELTS Training": "https://drive.google.com/REPLACE-ielts-curriculum"
};

// Your Calendly link for booking class sessions (a 45-minute event type). Replace the example.
var CALENDLY_CLASSES = "https://calendly.com/REPLACE-with-your-link/class-session";
// Optional: a standing Google Meet or Zoom link. Leave "" if Calendly creates a link for each booking.
var CLASS_LINK = "";

var BANK = { name: "Skill Mountain Academy Limited", number: "1025440484", bank: "UBA" };

var APP_FIELDS = [
  ["Reference", "reference"], ["Payment method", "method"], ["Programme", "programme"], ["Full name", "fullName"],
  ["18 or older", "adult"], ["Country", "country"], ["City or state", "city"], ["Phone", "phone"], ["Email", "email"],
  ["Education", "education"], ["Duration", "duration"], ["English", "english"],
  ["Guardian name", "guardianName"], ["Guardian phone", "guardianPhone"],
  ["Computer literate", "computerLiterate"], ["Background", "background"], ["Background detail", "backgroundDetail"], ["Why this skill", "why"],
  ["Goals", "goals"], ["Industry", "industry"], ["Terms accepted", "terms"]
];

var EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
var REF_RE = /^SMA-(BT-)?[A-Z0-9]{8,24}$/;

// ---------- safety helpers ----------
// Cleans text from the website before it is saved: limits length and stops spreadsheet formula injection.
function clean_(v, max) {
  var t = String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 500);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}
// Escapes text before it goes into an HTML email.
function esc_(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// Simple rate limit: allows `limit` calls per `seconds` for a key. Returns false when the limit is passed.
function throttle_(key, limit, seconds) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), seconds);
  return n <= limit;
}

function sheet_() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME); }

// Finds columns by header text, and adds Status and Welcome sent columns if missing.
function cols_(s) {
  var n = s.getLastColumn();
  var m = {};
  s.getRange(1, 1, 1, n).getValues()[0].forEach(function (h, i) { m[String(h).trim().toLowerCase()] = i + 1; });
  ["Status", "Welcome sent"].forEach(function (h) {
    var k = h.toLowerCase();
    if (!m[k]) { n++; s.getRange(1, n).setValue(h); m[k] = n; }
  });
  return m;
}

function doGet() { return ContentService.createTextOutput("ok"); }

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var raw = (e && e.postData && e.postData.contents) || "";
    if (raw.length > 20000) return ContentService.createTextOutput("ok");                                   // too big
    if (!throttle_("g:" + Math.floor(Date.now() / 60000), 120, 120)) return ContentService.createTextOutput("ok"); // too many requests
    var d = JSON.parse(raw);
    if (d.action === "apply") { apply_(d); }
    else if (d.action === "verify") { verify_(String(d.reference || "")); }
    else if (d.action === "subscribe") { subscribe_(String(d.email || "")); }
    else if (d.event === "charge.success" && d.data) { verify_(String(d.data.reference || "")); } // optional Paystack webhook
  } catch (err) { console.error(err); }
  finally { lock.releaseLock(); }
  return ContentService.createTextOutput("ok");
}

// Saves the full application, and for bank transfers emails the bank details.
function apply_(d) {
  var c = {};
  APP_FIELDS.forEach(function (f) { c[f[1]] = clean_(d[f[1]], f[1] === "goals" || f[1] === "why" || f[1] === "backgroundDetail" ? 800 : 160); });
  c.email = String(d.email || "").trim().toLowerCase();
  if (!FEES[c.programme] || !REF_RE.test(String(d.reference)) || !EMAIL_RE.test(c.email)) return;   // only known programmes, valid reference and email
  c.reference = String(d.reference);
  c.method = c.method === "Bank transfer" ? "Bank transfer" : "Paystack";
  if (!throttle_("a:" + c.email, 5, 3600)) return;                                                   // max 5 applications per email per hour
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(APPS_SHEET) || ss.insertSheet(APPS_SHEET);
  if (s.getLastRow() === 0) s.appendRow(["Date"].concat(APP_FIELDS.map(function (f) { return f[0]; })));
  s.appendRow([new Date()].concat(APP_FIELDS.map(function (f) { return c[f[1]]; })));
  if (c.method === "Bank transfer") {
    MailApp.sendEmail({
      to: c.email, name: "Skill Mountain Academy", replyTo: ADMIN_EMAIL,
      subject: "We received your application: " + c.programme,
      htmlBody:
        "<p>Hi " + first_(c.fullName) + ",</p>" +
        "<p>Thank you for applying for <b>" + esc_(c.programme) + "</b> at Skill Mountain Academy.</p>" +
        "<p>Please pay <b>N" + FEES[c.programme].toLocaleString() + "</b> to the account below:</p>" +
        "<p>Account name: <b>" + BANK.name + "</b><br>Account number: <b>" + BANK.number + "</b><br>Bank: <b>" + BANK.bank + "</b></p>" +
        "<p>Your reference: <b>" + esc_(c.reference) + "</b></p>" +
        "<p>Send us your teller for confirmation on or before the scheduled date for the programme. Reply to this email with a photo of your teller, or send it on WhatsApp.</p>" +
        "<p>When we confirm your payment, we will send your welcome email with your curriculum and a link to book your classes.</p>" +
        "<p>Skill Mountain Academy</p>"
    });
    MailApp.sendEmail(ADMIN_EMAIL, "New bank-transfer application: " + c.programme,
      c.fullName + " applied for " + c.programme + " (N" + FEES[c.programme].toLocaleString() + ").\nEmail: " + c.email + "\nPhone: " + c.phone + "\nReference: " + c.reference +
      "\nWhen you confirm the money in UBA, type PAID in the Status column of the Form Responses 1 sheet.");
  }
}

// Confirms a Paystack payment, marks the row PAID, and sends the welcome email.
function verify_(ref) {
  if (!REF_RE.test(ref)) return;
  if (!throttle_("v:" + ref, 20, 600)) return;
  var s = sheet_(), c = cols_(s);
  for (var attempt = 0; attempt < 3; attempt++) {           // the form row can take a moment to appear
    var rows = s.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][c["reference"] - 1]).trim() !== ref) continue;
      if (rows[i][c["status"] - 1] === "PAID") return;
      var fee = FEES[String(rows[i][c["programme"] - 1]).trim()];
      if (!fee) return;
      var res = UrlFetchApp.fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(ref), {
        headers: { Authorization: "Bearer " + PropertiesService.getScriptProperties().getProperty("PAYSTACK_SECRET") },
        muteHttpExceptions: true
      });
      var j = JSON.parse(res.getContentText());
      if (j.status && j.data && j.data.status === "success" && j.data.amount >= fee * 100) {
        s.getRange(i + 1, c["status"]).setValue("PAID");
        welcome_(s, i + 1, c);
      }
      return;
    }
    Utilities.sleep(2500);
  }
}

// Sends the welcome email once for a row.
function welcome_(s, row, c) {
  var v = s.getRange(row, 1, 1, s.getLastColumn()).getValues()[0];
  if (v[c["welcome sent"] - 1]) return;
  var name = v[c["full name"] - 1], email = v[c["email"] - 1], programme = String(v[c["programme"] - 1]).trim();
  var ref = v[c["reference"] - 1], phone = v[c["phone"] - 1], fee = FEES[programme];
  if (!fee || !email) return;
  var when = Utilities.formatDate(new Date(), "Africa/Lagos", "d MMM yyyy, h:mm a");
  var btn = "display:inline-block;background:#c8233a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold";
  var meet = CLASS_LINK ? "<p>Your virtual classroom link: <a href='" + CLASS_LINK + "'>" + CLASS_LINK + "</a></p>" : "<p>Each booking comes with its own link to your virtual class.</p>";
  MailApp.sendEmail({
    to: email, name: "Skill Mountain Academy", replyTo: ADMIN_EMAIL,
    subject: "Welcome to Skill Mountain Academy: " + programme,
    htmlBody:
      "<p>Hi " + first_(name) + ",</p>" +
      "<p><b>Welcome to Skill Mountain Academy.</b> Your payment is confirmed and your place is secured.</p>" +
      "<table style='border-collapse:collapse'>" +
      "<tr><td style='padding:3px 16px 3px 0'>Programme</td><td><b>" + esc_(programme) + "</b></td></tr>" +
      "<tr><td style='padding:3px 16px 3px 0'>Amount paid</td><td><b>N" + fee.toLocaleString() + "</b></td></tr>" +
      "<tr><td style='padding:3px 16px 3px 0'>Reference</td><td><b>" + esc_(ref) + "</b></td></tr>" +
      "<tr><td style='padding:3px 16px 3px 0'>Date</td><td>" + when + "</td></tr></table>" +
      "<h3>Step 1: Get your curriculum</h3>" +
      "<p>This is everything you will cover.</p><p><a style='" + btn + "' href='" + (CURRICULUM[programme] || "#") + "'>Open my curriculum</a></p>" +
      "<h3>Step 2: Choose your class days and time</h3>" +
      "<p>Pick the days and time that suit you. For example, 3 days a week, 45 minutes a day, at 9 am.</p>" +
      "<p><a style='" + btn + "' href='" + CALENDLY_CLASSES + "'>Book my classes</a></p>" + meet +
      "<p>Questions? Just reply to this email and we will help.</p>" +
      "<p>Learn deeply. Grow confidently. Graduate prepared.<br>Skill Mountain Academy</p>"
  });
  s.getRange(row, c["welcome sent"]).setValue(new Date());
  MailApp.sendEmail(ADMIN_EMAIL, "Payment confirmed: " + programme,
    name + " paid N" + fee.toLocaleString() + " for " + programme + ".\nEmail: " + email + "\nPhone: " + phone + "\nReference: " + ref + "\nWelcome email sent.");
}

// Runs when you edit the sheet. Typing PAID in the Status column sends the welcome email (bank transfers).
function onStatusEdit(e) {
  var s = e.range.getSheet();
  if (s.getName() !== SHEET_NAME || e.range.getRow() < 2) return;
  var c = cols_(s);
  if (e.range.getColumn() !== c["status"]) return;
  if (String(e.value).trim().toUpperCase() !== "PAID") return;
  welcome_(s, e.range.getRow(), c);
}

function subscribe_(email) {
  email = String(email).trim().toLowerCase().slice(0, 150);
  if (!EMAIL_RE.test(email) || !throttle_("s:" + email, 3, 3600)) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName("Mailing list") || ss.insertSheet("Mailing list");
  if (s.getLastRow() === 0) s.appendRow(["Date", "Email", "Consent"]);
  var existing = s.getLastRow() > 1 ? s.getRange(2, 2, s.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).toLowerCase(); }) : [];
  if (existing.indexOf(email) === -1) s.appendRow([new Date(), email, "Ticked the consent box on the website"]);
}

function first_(name) { return esc_(String(name || "").trim().split(" ")[0] || "there"); }

// Runs every 5 minutes: checks recent Paystack rows that are not paid yet (bank-transfer references SMA-BT-... are skipped).
function sweep() {
  var s = sheet_(), c = cols_(s);
  var rows = s.getDataRange().getValues();
  var cutoff = Date.now() - 3 * 24 * 3600 * 1000;
  for (var i = 1; i < rows.length; i++) {
    var ref = String(rows[i][c["reference"] - 1]).trim();
    if (ref.indexOf("SMA-") === 0 && ref.indexOf("SMA-BT-") !== 0 && rows[i][c["status"] - 1] !== "PAID" && new Date(rows[i][0]).getTime() > cutoff) verify_(ref);
  }
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sweep").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("onStatusEdit").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
}

// Sends a sample welcome email to ADMIN_EMAIL so you can see what learners receive.
function sendTestWelcome() {
  var s = sheet_(), c = cols_(s);
  var row = s.getLastRow() + 1;
  s.getRange(row, c["full name"]).setValue("Test Learner");
  s.getRange(row, c["email"]).setValue(ADMIN_EMAIL);
  s.getRange(row, c["programme"]).setValue("Graphics Design");
  s.getRange(row, c["reference"]).setValue("SMA-TEST");
  s.getRange(row, c["phone"]).setValue("0000");
  welcome_(s, row, c);
  s.deleteRow(row);
}
