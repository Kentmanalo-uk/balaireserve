/**
 * Reports Routes
 */
'use strict';

const express = require('express');
const ExcelJS = require('exceljs');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');
const { formatExcelValue, getColumnWidth } = require('../xlsxFormatting');

const router = express.Router();

// Local resort dates (Philippines, UTC+8) as 'YYYY-MM-DD'.
const PH_OFFSET_MS = 8 * 3600000;
const phNow        = () => new Date(Date.now() + PH_OFFSET_MS);
const phToday      = () => phNow().toISOString().slice(0, 10);
const phYearStart  = () => phNow().toISOString().slice(0, 4) + '-01-01';
const phMonthStart = () => phNow().toISOString().slice(0, 7) + '-01';
const REPORT_BRAND = {
  name: 'Balai Miciano/ Maple Heaven',
  address: 'San Antonio, Gloria, Oriental Mindoro',
};

// ΓöÇΓöÇ Helper: resort branding for report headers/footers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function getResortInfo() {
  const rows = await db.prepare(
    "SELECT `key`, value FROM settings WHERE `key` IN ('resort_name','resort_address','resort_phone','resort_email')"
  ).all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    name:    s.resort_name    || 'Balai-Reserve',
    address: s.resort_address || '',
    phone:   s.resort_phone   || '',
    email:   s.resort_email   || '',
  };
}

const REPORT_TITLES = {
  sales:        'Sales Report',
  reservations: 'Reservation Report',
  events:       'Event Report',
};

function escapeHtml(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// GET /reports
router.get('/', requireAuth, requireRole('admin','staff'), async (req, res) => {
  res.render('reports/index', { title: 'Reports – Balai-Reserve', layout: 'layouts/main' });
});

// GET /reports/sales
router.get('/sales', requireAuth, requireRole('admin'), async (req, res) => {
  const { from = '', to = '', type = 'monthly' } = req.query;
  const today    = phToday();
  const fromDate = from || phYearStart();
  const toDate   = to   || today;

  let groupBy, labelFormat;
  if (type === 'daily')   { groupBy = `DATE(payment_date)`;           labelFormat = 'Date'; }
  else if (type === 'weekly') { groupBy = `CONCAT(DATE_FORMAT(payment_date, '%Y'), '-W', LPAD(WEEK(payment_date, 5), 2, '0'))`; labelFormat = 'Week'; }
  else if (type === 'yearly') { groupBy = `DATE_FORMAT(payment_date, '%Y')`;     labelFormat = 'Year'; }
  else                    { groupBy = `DATE_FORMAT(payment_date, '%Y-%m')`;  labelFormat = 'Month'; } // monthly default

  const salesData = await db.prepare(`
    SELECT ${groupBy} AS period,
           SUM(amount) AS total,
           COUNT(*) AS transactions
    FROM payments
    WHERE status IN ('received','verified')
      AND payment_date >= ? AND payment_date <= ?
    GROUP BY period
    ORDER BY period
  `).all(fromDate, toDate + ' 23:59:59');

  const totalRevenue = salesData.reduce((s, r) => s + r.total, 0);
  const totalTxns    = salesData.reduce((s, r) => s + r.transactions, 0);

  // Revenue by type
  const byType = await db.prepare(`
    SELECT r.reservation_type, SUM(p.amount) AS total
    FROM payments p JOIN reservations r ON r.id=p.reservation_id
    WHERE p.status IN ('received','verified') AND p.payment_date >= ? AND p.payment_date <= ?
    GROUP BY r.reservation_type
  `).all(fromDate, toDate + ' 23:59:59');

  res.render('reports/sales', {
    title: 'Sales Report', layout: 'layouts/main',
    salesData, byType, totalRevenue, totalTxns,
    filters: { from: fromDate, to: toDate, type }, labelFormat,
    salesDataJson: JSON.stringify(salesData),
    resort: await getResortInfo(),
    reportBrand: REPORT_BRAND,
  });
});

// GET /reports/reservations
router.get('/reservations', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const { from='', to='', status='', type='' } = req.query;
  const today    = phToday();
  const fromDate = from || phMonthStart();
  const toDate   = to   || today;

  let where  = `WHERE r.created_at >= ? AND r.created_at <= ?`;
  const params = [fromDate, toDate + ' 23:59:59'];

  if (status) { where += ` AND r.status = ?`;            params.push(status); }
  if (type)   { where += ` AND r.reservation_type = ?`;  params.push(type); }

  const reservations = await db.prepare(`
    SELECT r.*, c.first_name || ' ' || c.last_name AS customer_name
    FROM reservations r JOIN customers c ON c.id=r.customer_id
    ${where}
    ORDER BY r.created_at DESC
  `).all(...params);

  const statusSummary = await db.prepare(`
    SELECT status, COUNT(*) AS cnt FROM reservations
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY status
  `).all(fromDate, toDate + ' 23:59:59');

  const typeSummary = await db.prepare(`
    SELECT reservation_type, COUNT(*) AS cnt FROM reservations
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY reservation_type
  `).all(fromDate, toDate + ' 23:59:59');

  res.render('reports/reservations', {
    title: 'Reservation Report', layout: 'layouts/main',
    reservations, statusSummary, typeSummary,
    filters: { from: fromDate, to: toDate, status, type },
    resort: await getResortInfo(),
    reportBrand: REPORT_BRAND,
  });
});

