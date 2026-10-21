/**
 * ============================================================
 * Production Dashboard — Google Apps Script v4.0
 * ============================================================
 * รองรับ:
 * 1. doGet/doPost → Dashboard web app sync
 * 2. Daily Record → บันทึกเดือนลง History (Prepare/Assembly)
 * 3. OT → บันทึกยอด OT รายเดือนลง OT Monthly History
 * 4. Dropdown เดือน → แสดงข้อมูลใน History sheet
 * ============================================================
 */

// Target is the spreadsheet supplied in this conversation. Verify before deploying.
var SPREADSHEET_ID = '1mthoDraqJTpKQgTp89V7iiZyXTNjBkDloyC0YrT3E6s';

var SHEET = {
  dailyPrepare:   'Daily Record (Prepare)',
  dailyAssembly:  'Daily Record (Assembly)',
  histPrepare:    'History (Prepare)',
  histAssembly:   'History (Assembly)',
  otHistory:      'OT Monthly History',
  trainingPlan:   'Training Plan',
  skillPrepare:   'Skill Matrix (Prepare)',
  skillAssembly:  'Skill Matrix (Assembly)',
  efficiency:     'Production Efficiency',
  settings:       'Dashboard Settings'
};

// Daily Record layout
var DAILY_DATA_START = 7;
var DAILY_DATA_END   = 37;
var DAILY_MONTH_CELL = 'J2';   // เซลล์ที่ระบุ เดือน/ปี เช่น "06-2026"
var N_COLS           = 18;

// History layout
var HIST_DISPLAY_START = 9;    // แถวแรกของ display area
var HIST_DISPLAY_END   = 39;   // แถวสุดท้าย
var HIST_BLOCK_SIZE    = 35;   // rows per month block
var HIST_BLOCK_START   = 42;   // แถวแรกของ data storage area
var MONTH_SELECTOR     = 'B4'; // dropdown cell

var TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                 'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

// COL mapping (0-based from col A)
var COL = {
  day:0, plan:1, actual:2, pctOutput:3,
  stdHrs:4, actualHrs:5, pctProductivity:6,
  ng:7, ppm:8, rework:9, pctRework:10,
  lossTime:11, plannedHC:12, actualHC:13,
  pctAttendance:14, ot:15, accidents:16, note:17
};
var TOTAL_DAILY_COLS = 18;
var SKILL_HEADER_ROW = 4;
var SKILL_DATA_START = 5;
var SKILL_DATA_END   = 64;
var DEFAULT_TARGETS  = {efficiency:95,attendance:95,ng:5,rework:3,losstime:0,ot:100};

// ============================================================
// MENU
// ============================================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('📋 Daily Record Tools')
    .addItem('💾 บันทึกเดือนนี้ → History (Prepare)',  'saveMonthPrepare')
    .addItem('💾 บันทึกเดือนนี้ → History (Assembly)', 'saveMonthAssembly')
    .addSeparator()
    .addItem('💾 บันทึกทั้งสองห้องพร้อมกัน',           'saveMonthBoth')
    .addSeparator()
    .addItem('💾 บันทึก Attendance เดือนนี้',           'saveAttendanceMonth')
    .addSeparator()
    .addItem('🔄 แสดงข้อมูลเดือนที่เลือก (Prepare)',   'showSelectedMonthPrepare')
    .addItem('🔄 แสดงข้อมูลเดือนที่เลือก (Assembly)',  'showSelectedMonthAssembly')
    .addToUi();

  ui.createMenu('⏱ OT Tools')
    .addItem('💾 บันทึก OT เดือนนี้ → OT Monthly History', 'archiveCurrentMonthOT')
    .addToUi();
}

