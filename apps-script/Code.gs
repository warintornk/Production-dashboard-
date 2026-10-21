/**
 * ==============================================================================
 * ProductionDashboard.gs
 * Production Control Tower v5 — Apps Script backend (single-file build)
 * ==============================================================================
 *
 * Merged from 19 modules. Behaviour is IDENTICAL to the modular version:
 * same CONFIG, same services, same 13 REST endpoints, same wire contract,
 * same menus. Verified by the same 148-test backend suite.
 *
 * ------------------------------------------------------------------------------
 * WHY THIS ORDER
 * ------------------------------------------------------------------------------
 * Apps Script hoists every top-level `function` declaration and `var` NAME
 * before executing anything, so functions may be declared in any order.
 * IIFEs, however, EXECUTE in source order — `var Util_ = (function()Ellipsis)()`
 * runs where it sits. No IIFE here calls another module at construction time
 * (every cross-module reference is inside a function body, deferred to call
 * time), so any order would in fact work. The order below is chosen for
 * READABILITY and to make the dependency direction obvious:
 *
 *     CONFIG -> Logger/Util_ -> Response/Validator -> Services -> Router -> API
 *
 * Two consequences worth knowing before editing:
 *   1. CONFIG must stay first. Everything reads it, and although reads happen
 *      inside functions (safe), keeping it first makes that contract visible.
 *   2. Log_ and Util_ are mutually referential (Util_ logs; Log_.flush() reads
 *      the spreadsheet through Util_). This is safe — flush() drains its buffer
 *      BEFORE calling Util_, and its catch uses raw console.log, never Log_ —
 *      so no recursion is possible. Do not "fix" it by reordering.
 *
 * ------------------------------------------------------------------------------
 * CONTENTS
 * ------------------------------------------------------------------------------
 *   1. CONFIGURATION ......... CONFIG (single source of truth)
 *   2. FOUNDATION ............ Log_, Util_, AppError_
 *   3. HTTP LAYER ............ Response_, Validator_
 *   4. DOMAIN SERVICES ....... Dashboard, Attendance, Efficiency, Quality,
 *                              Repair, Skill, Training, Turnover, History,
 *                              Settings, Summary
 *   5. ROUTING ............... Router_
 *   6. ENTRY POINTS .......... doGet, doPost, onOpen, onEdit, menus
 *   7. ADMIN / OPERATIONS .... Utility_* installers and diagnostics
 *
 * ------------------------------------------------------------------------------
 * FIRST-RUN SETUP
 * ------------------------------------------------------------------------------
 *   1. Utility_installConfig()    -> generates API_TOKEN (shown ONCE)
 *   2. Utility_installSchedule()  -> adds shift/break/OT rows to settings
 *   3. Utility_diagnostics()      -> expect 0 failures
 *   4. Deploy -> Web app -> Execute as Me -> Access: Anyone
 *
 * No secrets live in this file. SPREADSHEET_ID and API_TOKEN are read from
 * Script Properties.
 *
 * Build: 2026-07-18
 * ==============================================================================
 */


// ==============================================================================
//                                 CONFIGURATION
// ==============================================================================

// ------------------------------------------------------------------------------
// CONFIG  (was Config.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * Config.gs — Single source of truth
 * Production Dashboard v4 · Phase 1
 * ============================================================
 * RULES
 *  - No other module may contain a sheet name, a column letter,
 *    a row number, or a magic string. If you need one, add it here.
 *  - CONFIG is read INSIDE functions only, never at file top-level,
 *    so Apps Script's alphabetical file load order cannot bite us.
 *  - Secrets live in Script Properties, never in source.
 * ============================================================
 */

var CONFIG = (function () {

  // ---- Column contracts -------------------------------------
  // `header` = the text to look for in the sheet's header row.
  //            Matched loosely (whitespace/newlines/case normalized).
  // `fallback` = 0-based column index used ONLY if the header
  //            cannot be found. Keeps us alive on a renamed header
  //            while Logger warns loudly.
  var DAILY_COLUMNS = {
    day:             { key: 'day',             header: 'วันที่',          fallback: 0,  type: 'int'   },
    plan:            { key: 'plan',            header: 'แผนผลิต',         fallback: 1,  type: 'num'   },
    actual:          { key: 'actual',          header: 'ผลิตจริง',        fallback: 2,  type: 'num'   },
    pctOutput:       { key: 'pctOutput',       header: '% Output',        fallback: 3,  type: 'num'   },
    stdHrs:          { key: 'stdHrs',          header: 'เวลา มาตรฐาน',    fallback: 4,  type: 'num'   },
    actualHrs:       { key: 'actualHrs',       header: 'เวลา ทำงานจริง',  fallback: 5,  type: 'num'   },
    pctProductivity: { key: 'pctProductivity', header: '% Productivity',  fallback: 6,  type: 'num'   },
    ng:              { key: 'ng',              header: 'NG',              fallback: 7,  type: 'num'   },
    ppm:             { key: 'ppm',             header: 'Defect',          fallback: 8,  type: 'num'   },
    rework:          { key: 'rework',          header: 'Rework',          fallback: 9,  type: 'num'   },
    pctRework:       { key: 'pctRework',       header: '% Rework',        fallback: 10, type: 'num'   },
    lossTime:        { key: 'lossTime',        header: 'Loss Time',       fallback: 11, type: 'num'   },
    plannedHC:       { key: 'plannedHC',       header: 'คนตาม แผน',       fallback: 12, type: 'num'   },
    actualHC:        { key: 'actualHC',        header: 'มาจริง',          fallback: 13, type: 'num'   },
    pctAttendance:   { key: 'pctAttendance',   header: '% มา ทำงาน',      fallback: 14, type: 'num'   },
    ot:              { key: 'ot',              header: 'OT',              fallback: 15, type: 'num'   },
    accidents:       { key: 'accidents',       header: 'อุบัติเหตุ',      fallback: 16, type: 'num'   },
    note:            { key: 'note',            header: 'หมายเหตุ',        fallback: 17, type: 'text'  }
  };

  var ATTENDANCE_MONTHLY_COLUMNS = {
    month:     { key: 'month',     header: 'Month',        fallback: 0,  type: 'text' },
    workDays:  { key: 'workDays',  header: 'Work Days',    fallback: 1,  type: 'num'  },
    total:     { key: 'total',     header: 'Total',        fallback: 2,  type: 'num'  },
    present:   { key: 'present',   header: 'Present',      fallback: 3,  type: 'num'  },
    leave:     { key: 'leave',     header: 'Leave',        fallback: 4,  type: 'num'  },
    absent:    { key: 'absent',    header: 'Absent',       fallback: 5,  type: 'num'  },
    resignJBT: { key: 'resignJBT', header: 'Resign JBT',   fallback: 6,  type: 'num'  },
    resignNSR: { key: 'resignNSR', header: 'Resign NSR',   fallback: 7,  type: 'num'  },
    pct:       { key: 'pct',       header: 'Attendance %', fallback: 8,  type: 'num'  },
    target:    { key: 'target',    header: 'Target',       fallback: 9,  type: 'num'  },
    status:    { key: 'status',    header: 'Status',       fallback: 10, type: 'text' }
  };

  var ATTENDANCE_DAILY_COLUMNS = {
    date:      { key: 'date',      header: 'Date',        fallback: 1, type: 'raw'  },
    day:       { key: 'day',       header: 'Day',         fallback: 2, type: 'text' },
    total:     { key: 'total',     header: 'Total',       fallback: 3, type: 'num'  },
    present:   { key: 'present',   header: 'Present',     fallback: 4, type: 'num'  },
    leave:     { key: 'leave',     header: 'Leave',       fallback: 5, type: 'num'  },
    absent:    { key: 'absent',    header: 'Absent',      fallback: 6, type: 'num'  },
    resignJBT: { key: 'resignJBT', header: 'Resign JBT',  fallback: 7, type: 'num'  },
    resignNSR: { key: 'resignNSR', header: 'Resign NSR',  fallback: 8, type: 'num'  },
    pct:       { key: 'pct',       header: 'Daily Att %', fallback: 9, type: 'num'  }
  };

  var EFFICIENCY_COLUMNS = {
    month:  { key: 'month',  header: 'Month',         fallback: 1, type: 'text' },
    input:  { key: 'input',  header: 'Input (Hr)',    fallback: 2, type: 'num'  },
    output: { key: 'output', header: 'Output (Hr)',   fallback: 3, type: 'num'  },
    eff:    { key: 'eff',    header: 'Efficiency %',  fallback: 4, type: 'num'  },
    target: { key: 'target', header: 'Target',        fallback: 5, type: 'num'  },
    status: { key: 'status', header: 'Status',        fallback: 6, type: 'text' }
  };

  var QUALITY_COLUMNS = {
    month:    { key: 'month',    header: 'Month',      fallback: 1, type: 'text' },
    produced: { key: 'produced', header: 'Produced',   fallback: 2, type: 'num'  },
    ng:       { key: 'ng',       header: 'NG (pcs)',   fallback: 3, type: 'num'  },
    ngRate:   { key: 'ngRate',   header: 'NG Rate %',  fallback: 4, type: 'num'  },
    target:   { key: 'target',   header: 'Target',     fallback: 5, type: 'num'  },
    status:   { key: 'status',   header: 'Status',     fallback: 6, type: 'text' }
  };

  var TURNOVER_COLUMNS = {
    month:       { key: 'month',       header: 'Month',        fallback: 1, type: 'text' },
    headcount:   { key: 'headcount',   header: 'Headcount',    fallback: 2, type: 'num'  },
    resignJBT:   { key: 'resignJBT',   header: 'Resign JBT',   fallback: 3, type: 'num'  },
    resignNSR:   { key: 'resignNSR',   header: 'Resign NSR',   fallback: 4, type: 'num'  },
    totalResign: { key: 'totalResign', header: 'Total Resign', fallback: 5, type: 'num'  },
    turnoverPct: { key: 'turnoverPct', header: 'Turnover %',   fallback: 6, type: 'num'  },
    target:      { key: 'target',      header: 'Target',       fallback: 7, type: 'num'  },
    status:      { key: 'status',      header: 'Status',       fallback: 8, type: 'text' }
  };

  var OT_HISTORY_COLUMNS = {
    month:    { key: 'month',    header: 'เดือน',            fallback: 0, type: 'text' },
    year:     { key: 'year',     header: 'ปี',               fallback: 1, type: 'num'  },
    prepare:  { key: 'prepare',  header: 'Prepare OT',       fallback: 2, type: 'num'  },
    assembly: { key: 'assembly', header: 'Assembly OT',      fallback: 3, type: 'num'  },
    total:    { key: 'total',    header: 'รวม OT',           fallback: 4, type: 'num'  },
    savedAt:  { key: 'savedAt',  header: 'บันทึกเมื่อ',      fallback: 5, type: 'raw'  }
  };

  // SYNC/TRAINING: how to read the sheet's free-text status and category
  // columns. Kept here as data rather than buried in the service so the
  // operator can extend the vocabulary without touching logic. Matching is
  // case-insensitive substring, checked in order: done -> overdue -> active.
  var TRAINING_TOKENS = {
    done:      ['✅', 'เสร็จ', 'สำเร็จ', 'complete', 'done', 'finish', 'ผ่าน'],
    overdue:   ['❌', 'เกินกำหนด', 'ล่าช้า', 'overdue', 'late', 'ค้าง'],
    active:    ['🔄', 'กำลัง', 'ดำเนิน', 'progress', 'ongoing'],
    mandatory: ['บังคับ', 'ภาคบังคับ', 'mandatory', 'required', 'compulsory']
  };

  var TRAINING_COLUMNS = {    no:       { key: 'no',       header: 'ลำดับ',            fallback: 0,  type: 'num'  },
    type:     { key: 'type',     header: 'ประเภท',           fallback: 1,  type: 'text' },
    titleTh:  { key: 'titleTh',  header: 'หลักสูตร',         fallback: 2,  type: 'text' },
    titleEn:  { key: 'titleEn',  header: 'Course Name',      fallback: 3,  type: 'text' },
    category: { key: 'category', header: 'ประเภท อบรม',      fallback: 4,  type: 'text' },
    target:   { key: 'target',   header: 'กลุ่มเป้าหมาย',    fallback: 5,  type: 'text' },
    owner:    { key: 'owner',    header: 'ผู้รับผิดชอบ',     fallback: 6,  type: 'text' },
    status:   { key: 'status',   header: 'สถานะ',            fallback: 19, type: 'text' },
    note:     { key: 'note',     header: 'หมายเหตุ',         fallback: 20, type: 'text' }
  };

  // Fragments must be DISCRIMINATING, not just present. The first two
  // rows both begin "จำนวนเงินของวัตถุดิบ…" — matching on that prefix
  // binds both keys to row 5 and silently zeroes the rate. The tails
  // ("ที่เบิกซ่อม" vs "ทั้งหมด") are what actually distinguish them.
  var REPAIR_ROW_LABELS = {
    repairCost:    'ที่เบิกซ่อม',
    totalMaterial: 'ทั้งหมดทุก',
    ratePct:       'อัตราการเบิกซ่อม',
    target:        'kpi',
    status:        'สรุปผล'
  };

  return {

    // ---- Identity ------------------------------------------
    VERSION: '5.0.0-phase1',
    SCHEMA_YEAR: 2026,

    // ---- Secrets (Script Properties keys) -------------------
    // Set via Utility_installConfig() — never commit values.
    PROP_KEYS: {
      spreadsheetId: 'SPREADSHEET_ID',
      apiToken:      'API_TOKEN',
      logLevel:      'LOG_LEVEL',
      logSheetOn:    'LOG_TO_SHEET',
      // SYNC: monotonic counter bumped whenever the underlying data changes
      // (sheet edit or API write). The dashboard polls /version for this
      // instead of re-pulling the whole payload on a timer.
      dataRev:       'DATA_REV'
    },

    // ---- Security ------------------------------------------
    SECURITY: {
      // Gate READS behind ?token=… .
      //
      // Ships FALSE — deliberately. The deployed HTML sends no token,
      // so turning this on breaks every dashboard sync instantly.
      //
      // This MUST be an explicit switch, never a side effect of the
      // token existing: Phase 1 read as "permissive until a token is
      // installed", which meant running the installer silently 401'd
      // the whole dashboard. Installing a token enables WRITES; it
      // must not change read behaviour.
      //
      // Phase 2 cutover, in this order:
      //   1. update the HTML to append &token=…
      //   2. flip REQUIRE_READ_TOKEN=true (Script Property, no redeploy)
      requireToken:      false,
      tokenParam:        'token',
      // Writes ALWAYS require a token, regardless of the above.
      requireTokenWrite: true,
      maxBodyBytes:      65536,
      // Never leak stack traces to the client.
      exposeErrorDetail: false
    },

    // ---- Caching -------------------------------------------
    CACHE: {
      enabled:      true,
      ttlSeconds:   30,          // SYNC FIX: was 90. A sheet edit now shows up
                                 // within ~30s even without an explicit flush.
      keyPrefix:    'pd_v5_',
      nsKey:        'CACHE_NS',  // ScriptProperty holding the cache namespace
                                 // version. Bumping it orphans every key at
                                 // once — see Util_.Cache.invalidateAll().
      maxValueBytes: 95000       // CacheService hard cap is 100KB/key
    },

    // ---- REST API (Phase 2) --------------------------------
    // Apps Script web apps expose exactly ONE url (/exec). There is no
    // path segment to route on — `/exec/dashboard` 404s at Google's
    // edge before our code runs. So "REST paths" are carried in a query
    // param and dispatched by Router_:
    //     GET  ?path=/dashboard
    //     POST {"path": "/settings", ...}
    // `?action=` from Phase 1 still works and maps onto the same table.
    API: {
      pathParam:      'path',
      defaultPath:    '/dashboard',
      envelopeVersion: '2.0',

      // Per-path read TTL. 0 = never cache (writes, health).
      // Volatile sheets get short TTLs; reference data gets long ones.
      ttl: {
        '/dashboard':  30,
        '/summary':    30,
        '/attendance': 300,
        '/efficiency': 300,
        '/quality':    300,
        '/repair':     600,
        '/training':   600,
        '/skill':      600,
        '/history':    300,
        '/turnover':   300,
        '/settings':   120,
        '/health':     0,
        '/qualityHistory': 300,
        '/version':    0
      },

      // Paginated collection endpoints. Guards against a runaway
      // ?limit=100000 turning into an OOM.
      pagination: {
        defaultLimit: 100,
        maxLimit:     500
      },

      // Phase 1 action → Phase 2 path. Keeps the frozen HTML working.
      legacyActionMap: {
        'all':     '/dashboard',
        'health':  '/health',
        'targets': '/settings'
      },

      // Response envelope is uniform across every endpoint:
      //   { ok, apiVersion, path, timestamp, requestId, data, meta, error }
      includeMetaOnSuccess: true
    },

    // ---- Sheets --------------------------------------------
    // `name` is the literal tab name. Resolution is fuzzy
    // (see UtilityService.findSheet) so stray whitespace is safe.
    SHEETS: {
      dashboard:     { name: 'Dashboard' },
      dailyPrepare:  { name: 'Daily Record (Prepare)' },
      dailyAssembly: { name: 'Daily Record (Assembly)' },
      attendance:    { name: 'Attendance' },
      efficiency:    { name: 'Efficiency' },
      quality:       { name: 'Quality' },
      // MULTI-MONTH: append/upsert archive written by the dashboard's NG
      // import. Deliberately a SEPARATE sheet from 'Quality' — the operator's
      // Quality sheet keeps its existing hand-entry layout and formulas
      // untouched, while this one carries the month dimension the detail
      // blocks never had. Created by Utility_installQualityHistory().
      qualityHistory:{ name: 'Quality History' },
      // PHASE 2A: append/upsert archive for raw daily Production rows, written
      // by the dashboard's Daily Record import. Separate from 'Daily Record
      // (Prepare/Assembly)' — those sheets hold ONE month (cell J2) and stay
      // hand-entered; this one carries the month dimension the daily widgets
      // (Daily Summary, Hourly, Model) need. Created by
      // Utility_installProductionHistory().
      productionHistory:{ name: 'Production History' },
      repair:        { name: 'Repair Material' },
      skill:         { name: 'Skill Matrix' },
      turnover:      { name: 'Turnover' },
      otHistory:     { name: 'OT Monthly History' },
      training:      { name: 'Training Plan' },
      settings:      { name: 'Dashboard Settings' },
      histPrepare:   { name: 'History (Prepare)' },
      histAssembly:  { name: 'History (Assembly)' },
      log:           { name: '_Log' }
    },

    // ---- Rooms ---------------------------------------------
    // Adding a third room = add an entry here. Nothing else.
    // ANALYSIS §10: this was the "2 rooms hardcoded" ceiling.
    ROOMS: [
      {
        id:         'prepare',
        labelTh:    'เตรียมงาน',
        labelEn:    'Prepare',
        dailySheet: 'dailyPrepare',
        histSheet:  'histPrepare',
        // Skill Matrix is ONE sheet; rooms are row blocks within it.
        // ANALYSIS §3 A2: v4 looked for two sheets that never existed.
        // Verified: Prepare stations occupy rows 34..45, header at 33.
        skillRange: { headerRow: 33, startRow: 34, endRow: 46 },
        skillSummaryRow: 13,        // "Prepare Room" in ROOM SUMMARY
        otColumn:   3               // 1-based col in OT History (C)
      },
      {
        id:         'assembly',
        labelTh:    'ประกอบ',
        labelEn:    'Assembly',
        dailySheet: 'dailyAssembly',
        histSheet:  'histAssembly',
        // Verified: Assembly stations occupy rows 20..30, header at 19.
        skillRange: { headerRow: 19, startRow: 20, endRow: 30 },
        skillSummaryRow: 12,        // "Assembly Room"
        otColumn:   4               // D
      }
    ],

    // ---- Layouts -------------------------------------------
    LAYOUT: {
      daily: {
        headerRow:  6,      // where header text lives (for name matching)
        dataStart:  7,
        dataEnd:    37,
        monthCell:  'J2',
        columns:    DAILY_COLUMNS
      },

      attendance: {
        // Verified against the live workbook 2026-07.
        // Monthly: header row 5, Jan..Dec rows 6..17, YTD row 18.
        // Daily:   header row 22, entries from row 23 (Jan 1 = 23).
        // The two blocks sit at different offsets — do not assume a
        // uniform shift between them.
        monthlyHeaderRow: 5,
        monthlyStart:     6,
        monthlyEnd:       17,
        monthlyColumns:   ATTENDANCE_MONTHLY_COLUMNS,
        savedAtColumn:    13,     // 1-based (M) — past Status
        dailyHeaderRow:   22,
        dailyStart:       23,
        // 31 days + weekend rows; the log runs a full year per month
        // block. saveMonth aggregates only rows with data, so an
        // over-wide window is safe and a narrow one silently truncates.
        dailyEnd:         53,
        dailyColumns:     ATTENDANCE_DAILY_COLUMNS
      },

      efficiency: {
        headerRow: 9,
        columns:   EFFICIENCY_COLUMNS,
        blocks: {
          assembly: { startRow: 10, rows: 12 },
          prepare:  { startRow: 26, rows: 12 },
          overall:  { startRow: 42, rows: 12 }
        },
        // ANALYSIS §3 A6: block offsets were never verified against
        // the live sheet. Validator checks month labels land correctly.
        validateMonthLabels: true
      },

      quality: {
        headerRow:  10,
        monthStart: 11,
        monthEnd:   22,
        columns:    QUALITY_COLUMNS,
        current: {
          row: 6,
          cells: {   // 1-based columns on `row`
            produced:     2,
            ngPcs:        4,
            ngRate:       6,
            materialLoss: 8,
            lossTime:     10
          }
        },

        // ── Detail blocks (verified against the live workbook) ──
        // PHASE 3 FINDING: the Quality sheet carries rich NG analysis
        // from row 25 down, which NO reader has ever touched. Phase 1/2
        // only read rows 11-22, so the dashboard fell back to hardcoded
        // NG_PARETO / REWORK_MODELS demo values while REAL defect data
        // sat in the sheet. This is what makes the Quality page live.
        //
        // Layout is two side-by-side tables per band:
        //   left  block: label=c2, pcs=c4, pct=c5
        //   right block: label=c7, pcs=c9, pct=c10
        detail: {
          pairs: [
            { id: 'byProcess',  side: 'left',  headerRow: 28, startRow: 29, rows: 9 },
            { id: 'byDefect',   side: 'right', headerRow: 28, startRow: 29, rows: 9 },
            { id: 'by4M',       side: 'left',  headerRow: 40, startRow: 41, rows: 5 },
            { id: 'byRoom',     side: 'right', headerRow: 40, startRow: 41, rows: 6 },
            { id: 'byCustomer', side: 'left',  headerRow: 49, startRow: 50, rows: 6 }
          ],
          cols: {
            left:  { label: 2, pcs: 4, pct: 5 },
            right: { label: 7, pcs: 9, pct: 10 }
          },
          // TOP 3 PROBLEM PARTS — its own shape (rank, part, pcs, pct)
          topParts:  { startRow: 50, rows: 3, rank: 7, part: 8, pcs: 10, pct: 11 },
          // TOP 10 material loss
          topMaterial: {
            startRow: 59, rows: 11,
            no: 2, code: 3, desc: 4, qty: 7, unit: 8, costPerUnit: 9, loss: 10,
            totalRow: 70, totalCol: 10
          },
          // LOSS TIME by model
          lossTime: {
            startRow: 74, rows: 6,
            rank: 2, part: 3, minutes: 5, pct: 6, step: 7, ngPcs: 10
          }
        }
      },

      repair: {
        // Verified against the live workbook 2026-07.
        // Transposed: metrics down rows 5..9, months across E..P, total Q.
        // NOTE: column B carries formula-explainer text that begins with
        // the same Thai prefixes as the real labels in column D. Label
        // matching MUST stay pinned to labelColumn or it false-matches.
        labelColumn:    4,   // D — row label text
        monthStartCol:  5,   // E = ม.ค.
        monthCount:     12,
        totalCol:       17,  // Q — รวม
        searchRows:     { start: 4, end: 10 },
        rowLabels:      REPAIR_ROW_LABELS
      },

      // ── Skill Matrix ─────────────────────────────────────
      // SCHEMA CORRECTION (verified against the live workbook):
      // This sheet is STATION-PER-ROW aggregate coverage data. It has
      // NO employee roster and NO per-employee skill levels.
      //   col B = station name    col D = Essential (Y/N)
      //   col E = Target headcount
      //   col F = Can-do (≥2)     col G = Expert (≥3)
      //   col H = % Coverage      col I = Short   col J = Status
      //
      // The dashboard's heatmap wants {name, levels[]} per EMPLOYEE.
      // That data does not exist here. See SkillService for how the
      // wire contract is honored without fabricating it.
      skill: {
        // Each room's station block has its own header row.
        columns: {
          station:   { key: 'station',   header: 'Process',      fallback: 1, type: 'text' },
          essential: { key: 'essential', header: 'Essential',    fallback: 3, type: 'text' },
          target:    { key: 'target',    header: 'Target',       fallback: 4, type: 'num'  },
          canDo:     { key: 'canDo',     header: 'Can-do',       fallback: 5, type: 'num'  },
          expert:    { key: 'expert',    header: 'Expert',       fallback: 6, type: 'num'  },
          coverage:  { key: 'coverage',  header: '% Coverage',   fallback: 7, type: 'num'  },
          short:     { key: 'short',     header: 'Short',        fallback: 8, type: 'num'  },
          status:    { key: 'status',    header: 'Status',       fallback: 9, type: 'text' }
        },
        summary: {
          headerRow: 11,
          startRow:  12,
          rows:      3,      // Assembly Room, Prepare Room, TOTAL
          flexIndexCell: 'B6'
        }
      },

      turnover: {
        headerRow: 4,
        startRow:  5,
        endRow:    16,
        columns:   TURNOVER_COLUMNS
      },

      otHistory: {
        headerRow: 11,
        startRow:  12,
        endRow:    23,
        columns:   OT_HISTORY_COLUMNS,
        current: { prepareRow: 6, assemblyRow: 7, totalRow: 8 }
      },

      // ---- Quality History (dashboard-written archive) --------
      // Long format ON PURPOSE: one row per (month, section, item), so a
      // month's Pareto/4M/room/top-part lists can be any length and an
      // upsert is simply "delete this month's rows, append the new ones" —
      // which is what makes importing July leave June and August untouched.
      qualityHistory: {
        headerRow: 1,
        startRow:  2,
        columns: {
          month:   1,   // 'YYYY-MM' canonical key
          section: 2,   // summary | pareto | process | fourM | room | customer
                        // | topPart | material | lossTime
          rank:    3,
          label:   4,
          num1:    5,
          num2:    6,
          num3:    7,
          text1:   8,
          text2:   9,
          savedAt: 10
        },
        headers: ['Month', 'Section', 'Rank', 'Label',
                  'Num1', 'Num2', 'Num3', 'Text1', 'Text2', 'Saved At']
      },

      // ---- Production History (dashboard-written archive) -----
      // One row per (ReportMonth, Room, Day). Storing raw daily rows — not a
      // monthly summary — is what lets the Daily Summary / Hourly / Model
      // widgets show any archived month. Upsert key is (month, room): an
      // import replaces exactly that month+room's rows and leaves every other
      // month and the other room untouched.
      productionHistory: {
        headerRow: 1,
        startRow:  2,
        columns: {
          reportMonth:     1,   // 'YYYY-MM'
          room:            2,   // 'prepare' | 'assembly'
          day:             3,
          plan:            4,
          actual:          5,
          pctOutput:       6,
          stdHrs:          7,
          actualHrs:       8,
          pctProductivity: 9,
          ng:              10,
          ppm:             11,
          rework:          12,
          pctRework:       13,
          lossTime:        14,
          plannedHC:       15,
          actualHC:        16,
          pctAttendance:   17,
          ot:              18,
          accidents:       19,
          note:            20,
          savedAt:         21
        },
        headers: ['ReportMonth', 'Room', 'Day', 'Plan', 'Actual', '%Output',
                  'StdHrs', 'ActualHrs', '%Productivity', 'NG', 'Defect',
                  'Rework', '%Rework', 'LossTime', 'PlannedHC', 'ActualHC',
                  '%Attendance', 'OT', 'Accidents', 'Note', 'Saved At']
      },

      training: {
        headerRow: 9,        startRow:  10,
        endRow:    34,
        columns:   TRAINING_COLUMNS,
        tokens:    TRAINING_TOKENS,
        summary: {
          row:   6,
          cells: { total: 1, done: 2, inProgress: 3, notStarted: 4, pct: 5 }
        }
      },

      settings: {
        headerRow:   3,
        startRow:    4,
        keyColumn:   1,
        valueColumn: 2,
        unitColumn:  3
      },

      // ── Factory schedule (Dashboard Settings) ────────────────
      // PHASE 3 FINDING: the header/sidebar show Working Time, Break
      // Time, OT Schedule and Shift — all hardcoded in the HTML's
      // FACTORY constant. A scan of ALL 14 sheets found ZERO schedule
      // data anywhere in the workbook.
      //
      // "Read from Dashboard Settings whenever possible" is therefore
      // not yet possible — so Utility_installSchedule() writes these
      // rows into Dashboard Settings once, after which they are.
      // Until then the API reports scheduleConfigured:false and the
      // dashboard keeps its current values rather than showing blanks.
      //
      // Keys are read from the SAME key/value columns as the KPI
      // targets; they are simply string-valued instead of numeric.
      schedule: {
        keys: {
          workStart:  'work_start',
          workEnd:    'work_end',
          otStart:    'ot_start',
          otEnd:      'ot_end',
          shiftName:  'shift_name'
        },
        // Break rows are variable-length: break_1 = "10:00-10:15|พักเช้า|Morning Break"
        breakPrefix: 'break_',
        maxBreaks:   6,
        // Written by Utility_installSchedule() if absent.
        defaults: {
          work_start: '08:00',
          work_end:   '16:45',
          ot_start:   '17:15',
          ot_end:     '20:15',
          shift_name: 'Day Shift|กะเช้า',
          break_1:    '10:00-10:15|พักเช้า|Morning Break',
          break_2:    '12:00-12:45|พักเที่ยง|Lunch Break',
          break_3:    '15:00-15:15|พักบ่าย|Afternoon Break'
        }
      },

      history: {
        displayStart: 9,
        displayEnd:   39,
        blockSize:    35,
        blockStart:   42,
        monthSelector: 'B4',
        statusCell:    'E4'
      }
    },

    // ---- KPI semantics -------------------------------------
    KPI: {
      // ANALYSIS §7 V2 — THE UNIT COLLISION.
      // Dashboard!S2:S6 stores ratios (0.95). Dashboard Settings
      // stores whole numbers (95). The HTML's KPI_EXEC.target
      // expects whole numbers.
      //
      // Phase 1 keeps the wire format as-is (HTML is frozen) but
      // makes it EXPLICIT and validated instead of accidental.
      targetWireFormat: 'percent',      // what doGet emits: 95 not 0.95
      sheetRatioFormat: 'ratio',        // what Dashboard!S2:S6 holds

      // Canonical targets. Sourced from Dashboard Settings; these
      // are the fallback when a key is absent.
      defaults: {
        efficiency: 95,
        attendance: 95,
        ng:          5,
        rework:      3,
        losstime:    0,
        ot:        100
      },

      // Which direction is good. Drives status computation.
      higherIsBetter: {
        efficiency: true,
        attendance: true,
        ng:         false,
        rework:     false,
        losstime:   false,
        ot:         false,
        turnover:   false
      },

      // ANALYSIS §7 V1 — PRODUCTIVITY FORMULA IS UNRESOLVED.
      // Sheet computes stdHrs/actualHrs, yielding >100% routinely
      // (Jul = 128%). The Efficiency sheet's own header says
      // "Output Hr ÷ Input Hr". These disagree.
      //
      // Phase 1 does NOT silently pick a winner. It reads the sheet
      // value as-is and flags the conflict in `_meta.warnings`.
      // Set this once you've decided; the validator stops warning.
      //   'sheet'          — trust the sheet's own formula (current)
      //   'stdOverActual'  — recompute stdHrs / actualHrs
      //   'outputOverInput'— recompute from Efficiency sheet basis
      productivityBasis: 'sheet',
      productivitySaneMax: 1.15,   // warn above this ratio

      // ANALYSIS §7 V5 — attendance has two sources that disagree
      // (Attendance sheet 92.26% vs Daily Record 86.9%).
      // Declares which one is authoritative for the KPI card.
      attendanceAuthority: 'attendanceSheet',  // | 'dailyRecord'

      // ANALYSIS §7 V6 — turnover divides resigns by man-days,
      // which is a category error. Flagged, not auto-fixed.
      turnoverDenominator: 'sheet'   // | 'headcount'
    },

    // ---- Validation thresholds -----------------------------
    VALIDATION: {
      enabled: true,
      pctOutputSaneMax:    1.50,   // ANALYSIS V4: day 6 was 264%
      ngRateSaneMax:       0.30,
      // ANALYSIS V3: Prepare and Assembly are byte-identical.
      detectIdenticalRooms: true,
      identicalRoomSampleSize: 10
    },

    // ---- Locale --------------------------------------------
    MONTHS_TH: ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'],
    MONTHS_EN: ['Jan','Feb','Mar','Apr','May','Jun',
                'Jul','Aug','Sep','Oct','Nov','Dec'],
    TIMEZONE: 'Asia/Bangkok',

    // ---- Logging -------------------------------------------
    LOG: {
      level:        'INFO',      // DEBUG | INFO | WARN | ERROR | OFF
      toSheet:      false,       // overridden by Script Property
      sheetMaxRows: 5000,
      sheetTrimTo:  4000
    }
  };
})();

