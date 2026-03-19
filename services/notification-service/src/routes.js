import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sendPushNotification, sendToResident } from './fcm.js';
import { sendSMS, sendEntryNotification, sendOTP } from './sms.js';
import pool, { queryOne } from './db.js';

const router = Router();

// -- Response helpers --------------------------------------------------------

function success(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
    error: null,
    meta: { ts: new Date().toISOString(), requestId: res.locals.requestId || uuidv4() },
  });
}

function error(res, message, statusCode = 400, details = null) {
  return res.status(statusCode).json({
    success: false,
    data: null,
    error: { message, details },
    meta: { ts: new Date().toISOString(), requestId: res.locals.requestId || uuidv4() },
  });
}

// -- POST /notify/push -------------------------------------------------------

router.post('/notify/push', async (req, res) => {
  try {
    const { resident_id, title, body, data } = req.body;

    if (!resident_id || !title || !body) {
      return error(res, 'Missing required fields: resident_id, title, body', 400);
    }

    const result = await sendToResident(pool, resident_id, title, body, data || {});
    return success(res, result);
  } catch (err) {
    console.error('POST /notify/push error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /notify/sms --------------------------------------------------------

router.post('/notify/sms', async (req, res) => {
  try {
    const { mobile, message } = req.body;

    if (!mobile || !message) {
      return error(res, 'Missing required fields: mobile, message', 400);
    }

    const result = await sendSMS(mobile, message);
    return success(res, result);
  } catch (err) {
    console.error('POST /notify/sms error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /notify/entry ------------------------------------------------------

router.post('/notify/entry', async (req, res) => {
  try {
    const { resident_id, visitor_name, unit_number } = req.body;

    if (!resident_id || !visitor_name || !unit_number) {
      return error(res, 'Missing required fields: resident_id, visitor_name, unit_number', 400);
    }

    // Look up resident mobile number
    const resident = await queryOne(
      'SELECT mobile, fcm_token FROM residents WHERE id = $1',
      [resident_id]
    );

    if (!resident) {
      return error(res, 'Resident not found', 404);
    }

    const results = {};

    // Send push notification if FCM token exists
    if (resident.fcm_token) {
      results.push = await sendPushNotification(
        resident.fcm_token,
        'Visitor Entry',
        `${visitor_name} has entered. Unit ${unit_number}.`,
        { type: 'entry', visitor_name, unit_number }
      );
    }

    // Send SMS if mobile exists
    if (resident.mobile) {
      results.sms = await sendEntryNotification(resident.mobile, visitor_name, unit_number);
    }

    return success(res, results);
  } catch (err) {
    console.error('POST /notify/entry error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// -- POST /notify/otp --------------------------------------------------------

router.post('/notify/otp', async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile) {
      return error(res, 'Missing required field: mobile', 400);
    }

    // Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const result = await sendOTP(mobile, otp);

    return success(res, { otp, ...result });
  } catch (err) {
    console.error('POST /notify/otp error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