// ============================================================
// SAVE MONTH → HISTORY
// ============================================================
function saveMonthPrepare()  { saveMonthToHistory(SHEET.dailyPrepare,  SHEET.histPrepare,  'เตรียมงาน'); }
function saveMonthAssembly() { saveMonthToHistory(SHEET.dailyAssembly, SHEET.histAssembly, 'ประกอบ'); }
function saveMonthBoth() {
  saveMonthPrepare();
  saveMonthAssembly();
  SpreadsheetApp.getUi().alert('✅ บันทึกทั้งสองห้องสำเร็จแล้ว!');
}

function saveMonthToHistory(dailySheetName, histSheetName, roomLabel) {
  var ss        = SpreadsheetApp.openById(SPREADSHEET_ID);
  var ui        = SpreadsheetApp.getUi();
  var wsDaily   = ss.getSheetByName(dailySheetName);
  var wsHist    = ss.getSheetByName(histSheetName);

  if (!wsDaily || !wsHist) {
    ui.alert('❌ ไม่พบ Sheet: ' + dailySheetName + ' หรือ ' + histSheetName);
    return;
  }

  // อ่านเดือน/ปี จากเซลล์ J2 เช่น "06-2026"
  var monthCell = wsDaily.getRange(DAILY_MONTH_CELL).getValue();
  if (!monthCell) {
    ui.alert('❌ กรุณากรอก เดือน/ปี ในเซลล์ J2 ก่อน เช่น 06-2026');
    return;
  }

  // แปลง "06-2026" → month index 5 (0-based), year 2026
  var parsedMonth = parseDashboardMonth_(monthCell);
  if (!parsedMonth) { ui.alert('❌ เดือน/ปี ไม่ถูกต้อง'); return; }
  var monthIdx = parsedMonth.monthIdx;
  var year = parsedMonth.year;
  var monthTH  = TH_MONTHS[monthIdx];
  var monthLabel = monthTH + ' ' + year;

  // ยืนยัน
  var resp = ui.alert(
    '💾 บันทึกข้อมูล ' + roomLabel,
    'จะบันทึกข้อมูล "' + monthLabel + '" ลง History\n\n' +
    '⚠️ ถ้าเคยบันทึกเดือนนี้แล้ว จะถูกเขียนทับ\n\nยืนยันหรือไม่?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  // อ่านข้อมูลจาก Daily Record (col A ถึง R = 18 cols)
  var numRows = DAILY_DATA_END - DAILY_DATA_START + 1;
  var data = wsDaily.getRange(DAILY_DATA_START, 1, numRows, TOTAL_DAILY_COLS).getValues();

  // คำนวณ row เริ่มต้นใน History storage
  var blockStart = HIST_BLOCK_START + monthIdx * HIST_BLOCK_SIZE;
  var existingHeader = wsHist.getRange(blockStart,1).getValue();
  var existingMonth = parseDashboardMonth_(existingHeader);
  if (!existingMonth || existingMonth.key !== parsedMonth.key) {
    ui.alert('❌ เดือน/ปีของบล็อก History ไม่ตรงกัน หยุดบันทึกเพื่อป้องกันข้อมูลเก่าถูกเขียนทับ');
    return;
  }
  var dataStart  = blockStart + 2;  // +0=month header, +1=col headers, +2=data

  // เขียนข้อมูลลง storage area
  wsHist.getRange(dataStart, 1, numRows, TOTAL_DAILY_COLS).setValues(data);

  // บันทึกวันที่บันทึก
  var savedAtRow = dataStart + numRows + 1;
  wsHist.getRange(savedAtRow, 1).setValue('บันทึกเมื่อ: ' + new Date().toLocaleString('th-TH'));

  // อัปเดต display area ให้แสดงเดือนที่เพิ่งบันทึก
  wsHist.getRange(MONTH_SELECTOR).setValue(monthLabel);
  showMonthInHistory_(wsHist, monthIdx, year);

  ui.alert('✅ บันทึก "' + monthLabel + '" สำเร็จ!\n\nดูข้อมูลได้จาก dropdown ด้านบน Sheet');
}

// ============================================================
// SHOW SELECTED MONTH
// ============================================================
function showSelectedMonthPrepare()  { showSelectedMonth_(SHEET.histPrepare); }
function showSelectedMonthAssembly() { showSelectedMonth_(SHEET.histAssembly); }

function showSelectedMonth_(histSheetName) {
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var wsHist = ss.getSheetByName(histSheetName);
  if (!wsHist) return;

  var selectedLabel = wsHist.getRange(MONTH_SELECTOR).getValue();
  if (!selectedLabel) {
    SpreadsheetApp.getUi().alert('❌ กรุณาเลือกเดือนจาก dropdown ก่อน');
    return;
  }

  // แปลง label → index เช่น "ม.ค. 2026" → 0
  var parsedMonth = parseDashboardMonth_(selectedLabel);
  var year = parsedMonth ? parsedMonth.year : null;
  var monthIdx = parsedMonth ? parsedMonth.monthIdx : -1;
  if (monthIdx < 0) {
    SpreadsheetApp.getUi().alert('❌ ไม่พบข้อมูลเดือน: ' + selectedLabel);
    return;
  }

  showMonthInHistory_(wsHist, monthIdx, year);
  SpreadsheetApp.getUi().alert('✅ แสดงข้อมูล ' + selectedLabel + ' แล้ว');
}

function showMonthInHistory_(wsHist, monthIdx, year) {
  var blockStart = HIST_BLOCK_START + monthIdx * HIST_BLOCK_SIZE;
  var dataStart  = blockStart + 2;
  var numRows    = DAILY_DATA_END - DAILY_DATA_START + 1;

  // อ่านข้อมูลจาก storage
  var archiveMonth = parseDashboardMonth_(wsHist.getRange(blockStart,1).getValue());
  if (!archiveMonth || archiveMonth.year !== year || archiveMonth.monthIdx !== monthIdx) {
    wsHist.getRange(HIST_DISPLAY_START,1,HIST_DISPLAY_END-HIST_DISPLAY_START+1,TOTAL_DAILY_COLS).clearContent();
    wsHist.getRange('E4').setValue('ไม่พบบล็อกข้อมูลของเดือน/ปีที่เลือก');
    return;
  }
  var stored = wsHist.getRange(dataStart, 1, numRows, TOTAL_DAILY_COLS).getValues();

  // เขียนลง display area (rows 9-39)
  var displayRows = HIST_DISPLAY_END - HIST_DISPLAY_START + 1;
  var displayData = [];
  for (var i = 0; i < displayRows; i++) {
    displayData.push(i < stored.length ? stored[i] : new Array(TOTAL_DAILY_COLS).fill(''));
  }
  wsHist.getRange(HIST_DISPLAY_START, 1, displayRows, TOTAL_DAILY_COLS).setValues(displayData);

  // อัปเดต status cell
  var monthTH   = TH_MONTHS[monthIdx];
  var monthLabel = monthTH + ' ' + year;
  var savedAt    = wsHist.getRange(dataStart + numRows + 1, 1).getValue();
  wsHist.getRange('E4').setValue(savedAt || 'ยังไม่มีข้อมูล — กด "บันทึกเดือนนี้" ก่อน');
}

// ============================================================
// ON EDIT TRIGGER — auto-refresh display when dropdown changes
// ============================================================
function onEdit(e) {
  var sheet = e.range.getSheet();
  var cell  = e.range.getA1Notation();
  if (cell !== MONTH_SELECTOR) return;

  var name = sheet.getName();
  if (name === SHEET.histPrepare)  showSelectedMonth_(SHEET.histPrepare);
  if (name === SHEET.histAssembly) showSelectedMonth_(SHEET.histAssembly);
}

// ============================================================
// OT ARCHIVE
// ============================================================
function archiveCurrentMonthOT() {
  var ss   = SpreadsheetApp.openById(SPREADSHEET_ID);
  var ui   = SpreadsheetApp.getUi();

  var wsP   = ss.getSheetByName(SHEET.dailyPrepare);
  var wsA   = ss.getSheetByName(SHEET.dailyAssembly);
  var wsOT  = ss.getSheetByName(SHEET.otHistory);
  if (!wsP || !wsA || !wsOT) { ui.alert('❌ ไม่พบ Sheet ที่ต้องการ'); return; }

  // อ่านเดือนจาก Prepare Daily Record J2
  var monthCell = wsP.getRange(DAILY_MONTH_CELL).getValue();
  var parsedMonth = parseDashboardMonth_(monthCell);
  if (!parsedMonth) { ui.alert('❌ เดือน/ปี ไม่ถูกต้อง'); return; }
  var monthIdx = parsedMonth.monthIdx;
  var monthTH   = TH_MONTHS[monthIdx];

  var prepOT = sumCol_(wsP, COL.ot);
  var asmOT  = sumCol_(wsA, COL.ot);
  var total  = Math.round((prepOT + asmOT) * 10) / 10;

  var resp = ui.alert(
    '⏱ บันทึก OT เดือน ' + monthTH,
    'เตรียมงาน: ' + prepOT + ' ชม.\n' +
    'ประกอบ: '    + asmOT  + ' ชม.\n' +
    'รวม: '       + total  + ' ชม.\n\nบันทึกหรือไม่?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  // เขียนลง OT History rows 12-23 (Jan=12, Feb=13, ...)
  var r = 12 + monthIdx;
  wsOT.getRange(r, 3).setValue(prepOT);
  wsOT.getRange(r, 4).setValue(asmOT);
  wsOT.getRange(r, 6).setValue(new Date());

  ui.alert('✅ บันทึก OT ' + monthTH + ' สำเร็จ!');
}

function sumCol_(ws, colIdx) {
  var numRows = DAILY_DATA_END - DAILY_DATA_START + 1;
  var vals    = ws.getRange(DAILY_DATA_START, colIdx+1, numRows, 1).getValues();
  var sum     = 0;
  vals.forEach(function(r) {
    var v = parseFloat(r[0]);
    if (!isNaN(v)) sum += v;
  });
  return Math.round(sum * 10) / 10;
}

// ============================================================
// WEB APP — doGet / doPost (Dashboard sync)
// ============================================================


// ── READ: Daily Record ──


// ── READ: Skill Matrix ──

// ── READ: Production Efficiency ──

// ── READ: Training Plan ──

// ── READ: OT History ──

// ── TARGETS ──

// ============================================================
// SAVE ATTENDANCE MONTH → Monthly Summary
// ============================================================
function saveAttendanceMonth() {
  var ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
  var ui  = SpreadsheetApp.getUi();
  var wsD = ss.getSheetByName(SHEET.dailyPrepare);  // อ่านเดือนจาก J2
  var wsA = ss.getSheetByName("Attendance");

  if (!wsD || !wsA) { ui.alert("❌ ไม่พบ Sheet"); return; }

  var monthCell = wsD.getRange(DAILY_MONTH_CELL).getValue();
  if (!monthCell) { ui.alert("❌ กรุณากรอก เดือน/ปี ในเซลล์ J2 ก่อน"); return; }

  var parsedMonth = parseDashboardMonth_(monthCell);
  if (!parsedMonth) { ui.alert('❌ เดือน/ปี ไม่ถูกต้อง'); return; }
  var monthIdx = parsedMonth.monthIdx;
  var year = parsedMonth.year;
  var monthTH  = TH_MONTHS[monthIdx];
  var label    = monthTH + " " + year;

  // อ่านจาก daily area rows 25-55 (col 3=Total, 4=Present, 5=Leave, 6=Absent, 7=ResignJBT, 8=ResignNSR)
  var totalMandays   = 0, presentMandays = 0;
  var leave = 0, absent = 0, resignJBT = 0, resignNSR = 0, workDays = 0;

  for (var r = 25; r <= 55; r++) {
    var tot = wsA.getRange(r, 3).getValue();
    var pre = wsA.getRange(r, 4).getValue();
    var lv  = wsA.getRange(r, 5).getValue();
    var ab  = wsA.getRange(r, 6).getValue();
    var jbt = wsA.getRange(r, 7).getValue();
    var nsr = wsA.getRange(r, 8).getValue();

    if (tot && Number(tot) > 0) {
      totalMandays   += Number(tot) || 0;
      presentMandays += Number(pre) || 0;
      leave          += Number(lv)  || 0;
      absent         += Number(ab)  || 0;
      resignJBT      += Number(jbt) || 0;
      resignNSR      += Number(nsr) || 0;
      workDays++;
    }
  }

  var attPct = totalMandays > 0 ? Math.round(presentMandays/totalMandays*1000)/1000 : "";

  var resp = ui.alert(
    "💾 บันทึก Attendance " + label,
    "Work Days: " + workDays + " วัน" + "\n" +
    "Total: " + totalMandays + " man-days" + "\n" +
    "Present: " + presentMandays + " man-days" + "\n" +
    "Attendance: " + Math.round(attPct*1000)/10 + "%" + "\n\nบันทึกหรือไม่?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  // เขียนลง Monthly Summary row (Jan=8, Feb=9, ...)
  var r = 8 + monthIdx;
  wsA.getRange(r, 2).setValue(workDays);       // Work Days
  wsA.getRange(r, 3).setValue(totalMandays);    // Total
  wsA.getRange(r, 4).setValue(presentMandays);  // Present
  wsA.getRange(r, 5).setValue(leave);           // Leave
  wsA.getRange(r, 6).setValue(absent);          // Absent
  wsA.getRange(r, 7).setValue(resignJBT);       // Resign JBT
  wsA.getRange(r, 8).setValue(resignNSR);       // Resign NSR
  wsA.getRange(r, 12).setValue(new Date());     // บันทึกเมื่อ

  ui.alert("✅ บันทึก Attendance " + label + " สำเร็จ!\nข้อมูลอยู่ใน Monthly Summary แล้วครับ");
}


// ============================================================
// ===== DASHBOARD API (v5) — doGet + read functions =====
// ============================================================

var SHEET5 = {
  dailyPrepare:  'Daily Record (Prepare)',
  dailyAssembly: 'Daily Record (Assembly)',
  efficiency:    'Efficiency',
  attendance:    'Attendance',
  quality:       'Quality',
  skill:         'Skill Matrix',
  turnover:      'Turnover',
  otHistory:     'OT Monthly History',
  training:      'Training Plan',
  settings:      'Dashboard Settings'
};

var DAILY_START = 7, DAILY_END = 37;
var COL = { day:0,plan:1,actual:2,pctOutput:3,stdHrs:4,actualHrs:5,pctProd:6,
  ng:7,ppm:8,rework:9,pctRework:10,lossTime:11,plannedHC:12,actualHC:13,
  pctAtt:14,ot:15,accidents:16,note:17 };

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    if (params.path && params.path !== '/dashboard') {
      return json({ok:false,error:{code:'NOT_FOUND',status:404,message:'Unsupported route'}});
    }
    var requested = params.month ? parseDashboardMonth_(params.month) : null;
    if (params.month && !requested) return json({ok:false,error:{code:'INVALID_MONTH',status:400,message:'Use MM-YYYY or YYYY-MM'}});
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var dailySheet = ss.getSheetByName(SHEET5.dailyPrepare);
    var currentMonth = dailySheet && parseDashboardMonth_(dailySheet.getRange(DAILY_MONTH_CELL).getValue());
    var selected = requested || currentMonth;
    if (!selected) return json({ok:false,error:{code:'MISSING_MONTH',status:400,message:'Cannot resolve Daily Record month'}});
    var history = readProductionHistory_(ss);
    var prepare = readProductionRoomMonth_(ss, SHEET5.dailyPrepare, 'prepare', selected.key, history);
    var assembly = readProductionRoomMonth_(ss, SHEET5.dailyAssembly, 'assembly', selected.key, history);
    // Summary blocks have no year column: never relabel another year's values.
    var efficiency = currentMonth && currentMonth.year === selected.year ? readEfficiency() : {prepare:[],assembly:[],overall:[]};
    var year = selected.year;
    [efficiency.prepare, efficiency.assembly, efficiency.overall].forEach(function(block){
      (block || []).forEach(function(row, i){ row.monthKey = year + '-' + ('0' + (i + 1)).slice(-2); });
    });
    // Return legacy fields unchanged, plus the production contract used by index.html.
    var result = {
      prepare: prepare, assembly: assembly,
      realtimePrepare: prepare, realtimeAssembly: assembly,
      productionDailyHistory: history,
      productionEfficiency: efficiency, efficiency: efficiency,
      attendance: readAttendance(), quality: readQuality(), skill: readSkill(),
      turnover: readTurnover(), otHistory: readOtHistory(), training: readTraining(),
      targets: readTargets(), fetchedAt: new Date().toISOString(),
      _meta: {selectedMonth:selected.key, warnings:[]}
    };
    if (!prepare.rows.length || !assembly.rows.length) result._meta.warnings.push({
      severity:'high', message:'Some rooms have no recorded daily data for ' + selected.key
    });
    return json({ ok:true, data:result });
  } catch(err) {
    return json({ok:false,error:{code:'READ_FAILED',status:500,message:'Cannot read dashboard spreadsheet; check configuration and permissions'}});
  }
}

// Read both Date cells and textual month headings. Never infer a year from today.
function parseDashboardMonth_(value) {
  var year, month, text;
  if (value instanceof Date && !isNaN(value.getTime())) {
    var formatted = Utilities.formatDate(value, 'Asia/Bangkok', 'yyyy-MM');
    year = Number(formatted.slice(0,4)); month = Number(formatted.slice(5,7));
  } else {
    text = String(value == null ? '' : value).replace(/^\s*▶\s*/, '').trim();
    var match = text.match(/^(\d{4})-(\d{1,2})$/);
    if (match) { year = Number(match[1]); month = Number(match[2]); }
    else if ((match = text.match(/^(\d{1,2})[-/](\d{4})$/))) { month = Number(match[1]); year = Number(match[2]); }
    else {
      for (var i = 0; i < TH_MONTHS.length; i++) {
        if (text.indexOf(TH_MONTHS[i] + ' ') === 0) {
          var tail = text.slice(TH_MONTHS[i].length).trim();
          if (/^\d{4}$/.test(tail)) { year = Number(tail); month = i + 1; }
          break;
        }
      }
    }
  }
  if (year >= 2400) year -= 543;
  if (!(year >= 1900 && year <= 2200 && month >= 1 && month <= 12)) return null;
  return {year:year, month:month, monthIdx:month-1, key:year+'-'+('0'+month).slice(-2)};
}

// Avoid the duplicated display rows (9–39): only scan archive blocks (42+).
function readProductionHistory_(ss) {
  var history = {};
  [['prepare',SHEET.histPrepare],['assembly',SHEET.histAssembly]].forEach(function(pair){
    var sheet = ss.getSheetByName(pair[1]);
    if (!sheet || sheet.getLastRow() < HIST_BLOCK_START) return;
    var values = sheet.getRange(HIST_BLOCK_START,1,sheet.getLastRow()-HIST_BLOCK_START+1,TOTAL_DAILY_COLS).getValues();
    for (var offset = 0; offset < values.length; offset += HIST_BLOCK_SIZE) {
      var parsed = parseDashboardMonth_(values[offset][0]);
      if (!parsed) continue;
      var rows = productionRows_(values.slice(offset+2,offset+33), parsed);
      if (!rows.length) continue;
      if (!history[parsed.key]) history[parsed.key] = {prepare:{rows:[]},assembly:{rows:[]}};
      history[parsed.key][pair[0]] = {rows:rows, monthKey:parsed.key, source:'history'};
    }
  });
  return history;
}

function productionRows_(values, month) {
  var rows = [], maxDay = new Date(month.year, month.month, 0).getDate();
  var fields = ['day','plan','actual','pctOutput','stdHrs','actualHrs','pctProductivity','ng','ppm','rework','pctRework','lossTime','plannedHC','actualHC','pctAttendance','ot','accidents'];
  values.forEach(function(r){
    var day = N(r[0]);
    if (!Number.isInteger(day) || day < 1 || day > maxDay) return;
    // Day placeholders and missing markers are not measured zeroes.
    if (!r.slice(1,17).some(function(v){return N(v) !== null;})) return;
    var row = {};
    fields.forEach(function(field, i){ row[field] = N(r[i]); });
    row.note = S(r[17]);
    row.pctProd = row.pctProductivity; row.pctAtt = row.pctAttendance;
    rows.push(row);
  });
  return rows;
}

function readProductionRoomMonth_(ss, dailyName, room, key, history) {
  var sheet = ss.getSheetByName(dailyName);
  var dailyMonth = sheet && parseDashboardMonth_(sheet.getRange(DAILY_MONTH_CELL).getValue());
  if (dailyMonth && dailyMonth.key === key) {
    return {rows:productionRows_(sheet.getRange(DAILY_START,1,DAILY_END-DAILY_START+1,TOTAL_DAILY_COLS).getValues(),dailyMonth),monthKey:key,source:'daily'};
  }
  return history[key] && history[key][room] || {rows:[],monthKey:key,source:'missing'};
}

function json(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function N(v){ if(typeof v==='string')v=v.trim(); if(v===''||v===null||v===undefined||v==='-')return null; if (typeof v === 'boolean' || v instanceof Date) return null; var n=Number(v); return isFinite(n)?n:null; }
function S(v){ if(v===''||v===null||v===undefined)return null; return String(v).trim()||null; }

// ── Daily Record (realtime) ──
function readDaily(name){
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
  if(!sh) return {rows:[]};
  var vals = sh.getRange(DAILY_START,1,DAILY_END-DAILY_START+1,18).getValues();
  var rows=[];
  vals.forEach(function(r){
    var d=r[COL.day];
    if(d===''||d===null||d==='-'||d===0)return;
    if(typeof d==='string')d=parseInt(d.replace(/[^0-9]/g,''));
    if(isNaN(d)||d<1||d>31)return;
    rows.push({day:d,plan:N(r[COL.plan]),actual:N(r[COL.actual]),
      stdHrs:N(r[COL.stdHrs]),actualHrs:N(r[COL.actualHrs]),pctProd:N(r[COL.pctProd]),
      ng:N(r[COL.ng]),ppm:N(r[COL.ppm]),rework:N(r[COL.rework]),pctRework:N(r[COL.pctRework]),
      lossTime:N(r[COL.lossTime]),plannedHC:N(r[COL.plannedHC]),actualHC:N(r[COL.actualHC]),
      pctAtt:N(r[COL.pctAtt]),ot:N(r[COL.ot]),accidents:N(r[COL.accidents]),note:S(r[COL.note])});
  });
  return {rows:rows};
}

// ── Efficiency: Assembly(10-21), Prepare(26-37), Overall(42-53) ──
function readEfficiency(){
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET5.efficiency);
  if(!sh) return {assembly:[],prepare:[],overall:[]};
  function block(start){
    var v=sh.getRange(start,2,12,6).getValues(); // B..G
    return v.map(function(r){return {month:S(r[0]),input:N(r[1]),output:N(r[2]),eff:N(r[3]),target:N(r[4]),status:S(r[5])};});
  }
  return { assembly:block(10), prepare:block(26), overall:block(42) };
}

// ── Attendance: Monthly Summary rows 8-19 ──
function readAttendance(){
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET5.attendance);
  if(!sh) return {months:[]};
  var v=sh.getRange(8,1,12,11).getValues(); // A..K
  var months=v.map(function(r){
    return {month:S(r[0]),workDays:N(r[1]),total:N(r[2]),present:N(r[3]),
      leave:N(r[4]),absent:N(r[5]),resignJBT:N(r[6]),resignNSR:N(r[7]),
      pct:N(r[8]),target:N(r[9])};
  });
  return {months:months};
}

