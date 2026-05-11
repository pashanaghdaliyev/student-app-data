// Student App Admin Panel — şifrələ + GitHub release yarat
//
// Eyni AES key Flutter app-da və PowerShell skriptində istifadə olunur.
// DİQQƏT: bu açar dəyişərsə, app-da da dəyişdirilməlidir.

const CONFIG = {
  aesKeyBase64: 'FvMnSyhFLsL+MlhzSFfTjRqQ/d2cstlzGHGZHnE8Y24=',
  repo: 'pashanaghdaliyev/student-app-data',
  assetName: 'quiz_maker.db.enc',
  adminCode: '2026',   // bu kodu dəyişə bilərsiniz — sadəcə brauzer tərəfi
};

// ------------------- helpers -------------------

const $ = (id) => document.getElementById(id);

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
  const url = path.startsWith('http')
    ? path
    : 'https://api.github.com' + path;
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
    throw new Error(`GitHub API ${res.status}: ${body.substring(0, 200)}`);
  }
  return res;
}

async function fetchLatestRelease(token) {
  try {
    const res = await ghRequest(token, `/repos/${CONFIG.repo}/releases/latest`);
    return res.json();
  } catch (e) {
    return null;
  }
}

function nextVersion(latestTag) {
  if (!latestTag) return 'v1';
  const m = String(latestTag).match(/v(\d+)/);
  if (!m) return 'v1';
  return 'v' + (parseInt(m[1], 10) + 1);
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
    setMsg('loginMsg', 'error', 'Token yanlışdır və ya icazəsi yoxdur: ' + e.message);
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
  $('latestVersion').textContent = 'Son versiya yüklənir...';
  const token = localStorage.getItem('gh_token');
  const latest = await fetchLatestRelease(token);
  if (latest) {
    $('latestVersion').innerHTML = `Son versiya: <b>${latest.tag_name}</b> (${new Date(latest.published_at).toLocaleDateString('az')})`;
    $('version').value = nextVersion(latest.tag_name);
  } else {
    $('latestVersion').textContent = 'Hələ release yoxdur';
    $('version').value = 'v1';
  }
}

// ------------------- upload -------------------

async function doUpload() {
  clearMsg('uploadMsg');
  const file = $('dbFile').files[0];
  const version = $('version').value.trim();
  const notes = $('notes').value.trim() || 'Sualların yenilənməsi';
  const token = localStorage.getItem('gh_token');

  if (!file) {
    setMsg('uploadMsg', 'error', 'Fayl seçin');
    return;
  }
  if (!version) {
    setMsg('uploadMsg', 'error', 'Versiya yazın (məs. v3)');
    return;
  }
  if (!/^v\d+/i.test(version)) {
    setMsg('uploadMsg', 'error', 'Versiya v1, v2, v3... formatında olmalıdır');
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

    setMsg('uploadMsg', 'info', `2/3 Release yaradılır (${version})...`);
    const createRes = await ghRequest(token, `/repos/${CONFIG.repo}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: version,
        target_commitish: 'main',
        name: version,
        body: notes,
        draft: false,
        prerelease: false,
      }),
    });
    const release = await createRes.json();
    const uploadUrl = release.upload_url.replace(
      /\{[^}]*\}/,
      `?name=${encodeURIComponent(CONFIG.assetName)}`
    );

    setMsg('uploadMsg', 'info', `3/3 Fayl yüklənir (${(encrypted.length / 1024 / 1024).toFixed(2)} MB)...`);
    await ghRequest(token, uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: encrypted,
    });

    setMsg('uploadMsg', 'success',
      `Uğurlu! Versiya ${version} yükləndi. App növbəti açılışda yeni sualları gətirir.`);
    $('dbFile').value = '';
    $('version').value = nextVersion(version);
    $('latestVersion').innerHTML = `Son versiya: <b>${version}</b> (indi)`;
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

  // Avtomatik login (yadda saxlanmış token)
  const savedToken = localStorage.getItem('gh_token');
  if (savedToken) {
    $('ghToken').value = savedToken;
    // Kodu da soruşmadan auto-login etməyək — sadəcə tokeni doldur
  }
}

init();