// GET /reports/events
router.get('/events', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const { from='', to='' } = req.query;
  const today    = phToday();
  const fromDate = from || phYearStart();
  const toDate   = to   || today;

  const events = await db.prepare(`
    SELECT e.*, c.first_name || ' ' || c.last_name AS customer_name, v.name AS venue_name
    FROM events e JOIN customers c ON c.id=e.customer_id LEFT JOIN venues v ON v.id=e.venue_id
    WHERE e.event_date >= ? AND e.event_date <= ?
    ORDER BY e.event_date DESC
  `).all(fromDate, toDate);

  const byType = await db.prepare(`
    SELECT event_type, COUNT(*) AS cnt, SUM(total_cost) AS revenue
    FROM events WHERE event_date >= ? AND event_date <= ?
    GROUP BY event_type
  `).all(fromDate, toDate);

  const totalAttendees = events.reduce((s, e) => s + (e.num_attendees || 0), 0);
  const totalRevenue   = events.reduce((s, e) => s + (e.total_cost || 0), 0);

  res.render('reports/events', {
    title: 'Event Report', layout: 'layouts/main',
    events, byType, totalAttendees, totalRevenue,
    filters: { from: fromDate, to: toDate },
    resort: await getResortInfo(),
    reportBrand: REPORT_BRAND,
  });
});

