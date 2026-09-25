const base = 'http://localhost:3000';

(async () => {
  const email = `avatarcheck${Date.now()}@example.com`;
  const password = 'Password123';

  const signupRes = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, firstName: 'Avatar', lastName: 'Check' }),
  });
  const signupBody = await signupRes.json();
  console.log('SIGNUP', signupRes.status, JSON.stringify(signupBody));

  const verifyRes = await fetch(`${base}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, verificationCode: signupBody.verificationCode }),
  });
  const verifyBody = await verifyRes.json();
  console.log('VERIFY', verifyRes.status, JSON.stringify(verifyBody));

  const verifyCookie = verifyRes.headers.get('set-cookie') || '';
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: verifyCookie.split(';')[0],
    },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await loginRes.json();
  console.log('LOGIN', loginRes.status, JSON.stringify(loginBody));

  const loginCookie = loginRes.headers.get('set-cookie') || '';
  const patchRes = await fetch(`${base}/api/profile`, {
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
  const patchBody = await patchRes.json();
  console.log('PATCH', patchRes.status, JSON.stringify(patchBody));
})();