// ==============================================================================
//                                   FOUNDATION
// ==============================================================================

// ------------------------------------------------------------------------------
// LOGGER  (was Logger.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * Logger.gs — Leveled, buffered logging
 * ============================================================
 * Named Log_ to avoid colliding with Apps Script's built-in
 * `Logger` global. Sheet writes are buffered and flushed once
 * per execution — a per-call appendRow would reintroduce exactly
 * the N+1 write problem we're removing from AttendanceService.
 * ============================================================
 */

var Log_ = (function () {

  var LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40, OFF: 99 };

  var _buffer      = [];
  var _level       = null;
  var _toSheet     = null;
  var _correlation = null;

  function _resolveLevel() {
    if (_level !== null) return _level;
    var name = CONFIG.LOG.level;
    try {
      var override = PropertiesService.getScriptProperties()
        .getProperty(CONFIG.PROP_KEYS.logLevel);
      if (override) name = override;
    } catch (e) { /* properties unavailable — use CONFIG default */ }
    _level = LEVELS[String(name).toUpperCase()] || LEVELS.INFO;
    return _level;
  }

  function _resolveToSheet() {
    if (_toSheet !== null) return _toSheet;
    _toSheet = CONFIG.LOG.toSheet;
    try {
      var override = PropertiesService.getScriptProperties()
        .getProperty(CONFIG.PROP_KEYS.logSheetOn);
      if (override !== null && override !== undefined && override !== '') {
        _toSheet = String(override).toLowerCase() === 'true';
      }
    } catch (e) { /* ignore */ }
    return _toSheet;
  }

  /** Short id so all lines from one request can be grouped. */
  function correlationId() {
    if (!_correlation) {
      _correlation = Utilities.getUuid().slice(0, 8);
    }
    return _correlation;
  }

  function resetCorrelation() {
    _correlation = null;
  }

  function _fmt(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }

  function _emit(levelName, module, message, context) {
    if (LEVELS[levelName] < _resolveLevel()) return;

    var line = '[' + levelName + '] [' + correlationId() + '] [' + module + '] '
             + message
             + (context !== undefined ? ' :: ' + _fmt(context) : '');

    // Always to Stackdriver — free, no quota, survives crashes.
    console.log(line);

    if (_resolveToSheet()) {
      _buffer.push([
        new Date(),
        levelName,
        correlationId(),
        module,
        message,
        context !== undefined ? _fmt(context).slice(0, 4000) : ''
      ]);
    }
  }

  /**
   * Flush buffered lines to the log sheet. One batch write.
   * Never throws — a logging failure must not fail a request.
   */
  function flush() {
    if (!_buffer.length) return;
    var rows = _buffer;
    _buffer = [];
    try {
      var ss = Util_.getSpreadsheet();
      var sh = ss.getSheetByName(CONFIG.SHEETS.log.name);
      if (!sh) {
        sh = ss.insertSheet(CONFIG.SHEETS.log.name);
        sh.appendRow(['Timestamp', 'Level', 'Correlation', 'Module', 'Message', 'Context']);
        sh.setFrozenRows(1);
        sh.hideSheet();
      }
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows);

      var last = sh.getLastRow();
      if (last > CONFIG.LOG.sheetMaxRows) {
        var cut = last - CONFIG.LOG.sheetTrimTo;
        if (cut > 1) sh.deleteRows(2, cut);
      }
    } catch (e) {
      console.log('[ERROR] [Logger] flush failed: ' + e);
    }
  }

  return {
    debug: function (m, msg, ctx) { _emit('DEBUG', m, msg, ctx); },
    info:  function (m, msg, ctx) { _emit('INFO',  m, msg, ctx); },
    warn:  function (m, msg, ctx) { _emit('WARN',  m, msg, ctx); },
    error: function (m, msg, ctx) { _emit('ERROR', m, msg, ctx); },

    /** Time a function and log its duration. Returns fn's value. */
    time: function (module, label, fn) {
      var t0 = Date.now();
      try {
        return fn();
      } finally {
        _emit('DEBUG', module, label + ' took ' + (Date.now() - t0) + 'ms');
      }
    },

    flush: flush,
    correlationId: correlationId,
    resetCorrelation: resetCorrelation
  };
})();

// ------------------------------------------------------------------------------
// UTILITYSERVICE  (was UtilityService.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * UtilityService.gs — Foundation
 * ============================================================
 * Everything else depends on this. Contains:
 *   - Spreadsheet + sheet resolution (fuzzy, cached per-execution)
 *   - Header-name → column-index resolution  ← the core of
 *     "no hardcoded columns"
 *   - Batch reads (one getValues per range, never per-cell)
 *   - CacheService wrapper with chunking
 *   - Type coercion (N/S/D)
 *   - Month parsing
 * ============================================================
 */

