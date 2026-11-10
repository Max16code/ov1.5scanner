import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function proxy(request) {
  const path = request.nextUrl.pathname;

  // 1. Handle Admin Routes with Supabase Auth
  if (path.startsWith('/admin')) {
    let response = NextResponse.next();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    return response;
  }

  // 2. Main App Basic Auth (for regular users)
  const USER = process.env.SITE_USER || 'maxwell';
  const PASS = process.env.SITE_PASS;

  if (!PASS) return new NextResponse('Site password not configured', { status: 500 });

  const auth = request.headers.get('authorization');
  if (auth && auth.startsWith('Basic ')) {
    const encoded = auth.slice(6);
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const [user, pass] = decoded.split(':');
    if (user === USER && pass === PASS) return NextResponse.next();
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Secure Area", charset="UTF-8"' },
  });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logos|api/cron|api/check-results|api/admin).*)',
  ],
}
