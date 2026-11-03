
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  getDoc,
  doc,
  updateDoc,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

import { firebaseConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let registrations = [];
let publicTeams = [];
let unsubAdmin = null;
let isAdmin = false;

const esc = s => String(s ?? '').replace(
  /[&<>"']/g,
  c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c])
);

function msg(id, text, error = false) {
  $(id).innerHTML = text
    ? `<div class="notice ${error ? 'error' : ''}">${esc(text)}</div>`
    : '';
}

function err(e) {
  if (e?.code === 'permission-denied' ||
      e?.code === 'auth/permission-denied') {
    return 'Acesso negado. Verifique as regras e a autorização de ADM.';
  }

  if (e?.code === 'auth/invalid-credential') {
    return 'E-mail ou senha incorretos.';
  }

  if (e?.code === 'auth/too-many-requests') {
    return 'Muitas tentativas. Aguarde alguns minutos.';
  }

  return e?.message || 'Erro inesperado. Tente novamente.';
}

// LOGO: aceita imagens originais acima de 2 MB.
// Compacta automaticamente para armazenamento no Firestore.
async function shrink(file) {
  if (!file) return '';

  const allowed = [
    'image/jpeg',
    'image/png',
    'image/webp'
  ];

  if (!allowed.includes(file.type)) {
    throw Error('Use uma imagem JPG, PNG ou WEBP.');
  }

  let source;

  try {
    source = await createImageBitmap(file);
  } catch {
    throw Error('Não foi possível abrir essa imagem. Tente outra.');
  }

  try {
    const canvas = document.createElement('canvas');
    const maxDimension = 320;
    const scale = Math.min(
      1,
      maxDimension / Math.max(source.width, source.height)
    );

    canvas.width = Math.max(
      1,
      Math.round(source.width * scale)
    );

    canvas.height = Math.max(
      1,
      Math.round(source.height * scale)
    );

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

    // Mantém o resultado compacto para o limite do Firestore.
    let quality = 0.8;
    let result = canvas.toDataURL('image/jpeg', quality);

    while (result.length > 180000 && quality > 0.25) {
      quality -= 0.1;
      result = canvas.toDataURL('image/jpeg', quality);
    }

    if (result.length > 180000) {
      throw Error(
        'Não foi possível compactar esta logo. Tente outra imagem.'
      );
    }

    return result;
  } finally {
    source.close();
  }
}

// INSCRIÇÕES
$('signup').addEventListener('submit', async e => {
  e.preventDefault();

  const button = $('submitBtn');
  button.disabled = true;

  msg('signupMsg', 'Enviando inscrição...');

  try {
    const f = new FormData(e.target);

    const data = {
      team: String(f.get('team') ?? '').trim(),
      leader: String(f.get('leader') ?? '').trim(),
      contact: String(f.get('contact') ?? '').trim(),
      rush: String(f.get('rush') ?? '').trim(),
      rush2: String(f.get('rush2') ?? '').trim(),
      grenadier: String(f.get('grenadier') ?? '').trim(),
      support: String(f.get('support') ?? '').trim(),
      logo: await shrink($('logo').files[0]),
      status: 'pending',
      createdAt: serverTimestamp()
    };

    const required = [
      'team',
      'leader',
      'contact',
      'rush',
      'rush2',
      'grenadier',
      'support'
    ];

    if (required.some(key => !data[key])) {
      throw Error('Preencha todos os campos obrigatórios.');
    }

    await addDoc(collection(db, 'registrations'), data);

    e.target.reset();

    msg(
      'signupMsg',
      'Inscrição enviada! Aguarde a análise da organização.'
    );
  } catch (ex) {
    msg('signupMsg', err(ex), true);
  } finally {
    button.disabled = false;
  }
});

// BOTÃO ÁREA ADM - COMPUTADOR E CELULAR
const adminToggle = $('adminToggle');
const adminPanel = $('adminPanel');

adminToggle.type = 'button';