var Util_ = (function () {

  var MODULE = 'Util';

  // Per-execution memo. Apps Script gives each execution a fresh
  // global scope, so these die naturally at request end.
  var _ss          = null;
  var _sheetCache  = {};
  var _headerCache = {};

  // ---- Spreadsheet ----------------------------------------

  /**
   * Resolve the spreadsheet. Prefers the bound file (menu context),
   * falls back to Script Property ID (web app context).
   *
   * ANALYSIS §9 S1: the ID used to be a source literal. It now lives
   * in Script Properties and is never logged.
   */
  function getSpreadsheet() {
    if (_ss) return _ss;

    var bound = null;
    try { bound = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { /* web app */ }
    if (bound) { _ss = bound; return _ss; }

    var id = PropertiesService.getScriptProperties()
      .getProperty(CONFIG.PROP_KEYS.spreadsheetId);
    if (!id) {
      throw new AppError_('CONFIG_MISSING',
        'SPREADSHEET_ID script property is not set. Run Utility_installConfig().');
    }
    _ss = SpreadsheetApp.openById(id);
    return _ss;
  }

  function normalizeName(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // ---- Sheet dimension memo -------------------------------
  // QA: a cold /dashboard sync made 44 getLastRow()/getLastColumn()
  // calls. Each is a round-trip to the Sheets backend, and the answer
  // cannot change mid-execution (nothing else is writing). Memoized per
  // execution and invalidated on any write via resetMemo().
  var _dims = {};

  function lastRow_(sheetKey, sh) {
    var k = sheetKey + '#r';
    if (_dims[k] === undefined) _dims[k] = (sh || getSheet(sheetKey)).getLastRow();
    return _dims[k];
  }

  function lastCol_(sheetKey, sh) {
    var k = sheetKey + '#c';
    if (_dims[k] === undefined) _dims[k] = (sh || getSheet(sheetKey)).getLastColumn();
    return _dims[k];
  }

  function forgetDims(sheetKey) {
    if (sheetKey) { delete _dims[sheetKey + '#r']; delete _dims[sheetKey + '#c']; }
    else _dims = {};
  }

  /**
   * Fuzzy sheet lookup by CONFIG key. Tolerates stray whitespace and
   * case drift in tab names — carried forward from v4's findSheet,
   * which was one of the few things that sheet worth keeping.
   *
   * @param {string} configKey key into CONFIG.SHEETS
   * @param {boolean} [required=true] throw if missing
   */
  function getSheet(configKey, required) {
    if (required === undefined) required = true;
    if (_sheetCache[configKey] !== undefined) {
      var hit = _sheetCache[configKey];
      if (!hit && required) {
        throw new AppError_('SHEET_NOT_FOUND', 'Sheet not found: ' + configKey);
      }
      return hit;
    }

    var def = CONFIG.SHEETS[configKey];
    if (!def) throw new AppError_('CONFIG_MISSING', 'Unknown sheet key: ' + configKey);

    var ss = getSpreadsheet();
    var sh = ss.getSheetByName(def.name);

    if (!sh) {
      var want = normalizeName(def.name);
      var all  = ss.getSheets();
      for (var i = 0; i < all.length; i++) {
        if (normalizeName(all[i].getName()) === want) { sh = all[i]; break; }
      }
    }

    _sheetCache[configKey] = sh || null;

    if (!sh) {
      Log_.warn(MODULE, 'Sheet not found', { key: configKey, expected: def.name });
      if (required) {
        throw new AppError_('SHEET_NOT_FOUND',
          'Sheet not found: "' + def.name + '" (key: ' + configKey + ')');
      }
    }
    return sh || null;
  }

  // ---- Header resolution ----------------------------------

  function _normHeader(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Build { columnKey → 0-based index } by matching CONFIG header
   * text against the sheet's actual header row.
   *
   * This is the mechanism that makes "use header names" real. If a
   * header is found, we bind to wherever it actually is. If it isn't,
   * we fall back to the configured index and log a WARN — degraded
   * but alive, and noisy about it.
   *
   * Matching is exact-normalized first, then substring, because the
   * sheet's headers wrap across lines ("แผนผลิต\n(ชิ้น)") and carry
   * unit suffixes the CONFIG text omits.
   *
   * @param {string} sheetKey
   * @param {number} headerRow 1-based
   * @param {Object} columnDefs map of key → {header, fallback}
   * @return {Object} key → 0-based column index
   */
  function resolveColumns(sheetKey, headerRow, columnDefs) {
    var cacheKey = sheetKey + '!' + headerRow;
    if (_headerCache[cacheKey]) return _headerCache[cacheKey];

    var sh = getSheet(sheetKey);
    var lastCol = lastCol_(sheetKey, sh);
    var map = {};

    if (lastCol < 1) {
      Log_.warn(MODULE, 'Empty sheet, using fallbacks', { sheet: sheetKey });
      Object.keys(columnDefs).forEach(function (k) { map[k] = columnDefs[k].fallback; });
      _headerCache[cacheKey] = map;
      return map;
    }

    // Read the header row AND the one above it. This workbook stacks
    // group headers ("ผลผลิต (Output)") above field headers, and some
    // fields only appear on one of the two rows.
    var top    = Math.max(1, headerRow - 1);
    var height = headerRow - top + 1;
    var rows   = sh.getRange(top, 1, height, lastCol).getValues();

    var flat = [];
    for (var c = 0; c < lastCol; c++) {
      var parts = [];
      for (var r = 0; r < rows.length; r++) {
        var v = _normHeader(rows[r][c]);
        if (v) parts.push(v);
      }
      flat[c] = parts.join(' ');
    }

    var used = {};
    var fellBack = [];
    Object.keys(columnDefs).forEach(function (key) {
      var def  = columnDefs[key];
      var want = _normHeader(def.header);
      var found = -1;

      // Pass 1 — exact match on the normalized cell text.
      for (var c = 0; c < flat.length; c++) {
        if (used[c]) continue;
        if (flat[c] === want) { found = c; break; }
      }
      // Pass 2 — substring. Headers carry units we don't encode.
      if (found === -1) {
        for (var c2 = 0; c2 < flat.length; c2++) {
          if (used[c2]) continue;
          if (flat[c2] && flat[c2].indexOf(want) !== -1) { found = c2; break; }
        }
      }

      if (found !== -1) {
        map[key]   = found;
        used[found] = true;
      } else {
        map[key] = def.fallback;
        used[def.fallback] = true;
        fellBack.push(key);
        Log_.warn(MODULE, 'Header not matched, using fallback index', {
          sheet: sheetKey, column: key, wanted: def.header, fallback: def.fallback
        });
      }
    });

    // ENTERPRISE REVIEW: previously the only way to tell a matched header
    // from a fallback was to compare map[key] === def.fallback — which is
    // WRONG whenever the header legitimately sits at its fallback index
    // (the common case). Diagnostics therefore reported healthy sheets as
    // "6 columns on fallback". Record the truth explicitly instead of
    // inferring it.
    //
    // This matters operationally: a renamed header silently keeps working
    // until someone also moves the column, at which point it breaks with
    // no warning trail. `_fellBack` makes the degradation visible while
    // it is still harmless.
    Object.defineProperty(map, '_fellBack', {
      value: fellBack, enumerable: false, writable: false
    });

    _headerCache[cacheKey] = map;
    Log_.debug(MODULE, 'Resolved columns', { sheet: sheetKey, map: map });
    return map;
  }

  /**
   * Read a rectangular block and project it into objects using a
   * resolved column map. ONE getValues call — this is the batch-read
   * primitive every service uses.
   *
   * ANALYSIS §8: saveAttendanceMonth made 186 single-cell getValue()
   * calls. Nothing in v5 reads a cell at a time.
   */
  function readBlock(sheetKey, startRow, numRows, columnDefs, colMap) {
    var sh = getSheet(sheetKey);
    var lastCol = lastCol_(sheetKey, sh);
    if (lastCol < 1 || numRows < 1) return [];

    var maxRow = sh.getMaxRows();
    if (startRow > maxRow) {
      Log_.warn(MODULE, 'startRow beyond sheet', { sheet: sheetKey, startRow: startRow });
      return [];
    }
    if (startRow + numRows - 1 > maxRow) numRows = maxRow - startRow + 1;

    var values = sh.getRange(startRow, 1, numRows, lastCol).getValues();

    return values.map(function (row, i) {
      var obj = { _row: startRow + i };
      Object.keys(colMap).forEach(function (key) {
        var idx = colMap[key];
        var raw = (idx >= 0 && idx < row.length) ? row[idx] : null;
        var def = columnDefs[key];
        switch (def && def.type) {
          case 'int':  obj[key] = toInt(raw);  break;
          case 'num':  obj[key] = toNum(raw);  break;
          case 'text': obj[key] = toStr(raw);  break;
          case 'raw':  obj[key] = raw;         break;
          default:     obj[key] = toNum(raw);  break;
        }
      });
      return obj;
    });
  }

  /** Convenience: resolve + read in one call. */
  function readTable(sheetKey, headerRow, startRow, numRows, columnDefs) {
    var map = resolveColumns(sheetKey, headerRow, columnDefs);
    return readBlock(sheetKey, startRow, numRows, columnDefs, map);
  }

  /**
   * Read one row and project fixed 1-based columns into an object.
   * ONE getValues call.
   *
   * QA: QualityService and TrainingService each carried a near-identical
   * copy of this (compute maxCol, clamp to lastCol, read strip, map keys,
   * swallow errors). Same bug surface in two places; now one.
   *
   * @param {string} sheetKey
   * @param {number} row 1-based
   * @param {Object} cells  { key: 1-basedColumn }
   * @param {string} [type] 'num' (default) | 'text' | 'raw'
   * @return {Object} key -> value (null where out of range)
   */
  function readCellStrip(sheetKey, row, cells, type) {
    var out = {};
    var sh = getSheet(sheetKey, false);
    if (!sh) return out;

    try {
      var keys = Object.keys(cells);
      if (!keys.length) return out;

      var maxCol = Math.max.apply(null, keys.map(function (k) { return cells[k]; }));
      var width  = Math.min(maxCol, lastCol_(sheetKey, sh));
      if (width < 1 || row > lastRow_(sheetKey, sh)) return out;

      var strip = sh.getRange(row, 1, 1, width).getValues()[0];
      keys.forEach(function (key) {
        var idx = cells[key] - 1;
        var raw = (idx >= 0 && idx < strip.length) ? strip[idx] : null;
        if (raw === null) { out[key] = null; return; }
        out[key] = (type === 'text') ? toStr(raw)
                 : (type === 'raw')  ? raw
                 : toNum(raw);
      });
    } catch (e) {
      Log_.warn(MODULE, 'readCellStrip failed', { sheet: sheetKey, row: row, err: String(e) });
    }
    return out;
  }

  // ---- Coercion -------------------------------------------

  function toNum(v) {
    if (v === '' || v === null || v === undefined || v === '-') return null;
    if (v instanceof Date) return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function toInt(v) {
    if (typeof v === 'string') {
      var digits = v.replace(/[^0-9\-]/g, '');
      if (!digits) return null;
      var p = parseInt(digits, 10);
      return isNaN(p) ? null : p;
    }
    var n = toNum(v);
    return n === null ? null : Math.round(n);
  }

  function toStr(v) {
    if (v === '' || v === null || v === undefined) return null;
    var s = String(v).trim();
    return s || null;
  }

  function toIso(v) {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString();
    return String(v);
  }

  function round(n, dp) {
    if (n === null || n === undefined || isNaN(n)) return null;
    var f = Math.pow(10, dp || 0);
    return Math.round(n * f) / f;
  }

  /** Safe divide. Returns null rather than Infinity/NaN. */
  function div(a, b) {
    if (a === null || b === null || !b) return null;
    var r = a / b;
    return isFinite(r) ? r : null;
  }

  // ---- Month parsing --------------------------------------

  /**
   * Parse a month token into {monthIdx (0-based), year}.
   * Accepts: Date, "06-2026", "06/2026", "มิ.ย. 2026", "Jun 2026".
   *
   * ANALYSIS §3 A8: archiveCurrentMonthOT and saveAttendanceMonth
   * each did their own String(x).split('-'), which produced NaN on a
   * Date-typed J2. One parser now, used by all three write paths.
   */
  function parseMonth(value) {
    if (value === null || value === undefined || value === '') return null;

    if (Object.prototype.toString.call(value) === '[object Date]') {
      if (isNaN(value.getTime())) return null;
      var stamp = Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM');
      return { monthIdx: Number(stamp.slice(5,7)) - 1, year: Number(stamp.slice(0,4)) };
    }

    var s = String(value).replace(/^\s*▶\s*/, '').trim();

    var canonical = s.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (canonical) return { monthIdx: Number(canonical[2])-1, year: Number(canonical[1]) };
    var numeric = s.match(/^(\d{1,2})[-\/](\d{4})$/);
    if (numeric) {
      var mi = parseInt(numeric[1], 10) - 1;
      if (mi >= 0 && mi <= 11) return { monthIdx: mi, year: parseInt(numeric[2], 10) };
      return null;
    }

    var parts = s.split(/\s+/);
    var th = CONFIG.MONTHS_TH.indexOf(parts[0]);
    if (th !== -1) {
      return { monthIdx: th, year: parseInt(parts[1], 10) || CONFIG.SCHEMA_YEAR };
    }
    var en = CONFIG.MONTHS_EN.indexOf(parts[0]);
    if (en !== -1) {
      return { monthIdx: en, year: parseInt(parts[1], 10) || CONFIG.SCHEMA_YEAR };
    }
    return null;
  }

  function monthLabelTh(monthIdx, year) {
    return CONFIG.MONTHS_TH[monthIdx] + ' ' + year;
  }

  /**
   * MULTI-MONTH — canonical month key.
   *
   * Sheet month cells are free text: '06-2026', 'Jun 2026', 'มิ.ย. 2026', or a
   * real Date. The dashboard's client-side stores use 'YYYY-MM'. Without one
   * canonical form there is no reliable way to join a selected month against
   * rows coming from six different sheets, so every monthly row now carries a
   * `monthKey` alongside its original display text.
   *
   * Returns 'YYYY-MM', or null when the value is not a recognisable month
   * (blank spacer rows, totals, headers) — callers keep such rows out of the
   * month index rather than guessing.
   */
  function monthKey(value) {
    var m = parseMonth(value);
    if (!m) return null;
    var mm = String(m.monthIdx + 1);
    if (mm.length < 2) mm = '0' + mm;
    return m.year + '-' + mm;
  }

  function getRoom(roomId) {
    for (var i = 0; i < CONFIG.ROOMS.length; i++) {
      if (CONFIG.ROOMS[i].id === roomId) return CONFIG.ROOMS[i];
    }
    throw new AppError_('CONFIG_MISSING', 'Unknown room: ' + roomId);
  }

  // ---- Cache ----------------------------------------------

  /**
   * CacheService wrapper. Chunks values over the 100KB per-key cap.
   * Never throws — a cache miss must degrade to a live read.
   */
  var Cache = {
    // SYNC FIX: keys are namespaced with a version read from ScriptProperties.
    // invalidateAll() bumps that version, which orphans every existing key in
    // one O(1) operation — what the old implementation documented but did not
    // do (it removed keys named 'c_0'..'c_39', which this wrapper never
    // creates: chunk keys are '<name>_c<i>'). The version is memoised per
    // execution so a cache hit costs at most one PropertiesService read.
    _ns: null,

    _nsGet: function () {
      if (this._ns !== null) return this._ns;
      try {
        var v = PropertiesService.getScriptProperties()
          .getProperty(CONFIG.CACHE.nsKey);
        this._ns = v || '1';
      } catch (e) { this._ns = '1'; }
      return this._ns;
    },

    _key: function (name) {
      return CONFIG.CACHE.keyPrefix + this._nsGet() + '_' + name;
    },

    get: function (name) {
      if (!CONFIG.CACHE.enabled) return null;
      try {
        var c = CacheService.getScriptCache();
        var head = c.get(this._key(name));
        if (!head) return null;

        if (head.charAt(0) === '{' || head.charAt(0) === '[') {
          return JSON.parse(head);
        }
        // Chunked: head is "chunks:<n>"
        var m = head.match(/^chunks:(\d+)$/);
        if (!m) return null;

        var n = parseInt(m[1], 10);
        var keys = [];
        for (var i = 0; i < n; i++) keys.push(this._key(name + '_c' + i));
        var parts = c.getAll(keys);

        var joined = '';
        for (var j = 0; j < n; j++) {
          var p = parts[this._key(name + '_c' + j)];
          if (p === undefined || p === null) {
            Log_.debug(MODULE, 'Cache chunk missing, treating as miss', { name: name, chunk: j });
            return null;
          }
          joined += p;
        }
        return JSON.parse(joined);
      } catch (e) {
        Log_.warn(MODULE, 'Cache get failed', { name: name, err: String(e) });
        return null;
      }
    },

    put: function (name, value, ttl) {
      if (!CONFIG.CACHE.enabled) return;
      try {
        var c   = CacheService.getScriptCache();
        var str = JSON.stringify(value);
        var t   = ttl || CONFIG.CACHE.ttlSeconds;
        var max = CONFIG.CACHE.maxValueBytes;

        if (str.length <= max) {
          c.put(this._key(name), str, t);
          return;
        }
        var n = Math.ceil(str.length / max);
        var batch = {};
        for (var i = 0; i < n; i++) {
          batch[this._key(name + '_c' + i)] = str.substr(i * max, max);
        }
        batch[this._key(name)] = 'chunks:' + n;
        c.putAll(batch, t);
        Log_.debug(MODULE, 'Cache put (chunked)', { name: name, chunks: n });
      } catch (e) {
        Log_.warn(MODULE, 'Cache put failed', { name: name, err: String(e) });
      }
    },

    remove: function (name) {
      try {
        CacheService.getScriptCache().remove(this._key(name));
      } catch (e) { /* ignore */ }
    },

    /** Bump the namespace so every existing key is orphaned at once. */
    invalidateAll: function () {
      try {
        var next = String((parseInt(this._nsGet(), 10) || 1) + 1);
        PropertiesService.getScriptProperties()
          .setProperty(CONFIG.CACHE.nsKey, next);
        this._ns = next;
        Log_.info(MODULE, 'Cache namespace bumped', { ns: next });
      } catch (e) {
        Log_.warn(MODULE, 'Cache invalidateAll failed', { err: String(e) });
      }
    },

    /** Read-through helper. */
    wrap: function (name, ttl, producer) {
      var hit = this.get(name);
      if (hit !== null) {
        Log_.debug(MODULE, 'Cache hit', { name: name });
        return hit;
      }
      var val = producer();
      this.put(name, val, ttl);
      return val;
    }
  };

  /**
   * SYNC — data revision counter.
   *
   * The dashboard used to re-pull the entire payload on a fixed timer, which
   * made freshness a function of the timer rather than of actual change. This
   * gives the client something cheap to poll: one ScriptProperty read, no
   * sheet access. `bump()` is called wherever data changes (onEdit, API
   * writes), so a changed value here means "the payload is worth re-fetching".
   *
   * Deliberately NOT derived from the Drive file's modified time: that would
   * pull in the Drive OAuth scope and force every existing deployment through
   * re-authorisation. The periodic full refresh remains as the safety net for
   * changes this counter cannot observe (formula recalculation, IMPORTRANGE,
   * edits made by other scripts).
   */
  var Rev = {
    _v: null,

    get: function () {
      if (this._v !== null) return this._v;
      try {
        var v = PropertiesService.getScriptProperties()
          .getProperty(CONFIG.PROP_KEYS.dataRev);
        this._v = v || '0';
      } catch (e) { this._v = '0'; }
      return this._v;
    },

    bump: function () {
      try {
        var next = String((parseInt(this.get(), 10) || 0) + 1);
        PropertiesService.getScriptProperties()
          .setProperty(CONFIG.PROP_KEYS.dataRev, next);
        this._v = next;
        return next;
      } catch (e) {
        Log_.warn(MODULE, 'Rev bump failed', { err: String(e) });
        return this.get();
      }
    }
  };

  /**
   * Run `fn` under the script write lock.
   *
   * ENTERPRISE REVIEW FINDING: SettingsService.saveTargets and
   * Utility_installSchedule locked; AttendanceService.saveMonth,
   * HistoryService.saveMonth and archiveOT did NOT — yet all three are
   * reachable from doPost. Every one is a read-modify-write over a
   * shared row, so two concurrent requests could interleave and silently
   * write a half-merged row. Locking was inconsistent by accident, not
   * by design.
   *
   * Apps Script locks are re-entrant per execution, so nesting is safe.
   *
   * @param {string} label for the timeout message
   * @param {Function} fn
   * @param {number} [waitMs=10000]
   */
  function withWriteLock(label, fn, waitMs) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(waitMs || 10000)) {
      throw new AppError_('LOCK_TIMEOUT',
        'Could not acquire write lock for ' + label + ' within ' + (waitMs || 10000) + 'ms');
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }

  /** Drop the per-execution memos (spreadsheet handle, sheet lookups,
   * resolved header maps).
   *
   * Normally unnecessary — each Apps Script execution gets a fresh
   * global scope. It matters when an operator edits CONFIG and re-runs
   * in the SAME editor session: without this, getSheet keeps returning
   * the handle resolved under the old CONFIG and the change appears to
   * do nothing. Utility_clearCache calls it.
   */
  function resetMemo() {
    _ss          = null;
    _sheetCache  = {};
    _headerCache = {};
    _dims        = {};
  }

  return {
    getSpreadsheet:  getSpreadsheet,
    getSheet:        getSheet,
    resetMemo:       resetMemo,
    normalizeName:   normalizeName,
    resolveColumns:  resolveColumns,
    readBlock:       readBlock,
    readTable:       readTable,
    readCellStrip:   readCellStrip,
    lastRow:         lastRow_,
    lastCol:         lastCol_,
    forgetDims:      forgetDims,
    withWriteLock:   withWriteLock,
    toNum:           toNum,
    toInt:           toInt,
    toStr:           toStr,
    toIso:           toIso,
    round:           round,
    div:             div,
    parseMonth:      parseMonth,
    monthLabelTh:    monthLabelTh,
    monthKey:        monthKey,
    getRoom:         getRoom,
    Cache:           Cache,
    Rev:             Rev
  };
})();


/**
 * ============================================================
 * AppError_ — typed error
 * ============================================================
 * `code` is safe to return to a client. `message` is not, and is
 * withheld unless CONFIG.SECURITY.exposeErrorDetail is on.
 * ANALYSIS §9 S7: v4 returned String(err) to any caller.
 */
function AppError_(code, message, context) {
  this.name    = 'AppError';
  this.code    = code;
  this.message = message || code;
  this.context = context || null;
  this.stack   = (new Error()).stack;
}
AppError_.prototype = Object.create(Error.prototype);
AppError_.prototype.constructor = AppError_;

// ==============================================================================
//                                   HTTP LAYER
// ==============================================================================

// ------------------------------------------------------------------------------
// RESPONSE  (was Response.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * Response.gs — Uniform response envelope
 * ============================================================
 * Every endpoint returns the SAME shape, success or failure. A
 * client should never have to guess which parser to use.
 *
 *   {
 *     ok:         true | false,
 *     apiVersion: "2.0",
 *     path:       "/attendance",
 *     timestamp:  "2026-07-17T…Z",
 *     requestId:  "a1b2c3d4",
 *     data:       { … }        // present iff ok
 *     meta:       { … }        // pagination, cache, warnings
 *     error:      { code, message, status, details }   // iff !ok
 *   }
 *
 * NOTE ON STATUS CODES: Apps Script's ContentService cannot set an
 * HTTP status — every response leaves as 200. The `error.status`
 * field carries the intended code so clients can branch on it, and
 * so a future migration off Apps Script keeps the same contract.
 * Clients MUST branch on `ok`, not on the transport status.
 * ============================================================
 */

var Response_ = (function () {

  /**
   * Error code → intended HTTP status + client-safe message.
   *
   * ANALYSIS §9 S7: v4 returned String(err) to any caller, leaking
   * stack traces and sheet internals. The `message` here is the ONLY
   * text a client sees; real detail goes to the log against requestId.
   */
  var ERRORS = {
    // 400
    BAD_INPUT:        { status: 400, message: 'Request is malformed or missing a required field.' },
    BAD_JSON:         { status: 400, message: 'Request body is not valid JSON.' },
    BAD_MONTH:        { status: 400, message: 'Month value is missing or not a recognized format.' },
    BAD_PARAM:        { status: 400, message: 'A query parameter is invalid.' },
    VALIDATION_FAILED:{ status: 400, message: 'Request failed validation.' },
    // 401 / 403
    UNAUTHORIZED:     { status: 401, message: 'Invalid or missing token.' },
    NOT_CONFIGURED:   { status: 403, message: 'Server is not configured for this operation.' },
    // 404
    UNKNOWN_PATH:     { status: 404, message: 'No such endpoint.' },
    UNKNOWN_ACTION:   { status: 404, message: 'No such action.' },
    SHEET_NOT_FOUND:  { status: 404, message: 'A required data sheet is missing.' },
    // 405
    METHOD_NOT_ALLOWED:{ status: 405, message: 'This endpoint does not accept that method.' },
    // 409
    YEAR_CONFLICT:    { status: 409, message: 'Target block belongs to a different year.' },
    LOCK_TIMEOUT:     { status: 409, message: 'Another write is in progress. Retry shortly.' },
    // 413
    BODY_TOO_LARGE:   { status: 413, message: 'Request body exceeds the size limit.' },
    // 422
    SHEET_EMPTY:      { status: 422, message: 'The target sheet has no rows to operate on.' },
    SCHEMA_GAP:       { status: 422, message: 'The workbook does not carry the data this endpoint needs.' },
    // 500
    CONFIG_MISSING:   { status: 500, message: 'Server configuration is incomplete.' },
    INTERNAL_ERROR:   { status: 500, message: 'Unexpected server error.' }
  };

  function _lookup(code) {
    return ERRORS[code] || ERRORS.INTERNAL_ERROR;
  }

  function _base(path) {
    return {
      apiVersion: CONFIG.API.envelopeVersion,
      path:       path || null,
      timestamp:  new Date().toISOString(),
      requestId:  Log_.correlationId()
    };
  }

  /**
   * Success envelope.
   * @param {*} data payload
   * @param {string} path
   * @param {Object} [meta] pagination / cache / warnings
   */
  function ok(data, path, meta) {
    var body = _base(path);
    body.ok   = true;
    body.data = data;
    if (meta && CONFIG.API.includeMetaOnSuccess) body.meta = meta;
    return _emit(body);
  }

  /**
   * Error envelope. Logs the real cause; returns only the safe shell.
   * `details` is included ONLY for 4xx validation errors, where the
   * client genuinely needs to know which field was wrong. Never for
   * 5xx — that's where internals leak.
   */
  function fail(err, path) {
    var code = (err && err.code) || 'INTERNAL_ERROR';
    var def  = _lookup(code);

    Log_.error('API', 'Request failed', {
      path:    path,
      code:    code,
      status:  def.status,
      message: err && err.message,
      stack:   err && err.stack
    });

    var body = _base(path);
    body.ok    = false;
    body.error = {
      code:    code,
      status:  def.status,
      message: def.message
    };

    // Field-level detail for client-fixable errors only.
    if (def.status >= 400 && def.status < 500 && err && err.context) {
      body.error.details = err.context;
    }
    if (CONFIG.SECURITY.exposeErrorDetail && err && err.message) {
      body.error.debug = err.message;
    }
    return _emit(body);
  }

  function _emit(body) {
    return ContentService
      .createTextOutput(JSON.stringify(body))
      .setMimeType(ContentService.MimeType.JSON);
  }

  /** Build a pagination meta block from a full collection. */
  function paginate(items, params) {
    var P = CONFIG.API.pagination;

    var limit = Util_.toInt(params.limit);
    if (limit === null) limit = P.defaultLimit;
    if (limit < 1) limit = 1;
    if (limit > P.maxLimit) limit = P.maxLimit;

    var offset = Util_.toInt(params.offset);
    if (offset === null || offset < 0) offset = 0;

    var total = items.length;
    var page  = items.slice(offset, offset + limit);

    return {
      items: page,
      meta: {
        total:   total,
        limit:   limit,
        offset:  offset,
        count:   page.length,
        hasMore: offset + page.length < total
      }
    };
  }

  return {
    ok:        ok,
    fail:      fail,
    paginate:  paginate,
    // statusFor is the supported way to ask about a code. The raw ERRORS
    // table used to be exported too — zero callers, and exposing it invites
    // code that mutates the taxonomy from outside. Removed (AUDIT).
    statusFor: function (code) { return _lookup(code).status; }
  };
})();

// ------------------------------------------------------------------------------
// VALIDATOR  (was Validator.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * Validator.gs — Request validation
 * ============================================================
 * Declarative param specs. Every endpoint validates through the
 * same code path, so error shapes are identical everywhere and a
 * new endpoint can't accidentally skip a check.
 *
 * Unknown params are REJECTED, not ignored. A typo'd ?limt=10
 * silently falling back to a default is how someone spends an hour
 * wondering why pagination "doesn't work".
 * ============================================================
 */

var Validator_ = (function () {

  var MODULE = 'Validator';

  /**
   * @param {Object} params raw request params
   * @param {Object} spec   { name: {type, required, min, max, values, default} }
   * @param {Array<string>} [allowExtra] param names to tolerate
   * @return {Object} coerced values
   * @throws {AppError_} BAD_PARAM with a field-level `context`
   */
  function check(params, spec, allowExtra) {
    params = params || {};
    spec   = spec   || {};

    var out    = {};
    var errors = [];

    // --- Unknown params ---
    var known = Object.keys(spec);
    var tolerated = (allowExtra || []).concat([
      CONFIG.API.pathParam,
      CONFIG.SECURITY.tokenParam,
      'action',      // Phase 1 compat
      'nocache'
    ]);

    Object.keys(params).forEach(function (k) {
      if (known.indexOf(k) === -1 && tolerated.indexOf(k) === -1) {
        errors.push({ field: k, issue: 'unknown parameter' });
      }
    });

    // --- Declared params ---
    known.forEach(function (name) {
      var rule = spec[name];
      var raw  = params[name];
      var absent = (raw === undefined || raw === null || raw === '');

      if (absent) {
        if (rule.required) {
          errors.push({ field: name, issue: 'required' });
        } else if (rule.default !== undefined) {
          out[name] = rule.default;
        }
        return;
      }

      var val;
      switch (rule.type) {
        case 'int':
          val = Util_.toInt(raw);
          if (val === null) {
            errors.push({ field: name, issue: 'must be an integer', got: String(raw) });
            return;
          }
          break;

        case 'number':
          val = Util_.toNum(raw);
          if (val === null) {
            errors.push({ field: name, issue: 'must be a number', got: String(raw) });
            return;
          }
          break;

        case 'bool':
          var s = String(raw).toLowerCase();
          if (['true', '1', 'yes'].indexOf(s) !== -1)      val = true;
          else if (['false', '0', 'no'].indexOf(s) !== -1) val = false;
          else {
            errors.push({ field: name, issue: 'must be a boolean', got: String(raw) });
            return;
          }
          break;

        case 'month':
          val = Util_.parseMonth(raw);
          if (!val) {
            errors.push({
              field: name,
              issue: 'unrecognized month; use 06-2026, Jun 2026, or มิ.ย. 2026',
              got:   String(raw)
            });
            return;
          }
          break;

        case 'enum':
          val = String(raw);
          if (rule.values.indexOf(val) === -1) {
            errors.push({
              field: name,
              issue: 'must be one of: ' + rule.values.join(', '),
              got:   val
            });
            return;
          }
          break;

        case 'room':
          val = String(raw);
          var ids = CONFIG.ROOMS.map(function (r) { return r.id; });
          if (ids.indexOf(val) === -1) {
            errors.push({
              field: name,
              issue: 'unknown room; must be one of: ' + ids.join(', '),
              got:   val
            });
            return;
          }
          break;

        case 'string':
        default:
          val = String(raw);
          if (rule.maxLength && val.length > rule.maxLength) {
            errors.push({ field: name, issue: 'exceeds ' + rule.maxLength + ' chars' });
            return;
          }
          break;
      }

      // Range checks for numerics.
      if ((rule.type === 'int' || rule.type === 'number')) {
        if (rule.min !== undefined && val < rule.min) {
          errors.push({ field: name, issue: 'must be >= ' + rule.min, got: val });
          return;
        }
        if (rule.max !== undefined && val > rule.max) {
          errors.push({ field: name, issue: 'must be <= ' + rule.max, got: val });
          return;
        }
      }

      out[name] = val;
    });

    if (errors.length) {
      Log_.warn(MODULE, 'Validation failed', { errors: errors });
      throw new AppError_('BAD_PARAM',
        'Parameter validation failed: ' +
        errors.map(function (e) { return e.field + ' (' + e.issue + ')'; }).join('; '),
        { errors: errors });
    }

    return out;
  }

  /**
   * Validate a targets payload for POST /settings.
   * Separate from `check` because it's a dynamic key set validated
   * against CONFIG.KPI.defaults rather than a fixed spec.
   */
  function targets(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new AppError_('BAD_INPUT', 'targets must be an object',
        { errors: [{ field: 'targets', issue: 'must be an object' }] });
    }

    var clean  = {};
    var errors = [];

    Object.keys(raw).forEach(function (k) {
      var key = String(k).toLowerCase();

      if (!Object.prototype.hasOwnProperty.call(CONFIG.KPI.defaults, key)) {
        errors.push({
          field: k,
          issue: 'unknown KPI; must be one of: ' +
                 Object.keys(CONFIG.KPI.defaults).join(', ')
        });
        return;
      }

      var v = Util_.toNum(raw[k]);
      if (v === null) {
        errors.push({ field: k, issue: 'must be a number', got: String(raw[k]) });
        return;
      }
      if (v < 0) {
        errors.push({ field: k, issue: 'must be >= 0', got: v });
        return;
      }
      if (v > 1e6) {
        errors.push({ field: k, issue: 'implausibly large', got: v });
        return;
      }

      // ANALYSIS §7 V2 — the unit collision. A percent KPI arriving as
      // 0 < v <= 1 is almost certainly a ratio (0.95) being written
      // where the sheet stores whole numbers (95). Accepting it makes
      // the target 0.95% and every KPI passes forever. Reject loudly.
      var isPercentKpi = (key !== 'losstime' && key !== 'ot');
      if (isPercentKpi && v > 0 && v <= 1) {
        errors.push({
          field: k,
          issue: 'looks like a ratio (' + v + '); this API expects whole-number ' +
                 'percent (e.g. 95, not 0.95)',
          got: v
        });
        return;
      }

      clean[key] = v;
    });

    if (errors.length) {
      Log_.warn(MODULE, 'Target validation failed', { errors: errors });
      throw new AppError_('VALIDATION_FAILED',
        'Target validation failed', { errors: errors });
    }
    if (!Object.keys(clean).length) {
      throw new AppError_('BAD_INPUT', 'No targets supplied',
        { errors: [{ field: 'targets', issue: 'empty' }] });
    }

    return clean;
  }

  return {
    check:   check,
    targets: targets
  };
})();

// ==============================================================================
//                                DOMAIN SERVICES
// ==============================================================================

// ------------------------------------------------------------------------------
// DASHBOARDSERVICE  (was DashboardService.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * DashboardService.gs
 * ============================================================
 * Owns:
 *   - Daily Record reads (per room, CONFIG-driven)
 *   - Targets (Dashboard Settings)
 *   - Cross-cutting validation that produces _meta.warnings
 *
 * WIRE CONTRACT (frozen — HTML is not changing in Phase 1):
 *   doGet returns { prepare:{rows:[]}, assembly:{rows:[]} }
 *   Each row keeps the exact key names applyGsheetData reads,
 *   including `pctProductivity` (NOT the `pctProd` that v4's
 *   second COL block silently renamed it to).
 * ============================================================
 */

var DashboardService = (function () {

  var MODULE = 'Dashboard';

  /**
   * Read one room's Daily Record.
   * @param {string} roomId 'prepare' | 'assembly'
   * @return {{rows: Array<Object>}}
   */
  function readDailyRoom(roomId) {
    var room = Util_.getRoom(roomId);
    var L    = CONFIG.LAYOUT.daily;

    return Util_.Cache.wrap('daily_' + roomId, CONFIG.CACHE.ttlSeconds, function () {
      var sheetKey = room.dailySheet;
      var sh = Util_.getSheet(sheetKey, false);
      if (!sh) {
        Log_.warn(MODULE, 'Daily sheet missing', { room: roomId });
        return { rows: [] };
      }

      var numRows = L.dataEnd - L.dataStart + 1;
      var raw = Util_.readTable(sheetKey, L.headerRow, L.dataStart, numRows, L.columns);

      var rows = [];
      raw.forEach(function (r) {
        var d = r.day;
        if (d === null || d < 1 || d > 31) return;

        rows.push({
          day:             d,
          plan:            r.plan,
          actual:          r.actual,
          pctOutput:       r.pctOutput,
          stdHrs:          r.stdHrs,
          actualHrs:       r.actualHrs,
          pctProductivity: _productivity(r),
          ng:              r.ng,
          ppm:             r.ppm,
          rework:          r.rework,
          pctRework:       r.pctRework,
          lossTime:        r.lossTime,
          plannedHC:       r.plannedHC,
          actualHC:        r.actualHC,
          pctAttendance:   r.pctAttendance,
          ot:              r.ot,
          accidents:       r.accidents,
          note:            r.note
        });
      });

      Log_.debug(MODULE, 'Daily read', { room: roomId, rows: rows.length });
      return { rows: rows };
    });
  }

  /**
   * ANALYSIS §7 V1 — the productivity basis is UNRESOLVED.
   * CONFIG.KPI.productivityBasis decides; default 'sheet' preserves
   * v4 behaviour exactly so nothing on the dashboard shifts until
   * you make the call.
   */
  function _productivity(r) {
    switch (CONFIG.KPI.productivityBasis) {
      case 'stdOverActual':
        return Util_.div(r.stdHrs, r.actualHrs);
      case 'outputOverInput':
        return Util_.div(r.actualHrs, r.stdHrs);
      case 'sheet':
      default:
        return r.pctProductivity;
    }
  }

  /**
   * Targets from Dashboard Settings.
   *
   * ANALYSIS §7 V2 — UNIT COLLISION. Settings holds whole numbers
   * (95); Dashboard!S2:S6 holds ratios (0.95). The HTML's KPI_EXEC
   * expects whole numbers, so the wire format stays 'percent'.
   * Anything that arrives as a ratio is normalized UP, and the
   * coercion is logged — silence here is how 0.95 becomes a 0.95%
   * target and every KPI passes.
   */
  function readTargets() {
    return Util_.Cache.wrap('targets', CONFIG.CACHE.ttlSeconds, function () {
      var out = {};
      Object.keys(CONFIG.KPI.defaults).forEach(function (k) {
        out[k] = CONFIG.KPI.defaults[k];
      });

      var sh = Util_.getSheet('settings', false);
      if (!sh) {
        Log_.warn(MODULE, 'Settings sheet missing, using CONFIG defaults');
        return out;
      }

      var L    = CONFIG.LAYOUT.settings;
      var last = Util_.lastRow('settings', sh);
      if (last < L.startRow) return out;

      var vals = sh.getRange(L.startRow, 1, last - L.startRow + 1, 3).getValues();

      vals.forEach(function (row) {
        var key = Util_.toStr(row[L.keyColumn - 1]);
        if (!key) return;
        var val = Util_.toNum(row[L.valueColumn - 1]);
        if (val === null) return;

        var norm = String(key).toLowerCase();
        if (!(norm in CONFIG.KPI.defaults)) {
          Log_.debug(MODULE, 'Unrecognized target key ignored', { key: key });
          return;
        }
        out[norm] = _toWireTarget(norm, val);
      });

      Log_.debug(MODULE, 'Targets resolved', out);
      return out;
    });
  }

  /** Coerce a target to the wire format (whole-number percent). */
  function _toWireTarget(key, val) {
    if (CONFIG.KPI.targetWireFormat !== 'percent') return val;
    // Non-percent KPIs pass through untouched.
    if (key === 'losstime' || key === 'ot') return val;
    // A percent target arriving as 0<v<=1 is a ratio. Scale it.
    if (val > 0 && val <= 1) {
      Log_.warn(MODULE, 'Target looked like a ratio; scaled to percent', {
        key: key, from: val, to: val * 100
      });
      return val * 100;
    }
    return val;
  }

  /**
   * Cross-cutting validation. Produces warnings, never throws, never
   * mutates data. Everything here traces to a §7 finding that could
   * not be resolved without a decision from the operator.
   */
  function validate(payload) {
    if (!CONFIG.VALIDATION.enabled) return [];
    var warnings = [];

    try {
      // --- V3: are the two rooms carrying identical data? ---
      if (CONFIG.VALIDATION.detectIdenticalRooms) {
        var ids = CONFIG.ROOMS.map(function (r) { return r.id; });
        for (var i = 0; i < ids.length - 1; i++) {
          for (var j = i + 1; j < ids.length; j++) {
            if (_roomsIdentical(payload[ids[i]], payload[ids[j]])) {
              warnings.push({
                code: 'IDENTICAL_ROOM_DATA',
                severity: 'critical',
                message: 'Daily Record for "' + ids[i] + '" and "' + ids[j] +
                         '" are identical. Per-room comparisons are not meaningful.',
                ref: 'ANALYSIS §7 V3'
              });
            }
          }
        }
      }

      // --- V1: productivity above sane ceiling ---
      CONFIG.ROOMS.forEach(function (room) {
        var rows = (payload[room.id] && payload[room.id].rows) || [];
        var hot = rows.filter(function (r) {
          return r.pctProductivity !== null &&
                 r.pctProductivity > CONFIG.KPI.productivitySaneMax;
        });
        if (hot.length) {
          warnings.push({
            code: 'PRODUCTIVITY_OVER_CEILING',
            severity: 'high',
            message: hot.length + ' day(s) in "' + room.id + '" exceed ' +
                     (CONFIG.KPI.productivitySaneMax * 100).toFixed(0) +
                     '% productivity. Formula basis (' + CONFIG.KPI.productivityBasis +
                     ') may be inverted.',
            sample: hot.slice(0, 3).map(function (r) {
              return { day: r.day, value: Util_.round(r.pctProductivity, 4) };
            }),
            ref: 'ANALYSIS §7 V1'
          });
        }

        // --- V4: %Output beyond plausibility ---
        var wild = rows.filter(function (r) {
          return r.pctOutput !== null && r.pctOutput > CONFIG.VALIDATION.pctOutputSaneMax;
        });
        if (wild.length) {
          warnings.push({
            code: 'OUTPUT_PCT_IMPLAUSIBLE',
            severity: 'medium',
            message: wild.length + ' day(s) in "' + room.id + '" exceed ' +
                     (CONFIG.VALIDATION.pctOutputSaneMax * 100).toFixed(0) +
                     '% of plan. Plan figures may not be maintained.',
            sample: wild.slice(0, 3).map(function (r) {
              return { day: r.day, plan: r.plan, actual: r.actual };
            }),
            ref: 'ANALYSIS §7 V4'
          });
        }

        // --- V8: rework structurally empty ---
        var anyRework = rows.some(function (r) { return r.rework; });
        if (rows.length && !anyRework) {
          warnings.push({
            code: 'REWORK_ALL_ZERO',
            severity: 'low',
            message: 'Rework is zero for every day in "' + room.id +
                     '". The KPI has no input.',
            ref: 'ANALYSIS §7 V8'
          });
        }
      });

      // --- V5: attendance disagreement between sources ---
      var att = payload.attendance && payload.attendance.months;
      if (att && att.length) {
        var sheetAvg  = _avg(att.map(function (m) { return m.pct; }));
        var dailyAvg  = _dailyAttendanceAvg(payload);
        if (sheetAvg !== null && dailyAvg !== null &&
            Math.abs(sheetAvg - dailyAvg) > 0.02) {
          warnings.push({
            code: 'ATTENDANCE_SOURCE_CONFLICT',
            severity: 'high',
            message: 'Attendance sheet (' + (sheetAvg * 100).toFixed(1) +
                     '%) disagrees with Daily Record (' + (dailyAvg * 100).toFixed(1) +
                     '%). Authority is CONFIG.KPI.attendanceAuthority = ' +
                     CONFIG.KPI.attendanceAuthority + '.',
            ref: 'ANALYSIS §7 V5'
          });
        }
      }

      // --- V6: turnover target basis (see TurnoverService for the
      // corrected finding — the denominator is valid; the target basis
      // is the open question). Single definition, reused here.
      if (payload.turnover && payload.turnover.months &&
          payload.turnover.months.some(function (m) { return m.turnoverPct; })) {
        var tw = TurnoverService.basisWarning();
        if (tw) warnings.push(tw);
      }
    } catch (e) {
      Log_.error(MODULE, 'Validator crashed (non-fatal)', { err: String(e) });
    }

    if (warnings.length) {
      Log_.warn(MODULE, 'Validation warnings', { count: warnings.length,
        codes: warnings.map(function (w) { return w.code; }) });
    }
    return warnings;
  }

  function _roomsIdentical(a, b) {
    if (!a || !b || !a.rows || !b.rows) return false;
    if (!a.rows.length || a.rows.length !== b.rows.length) return false;

    var n = Math.min(CONFIG.VALIDATION.identicalRoomSampleSize, a.rows.length);
    var fields = ['plan', 'actual', 'ng', 'lossTime', 'ot'];
    var compared = 0;

    for (var i = 0; i < n; i++) {
      for (var f = 0; f < fields.length; f++) {
        var x = a.rows[i][fields[f]];
        var y = b.rows[i][fields[f]];
        if (x === null && y === null) continue;
        if (x !== y) return false;
        compared++;
      }
    }
    return compared > 0;
  }

  function _dailyAttendanceAvg(payload) {
    var present = 0, planned = 0;
    CONFIG.ROOMS.forEach(function (room) {
      var rows = (payload[room.id] && payload[room.id].rows) || [];
      rows.forEach(function (r) {
        if (r.actualHC !== null)  present += r.actualHC;
        if (r.plannedHC !== null) planned += r.plannedHC;
      });
    });
    return Util_.div(present, planned);
  }

  function _avg(arr) {
    var v = arr.filter(function (x) { return x !== null && x !== undefined && !isNaN(x); });
    if (!v.length) return null;
    return v.reduce(function (s, x) { return s + x; }, 0) / v.length;
  }

  return {
    readDailyRoom: readDailyRoom,
    readTargets:   readTargets,
    validate:      validate
  };
})();

// ------------------------------------------------------------------------------
// ATTENDANCESERVICE  (was AttendanceService.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * AttendanceService.gs
 * ============================================================
 * Read: monthly summary (rows 8-19), daily log (rows 23-55).
 * Write: aggregate daily → monthly summary row.
 *
 * ANALYSIS §8 — v4's saveAttendanceMonth looped rows 25-55 calling
 * getRange(r, c).getValue() SIX times per row: 186 individual API
 * round-trips. This does it in ONE getValues + ONE setValues.
 * ============================================================
 */

var AttendanceService = (function () {

  var MODULE = 'Attendance';

  /**
   * Monthly summary.
   * WIRE: { months: [ {month, workDays, total, present, leave,
   *                    absent, resignJBT, resignNSR, pct, target} ] }
   */
  function readMonthly() {
    return Util_.Cache.wrap('attendance_monthly', CONFIG.CACHE.ttlSeconds, function () {
      var sh = Util_.getSheet('attendance', false);
      if (!sh) {
        Log_.warn(MODULE, 'Attendance sheet missing');
        return { months: [] };
      }

      var L = CONFIG.LAYOUT.attendance;
      var numRows = L.monthlyEnd - L.monthlyStart + 1;
      var raw = Util_.readTable('attendance', L.monthlyHeaderRow,
                                L.monthlyStart, numRows, L.monthlyColumns);

      var months = raw
        .filter(function (r) { return r.month; })
        .map(function (r) {
          return {
            month:     r.month,
            monthKey:  Util_.monthKey(r.month),
            workDays:  r.workDays,
            total:     r.total,
            present:   r.present,
            leave:     r.leave,
            absent:    r.absent,
            resignJBT: r.resignJBT,
            resignNSR: r.resignNSR,
            pct:       r.pct,
            target:    r.target
          };
        });

      Log_.debug(MODULE, 'Monthly read', { months: months.length });
      return { months: months };
    });
  }

  /**
   * Daily entry log.
   *
   * AUDIT NOTE: a static grep suggested this was dead. It is NOT — the
   * GET /attendance?view=daily route calls it. Kept, and this note added
   * so the next audit doesn't repeat the mistake.
   */
  function readDaily() {
    return Util_.Cache.wrap('attendance_daily', CONFIG.CACHE.ttlSeconds, function () {
      var sh = Util_.getSheet('attendance', false);
      if (!sh) return { days: [] };

      var L = CONFIG.LAYOUT.attendance;
      var numRows = L.dailyEnd - L.dailyStart + 1;
      var raw = Util_.readTable('attendance', L.dailyHeaderRow,
                                L.dailyStart, numRows, L.dailyColumns);

      var days = raw
        .filter(function (r) { return r.total !== null && r.total > 0; })
        .map(function (r) {
          return {
            date:      Util_.toIso(r.date),
            day:       r.day,
            total:     r.total,
            present:   r.present,
            leave:     r.leave,
            absent:    r.absent,
            resignJBT: r.resignJBT,
            resignNSR: r.resignNSR,
            pct:       r.pct
          };
        });

      return { days: days };
    });
  }

  /**
   * Aggregate the daily log and write one monthly summary row.
   *
   * @param {{monthIdx:number, year:number}} month
   * @param {boolean} [dryRun] compute without writing
   * @return {Object} the computed aggregate
   */
  function saveMonth(month, dryRun) {
    if (!month || month.monthIdx === null || month.monthIdx === undefined) {
      throw new AppError_('BAD_INPUT', 'saveMonth requires {monthIdx, year}');
    }
    if (month.monthIdx < 0 || month.monthIdx > 11) {
      throw new AppError_('BAD_INPUT', 'monthIdx out of range: ' + month.monthIdx);
    }

    var sh = Util_.getSheet('attendance');
    var L  = CONFIG.LAYOUT.attendance;

    // ---- ONE batch read ----
    var numRows = L.dailyEnd - L.dailyStart + 1;
    var rows = Util_.readTable('attendance', L.dailyHeaderRow,
                               L.dailyStart, numRows, L.dailyColumns);

    var agg = {
      workDays: 0, total: 0, present: 0,
      leave: 0, absent: 0, resignJBT: 0, resignNSR: 0
    };

    rows.forEach(function (r) {
      if (r.total === null || r.total <= 0) return;
      agg.workDays  += 1;
      agg.total     += r.total     || 0;
      agg.present   += r.present   || 0;
      agg.leave     += r.leave     || 0;
      agg.absent    += r.absent    || 0;
      agg.resignJBT += r.resignJBT || 0;
      agg.resignNSR += r.resignNSR || 0;
    });

    agg.pct   = Util_.round(Util_.div(agg.present, agg.total), 4);
    agg.month = Util_.monthLabelTh(month.monthIdx, month.year);

    if (dryRun) {
      Log_.info(MODULE, 'saveMonth dry run', agg);
      return agg;
    }

    // Read-modify-write over a shared row -> must be serialised.
    return Util_.withWriteLock('AttendanceService.saveMonth', function () {
      return _writeMonth(sh, L, month, agg);
    });
  }

  /** @private Batch-write the aggregated month row. */
  function _writeMonth(sh, L, month, agg) {
    var targetRow = L.monthlyStart + month.monthIdx;
    var map = Util_.resolveColumns('attendance', L.monthlyHeaderRow, L.monthlyColumns);
    var lastCol = Util_.lastCol('attendance', sh);

    // ONE read + ONE write across the whole row.
    // Previously the savedAt stamp was a second setValue() outside the
    // batch — two round-trips, and a crash between them would leave the
    // row updated but unstamped.
    var strip = sh.getRange(targetRow, 1, 1, lastCol).getValues()[0];

    ['workDays', 'total', 'present', 'leave', 'absent', 'resignJBT', 'resignNSR']
      .forEach(function (k) {
        var idx = map[k];
        if (idx !== undefined && idx >= 0 && idx < strip.length) strip[idx] = agg[k];
      });

    if (L.savedAtColumn && L.savedAtColumn <= lastCol) {
      strip[L.savedAtColumn - 1] = new Date();
    }

    sh.getRange(targetRow, 1, 1, strip.length).setValues([strip]);

    Util_.Cache.remove('attendance_monthly');
    Util_.Cache.remove('attendance_daily');

    Log_.info(MODULE, 'Month saved', { month: agg.month, row: targetRow, workDays: agg.workDays });
    return agg;
  }

  return {
    readMonthly: readMonthly,
    readDaily:   readDaily,
    saveMonth:   saveMonth
  };
})();

// ------------------------------------------------------------------------------
// EFFICIENCYSERVICE  (was EfficiencyService.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * EfficiencyService.gs
 * ============================================================
 * The Efficiency sheet holds three 12-row blocks (Assembly,
 * Prepare, Overall) stacked vertically.
 *
 * ANALYSIS §3 A6 — v4 hardcoded block starts at 10/26/42 and
 * never checked them. An inserted row anywhere above a block
 * silently shifts every number by one month with no error.
 *
 * v5 keeps the offsets in CONFIG but VERIFIES them: if the first
 * row of a block doesn't carry the expected month label, we
 * self-heal by searching nearby, and log a WARN telling you the
 * CONFIG is stale.
 * ============================================================
 */

var EfficiencyService = (function () {

  var MODULE = 'Efficiency';

  /**
   * WIRE: { assembly:[], prepare:[], overall:[] }
   * Each entry: {month, input, output, eff, target, status}
   */
  function read() {
    return Util_.Cache.wrap('efficiency', CONFIG.CACHE.ttlSeconds, function () {
      var sh = Util_.getSheet('efficiency', false);
      if (!sh) {
        Log_.warn(MODULE, 'Efficiency sheet missing');
        return { assembly: [], prepare: [], overall: [] };
      }

      var L   = CONFIG.LAYOUT.efficiency;
      var out = {};

      Object.keys(L.blocks).forEach(function (blockName) {
        out[blockName] = _readBlock(sh, blockName, L);
      });

      return out;
    });
  }

  function _readBlock(sh, blockName, L) {
    var def = L.blocks[blockName];
    var startRow = def.startRow;

    if (L.validateMonthLabels) {
      var corrected = _locateBlock(sh, startRow, def.rows, L);
      if (corrected !== null && corrected !== startRow) {
        Log_.warn(MODULE, 'Block offset in CONFIG is stale — self-healed', {
          block: blockName, configured: startRow, actual: corrected,
          ref: 'ANALYSIS §3 A6'
        });
        startRow = corrected;
      } else if (corrected === null) {
        Log_.warn(MODULE, 'Block start could not be verified; using CONFIG value', {
          block: blockName, startRow: startRow
        });
      }
    }

    var lastRow = Util_.lastRow('efficiency', sh);
    if (startRow > lastRow) return [];
    var rows = Math.min(def.rows, lastRow - startRow + 1);

    var raw = Util_.readTable('efficiency', L.headerRow, startRow, rows, L.columns);

    return raw
      .filter(function (r) { return r.month; })
      .map(function (r) {
        return {
          month:  r.month,
          monthKey: Util_.monthKey(r.month),
          input:  r.input,
          output: r.output,
          eff:    r.eff,
          target: r.target,
          status: r.status
        };
      });
  }

  /**
   * Find the true start of a 12-month block by looking for a row whose
   * month column reads "Jan"/"ม.ค." within ±3 rows of the configured
   * position. Returns null if we can't confirm.
   */
  function _locateBlock(sh, configuredStart, blockRows, L) {
    var map = Util_.resolveColumns('efficiency', L.headerRow, L.columns);
    var monthCol = map.month + 1;   // 1-based

    var probeStart = Math.max(1, configuredStart - 3);
    var probeEnd   = Math.min(Util_.lastRow('efficiency', sh), configuredStart + 3);
    if (probeEnd < probeStart) return null;

    var vals = sh.getRange(probeStart, monthCol, probeEnd - probeStart + 1, 1).getValues();

    for (var i = 0; i < vals.length; i++) {
      var label = Util_.toStr(vals[i][0]);
      if (!label) continue;
      if (CONFIG.MONTHS_EN.indexOf(label) === 0 || CONFIG.MONTHS_TH.indexOf(label) === 0) {
        return probeStart + i;
      }
    }
    return null;
  }

  return { read: read };
})();

// ------------------------------------------------------------------------------
// QUALITYSERVICE  (was QualityService.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * QualityService.gs
 * ============================================================
 * ANALYSIS §6 — the Quality sheet holds real NG data (current
 * summary row 6, monthly trend rows 11-22). v4's doGet returned
 * it and applyGsheetData threw it away, so the dashboard showed
 * hardcoded NG_PARETO / ng:25.4 demo values instead.
 *
 * v5 emits it on the same `quality` key. Wiring the HTML to
 * consume it is Phase 2 — but the data is on the wire now.
 * ============================================================
 */

var QualityService = (function () {

  var MODULE = 'Quality';

  /**
   * WIRE: { months: [...], current: {...} }
   */
  function read() {
    return Util_.Cache.wrap('quality', CONFIG.CACHE.ttlSeconds, function () {
      var sh = Util_.getSheet('quality', false);
      if (!sh) {
        Log_.warn(MODULE, 'Quality sheet missing');
        return { months: [], current: {} };
      }

      var L = CONFIG.LAYOUT.quality;

      // ---- Current summary strip: ONE read (shared helper) ----
      var current = Util_.readCellStrip('quality', L.current.row, L.current.cells);

      // ---- Monthly trend ----
      var numRows = L.monthEnd - L.monthStart + 1;
      var raw = Util_.readTable('quality', L.headerRow, L.monthStart, numRows, L.columns);

      var months = raw
        .filter(function (r) { return r.month; })
        .map(function (r) {
          return {
            month:    r.month,
            monthKey: Util_.monthKey(r.month),
            produced: r.produced,
            ng:       r.ng,
            ngRate:   r.ngRate,
            target:   r.target,
            status:   r.status
          };
        });

      Log_.debug(MODULE, 'Quality read', { months: months.length });
      return { months: months, current: current, detail: _readDetail(sh) };
    });
  }

  /**
   * PHASE 3 — read the NG analysis blocks (rows 27..79).
   *
   * These have existed in the sheet all along and no reader ever
   * touched them, so the dashboard rendered hardcoded NG_PARETO /
   * REWORK_MODELS demo values instead of real defect data. One batch
   * read covers every block.
   */
  function _readDetail(sh) {
    var D = CONFIG.LAYOUT.quality.detail;
    var out = {};

    var lastRow = Util_.lastRow('quality', sh);
    var lastCol = Util_.lastCol('quality', sh);
    if (lastRow < D.pairs[0].startRow) return out;

    // ONE read for the whole detail region.
    var top    = D.pairs[0].headerRow;
    var bottom = Math.min(D.lossTime.startRow + D.lossTime.rows, lastRow);
    var height = bottom - top + 1;
    if (height < 1) return out;

    var block = sh.getRange(top, 1, height, lastCol).getValues();
    var at = function (row, col) {
      var r = block[row - top];
      if (!r || col - 1 >= r.length) return null;
      return r[col - 1];
    };

    // --- Paired label/pcs/pct tables ---
    D.pairs.forEach(function (spec) {
      var c = D.cols[spec.side];
      var items = [];
      for (var i = 0; i < spec.rows; i++) {
        var r = spec.startRow + i;
        if (r > bottom) break;
        var label = Util_.toStr(at(r, c.label));
        var pcs   = Util_.toNum(at(r, c.pcs));
        if (!label || pcs === null) continue;
        items.push({ label: label, pcs: pcs, pct: Util_.toNum(at(r, c.pct)) });
      }
      if (items.length) out[spec.id] = items;
    });

    // --- Top problem parts ---
    var tp = D.topParts;
    var parts = [];
    for (var i = 0; i < tp.rows; i++) {
      var r = tp.startRow + i;
      var part = Util_.toStr(at(r, tp.part));
      if (!part) continue;
      parts.push({
        rank: Util_.toStr(at(r, tp.rank)),
        part: part,
        pcs:  Util_.toNum(at(r, tp.pcs)),
        pct:  Util_.toNum(at(r, tp.pct))
      });
    }
    if (parts.length) out.topParts = parts;

    // --- Top material loss ---
    var tm = D.topMaterial;
    var mats = [];
    for (var j = 0; j < tm.rows; j++) {
      var mr = tm.startRow + j;
      if (mr > bottom) break;
      var code = Util_.toStr(at(mr, tm.code));
      var loss = Util_.toNum(at(mr, tm.loss));
      if (!code || loss === null) continue;
      mats.push({
        no:    Util_.toStr(at(mr, tm.no)),
        code:  code,
        desc:  Util_.toStr(at(mr, tm.desc)),
        qty:   Util_.toNum(at(mr, tm.qty)),
        unit:  Util_.toStr(at(mr, tm.unit)),
        costPerUnit: Util_.toNum(at(mr, tm.costPerUnit)),
        loss:  loss
      });
    }
    if (mats.length) {
      out.topMaterial = mats;
      var tot = Util_.toNum(at(tm.totalRow, tm.totalCol));
      if (tot !== null) out.materialLossTotal = tot;
    }

    // --- Loss time by model ---
    var lt = D.lossTime;
    var losses = [];
    for (var k = 0; k < lt.rows; k++) {
      var lr = lt.startRow + k;
      if (lr > bottom) break;
      var pt = Util_.toStr(at(lr, lt.part));
      var mins = Util_.toNum(at(lr, lt.minutes));
      if (!pt || mins === null) continue;
      losses.push({
        rank:    Util_.toStr(at(lr, lt.rank)),
        part:    pt,
        minutes: mins,
        pct:     Util_.toNum(at(lr, lt.pct)),
        step:    Util_.toStr(at(lr, lt.step)),
        ngPcs:   Util_.toNum(at(lr, lt.ngPcs))
      });
    }
    if (losses.length) out.lossTimeByModel = losses;

    Log_.debug(MODULE, 'Quality detail read', {
      blocks: Object.keys(out)
    });
    return out;
  }

  return { read: read };
})();

// ------------------------------------------------------------------------------
// REPAIRSERVICE  (was RepairService.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * RepairService.gs
 * ============================================================
 * ANALYSIS §6 — the Repair Material sheet has NO READER AT ALL
 * in v4. Meanwhile the dashboard's NG Cost Rate widget runs on
 * hardcoded NG_COST_RATE demo values (damageValue / materialIssued
 * per month) — which is EXACTLY what this sheet already holds,
 * with real baht figures.
 *
 * Layout is transposed: months run across columns E..P (Jan..Dec),
 * metrics run down rows. Row identification is by LABEL TEXT, not
 * row number, because the sheet has no header row to anchor on.
 * ============================================================
 */

var RepairService = (function () {

  var MODULE = 'Repair';

  /**
   * WIRE (new in v5; Phase 2 will point NG_COST_RATE at this):
   * {
   *   months: [ {month, monthTh, repairCost, totalMaterial, ratePct, target, achieved} ],
   *   totals: {repairCost, totalMaterial, ratePct},
   *   target: number|null
   * }
   */
  function read() {
    return Util_.Cache.wrap('repair', CONFIG.CACHE.ttlSeconds, function () {
      var sh = Util_.getSheet('repair', false);
      if (!sh) {
        Log_.warn(MODULE, 'Repair Material sheet missing');
        return { months: [], totals: {}, target: null };
      }

      var L = CONFIG.LAYOUT.repair;
      var lastRow = Util_.lastRow('repair', sh);
      var lastCol = Util_.lastCol('repair', sh);

      var scanEnd = Math.min(L.searchRows.end, lastRow);
      if (scanEnd < L.searchRows.start) {
        Log_.warn(MODULE, 'Repair sheet too small');
        return { months: [], totals: {}, target: null };
      }

      // ---- ONE batch read of the whole metric region ----
      var height = scanEnd - L.searchRows.start + 1;
      var width  = Math.min(L.totalCol, lastCol);
      var block  = sh.getRange(L.searchRows.start, 1, height, width).getValues();

      // ---- Locate each metric row by its label text ----
      var rowIdx = _findRows(block, L);

      var missing = Object.keys(L.rowLabels).filter(function (k) {
        return rowIdx[k] === undefined;
      });
      if (missing.length) {
        Log_.warn(MODULE, 'Some repair row labels not matched', { missing: missing });
      }

      // ---- Project columns E..P into months ----
      var months = [];
      for (var m = 0; m < L.monthCount; m++) {
        var col = L.monthStartCol - 1 + m;
        if (col >= width) break;

        var repairCost    = _cell(block, rowIdx.repairCost, col);
        var totalMaterial = _cell(block, rowIdx.totalMaterial, col);
        var ratePct       = _cell(block, rowIdx.ratePct, col);
        var target        = _cell(block, rowIdx.target, col);

        // Skip months with no input at all.
        if (repairCost === null && totalMaterial === null) continue;

        // Recompute rather than trust the sheet's IFERROR string.
        var computed = Util_.div(repairCost, totalMaterial);
        if (computed !== null) computed = Util_.round(computed * 100, 4);

        if (ratePct !== null && computed !== null &&
            Math.abs(ratePct - computed) > 0.01) {
          Log_.warn(MODULE, 'Sheet rate disagrees with recomputed rate', {
            month: CONFIG.MONTHS_EN[m], sheet: ratePct, computed: computed
          });
        }

        months.push({
          month:         CONFIG.MONTHS_EN[m],
          monthTh:       CONFIG.MONTHS_TH[m],
          monthIdx:      m,
          // MULTI-MONTH: this sheet is transposed — 12 columns for the schema
          // year, with no year cell per column — so the key is derived from
          // CONFIG.SCHEMA_YEAR rather than read from the row.
          monthKey:      CONFIG.SCHEMA_YEAR + '-' + (m < 9 ? '0' : '') + (m + 1),
          repairCost:    repairCost,
          totalMaterial: totalMaterial,
          ratePct:       computed !== null ? computed : ratePct,
          target:        target,
          achieved:      (computed !== null && target !== null) ? (computed <= target) : null
        });
      }

      // ---- Totals column (Q) ----
      var totals = {};
      var tIdx = L.totalCol - 1;
      if (tIdx < width) {
        totals.repairCost    = _cell(block, rowIdx.repairCost, tIdx);
        totals.totalMaterial = _cell(block, rowIdx.totalMaterial, tIdx);
        var tr = Util_.div(totals.repairCost, totals.totalMaterial);
        totals.ratePct = tr === null ? null : Util_.round(tr * 100, 4);
      }

      var target = null;
      if (rowIdx.target !== undefined) {
        for (var c = L.monthStartCol - 1; c < width; c++) {
          var t = _cell(block, rowIdx.target, c);
          if (t !== null) { target = t; break; }
        }
      }

      Log_.debug(MODULE, 'Repair read', { months: months.length, target: target });
      return { months: months, totals: totals, target: target };
    });
  }

  /**
   * Match metric rows by a discriminating label fragment.
   *
   * Scanning is pinned to L.labelColumn. Column B of this sheet holds
   * formula-explainer prose starting with the same Thai prefixes as the
   * real labels in column D — a wider scan false-matches and silently
   * binds two keys to one row, which zeroes the rate.
   *
   * One row may only claim one key, and one key only one row.
   */
  function _findRows(block, L) {
    var idx = {};
    var claimed = {};
    var labelCol = L.labelColumn - 1;

    var keys = Object.keys(L.rowLabels);

    for (var i = 0; i < block.length; i++) {
      var row = block[i];
      if (!row || labelCol >= row.length) continue;

      var label = Util_.toStr(row[labelCol]);
      if (!label) continue;
      var norm = label.replace(/\s+/g, '').toLowerCase();

      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (idx[key] !== undefined) continue;   // key already bound
        if (claimed[i]) break;                  // row already bound

        var want = String(L.rowLabels[key]).replace(/\s+/g, '').toLowerCase();
        if (want && norm.indexOf(want) !== -1) {
          idx[key]   = i;
          claimed[i] = true;
          break;
        }
      }
    }

    return idx;
  }

  function _cell(block, rowIndex, colIndex) {
    if (rowIndex === undefined || rowIndex === null) return null;
    var row = block[rowIndex];
    if (!row || colIndex >= row.length) return null;
    return Util_.toNum(row[colIndex]);
  }

  return { read: read };
})();

// ------------------------------------------------------------------------------
// SKILLSERVICE  (was SkillService.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * SkillService.gs
 * ============================================================
 * ANALYSIS §3 A2 — v4 read 'Skill Matrix (Prepare)' and
 * 'Skill Matrix (Assembly)'. Neither sheet has ever existed, so
 * readSkillMatrix always returned empty and the Skill page ran on
 * hardcoded demo data while the badge said "Connected ✅".
 *
 * ── SCHEMA CORRECTION (Phase 1 implementation finding) ──────
 * Fixing the sheet name was necessary but NOT sufficient. The §3
 * analysis assumed 'Skill Matrix' held an employee roster with
 * per-station skill levels. It does not.
 *
 * The real sheet is STATION-PER-ROW aggregate coverage:
 *   Assembly stations rows 20..30 (header 19)
 *   Prepare  stations rows 34..45 (header 33)
 *   Per station: Essential(Y/N), Target, Can-do(≥2), Expert(≥3),
 *                % Coverage, Short, Status
 *
 * There is NO employee list and NO per-employee level anywhere in
 * the workbook. The dashboard's heatmap needs
 * {stations:[], employees:[{name, levels[]}]} — which cannot be
 * derived from aggregates. You cannot recover 39 individuals from
 * "32 can-do, 25 expert".
 *
 * ── WHAT THIS MODULE DOES ──────────────────────────────────
 * It returns the honest shape: real `stations`, `employees: []`.
 *
 * Because applyGsheetData guards on `.employees.length`, an empty
 * array means the HTML keeps its demo roster — the same visible
 * outcome as v4, but now:
 *   1. _meta.sections.skillPrepare reports 'schema_gap', not 'live'
 *   2. a SKILL_ROSTER_ABSENT warning states exactly why
 *   3. real station coverage IS on the wire as `skillStations` for
 *      Phase 2, which can render coverage bars instead of a
 *      per-employee heatmap
 *
 * Fabricating a synthetic roster to fill the heatmap would put
 * invented per-person skill levels in front of supervisors. Not done.
 * ============================================================
 */

var SkillService = (function () {

  var MODULE = 'Skill';

  /**
   * Real station coverage for one room.
   * @return {{room, stations: Array<Object>, summary: Object|null}}
   */
  function readStations(roomId) {
    var room = Util_.getRoom(roomId);

    return Util_.Cache.wrap('skillstations_' + roomId, CONFIG.CACHE.ttlSeconds, function () {
      var sh = Util_.getSheet('skill', false);
      if (!sh) {
        Log_.warn(MODULE, 'Skill Matrix sheet missing', { room: roomId });
        return { room: roomId, stations: [], summary: null };
      }

      var L = CONFIG.LAYOUT.skill;
      var range = room.skillRange;
      if (!range) {
        Log_.warn(MODULE, 'Room has no skillRange in CONFIG', { room: roomId });
        return { room: roomId, stations: [], summary: null };
      }

      var lastRow = sh.getLastRow();
      if (lastRow < range.startRow) {
        Log_.warn(MODULE, 'Skill sheet shorter than configured range', {
          room: roomId, lastRow: lastRow, want: range.startRow
        });
        return { room: roomId, stations: [], summary: null };
      }

      var endRow  = Math.min(range.endRow, lastRow);
      var numRows = endRow - range.startRow + 1;
      if (numRows < 1) return { room: roomId, stations: [], summary: null };

      // Each room block carries its own header row — resolve per block.
      var map = Util_.resolveColumns('skill', range.headerRow, L.columns);
      var raw = Util_.readBlock('skill', range.startRow, numRows, L.columns, map);

      var stations = raw
        .filter(function (r) { return r.station; })
        .map(function (r) {
          return {
            station:   r.station,
            essential: String(r.essential || '').toUpperCase() === 'Y',
            target:    r.target,
            canDo:     r.canDo,
            expert:    r.expert,
            coverage:  r.coverage,
            short:     r.short,
            status:    r.status
          };
        });

      Log_.debug(MODULE, 'Stations read', { room: roomId, count: stations.length });
      return { room: roomId, stations: stations, summary: _roomSummary(sh, room) };
    });
  }

  function _roomSummary(sh, room) {
    if (!room.skillSummaryRow) return null;
    if (room.skillSummaryRow > sh.getLastRow()) return null;

    try {
      var v = sh.getRange(room.skillSummaryRow, 2, 1, 9).getValues()[0];
      return {
        room:      Util_.toStr(v[0]),
        headcount: Util_.toNum(v[2]),
        stations:  Util_.toNum(v[3]),
        essential: Util_.toNum(v[4]),
        ready:     Util_.toNum(v[5]),
        backup:    Util_.toNum(v[6]),
        risk:      Util_.toNum(v[7]),
        flex:      Util_.toNum(v[8])
      };
    } catch (e) {
      Log_.warn(MODULE, 'Room summary unreadable', { room: room.id, err: String(e) });
      return null;
    }
  }

  /**
   * Frozen wire shape: {stations:[names], employees:[]}.
   *
   * `stations` carries the real station NAMES (correct and useful).
   * `employees` is empty and always will be from this workbook —
   * see the schema note at the top of this file.
   */
  function readRoom(roomId) {
    var data = readStations(roomId);
    return {
      stations:  data.stations.map(function (s) { return s.station; }),
      employees: []
    };
  }

  /** Whether a real per-employee roster exists. Drives schema_gap. */
  function hasRoster() {
    return false;
  }

  /** Factory-level ROOM SUMMARY block + line flex index. */
  function readSummary() {
    return Util_.Cache.wrap('skill_summary', CONFIG.CACHE.ttlSeconds, function () {
      var sh = Util_.getSheet('skill', false);
      if (!sh) return { rooms: [], flexIndex: null };

      var S = CONFIG.LAYOUT.skill.summary;
      if (sh.getLastRow() < S.startRow) return { rooms: [], flexIndex: null };

      var flexIndex = null;
      try {
        flexIndex = Util_.toNum(sh.getRange(S.flexIndexCell).getValue());
      } catch (e) {
        Log_.warn(MODULE, 'Flex index unreadable', { err: String(e) });
      }

      var rows = Math.min(S.rows, sh.getLastRow() - S.startRow + 1);
      var vals = sh.getRange(S.startRow, 2, rows, 9).getValues();

      var rooms = vals.map(function (r) {
        return {
          room:      Util_.toStr(r[0]),
          headcount: Util_.toNum(r[2]),
          stations:  Util_.toNum(r[3]),
          essential: Util_.toNum(r[4]),
          ready:     Util_.toNum(r[5]),
          backup:    Util_.toNum(r[6]),
          risk:      Util_.toNum(r[7]),
          flex:      Util_.toNum(r[8])
        };
      }).filter(function (r) { return r.room; });

      return { rooms: rooms, flexIndex: flexIndex };
    });
  }

  return {
    readRoom:     readRoom,
    readStations: readStations,
    readSummary:  readSummary,
    hasRoster:    hasRoster
  };
})();

// ------------------------------------------------------------------------------
// TRAININGSERVICE  (was TrainingService.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * TrainingService.gs
 * ============================================================
 * ANALYSIS §3 A12 — v4 had readTraining() AND readTrainingCourses(),
 * near-duplicate implementations of the same thing. Only the latter
 * was called. One implementation now.
 *
 * WIRE: { courses: [...], summary: {...} }  — key names unchanged.
 * ============================================================
 */

var TrainingService = (function () {

  var MODULE = 'Training';

  function read() {
    return Util_.Cache.wrap('training', CONFIG.CACHE.ttlSeconds, function () {
      var sh = Util_.getSheet('training', false);
      if (!sh) {
        Log_.warn(MODULE, 'Training Plan sheet missing');
        return {
          courses: [], summary: {},
          upcoming: [], mandatory: null, deptProgress: []
        };
      }

      var L = CONFIG.LAYOUT.training;

      // ---- Summary strip: ONE read (shared helper) ----
      var summary = Util_.readCellStrip('training', L.summary.row, L.summary.cells);

      // ---- Courses ----
      var numRows = L.endRow - L.startRow + 1;
      var raw = Util_.readTable('training', L.headerRow, L.startRow, numRows, L.columns);

      var monthlyPlan = sh.getRange(L.startRow,8,numRows,12).getValues();
      var yearMatch = String(sh.getRange(1,1).getValue() || '').match(/20\d{2}/);
      var planYear = yearMatch ? Number(yearMatch[0]) : null;

      var courses = raw
        .filter(function (r) { return r.titleTh; })
        .map(function (r) {
          return {
            no:       r.no,
            type:     r.type,
            titleTh:  r.titleTh,
            titleEn:  r.titleEn || r.titleTh,
            category: r.category,
            target:   r.target,
            owner:    r.owner,
            status:   r.status,
            note:     r.note,
            months: (monthlyPlan[r._row-L.startRow] || []).map(function(value){return Util_.toStr(value);})
          };
        });

      Log_.debug(MODULE, 'Training read', { courses: courses.length });

      // ------------------------------------------------------------------
      // Derived sections.
      //
      // The dashboard's Upcoming / Mandatory / Department widgets used to run
      // on hardcoded demo constants because the API never sent anything they
      // could bind to. Everything below is computed from the rows just read —
      // nothing is invented. Where the sheet genuinely cannot support a
      // widget, the section is returned empty/null so the dashboard can show
      // an honest "no data" state instead of a plausible-looking fiction.
      // ------------------------------------------------------------------
      var TOK = L.tokens || {};

      function hasToken(value, list) {
        if (!value || !list || !list.length) return false;
        var v = String(value).toLowerCase();
        for (var i = 0; i < list.length; i++) {
          if (v.indexOf(String(list[i]).toLowerCase()) > -1) return true;
        }
        return false;
      }

      function classify(c) {
        if (hasToken(c.status, TOK.done))    return 'completed';
        if (hasToken(c.status, TOK.overdue)) return 'overdue';
        if (hasToken(c.status, TOK.active))  return 'in_progress';
        return 'not_started';
      }

      var classified = courses.map(function (c) {
        return { c: c, state: classify(c) };
      });

      // ---- Upcoming: everything not finished yet -------------------------
      // NOTE: the Training Plan sheet carries no date column, so `date` is
      // null by design. The renderer omits the date chip rather than
      // fabricating a schedule.
      var upcoming = classified
        .filter(function (x) { return x.state !== 'completed'; })
        .slice(0, 6)
        .map(function (x) {
          return {
            titleTh: x.c.titleTh,
            titleEn: x.c.titleEn,
            date:    null,
            dept:    x.c.target || x.c.owner || '',
            status:  x.state
          };
        });

      // ---- Mandatory: share of mandatory courses done vs overdue ---------
      var mand = classified.filter(function (x) {
        return hasToken(x.c.category, TOK.mandatory) ||
               hasToken(x.c.type,     TOK.mandatory);
      });
      var mandatory = null;
      if (mand.length) {
        var mDone = mand.filter(function (x) { return x.state === 'completed'; }).length;
        var mOver = mand.filter(function (x) { return x.state === 'overdue';   }).length;
        mandatory = {
          completed: Math.round((mDone / mand.length) * 100),
          overdue:   Math.round((mOver / mand.length) * 100),
          basis:     mand.length
        };
      }

      // ---- Department progress: group by target audience -----------------
      var buckets = {};
      classified.forEach(function (x) {
        var key = Util_.toStr(x.c.target);
        if (!key) return;
        if (!buckets[key]) buckets[key] = { total: 0, done: 0 };
        buckets[key].total++;
        if (x.state === 'completed') buckets[key].done++;
      });
      var deptProgress = Object.keys(buckets).map(function (k) {
        return {
          deptTh: k,
          deptEn: k,
          pct:    Math.round((buckets[k].done / buckets[k].total) * 100),
          basis:  buckets[k].total
        };
      }).sort(function (a, b) { return b.basis - a.basis; }).slice(0, 8);

      return {
        courses:      courses,
        year:         planYear,
        summary:      summary,
        upcoming:     upcoming,
        mandatory:    mandatory,
        deptProgress: deptProgress
      };
    });
  }

  return { read: read };
})();

// ------------------------------------------------------------------------------
// TURNOVERSERVICE  (was TurnoverService.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * TurnoverService.gs
 * ============================================================
 * ANALYSIS §3 A3 — v4 defined readTurnover() and then never
 * called it. Dead code; the sheet's data never reached the wire.
 *
 * ANALYSIS §7 V6 — CORRECTED (Phase 6 review).
 * I originally reported that this sheet "divides resign counts by
 * man-days — a category error". That was WRONG. Tracing the cell:
 *
 *     Turnover!C5 = 140.095 = AVERAGE(Attendance daily Total, 21 days)
 *                 = average people present per day
 *
 * That is a legitimate headcount proxy, not man-days. The output is
 * independently corroborated: 166 resignations Jan-Jul against a
 * headcount decline of 140 -> 75 (-46%). The arithmetic is sound.
 *
 * What IS open is the TARGET BASIS: the sheet targets 3%, but Jan's
 * 22.8% is a MONTHLY rate (= 274% annualised). Whether 3% means
 * 3%/month or 3%/year is a definition question for the operator, not
 * a formula bug — so this module reports the basis rather than
 * "correcting" numbers that are already right.
 * ============================================================
 */

var TurnoverService = (function () {

  var MODULE = 'Turnover';

  /**
   * The single definition of the turnover-basis advisory.
   *
   * MERGE NOTE: this warning was previously duplicated verbatim in THREE
   * places (DashboardService.validate, Router '/turnover', SummaryService),
   * and all three still carried the "man-days / category error" claim that
   * the Phase 6 review disproved. Correcting one would have left two stale
   * copies contradicting it. One definition, one truth.
   *
   * @return {Object|null} warning, or null when the basis is unambiguous
   */
  function basisWarning() {
    if (CONFIG.KPI.turnoverDenominator !== 'sheet') return null;
    return {
      code: 'TURNOVER_TARGET_BASIS',
      severity: 'low',
      message: 'Turnover % = resignations / average people per day (Attendance ' +
               'sheet). The denominator is valid. Open question: is the 3% target ' +
               'monthly or annual? Jan reads 22.8%/month (= 274% annualised).',
      ref: 'ANALYSIS §7 V6 (corrected, Phase 6)'
    };
  }

  /**
   * WIRE (new on the wire in v5):
   * { months: [ {month, headcount, resignJBT, resignNSR,
   *              totalResign, turnoverPct, target, status} ] }
   */
  function read() {
    return Util_.Cache.wrap('turnover', CONFIG.CACHE.ttlSeconds, function () {
      var sh = Util_.getSheet('turnover', false);
      if (!sh) {
        Log_.warn(MODULE, 'Turnover sheet missing');
        return { months: [] };
      }

      var L = CONFIG.LAYOUT.turnover;
      var numRows = L.endRow - L.startRow + 1;
      var raw = Util_.readTable('turnover', L.headerRow, L.startRow, numRows, L.columns);

      var months = raw
        .filter(function (r) { return r.month; })
        .map(function (r) {
          var pct = r.turnoverPct;

          if (CONFIG.KPI.turnoverDenominator === 'headcount') {
            var recomputed = Util_.div(r.totalResign, r.headcount);
            if (recomputed !== null) pct = Util_.round(recomputed, 6);
          }

          return {
            month:       r.month,
            monthKey:    Util_.monthKey(r.month),
            headcount:   r.headcount,
            resignJBT:   r.resignJBT,
            resignNSR:   r.resignNSR,
            totalResign: r.totalResign,
            turnoverPct: pct,
            target:      r.target,
            status:      r.status
          };
        });

      Log_.debug(MODULE, 'Turnover read', {
        months: months.length, basis: CONFIG.KPI.turnoverDenominator
      });
      return { months: months };
    });
  }

  return {
    read:         read,
    basisWarning: basisWarning
  };
})();

// ------------------------------------------------------------------------------
// QUALITYHISTORYSERVICE  (multi-month NG archive)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * QualityHistoryService
 * ============================================================
 * Owns the 'Quality History' sheet: the month-keyed archive the dashboard
 * writes when an NG summary file is imported.
 *
 * WHY A SEPARATE SHEET
 * The operator's 'Quality' sheet holds its detail blocks (Pareto, 4M, by-room,
 * top parts) in fixed cell ranges with room for exactly ONE month. Adding a
 * month dimension there would mean restructuring a sheet people hand-enter
 * into every day, breaking their formulas and habits. This sheet is written
 * only by the dashboard, so it can use the shape the data actually needs.
 *
 * WHY LONG FORMAT
 * One row per (month, section, item). Section lists vary in length between
 * months, and a wide layout would need a fixed column budget per section.
 * Long format also makes the upsert trivially correct: delete the rows whose
 * month matches, append the new ones. June and August are never read, never
 * written and cannot be affected by a July import.
 * ============================================================
 */
