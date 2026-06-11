import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "/Users/yakub/Desktop/iblotmark/outputs/inventory_count_system";
const outputPath = path.join(outputDir, "inventory_bin_count_template.xlsx");

const wb = Workbook.create();

const dashboard = wb.worksheets.add("Dashboard");
const settings = wb.worksheets.add("Settings");
const skuMaster = wb.worksheets.add("SKU Master");
const binLabels = wb.worksheets.add("Bin Labels");
const countEntry = wb.worksheets.add("Count Entry");
const accuracy = wb.worksheets.add("Accuracy Model");
const procurement = wb.worksheets.add("Procurement Plan");

const sheets = [dashboard, settings, skuMaster, binLabels, countEntry, accuracy, procurement];
for (const sheet of sheets) {
  sheet.showGridLines = false;
}

function setWidths(sheet, widths) {
  widths.forEach((px, index) => {
    sheet.getCell(0, index).format.columnWidthPx = px;
  });
}

function title(sheet, range, text, subtitle) {
  const [start] = range.split(":");
  sheet.getRange(start).values = [[text]];
  sheet.getRange(start).format.font = { bold: true, color: "#111827" };
  sheet.getRange(range).format.fill = { color: "#FFFFFF" };
  sheet.getRange(range).format.rowHeightPx = 36;
  if (subtitle) {
    const row = Number(start.replace(/[^0-9]/g, "")) + 1;
    sheet.getRange(`A${row}:H${row}`).merge();
    sheet.getRange(`A${row}`).values = [[subtitle]];
    sheet.getRange(`A${row}`).format.font = { italic: true, color: "#374151" };
    sheet.getRange(`A${row}`).format.wrapText = true;
    sheet.getRange(`A${row}:H${row}`).format.fill = { color: "#F3F4F6" };
  }
}

function header(range) {
  range.format.fill = { color: "#374151" };
  range.format.font = { bold: true, color: "#FFFFFF" };
  range.format.wrapText = true;
}

function noteBlock(sheet, range, values) {
  sheet.getRange(range).values = values;
  sheet.getRange(range).format.fill = { color: "#F9FAFB" };
  sheet.getRange(range).format.wrapText = true;
  sheet.getRange(range).format.borders = {
    top: { style: "Continuous", color: "#D1D5DB" },
    bottom: { style: "Continuous", color: "#D1D5DB" },
    left: { style: "Continuous", color: "#D1D5DB" },
    right: { style: "Continuous", color: "#D1D5DB" },
  };
}

// Settings
setWidths(settings, [210, 120, 380]);
title(
  settings,
  "A1:C1",
  "Inventory Count Settings",
  "Edit these assumptions once, then let Count Entry calculate every scanned bin."
);
settings.getRange("A4:C11").values = [
  ["Setting", "Value", "Notes"],
  ["Standard empty bin weight oz", 56, "Default tare from Katie's process. Override per bin in Bin Labels when needed."],
  ["Fractional quantity flag threshold", 0.35, "Flags a count when raw quantity is too far from a whole number."],
  ["Default scale readability oz", 0.8, "0.05 lb equals 0.8 oz. Update if your scale has finer or coarser readability."],
  ["Default bin tare variance oz", 1, "Expected difference between actual empty bins and the standard tare."],
  ["Default unit weight error %", 0.01, "Used only in Accuracy Model to estimate count uncertainty."],
  ["Rounding rule", "Nearest whole unit", "Final quantity uses ROUND(raw quantity, 0)."],
  ["Barcode symbology", "Code 128", "Recommended for internal SKU/bin labels."],
];
header(settings.getRange("A4:C4"));
settings.getRange("B5:B8").setNumberFormat("0.00");
settings.getRange("B9").setNumberFormat("0.00%");
settings.getRange("A4:C11").format.autofitRows();

