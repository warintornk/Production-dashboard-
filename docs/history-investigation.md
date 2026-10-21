# Historical production hours investigation

Inspected the two user-supplied Production Dashboard v4 XLSX exports. Values in History (Prepare) and History (Assembly) match between exports. The workbooks were not modified.

The archive begins below row 41. Month headings appear every 35 rows, followed by column headers and daily rows. The visible history selector at B4 shows only one month and should not be treated as the complete archive.

Relevant column mapping:

| Column | Meaning | Dashboard field |
| --- | --- | --- |
| A | Day of month | day |
| E | Standard hours / Output hour | stdHrs |
| F | Actual working hours / Input hour | actualHrs |

These values are already hours; do not divide by 60. Missing values and '-' must not be converted into measured zeroes.

Month headings are mixed types: row 217 is the text `▶ มิ.ย. 2026`; rows 252, 287 and 322 are actual spreadsheet dates for July, August and September 2026. An archive reader must support both formats. This is a backend compatibility risk; the Apps Script source and live API response have not been inspected, so a backend parsing failure is not yet confirmed.

Real daily records exist in June through September. September Prepare day 1 has Input 209.8 and Output 150.9. September Assembly day 1 has Input 137.7 and Output 192.15.

Frontend corrections in index.html:

- Map daily rows to the returned year-month, not the machine's current month.
- Cache daily snapshots by full year-month and use the requested month's rows for drill-down.
- Merge multiple lines/rooms by day without inventing missing hours.
- Retain numeric precision until display formatting.
- Fetch the globally selected month when a monthly bar is clicked.
- Prevent an in-flight response for an earlier selection from replacing a later selection.
- Clear daily rows when the API returns an empty room.
- Use the selected year in chart titles and retain a back button for missing daily data.

Validation: existing regression browser checks passed. Separately extracted archived daily records from the real XLSX files, mapped them into the documented API fields, and exercised both rooms for June–September in Chromium. Verified 21 daily records per room in June–August, 24 Prepare and 23 Assembly records in September, exact per-day hours, preserved missing values, visible tables and no JavaScript page errors. This validates the frontend against workbook values; it does not validate the live Apps Script's extraction or response.


## Correction after the current Apps Script was supplied

The user clarified that the earlier small v4/v5 source was the wrong file. The corrected baseline is the subsequently supplied 6,775-line combined script. The earlier backend diagnosis applies only to that incorrect file and is superseded here.

The actual current backend already has routing, authentication, writes, version polling and month parameters. Its production resolver checks only `ProductionHistoryService.readMonthRoom` (the separate imported-data sheet) before falling back to the live Daily Record. It never consults the legacy per-room History sheets during dashboard assembly. The current patch adds that missing read path, sends the legacy snapshots to the frontend, and prevents cross-month live fallback. CONFIG, Router_ and doPost are preserved verbatim. No hardcoded spreadsheet ID is introduced. See apps-script/DEPLOY.md for the corrected deployment steps.
