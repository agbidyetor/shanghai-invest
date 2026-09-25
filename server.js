const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config();
const nodemailer = require('nodemailer');

const port = Number(process.env.PORT) || 3000;
const root = __dirname;
const dataDir = path.join(root, 'data');
const usersFile = path.join(dataDir, 'users.json');
const transactionsFile = path.join(dataDir, 'transactions.json');
const sessions = new Map();
const verificationChallenges = new Map();
const resetChallenges = new Map();
const twoFactorChallenges = new Map();
const paymentSessions = new Map();
const paymentWebhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || 'dev-webhook-secret';
const staticTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const mailConfig = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || process.env.SMTP_USER
};
const mailConfigured = Boolean(mailConfig.host && mailConfig.user && mailConfig.pass && mailConfig.from);
const mailTransport = mailConfigured ? nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    auth: { user: mailConfig.user, pass: mailConfig.pass }
}) : null;

fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, '[]');
if (!fs.existsSync(transactionsFile)) fs.writeFileSync(transactionsFile, '[]');

function readUsers() {
    return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
}

function writeUsers(users) {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

function readTransactions() {
    return JSON.parse(fs.readFileSync(transactionsFile, 'utf8'));
}

function writeTransactions(transactions) {
    fs.writeFileSync(transactionsFile, JSON.stringify(transactions, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, derivedKey) => {
        if (error) reject(error);
        else resolve(`${salt}:${derivedKey.toString('hex')}`);
    }));
}

async function passwordMatches(password, storedHash) {
    const [salt, key] = storedHash.split(':');
    const candidate = await hashPassword(password, salt);
    return crypto.timingSafeEqual(Buffer.from(candidate.split(':')[1], 'hex'), Buffer.from(key, 'hex'));
}

function sendJson(response, status, payload, headers = {}) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    response.end(JSON.stringify(payload));
}

function getCookie(request, name) {
    const cookies = request.headers.cookie || '';
    const match = cookies.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function sessionCookie(token, maxAge = 60 * 60 * 24 * 7) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return `session=${encodeURIComponent(token)}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}; Path=/`;
}

function currentUser(request) {
    const token = getCookie(request, 'session');
    const email = token && sessions.get(token);
    return email ? readUsers().find((user) => user.email === email) : null;
}

