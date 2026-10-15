import { NextResponse } from 'next/server';

export function middleware(request) {
  const USER = process.env.SITE_USER || 'maxwell';
  const PASS = process.env.SITE_PASS;

  // If no password is configured, fail safe — lock everything
  if (!PASS) {
    return new NextResponse('SITE_PASS not configured', { status: 500 });
  }

  const auth = request.headers.get('authorization');

  if (auth && auth.startsWith('Basic ')) {
    const encoded = auth.slice(6);
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const [user, pass] = decoded.split(':');

    if (user === USER && pass === PASS) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="HOT40 Scanner", charset="UTF-8"',
    },
  });
}

export const config = {
  // Exclude static assets and cron endpoints (they have their own secret auth)
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logos|api/cron|api/check-results).*)',
  ],
};
