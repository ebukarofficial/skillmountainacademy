/**
 * SMA registrations, payment check and resource emails. Runs on Google, so no other server is needed.
 *
 * SETUP
 * 1. In your Google Sheet: Extensions > Apps Script. Paste this file.
 * 2. Project Settings > Script Properties > add PAYSTACK_SECRET = your Paystack SECRET key (sk_live_...).
 * 3. Edit RESOURCES below with your real learning links.
 * 4. Run setup() once (Run button) and accept the permissions. It creates a timer that checks payments every 5 minutes.
 * 5. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the URL into NEXT_PUBLIC_SHEET_URL.
 * After any later edit: Deploy > Manage deployments > Edit > New version.
 *
 * Optional: set the Paystack webhook URL to the same web app URL. It is not required, because the timer catches every payment.
 */

// Fees in naira. The server uses these, never the amount sent by the browser.
var FEES = { "Graphics Design": 350000, "DevOps Engineer": 450000 };

// Links emailed after a confirmed payment. Replace the example links.
var RESOURCES = {
  "Graphics Design": [["Welcome guide", "https://example.com/graphics-guide"]],
  "DevOps Engineer": [["Welcome guide", "https://example.com/devops-guide"]]
};

var HEADERS = ["Date", "Name", "Email", "Phone", "Programme", "Fee", "Reference", "Status"];
var C = { REF: 7, STATUS: 8 }; // 1-based columns

function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(name) || ss.insertSheet(name);
  if (s.getLastRow() === 0) s.appendRow(headers);
  return s;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.event === "charge.success" && d.data) { verify_(d.data.reference); }          // Paystack webhook (optional)
    else if (d.action === "register") { register_(d); }
    else if (d.action === "verify") { verify_(d.reference); }
    else if (d.action === "subscribe" && d.email) { sheet_("Community", ["Date", "Email"]).appendRow([new Date(), d.email]); }
  } catch (err) { console.error(err); }
  finally { lock.releaseLock(); }
  return ContentService.createTextOutput("ok");
}

function register_(d) {
  if (!FEES[d.programme] || !d.reference) return; // unknown programme: ignore
  sheet_("Registrations", HEADERS).appendRow([new Date(), d.name, d.email, d.phone, d.programme, FEES[d.programme], d.reference, "PENDING"]);
}

// Confirms the payment with Paystack, marks the row PAID and emails the resources (once).
function verify_(ref) {
  if (!ref) return;
  var s = sheet_("Registrations", HEADERS);
  var rows = s.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][C.REF - 1] !== ref) continue;
    if (rows[i][C.STATUS - 1] === "PAID") return;
    var fee = FEES[rows[i][4]];
    var res = UrlFetchApp.fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(ref), {
      headers: { Authorization: "Bearer " + PropertiesService.getScriptProperties().getProperty("PAYSTACK_SECRET") },
      muteHttpExceptions: true
    });
    var j = JSON.parse(res.getContentText());
    if (j.status && j.data && j.data.status === "success" && j.data.amount >= fee * 100) {
      s.getRange(i + 1, C.STATUS).setValue("PAID");
      sendResources_(rows[i][1], rows[i][2], rows[i][4]);
    }
    return;
  }
}

function sendResources_(name, email, programme) {
  var links = (RESOURCES[programme] || []).map(function (l) { return '<li><a href="' + l[1] + '">' + l[0] + "</a></li>"; }).join("");
  MailApp.sendEmail({
    to: email,
    name: "Skill Mountain Academy",
    subject: "Welcome to Skill Mountain Academy: " + programme,
    htmlBody: "<p>Hi " + name + ",</p><p>Your payment for <b>" + programme + "</b> is confirmed. Here are your learning resources:</p><ul>" + links +
      "</ul><p>Your mentor will contact you to schedule your first one-on-one session.</p><p>Skill Mountain Academy</p>"
  });
}

// Runs every 5 minutes: checks recent PENDING rows (covers bank transfers that confirm later).
function sweep() {
  var s = sheet_("Registrations", HEADERS);
  var rows = s.getDataRange().getValues();
  var cutoff = Date.now() - 3 * 24 * 3600 * 1000;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][C.STATUS - 1] === "PENDING" && new Date(rows[i][0]).getTime() > cutoff) verify_(rows[i][C.REF - 1]);
  }
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sweep").timeBased().everyMinutes(5).create();
}
