import { neon } from "@neondatabase/serverless";
import { Resend } from "resend";
import { timingSafeEqual } from "node:crypto";

function authorized(req) {
  const expected = process.env.STAFF_REVIEW_TOKEN || "";
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

const CENTRAL = "America/Chicago";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function partsAt(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
}
function zonedToUtc(year, month, day, hour, minute, zone) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = partsAt(new Date(guess), zone);
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    guess += target - represented;
  }
  const check = partsAt(new Date(guess), zone);
  if (+check.year !== year || +check.month !== month || +check.day !== day || +check.hour !== hour || +check.minute !== minute) {
    throw new Error("That local time does not exist because of a daylight-saving clock change.");
  }
  return new Date(guess);
}
function validTimeZone(zone) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}
async function ensureTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS call_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    guest_phone TEXT NOT NULL,
    guest_timezone TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS call_bookings_starts_at_unique ON call_bookings (starts_at)`;
}
function monthBounds(month) {
  if (!/^\d{4}-\d{2}$/.test(month || "")) throw new Error("Choose a valid calendar month.");
  const [year, m] = month.split("-").map(Number);
  if (m < 1 || m > 12) throw new Error("Choose a valid calendar month.");
  return { year, month: m, days: new Date(Date.UTC(year, m, 0)).getUTCDate() };
}
function centralKey(date) {
  const p = partsAt(date, CENTRAL);
  return `${p.year}-${p.month}-${p.day}`;
}
async function notifyBooking(booking) {
  if (!process.env.RESEND_API_KEY || !process.env.APPLICATION_FROM_EMAIL) return false;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const notify = process.env.APPLICATION_NOTIFY_EMAIL || "SaintCrownRecruiting@gmail.com";
  const centralLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL, weekday: "long", month: "long", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short"
  }).format(booking.start);
  const guestLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: booking.timeZone, weekday: "long", month: "long", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short"
  }).format(booking.start);
  const details = `Name: ${booking.name}\nEmail: ${booking.email}\nPhone: ${booking.phone}\nAppointment: ${centralLabel}\nGuest's local time: ${guestLabel}\nTime zone: ${booking.timeZone}\nDuration: 30 minutes`;
  await Promise.all([
    resend.emails.send({ from: process.env.APPLICATION_FROM_EMAIL, to: notify, subject: "New Saint-Crown call booking — " + booking.name, text: "A new call has been booked.\n\n" + details }),
    resend.emails.send({ from: process.env.APPLICATION_FROM_EMAIL, to: booking.email, subject: "Your Saint-Crown call is confirmed", text: "Your 30-minute call with Saint-Crown Recruiting is confirmed.\n\n" + details + "\n\nIf you need to make a change, reply to this email." })
  ]);
  return true;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "Online booking is temporarily unavailable. Please email SaintCrownRecruiting@gmail.com." });
  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureTable(sql);
    if (req.method === "GET" && String(req.query.staff || "") === "1") {
      if (!process.env.STAFF_REVIEW_TOKEN) return res.status(503).json({ error: "Staff review is not configured." });
      if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
      const bookings = await sql`SELECT id, starts_at AS "startsAt", ends_at AS "endsAt",
        guest_name AS name, guest_email AS email, guest_phone AS phone,
        guest_timezone AS "guestTimezone", created_at AS "createdAt"
        FROM call_bookings ORDER BY starts_at ASC LIMIT 250`;
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json({ ok: true, bookings });
    }
    if (req.method === "GET") {
      const { year, month, days } = monthBounds(String(req.query.month || ""));
      const start = zonedToUtc(year, month, 1, 0, 0, CENTRAL);
      const nextMonth = month === 12 ? zonedToUtc(year + 1, 1, 1, 0, 0, CENTRAL) : zonedToUtc(year, month + 1, 1, 0, 0, CENTRAL);
      const booked = await sql`SELECT starts_at FROM call_bookings WHERE starts_at >= ${new Date(start.getTime() - 86400000).toISOString()} AND starts_at < ${new Date(nextMonth.getTime() + 86400000).toISOString()}`;
      const taken = new Set(booked.map(row => new Date(row.starts_at).toISOString()));
      const now = Date.now();
      const slots = [];
      for (let day = 1; day <= days; day++) {
        const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
        if (weekday === 0 || weekday === 6) continue;
        for (let hour = 8; hour < 17; hour++) {
          for (const minute of [0, 30]) {
            if (hour === 16 && minute === 30) { /* last half-hour slot ends at 5 PM */ }
            if (hour === 16 && minute > 30) continue;
            const startAt = zonedToUtc(year, month, day, hour, minute, CENTRAL);
            if (startAt.getTime() <= now || taken.has(startAt.toISOString())) continue;
            slots.push({ startsAt: startAt.toISOString(), centralDate: centralKey(startAt) });
          }
        }
      }
      return res.status(200).json({ slots });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = req.body || {};
    const name = String(body.name || "").trim().slice(0, 160);
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim().slice(0, 40);
    const timeZone = String(body.timeZone || "");
    const startsAt = new Date(body.startsAt || "");
    if (!name || !emailPattern.test(email) || phone.replace(/\D/g, "").length < 7 ||
        !validTimeZone(timeZone) || !Number.isFinite(startsAt.getTime())) {
      return res.status(400).json({ error: "Please enter your name, a valid email, phone number, time zone and available time." });
    }
    const p = partsAt(startsAt, CENTRAL);
    const weekday = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay();
    const hour = +p.hour, minute = +p.minute;
    if (weekday === 0 || weekday === 6 || hour < 8 || hour > 16 || (hour === 16 && minute > 30) ||
        ![0, 30].includes(minute) || startsAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: "That time is outside our Monday–Friday, 8 AM–5 PM Central booking hours or is no longer available." });
    }
    const endAt = new Date(startsAt.getTime() + 30 * 60000);
    let rows;
    try {
      rows = await sql`INSERT INTO call_bookings
        (starts_at, ends_at, guest_name, guest_email, guest_phone, guest_timezone)
        VALUES (${startsAt.toISOString()}, ${endAt.toISOString()}, ${name}, ${email}, ${phone}, ${timeZone})
        RETURNING id`;
    } catch (error) {
      if (String(error?.code || "") === "23505" || /unique constraint|duplicate key/i.test(String(error?.message || ""))) {
        return res.status(409).json({ error: "Sorry, someone just booked that time. Please choose another available slot." });
      }
      throw error;
    }
    const booking = { id: rows[0].id, name, email, phone, timeZone, start: startsAt };
    let emailsSent = false;
    try { emailsSent = await notifyBooking(booking); }
    catch (mailError) { console.error("Call booking email delivery failed", mailError); }
    return res.status(201).json({ ok: true, emailsSent, message: "Your call is booked." });
  } catch (error) {
    console.error("Call booking request failed", error);
    return res.status(400).json({ error: error.message || "We couldn't complete that booking. Please try again." });
  }
}