var QualityHistoryService = (function () {
  var MODULE = 'QualityHistoryService';

  function _sheet(required) {
    return Util_.getSheet('qualityHistory', required === undefined ? false : required);
  }

  /** All rows as objects, or [] when the sheet does not exist yet. */
  function _readAll() {
    var sh = _sheet(false);
    if (!sh) return [];
    var L    = CONFIG.LAYOUT.qualityHistory;
    var last = sh.getLastRow();
    if (last < L.startRow) return [];
    var numCols = L.headers.length;
    var values  = sh.getRange(L.startRow, 1, last - L.startRow + 1, numCols).getValues();
    var C = L.columns;
    return values
      .filter(function (r) { return Util_.toStr(r[C.month - 1]); })
      .map(function (r) {
        return {
          month:   Util_.toStr(r[C.month   - 1]),
          section: Util_.toStr(r[C.section - 1]),
          rank:    Util_.toStr(r[C.rank    - 1]),
          label:   Util_.toStr(r[C.label   - 1]),
          num1:    Util_.toNum(r[C.num1    - 1]),
          num2:    Util_.toNum(r[C.num2    - 1]),
          num3:    Util_.toNum(r[C.num3    - 1]),
          text1:   Util_.toStr(r[C.text1   - 1]),
          text2:   Util_.toStr(r[C.text2   - 1]),
          savedAt: Util_.toStr(r[C.savedAt - 1])
        };
      });
  }

  /** Distinct months present, oldest first. */
  function listMonths() {
    var seen = {}, out = [];
    _readAll().forEach(function (r) {
      if (!seen[r.month]) { seen[r.month] = true; out.push(r.month); }
    });
    return out.sort();
  }

  /**
   * One month's archived NG detail, grouped by section.
   * Returns null when that month has never been saved — the caller shows an
   * explicit "not archived" state rather than another month's numbers.
   */
  function readMonth(monthKey) {
    if (!monthKey) return null;
    var rows = _readAll().filter(function (r) { return r.month === monthKey; });
    if (!rows.length) return null;

    var out = { month: monthKey, savedAt: rows[0].savedAt, sections: {} };
    rows.forEach(function (r) {
      if (!out.sections[r.section]) out.sections[r.section] = [];
      out.sections[r.section].push({
        rank:  r.rank,
        label: r.label,
        num1:  r.num1, num2: r.num2, num3: r.num3,
        text1: r.text1, text2: r.text2
      });
    });
    return out;
  }

  /**
   * PHASE 1 (Quality multi-month) — adapt one archived month into the exact
   * shape QualityService.read() returns, so the dashboard's existing
   * applyQualityFromSheet() consumes it unchanged and every Quality widget
   * (KPI, Pareto, Top-3, 4M, tables) is fed from ONE filtered dataset.
   *
   * The archive is long format ({section,label,num1,num2,...}); the dashboard
   * expects q = {current, detail:{byProcess,byDefect,by4M,byRoom,byCustomer,
   * topParts,topMaterial}, months}. This is the single translation point
   * between the two — the reason no renderer had to change.
   *
   * Returns null when the month is not archived, so callers can fall back to
   * the sheet's own (single-month) detail explicitly rather than by accident.
   */
  function readMonthAsDetail(monthKey) {
    var m = readMonth(monthKey);
    if (!m) return null;
    var S = m.sections || {};

    // label + qty + pct sections -> [{label, pcs, pct}]
    function lp(section) {
      return (S[section] || []).map(function (r) {
        return { label: r.label, pcs: r.num1, pct: r.num2 };
      });
    }

    var summary = (S.summary && S.summary[0]) || {};

    var detail = {
      byProcess:  lp('process'),
      byDefect:   lp('pareto'),
      by4M:       lp('fourM'),
      byRoom:     lp('room'),
      byCustomer: lp('customer'),
      // Top-3 keeps rank + the step/defect text the card renders.
      topParts: (S.topPart || []).map(function (r) {
        return { rank: r.rank, part: r.label, pcs: r.num1, pct: r.num2,
                 step: r.text1, defect: r.text2 };
      }),
      topMaterial: (S.material || []).map(function (r) {
        return { label: r.label, value: r.num1, pct: r.num2 };
      })
    };

    return {
      // `current` KPIs resolved from this month's summary row.
      current: {
        produced: summary.num1, ngPcs: summary.num2, ngRate: summary.num3,
        monthKey: monthKey, resolvedFrom: 'qualityHistory'
      },
      detail:   detail,
      months:   [],            // trend series still comes from the Quality sheet
      savedAt:  m.savedAt,
      monthKey: monthKey,
      source:   'qualityHistory'
    };
  }

  /**
   * Replace exactly one month's rows (req 2/3).
   *
   * `rows` is [{section, rank, label, num1, num2, num3, text1, text2}].
   * Runs under the write lock because it is a read-modify-write over a range
   * other writers also touch.
   */
  function saveMonth(monthKey, rows) {
    if (!monthKey) throw new AppError_('BAD_INPUT', 'saveMonth requires a month');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(monthKey))) {
      throw new AppError_('BAD_INPUT', 'month must be YYYY-MM, got: ' + monthKey);
    }
    return Util_.withWriteLock('QualityHistoryService.saveMonth', function () {
      return _saveMonth(monthKey, rows || []);
    });
  }

  /** @private */
  function _saveMonth(monthKey, rows) {
    var sh = _sheet(false);
    if (!sh) sh = _install();

    var L = CONFIG.LAYOUT.qualityHistory;
    var C = L.columns;
    var numCols = L.headers.length;

    // ---- keep every OTHER month, drop this one ----
    var kept = _readAll().filter(function (r) { return r.month !== monthKey; });

    var stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

    function toRow(r) {
      var a = new Array(numCols);
      for (var i = 0; i < numCols; i++) a[i] = '';
      a[C.month - 1]   = r.month;
      a[C.section - 1] = r.section || '';
      a[C.rank - 1]    = r.rank    !== undefined && r.rank    !== null ? r.rank    : '';
      a[C.label - 1]   = r.label   !== undefined && r.label   !== null ? r.label   : '';
      a[C.num1 - 1]    = r.num1    !== undefined && r.num1    !== null ? r.num1    : '';
      a[C.num2 - 1]    = r.num2    !== undefined && r.num2    !== null ? r.num2    : '';
      a[C.num3 - 1]    = r.num3    !== undefined && r.num3    !== null ? r.num3    : '';
      a[C.text1 - 1]   = r.text1   !== undefined && r.text1   !== null ? r.text1   : '';
      a[C.text2 - 1]   = r.text2   !== undefined && r.text2   !== null ? r.text2   : '';
      a[C.savedAt - 1] = r.savedAt || stamp;
      return a;
    }

    var out = kept.map(toRow);
    rows.forEach(function (r) {
      r = r || {};
      r.month = monthKey;
      r.savedAt = stamp;
      out.push(toRow(r));
    });

    // ---- rewrite the data block in one batch ----
    var lastRow = sh.getLastRow();
    if (lastRow >= L.startRow) {
      sh.getRange(L.startRow, 1, lastRow - L.startRow + 1, numCols).clearContent();
    }
    if (out.length) {
      var need = L.startRow + out.length - 1;
      if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
      sh.getRange(L.startRow, 1, out.length, numCols).setValues(out);
    }

    Util_.Cache.remove('qualityHistory');
    Log_.info(MODULE, 'Quality month saved',
      { month: monthKey, rows: rows.length, kept: kept.length });

    return { month: monthKey, rowsWritten: rows.length, monthsTotal: listMonths().length };
  }

  /** Create the sheet with its header row. Idempotent. */
  function _install() {
    var ss = Util_.getSpreadsheet();
    var name = CONFIG.SHEETS.qualityHistory.name;
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var L = CONFIG.LAYOUT.qualityHistory;
    sh.getRange(L.headerRow, 1, 1, L.headers.length).setValues([L.headers]);
    sh.getRange(L.headerRow, 1, 1, L.headers.length).setFontWeight('bold');
    sh.setFrozenRows(L.headerRow);
    return sh;
  }

  return {
    listMonths: listMonths,
    readMonth:  readMonth,
    readMonthAsDetail: readMonthAsDetail,
    saveMonth:  saveMonth,
    install:    _install
  };
})();

