import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: { signIn: '/login' },
});

export const config = {
  matcher: [
    '/((?!login|console|api/auth|api/v2/telemetry|_next/static|_next/image|favicon.ico).*)',
  ],
};