// SKU Master
setWidths(skuMaster, [150, 280, 130, 120, 140, 140, 160, 140, 120, 280]);
title(
  skuMaster,
  "A1:J1",
  "SKU Master",
  "Maintain one trusted unit weight per SKU. Use sample counts to verify or improve the part weight before inventory week."
);
skuMaster.getRange("A4:J12").values = [
  ["SKU", "Product Name", "Unit Weight oz", "Sample Count", "Sample Weight oz", "Calculated Unit Weight oz", "Weight Source", "Last Verified", "Active", "Notes"],
  ["EXAMPLE-1.3OZ", "Example part from Katie email", 1.3, 100, 130, null, "Known weight", new Date("2026-05-14"), "Yes", "Replace with real iBolt SKU."],
  ["SKU-1001", "Tablet mount base", 2.4, 50, 120, null, "Sample", null, "Yes", ""],
  ["SKU-1002", "AMPS plate hardware kit", 0.35, 100, 35, null, "Sample", null, "Yes", "Use larger sample size for small hardware."],
  ["SKU-1003", "Forklift mount arm", 8.75, 20, 175, null, "Sample", null, "Yes", ""],
  ["", "", "", "", "", null, "", null, "", ""],
  ["", "", "", "", "", null, "", null, "", ""],
  ["", "", "", "", "", null, "", null, "", ""],
  ["", "", "", "", "", null, "", null, "", ""],
];
header(skuMaster.getRange("A4:J4"));
skuMaster.getRange("F5").formulas = [["=IF(OR(D5=\"\",E5=\"\"),\"\",E5/D5)"]];
skuMaster.getRange("F5:F12").fillDown();
skuMaster.getRange("C5:F12").setNumberFormat("0.000");
skuMaster.getRange("H5:H12").setNumberFormat("yyyy-mm-dd");
skuMaster.tables.add("A4:J12", true, "SkuMasterTable");
skuMaster.freezePanes.freezeRows(4);

// Bin Labels
setWidths(binLabels, [140, 150, 260, 140, 130, 360, 180, 280]);
title(
  binLabels,
  "A1:H1",
  "Bin Labels",
  "Each physical bin gets one barcode. The barcode should scan the Bin Barcode value exactly."
);
binLabels.getRange("A4:H12").values = [
  ["Bin Barcode", "SKU", "Product Name", "Empty Bin Weight oz", "Location", "Human Label Text", "Barcode Data", "Notes"],
  ["BIN-0001", "EXAMPLE-1.3OZ", null, 56, "A-01-01", null, null, "Example bin for Katie's 20 lb scenario."],
  ["BIN-0002", "SKU-1001", null, 56, "A-01-02", null, null, ""],
  ["BIN-0003", "SKU-1002", null, 56, "A-01-03", null, null, ""],
  ["BIN-0004", "SKU-1003", null, 56, "A-01-04", null, null, ""],
  ["", "", null, 56, "", null, null, ""],
  ["", "", null, 56, "", null, null, ""],
  ["", "", null, 56, "", null, null, ""],
  ["", "", null, 56, "", null, null, ""],
];
header(binLabels.getRange("A4:H4"));
binLabels.getRange("C5").formulas = [["=IFERROR(XLOOKUP(B5,'SKU Master'!$A$5:$A$504,'SKU Master'!$B$5:$B$504),\"\")"]];
binLabels.getRange("F5").formulas = [["=IF(A5=\"\",\"\",A5&\" | \"&B5&\" | \"&C5&\" | tare \"&TEXT(D5,\"0.0\")&\" oz\")"]];
binLabels.getRange("G5").formulas = [["=A5"]];
binLabels.getRange("C5:C12").fillDown();
binLabels.getRange("F5:G12").fillDown();
binLabels.getRange("D5:D12").setNumberFormat("0.00");
binLabels.tables.add("A4:H12", true, "BinLabelsTable");
binLabels.freezePanes.freezeRows(4);