// ------------------------------------------------------------------------------
// PRODUCTIONHISTORYSERVICE  (Phase 2A — multi-month raw daily archive)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * ProductionHistoryService
 * ============================================================
 * Owns the 'Production History' sheet: the month-keyed archive the dashboard
 * writes when a Daily Record file is imported.
 *
 * Mirrors QualityHistoryService deliberately — same shape, same upsert
 * discipline — so there is one archive pattern in the codebase, not two.
 *
 * DIFFERENCE FROM QUALITY: the upsert key is (month, room), because Production
 * has two rooms (prepare / assembly) whose daily rows are independent.
 * Importing July/prepare replaces only July's prepare rows; July's assembly
 * rows, and every other month, are untouched.
 *
 * Phase 2A scope: sheet + read/upsert only. No route or widget reads from it
 * yet (that is Phase 2B), so nothing here can affect the live dashboard or the
 * Quality module.
 * ============================================================
 */
var ProductionHistoryService = (function () {
  var MODULE = 'ProductionHistoryService';

  // Daily fields in sheet-column order, reused by both reader and writer so
  // the two cannot drift.
  var FIELDS = ['day', 'plan', 'actual', 'pctOutput', 'stdHrs', 'actualHrs',
                'pctProductivity', 'ng', 'ppm', 'rework', 'pctRework',
                'lossTime', 'plannedHC', 'actualHC', 'pctAttendance', 'ot',
                'accidents', 'note'];

  function _sheet(required) {
    return Util_.getSheet('productionHistory', required === undefined ? false : required);
  }

  /** All archived rows as objects, or [] when the sheet does not exist. */
  function _readAll() {
    var sh = _sheet(false);
    if (!sh) return [];
    var L    = CONFIG.LAYOUT.productionHistory;
    var C    = L.columns;
    var last = sh.getLastRow();
    if (last < L.startRow) return [];
    var numCols = L.headers.length;
    var values  = sh.getRange(L.startRow, 1, last - L.startRow + 1, numCols).getValues();

    return values
      .filter(function (r) { return Util_.toStr(r[C.reportMonth - 1]); })
      .map(function (r) {
        var o = {
          reportMonth: Util_.toStr(r[C.reportMonth - 1]),
          room:        Util_.toStr(r[C.room - 1]),
          savedAt:     Util_.toStr(r[C.savedAt - 1])
        };
        FIELDS.forEach(function (f) {
          var col = C[f];
          o[f] = (f === 'note') ? Util_.toStr(r[col - 1]) : Util_.toNum(r[col - 1]);
        });
        return o;
      });
  }

  /** Distinct archived months, oldest first. */
  function listMonths() {
    var seen = {}, out = [];
    _readAll().forEach(function (r) {
      if (!seen[r.reportMonth]) { seen[r.reportMonth] = true; out.push(r.reportMonth); }
    });
    return out.sort();
  }

  /**
   * One month's rows for one room, in the SAME shape DashboardService
   * .readDailyRoom() returns ({ rows:[{day,plan,actual,...}] }). Phase 2B will
   * swap this in for the live sheet read when a month is selected. Returns
   * null when that month+room is not archived, so callers fall back to the
   * live sheet explicitly.
   */
  function readMonthRoom(monthKey, roomId) {
    if (!monthKey || !roomId) return null;
    var rows = _readAll().filter(function (r) {
      return r.reportMonth === monthKey && r.room === roomId;
    });
    if (!rows.length) return null;
    rows.sort(function (a, b) { return (a.day || 0) - (b.day || 0); });
    return {
      rows: rows.map(function (r) {
        var o = {};
        FIELDS.forEach(function (f) { o[f] = r[f]; });
        return o;
      }),
      source: 'productionHistory',
      monthKey: monthKey,
      room: roomId
    };
  }

  /**
   * Replace exactly one (month, room)'s rows (req 2).
   * `rows` is [{day, plan, actual, ...}] as produced by the client's parser.
   */
  function saveMonthRoom(monthKey, roomId, rows) {
    if (!monthKey) throw new AppError_('BAD_INPUT', 'saveMonthRoom requires a month');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(monthKey))) {
      throw new AppError_('BAD_INPUT', 'month must be YYYY-MM, got: ' + monthKey);
    }
    if (roomId !== 'prepare' && roomId !== 'assembly') {
      throw new AppError_('BAD_INPUT', 'room must be prepare|assembly, got: ' + roomId);
    }
    return Util_.withWriteLock('ProductionHistoryService.saveMonthRoom', function () {
      return _saveMonthRoom(monthKey, roomId, rows || []);
    });
  }

  /** @private */
  function _saveMonthRoom(monthKey, roomId, rows) {
    var sh = _sheet(false);
    if (!sh) sh = _install();

    var L = CONFIG.LAYOUT.productionHistory;
    var C = L.columns;
    var numCols = L.headers.length;

    // keep every row that is NOT this (month, room)
    var kept = _readAll().filter(function (r) {
      return !(r.reportMonth === monthKey && r.room === roomId);
    });

    var stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

    function toRow(src, month, room) {
      var a = new Array(numCols);
      for (var i = 0; i < numCols; i++) a[i] = '';
      a[C.reportMonth - 1] = month;
      a[C.room - 1]        = room;
      FIELDS.forEach(function (f) {
        var v = src[f];
        a[C[f] - 1] = (v === undefined || v === null) ? '' : v;
      });
      a[C.savedAt - 1] = src.savedAt || stamp;
      return a;
    }

    var out = kept.map(function (r) { return toRow(r, r.reportMonth, r.room); });
    rows.forEach(function (r) {
      r = r || {};
      out.push(toRow(r, monthKey, roomId));
    });

    var lastRow = sh.getLastRow();
    if (lastRow >= L.startRow) {
      sh.getRange(L.startRow, 1, lastRow - L.startRow + 1, numCols).clearContent();
    }
    if (out.length) {
      var need = L.startRow + out.length - 1;
      if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
      sh.getRange(L.startRow, 1, out.length, numCols).setValues(out);
    }

    Util_.Cache.remove('productionHistory');
    Log_.info(MODULE, 'Production month saved',
      { month: monthKey, room: roomId, rows: rows.length, kept: kept.length });

    return { month: monthKey, room: roomId, rowsWritten: rows.length,
             monthsTotal: listMonths().length };
  }

  /** Create the sheet with its header row. Idempotent. */
  function _install() {
    var ss = Util_.getSpreadsheet();
    var name = CONFIG.SHEETS.productionHistory.name;
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var L = CONFIG.LAYOUT.productionHistory;
    sh.getRange(L.headerRow, 1, 1, L.headers.length).setValues([L.headers]);
    sh.getRange(L.headerRow, 1, 1, L.headers.length).setFontWeight('bold');
    sh.setFrozenRows(L.headerRow);
    return sh;
  }

  return {
    listMonths:    listMonths,
    readMonthRoom: readMonthRoom,
    saveMonthRoom: saveMonthRoom,
    install:       _install
  };
})();

// ------------------------------------------------------------------------------
// HISTORYSERVICE  (was HistoryService.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * HistoryService.gs
 * ============================================================
 * Owns the archive paths:
 *   - Daily Record → History (per room), 35-row blocks
 *   - OT totals → OT Monthly History
 *   - Month selector → display area
 *
 * ANALYSIS §3 A8 — v4's archiveCurrentMonthOT did its own
 * String(J2).split('-'), producing NaN when J2 held a Date, then
 * wrote to row `12 + NaN`. Every month parse now goes through
 * Util_.parseMonth, which handles Date, "06-2026" and "มิ.ย. 2026".
 *
 * ANALYSIS §10 — the 12-block layout has NO YEAR DIMENSION. This
 * module writes the year into the block header so Phase 3 can add
 * one without losing 2026's archive, and refuses to silently
 * overwrite a block belonging to a different year.
 * ============================================================
 */

var HistoryService = (function () {

  var MODULE = 'History';

  function _blockRows(room) {
    var D = CONFIG.LAYOUT.daily;
    return D.dataEnd - D.dataStart + 1;
  }

  function _blockDataStart(monthIdx) {
    var H = CONFIG.LAYOUT.history;
    return H.blockStart + monthIdx * H.blockSize + 2;   // +0 hdr, +1 cols, +2 data
  }

  function _blockHeaderRow(monthIdx) {
    var H = CONFIG.LAYOUT.history;
    return H.blockStart + monthIdx * H.blockSize;
  }

  /**
   * Read the month/year stamp from a room's Daily Record J2.
   * @return {{monthIdx, year}}
   */
  function readDailyMonth(roomId) {
    var room = Util_.getRoom(roomId);
    var sh   = Util_.getSheet(room.dailySheet);
    var raw  = sh.getRange(CONFIG.LAYOUT.daily.monthCell).getValue();

    var parsed = Util_.parseMonth(raw);
    if (!parsed) {
      throw new AppError_('BAD_MONTH',
        'Cell ' + CONFIG.LAYOUT.daily.monthCell + ' on "' +
        CONFIG.SHEETS[room.dailySheet].name +
        '" is not a valid month. Expected e.g. 06-2026. Got: ' + raw);
    }
    return parsed;
  }

  /**
   * Archive one room's Daily Record into its History block.
   * @param {string} roomId
   * @param {{monthIdx, year}} [month] defaults to the room's J2
   * @return {Object} summary of what was written
   */
  function saveMonth(roomId, month) {
    var room = Util_.getRoom(roomId);
    if (!month) month = readDailyMonth(roomId);
    // Read-modify-write across a shared History block -> serialise.
    return Util_.withWriteLock('HistoryService.saveMonth', function () {
      return _saveMonth(roomId, room, month);
    });
  }

  /** @private */
  function _saveMonth(roomId, room, month) {

    var wsDaily = Util_.getSheet(room.dailySheet);
    var wsHist  = Util_.getSheet(room.histSheet);

    var D = CONFIG.LAYOUT.daily;
    var H = CONFIG.LAYOUT.history;

    var numRows  = _blockRows(room);
    var numCols  = Object.keys(D.columns).length;

    // ---- ONE batch read ----
    var data = wsDaily.getRange(D.dataStart, 1, numRows, numCols).getValues();

    var dataStart = _blockDataStart(month.monthIdx);
    var headerRow = _blockHeaderRow(month.monthIdx);

    _ensureRows(wsHist, dataStart + numRows + 2);

    // Guard: refuse to clobber a different year's block.
    var existing = wsHist.getRange(headerRow, 1).getValue();
    if (existing) {
      var prior = Util_.parseMonth(existing);
      if (prior && prior.year !== month.year) {
        throw new AppError_('YEAR_CONFLICT',
          'Block for ' + CONFIG.MONTHS_TH[month.monthIdx] + ' already holds year ' +
          prior.year + '. Refusing to overwrite with ' + month.year +
          '. The archive has no year dimension (ANALYSIS §10).');
      }
    }

    // ---- ONE batch write ----
    wsHist.getRange(dataStart, 1, numRows, numCols).setValues(data);

    var label = Util_.monthLabelTh(month.monthIdx, month.year);
    wsHist.getRange(headerRow, 1).setValue(label);

    var stamp = 'บันทึกเมื่อ: ' +
      Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    wsHist.getRange(dataStart + numRows + 1, 1).setValue(stamp);

    wsHist.getRange(H.monthSelector).setValue(label);
    showMonth(roomId, month);

    Log_.info(MODULE, 'Month archived', {
      room: roomId, month: label, rows: numRows, blockRow: dataStart
    });

    return { room: roomId, month: label, rows: numRows, savedAt: stamp };
  }

  /** Copy a stored block into the display area. */
  function showMonth(roomId, month) {
    var room   = Util_.getRoom(roomId);
    var wsHist = Util_.getSheet(room.histSheet);

    var D = CONFIG.LAYOUT.daily;
    var H = CONFIG.LAYOUT.history;

    var numCols   = Object.keys(D.columns).length;
    var numRows   = _blockRows(room);
    var dataStart = _blockDataStart(month.monthIdx);

    _ensureRows(wsHist, dataStart + numRows);

    var stored = wsHist.getRange(dataStart, 1, numRows, numCols).getValues();

    var displayRows = H.displayEnd - H.displayStart + 1;
    var out = [];
    for (var i = 0; i < displayRows; i++) {
      if (i < stored.length) {
        out.push(stored[i]);
      } else {
        var blank = [];
        for (var c = 0; c < numCols; c++) blank.push('');
        out.push(blank);
      }
    }

    wsHist.getRange(H.displayStart, 1, displayRows, numCols).setValues(out);

    var savedAt = wsHist.getRange(dataStart + numRows + 1, 1).getValue();
    wsHist.getRange(H.statusCell).setValue(
      savedAt || 'ยังไม่มีข้อมูล — กด "บันทึกเดือนนี้" ก่อน'
    );

    Log_.debug(MODULE, 'Month displayed', {
      room: roomId, month: Util_.monthLabelTh(month.monthIdx, month.year)
    });
  }

  /** Resolve the dropdown value and display it. */
  function showSelectedMonth(roomId) {
    var room   = Util_.getRoom(roomId);
    var wsHist = Util_.getSheet(room.histSheet);
    var raw    = wsHist.getRange(CONFIG.LAYOUT.history.monthSelector).getValue();

    var month = Util_.parseMonth(raw);
    if (!month) {
      throw new AppError_('BAD_MONTH',
        'Month selector is empty or unrecognized. Got: ' + raw);
    }
    showMonth(roomId, month);
    return month;
  }

  /**
   * Sum OT for a room's current Daily Record and archive it.
   * Iterates CONFIG.ROOMS — adding a third room needs no code here.
   */
  function archiveOT(month) {
    if (!month) month = readDailyMonth(CONFIG.ROOMS[0].id);
    return Util_.withWriteLock('HistoryService.archiveOT', function () {
      return _archiveOT(month);
    });
  }

  /** @private */
  function _archiveOT(month) {

    var wsOT = Util_.getSheet('otHistory');
    var L    = CONFIG.LAYOUT.otHistory;

    var totals = {};
    var grand  = 0;

    CONFIG.ROOMS.forEach(function (room) {
      var data = DashboardService.readDailyRoom(room.id);
      var sum  = 0;
      data.rows.forEach(function (r) { if (r.ot) sum += r.ot; });
      sum = Util_.round(sum, 1);
      totals[room.id] = sum;
      grand += sum;
    });
    grand = Util_.round(grand, 1);

    var targetRow = L.startRow + month.monthIdx;
    _ensureRows(wsOT, targetRow);

    // QA FIX: this used to issue one setValue() per room plus one each for
    // savedAt and year — 4+ round-trips to write a single row. Worse, it
    // never wrote `total` at all, which is why readOtHistory() returned
    // total:0 for every archived month. One read, mutate, one write.
    var map = Util_.resolveColumns('otHistory', L.headerRow, L.columns);
    var lastCol = Math.max(wsOT.getLastColumn(), 1);
    var strip = wsOT.getRange(targetRow, 1, 1, lastCol).getValues()[0];

    function put(idx, val) {
      if (idx === undefined || idx === null || idx < 0 || idx >= strip.length) return;
      strip[idx] = val;
    }

    CONFIG.ROOMS.forEach(function (room) {
      if (!room.otColumn) return;
      put(room.otColumn - 1, totals[room.id]);   // otColumn is 1-based
    });
    put(map.total,   grand);                     // was never written
    put(map.savedAt, new Date());
    put(map.year,    month.year);

    wsOT.getRange(targetRow, 1, 1, strip.length).setValues([strip]);

    Util_.Cache.remove('otHistory');

    Log_.info(MODULE, 'OT archived', {
      month: Util_.monthLabelTh(month.monthIdx, month.year),
      totals: totals, grand: grand
    });

    return {
      month:  Util_.monthLabelTh(month.monthIdx, month.year),
      totals: totals,
      grand:  grand
    };
  }

  /**
   * OT Monthly History read.
   * WIRE: { months: [ {month, prepare, assembly, total, savedAt} ] }
   * Room keys are emitted dynamically from CONFIG.ROOMS.
   */
  function readOtHistory() {
    return Util_.Cache.wrap('otHistory', CONFIG.CACHE.ttlSeconds, function () {
      var sh = Util_.getSheet('otHistory', false);
      if (!sh) {
        Log_.warn(MODULE, 'OT History sheet missing');
        return { months: [] };
      }

      var L = CONFIG.LAYOUT.otHistory;
      var numRows = L.endRow - L.startRow + 1;
      var raw = Util_.readTable('otHistory', L.headerRow, L.startRow, numRows, L.columns);

      var months = raw
        .filter(function (r) { return r.month; })
        .map(function (r) {
          var o = {
            month:   r.month,
            monthKey: Util_.monthKey(r.month),
            year:    r.year,
            total:   r.total,
            savedAt: Util_.toIso(r.savedAt)
          };
          // Preserve the frozen wire keys `prepare` / `assembly`.
          CONFIG.ROOMS.forEach(function (room) {
            o[room.id] = r[room.id] !== undefined ? r[room.id] : null;
          });
          return o;
        });

      return { months: months };
    });
  }

  /**
   * GET /history — read archived month blocks back out.
   *
   * v4 could WRITE the archive but nothing ever read it, so 12 months
   * of stored daily data was invisible to every client (ANALYSIS §6).
   *
   * @param {string} roomId
   * @param {{monthIdx,year}} [month] omit for an index of all months
   */
  function readArchive(roomId, month) {
    var room = Util_.getRoom(roomId);

    var ck = 'archive_' + roomId + (month ? '_' + month.monthIdx + '_' + month.year : '_index');
    return Util_.Cache.wrap(ck, CONFIG.CACHE.ttlSeconds, function () {
      var sh = Util_.getSheet(room.histSheet, false);
      if (!sh) {
        Log_.warn(MODULE, 'History sheet missing', { room: roomId });
        return { room: roomId, months: [] };
      }

      if (month) {
        var block = _readBlock(sh, roomId, month);
        return { room: roomId, month: block.label, savedAt: block.savedAt,
                 rows: block.rows };
      }

      // Index: which months actually hold data, without shipping all
      // 12 blocks of rows.
      var months = [];
      for (var mi = 0; mi < 12; mi++) {
        var probe = _probeBlock(sh, mi);
        if (probe) months.push(probe);
      }
      return { room: roomId, months: months };
    });
  }

  function _storedRows(values, month) {
    var columns = CONFIG.LAYOUT.daily.columns;
    var maxDay = new Date(month.year, month.monthIdx + 1, 0).getDate();
    var rows = [];
    values.forEach(function(row){
      var day = Util_.toNum(row[columns.day.fallback]);
      if (!Number.isInteger(day) || day < 1 || day > maxDay) return;
      var o = {day:day};
      Object.keys(columns).forEach(function(key){
        if (key === 'day') return;
        var raw = row[columns[key].fallback];
        o[key] = columns[key].type === 'text' ? Util_.toStr(raw) : Util_.toNum(raw);
      });
      // A day label alone (or '-' placeholders) is not a production record.
      if (!Object.keys(columns).some(function(key){return key !== 'day' && key !== 'note' && o[key] !== null;})) return;
      rows.push(o);
    });
    return rows;
  }

  function _probeBlock(sh, monthIdx) {
    var headerRow = _blockHeaderRow(monthIdx);
    if (headerRow > sh.getMaxRows()) return null;
    var month = Util_.parseMonth(sh.getRange(headerRow,1).getValue());
    if (!month || month.monthIdx !== monthIdx) return null;
    var block = _readBlock(sh, null, month);
    if (!block.rows.length) return null;
    return {monthIdx:monthIdx,monthKey:block.monthKey,
      monthTh:CONFIG.MONTHS_TH[monthIdx],monthEn:CONFIG.MONTHS_EN[monthIdx],
      label:block.label,savedAt:block.savedAt,blockRow:_blockDataStart(monthIdx)};
  }

  function _readBlock(sh, roomId, month) {
    var D = CONFIG.LAYOUT.daily;
    var dataStart = _blockDataStart(month.monthIdx);
    var numRows = D.dataEnd-D.dataStart+1;
    var empty = {label:null,savedAt:null,rows:[]};
    if (dataStart + numRows - 1 > sh.getMaxRows()) return empty;
    var storedMonth = Util_.parseMonth(sh.getRange(_blockHeaderRow(month.monthIdx),1).getValue());
    if (!storedMonth || storedMonth.year !== month.year || storedMonth.monthIdx !== month.monthIdx) return empty;
    var values = sh.getRange(dataStart,1,numRows,Object.keys(D.columns).length).getValues();
    var savedAtRow = dataStart+numRows+1;
    return {label:Util_.monthLabelTh(month.monthIdx,month.year),
      monthKey:Util_.monthKey(Util_.monthLabelTh(month.monthIdx,month.year)),
      savedAt:savedAtRow<=sh.getMaxRows()?Util_.toStr(sh.getRange(savedAtRow,1).getValue()):null,
      rows:_storedRows(values,month)};
  }

  /** All legacy History blocks in one batch per room; never read display rows. */
  function readDailySnapshots(roomId) {
    return Util_.Cache.wrap('archive_' + roomId + '_daily_snapshots', CONFIG.CACHE.ttlSeconds, function(){
      var room = Util_.getRoom(roomId), sh = Util_.getSheet(room.histSheet,false), result = {};
      var H = CONFIG.LAYOUT.history, D = CONFIG.LAYOUT.daily;
      if (!sh || sh.getLastRow() < H.blockStart) return result;
      var count = Math.min(12*H.blockSize,sh.getLastRow()-H.blockStart+1);
      var values = sh.getRange(H.blockStart,1,count,Object.keys(D.columns).length).getValues();
      for (var mi=0;mi<12;mi++) {
        var offset=mi*H.blockSize;
        if (offset>=values.length) break;
        var month=Util_.parseMonth(values[offset][0]);
        if (!month || month.monthIdx!==mi) continue;
        var rows=_storedRows(values.slice(offset+2,offset+2+D.dataEnd-D.dataStart+1),month);
        if (!rows.length) continue;
        var key=Util_.monthKey(Util_.monthLabelTh(month.monthIdx,month.year));
        result[key]={rows:rows,monthKey:key,room:roomId,source:'history'};
      }
      return result;
    });
  }

  function room_dailyKey(roomId) {
    return Util_.getRoom(roomId).dailySheet;
  }

  function _ensureRows(sh, needed) {
    var have = sh.getMaxRows();
    if (needed > have) {
      sh.insertRowsAfter(have, needed - have);
      // QA: the sheet just changed size, so any memoized lastRow/lastCol
      // for it is now wrong. Cheap to drop; expensive to be stale.
      Util_.forgetDims();
      Log_.debug(MODULE, 'Extended sheet', {
        sheet: sh.getName(), from: have, to: needed
      });
    }
  }

  return {
    readDailyMonth:    readDailyMonth,
    saveMonth:         saveMonth,
    // showMonth is internal — saveMonth and showSelectedMonth call it.
    // It was exported with zero external callers (AUDIT).
    showSelectedMonth: showSelectedMonth,
    archiveOT:         archiveOT,
    readOtHistory:     readOtHistory,
    readDailySnapshots: readDailySnapshots,
    readArchive:       readArchive
  };
})();

