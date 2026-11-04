
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  deleteDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let admin = false;
let teams = [];
let matches = [];
let unsubMatches = null;

const maps = ['Bermuda', 'Purgatório', 'Kalahari', 'Nova Terra'];
const placementPoints = [12, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0];

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));

function message(text, error = false) {
  const target = $('xtMessage');
  if (target) {
    target.textContent = text;
    target.style.color = error ? '#ff7777' : '#86efac';
  }
}

function pointsFor(position, kills) {
  const p = Number(position);
  const k = Number(kills);
  if (!Number.isInteger(p) || p < 1 || p > 12 ||
      !Number.isInteger(k) || k < 0) {
    throw Error('Colocação ou número de abates inválido.');
  }
  return placementPoints[p - 1] + k;
}

function normalizeTeam(x) {
  return {
    id: x.id,
    name: x.team || x.name || 'Equipe',
    logo: x.logo || '',
    captainUid: x.captainUid || ''
  };
}

function teamOptions(selected = '') {
  return teams.map(team =>
    `<option value="${esc(team.id)}" ${team.id === selected ? 'selected' : ''}>${esc(team.name)}</option>`
  ).join('');
}

function renderRanking() {
  const totals = new Map();

  for (const team of teams) {
    totals.set(team.id, {
      ...team,
      points: 0,
      kills: 0,
      matches: 0,
      booyahs: 0
    });
  }

  for (const match of matches) {
    for (const result of match.results || []) {
      const team = totals.get(result.teamId);
      if (!team) continue;

      team.points += pointsFor(result.position, result.kills);
      team.kills += Number(result.kills);
      team.matches++;
      if (Number(result.position) === 1) team.booyahs++;
    }
  }

  const ranking = [...totals.values()].sort(
    (a, b) => b.points - a.points ||
      b.booyahs - a.booyahs ||
      b.kills - a.kills ||
      a.name.localeCompare(b.name)
  );

  const target = $('ranking');
  if (!target) return;

  target.innerHTML = ranking.length
    ? `<table>
        <thead>
          <tr>
            <th>#</th><th>Equipe</th><th>Pontos</th>
            <th>Abates</th><th>Booyahs</th><th>Quedas</th>
          </tr>
        </thead>
        <tbody>
          ${ranking.map((team, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${esc(team.name)}</td>
              <td>${team.points}</td>
              <td>${team.kills}</td>
              <td>${team.booyahs}</td>
              <td>${team.matches}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
    : '<p>Nenhuma equipe cadastrada.</p>';
}

function renderHistory() {
  const target = $('matchHistory');
  if (!target) return;

  target.innerHTML = matches.length
    ? matches.map(match => `
      <article class="item">
        <h3>${esc(match.date)} — ${esc(match.map)}</h3>
        <p>Queda ${esc(match.round)} | ${esc(match.day)}</p>
        <table>
          <thead>
            <tr>
              <th>Equipe</th><th>Posição</th>
              <th>Abates</th><th>Pontos</th>
            </tr>
          </thead>
          <tbody>
            ${(match.results || []).map(result => `
              <tr>
                <td>${esc(result.teamName)}</td>
                <td>${esc(result.position)}</td>
                <td>${esc(result.kills)}</td>
                <td>${pointsFor(result.position, result.kills)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${admin ? `<button type="button" data-delete-match="${esc(match.id)}">Excluir resultado</button>` : ''}
      </article>
    `).join('')
    : '<p>Nenhum resultado registrado.</p>';
}

function renderTeams() {
  const target = $('teamSelect');
  if (target) target.innerHTML = teamOptions();
}

function renderAll() {
  renderRanking();
  renderHistory();
  renderTeams();
}

onSnapshot(collection(db, 'publicTeams'), snapshot => {
  teams = snapshot.docs
    .map(d => normalizeTeam({ id: d.id, ...d.data() }))
    .filter(team => {
      const original = snapshot.docs.find(d => d.id === team.id);
      return original?.data()?.status === 'approved';
    });

  renderAll();
}, error => message(error.message, true));

onSnapshot(collection(db, 'xtMatches'), snapshot => {
  matches = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  matches.sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) ||
    Number(b.round) - Number(a.round)
  );
  renderAll();
}, error => message(error.message, true));

onAuthStateChanged(auth, async user => {
  admin = false;
  if (user) {
    try {
      const permission = await getDoc(doc(db, 'admins', user.uid));
      admin = permission.exists();
    } catch (error) {
      message(error.message, true);
    }
  }

  $('xtAdminPanel')?.classList.toggle('hide', !admin);
  $('xtLoginBox')?.classList.toggle('hide', admin);
  renderAll();
});

$('xtLoginForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await signInWithEmailAndPassword(
      auth,
      $('xtEmail').value.trim(),
      $('xtPassword').value
    );
    message('Login realizado.');
  } catch (error) {
    message(error.message, true);
  }
});

$('xtLogout')?.addEventListener('click', async () => {
  await signOut(auth);
  message('Você saiu do painel.');
});

$('xtResultForm')?.addEventListener('submit', async event => {
  event.preventDefault();

  if (!admin) {
    message('Somente administradores podem salvar resultados.', true);
    return;
  }

  try {
    const date = $('matchDate').value;
    const day = $('matchDay').value;
    const round = Number($('matchRound').value);

    if (!date || !['segunda', 'quarta', 'sexta'].includes(day) ||
        !Number.isInteger(round) || round < 1 || round > 4) {
      throw Error('Preencha data, dia e queda corretamente.');
    }

    const teamId = $('teamSelect').value;
    const team = teams.find(x => x.id === teamId);

    if (!team) throw Error('Selecione uma equipe válida.');

    const position = Number($('matchPosition').value);
    const kills = Number($('matchKills').value);
    pointsFor(position, kills);

    const matchId = `${date}_${day}_${round}`;
    const reference = doc(db, 'xtMatches', matchId);
    const existing = await getDoc(reference);
    const data = existing.exists() ? existing.data() : {};
    const results = [...(data.results || [])];

    if (results.some(x => x.teamId !== teamId && Number(x.position) === position)) {
      throw Error('Essa colocação já pertence a outra equipe.');
    }

    const index = results.findIndex(x => x.teamId === teamId);
    const result = {
      teamId,
      teamName: team.name,
      position,
      kills
    };

    if (index >= 0) results[index] = result;
    else results.push(result);

    await setDoc(reference, {
      date,
      day,
      round,
      map: maps[round - 1],
      results,
      updatedAt: serverTimestamp()
    });

    message('Resultado salvo! A classificação foi atualizada.');
  } catch (error) {
    message(error.message, true);
  }
});

$('matchHistory')?.addEventListener('click', async event => {
  const button = event.target.closest('[data-delete-match]');
  if (!button || !admin) return;

  if (!confirm('Deseja excluir esse resultado completo?')) return;

  try {
    await deleteDoc(doc(db, 'xtMatches', button.dataset.deleteMatch));
    message('Resultado excluído.');
  } catch (error) {
    message(error.message, true);
  }
});