adminToggle.addEventListener('click', e => {
  e.preventDefault();

  const opening = adminPanel.classList.contains('hide');

  adminPanel.classList.toggle('hide');

  if (opening) {
    requestAnimationFrame(() => {
      adminPanel.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });
  }
});

// LOGIN DO ADMINISTRADOR
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();

  msg('adminMsg', 'Autenticando...');

  try {
    await signInWithEmailAndPassword(
      auth,
      $('email').value.trim(),
      $('password').value
    );

    msg('adminMsg', '');
  } catch (ex) {
    msg('adminMsg', err(ex), true);
  }
});

// SAIR DO PAINEL
$('logout').addEventListener('click', async () => {
  try {
    await signOut(auth);
    msg('adminMsg', 'Você saiu do painel administrativo.');
  } catch (ex) {
    msg('adminMsg', err(ex), true);
  }
});

$('filter').addEventListener('change', renderAdmin);

// EQUIPES PÚBLICAS
function renderPublic() {
  const approved = publicTeams.filter(
    x => x.status === 'approved'
  );

  const reserve = publicTeams.filter(
    x => x.status === 'reserve'
  );

  $('approvedCount').textContent = String(approved.length);
  $('reserveCount').textContent = String(reserve.length);

  function card(x) {
    const logo = x.logo
      ? `<img src="${esc(x.logo)}" alt="Logo da line ${esc(x.team)}">`
      : '<div class="teamlogo-placeholder">FF</div>';

    const status = x.status === 'approved'
      ? 'LINE CONFIRMADA'
      : 'LINE RESERVA';

    return `
      <div class="public-card">
        ${logo}
        <div>
          <strong>${esc(x.team)}</strong>
          <div class="muted">${status}</div>
        </div>
      </div>
    `;
  }

  $('publicTeams').innerHTML = approved.length
    ? approved.map(card).join('')
    : '<p class="muted">Nenhuma equipe confirmada ainda.</p>';

  $('reserveTeams').innerHTML = reserve.length
    ? reserve.map(card).join('')
    : '<p class="muted">Nenhuma equipe na reserva ainda.</p>';
}

// ATUALIZAÇÃO DAS EQUIPES EM TEMPO REAL
onSnapshot(
  collection(db, 'publicTeams'),
  snap => {
    publicTeams = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    renderPublic();
  },
  e => {
    $('publicTeams').textContent =
      'Não foi possível carregar as equipes.';
    console.error(e);
  }
);

// REGRAS DO XTREINO
onSnapshot(
  doc(db, 'settings', 'xt'),
  snap => {
    const rules = snap.data()?.rules;

    if (rules) {
      $('rulesText').textContent = rules;
      $('rulesText').style.whiteSpace = 'pre-wrap';
      $('rulesEdit').value = rules;
    } else {
      $('rulesEdit').value =
        '4 quedas: Bermuda, Purgatório, Kalahari e Nova Terra.\n' +
        'Pontuação LBFF 2021.\n' +
        'Sem cavalo. Apenas carro para locomoção.\n' +
        'Não pode marcar na loja.\n' +
        'Sem trapaças. Máximo de 1 emulador por equipe.';
    }
  },
  e => console.error(e)
);

// VERIFICAÇÃO DE ADMINISTRADOR AUTORIZADO
onAuthStateChanged(auth, async user => {
  if (unsubAdmin) {
    unsubAdmin();
    unsubAdmin = null;
  }

  isAdmin = false;

  $('adminContent').classList.add('hide');
  $('loginBox').classList.remove('hide');

  if (!user) return;

  try {
    const permit = await getDoc(
      doc(db, 'admins', user.uid)
    );

    if (!permit.exists()) {
      msg(
        'adminMsg',
        'Esta conta não está autorizada como administrador.',
        true
      );

      await signOut(auth);
      return;
    }

    isAdmin = true;

    $('loginBox').classList.add('hide');
    $('adminContent').classList.remove('hide');
    adminPanel.classList.remove('hide');

    msg('adminMsg', '');

    unsubAdmin = onSnapshot(
      query(
        collection(db, 'registrations'),
        orderBy('createdAt', 'desc')
      ),
      snap => {
        registrations = snap.docs.map(d => ({
          id: d.id,
          ...d.data()
        }));

        renderAdmin();
      },
      e => msg('adminMsg', err(e), true)
    );
  } catch (ex) {
    msg('adminMsg', err(ex), true);
  }
});