// ------------------------------------------------------------------------------
// SETTINGSSERVICE  (was SettingsService.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * SettingsService.gs — /settings
 * ============================================================
 * Read and write Dashboard Settings targets.
 *
 * ANALYSIS §3 A4 — v4 had NO doPost. pushTargetsToSheet() POSTed
 * into a void and every target edit was silently lost.
 *
 * ANALYSIS §7 V2 — THE UNIT COLLISION lives here. Dashboard!S2:S6
 * stores ratios (0.95); Dashboard Settings stores whole numbers (95).
 * This service is the boundary: the wire is ALWAYS whole-number
 * percent, and Validator_.targets rejects anything that looks like a
 * ratio rather than "helpfully" converting it. Silent coercion is how
 * a 95% target becomes 0.95% and every KPI passes forever.
 * ============================================================
 */

var SettingsService = (function () {

  var MODULE = 'Settings';

  /** GET /settings */
  function read() {
    var targets = DashboardService.readTargets();
    var units   = _units();

    var items = Object.keys(CONFIG.KPI.defaults).map(function (key) {
      return {
        key:            key,
        value:          targets[key],
        default:        CONFIG.KPI.defaults[key],
        unit:           units[key] || null,
        higherIsBetter: !!CONFIG.KPI.higherIsBetter[key],
        isDefault:      targets[key] === CONFIG.KPI.defaults[key]
      };
    });

    var schedule = readSchedule();

    return {
      targets: targets,
      items:   items,
      schedule: schedule,
      format: {
        // Be explicit on the wire. A client that assumes ratios will
        // render 95 as 9500%.
        targetFormat: CONFIG.KPI.targetWireFormat,
        note: 'Percent KPIs are whole numbers (95 = 95%). losstime is ' +
              'minutes; ot is hours.'
      },
      writable: _writable()
    };
  }

  /**
   * Factory schedule from Dashboard Settings.
   *
   * PHASE 3 — the header/sidebar showed hardcoded shift/break/OT times
   * because NO sheet in the workbook carried them. These rows are added
   * by Utility_installSchedule(); until then `configured` is false and
   * the client is expected to keep its own defaults rather than render
   * empty fields.
   *
   * @return {{configured:boolean, workStart, workEnd, otStart, otEnd,
   *           shiftNameEn, shiftNameTh, breaks:[{time,th,en}]}}
   */
  function readSchedule() {
    return Util_.Cache.wrap('schedule', CONFIG.CACHE.ttlSeconds, function () {
      var out = { configured: false, breaks: [] };

      var sh = Util_.getSheet('settings', false);
      if (!sh) return out;

      var L = CONFIG.LAYOUT.settings;
      var S = CONFIG.LAYOUT.schedule;
      var last = sh.getLastRow();
      if (last < L.startRow) return out;

      var raw = {};
      try {
        var vals = sh.getRange(L.startRow, 1, last - L.startRow + 1, 2).getValues();
        vals.forEach(function (r) {
          var k = Util_.toStr(r[L.keyColumn - 1]);
          if (!k) return;
          raw[String(k).toLowerCase()] = Util_.toStr(r[L.valueColumn - 1]);
        });
      } catch (e) {
        Log_.warn(MODULE, 'Schedule read failed', { err: String(e) });
        return out;
      }

      // Times may be typed as Date by Sheets' auto-format; normalize.
      function timeOf(key) {
        var v = raw[key];
        return v ? _normalizeTime(v) : null;
      }

      out.workStart = timeOf(S.keys.workStart);
      out.workEnd   = timeOf(S.keys.workEnd);
      out.otStart   = timeOf(S.keys.otStart);
      out.otEnd     = timeOf(S.keys.otEnd);

      var shift = raw[S.keys.shiftName];
      if (shift) {
        var parts = String(shift).split('|');
        out.shiftNameEn = parts[0] || null;
        out.shiftNameTh = parts[1] || parts[0] || null;
      }

      for (var i = 1; i <= S.maxBreaks; i++) {
        var b = raw[S.breakPrefix + i];
        if (!b) continue;
        var p = String(b).split('|');
        if (!p[0]) continue;
        out.breaks.push({
          time: p[0].trim(),
          th:   (p[1] || p[0]).trim(),
          en:   (p[2] || p[1] || p[0]).trim()
        });
      }

      out.configured = !!(out.workStart && out.workEnd);

      if (!out.configured) {
        Log_.warn(MODULE, 'Schedule not configured in Dashboard Settings — ' +
          'run Utility_installSchedule() to add the rows');
      }
      return out;
    });
  }

  /**
   * Accept "08:00", "8:00", or a Date (Sheets auto-formats HH:mm).
   * Returns "HH:mm" or null.
   */
  function _normalizeTime(v) {
    if (Object.prototype.toString.call(v) === '[object Date]') {
      return Utilities.formatDate(v, CONFIG.TIMEZONE, 'HH:mm');
    }
    var s = String(v).trim();
    var m = s.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
  }

  /** Is the API token installed? Writes are impossible without it. */
  function _writable() {
    try {
      return !!PropertiesService.getScriptProperties()
        .getProperty(CONFIG.PROP_KEYS.apiToken);
    } catch (e) {
      return false;
    }
  }

  function _units() {
    var out = {};
    var sh = Util_.getSheet('settings', false);
    if (!sh) return out;

    var L    = CONFIG.LAYOUT.settings;
    var last = sh.getLastRow();
    if (last < L.startRow) return out;

    try {
      var vals = sh.getRange(L.startRow, 1, last - L.startRow + 1, 3).getValues();
      vals.forEach(function (r) {
        var k = Util_.toStr(r[L.keyColumn - 1]);
        if (!k) return;
        out[String(k).toLowerCase()] = Util_.toStr(r[L.unitColumn - 1]);
      });
    } catch (e) {
      Log_.warn(MODULE, 'Units unreadable', { err: String(e) });
    }
    return out;
  }

  /**
   * POST /settings — write validated targets.
   * @param {Object} clean already through Validator_.targets
   */
  function saveTargets(clean) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      throw new AppError_('LOCK_TIMEOUT', 'Could not acquire write lock');
    }

    try {
      var sh = Util_.getSheet('settings');
      var L  = CONFIG.LAYOUT.settings;
      var last = sh.getLastRow();

      if (last < L.startRow) {
        throw new AppError_('SHEET_EMPTY', 'Dashboard Settings has no rows');
      }

      // ONE read → mutate in memory → ONE write.
      var height = last - L.startRow + 1;
      var range  = sh.getRange(L.startRow, L.keyColumn, height, 2);
      var vals   = range.getValues();

      var written = {};
      var before  = {};

      for (var i = 0; i < vals.length; i++) {
        var key = Util_.toStr(vals[i][0]);
        if (!key) continue;
        var norm = String(key).toLowerCase();
        if (clean[norm] !== undefined) {
          before[norm]  = Util_.toNum(vals[i][1]);
          vals[i][1]    = clean[norm];
          written[norm] = clean[norm];
        }
      }

      var skipped = Object.keys(clean).filter(function (k) {
        return written[k] === undefined;
      });

      if (!Object.keys(written).length) {
        throw new AppError_('SHEET_EMPTY',
          'No matching target rows found in Dashboard Settings',
          { errors: [{ field: 'targets', issue: 'no matching rows', keys: skipped }] });
      }

      range.setValues(vals);

      // Any write must invalidate the reads it affects, or the next
      // GET serves the pre-write value for up to the TTL.
      _invalidate();

      if (skipped.length) {
        Log_.warn(MODULE, 'Targets with no row in Settings', { keys: skipped });
      }
      Log_.info(MODULE, 'Targets saved', { written: written, before: before });

      return {
        written: written,
        before:  before,
        skipped: skipped,
        savedAt: new Date().toISOString()
      };

    } finally {
      lock.releaseLock();
    }
  }

  /** Drop every cache entry a target change can influence. */
  function _invalidate() {
    Util_.Cache.remove('targets');
    Util_.Cache.remove('schedule');
    Util_.Cache.remove('rest__settings');
    Util_.Cache.remove('rest__summary');
    Util_.Cache.remove('rest__dashboard');
    // Efficiency/Quality/Turnover statuses are computed by SHEET
    // formulas that reference the target cells, so their reads go
    // stale too.
    Util_.Cache.remove('efficiency');
    Util_.Cache.remove('rest__efficiency');
    Util_.Cache.remove('quality');
    Util_.Cache.remove('rest__quality');
    Util_.Cache.remove('turnover');
    Util_.Cache.remove('rest__turnover');
    Log_.debug(MODULE, 'Caches invalidated after target write');
  }

  return {
    read:         read,
    readSchedule: readSchedule,
    saveTargets:  saveTargets
  };
})();

// ------------------------------------------------------------------------------
// SUMMARYSERVICE  (was SummaryService.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * SummaryService.gs — /summary
 * ============================================================
 * A compact executive rollup: current KPI values, their targets,
 * and pass/fail. This is the endpoint a phone widget or a status
 * board hits — it must stay small and cheap.
 *
 * Every number here carries a `source` field naming the sheet it
 * came from. ANALYSIS §7 V5 found the same KPI (attendance) taking
 * two different values depending on which widget you looked at,
 * because two sheets disagreed and nothing said which was in play.
 * Attribution is not decoration; it's the fix.
 * ============================================================
 */

var SummaryService = (function () {

  var MODULE = 'Summary';

  function read() {
    var targets = DashboardService.readTargets();
    var kpis    = [];
    var notes   = [];

    // --- Attendance ---
    // ANALYSIS §7 V5 — Attendance sheet and Daily Record disagree
    // (92.3% vs 86.9%). CONFIG.KPI.attendanceAuthority decides.
    var att = _attendance(notes);
    if (att !== null) {
      kpis.push(_kpi('attendance', att.value, targets.attendance, '%', att.source));
    }

    // --- Efficiency ---
    var eff = _efficiency();
    if (eff !== null) {
      kpis.push(_kpi('efficiency', eff.value, targets.efficiency, '%', eff.source));
    }

    // --- NG rate ---
    var ng = _ngRate();
    if (ng !== null) {
      kpis.push(_kpi('ng', ng.value, targets.ng, '%', ng.source));
    }

    // --- Loss time / OT / rework, from daily rows ---
    var daily = _dailyRollup();
    if (daily.lossTime !== null) {
      kpis.push(_kpi('losstime', daily.lossTime, targets.losstime, ' min', 'Daily Record'));
    }
    if (daily.ot !== null) {
      kpis.push(_kpi('ot', daily.ot, targets.ot, ' hrs', 'Daily Record'));
    }
    if (daily.reworkPct !== null) {
      kpis.push(_kpi('rework', daily.reworkPct, targets.rework, '%', 'Daily Record'));
    } else {
      // ANALYSIS §7 V8 — rework is zero for every row of every month.
      notes.push({
        code: 'REWORK_NO_INPUT',
        severity: 'low',
        message: 'Rework has no input data; the KPI is omitted rather than shown as 0%.',
        ref: 'ANALYSIS §7 V8'
      });
    }

    // --- Turnover (not in KPI.defaults; reported separately) ---
    var turn = _turnover(notes);

    // --- Safety ---
    var safety = { accidents: daily.accidents, source: 'Daily Record' };

    var passing = kpis.filter(function (k) { return k.status === 'pass'; }).length;

    return {
      generatedAt: new Date().toISOString(),
      kpis:        kpis,
      turnover:    turn,
      safety:      safety,
      scorecard: {
        total:   kpis.length,
        passing: passing,
        failing: kpis.length - passing,
        pctPassing: kpis.length ? Util_.round(passing / kpis.length * 100, 1) : null
      },
      notes: notes
    };
  }

  /** Build one KPI entry with direction-aware status. */
  function _kpi(id, value, target, unit, source) {
    var higher = CONFIG.KPI.higherIsBetter[id];
    var status = null;

    if (value !== null && target !== null && target !== undefined) {
      status = higher ? (value >= target ? 'pass' : 'fail')
                      : (value <= target ? 'pass' : 'fail');
    }

    return {
      id:      id,
      value:   value,
      target:  target,
      unit:    unit,
      // Whole-number percent on the wire (ANALYSIS §7 V2).
      status:  status,
      higherIsBetter: !!higher,
      source:  source
    };
  }

  function _attendance(notes) {
    var authority = CONFIG.KPI.attendanceAuthority;

    if (authority === 'attendanceSheet') {
      var m = AttendanceService.readMonthly();
      var withData = m.months.filter(function (x) {
        return x.pct !== null && x.total;
      });
      if (!withData.length) return null;
      var latest = withData[withData.length - 1];
      return {
        value:  Util_.round(latest.pct * 100, 1),
        source: 'Attendance (' + latest.month + ')'
      };
    }

    var d = _dailyRollup();
    if (d.attendancePct === null) return null;
    return { value: d.attendancePct, source: 'Daily Record' };
  }

  function _efficiency() {
    var eff = EfficiencyService.read();
    var overall = (eff.overall || []).filter(function (m) { return m.eff !== null; });
    if (!overall.length) return null;
    var latest = overall[overall.length - 1];
    return {
      value:  Util_.round(latest.eff * 100, 1),
      source: 'Efficiency (' + latest.month + ')'
    };
  }

  function _ngRate() {
    var q = QualityService.read();
    if (q.current && q.current.ngRate !== null && q.current.ngRate !== undefined) {
      return { value: Util_.round(q.current.ngRate * 100, 2), source: 'Quality (current)' };
    }
    var withData = (q.months || []).filter(function (m) { return m.ngRate !== null; });
    if (!withData.length) return null;
    var latest = withData[withData.length - 1];
    return {
      value:  Util_.round(latest.ngRate * 100, 2),
      source: 'Quality (' + latest.month + ')'
    };
  }

  function _turnover(notes) {
    var t = TurnoverService.read();
    var withData = (t.months || []).filter(function (m) { return m.turnoverPct !== null; });
    if (!withData.length) return null;

    var latest = withData[withData.length - 1];

    var tw = TurnoverService.basisWarning();
    if (tw) notes.push(tw);


    return {
      month:  latest.month,
      value:  Util_.round(latest.turnoverPct * 100, 2),
      target: latest.target !== null ? Util_.round(latest.target * 100, 2) : null,
      source: 'Turnover (' + latest.month + ')'
    };
  }

  /** Aggregate every room's daily rows once. */
  function _dailyRollup() {
    var lossTime = 0, ot = 0, accidents = 0;
    var rework = 0, produced = 0;
    var presentHC = 0, plannedHC = 0;
    var any = false, anyRework = false;

    CONFIG.ROOMS.forEach(function (room) {
      var d = DashboardService.readDailyRoom(room.id);
      d.rows.forEach(function (r) {
        any = true;
        if (r.lossTime)  lossTime  += r.lossTime;
        if (r.ot)        ot        += r.ot;
        if (r.accidents) accidents += r.accidents;
        if (r.rework)  { rework += r.rework; anyRework = true; }
        if (r.actual)    produced  += r.actual;
        if (r.actualHC)  presentHC += r.actualHC;
        if (r.plannedHC) plannedHC += r.plannedHC;
      });
    });

    if (!any) {
      return { lossTime: null, ot: null, accidents: null,
               reworkPct: null, attendancePct: null };
    }

    var attPct = Util_.div(presentHC, plannedHC);

    return {
      lossTime:  lossTime,
      ot:        Util_.round(ot, 1),
      accidents: accidents,
      reworkPct: anyRework ? Util_.round(Util_.div(rework, produced) * 100, 2) : null,
      attendancePct: attPct === null ? null : Util_.round(attPct * 100, 1)
    };
  }

  return { read: read };
})();

// ==============================================================================
//                                    ROUTING
// ==============================================================================

// ------------------------------------------------------------------------------
// ROUTER  (was Router.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * Router.gs — REST dispatch
 * ============================================================
 * Apps Script exposes ONE url. Paths ride in a query param:
 *     GET  /exec?path=/attendance&year=2026
 *     POST /exec   {"path":"/settings","token":"…","targets":{…}}
 *
 * Each route declares: methods, auth, param spec, cache TTL, handler.
 * Adding an endpoint = adding a table entry. The router handles
 * validation, auth, caching, logging and the envelope uniformly, so
 * a handler can't forget one.
 *
 * ── CACHING RULE ──
 * Only GETs are cached, and the key includes the resolved params.
 * ?year=2026 and ?year=2025 must never share a cache entry.
 * Any successful write invalidates the affected read caches.
 * ============================================================
 */