// GET /reports/export/:reportType?format=csv|xlsx|docx  — branded export
router.get('/export/:reportType', requireAuth, requireRole('admin'), async (req, res) => {
  const { reportType } = req.params;
  const format   = (req.query.format || 'csv').toLowerCase();
  const { from='', to='' } = req.query;
  const today    = phToday();
  const fromDate = from || '2020-01-01';
  const toDate   = to   || today;

  let rows = [];
  let filename = 'report';
  let headers  = [];

  if (reportType === 'sales') {
    rows     = await db.prepare(`
      SELECT p.*, r.booking_ref, r.reservation_type,
             c.first_name || ' ' || c.last_name AS customer
      FROM payments p
      JOIN reservations r ON r.id = p.reservation_id
      LEFT JOIN customers c ON c.id = r.customer_id
      WHERE p.payment_date >= ? AND p.payment_date <= ?
      ORDER BY p.payment_date
    `).all(fromDate, toDate + ' 23:59:59');
    headers  = ['id','booking_ref','customer','reservation_type','amount','payment_method','payment_date','payment_type','status'];
    filename = `sales-${fromDate}-to-${toDate}`;
  } else if (reportType === 'reservations') {
    rows     = await db.prepare(`SELECT r.*, c.first_name || ' ' || c.last_name AS customer FROM reservations r JOIN customers c ON c.id=r.customer_id WHERE r.created_at >= ? AND r.created_at <= ? ORDER BY r.created_at`).all(fromDate, toDate + ' 23:59:59');
    headers  = ['id','booking_ref','customer','reservation_type','check_in_date','check_out_date','event_date','num_guests','total_amount','status','payment_status','created_at'];
    filename = `reservations-${fromDate}-to-${toDate}`;
  } else if (reportType === 'events') {
    rows     = await db.prepare(`SELECT e.*, c.first_name || ' ' || c.last_name AS customer FROM events e JOIN customers c ON c.id=e.customer_id WHERE e.event_date >= ? AND e.event_date <= ? ORDER BY e.event_date`).all(fromDate, toDate);
    headers  = ['id','event_name','customer','event_type','event_date','start_time','end_time','num_attendees','total_cost','payment_status','status'];
    filename = `events-${fromDate}-to-${toDate}`;
  } else {
    return res.status(400).send('Unknown report type.');
  }

  const resort    = await getResortInfo();
  const title     = REPORT_TITLES[reportType] || 'Report';
  const generated = new Date().toLocaleString('en-PH');
  const prettyHeaders = headers.map(h => h.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

  // ΓöÇΓöÇ Excel (xlsx) via exceljs ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = REPORT_BRAND.name;
    const ws = wb.addWorksheet(title, {
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        scale: undefined,
        margins: { left: 0.2, right: 0.2, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      },
      headerFooter: {
        oddHeader: `&L&B${REPORT_BRAND.name}&R${title}`,
        oddFooter: `&L${REPORT_BRAND.address}&CPage &P of &N&R${resort.phone}`,
      },
    });
    const lastCol = headers.length;
    const colLetter = (n) => { let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; };
    const span = `A1:${colLetter(lastCol)}1`;

    // Branded title block
    ws.mergeCells(span);
    ws.getCell('A1').value = REPORT_BRAND.name;
    ws.getCell('A1').font  = { size: 16, bold: true, color: { argb: 'FF15803D' } };
    ws.getCell('A1').alignment = { horizontal: 'center' };
    ws.mergeCells(`A2:${colLetter(lastCol)}2`);
    ws.getCell('A2').value = REPORT_BRAND.address;
    ws.getCell('A2').alignment = { horizontal: 'center' };
    ws.getCell('A2').font = { size: 10, color: { argb: 'FF6B7280' } };
    ws.mergeCells(`A3:${colLetter(lastCol)}3`);
    ws.getCell('A3').value = `${title}  —  ${fromDate} to ${toDate}   (Generated: ${generated})`;
    ws.getCell('A3').alignment = { horizontal: 'center' };
    ws.getCell('A3').font = { size: 11, bold: true };
    ws.addRow([]);

    // Header row
    const headerRow = ws.addRow(prettyHeaders);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } };
      cell.alignment = { horizontal: 'center' };
      cell.border = { bottom: { style: 'thin' } };
    });

    // Write date values as text so Excel displays them even in narrow columns.
    for (const row of rows) {
      ws.addRow(headers.map(h => formatExcelValue(row[h], h)));
    }

    headers.forEach((header, index) => {
      const column = ws.getColumn(index + 1);
      const values = rows.map(row => formatExcelValue(row[header], header));
      column.width = getColumnWidth(prettyHeaders[index], values, header);
      column.eachCell({ includeEmpty: false }, cell => {
        cell.alignment = { ...cell.alignment, vertical: 'top', wrapText: true };
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }

  // ΓöÇΓöÇ Word (.doc via HTML) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  if (format === 'docx' || format === 'doc' || format === 'word') {
    const th = prettyHeaders.map(h => `<th style="background:#15803d;color:#fff;padding:6px 8px;border:1px solid #cbd5e1;text-align:left;">${escapeHtml(h)}</th>`).join('');
    const trs = rows.map(row => {
      const tds = headers.map(h => `<td style="padding:5px 8px;border:1px solid #cbd5e1;">${escapeHtml(row[h] ?? '')}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
      <style>
        @page{size:A4 landscape;margin:.4in;}
        body{font-family:'Segoe UI',Arial,sans-serif;color:#111;margin:0;}
        .rpt-header{text-align:center;border-bottom:2px solid #15803d;padding-bottom:6px;margin-bottom:8px;}
        .rpt-name{font-size:18px;font-weight:bold;color:#15803d;}
        .rpt-addr{font-size:10px;color:#555;}
        .rpt-title{font-size:12px;font-weight:bold;margin-top:4px;}
        table{border-collapse:collapse;table-layout:fixed;width:100%;font-size:8px;}
        th,td{box-sizing:border-box;overflow-wrap:anywhere;word-break:break-word;padding:3px 4px !important;vertical-align:top;}
        .rpt-footer{margin-top:10px;border-top:1px solid #cbd5e1;padding-top:5px;font-size:9px;color:#777;text-align:center;}
      </style></head><body>
      <div class="rpt-header">
        <div class="rpt-name">${escapeHtml(REPORT_BRAND.name)}</div>
        <div class="rpt-addr">${escapeHtml(REPORT_BRAND.address)}</div>
        <div class="rpt-title">${escapeHtml(title)} — ${escapeHtml(fromDate)} to ${escapeHtml(toDate)}</div>
      </div>
      <table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>
      <div class="rpt-footer">Generated on ${escapeHtml(generated)} &bull; ${escapeHtml(resort.name)} &bull; This is a system-generated report.</div>
      </body></html>`;

    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.doc"`);
    return res.send(html);
  }

  // ΓöÇΓöÇ CSV (default) with a small branded preamble ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const csvLines = [];
  csvLines.push(`"${REPORT_BRAND.name}"`);
  csvLines.push(`"${REPORT_BRAND.address}"`);
  csvLines.push(`"${title} - ${fromDate} to ${toDate}"`);
  csvLines.push('');
  csvLines.push(prettyHeaders.map(h => `"${h}"`).join(','));
  for (const row of rows) {
    csvLines.push(headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(csvLines.join('\n'));
});

module.exports = router;