// ── Quality: Monthly NG rows 11-22 + current summary ──
function readQuality(){
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET5.quality);
  if(!sh) return {months:[],current:{}};
  var cur=sh.getRange(6,2,1,10).getValues()[0];
  var current={produced:N(cur[0]),ngPcs:N(cur[2]),ngRate:N(cur[4]),materialLoss:N(cur[6]),lossTime:N(cur[8])};
  var v=sh.getRange(11,2,12,6).getValues();
  var months=v.map(function(r){return {month:S(r[0]),produced:N(r[1]),ng:N(r[2]),ngRate:N(r[3]),target:N(r[4]),status:S(r[5])};});
  return {months:months,current:current};
}

// ── Skill: Room summary rows 12-14 + index ──
function readSkill(){
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET5.skill);
  if(!sh) return {rooms:[],flexIndex:null};
  var flexIndex=N(sh.getRange(6,2).getValue());
  var v=sh.getRange(12,2,3,9).getValues(); // Assembly, Prepare, Total
  var rooms=v.map(function(r){
    return {room:S(r[0]),headcount:N(r[2]),stations:N(r[3]),essential:N(r[4]),
      ready:N(r[5]),backup:N(r[6]),risk:N(r[7]),flex:N(r[8])};
  });
  return {rooms:rooms,flexIndex:flexIndex};
}

