const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { randomBytes, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');

const scrypt = promisify(scryptCallback);
const host = '127.0.0.1';
const port = Number(process.env.PORT) || 3000;
const dataDirectory = path.join(__dirname, 'data');
const usersFile = path.join(dataDirectory, 'users.json');
const maxRequestBytes = 4096;
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const sessionCookieName = 'turtlehub_session';
const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png'
};
const publicFiles = new Map([
    'Index.html',
    'index.css',
    'index.js',
    'common.css',
    'common.js',
    'drontfront.html',
    'drontfront.css',
    'drontfront.js',
    'giveaways.html',
    'giveaways.css',
    'giveaways.js',
    'wartycoon.html',
    'wartycoon.css',
    'wartycoon.js',
    'DF_logo1.jpg',
    'GW_logo1.png',
    'Turtle_logo1.jpg',
    'WT_logo1.png'
].map((file) => [file.toLowerCase(), file]));

let registrationQueue = Promise.resolve();
const sessions = new Map();

async function readUsers() {
    try {
        const content = await fs.readFile(usersFile, 'utf8');
        const users = JSON.parse(content);
        if (!Array.isArray(users)) {
            throw new Error('Файл базы пользователей должен содержать JSON-массив.');
        }
        return users;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

async function saveUsers(users) {
    const temporaryFile = `${usersFile}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
        await fs.writeFile(temporaryFile, `${JSON.stringify(users, null, 2)}\n`, { flag: 'wx' });
        await fs.rename(temporaryFile, usersFile);
    } catch (error) {
        await fs.rm(temporaryFile, { force: true });
        throw error;
    }
}

function sendJson(response, status, payload, headers = {}) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...headers
    });
    response.end(JSON.stringify(payload));
}

function setSessionCookie(request, response, token, maxAge) {
    const secure = request.socket.encrypted ? '; Secure' : '';
    response.setHeader(
        'Set-Cookie',
        `${sessionCookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
    );
}

function createSession(request, response, username) {
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { username, expiresAt: Date.now() + sessionLifetimeSeconds * 1000 });
    setSessionCookie(request, response, token, sessionLifetimeSeconds);
}

function getSession(request) {
    const cookieHeader = request.headers.cookie || '';
    const cookie = cookieHeader.split(';').map((part) => part.trim())
        .find((part) => part.startsWith(`${sessionCookieName}=`));
    const token = cookie && cookie.slice(sessionCookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;

    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
    }
    return { token, ...session };
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        let tooLarge = false;

        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            if (Buffer.byteLength(body, 'utf8') + Buffer.byteLength(chunk, 'utf8') > maxRequestBytes) {
                tooLarge = true;
                return;
            }
            if (!tooLarge) body += chunk;
        });
        request.on('end', () => {
            if (tooLarge) {
                reject(Object.assign(new Error('Размер запроса слишком большой.'), { status: 413 }));
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch {
                reject(Object.assign(new Error('Переданы некорректные данные.'), { status: 400 }));
            }
        });
        request.on('error', reject);
    });
}

async function register(request, response) {
    if (!request.headers['content-type']?.includes('application/json')) {
        sendJson(response, 415, { error: 'Ожидается запрос с JSON.' });
        return;
    }

    let data;
    try {
        data = await readRequestBody(request);
    } catch (error) {
        sendJson(response, error.status || 400, { error: error.message });
        return;
    }

    const username = data && typeof data.username === 'string' ? data.username.trim() : '';
    const password = data && typeof data.password === 'string' ? data.password : '';

    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
        sendJson(response, 400, { error: 'Логин: от 3 до 20 символов, только латинские буквы, цифры и _.' });
        return;
    }
    if (password.length < 8 || password.length > 128) {
        sendJson(response, 400, { error: 'Пароль должен содержать от 8 до 128 символов.' });
        return;
    }

    const task = registrationQueue.then(async () => {
        const users = await readUsers();
        if (users.some((user) => user && typeof user.username === 'string'
            && user.username.toLowerCase() === username.toLowerCase())) {
            return { status: 409, payload: { error: 'Этот логин уже занят.' } };
        }

        const salt = randomBytes(16);
        const passwordHash = await scrypt(password, salt, 64);
        users.push({
            username,
            salt: salt.toString('hex'),
            passwordHash: passwordHash.toString('hex'),
            createdAt: new Date().toISOString()
        });
        await saveUsers(users);
        return { status: 201, username, payload: { message: 'Аккаунт создан.' } };
    });

    registrationQueue = task.then(() => undefined, () => undefined);
    try {
        const result = await task;
        if (result.username) createSession(request, response, result.username);
        sendJson(response, result.status, result.payload);
    } catch (error) {
        console.error('Ошибка сохранения нового пользователя:', error);
        sendJson(response, 500, { error: 'Не удалось сохранить аккаунт. Попробуйте позже.' });
    }
}