var Router_ = (function () {

  var MODULE = 'Router';

  // ---- Shared param specs --------------------------------
  var PAGING = {
    limit:  { type: 'int', min: 1, max: CONFIG.API.pagination.maxLimit },
    offset: { type: 'int', min: 0 }
  };

  function _withPaging(spec) {
    var out = {};
    Object.keys(spec || {}).forEach(function (k) { out[k] = spec[k]; });
    Object.keys(PAGING).forEach(function (k) { out[k] = PAGING[k]; });
    return out;
  }

  // ---- Route table ---------------------------------------
  var ROUTES = {

    '/dashboard': {
      methods: ['GET'],
      auth:    'read',
      params:  {
        nocache: { type: 'bool' },
        // MULTI-MONTH (req 7/8): the composite endpoint now accepts the month
        // the dashboard is displaying. It deliberately still returns ALL
        // monthly rows — trend charts need the full series, and 12 rows per
        // domain is cheap — but the "current" snapshots are resolved to the
        // requested month instead of the sheet's fixed current-month cells.
        month:   { type: 'month' },
        // PHASE 1: accepted so the client may send it alongside `month`
        // without being rejected. Detail resolution keys off the same value.
        reportMonth: { type: 'month' }
      },
      handler: function (ctx) {
        // Delegates to the Phase 1 builder. This is the ONE endpoint
        // whose shape is frozen — the deployed HTML reads it directly.
        return _buildFullPayload(ctx.raw, ctx.params.month || ctx.params.reportMonth);
      }
    },

    '/summary': {
      methods: ['GET'],
      auth:    'read',
      params:  {},
      handler: function () { return SummaryService.read(); }
    },

    '/attendance': {
      methods: ['GET'],
      auth:    'read',
      params:  _withPaging({
        view:  { type: 'enum', values: ['monthly', 'daily'], default: 'monthly' },
        month: { type: 'month' }
      }),
      handler: function (ctx) {
        if (ctx.params.view === 'daily') {
          var daily = AttendanceService.readDaily();
          var page  = Response_.paginate(daily.days, ctx.params);
          ctx.meta.pagination = page.meta;
          return { view: 'daily', days: page.items };
        }
        var m = AttendanceService.readMonthly();
        var months = m.months;
        if (ctx.params.month) {
          var want = CONFIG.MONTHS_EN[ctx.params.month.monthIdx];
          months = months.filter(function (x) { return x.month === want; });
        }
        return { view: 'monthly', months: months };
      }
    },

    '/efficiency': {
      methods: ['GET'],
      auth:    'read',
      params:  {
        room: { type: 'enum', values: ['assembly', 'prepare', 'overall'] }
      },
      handler: function (ctx) {
        var all = EfficiencyService.read();
        if (ctx.params.room) {
          var block = all[ctx.params.room] || [];
          return { room: ctx.params.room, months: block };
        }
        return all;
      }
    },

    '/quality': {
      methods: ['GET'],
      auth:    'read',
      // PHASE 1: `month` keeps the legacy monthly-row filter; `reportMonth` is
      // the multi-month detail selector. Both accepted; reportMonth wins when
      // present because it is the one that drives the Pareto/Top-3/4M widgets.
      params:  { month: { type: 'month' }, reportMonth: { type: 'month' } },
      handler: function (ctx) {
        var q = QualityService.read();
        var sel = ctx.params.reportMonth || ctx.params.month;

        // Multi-month detail: when the requested month is archived, serve its
        // detail from Quality History so every detail widget follows the
        // selector. Trend rows (q.months) always stay whole.
        if (sel) {
          var key = Util_.monthKey(Util_.monthLabelTh(sel.monthIdx, sel.year));
          var arch = QualityHistoryService.readMonthAsDetail(key);
          if (arch) {
            return {
              months:  q.months,
              current: arch.current,
              detail:  arch.detail,
              source:  'qualityHistory',
              reportMonth: key
            };
          }
          // Not archived — fall back to the sheet's own single-month detail,
          // still filtering the trend rows to the requested month.
          var want = CONFIG.MONTHS_EN[sel.monthIdx];
          return {
            months:  q.months.filter(function (x) { return x.month === want; }),
            current: q.current,
            detail:  q.detail,
            source:  'qualitySheet',
            reportMonth: key
          };
        }
        return q;
      }
    },

    '/repair': {
      methods: ['GET'],
      auth:    'read',
      params:  { month: { type: 'month' } },
      handler: function (ctx) {
        // ANALYSIS §6 — this sheet had no reader at all in v4, while
        // the dashboard showed invented NG_COST_RATE demo figures.
        var r = RepairService.read();
        // MULTI-MONTH (req 7): filter to the requested month when named.
        if (ctx.params.month && r && r.months) {
          var k = Util_.monthKey(Util_.monthLabelTh(
            ctx.params.month.monthIdx, ctx.params.month.year));
          r.months = r.months.filter(function (m) { return m.monthKey === k; });
        }
        return r;
      }
    },

    '/training': {
      methods: ['GET'],
      auth:    'read',
      params:  _withPaging({
        status: { type: 'string', maxLength: 8 }
      }),
      handler: function (ctx) {
        var t = TrainingService.read();
        var courses = t.courses;
        if (ctx.params.status) {
          courses = courses.filter(function (c) {
            return c.status === ctx.params.status;
          });
        }
        var page = Response_.paginate(courses, ctx.params);
        ctx.meta.pagination = page.meta;
        return { courses: page.items, summary: t.summary };
      }
    },

    '/skill': {
      methods: ['GET'],
      auth:    'read',
      params:  { room: { type: 'room' } },
      handler: function (ctx) {
        var rooms = ctx.params.room
          ? [Util_.getRoom(ctx.params.room)]
          : CONFIG.ROOMS;

        var out = { rooms: {}, summary: SkillService.readSummary() };
        rooms.forEach(function (r) {
          out.rooms[r.id] = SkillService.readStations(r.id);
        });

        // ANALYSIS §3 A2 (schema correction) — the workbook holds
        // station-level aggregates, not a per-employee roster. This
        // endpoint serves what actually exists; it does NOT emit an
        // employees[] the caller could mistake for real people.
        out.rosterAvailable = SkillService.hasRoster();
        if (!out.rosterAvailable) {
          ctx.warn({
            code: 'SKILL_ROSTER_ABSENT',
            severity: 'high',
            message: 'Skill Matrix holds station coverage aggregates only. ' +
                     'No per-employee roster exists in this workbook.',
            ref: 'ANALYSIS §3 A2 — schema correction'
          });
        }
        return out;
      }
    },

    '/history': {
      methods: ['GET'],
      auth:    'read',
      params:  {
        room:  { type: 'room', required: true },
        month: { type: 'month' }
      },
      handler: function (ctx) {
        return HistoryService.readArchive(ctx.params.room, ctx.params.month || null);
      }
    },

    '/turnover': {
      methods: ['GET'],
      auth:    'read',
      params:  { month: { type: 'month' } },
      handler: function (ctx) {
        // ANALYSIS §3 A3 — readTurnover existed but was never called.
        // ANALYSIS §7 V6 — the sheet divides resigns by man-days.
        var t = TurnoverService.read();
        var tw = TurnoverService.basisWarning();
        if (tw) ctx.warn(tw);
        // MULTI-MONTH (req 7): filter to the requested month when named.
        if (ctx.params.month && t && t.months) {
          var k = Util_.monthKey(Util_.monthLabelTh(
            ctx.params.month.monthIdx, ctx.params.month.year));
          t.months = t.months.filter(function (m) { return m.monthKey === k; });
        }
        return t;
      }
    },

    '/settings': {
      methods: ['GET', 'POST'],
      // Reads follow the global read policy; writes always need a token.
      auth:    'read',
      params:  {},
      handler: function (ctx) {
        if (ctx.method === 'POST') {
          var targets = Validator_.targets(ctx.body.targets);
          return SettingsService.saveTargets(targets);
        }
        return SettingsService.read();
      }
    },

    '/qualityHistory': {
      methods: ['GET'],
      auth:    'read',
      params:  { month: { type: 'month' } },
      handler: function (ctx) {
        // MULTI-MONTH: without a month, return the index of archived months
        // (cheap, lets the dashboard build its selector). With one, return
        // that month's sections — or null, which the client renders as "not
        // archived" rather than falling back to another month.
        if (!ctx.params.month) {
          return { months: QualityHistoryService.listMonths(), month: null, sections: null };
        }
        var k = Util_.monthKey(Util_.monthLabelTh(
          ctx.params.month.monthIdx, ctx.params.month.year));
        var m = QualityHistoryService.readMonth(k);
        return m || { months: QualityHistoryService.listMonths(), month: k, sections: null };
      }
    },

    '/version': {
      methods: ['GET'],
      auth:    'read',
      params:  {},
      handler: function () {
        // SYNC — deliberately the cheapest endpoint in the API: two
        // ScriptProperty reads, zero sheet access, never cached. The dashboard
        // polls this on a short interval and only re-pulls /dashboard when
        // `rev` actually moves, so freshness stops being a function of the
        // refresh timer.
        return {
          rev:        Util_.Rev.get(),
          cacheNs:    String(CONFIG.CACHE.enabled),
          serverTime: new Date().toISOString()
        };
      }
    },

    '/health': {
      methods: ['GET'],
      auth:    'none',
      params:  {},
      handler: function () { return _health(); }
    },

    // Self-describing API. Saves a round-trip to a wiki that will
    // drift out of date the first time someone adds a param.
    '/routes': {
      methods: ['GET'],
      auth:    'none',
      params:  {},
      handler: function () {
        return {
          apiVersion: CONFIG.API.envelopeVersion,
          transport: {
            note: 'Apps Script exposes one URL. Paths ride in ?path= ' +
                  '(GET) or body.path (POST).',
            example: '?path=/attendance&view=monthly&limit=10'
          },
          auth: {
            reads:  CONFIG.SECURITY.requireToken ? 'token required' : 'open',
            writes: 'token always required',
            param:  CONFIG.SECURITY.tokenParam
          },
          routes: listRoutes()
        };
      }
    }
  };

  // ---- Dispatch ------------------------------------------

  /**
   * @param {string} method 'GET' | 'POST'
   * @param {Object} e Apps Script event
   */
  function dispatch(method, e) {
    var t0 = Date.now();
    Log_.resetCorrelation();

    var path = null;

    try {
      e = e || {};
      var raw = e.parameter || {};

      // --- Body (POST) ---
      var body = {};
      if (method === 'POST') {
        var text = (e.postData && e.postData.contents) || '';
        if (text.length > CONFIG.SECURITY.maxBodyBytes) {
          throw new AppError_('BODY_TOO_LARGE', 'Body exceeds limit');
        }
        if (text) {
          try {
            body = JSON.parse(text);
          } catch (pe) {
            throw new AppError_('BAD_JSON', 'Body is not valid JSON');
          }
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new AppError_('BAD_JSON', 'Body must be a JSON object');
        }
      }

      // --- Resolve path ---
      path = _resolvePath(raw, body);

      var route = ROUTES[path];
      if (!route) {
        throw new AppError_('UNKNOWN_PATH', 'No such path: ' + path,
          { available: Object.keys(ROUTES).sort() });
      }

      if (route.methods.indexOf(method) === -1) {
        throw new AppError_('METHOD_NOT_ALLOWED',
          method + ' not allowed on ' + path,
          { allowed: route.methods });
      }

      // --- Auth ---
      // Writes are always gated regardless of the route's read policy.
      var isWrite = (method === 'POST');
      if (route.auth !== 'none' || isWrite) {
        _authorize(raw, isWrite, body);
      }

      // --- Validate ---
      // POST params come from the body; GET from the query string.
      var source = isWrite ? _merge(raw, body) : raw;
      var params = Validator_.check(source, route.params, ['token', 'targets']);

      // --- Context ---
      var warnings = [];
      var ctx = {
        method: method,
        path:   path,
        raw:    raw,
        body:   body,
        params: params,
        meta:   {},
        warn:   function (w) { warnings.push(w); }
      };

      // --- Cache (GET only) ---
      var ttl = _ttlFor(path, method, raw);
      var cacheKey = null;
      var cached = false;

      if (ttl > 0) {
        cacheKey = _cacheKey(path, params);
        var hit = Util_.Cache.get(cacheKey);
        if (hit !== null) {
          Log_.debug(MODULE, 'Cache hit', { path: path });
          hit.meta = hit.meta || {};
          hit.meta.cached = true;
          Log_.info(MODULE, 'Request served (cached)', {
            path: path, method: method, ms: Date.now() - t0
          });
          return Response_.ok(hit.data, path, hit.meta);
        }
      }

      // --- Execute ---
      var data = route.handler(ctx);

      // --- Meta ---
      var meta = ctx.meta;
      meta.cached = cached;
      if (ttl > 0) meta.ttlSeconds = ttl;
      if (warnings.length) meta.warnings = warnings;

      if (cacheKey) {
        Util_.Cache.put(cacheKey, { data: data, meta: meta }, ttl);
      }

      Log_.info(MODULE, 'Request served', {
        path: path, method: method, ms: Date.now() - t0,
        warnings: warnings.length
      });

      return Response_.ok(data, path, meta);

    } catch (err) {
      return Response_.fail(err, path);
    } finally {
      Log_.flush();
    }
  }

  /**
   * Resolve the path. Precedence:
   *   1. explicit ?path= / body.path
   *   2. ?action= (Phase 1 compat) mapped through legacyActionMap
   *   3. default
   *
   * The frozen HTML sends ?action=all and nothing else, so it lands on
   * /dashboard and keeps working untouched.
   */
  function _resolvePath(raw, body) {
    var p = raw[CONFIG.API.pathParam] || (body && body.path);

    if (!p && raw.action) {
      var mapped = CONFIG.API.legacyActionMap[raw.action];
      if (!mapped) {
        throw new AppError_('UNKNOWN_ACTION', 'No such action: ' + raw.action,
          { available: Object.keys(CONFIG.API.legacyActionMap) });
      }
      Log_.debug(MODULE, 'Legacy action mapped', { action: raw.action, path: mapped });
      return mapped;
    }
    if (!p && body && body.action) {
      // Phase 1 write actions kept working via the compat shim in API.gs.
      return '/_legacyPost';
    }
    if (!p) return CONFIG.API.defaultPath;

    p = String(p).trim();
    if (p.charAt(0) !== '/') p = '/' + p;
    return p.toLowerCase();
  }

  function _ttlFor(path, method, raw) {
    if (method !== 'GET') return 0;
    if (!CONFIG.CACHE.enabled) return 0;
    if (String(raw.nocache || '') === '1' || String(raw.nocache || '') === 'true') return 0;
    var t = CONFIG.API.ttl[path];
    return (t === undefined) ? 0 : t;
  }

  /**
   * Cache key includes the resolved params — ?year=2026 and ?year=2025
   * must not collide. Keys are sorted for stability.
   */
  function _cacheKey(path, params) {
    var parts = Object.keys(params).sort().map(function (k) {
      var v = params[k];
      if (v && typeof v === 'object' && v.monthIdx !== undefined) {
        v = v.monthIdx + '-' + v.year;
      }
      return k + '=' + v;
    });
    return 'rest_' + path.replace(/\//g, '_') +
           (parts.length ? '_' + parts.join('&') : '');
  }

  function _merge(a, b) {
    var out = {};
    Object.keys(a || {}).forEach(function (k) { out[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) {
      if (k === 'path' || k === 'targets') return;   // structural, not params
      out[k] = b[k];
    });
    return out;
  }

  function listRoutes() {
    return Object.keys(ROUTES).sort().map(function (p) {
      return {
        path:    p,
        methods: ROUTES[p].methods,
        auth:    ROUTES[p].auth,
        ttl:     CONFIG.API.ttl[p] || 0,
        params:  Object.keys(ROUTES[p].params || {})
      };
    });
  }

  return {
    dispatch:   dispatch,
    // listRoutes() is the supported introspection API (and what /routes
    // serves). The raw ROUTES table was exported with zero callers —
    // handing out a mutable dispatch table is a footgun. Removed (AUDIT).
    listRoutes: listRoutes
  };
})();

// ==============================================================================
//                                  ENTRY POINTS
// ==============================================================================

// ------------------------------------------------------------------------------
// API  (was API.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * API.gs — Entry points
 * ============================================================
 * doGet  — dashboard sync (read)
 * doPost — target writes (write)  ← ANALYSIS §3 A4: v4 HAD NO doPost.
 *          pushTargetsToSheet() has been POSTing into a void this
 *          whole time. Target edits never persisted.
 * onOpen — spreadsheet menu
 * onEdit — month-selector auto-refresh
 *
 * ── WIRE CONTRACT (FROZEN) ────────────────────────────────
 * The HTML is not changing in Phase 1, so doGet MUST return
 * exactly the keys applyGsheetData reads:
 *
 *   prepare, assembly            → {rows:[...]}
 *   skillPrepare, skillAssembly  → {stations:[], employees:[]}
 *   trainingPlan                 → {courses:[], summary:{}}
 *   productionEfficiency         → {assembly:[], prepare:[], overall:[]}
 *   attendance                   → {months:[]}
 *   quality                      → {months:[], current:{}}
 *   otHistory                    → {months:[]}
 *   targets                      → {efficiency:95, ...}  ← WHOLE NUMBERS
 *   fetchedAt                    → ISO string
 *
 * New keys (turnover, repairMaterial, _meta) are ADDITIVE. The
 * frozen HTML ignores unknown keys, so they're safe to ship now
 * and wire up in Phase 2.
 * ============================================================
 */

// ============================================================
// doGet — READ
// ============================================================

/**
 * GET entry point. All routing, auth, validation, caching and
 * enveloping live in Router_ — this is a delegate on purpose, so
 * there is exactly one request pipeline to reason about.
 *
 * BACKWARD COMPATIBILITY: the deployed HTML calls `?action=all` and
 * reads `json.data.prepare` etc. Router_ maps action=all → /dashboard,
 * and the Phase 2 envelope keeps `ok` and `data` at the same depth,
 * so applyGsheetData(json.data) is unaffected. The added envelope
 * fields (apiVersion, path, requestId, meta) are ignored by it.
 */
function doGet(e) {
  return Router_.dispatch('GET', e);
}

/**
 * Assemble the full sync payload.
 * Each section is independently guarded: one broken sheet degrades
 * that section to empty and records a warning, rather than 500-ing
 * the whole dashboard.
 */
function _buildFullPayload(params, selMonth) {
  if (!selMonth) {
    try { selMonth = HistoryService.readDailyMonth(CONFIG.ROOMS[0].id); } catch (e) { /* report unavailable sections below */ }
  }
  var noCache = String(params.nocache || '') === '1';
  if (noCache) {
    Log_.info('API', 'Cache bypass requested');
    Util_.Cache.invalidateAll();
  }

  // MULTI-MONTH: canonical 'YYYY-MM' for the month the caller asked for, or
  // null to keep the pre-existing behaviour (sheet's own current-month cells).
  var selKey = selMonth ? Util_.monthKey(
    Util_.monthLabelTh(selMonth.monthIdx, selMonth.year)) : null;

  var warnings = [];
  var degraded = [];

  /**
   * Run a section, isolating its failures.
   *
   * QA FIX: this used to record `degraded` only when a section THREW.
   * But every service calls getSheet(key, false), which returns null and
   * lets the service return an empty result gracefully — so a deleted or
   * renamed sheet produced an empty dashboard that reported itself
   * perfectly healthy. `degraded` was empty with all 15 sheets missing.
   *
   * `sheetKey` (optional) lets a section declare which sheet it needs, so
   * a missing sheet is reported as degraded even when nothing throws.
   */
  function section(name, fn, fallback, sheetKey) {
    if (sheetKey) {
      var sh = null;
      try { sh = Util_.getSheet(sheetKey, false); } catch (e) { /* fall through */ }
      if (!sh) {
        Log_.warn('API', 'Section sheet missing', { section: name, sheet: sheetKey });
        degraded.push(name);
        warnings.push({
          code: 'SHEET_MISSING',
          severity: 'high',
          message: 'Sheet "' + (CONFIG.SHEETS[sheetKey] ? CONFIG.SHEETS[sheetKey].name : sheetKey) +
                   '" not found — section "' + name + '" is empty.',
          section: name
        });
        return fallback;
      }
    }
    try {
      return fn();
    } catch (err) {
      Log_.error('API', 'Section failed: ' + name, {
        code: err.code || 'UNKNOWN', msg: err.message
      });
      degraded.push(name);
      warnings.push({
        code: 'SECTION_UNAVAILABLE',
        severity: 'high',
        message: 'Section "' + name + '" could not be read: ' + (err.code || 'error'),
        section: name
      });
      return fallback;
    }
  }

  var out = {};

  // Merge legacy History (Prepare/Assembly) snapshots into the additive wire key.
  out.productionDailyHistory = {};
  CONFIG.ROOMS.forEach(function(room){
    var snapshots = section('history_' + room.id, function(){
      return HistoryService.readDailySnapshots(room.id);
    }, {});
    Object.keys(snapshots).forEach(function(key){
      if (!out.productionDailyHistory[key]) out.productionDailyHistory[key] = {};
      out.productionDailyHistory[key][room.id] = snapshots[key];
    });
    out[room.id] = section('daily_' + room.id, function(){
      if (selKey) {
        // Keep the existing imported-archive priority, then consult the legacy sheets.
        var arch = ProductionHistoryService.readMonthRoom(selKey,room.id);
        if (arch && arch.rows && arch.rows.length) {
          if (!out.productionDailyHistory[selKey]) out.productionDailyHistory[selKey] = {};
          out.productionDailyHistory[selKey][room.id] = arch;
          return arch;
        }
        if (snapshots[selKey]) return snapshots[selKey];
        var liveMonth = null;
        try { liveMonth = HistoryService.readDailyMonth(room.id); } catch(e) { /* no matching live source */ }
        if (!liveMonth || liveMonth.year !== selMonth.year || liveMonth.monthIdx !== selMonth.monthIdx) {
          warnings.push({code:'PRODUCTION_MONTH_MISSING',severity:'high',section:'daily_'+room.id,
            message:'No daily production data for '+room.id+' in '+selKey});
          return {rows:[],monthKey:selKey,room:room.id,source:'missing'};
        }
      }
      var live = DashboardService.readDailyRoom(room.id);
      live.monthKey = selKey;
      live.source = 'daily';
      return live;
    }, {rows:[]});
  });

  // --- Skill Matrix (frozen keys: skillPrepare / skillAssembly) ---
  // ANALYSIS §3 A2: these used to point at sheets that don't exist.
  // Phase 1 finding: the real sheet is station-per-row aggregates with
  // no employee roster, so `employees` is legitimately empty. See
  // SkillService's header for why we don't synthesize one.
  CONFIG.ROOMS.forEach(function (room) {
    var wireKey = 'skill' + room.id.charAt(0).toUpperCase() + room.id.slice(1);
    out[wireKey] = section('skill_' + room.id, function () {
      return SkillService.readRoom(room.id);
    }, { stations: [], employees: [] }, 'skill');
  });

  // --- Real station coverage (additive; Phase 2 renders this) ---
  out.skillStations = section('skillStations', function () {
    var byRoom = {};
    CONFIG.ROOMS.forEach(function (room) {
      byRoom[room.id] = SkillService.readStations(room.id);
    });
    byRoom.summary = SkillService.readSummary();
    return byRoom;
  }, {});

  out.trainingPlan = section('training', function () {
    return TrainingService.read();
  }, { courses: [], summary: {} }, 'training');

  out.productionEfficiency = section('efficiency', function () {
    return EfficiencyService.read();
  }, { assembly: [], prepare: [], overall: [] }, 'efficiency');

  out.attendance = section('attendance', function () {
    return AttendanceService.readMonthly();
  }, { months: [] }, 'attendance');

  out.quality = section('quality', function () {
    var q = QualityService.read();

    // PHASE 1 — when the selected month is archived in Quality History, swap
    // the detail blocks (Pareto/Top-3/4M/rooms/customers/materials) AND the
    // KPI snapshot for that month's archived data. The sheet only ever holds
    // one month of detail, so without this the detail widgets showed the last
    // hand-entered month while the KPI strip followed the selector — the
    // split-dataset bug. Trend rows (q.months) stay whole for the charts.
    if (selKey) {
      var arch = QualityHistoryService.readMonthAsDetail(selKey);
      if (arch) {
        q.current = arch.current;
        q.detail  = arch.detail;
        q.source  = 'qualityHistory';
        return q;
      }
    }

    // MULTI-MONTH (req 10) — no archived detail for this month: resolve the
    // KPI snapshot from the monthly trend row so the cards still follow the
    // selector, and leave the sheet's single-month detail in place.
    if (selKey && q && q.months && q.months.length) {
      for (var i = 0; i < q.months.length; i++) {
        if (q.months[i].monthKey === selKey) {
          var m = q.months[i];
          q.current = {
            produced:     m.produced,
            ngPcs:        m.ngPcs,
            ngRate:       m.ngRate,
            materialLoss: m.materialLoss !== undefined ? m.materialLoss : q.current.materialLoss,
            lossTime:     m.lossTime     !== undefined ? m.lossTime     : q.current.lossTime,
            monthKey:     selKey,
            resolvedFrom: 'month'
          };
          break;
        }
      }
    }
    return q;
  }, { months: [], current: {} }, 'quality');

  out.otHistory = section('otHistory', function () {
    return HistoryService.readOtHistory();
  }, { months: [] }, 'otHistory');

  out.targets = section('targets', function () {
    return DashboardService.readTargets();
  }, CONFIG.KPI.defaults, 'settings');

  // --- Factory schedule (Phase 3; additive) ---
  // Header/sidebar shift, break and OT times. `configured:false` means
  // the rows aren't in Dashboard Settings yet — the client keeps its own
  // defaults rather than rendering blanks.
  out.schedule = section('schedule', function () {
    return SettingsService.readSchedule();
  }, { configured: false, breaks: [] });

  // --- Additive (ignored by frozen HTML; Phase 2 consumes) ---
  // ANALYSIS §3 A3 / §6: turnover was dead code, repair had no reader.
  out.turnover = section('turnover', function () {
    return TurnoverService.read();
  }, { months: [] }, 'turnover');

  out.repairMaterial = section('repair', function () {
    return RepairService.read();
  }, { months: [], totals: {}, target: null }, 'repair');

  out.fetchedAt = new Date().toISOString();

  // --- Validation ---
  var vw = section('validation', function () {
    return DashboardService.validate(out);
  }, []);
  warnings = warnings.concat(vw || []);

  // ANALYSIS §4 U4 — v4 set usingDemoData=false on ANY successful
  // sync, so the badge read "Connected ✅" while Skill/NG/Repair
  // showed demo numbers. Per-section liveness is now explicit.
  var sections = {};
  CONFIG.ROOMS.forEach(function (room) {
    sections['daily_' + room.id] = _liveness(out[room.id] && out[room.id].rows);

    // Skill is NOT simply 'empty' — the roster the HTML wants does not
    // exist in this workbook. Distinguish "sheet unreadable" from
    // "sheet read fine, schema doesn't carry this".
    var wk = 'skill' + room.id.charAt(0).toUpperCase() + room.id.slice(1);
    var stationsLive = out.skillStations && out.skillStations[room.id] &&
                       out.skillStations[room.id].stations &&
                       out.skillStations[room.id].stations.length;
    sections[wk] = stationsLive ? 'schema_gap' : 'empty';
    sections['skillStations_' + room.id] = stationsLive ? 'live' : 'empty';
  });

  // ANALYSIS §3 A2 follow-through: the sheet-name bug is fixed, but the
  // Skill page still shows demo data — for a different, deeper reason.
  // Say so explicitly rather than letting it read as 'connected'.
  if (!SkillService.hasRoster()) {
    var anyStations = CONFIG.ROOMS.some(function (room) {
      return out.skillStations && out.skillStations[room.id] &&
             out.skillStations[room.id].stations &&
             out.skillStations[room.id].stations.length;
    });
    if (anyStations) {
      warnings.push({
        code: 'SKILL_ROSTER_ABSENT',
        severity: 'high',
        message: 'Skill Matrix holds station-level coverage aggregates, not a ' +
                 'per-employee roster. The heatmap needs {name, levels[]} per ' +
                 'employee, which cannot be derived from aggregate counts. ' +
                 'skillPrepare/skillAssembly.employees are empty by design, so ' +
                 'the dashboard is still showing DEMO skill data. Real station ' +
                 'coverage is available on the `skillStations` key.',
        ref: 'ANALYSIS §3 A2 — schema correction'
      });
    }
  }
  sections.training      = _liveness(out.trainingPlan && out.trainingPlan.courses);
  sections.attendance    = _liveness(out.attendance && out.attendance.months);
  sections.quality       = _liveness(out.quality && out.quality.months);
  sections.otHistory     = _liveness(out.otHistory && out.otHistory.months);
  sections.turnover      = _liveness(out.turnover && out.turnover.months);
  sections.repairMaterial = _liveness(out.repairMaterial && out.repairMaterial.months);
  sections.efficiency    = _liveness(
    out.productionEfficiency && out.productionEfficiency.overall
  );

  out._meta = {
    version:   CONFIG.VERSION,
    // SYNC: data revision at build time. The client stores this and compares
    // it against /version polls to decide whether a re-fetch is needed.
    rev:       Util_.Rev.get(),
    // MULTI-MONTH: echoes the month this payload was resolved for (null when
    // the caller did not name one). The client asserts this matches its
    // selectedMonth before rendering, so a mismatch is visible instead of
    // silently showing the wrong month.
    selectedMonth: selKey,
    schemaYear: CONFIG.SCHEMA_YEAR,
    correlationId: Log_.correlationId(),
    sections:  sections,
    degraded:  degraded,
    warnings:  warnings,
    cached:    !noCache && CONFIG.CACHE.enabled,
    targetFormat: CONFIG.KPI.targetWireFormat,
    productivityBasis: CONFIG.KPI.productivityBasis,
    rooms: CONFIG.ROOMS.map(function (r) {
      return { id: r.id, labelEn: r.labelEn, labelTh: r.labelTh };
    })
  };

  return out;
}

function _liveness(arr) {
  return (arr && arr.length) ? 'live' : 'empty';
}

function _health() {
  var sheets = {};
  Object.keys(CONFIG.SHEETS).forEach(function (key) {
    var sh = null;
    try { sh = Util_.getSheet(key, false); } catch (e) { /* ignore */ }
    sheets[key] = {
      expected: CONFIG.SHEETS[key].name,
      found:    !!sh,
      actual:   sh ? sh.getName() : null
    };
  });
  return {
    ok:      true,
    version: CONFIG.VERSION,
    time:    new Date().toISOString(),
    sheets:  sheets,
    rooms:   CONFIG.ROOMS.map(function (r) { return r.id; })
  };
}

// ============================================================
// doPost — WRITE
// ============================================================

/**
 * ANALYSIS §3 A4 — this endpoint did not exist. The dashboard's
 * pushTargetsToSheet() POSTed {action:'saveTargets'} and got a 404.
 *
 * ANALYSIS §9 S4 — the HTML deliberately sends Content-Type
 * text/plain to dodge the CORS preflight. That means ANY site the
 * user visits can fire this request with their session. Writes
 * therefore ALWAYS require a token, regardless of the read setting.
 * Until the HTML is updated (Phase 2), target writes will reject —
 * which is strictly better than the silent failure they do today.
 */
function doPost(e) {
  // Phase 1 clients POST {action:'…'} with no `path`. Those actions
  // are write operations with no REST equivalent yet (month archiving,
  // OT archiving), so they keep their own dispatch rather than being
  // dropped. A body carrying `path` goes to the router.
  var body = _peekBody(e);
  if (body && body.action && !body.path) {
    return _legacyPost(e, body);
  }
  return Router_.dispatch('POST', e);
}

/** Parse the body without throwing; router re-parses and reports properly. */
function _peekBody(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (!raw || raw.length > CONFIG.SECURITY.maxBodyBytes) return null;
    var b = JSON.parse(raw);
    return (b && typeof b === 'object' && !Array.isArray(b)) ? b : null;
  } catch (err) {
    return null;
  }
}

/**
 * Phase 1 action-style writes, preserved verbatim.
 *
 * ANALYSIS §9 S4 — the HTML sends Content-Type: text/plain expressly
 * to dodge the CORS preflight (its own comment says so). That means
 * any site the user visits can fire this request with their session,
 * so writes ALWAYS require a token no matter the read policy.
 */
function _legacyPost(e, body) {
  var t0 = Date.now();
  Log_.resetCorrelation();

  var action = body.action;
  var path   = '/_legacy/' + action;

  try {
    var params = (e && e.parameter) || {};
    _authorize(params, true, body);

    var result;
    switch (action) {
      case 'saveTargets':
        result = SettingsService.saveTargets(Validator_.targets(body.targets));
        break;

      // MULTI-MONTH (req 1/2/3) — upsert one month of NG detail.
      // Replaces ONLY the rows whose Month equals body.month; every other
      // month is copied through untouched. Importing July can therefore never
      // affect June or August.
      case 'saveQualityMonth':
        if (!body.month) {
          throw new AppError_('BAD_INPUT', 'saveQualityMonth requires {month:"YYYY-MM"}');
        }
        if (!Array.isArray(body.rows)) {
          throw new AppError_('BAD_INPUT', 'saveQualityMonth requires {rows:[...]}');
        }
        result = QualityHistoryService.saveMonth(String(body.month), body.rows);
        _invalidateAfterWrite(['qualityHistory', 'quality', 'dashboard']);
        break;

      // PHASE 2A (req 2) — upsert one month of raw daily Production rows for
      // one room. Replaces ONLY that (month, room); every other month and the
      // other room are copied through untouched.
      case 'saveProductionMonth':
        if (!body.month) {
          throw new AppError_('BAD_INPUT', 'saveProductionMonth requires {month:"YYYY-MM"}');
        }
        if (body.room !== 'prepare' && body.room !== 'assembly') {
          throw new AppError_('BAD_INPUT', 'saveProductionMonth requires {room:"prepare"|"assembly"}');
        }
        if (!Array.isArray(body.rows)) {
          throw new AppError_('BAD_INPUT', 'saveProductionMonth requires {rows:[...]}');
        }
        result = ProductionHistoryService.saveMonthRoom(
          String(body.month), body.room, body.rows);
        _invalidateAfterWrite(['productionHistory', 'dashboard']);
        break;

      case 'saveAttendanceMonth':
        // Month is optional here, matching saveHistoryMonth/archiveOT: when the
        // caller omits it we derive the current month from the Daily sheet (the
        // same source menu_saveAttendance uses), so the dashboard can POST this
        // action without guessing a month string client-side.
        result = AttendanceService.saveMonth(
          body.month ? _requireMonth(body)
                     : HistoryService.readDailyMonth(CONFIG.ROOMS[0].id),
          body.dryRun === true);
        _invalidateAfterWrite(['attendance']);
        break;

      case 'saveHistoryMonth':
        result = HistoryService.saveMonth(
          _requireRoom(body), body.month ? _requireMonth(body) : null);
        _invalidateAfterWrite(['history', 'dashboard']);
        break;

      case 'archiveOT':
        result = HistoryService.archiveOT(body.month ? _requireMonth(body) : null);
        _invalidateAfterWrite(['dashboard']);
        break;

      default:
        throw new AppError_('UNKNOWN_ACTION', 'No such action: ' + action,
          { available: ['saveTargets', 'saveAttendanceMonth',
                        'saveHistoryMonth', 'archiveOT', 'saveQualityMonth',
                        'saveProductionMonth'] });
    }

    Log_.info('API', 'Legacy POST ok', { action: action, ms: Date.now() - t0 });
    return Response_.ok(result, path, { legacy: true });

  } catch (err) {
    return Response_.fail(err, path);
  } finally {
    Log_.flush();
  }
}

/** Drop REST caches touched by a write. */
function _invalidateAfterWrite(domains) {
  domains.forEach(function (d) {
    Util_.Cache.remove('rest__' + d);
    Util_.Cache.remove(d);
  });
  Util_.Cache.remove('rest__summary');
  Util_.Cache.remove('rest__dashboard');
  // MULTI-MONTH: composite responses are now cached per month
  // ('rest__dashboard_month=5-2026'), so removing the bare key is no longer
  // sufficient. API writes are infrequent (a handful per day), so bumping the
  // cache namespace here is cheap and makes invalidation complete regardless
  // of how many month variants are cached.
  Util_.Cache.invalidateAll();
  // SYNC: tell every connected dashboard that a re-fetch is worthwhile.
  Util_.Rev.bump();
  Log_.debug('API', 'Post-write cache invalidation', { domains: domains });
}

function _requireMonth(body) {
  var m = Util_.parseMonth(body.month);
  if (!m) throw new AppError_('BAD_MONTH', 'Invalid or missing month: ' + body.month);
  return m;
}

function _requireRoom(body) {
  var id = String(body.room || '');
  Util_.getRoom(id);   // throws if unknown
  return id;
}

// ============================================================
// SECURITY
// ============================================================

/**
 * ANALYSIS §9 S2 — v4's doGet had no authentication whatsoever.
 * The /exec URL was the only credential, and it sits in plaintext
 * localStorage. Anyone with it reads headcount, resignations, and
 * per-person attendance — PDPA-relevant personal data (§9 S3).
 *
 * Phase 1 posture:
 *   - Writes ALWAYS require a token. Non-negotiable.
 *   - Reads require one only if CONFIG.SECURITY.requireToken AND an
 *     API_TOKEN is actually set. Ships requireToken=true, but with
 *     no token installed the reads stay open so the frozen HTML
 *     keeps working. Install the token in Phase 2 with the HTML change.
 *
 * Comparison is constant-time to avoid a timing oracle.
 */
function _authorize(params, isWrite, body) {
  var props  = null;
  var stored = null;
  try {
    props  = PropertiesService.getScriptProperties();
    stored = props.getProperty(CONFIG.PROP_KEYS.apiToken);
  } catch (e) {
    Log_.error('API', 'Cannot read script properties', { err: String(e) });
  }

  if (isWrite) {
    // No token installed => the server cannot authenticate anyone, so
    // writes are impossible. 403, not 401: nothing the caller sends
    // would work.
    if (!stored) {
      throw new AppError_('NOT_CONFIGURED',
        'API_TOKEN is not set. Writes are disabled until Utility_installConfig() runs.');
    }
  } else {
    // Reads are gated ONLY by the explicit switch. Whether a token
    // happens to be installed is irrelevant — conflating the two is
    // what made installing a token silently 401 the dashboard.
    var requireRead = CONFIG.SECURITY.requireToken;
    try {
      if (props) {
        var override = props.getProperty('REQUIRE_READ_TOKEN');
        if (override !== null && override !== undefined && override !== '') {
          requireRead = String(override).toLowerCase() === 'true';
        }
      }
    } catch (e) { /* fall back to CONFIG */ }

    if (!requireRead) return;

    if (!stored) {
      // Misconfiguration: reads are gated but nothing can satisfy the
      // gate. Failing closed would take the dashboard down for a
      // config mistake, so allow and shout.
      Log_.warn('API', 'REQUIRE_READ_TOKEN is on but no API_TOKEN installed — allowing read');
      return;
    }
  }

  var supplied = params[CONFIG.SECURITY.tokenParam] ||
                 (body && body[CONFIG.SECURITY.tokenParam]) || '';

  if (!_constantTimeEquals(String(supplied), String(stored))) {
    Log_.warn('API', 'Rejected: bad token', { write: !!isWrite });
    throw new AppError_('UNAUTHORIZED', 'Invalid or missing token');
  }
}

function _constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  }
  return diff === 0;
}

// ============================================================
// SPREADSHEET UI
// ============================================================