// ── Turnover: rows 5-16 ──
function readTurnover(){
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET5.turnover);
  if(!sh) return {months:[]};
  var v=sh.getRange(5,2,12,8).getValues();
  var months=v.map(function(r){
    return {month:S(r[0]),headcount:N(r[1]),resignJBT:N(r[2]),resignNSR:N(r[3]),
      totalResign:N(r[4]),turnoverPct:N(r[5]),target:N(r[6]),status:S(r[7])};
  });
  return {months:months};
}

// ── OT History: rows 12-23 ──
function readOtHistory(){
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET5.otHistory);
  if(!sh) return {months:[]};
  var v=sh.getRange(12,1,12,6).getValues();
  var months=v.map(function(r){
    return {month:S(r[0]),prepare:N(r[2]),assembly:N(r[3]),total:N(r[4]),savedAt:r[5]||null};
  });
  return {months:months};
}

// ── Training Plan: rows 10-34 ──
function readTraining(){
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET5.training);
  if(!sh) return {courses:[],summary:{}};
  var sum=sh.getRange(6,1,1,5).getValues()[0];
  var summary={total:N(sum[0]),done:N(sum[1]),inProgress:N(sum[2]),notStarted:N(sum[3]),pct:N(sum[4])};
  var v=sh.getRange(10,1,25,21).getValues();
  var courses=[];
  v.forEach(function(r){
    if(!r[2])return;
    courses.push({no:N(r[0]),type:S(r[1]),titleTh:S(r[2]),titleEn:S(r[3]),
      category:S(r[4]),target:S(r[5]),owner:S(r[6]),status:S(r[19]),note:S(r[20])});
  });
  return {courses:courses,summary:summary};
}

// ── Targets ──
function readTargets(){
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET5.settings);
  var def={efficiency:95,attendance:95,ng:5,rework:3,losstime:0,ot:100};
  if(!sh) return def;
  var last=sh.getLastRow();
  var v=sh.getRange(4,1,last-3,2).getValues();
  var t={};
  v.forEach(function(r){if(r[0])t[String(r[0])]=N(r[1]);});
  Object.keys(def).forEach(function(k){if(t[k]===undefined||t[k]===null)t[k]=def[k];});
  return t;
}
