const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { randomBytes, scrypt: scryptCallback } = require('node:crypto');

const scrypt = promisify(scryptCallback);
const host = '127.0.0.1';
const port = Number(process.env.PORT) || 3000;
const dataDirectory = path.join(__dirname, 'data');
const usersFile = path.join(dataDirectory, 'users.json');
const maxRequestBytes = 4096;
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
    'clans.html',
    'drontfront.html',
    'giveaways.html',
    'wartycoon.html',
    'DF_logo1.jpg',
    'GW_logo1.png',
    'WT_logo1.png'
].map((file) => [file.toLowerCase(), file]));

let registrationQueue = Promise.resolve();

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

function sendJson(response, status, payload) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    });
    response.end(JSON.stringify(payload));
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
        if (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
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
        return { status: 201, payload: { message: 'Аккаунт создан.' } };
    });

    registrationQueue = task.then(() => undefined, () => undefined);
    try {
        const result = await task;
        sendJson(response, result.status, result.payload);
    } catch (error) {
        console.error('Ошибка сохранения нового пользователя:', error);
        sendJson(response, 500, { error: 'Не удалось сохранить аккаунт. Попробуйте позже.' });
    }
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
    if (requestUrl.pathname === '/api/register') {
        if (request.method !== 'POST') {
            response.writeHead(405, { Allow: 'POST' }).end();
            return;
        }
        await register(request, response);
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
