const base = 'http://localhost:3000';

async function main() {
  const email = `avatarcheck${Date.now()}@example.com`;
  const password = 'Password123';

  const signup = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, firstName: 'Avatar', lastName: 'Check' }),
  });
  const signupBody = await signup.json();
  console.log('SIGNUP', signup.status, JSON.stringify(signupBody));

  const verify = await fetch(`${base}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, verificationCode: signupBody.verificationCode }),
  });
  const verifyBody = await verify.json();
  console.log('VERIFY', verify.status, JSON.stringify(verifyBody));

  const verifyCookie = verify.headers.get('set-cookie') || '';
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: verifyCookie.split(';')[0],
    },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await login.json();
  console.log('LOGIN', login.status, JSON.stringify(loginBody));

  const loginCookie = login.headers.get('set-cookie') || '';
  const patch = await fetch(`${base}/api/profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: loginCookie.split(';')[0],
    },
    body: JSON.stringify({
      firstName: 'Avatar',
      lastName: 'Check',
      email,
      avatar: 'data:image/png;base64,AAAA',
    }),
  });
  const patchBody = await patch.json();
  console.log('PATCH', patch.status, JSON.stringify(patchBody));

  const me = await fetch(`${base}/api/auth/me`, {
    headers: { Cookie: loginCookie.split(';')[0] },
  });
  const meBody = await me.json();
  console.log('ME', me.status, JSON.stringify(meBody));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
