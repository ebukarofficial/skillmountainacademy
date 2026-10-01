/**
 * SMA payment check + confirmation emails. Runs on Google, no other server needed.
 * This script lives in the Google Sheet that your registration Google Form saves its answers to.
 *
 * SETUP
 * 1. Open the Google Sheet linked to your Form (Form > Responses > Link to Sheets).
 * 2. Extensions > Apps Script. Paste this file.
 * 3. Project Settings (gear) > Script Properties > add  PAYSTACK_SECRET = your Paystack SECRET key (sk_live_...).
 * 4. Edit RESOURCES below with your real learning links.
 * 5. Run setup() once (Run button) and accept the permissions. It adds a timer that checks payments every 5 minutes.
 * 6. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the URL into NEXT_PUBLIC_SHEET_URL.
 * After any later edit: Deploy > Manage deployments > Edit > New version.
 *
 * Emails are sent from the Google account that owns this script. Use skillmountainacademy@gmail.com.
 * The Form must have these 5 short-answer questions with EXACTLY these titles: Full name, Email, Phone, Programme, Reference.
 */

var SHEET_NAME = "Form Responses 1";
var ADMIN_EMAIL = "skillmountainacademy@gmail.com"; // gets a notice for every confirmed payment

// Fees in naira (the discounted price the learner pays). The server uses these, never the amount sent by the browser.
var FEES = {
  "Graphics Design": 350000,
  "DevOps Engineering": 450000,
  "Cloud Engineering": 450000,
  "Digital Marketing": 300000,
  "IELTS Training": 200000
};

// Links emailed after a confirmed payment. Replace the example links.
var RESOURCES = {
  "Graphics Design": [["Welcome guide", "https://example.com/graphics-guide"]],
  "DevOps Engineering": [["Welcome guide", "https://example.com/devops-guide"]],
  "Cloud Engineering": [["Welcome guide", "https://example.com/cloud-guide"]],
  "Digital Marketing": [["Welcome guide", "https://example.com/marketing-guide"]],
  "IELTS Training": [["Welcome guide", "https://example.com/ielts-guide"]]
};

function sheet_() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME); }

// Finds columns by their header text, and adds a Status column if it is missing.
function cols_(s) {
  var n = s.getLastColumn();
  var m = {};
  s.getRange(1, 1, 1, n).getValues()[0].forEach(function (h, i) { m[String(h).trim().toLowerCase()] = i + 1; });
  if (!m["status"]) { s.getRange(1, n + 1).setValue("Status"); m["status"] = n + 1; }
  return m;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.action === "verify") { verify_(d.reference); }
    else if (d.event === "charge.success" && d.data) { verify_(d.data.reference); } // optional Paystack webhook
  } catch (err) { console.error(err); }
  finally { lock.releaseLock(); }
  return ContentService.createTextOutput("ok");
}

// Confirms the payment with Paystack, marks the row PAID, and emails the learner once.
function verify_(ref) {
  if (!ref) return;
  var s = sheet_(), c = cols_(s);
  for (var attempt = 0; attempt < 3; attempt++) {           // the form row can take a moment to appear
    var rows = s.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][c["reference"] - 1]).trim() !== ref) continue;
      if (rows[i][c["status"] - 1] === "PAID") return;
      var programme = String(rows[i][c["programme"] - 1]).trim();
      var fee = FEES[programme];
      if (!fee) return;
      var res = UrlFetchApp.fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(ref), {
        headers: { Authorization: "Bearer " + PropertiesService.getScriptProperties().getProperty("PAYSTACK_SECRET") },
        muteHttpExceptions: true
      });
      var j = JSON.parse(res.getContentText());
      if (j.status && j.data && j.data.status === "success" && j.data.amount >= fee * 100) {
        s.getRange(i + 1, c["status"]).setValue("PAID");
        var name = rows[i][c["full name"] - 1], email = rows[i][c["email"] - 1], phone = rows[i][c["phone"] - 1];
        sendConfirmation_(name, email, programme, fee, ref);
        MailApp.sendEmail(ADMIN_EMAIL, "New paid registration: " + programme,
          name + " paid N" + fee.toLocaleString() + " for " + programme + ".\nEmail: " + email + "\nPhone: " + phone + "\nReference: " + ref);
      }
      return;
    }
    Utilities.sleep(2500);
  }
}

function sendConfirmation_(name, email, programme, fee, ref) {
  var links = (RESOURCES[programme] || []).map(function (l) { return '<li><a href="' + l[1] + '">' + l[0] + "</a></li>"; }).join("");
  var when = Utilities.formatDate(new Date(), "Africa/Lagos", "d MMM yyyy, h:mm a");
  MailApp.sendEmail({
    to: email,
    name: "Skill Mountain Academy",
    replyTo: ADMIN_EMAIL,
    subject: "Payment confirmed: " + programme + " | Skill Mountain Academy",
    htmlBody:
      "<p>Hi " + name + ",</p>" +
      "<p>Thank you. We have received your payment and your place is confirmed.</p>" +
      "<table style='border-collapse:collapse'>" +
      "<tr><td style='padding:4px 16px 4px 0'>Programme</td><td><b>" + programme + "</b></td></tr>" +
      "<tr><td style='padding:4px 16px 4px 0'>Amount paid</td><td><b>N" + fee.toLocaleString() + "</b></td></tr>" +
      "<tr><td style='padding:4px 16px 4px 0'>Reference</td><td><b>" + ref + "</b></td></tr>" +
      "<tr><td style='padding:4px 16px 4px 0'>Date</td><td>" + when + "</td></tr></table>" +
      "<p>Your learning resources:</p><ul>" + links + "</ul>" +
      "<p>Your mentor will contact you to schedule your first one-on-one session.</p>" +
      "<p>Learn deeply. Grow confidently. Graduate prepared.<br>Skill Mountain Academy</p>"
  });
}

// Runs every 5 minutes: checks recent unpaid rows (covers bank transfers that confirm later, and any missed callback).
function sweep() {
  var s = sheet_(), c = cols_(s);
  var rows = s.getDataRange().getValues();
  var cutoff = Date.now() - 3 * 24 * 3600 * 1000;
  for (var i = 1; i < rows.length; i++) {
    var ref = String(rows[i][c["reference"] - 1]).trim();
    if (ref.indexOf("SMA-") === 0 && rows[i][c["status"] - 1] !== "PAID" && new Date(rows[i][0]).getTime() > cutoff) verify_(ref);
  }
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sweep").timeBased().everyMinutes(5).create();
}
