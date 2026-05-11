// Student App Admin Panel — şifrələ + GitHub Contents API ilə fayl yenilə
//
// Eyni AES key Flutter app-da və PowerShell skriptində istifadə olunur.

const CONFIG = {
  aesKeyBase64: 'FvMnSyhFLsL+MlhzSFfTjRqQ/d2cstlzGHGZHnE8Y24=',
  repo: 'pashanaghdaliyev/student-app-data',
  filePath: 'data/quiz_maker.db.enc',
  branch: 'main',
  adminCode: '2026',
};

// ------------------- helpers -------------------

const $ = (id) => document.getElementById(id);

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function setMsg(elId, type, text) {
  const el = $(elId);
  el.className = 'msg ' + type;
  el.textContent = text;
}

function clearMsg(elId) {
  $(elId).className = '';
  $(elId).textContent = '';
}

async function aesEncryptCBC(plaintext, keyBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv }, key, plaintext
  );
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);
  return result;
}

async function ghRequest(token, path, options = {}) {
  const url = path.startsWith('http') ? path : 'https://api.github.com' + path;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body.substring(0, 300)}`);
  }
  return res;
}

async function getCurrentFileSha(token) {
  // Mövcud faylın SHA-ı. Cache bypass üçün timestamp query.
  try {
    const url = `/repos/${CONFIG.repo}/contents/${CONFIG.filePath}?ref=${CONFIG.branch}&t=${Date.now()}`;
    const res = await ghRequest(token, url);
    const json = await res.json();
    return json.sha;
  } catch (e) {
    if (String(e.message).includes('404')) return null;
    throw e;
  }
}

async function getLastUpdated(token) {
  try {
    const res = await ghRequest(token,
      `/repos/${CONFIG.repo}/commits?path=${encodeURIComponent(CONFIG.filePath)}&per_page=1`);
    const arr = await res.json();
    if (Array.isArray(arr) && arr.length > 0) {
      return new Date(arr[0].commit.author.date);
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ------------------- login -------------------

function attachPwToggles() {
  document.querySelectorAll('.pw-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = $(btn.dataset.target);
      target.type = target.type === 'password' ? 'text' : 'password';
      btn.innerHTML = target.type === 'password' ? '&#128065;' : '&#128064;';
    });
  });
}

function showCard(which) {
  $('loginCard').classList.toggle('hidden', which !== 'login');
  $('uploadCard').classList.toggle('hidden', which !== 'upload');
}

async function doLogin() {
  clearMsg('loginMsg');
  const code = $('adminCode').value.trim();
  const token = $('ghToken').value.trim();

  if (code !== CONFIG.adminCode) {
    setMsg('loginMsg', 'error', 'Admin kodu yanlışdır');
    return;
  }
  if (!token) {
    setMsg('loginMsg', 'error', 'GitHub token daxil edin');
    return;
  }

  setMsg('loginMsg', 'info', 'Token yoxlanılır...');
  try {
    const res = await ghRequest(token, '/user');
    const user = await res.json();
    localStorage.setItem('gh_token', token);
    localStorage.setItem('gh_user', user.login || '');
    clearMsg('loginMsg');
    showUploadScreen();
  } catch (e) {
    setMsg('loginMsg', 'error', 'Token yanlışdır: ' + e.message);
  }
}

function doLogout() {
  localStorage.removeItem('gh_token');
  localStorage.removeItem('gh_user');
  $('adminCode').value = '';
  $('ghToken').value = '';
  showCard('login');
}

async function showUploadScreen() {
  showCard('upload');
  $('latestVersion').textContent = 'Status yüklənir...';
  const token = localStorage.getItem('gh_token');
  const last = await getLastUpdated(token);
  if (last) {
    $('latestVersion').innerHTML =
      `Son yeniləmə: <b>${last.toLocaleString('az')}</b>`;
  } else {
    $('latestVersion').textContent = 'Sual bazası hələ yüklənməyib';
  }
}

// ------------------- upload -------------------

async function doUpload() {
  clearMsg('uploadMsg');
  const file = $('dbFile').files[0];
  const notes = $('notes').value.trim() || 'Sualların yenilənməsi';
  const token = localStorage.getItem('gh_token');

  if (!file) {
    setMsg('uploadMsg', 'error', 'Fayl seçin');
    return;
  }
  if (!token) {
    setMsg('uploadMsg', 'error', 'Token yoxdur, yenidən daxil olun');
    return;
  }

  const btn = $('uploadBtn');
  btn.disabled = true;
  btn.textContent = 'İşləyir...';

  try {
    setMsg('uploadMsg', 'info', '1/3 Fayl şifrələnir...');
    const plaintext = new Uint8Array(await file.arrayBuffer());
    const keyBytes = base64ToBytes(CONFIG.aesKeyBase64);
    const encrypted = await aesEncryptCBC(plaintext, keyBytes);

    const contentB64 = bytesToBase64(encrypted);
    const mbSize = (encrypted.length / 1024 / 1024).toFixed(2);
    // GitHub Contents API eventual consistency: 5 dəfə artan gözləmə ilə cəhd
    const delays = [0, 2000, 4000, 6000, 8000];
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (delays[attempt] > 0) {
        await new Promise(r => setTimeout(r, delays[attempt]));
      }
      setMsg('uploadMsg', 'info',
        `Yüklənir (${mbSize} MB) — cəhd ${attempt + 1}/5...`);

      const currentSha = await getCurrentFileSha(token);
      const body = {
        message: notes,
        content: contentB64,
        branch: CONFIG.branch,
      };
      if (currentSha) body.sha = currentSha;
      try {
        await ghRequest(token,
          `/repos/${CONFIG.repo}/contents/${CONFIG.filePath}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (!String(e.message).includes('409')) throw e;
        // SHA mismatch — növbəti dövrədə təzə SHA götürərək yenidən cəhd
      }
    }
    if (lastError) {
      throw new Error('GitHub cache yenilənmir. Bir neçə dəqiqə sonra yenidən cəhd edin.');
    }

    setMsg('uploadMsg', 'success',
      'Uğurlu! App növbəti açılışda yeni sualları gətirir.');
    $('dbFile').value = '';
    $('latestVersion').innerHTML =
      `Son yeniləmə: <b>${new Date().toLocaleString('az')}</b>`;
  } catch (e) {
    setMsg('uploadMsg', 'error', 'Xəta: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Şifrələ və Yüklə';
  }
}

// ------------------- init -------------------

function init() {
  attachPwToggles();
  $('loginBtn').addEventListener('click', doLogin);
  $('logoutBtn').addEventListener('click', doLogout);
  $('uploadBtn').addEventListener('click', doUpload);
  $('adminCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('ghToken').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  const savedToken = localStorage.getItem('gh_token');
  if (savedToken) $('ghToken').value = savedToken;
}

init();
