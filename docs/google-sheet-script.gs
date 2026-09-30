/**
 * SMA: Google Form registrations, payment check and confirmation emails. Runs on Google, so no other server is needed.
 * Use the Google account skillmountainacademy@gmail.com to create the Sheet and this script, so emails are sent from it.
 *
 * SETUP (about 10 minutes)
 * 1. Create a new Google Sheet. Extensions > Apps Script. Paste this whole file. Save.
 * 2. Project Settings (gear) > Script Properties > Add: PAYSTACK_SECRET = your Paystack SECRET key (sk_live_...).
 * 3. Edit RESOURCES below: put your real learning links for each programme.
 * 4. Run createRegistrationForm() once (pick it in the function menu, click Run, accept permissions).
 *    Open View > Logs (Execution log). It prints a block "export const FORM = ...". Copy it into lib/config.ts on GitHub.
 * 5. Run setup() once. It adds the Status column and a timer that checks payments every 5 minutes.
 * 6. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the URL into the
 *    GitHub secret NEXT_PUBLIC_SHEET_URL.
 * After editing this script later: Deploy > Manage deployments > Edit > New version.
 *
 * MANUAL ALTERNATIVE to step 4: create a Google Form with 6 short-answer questions in this exact order:
 * Full name, Email, Phone, Programme, Amount, Payment reference. Link it to this Sheet (Responses > Link to Sheets),
 * then get each question's entry.NNN id from Get pre-filled link.
 */

// Fees in naira. The server uses these, never the amount sent by the browser. Keep in step with lib/config.ts.
var FEES = {
  "Graphics Design": 350000,
  "DevOps Engineer": 450000,
  "Cloud Engineer": 450000,
  "Digital Marketing": 300000,
  "IELTS Training": 200000
};

// Links emailed after a confirmed payment. Replace the example links.
var RESOURCES = {
  "Graphics Design": [["Welcome guide", "https://example.com/graphics-guide"]],
  "DevOps Engineer": [["Welcome guide", "https://example.com/devops-guide"]],
  "Cloud Engineer": [["Welcome guide", "https://example.com/cloud-guide"]],
  "Digital Marketing": [["Welcome guide", "https://example.com/marketing-guide"]],
  "IELTS Training": [["Welcome guide", "https://example.com/ielts-guide"]]
};

var ACADEMY_EMAIL = "skillmountainacademy@gmail.com";
// Form Responses columns: A Timestamp, B Name, C Email, D Phone, E Programme, F Amount, G Reference, H Status
var C = { NAME: 2, EMAIL: 3, PROG: 5, REF: 7, STATUS: 8 };

function respSheet_() {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  for (var i = 0; i < sheets.length; i++) if (/^Form Responses/.test(sheets[i].getName())) return sheets[i];
  return null;
}

// Run once. Creates the registration form, sends its answers to this Sheet, and prints the values for lib/config.ts.
function createRegistrationForm() {
  var form = FormApp.create("Skill Mountain Academy Registration");
  form.setDestination(FormApp.DestinationType.SPREADSHEET, SpreadsheetApp.getActiveSpreadsheet().getId());
  form.setCollectEmail(false);
  try { form.setRequireLogin(false); } catch (e) { /* only applies to Workspace accounts */ }
  form.setAcceptingResponses(true);
  var titles = ["Full name", "Email", "Phone", "Programme", "Amount", "Payment reference"];
  var keys = ["name", "email", "phone", "programme", "amount", "reference"];
  var items = titles.map(function (t) { return form.addTextItem().setTitle(t).setRequired(true); });

  // A pre-filled link reveals each question's entry.NNN id
  var r = form.createResponse();
  items.forEach(function (it, i) { r.withItemResponse(it.createResponse("x" + i)); });
  var url = r.toPrefilledUrl();
  var entries = {};
  var re = /entry\.(\d+)=x(\d)/g, m;
  while ((m = re.exec(url))) entries[keys[Number(m[2])]] = "entry." + m[1];

  var action = form.getPublishedUrl().replace(/\/viewform.*$/, "/formResponse");
  Logger.log("Paste this into lib/config.ts:\n\nexport const FORM = {\n  action: \"" + action + "\",\n  entries: " + JSON.stringify(entries) + ",\n};\n\nForm editor: " + form.getEditUrl());
}