async function login(request, response) {
    if (!request.headers['content-type']?.includes('application/json')) {
        sendJson(response, 415, { error: 'Ожидается запрос с JSON.' });
        return;
    }

    let data;
    try {
        data = await readRequestBody(request);
    } catch (error) {
        sendJson(response, error.status || 400, { error: error.message });
        return;
    }

    const username = data && typeof data.username === 'string' ? data.username.trim() : '';
    const password = data && typeof data.password === 'string' ? data.password : '';
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username) || password.length < 8 || password.length > 128) {
        sendJson(response, 401, { error: 'Неверный логин или пароль.' });
        return;
    }

    try {
        const users = await readUsers();
        const user = users.find((entry) => entry && typeof entry.username === 'string'
            && entry.username.toLowerCase() === username.toLowerCase());
        const validSalt = user && typeof user.salt === 'string' && /^[a-f0-9]{32}$/i.test(user.salt);
        const validHash = user && typeof user.passwordHash === 'string' && /^[a-f0-9]{128}$/i.test(user.passwordHash);
        const salt = validSalt ? Buffer.from(user.salt, 'hex') : randomBytes(16);
        const expectedHash = validHash ? Buffer.from(user.passwordHash, 'hex') : randomBytes(64);
        const passwordHash = await scrypt(password, salt, 64);
        const passwordMatches = timingSafeEqual(passwordHash, expectedHash);

        if (!user || !validSalt || !validHash || !passwordMatches) {
            sendJson(response, 401, { error: 'Неверный логин или пароль.' });
            return;
        }

        createSession(request, response, user.username);
        sendJson(response, 200, { message: 'Вход выполнен.', username: user.username });
    } catch (error) {
        console.error('Ошибка входа пользователя:', error);
        sendJson(response, 500, { error: 'Не удалось выполнить вход. Попробуйте позже.' });
    }
}

function handleSession(request, response) {
    const session = getSession(request);
    if (!session) {
        sendJson(response, 401, { authenticated: false });
        return;
    }
    sendJson(response, 200, { authenticated: true, username: session.username });
}

function logout(request, response) {
    const session = getSession(request);
    if (session) sessions.delete(session.token);
    setSessionCookie(request, response, '', 0);
    sendJson(response, 200, { message: 'Вы вышли из аккаунта.' });
}

async function serveFile(requestPath, response, requestMethod) {
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(requestPath);
    } catch {
        response.writeHead(400).end('Некорректный адрес.');
        return;
    }

    const requestedFile = decodedPath === '/' || decodedPath.toLowerCase() === '/index.html'
        ? 'Index.html'
        : decodedPath.replace(/^[/\\]+/, '');
    const relativePath = publicFiles.get(requestedFile.toLowerCase());
    if (!relativePath) {
        response.writeHead(404).end('Страница не найдена.');
        return;
    }
    const filePath = path.resolve(__dirname, relativePath);
    if (!filePath.startsWith(`${path.resolve(__dirname)}${path.sep}`)) {
        response.writeHead(404).end('Страница не найдена.');
        return;
    }

    try {
        const file = await fs.readFile(filePath);
        response.writeHead(200, {
            'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff'
        });
        response.end(requestMethod === 'HEAD' ? undefined : file);
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'EISDIR') {
            response.writeHead(404).end('Страница не найдена.');
            return;
        }
        throw error;
    }
}

async function handleRequest(request, response) {
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const apiRoutes = {
        '/api/register': { method: 'POST', handler: register },
        '/api/login': { method: 'POST', handler: login },
        '/api/me': { method: 'GET', handler: handleSession },
        '/api/logout': { method: 'POST', handler: logout }
    };
    const apiRoute = apiRoutes[requestUrl.pathname];
    if (apiRoute) {
        if (request.method !== apiRoute.method) {
            response.writeHead(405, { Allow: apiRoute.method }).end();
            return;
        }
        await apiRoute.handler(request, response);
        return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
    }
    await serveFile(requestUrl.pathname, response, request.method);
}

async function start() {
    await fs.mkdir(dataDirectory, { recursive: true });
    const server = http.createServer((request, response) => {
        handleRequest(request, response).catch((error) => {
            console.error('Ошибка обработки запроса:', error);
            if (!response.headersSent) {
                sendJson(response, 500, { error: 'Внутренняя ошибка сервера.' });
            } else {
                response.destroy(error);
            }
        });
    });

    server.listen(port, host, () => {
        console.log(`TurtleHub запущен: http://${host}:${port}`);
        console.log(`Файл базы пользователей: ${usersFile}`);
    });
}

start().catch((error) => {
    console.error('Не удалось запустить сервер:', error);
    process.exitCode = 1;
});
