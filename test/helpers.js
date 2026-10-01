'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');

function startServer(env, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        AUTH_USER: '',
        AUTH_PASS: '',
        ALLOW_ANONYMOUS: 'false',
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Server did not start on ${port}. stdout=${stdout} stderr=${stderr}`));
    }, 15000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (!settled && stdout.includes('Dashboard running at')) {
        settled = true;
        clearTimeout(timer);
        resolve({ child, stop: () => stopServer(child) });
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code}. stderr=${stderr}`));
    });
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill();
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} resolve(); }, 3000).unref();
  });
}

function runToExit(env, port) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: REPO_ROOT,
      env: { ...process.env, PORT: String(port), ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

function basicHeader(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
}

module.exports = { REPO_ROOT, startServer, stopServer, runToExit, basicHeader };