function code() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function referralCode() {
    return `SH${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function publicUser(user) {
    return { email: user.email, firstName: user.firstName || '', lastName: user.lastName || '', name: user.name || [user.firstName, user.lastName].filter(Boolean).join(' '), referralCode: user.referralCode || '', emailVerified: Boolean(user.emailVerified), twoFactorEnabled: Boolean(user.twoFactorEnabled), createdAt: user.createdAt, avatar: user.avatar || '', accountDetails: user.accountDetails || {} };
}

function hasAccountDetails(user) {
    const details = user.accountDetails || {};
    return Boolean(details.phone && details.country && details.address && details.city && details.postalCode);
}

function accountDetailsError() {
    return 'Complete your account details in Profile before adding money.';
}

function issueChallenge(store, email) {
    const value = code();
    store.set(email, { value, expiresAt: Date.now() + 10 * 60 * 1000 });
    return value;
}

function consumeChallenge(store, email, value) {
    const challenge = store.get(email);
    store.delete(email);
    return Boolean(challenge && challenge.expiresAt > Date.now() && challenge.value === String(value || ''));
}

async function sendAuthCodeEmail(email, verificationCode, purpose) {
    if (!mailTransport) return false;
    const subject = purpose === 'verification' ? 'Verify your Shanghai Investment account' : 'Reset your Shanghai Investment password';
    await mailTransport.sendMail({
        from: mailConfig.from,
        to: email,
        subject,
        text: `Your Shanghai Investment ${purpose} code is ${verificationCode}. It expires in 10 minutes.`,
        html: `<p>Your Shanghai Investment ${purpose} code is:</p><p style="font-size: 24px; font-weight: 700; letter-spacing: 4px">${verificationCode}</p><p>This code expires in 10 minutes.</p>`
    });
    return true;
}

function transactionView(transaction) {
    return { id: transaction.id, type: transaction.type, amount: transaction.amount, currency: transaction.currency || 'USD', status: transaction.status, createdAt: transaction.createdAt, description: transaction.description, gatewayReference: transaction.gatewayReference || null };
}

const MAX_BODY_BYTES = 10 * 1024 * 1024;

function readRawBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        request.on('data', (chunk) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); if (chunks.reduce((total, part) => total + part.length, 0) > MAX_BODY_BYTES) request.destroy(); });
        request.on('end', () => resolve(Buffer.concat(chunks)));
        request.on('error', reject);
    });
}

function computeWebhookSignature(payload, secret) {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function webhookSignatureFromHeaders(request) {
    return request.headers['x-shanghai-signature'] || request.headers['x-provider-signature'] || request.headers['x-signature'] || null;
}

function matchWebhookTransaction(eventPayload, fallbackSessionId) {
    const transactions = readTransactions();
    const eventTransactionId = eventPayload?.transactionId || eventPayload?.transaction_id || null;
    const eventSessionId = eventPayload?.paymentSessionId || eventPayload?.sessionId || fallbackSessionId || null;
    const session = eventSessionId ? paymentSessions.get(eventSessionId) : null;
    const transaction = transactionId => transactions.find((item) => item.id === transactionId && item.type === 'deposit');
    if (eventTransactionId) {
        const matched = transaction(eventTransactionId);
        if (matched) return { transactions, transaction: matched, session };
    }
    if (session) {
        const matched = transactions.find((item) => item.id === session.transactionId && item.type === 'deposit');
        if (matched) return { transactions, transaction: matched, session };
    }
    return { transactions, transaction: null, session: null };
}

function accountSummary(user) {
    const transactions = readTransactions().filter((transaction) => transaction.email === user.email);
    const deposits = transactions.filter((transaction) => transaction.type === 'deposit' && transaction.status === 'completed').reduce((total, transaction) => total + transaction.amount, 0);
    const withdrawals = transactions.filter((transaction) => transaction.type === 'withdrawal' && transaction.status === 'completed').reduce((total, transaction) => total + transaction.amount, 0);
    const startingBalance = Number(user.startingBalance ?? 0);
    const startingContributed = Number(user.startingContributed ?? 0);
    const balance = Math.max(0, startingBalance + deposits - withdrawals);
    const contributed = Math.max(0, startingContributed + deposits - withdrawals);
    const availableCash = Math.max(0, deposits - withdrawals);
    return { balance: Number(balance.toFixed(2)), contributed: Number(contributed.toFixed(2)), availableCash: Number(availableCash.toFixed(2)) };
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.on('data', (chunk) => { body += chunk; if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) request.destroy(); });
        request.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); } });
        request.on('error', reject);
    });
}

async function handleApi(request, response) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const origin = request.headers.origin || '';
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Access-Control-Allow-Credentials', 'true');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
        response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') return response.writeHead(204).end();
    if (request.method === 'POST' && (url.pathname === '/api/auth/signup' || url.pathname === '/api/auth/login')) {
        try {
            const { email, password, firstName, lastName, referral } = await readBody(request);
            const normalizedEmail = String(email || '').trim().toLowerCase();
            if (!/^\S+@\S+\.\S+$/.test(normalizedEmail) || typeof password !== 'string' || password.length < 8) {
                return sendJson(response, 400, { error: 'Enter a valid email and a password of at least 8 characters.' });
            }
            const users = readUsers();
            const existing = users.find((user) => user.email === normalizedEmail);
            if (url.pathname.endsWith('signup')) {
                if (existing) return sendJson(response, 409, { error: 'An account with this email already exists.' });
                const cleanFirstName = String(firstName || '').trim().slice(0, 40);
                const cleanLastName = String(lastName || '').trim().slice(0, 40);
                if (!cleanFirstName || !cleanLastName) return sendJson(response, 400, { error: 'Enter your first and last name.' });
                const referralInput = String(referral || '').trim().toUpperCase();
                if (referralInput && !users.some((user) => user.referralCode === referralInput)) return sendJson(response, 400, { error: 'That referral code was not found.' });
                users.push({ email: normalizedEmail, firstName: cleanFirstName, lastName: cleanLastName, passwordHash: await hashPassword(password), referralCode: referralCode(), referredBy: referralInput || null, createdAt: new Date().toISOString(), emailVerified: false, twoFactorEnabled: false });
                writeUsers(users);
                const verificationCode = issueChallenge(verificationChallenges, normalizedEmail);
                await sendAuthCodeEmail(normalizedEmail, verificationCode, 'verification');
                return sendJson(response, 201, { needsVerification: true, ...(mailConfigured ? {} : { verificationCode }) });
            } else if (!existing || !(await passwordMatches(password, existing.passwordHash))) {
                return sendJson(response, 401, { error: 'Email or password is incorrect.' });
            }
            if (existing.emailVerified === false) {
                const verificationCode = issueChallenge(verificationChallenges, normalizedEmail);
                await sendAuthCodeEmail(normalizedEmail, verificationCode, 'verification');
                return sendJson(response, 403, { error: 'Verify your email before logging in.', needsVerification: true, ...(mailConfigured ? {} : { verificationCode }) });
            }
            if (existing.twoFactorEnabled) {
                const challengeToken = crypto.randomBytes(24).toString('hex');
                twoFactorChallenges.set(challengeToken, { email: normalizedEmail, expiresAt: Date.now() + 10 * 60 * 1000 });
                return sendJson(response, 200, { needsTwoFactor: true, challengeToken });
            }
            const token = crypto.randomBytes(32).toString('hex');
            sessions.set(token, normalizedEmail);
            return sendJson(response, 200, { user: publicUser(existing) }, { 'Set-Cookie': sessionCookie(token) });
        } catch (error) {
            return sendJson(response, 400, { error: error.message });
        }
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/verify-email') {
        try {
            const { email, verificationCode } = await readBody(request);
            const normalizedEmail = String(email || '').trim().toLowerCase();
            const users = readUsers();
            const user = users.find((item) => item.email === normalizedEmail);
            if (!user || !consumeChallenge(verificationChallenges, normalizedEmail, verificationCode)) return sendJson(response, 400, { error: 'That verification code is invalid or expired.' });
            user.emailVerified = true;
            writeUsers(users);
            const token = crypto.randomBytes(32).toString('hex');
            sessions.set(token, normalizedEmail);
            return sendJson(response, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
        } catch (error) { return sendJson(response, 400, { error: error.message }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/forgot-password') {
        try {
            const { email } = await readBody(request);
            const normalizedEmail = String(email || '').trim().toLowerCase();
            const user = readUsers().find((item) => item.email === normalizedEmail);
            if (!user) return sendJson(response, 200, { message: 'If that account exists, a reset code has been sent.' });
            const resetCode = issueChallenge(resetChallenges, normalizedEmail);
            await sendAuthCodeEmail(normalizedEmail, resetCode, 'password reset');
            return sendJson(response, 200, { message: 'If that account exists, a reset code has been sent.', ...(mailConfigured ? {} : { resetCode }) });
        } catch (error) { return sendJson(response, 400, { error: error.message }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/reset-password') {
        try {
            const { email, resetCode, password } = await readBody(request);
            const normalizedEmail = String(email || '').trim().toLowerCase();
            if (typeof password !== 'string' || password.length < 8) return sendJson(response, 400, { error: 'Password must be at least 8 characters.' });
            const users = readUsers();
            const user = users.find((item) => item.email === normalizedEmail);
            if (!user || !consumeChallenge(resetChallenges, normalizedEmail, resetCode)) return sendJson(response, 400, { error: 'That reset code is invalid or expired.' });
            user.passwordHash = await hashPassword(password);
            writeUsers(users);
            return sendJson(response, 200, { message: 'Password reset successfully.' });
        } catch (error) { return sendJson(response, 400, { error: error.message }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/2fa/verify') {
        try {
            const { challengeToken, verificationCode } = await readBody(request);
            const challenge = twoFactorChallenges.get(challengeToken);
            twoFactorChallenges.delete(challengeToken);
            if (!challenge || challenge.expiresAt <= Date.now() || String(verificationCode || '') !== '000000') return sendJson(response, 401, { error: 'The authentication code is invalid or expired.' });
            const token = crypto.randomBytes(32).toString('hex');
            sessions.set(token, challenge.email);
            const user = readUsers().find((item) => item.email === challenge.email);
            return sendJson(response, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
        } catch (error) { return sendJson(response, 400, { error: error.message }); }
    }
    if (request.method === 'GET' && url.pathname === '/api/auth/me') {
        const user = currentUser(request);
        return user ? sendJson(response, 200, { user: publicUser(user) }) : sendJson(response, 401, { error: 'Not authenticated.' });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/profile') {
        const user = currentUser(request);
        if (!user) return sendJson(response, 401, { error: 'Not authenticated.' });
        try {
            const { firstName, lastName, email, avatar, accountDetails } = await readBody(request);
            const users = readUsers();
            const stored = users.find((item) => item.email === user.email);
            if (!stored) return sendJson(response, 404, { error: 'User not found.' });
            const nextFirstName = String((firstName ?? stored.firstName) || '').trim().slice(0, 40);
            const nextLastName = String((lastName ?? stored.lastName) || '').trim().slice(0, 40);
            const nextEmail = String((email ?? stored.email) || '').trim().toLowerCase();
            const nextAvatar = typeof avatar === 'string' && avatar.trim() ? avatar.trim() : stored.avatar || '';
            if (!nextFirstName || !nextLastName) return sendJson(response, 400, { error: 'First and last name are required.' });
            if (!/^\S+@\S+\.\S+$/.test(nextEmail)) return sendJson(response, 400, { error: 'Enter a valid email address.' });
            const emailTaken = users.some((item) => item.email === nextEmail && item.email !== stored.email);
            if (emailTaken) return sendJson(response, 409, { error: 'An account with that email already exists.' });
            const previousEmail = stored.email;
            stored.firstName = nextFirstName;
            stored.lastName = nextLastName;
            stored.email = nextEmail;
            stored.avatar = nextAvatar;
            const nextAccountDetails = accountDetails && typeof accountDetails === 'object' ? {
                phone: String(accountDetails.phone || '').trim().slice(0, 30),
                country: String(accountDetails.country || '').trim().slice(0, 80),
                address: String(accountDetails.address || '').trim().slice(0, 160),
                city: String(accountDetails.city || '').trim().slice(0, 80),
                postalCode: String(accountDetails.postalCode || '').trim().slice(0, 20)
            } : stored.accountDetails || {};
            stored.accountDetails = nextAccountDetails;
            writeUsers(users);
            if (previousEmail !== nextEmail) {
                for (const [token, sessionEmail] of sessions.entries()) {
                    if (sessionEmail === previousEmail) sessions.set(token, nextEmail);
                }
                const transactions = readTransactions().map((transaction) => transaction.email === previousEmail ? { ...transaction, email: nextEmail } : transaction);
                writeTransactions(transactions);
            }
            return sendJson(response, 200, { user: { ...publicUser(stored), avatar: stored.avatar || '' } });
        } catch (error) { return sendJson(response, 400, { error: error.message }); }
    }
    if (request.method === 'GET' && url.pathname === '/api/transactions') {
        const user = currentUser(request);
        if (!user) return sendJson(response, 401, { error: 'Not authenticated.' });
        const transactions = readTransactions().filter((transaction) => transaction.email === user.email).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return sendJson(response, 200, { transactions: transactions.map(transactionView) });
    }
    if (request.method === 'GET' && url.pathname === '/api/account') {
        const user = currentUser(request);
        if (!user) return sendJson(response, 401, { error: 'Not authenticated.' });
        return sendJson(response, 200, { account: accountSummary(user) });
    }
    if (request.method === 'POST' && url.pathname === '/api/payments/initialize') {
        const user = currentUser(request);
        if (!user) return sendJson(response, 401, { error: 'Not authenticated.' });
        if (!hasAccountDetails(user)) return sendJson(response, 400, { error: accountDetailsError(), needsAccountDetails: true });
        try {
            const { amount, currency } = await readBody(request);
            const numericAmount = Number(amount);
            const normalizedCurrency = String(currency || 'USD').toUpperCase();
            const supportedCurrencies = ['USD', 'EUR', 'GBP', 'NGN', 'CAD', 'AUD', 'JPY', 'CHF', 'AED'];
            if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1000000) return sendJson(response, 400, { error: 'Enter a valid amount.' });
            if (!supportedCurrencies.includes(normalizedCurrency)) return sendJson(response, 400, { error: 'Unsupported currency.' });
            const transaction = { id: `SI-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, email: user.email, type: 'deposit', amount: Number(numericAmount.toFixed(2)), currency: normalizedCurrency, status: 'pending', createdAt: new Date().toISOString(), description: 'Deposit via payment gateway' };
            const transactions = readTransactions();
            transactions.push(transaction);
            writeTransactions(transactions);
            const paymentSessionId = crypto.randomBytes(24).toString('hex');
            paymentSessions.set(paymentSessionId, { transactionId: transaction.id, email: user.email, currency: normalizedCurrency, expiresAt: Date.now() + 10 * 60 * 1000 });
            return sendJson(response, 201, { paymentSessionId, amount: transaction.amount, currency: transaction.currency, methods: ['card', 'bank', 'ussd'] });
        } catch (error) { return sendJson(response, 400, { error: error.message }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/payments/confirm') {
        const user = currentUser(request);
        if (!user) return sendJson(response, 401, { error: 'Not authenticated.' });
        try {
            const { paymentSessionId, paymentMethod, currency, cardDetails } = await readBody(request);
            const session = paymentSessions.get(paymentSessionId);
            if (!session || session.email !== user.email || session.expiresAt <= Date.now() || !['card', 'bank', 'ussd'].includes(paymentMethod)) return sendJson(response, 400, { error: 'This payment session is invalid or expired.' });
            if (paymentMethod === 'card') {
                if (!cardDetails || !String(cardDetails.cardholderName || '').trim() || !/^\d{4}$/.test(String(cardDetails.last4 || '')) || !/^\d{2}\/\d{2}$/.test(String(cardDetails.expiry || ''))) return sendJson(response, 400, { error: 'Card details are required.' });
            }
            const normalizedCurrency = String(currency || session.currency || 'USD').toUpperCase();
            const supportedCurrencies = ['USD', 'EUR', 'GBP', 'NGN', 'CAD', 'AUD', 'JPY', 'CHF', 'AED'];
            if (!supportedCurrencies.includes(normalizedCurrency)) return sendJson(response, 400, { error: 'Unsupported currency.' });
            const transactions = readTransactions();
            const transaction = transactions.find((item) => item.id === session.transactionId && item.email === user.email && (item.status === 'pending' || item.status === 'processing'));
            if (!transaction) return sendJson(response, 409, { error: 'This deposit has already been processed.' });
            transaction.status = 'completed';
            transaction.currency = normalizedCurrency;
            transaction.gatewayReference = `CONFIRMED-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
            transaction.description = `Deposit via ${paymentMethod}`;
            writeTransactions(transactions);
            paymentSessions.delete(paymentSessionId);
            return sendJson(response, 200, { transaction: transactionView(transaction), notification: 'Payment confirmed successfully.' });
        } catch (error) { return sendJson(response, 400, { error: error.message }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/payments/webhook') {
        try {
            const rawBody = await readRawBody(request);
            const signature = webhookSignatureFromHeaders(request);
            const expectedSignature = computeWebhookSignature(rawBody, paymentWebhookSecret);
            const providedSignature = String(signature || '').trim();
            if (!providedSignature || !crypto.timingSafeEqual(Buffer.from(providedSignature.toLowerCase()), Buffer.from(expectedSignature.toLowerCase()))) {
                return sendJson(response, 401, { error: 'Invalid webhook signature.' });
            }
            const event = JSON.parse(rawBody.toString('utf8') || '{}');
            const eventType = String(event.type || '');
            const eventPayload = event.data || {};
            const { transactions, transaction, session } = matchWebhookTransaction(eventPayload, eventPayload.paymentSessionId || eventPayload.sessionId || null);
            if (!transaction) return sendJson(response, 404, { error: 'No matching transaction found for this payment event.' });
            const isSuccessfulEvent = ['payment.succeeded', 'deposit.completed', 'payment.authorized'].includes(eventType);
            const isFailedEvent = ['payment.failed', 'deposit.failed', 'payment.canceled'].includes(eventType);

            if (isSuccessfulEvent) {
                transaction.status = 'completed';
                transaction.gatewayReference = eventPayload.reference || transaction.gatewayReference || `WEBHOOK-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
                transaction.description = `Deposit via ${eventPayload.paymentMethod || eventPayload.method || 'payment provider'}`;
            } else if (isFailedEvent) {
                transaction.status = 'failed';
                transaction.description = 'Deposit failed during provider verification';
            } else {
                return sendJson(response, 202, { received: true, status: transaction.status, eventType });
            }

            if (session) paymentSessions.delete(eventPayload.paymentSessionId || eventPayload.sessionId || null);
            writeTransactions(transactions);
            return sendJson(response, 200, { received: true, eventType, transaction: transactionView(transaction) });
        } catch (error) {
            return sendJson(response, 400, { error: error.message });
        }
    }
    if (request.method === 'POST' && url.pathname === '/api/transactions') {
        const user = currentUser(request);
        if (!user) return sendJson(response, 401, { error: 'Not authenticated.' });
        try {
            const { type, amount } = await readBody(request);
            if (type === 'deposit' && !hasAccountDetails(user)) return sendJson(response, 400, { error: accountDetailsError(), needsAccountDetails: true });
            const numericAmount = Number(amount);
            if (!['deposit', 'withdrawal'].includes(type) || !Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1000000) return sendJson(response, 400, { error: 'Enter a valid amount.' });
            const transaction = { id: crypto.randomUUID(), email: user.email, type, amount: Number(numericAmount.toFixed(2)), status: 'pending', createdAt: new Date().toISOString(), description: type === 'deposit' ? 'Deposit request' : 'Withdrawal request' };
            const transactions = readTransactions();
            transactions.push(transaction);
            writeTransactions(transactions);
            return sendJson(response, 201, { transaction: transactionView(transaction), notification: `${type === 'deposit' ? 'Deposit' : 'Withdrawal'} request submitted.` });
        } catch (error) { return sendJson(response, 400, { error: error.message }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        const token = getCookie(request, 'session');
        if (token) sessions.delete(token);
        return sendJson(response, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    sendJson(response, 404, { error: 'Not found.' });
}

const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) return handleApi(request, response);
    const requestedPath = new URL(request.url, `http://${request.headers.host}`).pathname;
    const filePath = path.normalize(path.join(root, requestedPath === '/' ? 'index.html' : requestedPath));
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        response.writeHead(404); return response.end('Not found');
    }
    response.writeHead(200, { 'Content-Type': staticTypes[path.extname(filePath)] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(response);
});

server.listen(port, () => console.log(`Shanghai Investment running at http://localhost:${port}`));
