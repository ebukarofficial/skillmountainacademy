// In your Google Sheet: Extensions > Apps Script, paste this, then
// Deploy > New deployment > Web app > Execute as: Me, Access: Anyone.
// Copy the web app URL into NEXT_PUBLIC_SHEET_URL and the SHEET_URL Supabase secret.
function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName("Registrations") || ss.insertSheet("Registrations");
  if (s.getLastRow() === 0) s.appendRow(["Date", "Name", "Email", "Phone", "Programme", "Fee", "Reference", "Status"]);

  if (d.action === "paid") {
    var rows = s.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][6] === d.reference) { s.getRange(i + 1, 8).setValue("PAID"); break; }
    }
  } else {
    s.appendRow([new Date(), d.name, d.email, d.phone, d.programme, d.fee, d.reference, "PENDING"]);
  }
  return ContentService.createTextOutput("ok");
}