// PAINEL DE INSCRIÇÕES ADM
function renderAdmin() {
  const pending = registrations.filter(
    x => x.status === 'pending'
  );

  const approved = registrations.filter(
    x => x.status === 'approved'
  );

  const reserve = registrations.filter(
    x => x.status === 'reserve'
  );

  $('pendingAdmin').textContent = pending.length;
  $('approvedAdmin').textContent = approved.length + '/12';
  $('reserveAdmin').textContent = reserve.length;

  const filter = $('filter').value;

  const list = registrations.filter(
    x => filter === 'all' || x.status === filter
  );

  $('adminList').innerHTML = list.length
    ? list.map(x => `
      <div class="item">
        <div class="teamline">
          ${x.logo
            ? `<img class="teamlogo" src="${esc(x.logo)}" alt="Logo">`
            : ''}
          <strong>${esc(x.team)}</strong>
          <span class="pill">${esc(x.status)}</span>
        </div>

        <p class="muted">
          Líder: ${esc(x.leader)}
          | Contato: ${esc(x.contact)}
          <br>
          Rush: ${esc(x.rush)}
          | 2º rush: ${esc(x.rush2)}
          <br>
          Granadeiro: ${esc(x.grenadier)}
          | Suporte: ${esc(x.support)}
        </p>

        <div class="row admin-actions">
          <button
            data-id="${esc(x.id)}"
            data-status="approved">
            Aprovar titular
          </button>

          <button
            class="secondary"
            data-id="${esc(x.id)}"
            data-status="reserve">
            Reserva
          </button>

          <button
            class="danger"
            data-id="${esc(x.id)}"
            data-status="rejected">
            Recusar
          </button>

          <button
            class="secondary"
            data-id="${esc(x.id)}"
            data-status="pending">
            Pendente
          </button>
        </div>
      </div>
    `).join('')
    : '<p class="muted">Nenhuma inscrição nesta categoria.</p>';
}

// APROVAR, RESERVAR OU RECUSAR EQUIPES
$('adminList').addEventListener('click', async e => {
  const button = e.target.closest('button[data-id]');

  if (!button || !isAdmin) return;

  const team = registrations.find(
    x => x.id === button.dataset.id
  );

  if (!team) return;

  const status = button.dataset.status;

  const approvedCount = registrations.filter(
    x => x.status === 'approved' && x.id !== team.id
  ).length;

  if (status === 'approved' && approvedCount >= 12) {
    msg(
      'adminMsg',
      'As 12 vagas titulares já estão ocupadas. Mova uma equipe para reserva antes.',
      true
    );
    return;
  }

  button.disabled = true;

  try {
    await updateDoc(
      doc(db, 'registrations', team.id),
      { status }
    );

    if (status === 'approved' || status === 'reserve') {
      await setDoc(
        doc(db, 'publicTeams', team.id),
        {
          team: team.team,
          logo: team.logo || '',
          status
        }
      );
    } else {
      await setDoc(
        doc(db, 'publicTeams', team.id),
        {
          team: team.team,
          logo: '',
          status: 'hidden'
        }
      );
    }

    msg('adminMsg', 'Status atualizado.');
  } catch (ex) {
    msg('adminMsg', err(ex), true);
  } finally {
    button.disabled = false;
  }
});

// SALVAR REGRAS
$('saveRules').addEventListener('click', async () => {
  if (!isAdmin) return;

  try {
    await setDoc(
      doc(db, 'settings', 'xt'),
      {
        rules: $('rulesEdit').value.trim()
      }
    );

    msg('adminMsg', 'Regras atualizadas.');
  } catch (ex) {
    msg('adminMsg', err(ex), true);
  }
});