// Count Entry
setWidths(countEntry, [110, 130, 140, 140, 260, 125, 125, 130, 130, 130, 120, 115, 115, 130, 260]);
title(
  countEntry,
  "A1:O1",
  "Count Entry",
  "Scan the bin barcode into column C, type the total bin weight from the scale in pounds, then review the calculated quantity and status."
);
countEntry.getRange("A4:O14").values = [
  ["Count Date", "Operator", "Bin Barcode", "SKU", "Product Name", "Unit Weight oz", "Empty Bin Weight oz", "Total Bin Weight lb", "Total Bin Weight oz", "Net Product Weight oz", "Raw Qty", "Final Qty", "Residual Units", "Status", "Notes"],
  [new Date("2026-05-14"), "Katie", "BIN-0001", null, null, null, null, 20, null, null, null, null, null, null, "Example: should calculate 203 units."],
  ["", "", "", null, null, null, null, "", null, null, null, null, null, null, ""],
  ["", "", "", null, null, null, null, "", null, null, null, null, null, null, ""],
  ["", "", "", null, null, null, null, "", null, null, null, null, null, null, ""],
  ["", "", "", null, null, null, null, "", null, null, null, null, null, null, ""],
  ["", "", "", null, null, null, null, "", null, null, null, null, null, null, ""],
  ["", "", "", null, null, null, null, "", null, null, null, null, null, null, ""],
  ["", "", "", null, null, null, null, "", null, null, null, null, null, null, ""],
  ["", "", "", null, null, null, null, "", null, null, null, null, null, null, ""],
  ["", "", "", null, null, null, null, "", null, null, null, null, null, null, ""],
];
header(countEntry.getRange("A4:O4"));
countEntry.getRange("D5").formulas = [["=IF(C5=\"\",\"\",IFERROR(XLOOKUP(C5,'Bin Labels'!$A$5:$A$504,'Bin Labels'!$B$5:$B$504),\"\"))"]];
countEntry.getRange("E5").formulas = [["=IF(D5=\"\",\"\",IFERROR(XLOOKUP(D5,'SKU Master'!$A$5:$A$504,'SKU Master'!$B$5:$B$504),\"\"))"]];
countEntry.getRange("F5").formulas = [["=IF(D5=\"\",\"\",IFERROR(XLOOKUP(D5,'SKU Master'!$A$5:$A$504,'SKU Master'!$C$5:$C$504),\"\"))"]];
countEntry.getRange("G5").formulas = [["=IF(C5=\"\",\"\",IFERROR(XLOOKUP(C5,'Bin Labels'!$A$5:$A$504,'Bin Labels'!$D$5:$D$504),Settings!$B$5))"]];
countEntry.getRange("I5").formulas = [["=IF(H5=\"\",\"\",H5*16)"]];
countEntry.getRange("J5").formulas = [["=IF(I5=\"\",\"\",I5-G5)"]];
countEntry.getRange("K5").formulas = [["=IF(OR(J5=\"\",F5=\"\"),\"\",J5/F5)"]];
countEntry.getRange("L5").formulas = [["=IF(K5=\"\",\"\",ROUND(K5,0))"]];
countEntry.getRange("M5").formulas = [["=IF(K5=\"\",\"\",ABS(K5-L5))"]];
countEntry.getRange("N5").formulas = [["=IF(C5=\"\",\"\",IF(D5=\"\",\"UNKNOWN BIN\",IF(OR(F5=\"\",F5<=0),\"MISSING UNIT WT\",IF(J5<0,\"GROSS < TARE\",IF(M5>Settings!$B$6,\"REWEIGH\",\"OK\")))))"]];
countEntry.getRange("D5:G14").fillDown();
countEntry.getRange("I5:N14").fillDown();
countEntry.getRange("A5:A14").setNumberFormat("yyyy-mm-dd");
countEntry.getRange("F5:K14").setNumberFormat("0.00");
countEntry.getRange("L5:L14").setNumberFormat("0");
countEntry.getRange("M5:M14").setNumberFormat("0.00");
countEntry.tables.add("A4:O14", true, "CountEntryTable");
countEntry.freezePanes.freezeRows(4);
countEntry.getRange("N5:N14").format.font = { bold: true, color: "#111827" };

