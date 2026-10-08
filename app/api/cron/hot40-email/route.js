import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { runHot40Scan, formatHot40AsHtml } from '@/lib/hot40-scanner';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request) {
  // 1) Verify the secret so randoms can't trigger your scan
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2) Verify required env vars
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.ALERT_EMAIL;
  if (!apiKey || !toEmail) {
    return NextResponse.json({ error: 'RESEND_API_KEY or ALERT_EMAIL not configured' }, { status: 500 });
  }

  // 3) Run the scan
  try {
    const picks = await runHot40Scan({});
    if (picks.length === 0) {
      return NextResponse.json({ ok: true, message: 'No picks met the threshold', count: 0 });
    }

    // 4) Build and send the email
    const resend = new Resend(apiKey);
    const html = formatHot40AsHtml(picks, new Date().toLocaleString('en-GB'));
    const { error } = await resend.emails.send({
      from: 'HOT40 <onboarding@resend.dev>',
      to: toEmail,
      subject: `🔥 HOT40 · ${picks.length} Over 1.5 picks for ${new Date().toLocaleDateString('en-GB')}`,
      html,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, sent: picks.length, to: toEmail });
  } catch (e) {
    console.error('Cron email failed:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
