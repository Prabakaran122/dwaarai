import PDFDocument from 'pdfkit';

/**
 * Generate a daily summary PDF report for gate events.
 *
 * @param {string} date - The date string (YYYY-MM-DD)
 * @param {Array} events - Array of gate_event rows for that date
 * @returns {import('stream').Readable} PDF readable stream
 */
export function generateDailyReport(date, events) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  // -- Header ----------------------------------------------------------------
  doc.fontSize(20).text(`CommunityGate Daily Report — ${date}`, { align: 'center' });
  doc.moveDown(1.5);

  // -- Summary stats ---------------------------------------------------------
  const total = events.length;
  const allowed = events.filter((e) => e.access_decision === 'allow').length;
  const denied = events.filter((e) => e.access_decision === 'deny').length;
  const guardReview = events.filter((e) => e.access_decision === 'guard_review').length;
  const overridden = events.filter((e) => e.access_decision === 'override').length;

  doc.fontSize(14).text('Summary', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11);
  doc.text(`Total events: ${total}`);
  doc.text(`Allowed: ${allowed}`);
  doc.text(`Denied: ${denied}`);
  doc.text(`Guard review: ${guardReview}`);
  if (overridden > 0) {
    doc.text(`Override: ${overridden}`);
  }
  doc.moveDown(1);

  // -- Breakdown by detection method -----------------------------------------
  const methods = ['ANPR', 'RFID', 'OTP', 'manual'];
  doc.fontSize(14).text('Breakdown by Detection Method', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11);

  for (const method of methods) {
    const count = events.filter(
      (e) => (e.detection_method || '').toLowerCase() === method.toLowerCase()
    ).length;
    if (count > 0) {
      doc.text(`${method.toUpperCase()}: ${count}`);
    }
  }

  // Check for any methods not in the standard list
  const standardMethods = new Set(methods.map((m) => m.toLowerCase()));
  const otherMethods = events.filter(
    (e) => !standardMethods.has((e.detection_method || '').toLowerCase())
  );
  if (otherMethods.length > 0) {
    doc.text(`Other: ${otherMethods.length}`);
  }

  doc.moveDown(1);

  // -- Denied entries list ---------------------------------------------------
  const deniedEvents = events.filter((e) => e.access_decision === 'deny');

  doc.fontSize(14).text('Denied Entries', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11);

  if (deniedEvents.length === 0) {
    doc.text('No denied entries for this date.');
  } else {
    for (const evt of deniedEvents) {
      const time = evt.event_ts
        ? new Date(evt.event_ts).toLocaleTimeString('en-US', { hour12: false })
        : 'N/A';
      const plate = evt.raw_value || 'N/A';
      const reason = evt.deny_reason || 'Unknown';
      const method = (evt.detection_method || 'N/A').toUpperCase();

      doc.text(`${time}  |  ${method}  |  Plate: ${plate}  |  Reason: ${reason}`);
    }
  }

  doc.moveDown(1);

  // -- Footer ----------------------------------------------------------------
  doc.fontSize(9).fillColor('#666666').text(
    `Generated at ${new Date().toISOString()}`,
    { align: 'center' }
  );

  doc.end();

  return doc;
}
