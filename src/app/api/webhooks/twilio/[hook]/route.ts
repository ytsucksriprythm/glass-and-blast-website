import { receiveSms, receiveSmsStatus, verifyTwilio } from '@/lib/sms';

export async function POST(request: Request, { params }: { params: Promise<{ hook: string }> }) {
  const { hook } = await params;
  if (hook !== 'incoming' && hook !== 'status') return new Response(null, { status: 404 });
  const type = request.headers.get('content-type') ?? '';
  if (!type.startsWith('application/x-www-form-urlencoded')) return new Response(null, { status: 415 });
  const raw = await request.text();
  if (raw.length > 24000) return new Response(null, { status: 413 });
  const fields = Object.fromEntries(new URLSearchParams(raw));
  const url = new URL(request.url);
  const route = '/api/webhooks/twilio/' + hook + url.search;
  if (!verifyTwilio(request.headers.get('x-twilio-signature') ?? '', route, fields)) return new Response(null, { status: 403 });
  if (hook === 'status') {
    await receiveSmsStatus(url.searchParams.get('id') ?? '', fields);
    return new Response(null, { status: 204 });
  }
  await receiveSms(fields, true);
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}