// Accuracy Model
setWidths(accuracy, [260, 140, 360]);
title(
  accuracy,
  "A1:C1",
  "Accuracy Model",
  "Use this to decide whether a scale is precise enough for light parts and high-value SKUs."
);
accuracy.getRange("A4:C15").values = [
  ["Input / Output", "Value", "Notes"],
  ["Total bin weight lb", 20, "Gross weight from the scale."],
  ["Empty bin weight oz", 56, "Use exact bin tare when possible."],
  ["Unit part weight oz", 1.3, "From SKU Master."],
  ["Scale readability oz", null, "Defaults from Settings."],
  ["Bin tare variance oz", null, "Defaults from Settings."],
  ["Unit weight error %", null, "Defaults from Settings."],
  ["Gross weight oz", null, "Formula."],
  ["Net product weight oz", null, "Formula."],
  ["Calculated quantity", null, "Formula."],
  ["Estimated qty uncertainty", null, "Worst-case planning estimate."],
  ["Recommendation", null, "Formula."],
];
header(accuracy.getRange("A4:C4"));
accuracy.getRange("B8").formulas = [["=Settings!$B$7"]];
accuracy.getRange("B9").formulas = [["=Settings!$B$8"]];
accuracy.getRange("B10").formulas = [["=Settings!$B$9"]];
accuracy.getRange("B11").formulas = [["=B5*16"]];
accuracy.getRange("B12").formulas = [["=B11-B6"]];
accuracy.getRange("B13").formulas = [["=B12/B7"]];
accuracy.getRange("B14").formulas = [["=((B8/2)+B9+(B12*B10))/B7"]];
accuracy.getRange("B15").formulas = [["=IF(B14<=1,\"Good for routine counts\",IF(B14<=5,\"Good, but spot-check high-value bins\",\"Use finer scale or manual count for this SKU\"))"]];
accuracy.getRange("B5:B14").setNumberFormat("0.00");
accuracy.getRange("B10").setNumberFormat("0.00%");

// Dashboard
setWidths(dashboard, [230, 130, 200, 200, 200, 200, 200, 200]);
title(
  dashboard,
  "A1:H1",
  "Barcode Bin Count MVP",
  "Use this workbook as the first no-code version. It proves the workflow before buying scale integration software or building a custom app."
);
dashboard.getRange("A4:B8").values = [
  ["Metric", "Value"],
  ["Rows counted", null],
  ["OK rows", null],
  ["Rows needing review", null],
  ["Estimated units counted", null],
];
header(dashboard.getRange("A4:B4"));
dashboard.getRange("B5").formulas = [["=COUNTIF('Count Entry'!$N$5:$N$504,\"OK\")+COUNTIF('Count Entry'!$N$5:$N$504,\"REWEIGH\")+COUNTIF('Count Entry'!$N$5:$N$504,\"UNKNOWN BIN\")+COUNTIF('Count Entry'!$N$5:$N$504,\"MISSING UNIT WT\")+COUNTIF('Count Entry'!$N$5:$N$504,\"GROSS < TARE\")"]];
dashboard.getRange("B6").formulas = [["=COUNTIF('Count Entry'!$N$5:$N$504,\"OK\")"]];
dashboard.getRange("B7").formulas = [["=B5-B6"]];
dashboard.getRange("B8").formulas = [["=SUM('Count Entry'!$L$5:$L$504)"]];
dashboard.getRange("B5:B8").setNumberFormat("0");
noteBlock(dashboard, "D4:H10", [
  ["Recommended MVP Workflow", "", "", "", ""],
  ["1. Export active SKUs and create a trusted unit weight in SKU Master.", "", "", "", ""],
  ["2. Create one Bin Barcode per inventory bin and print labels from Bin Labels.", "", "", "", ""],
  ["3. Scan the bin into Count Entry, type gross weight in pounds, review Final Qty.", "", "", "", ""],
  ["4. Reweigh or manually count rows with REWEIGH / UNKNOWN / MISSING statuses.", "", "", "", ""],
  ["5. Export Count Entry to the inventory system after manager review.", "", "", "", ""],
  ["", "", "", "", ""],
]);
dashboard.getRange("D4:H4").merge();
dashboard.getRange("D4").format.font = { bold: true, color: "#111827" };
dashboard.getRange("D5:H10").merge(true);
dashboard.getRange("D5:H10").format.wrapText = true;