// Run once. Adds the Status header and the payment-check timer.
function setup() {
  var s = respSheet_();
  if (s) s.getRange(1, C.STATUS).setValue("Status");
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sweep").timeBased().everyMinutes(5).create();
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.event === "charge.success" && d.data) verify_(d.data.reference);              // Paystack webhook (optional)
    else if (d.action === "verify") verify_(d.reference);
    else if (d.action === "subscribe" && d.email) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var c = ss.getSheetByName("Community") || ss.insertSheet("Community");
      if (c.getLastRow() === 0) c.appendRow(["Date", "Email"]);
      c.appendRow([new Date(), d.email]);
    }
  } catch (err) { console.error(err); }
  finally { lock.releaseLock(); }
  return ContentService.createTextOutput("ok");
}

// Confirms the payment with Paystack, marks the row PAID and sends the confirmation email (once).
function verify_(ref) {
  var s = respSheet_();
  if (!ref || !s) return;
  var rows = s.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][C.REF - 1] !== ref) continue;
    if (rows[i][C.STATUS - 1] === "PAID") return;
    var prog = rows[i][C.PROG - 1], fee = FEES[prog];
    if (!fee) return;
    var res = UrlFetchApp.fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(ref), {
      headers: { Authorization: "Bearer " + PropertiesService.getScriptProperties().getProperty("PAYSTACK_SECRET") },
      muteHttpExceptions: true
    });
    var j = JSON.parse(res.getContentText());
    if (j.status && j.data && j.data.status === "success" && j.data.amount >= fee * 100) {
      s.getRange(i + 1, C.STATUS).setValue("PAID");
      sendConfirmation_(rows[i][C.NAME - 1], rows[i][C.EMAIL - 1], prog, j.data.amount / 100, ref);
    }
    return;
  }
}

function sendConfirmation_(name, email, programme, amount, ref) {
  var links = (RESOURCES[programme] || []).map(function (l) { return '<li><a href="' + l[1] + '">' + l[0] + "</a></li>"; }).join("");
  var when = Utilities.formatDate(new Date(), "Africa/Lagos", "d MMM yyyy, h:mm a");
  var html =
    "<p>Hi " + name + ",</p>" +
    "<p><b>Your payment is confirmed.</b> Welcome to Skill Mountain Academy.</p>" +
    "<table cellpadding='6' style='border:1px solid #ddd;border-collapse:collapse'>" +
    "<tr><td>Programme</td><td><b>" + programme + "</b></td></tr>" +
    "<tr><td>Amount paid</td><td><b>\u20A6" + Number(amount).toLocaleString("en-NG") + "</b></td></tr>" +
    "<tr><td>Reference</td><td><b>" + ref + "</b></td></tr>" +
    "<tr><td>Date</td><td>" + when + "</td></tr></table>" +
    "<p>Your learning resources:</p><ul>" + links + "</ul>" +
    "<p>Your mentor will contact you to schedule your first one-on-one session.</p>" +
    "<p>Questions? Reply to this email or WhatsApp us.<br>Skill Mountain Academy<br>For those made for more.</p>";
  MailApp.sendEmail({ to: email, bcc: ACADEMY_EMAIL, name: "Skill Mountain Academy", replyTo: ACADEMY_EMAIL,
    subject: "Payment confirmed: " + programme + " | Skill Mountain Academy", htmlBody: html });
}

// Runs every 5 minutes: checks recent unpaid rows (catches bank transfers that confirm later).
function sweep() {
  var s = respSheet_();
  if (!s) return;
  var rows = s.getDataRange().getValues();
  var cutoff = Date.now() - 3 * 24 * 3600 * 1000;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][C.STATUS - 1] !== "PAID" && rows[i][C.REF - 1] && new Date(rows[i][0]).getTime() > cutoff) verify_(rows[i][C.REF - 1]);
  }
}