function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();

    var daily = ui.createMenu('📋 Daily Record Tools');
    CONFIG.ROOMS.forEach(function (room) {
      daily.addItem('💾 บันทึกเดือนนี้ → History (' + room.labelEn + ')',
                    'menu_saveMonth_' + room.id);
    });
    daily.addSeparator();
    daily.addItem('💾 บันทึกทั้งสองห้องพร้อมกัน', 'menu_saveMonthAll');
    daily.addSeparator();
    daily.addItem('💾 บันทึก Attendance เดือนนี้', 'menu_saveAttendance');
    daily.addSeparator();
    CONFIG.ROOMS.forEach(function (room) {
      daily.addItem('🔄 แสดงข้อมูลเดือนที่เลือก (' + room.labelEn + ')',
                    'menu_showMonth_' + room.id);
    });
    daily.addToUi();

    ui.createMenu('⏱ OT Tools')
      .addItem('💾 บันทึก OT เดือนนี้ → OT Monthly History', 'menu_archiveOT')
      .addToUi();

    ui.createMenu('🔧 Admin')
      .addItem('⚙️ Install / rotate config', 'Utility_installConfig')
      .addItem('📊 Create Quality History sheet', 'Utility_installQualityHistory')
      .addItem('🏭 Create Production History sheet', 'Utility_installProductionHistory')
      .addItem('🩺 Run diagnostics',          'Utility_diagnostics')
      .addItem('🧹 Clear cache',              'Utility_clearCache')
      .addItem('📋 List sheets',              'Utility_listSheets')
      .addSeparator()
      .addItem('🌐 Test REST endpoints',      'Utility_testRoutes')
      .addToUi();

  } catch (e) {
    console.log('onOpen failed: ' + e);
  }
}

/**
 * ANALYSIS §3 A10 — v4's onEdit had no `e` guard and no try/catch,
 * and called ui.alert() from inside a simple trigger.
 * Simple triggers get a restricted auth scope; this one stays silent
 * and defensive.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();

    // SYNC FIX: a direct edit in the workbook used to leave every cached
    // payload untouched, so the dashboard kept serving pre-edit numbers until
    // the TTL lapsed. Drop the caches that depend on the edited sheet (cheap
    // CacheService removes — no namespace bump, so typing many cells does not
    // hammer PropertiesService).
    _invalidateForSheet(sheet);

    if (e.range.getA1Notation() !== CONFIG.LAYOUT.history.monthSelector) return;

    var name = Util_.normalizeName(sheet.getName());
    for (var i = 0; i < CONFIG.ROOMS.length; i++) {
      var room = CONFIG.ROOMS[i];
      var want = Util_.normalizeName(CONFIG.SHEETS[room.histSheet].name);
      if (name === want) {
        HistoryService.showSelectedMonth(room.id);
        return;
      }
    }
  } catch (err) {
    console.log('onEdit failed: ' + err);
  }
}

/**
 * Map an edited sheet to the cache entries built from it and drop them.
 * Unknown sheets fall through to dropping only the composite payloads, which
 * is still correct — those are rebuilt from every sheet.
 */
function _invalidateForSheet(sheet) {
  try {
    if (!sheet) return;
    var edited = Util_.normalizeName(sheet.getName());
    var S      = CONFIG.SHEETS;

    function is(key) {
      return S[key] && Util_.normalizeName(S[key].name) === edited;
    }

    var names = [];
    CONFIG.ROOMS.forEach(function (room) {
      if (is(room.dailySheet)) names.push('daily_' + room.id);
      if (is(room.histSheet))  names.push('daily_' + room.id);
      if (is('skill'))         names.push('skillstations_' + room.id);
    });
    if (is('attendance')) names.push('attendance_monthly', 'attendance_daily');
    if (is('efficiency')) names.push('efficiency');
    if (is('quality'))    names.push('quality');
    if (is('repair'))     names.push('repair');
    if (is('training'))   names.push('training');
    if (is('turnover'))   names.push('turnover');
    if (is('otHistory'))  names.push('otHistory');
    if (is('skill'))      names.push('skill_summary');
    if (is('settings'))   names.push('targets', 'schedule');

    names.forEach(function (n) { Util_.Cache.remove(n); });

    // Composite payloads are assembled from every sheet, so any edit
    // invalidates them.
    Util_.Cache.remove('rest__dashboard');
    Util_.Cache.remove('rest__summary');

    // SYNC: bump the revision so connected dashboards re-fetch on their next
    // /version poll instead of waiting out the refresh timer. The internal log
    // sheet is excluded — it changes constantly and never affects the payload.
    if (!is('log')) Util_.Rev.bump();
  } catch (err) {
    /* cache invalidation must never break an edit */
  }
}

// ---- Menu handlers (thin wrappers; UI lives here, logic doesn't) ----

function menu_saveMonthAll() {
  _withUi(function (ui) {
    var month = HistoryService.readDailyMonth(CONFIG.ROOMS[0].id);
    var label = Util_.monthLabelTh(month.monthIdx, month.year);

    var resp = ui.alert('💾 บันทึกทุกห้อง',
      'จะบันทึก "' + label + '" ลง History ทุกห้อง\n\n' +
      '⚠️ ถ้าเคยบันทึกเดือนนี้แล้ว จะถูกเขียนทับ\n\nยืนยันหรือไม่?',
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;

    var done = [];
    CONFIG.ROOMS.forEach(function (room) {
      HistoryService.saveMonth(room.id, month);
      done.push(room.labelEn);
    });
    ui.alert('✅ บันทึกสำเร็จ: ' + done.join(', ') + ' (' + label + ')');
  });
}

function menu_saveAttendance() {
  _withUi(function (ui) {
    var month = HistoryService.readDailyMonth(CONFIG.ROOMS[0].id);
    var preview = AttendanceService.saveMonth(month, true);   // dry run

    var resp = ui.alert('💾 บันทึก Attendance ' + preview.month,
      'Work Days: ' + preview.workDays + ' วัน\n' +
      'Total: '     + preview.total   + ' man-days\n' +
      'Present: '   + preview.present + ' man-days\n' +
      'Attendance: ' + (preview.pct === null ? '-' :
                        (preview.pct * 100).toFixed(1) + '%') +
      '\n\nบันทึกหรือไม่?',
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;

    AttendanceService.saveMonth(month, false);
    ui.alert('✅ บันทึก Attendance ' + preview.month + ' สำเร็จ!');
  });
}

function menu_archiveOT() {
  _withUi(function (ui) {
    var month = HistoryService.readDailyMonth(CONFIG.ROOMS[0].id);
    var label = Util_.monthLabelTh(month.monthIdx, month.year);

    var lines = [];
    var grand = 0;
    CONFIG.ROOMS.forEach(function (room) {
      var data = DashboardService.readDailyRoom(room.id);
      var sum  = 0;
      data.rows.forEach(function (r) { if (r.ot) sum += r.ot; });
      sum = Util_.round(sum, 1);
      grand += sum;
      lines.push(room.labelTh + ': ' + sum + ' ชม.');
    });

    var resp = ui.alert('⏱ บันทึก OT เดือน ' + label,
      lines.join('\n') + '\nรวม: ' + Util_.round(grand, 1) +
      ' ชม.\n\nบันทึกหรือไม่?',
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;

    var res = HistoryService.archiveOT(month);
    ui.alert('✅ บันทึก OT ' + res.month + ' สำเร็จ! (รวม ' + res.grand + ' ชม.)');
  });
}

/**
 * Per-room menu handlers. Apps Script menus can only call named
 * global functions, so these are generated explicitly. A third room
 * needs two more of these — the only place in v5 that isn't purely
 * CONFIG-driven, and it's a platform constraint, not a design choice.
 */
function menu_saveMonth_prepare()  { _menuSaveRoom('prepare'); }
function menu_saveMonth_assembly() { _menuSaveRoom('assembly'); }
function menu_showMonth_prepare()  { _menuShowRoom('prepare'); }
function menu_showMonth_assembly() { _menuShowRoom('assembly'); }

function _menuSaveRoom(roomId) {
  _withUi(function (ui) {
    var room  = Util_.getRoom(roomId);
    var month = HistoryService.readDailyMonth(roomId);
    var label = Util_.monthLabelTh(month.monthIdx, month.year);

    var resp = ui.alert('💾 บันทึกข้อมูล ' + room.labelTh,
      'จะบันทึกข้อมูล "' + label + '" ลง History\n\n' +
      '⚠️ ถ้าเคยบันทึกเดือนนี้แล้ว จะถูกเขียนทับ\n\nยืนยันหรือไม่?',
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;

    HistoryService.saveMonth(roomId, month);
    ui.alert('✅ บันทึก "' + label + '" สำเร็จ!\n\nดูข้อมูลได้จาก dropdown ด้านบน Sheet');
  });
}

function _menuShowRoom(roomId) {
  _withUi(function (ui) {
    var month = HistoryService.showSelectedMonth(roomId);
    ui.alert('✅ แสดงข้อมูล ' + Util_.monthLabelTh(month.monthIdx, month.year) + ' แล้ว');
  });
}

/** Menu wrapper: consistent error surfacing + guaranteed log flush. */
function _withUi(fn) {
  Log_.resetCorrelation();
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    Log_.error('API', 'No UI context');
    return;
  }
  try {
    fn(ui);
  } catch (err) {
    Log_.error('API', 'Menu action failed', {
      code: err && err.code, message: err && err.message
    });
    ui.alert('❌ ' + ((err && err.code) ? err.code + ': ' : '') +
             ((err && err.message) || String(err)));
  } finally {
    Log_.flush();
  }
}

// ==============================================================================
//                               ADMIN / OPERATIONS
// ==============================================================================

// ------------------------------------------------------------------------------
// ADMIN  (was Admin.gs)
// ------------------------------------------------------------------------------
/**
 * ============================================================
 * Admin.gs — Operator tools
 * ============================================================
 * Run these from the Apps Script editor or the 🔧 Admin menu.
 * Nothing here is reachable from doGet/doPost.
 * ============================================================
 */

/**
 * ONE-TIME SETUP. Run this before deploying.
 *
 * ANALYSIS §9 S1 — the spreadsheet ID was a source literal in v4
 * and has been disclosed. Rotating the file is a separate manual
 * step; this only moves the ID out of source.
 *
 * ANALYSIS §9 S2 — generates the API token that gates writes.
 */
function Utility_installConfig() {
  var props = PropertiesService.getScriptProperties();
  var ui    = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { /* editor context */ }

  var out = [];

  // --- Spreadsheet ID ---
  var existingId = props.getProperty(CONFIG.PROP_KEYS.spreadsheetId);
  if (!existingId) {
    var id = null;
    try { id = SpreadsheetApp.getActiveSpreadsheet().getId(); } catch (e) { /* unbound */ }
    if (id) {
      props.setProperty(CONFIG.PROP_KEYS.spreadsheetId, id);
      out.push('✅ SPREADSHEET_ID installed from the bound file.');
    } else {
      out.push('⚠️ SPREADSHEET_ID not set and no bound file. Set it manually:');
      out.push('   Project Settings → Script Properties → SPREADSHEET_ID');
    }
  } else {
    out.push('• SPREADSHEET_ID already set (leaving alone).');
  }

  // --- API token ---
  var existingToken = props.getProperty(CONFIG.PROP_KEYS.apiToken);
  if (!existingToken) {
    var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
    props.setProperty(CONFIG.PROP_KEYS.apiToken, token);
    out.push('');
    out.push('✅ API_TOKEN generated. Copy it now — it is shown once:');
    out.push('');
    out.push(token);
    out.push('');
    out.push('Writes require it immediately.');
    out.push('Reads stay open until Phase 2 updates the HTML.');
  } else {
    out.push('• API_TOKEN already set. To rotate: delete the property, re-run.');
  }

  // --- Log level ---
  if (!props.getProperty(CONFIG.PROP_KEYS.logLevel)) {
    props.setProperty(CONFIG.PROP_KEYS.logLevel, CONFIG.LOG.level);
    out.push('• LOG_LEVEL set to ' + CONFIG.LOG.level + '.');
  }

  var msg = out.join('\n');
  console.log(msg);
  if (ui) ui.alert('Install / rotate config', msg, ui.ButtonSet.OK);
  return msg;
}

/**
 * Full diagnostic sweep. Verifies every CONFIG assumption against
 * the live workbook: sheets present, headers resolvable, row blocks
 * where CONFIG says, and the §7 data findings still open.
 */
function Utility_diagnostics() {
  Log_.resetCorrelation();
  var out = [];
  var fail = 0, warn = 0;

  out.push('PRODUCTION DASHBOARD — DIAGNOSTICS');
  out.push('Version: ' + CONFIG.VERSION);
  out.push('Run: ' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'));
  out.push('');

  // --- Sheets ---
  out.push('── SHEETS ──');
  Object.keys(CONFIG.SHEETS).forEach(function (key) {
    var sh = null;
    try { sh = Util_.getSheet(key, false); } catch (e) { /* ignore */ }
    if (sh) {
      out.push('  ✅ ' + key + ' → "' + sh.getName() + '" (' +
               sh.getLastRow() + 'r × ' + sh.getLastColumn() + 'c)');
    } else if (key === 'log') {
      out.push('  •  ' + key + ' → not created yet (normal)');
    } else {
      out.push('  ❌ ' + key + ' → MISSING (expected "' + CONFIG.SHEETS[key].name + '")');
      fail++;
    }
  });

  // --- Header resolution ---
  out.push('');
  out.push('── HEADER RESOLUTION ──');
  var checks = [
    ['dailyPrepare', CONFIG.LAYOUT.daily.headerRow, CONFIG.LAYOUT.daily.columns, 'Daily (Prepare)'],
    ['attendance', CONFIG.LAYOUT.attendance.monthlyHeaderRow, CONFIG.LAYOUT.attendance.monthlyColumns, 'Attendance monthly'],
    ['efficiency', CONFIG.LAYOUT.efficiency.headerRow, CONFIG.LAYOUT.efficiency.columns, 'Efficiency'],
    ['quality', CONFIG.LAYOUT.quality.headerRow, CONFIG.LAYOUT.quality.columns, 'Quality'],
    ['turnover', CONFIG.LAYOUT.turnover.headerRow, CONFIG.LAYOUT.turnover.columns, 'Turnover'],
    ['otHistory', CONFIG.LAYOUT.otHistory.headerRow, CONFIG.LAYOUT.otHistory.columns, 'OT History'],
    ['training', CONFIG.LAYOUT.training.headerRow, CONFIG.LAYOUT.training.columns, 'Training']
  ];
  checks.forEach(function (c) {
    try {
      var map = Util_.resolveColumns(c[0], c[1], c[2]);
      // Use the authoritative list. Comparing map[k] === fallback is wrong:
      // a header that legitimately sits at its fallback index looks like a
      // miss, which reported healthy sheets as broken.
      var fellBack = map._fellBack || [];
      if (fellBack.length) {
        out.push('  ⚠️ ' + c[3] + ': ' + fellBack.length + ' column(s) on fallback index → ' +
                 fellBack.join(', '));
        warn++;
      } else {
        out.push('  ✅ ' + c[3] + ': all headers matched');
      }
    } catch (e) {
      out.push('  ❌ ' + c[3] + ': ' + e.message);
      fail++;
    }
  });

  // --- Skill Matrix (the A2 fix) ---
  out.push('');
  out.push('── SKILL MATRIX (ANALYSIS §3 A2) ──');
  CONFIG.ROOMS.forEach(function (room) {
    try {
      var s = SkillService.readRoom(room.id);
      if (s.employees.length) {
        out.push('  ✅ ' + room.id + ': ' + s.employees.length + ' employees, ' +
                 s.stations.length + ' stations');
      } else {
        out.push('  ❌ ' + room.id + ': 0 employees — check skillRange rows ' +
                 room.skillRange.startRow + '-' + room.skillRange.endRow);
        fail++;
      }
    } catch (e) {
      out.push('  ❌ ' + room.id + ': ' + e.message);
      fail++;
    }
  });

  // --- Efficiency blocks (the A6 check) ---
  out.push('');
  out.push('── EFFICIENCY BLOCKS (ANALYSIS §3 A6) ──');
  try {
    var eff = EfficiencyService.read();
    Object.keys(eff).forEach(function (b) {
      var months = eff[b].length;
      if (months === 12) {
        out.push('  ✅ ' + b + ': 12 months');
      } else if (months > 0) {
        out.push('  ⚠️ ' + b + ': ' + months + ' months (expected 12)');
        warn++;
      } else {
        out.push('  ❌ ' + b + ': empty — block offset likely wrong');
        fail++;
      }
    });
  } catch (e) {
    out.push('  ❌ ' + e.message);
    fail++;
  }

  // --- New readers ---
  out.push('');
  out.push('── NEWLY WIRED (ANALYSIS §6) ──');
  try {
    var t = TurnoverService.read();
    out.push((t.months.length ? '  ✅' : '  ⚠️') + ' Turnover: ' + t.months.length + ' months');
    if (!t.months.length) warn++;
  } catch (e) { out.push('  ❌ Turnover: ' + e.message); fail++; }

  try {
    var rp = RepairService.read();
    out.push((rp.months.length ? '  ✅' : '  ⚠️') + ' Repair Material: ' +
             rp.months.length + ' months, target ' + rp.target);
    if (!rp.months.length) warn++;
  } catch (e) { out.push('  ❌ Repair: ' + e.message); fail++; }

  try {
    var q = QualityService.read();
    out.push((q.months.length ? '  ✅' : '  ⚠️') + ' Quality: ' + q.months.length +
             ' months, current NG rate ' + q.current.ngRate);
    if (!q.months.length) warn++;
  } catch (e) { out.push('  ❌ Quality: ' + e.message); fail++; }

  // --- Targets / unit collision ---
  out.push('');
  out.push('── TARGETS (ANALYSIS §7 V2) ──');
  try {
    var tg = DashboardService.readTargets();
    out.push('  Wire format: ' + CONFIG.KPI.targetWireFormat + ' (whole numbers)');
    Object.keys(tg).forEach(function (k) {
      out.push('    ' + k + ' = ' + tg[k]);
    });
  } catch (e) { out.push('  ❌ ' + e.message); fail++; }

  // --- Open data findings ---
  out.push('');
  out.push('── DATA VALIDATION (ANALYSIS §7) ──');
  try {
    var payload = {};
    CONFIG.ROOMS.forEach(function (r) {
      payload[r.id] = DashboardService.readDailyRoom(r.id);
    });
    payload.attendance = AttendanceService.readMonthly();
    payload.turnover   = TurnoverService.read();

    var ws = DashboardService.validate(payload);
    if (!ws.length) {
      out.push('  ✅ No warnings.');
    } else {
      ws.forEach(function (w) {
        var icon = w.severity === 'critical' ? '🔴' :
                   w.severity === 'high' ? '🟠' :
                   w.severity === 'medium' ? '🟡' : '🟢';
        out.push('  ' + icon + ' [' + w.code + '] ' + w.message);
        if (w.ref) out.push('       ' + w.ref);
        warn++;
      });
    }
  } catch (e) {
    out.push('  ❌ Validator: ' + e.message);
    fail++;
  }

  // --- Security ---
  out.push('');
  out.push('── SECURITY (ANALYSIS §9) ──');
  var props = PropertiesService.getScriptProperties();
  out.push((props.getProperty(CONFIG.PROP_KEYS.spreadsheetId) ? '  ✅' : '  ❌') +
           ' SPREADSHEET_ID in Script Properties');
  var hasToken = !!props.getProperty(CONFIG.PROP_KEYS.apiToken);
  out.push((hasToken ? '  ✅' : '  ❌') + ' API_TOKEN installed');
  if (!hasToken) {
    out.push('       Writes are DISABLED until you run Utility_installConfig().');
    fail++;
  }
  out.push('  ' + (CONFIG.SECURITY.requireToken ? '✅' : '⚠️') +
           ' requireToken (reads) = ' + CONFIG.SECURITY.requireToken);
  if (CONFIG.SECURITY.requireToken && hasToken) {
    out.push('       ⚠️ Reads now need ?token=… — the current HTML does NOT send one.');
    out.push('       This is the Phase 2 cutover. Until then, reads will 401.');
    warn++;
  }

  out.push('');
  out.push('── SUMMARY: ' + fail + ' failure(s), ' + warn + ' warning(s) ──');

  var msg = out.join('\n');
  console.log(msg);
  Log_.flush();
  try {
    SpreadsheetApp.getUi().alert('Diagnostics', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* editor context — console only */ }
  return msg;
}

/**
 * MULTI-MONTH — create the 'Quality History' sheet.
 *
 * Idempotent: safe to run repeatedly. Only creates the tab and writes the
 * header row; it never touches the operator's 'Quality' sheet and never
 * deletes existing archive rows.
 */
/**
 * PHASE 2A — create the 'Production History' sheet. Idempotent.
 */
function Utility_installProductionHistory() {
  var sh = ProductionHistoryService.install();
  var months = ProductionHistoryService.listMonths();
  var msg = '✅ Sheet "' + CONFIG.SHEETS.productionHistory.name + '" is ready.\n\n' +
            'Archived months: ' + (months.length ? months.join(', ') : '(none yet)') + '\n\n' +
            'Import a Daily Record file from the dashboard to populate it. ' +
            'Each import replaces only its own month + room.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Log_.info('ADMIN', msg); }
  return { sheet: sh.getName(), months: months };
}

function Utility_installQualityHistory() {
  var sh = QualityHistoryService.install();
  var months = QualityHistoryService.listMonths();
  var msg = '✅ Sheet "' + CONFIG.SHEETS.qualityHistory.name + '" is ready.\n\n' +
            'Archived months: ' + (months.length ? months.join(', ') : '(none yet)') + '\n\n' +
            'Import an NG summary file from the dashboard to populate it. ' +
            'Each import replaces only its own month.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Log_.info('ADMIN', msg); }
  return { sheet: sh.getName(), months: months };
}

function Utility_clearCache() {
  Util_.Cache.invalidateAll();
  [ 'targets', 'efficiency', 'quality', 'turnover', 'repair',
    'training', 'otHistory', 'attendance_monthly', 'attendance_daily',
    'skill_summary'
  ].forEach(function (k) { Util_.Cache.remove(k); });

  CONFIG.ROOMS.forEach(function (r) {
    Util_.Cache.remove('daily_' + r.id);
    Util_.Cache.remove('skill_' + r.id);
    Util_.Cache.remove('skillstations_' + r.id);
  });

  // Also drop in-memory memos so a CONFIG edit takes effect without
  // starting a new editor session.
  Util_.resetMemo();

  var msg = '✅ Cache cleared.';
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* ignore */ }
  return msg;
}

function Utility_listSheets() {
  var ss = Util_.getSpreadsheet();
  var sheets = ss.getSheets();
  var out = ['Found ' + sheets.length + ' sheets:', ''];

  sheets.forEach(function (sh, i) {
    var nm = sh.getName();
    out.push((i + 1) + '. [' + nm + ']  (' + nm.length + ' chars, ' +
             sh.getLastRow() + 'r × ' + sh.getLastColumn() + 'c)');
  });

  out.push('');
  out.push('── CONFIG resolution ──');
  Object.keys(CONFIG.SHEETS).forEach(function (key) {
    var sh = null;
    try { sh = Util_.getSheet(key, false); } catch (e) { /* ignore */ }
    out.push('  ' + (sh ? '✅' : '❌') + ' ' + key + ' → "' +
             CONFIG.SHEETS[key].name + '"');
  });

  var msg = out.join('\n');
  console.log(msg);
  try {
    SpreadsheetApp.getUi().alert('Sheets', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* ignore */ }
  return msg;
}

/**
 * Exercise every REST endpoint without deploying. Confirms routing,
 * validation, auth and enveloping against the live sheet.
 */
function Utility_testRoutes() {
  Log_.resetCorrelation();
  var out = ['REST ENDPOINT TEST — v' + CONFIG.API.envelopeVersion, ''];
  var failures = 0;

  Router_.listRoutes().forEach(function (r) {
    if (r.methods.indexOf('GET') === -1) {
      out.push('  •  ' + r.path + ' (no GET — skipped)');
      return;
    }

    // Supply required params so a route isn't reported broken merely
    // for being called wrong by this harness.
    var params = { path: r.path };
    if (r.path === '/history') params.room = CONFIG.ROOMS[0].id;

    var t0 = Date.now();
    try {
      var res = JSON.parse(doGet({ parameter: params }).getContent());
      var ms  = Date.now() - t0;

      if (res.ok) {
        var size = JSON.stringify(res.data).length;
        out.push('  ✅ ' + _pad(r.path, 13) + ms + 'ms  ' +
                 (size / 1024).toFixed(1) + 'KB' +
                 (res.meta && res.meta.warnings ?
                   '  ⚠️ ' + res.meta.warnings.length + ' warning(s)' : ''));
      } else {
        out.push('  ❌ ' + _pad(r.path, 13) + res.error.status + ' ' + res.error.code);
        failures++;
      }
    } catch (e) {
      out.push('  ❌ ' + _pad(r.path, 13) + 'threw: ' + e);
      failures++;
    }
  });

  out.push('');
  out.push('── Error handling ──');
  var cases = [
    ['unknown path',    { path: '/nope' },                      404],
    ['bad enum',        { path: '/attendance', view: 'x' },     400],
    ['missing required',{ path: '/history' },                   400],
    ['unknown param',   { path: '/quality', bogus: '1' },       400]
  ];
  cases.forEach(function (c) {
    var res = JSON.parse(doGet({ parameter: c[1] }).getContent());
    var got = res.ok ? 200 : res.error.status;
    if (got === c[2]) {
      out.push('  ✅ ' + _pad(c[0], 18) + '→ ' + got);
    } else {
      out.push('  ❌ ' + _pad(c[0], 18) + '→ ' + got + ' (expected ' + c[2] + ')');
      failures++;
    }
  });

  out.push('');
  out.push('── SUMMARY: ' + failures + ' failure(s) ──');

  var msg = out.join('\n');
  console.log(msg);
  Log_.flush();
  try {
    SpreadsheetApp.getUi().alert('REST test', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* editor context */ }
  return msg;
}

function _pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

/**
 * PHASE 3 — write the factory schedule rows into Dashboard Settings.
 *
 * The header and sidebar display Working Time, Break Time, OT Schedule
 * and Shift. Those values were hardcoded in the HTML because NO sheet in
 * the workbook carried them — a scan of all 14 sheets found nothing.
 *
 * This adds the rows ONCE so the schedule becomes sheet-driven and can be
 * edited without touching code. Existing rows are never overwritten.
 */
function Utility_installSchedule() {
  var sh = Util_.getSheet('settings');
  var L  = CONFIG.LAYOUT.settings;
  var S  = CONFIG.LAYOUT.schedule;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new AppError_('LOCK_TIMEOUT', 'Could not acquire write lock');
  }

  try {
    var last = sh.getLastRow();
    var existing = {};
    if (last >= L.startRow) {
      var vals = sh.getRange(L.startRow, 1, last - L.startRow + 1, 1).getValues();
      vals.forEach(function (r) {
        var k = Util_.toStr(r[0]);
        if (k) existing[String(k).toLowerCase()] = true;
      });
    }

    var toAdd = [];
    Object.keys(S.defaults).forEach(function (key) {
      if (existing[key]) return;
      toAdd.push([key, S.defaults[key], _unitFor(key)]);
    });

    if (!toAdd.length) {
      var msg0 = '• Schedule rows already present — nothing to do.';
      console.log(msg0);
      try { SpreadsheetApp.getUi().alert(msg0); } catch (e) {}
      return msg0;
    }

    // ONE batch write.
    sh.getRange(last + 1, 1, toAdd.length, 3).setValues(toAdd);

    // Rows were appended — drop memoized dimensions.
    Util_.forgetDims();
    Util_.Cache.remove('schedule');
    Util_.Cache.remove('rest__settings');

    var out = ['✅ Added ' + toAdd.length + ' schedule row(s) to Dashboard Settings:', ''];
    toAdd.forEach(function (r) { out.push('   ' + r[0] + ' = ' + r[1]); });
    out.push('');
    out.push('Edit these in the sheet — the dashboard reads them on next sync.');
    out.push('Break format:  HH:MM-HH:MM|ไทย|English');

    var msg = out.join('\n');
    console.log(msg);
    Log_.info('Admin', 'Schedule installed', { rows: toAdd.length });
    try {
      SpreadsheetApp.getUi().alert('Install schedule', msg,
        SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e) { /* editor context */ }
    return msg;

  } finally {
    lock.releaseLock();
    Log_.flush();
  }
}

function _unitFor(key) {
  if (key.indexOf('break_') === 0) return 'HH:MM-HH:MM|ไทย|EN';
  if (key === 'shift_name') return 'EN|ไทย';
  return 'HH:MM';
}

/**
 * Simulate a dashboard sync without a web request. Prints the
 * payload shape and every section's liveness — the fastest way to
 * confirm the frozen wire contract still holds after a CONFIG edit.
 */
function Utility_testPayload() {
  Log_.resetCorrelation();
  var t0 = Date.now();
  var payload = _buildFullPayload({});
  var ms = Date.now() - t0;

  var out = ['PAYLOAD TEST — ' + ms + 'ms', ''];
  out.push('── Frozen wire keys (HTML reads these) ──');
  [ 'prepare', 'assembly', 'skillPrepare', 'skillAssembly', 'trainingPlan',
    'productionEfficiency', 'attendance', 'quality', 'otHistory', 'targets',
    'fetchedAt'
  ].forEach(function (k) {
    out.push('  ' + (payload[k] !== undefined ? '✅' : '❌') + ' ' + k);
  });

  out.push('');
  out.push('── Additive keys (Phase 2) ──');
  ['turnover', 'repairMaterial', '_meta'].forEach(function (k) {
    out.push('  ' + (payload[k] !== undefined ? '✅' : '❌') + ' ' + k);
  });

  out.push('');
  out.push('── Section liveness ──');
  Object.keys(payload._meta.sections).forEach(function (k) {
    var v = payload._meta.sections[k];
    out.push('  ' + (v === 'live' ? '✅' : '⚠️') + ' ' + k + ': ' + v);
  });

  if (payload._meta.warnings.length) {
    out.push('');
    out.push('── Warnings ──');
    payload._meta.warnings.forEach(function (w) {
      out.push('  [' + w.severity + '] ' + w.code + ': ' + w.message);
    });
  }

  var msg = out.join('\n');
  console.log(msg);
  Log_.flush();
  return msg;
}