// Procurement
setWidths(procurement, [160, 220, 230, 150, 340, 320]);
title(
  procurement,
  "A1:F1",
  "Procurement Plan",
  "Shortlist of what to buy first, what to defer, and why."
);
procurement.getRange("A4:F14").values = [
  ["Priority", "Category", "Recommended Type", "Budget Range", "Why", "Notes"],
  ["Buy first", "Barcode scanner", "Corded USB 2D scanner", "$160-$250 each", "Scans 1D and 2D labels; works as keyboard input in simple tools.", "Zebra DS2208 or Honeywell Voyager XP 1470g class."],
  ["Buy first", "Label printer", "Direct thermal label printer", "$250-$1,100", "Prints durable bin labels with human text plus Code 128 barcode.", "Brother QL-820NWBc for office/simple labels; Zebra ZD421 for warehouse-standard labels."],
  ["Buy first", "Labels", "2x1, 3x1, or 4x2 thermal labels", "$20-$80/roll", "Readable human text and enough quiet zone for reliable scanning.", "Use synthetic/thermal-transfer labels if bins get rubbed or dirty."],
  ["Use existing initially", "Scale", "Existing bench/shipping scale", "$0", "Manual gross weight entry proves the process before integration.", "Confirm capacity and readability; avoid coarse 1+ oz readability for small parts."],
  ["Phase 2", "Scale", "USB/RS-232 bench scale", "$450-$700+", "Allows direct scale capture into app or Excel wedge software.", "CAS GW-150, Brecknell PS-USB, Ohaus Courier class."],
  ["Phase 2", "Workstation", "Laptop/tablet on rolling cart", "$0-$800", "Keeps scanner, scale, and count screen at the bin location.", "Use existing laptop if possible."],
  ["Phase 2", "Software", "Custom web app or spreadsheet automation", "$2k-$8k internal/dev", "Adds audit trail, user logins, exports, error handling, and scale input.", "Build after the MVP confirms data and workflow."],
  ["Optional", "Commercial system", "Counting-scale inventory software", "Quote/demo", "Useful if you want vendor-supported scale databases and ERP integration.", "ITRAX / PLU-style systems may be overkill for this specific workflow."],
  ["Optional", "Calibration", "NIST/ISO calibration certificate", "$100-$250 per scale", "Useful for repeatability and audit confidence.", "Consider annually or before inventory week."],
  ["Do not buy yet", "Camera AI counting", "Vision/counting AI", "Unknown", "Weight-based counting is simpler and likely more reliable for bins.", "Only revisit for mixed-SKU bins or hard-to-weigh items."],
];
header(procurement.getRange("A4:F4"));
procurement.getRange("A4:F14").format.wrapText = true;
procurement.getRange("A5:F14").format.rowHeightPx = 44;
procurement.tables.add("A4:F14", true, "ProcurementPlanTable");
procurement.freezePanes.freezeRows(4);

for (const sheet of sheets) {
  const used = sheet.getUsedRange();
  if (used) {
    used.format.autofitRows();
  }
}

await fs.mkdir(outputDir, { recursive: true });

const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

for (const sheetName of ["Dashboard", "Count Entry", "SKU Master", "Bin Labels", "Accuracy Model", "Procurement Plan"]) {
  const preview = await wb.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(
    path.join(outputDir, `${sheetName.toLowerCase().replace(/ /g, "_")}_preview.png`),
    new Uint8Array(await preview.arrayBuffer())
  );
}

const xlsx = await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(outputPath);
console.log(outputPath);
