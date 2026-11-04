
import {
  initializeApp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';

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
let selectedDay = 'geral';

const maps = [
  'Bermuda',
  'Purgatório',
  'Kalahari',
  'Nova Terra'
];

const days = {
  segunda: 'Segunda-feira',
  quarta: 'Quarta-feira',
  sexta: 'Sexta-feira'
};

const placementPoints = [
  12, 9, 8, 7, 6, 5,
  4, 3, 2, 1, 0, 0
];

const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, char => ({
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
    target.style.color = error
      ? '#ff7777'
      : '#86efac';
  }
}

function pointsFor(position, kills) {
  const p = Number(position);
  const k = Number(kills);

  if (
    !Number.isInteger(p) ||
    p < 1 ||
    p > 12 ||
    !Number.isInteger(k) ||
    k < 0
  ) {
    throw Error(
      'Colocação ou quantidade de abates inválida.'
    );
  }

  return placementPoints[p - 1] + k;
}

function normalizeTeam(data) {
  return {
    id: data.id,
    name: data.team || data.name || 'Equipe',
    logo: data.logo || '',
    captainUid: data.captainUid || ''
  };
}

function validResult(result) {
  const p = Number(result.position);
  const k = Number(result.kills);

  return (
    Number.isInteger(p) &&
    p >= 1 &&
    p <= 12 &&
    Number.isInteger(k) &&
    k >= 0
  );
}

function getFilteredMatches() {
  if (selectedDay === 'geral') {
    return matches;
  }

  return matches.filter(
    match => match.day === selectedDay
  );
}

function getRanking() {
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

  for (const match of getFilteredMatches()) {
    for (const result of match.results || []) {
      if (!validResult(result)) continue;

      if (!totals.has(result.teamId)) {
        totals.set(result.teamId, {
          id: result.teamId,
          name: result.teamName || 'Equipe',
          points: 0,
          kills: 0,
          matches: 0,
          booyahs: 0
        });
      }

      const team = totals.get(result.teamId);

      team.points += pointsFor(
        result.position,
        result.kills
      );

      team.kills += Number(result.kills);
      team.matches++;

      if (Number(result.position) === 1) {
        team.booyahs++;
      }
    }
  }

  return [...totals.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.booyahs - a.booyahs ||
      b.kills - a.kills ||
      a.name.localeCompare(b.name)
  );
}

function renderRanking() {
  const target = $('ranking');
  if (!target) return;

  const ranking = getRanking();

  if (!ranking.length) {
    target.innerHTML =
      '<p>Nenhuma equipe cadastrada.</p>';
    return;
  }

  target.innerHTML = `
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Equipe</th>
            <th>Pontos</th>
            <th>Abates</th>
            <th>Booyahs</th>
            <th>Quedas</th>
          </tr>
        </thead>

        <tbody>
          ${ranking.map((team, index) => `
            <tr>
              <td>${index + 1}º</td>
              <td>${esc(team.name)}</td>
              <td><strong>${team.points}</strong></td>
              <td>${team.kills}</td>
              <td>${team.booyahs}</td>
              <td>${team.matches}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderHistory() {
  const target = $('matchHistory');
  if (!target) return;

  const filtered = getFilteredMatches();

  if (!filtered.length) {
    target.innerHTML = `
      <p>
        Nenhum resultado registrado
        ${selectedDay === 'geral'
          ? 'até o momento.'
          : 'para este dia.'}
      </p>
    `;
    return;
  }

  target.innerHTML = filtered.map(match => {
    const results = [...(match.results || [])]
      .filter(validResult)
      .sort(
        (a, b) =>
          Number(a.position) - Number(b.position)
      );

    return `
      <article class="item">
        <h3>
          ${esc(match.date)}
          — ${esc(match.map || maps[Number(match.round) - 1] || '')}
        </h3>

        <p>
          ${esc(days[match.day] || match.day)}
          • Queda ${esc(match.round)}
        </p>

        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>Equipe</th>
                <th>Posição</th>
                <th>Abates</th>
                <th>Pontos</th>
              </tr>
            </thead>

            <tbody>
              ${results.map(result => `
                <tr>
                  <td>${esc(result.teamName)}</td>
                  <td>${esc(result.position)}º</td>
                  <td>${esc(result.kills)}</td>
                  <td>
                    ${pointsFor(
                      result.position,
                      result.kills
                    )}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        ${admin ? `
          <button
            type="button"
            data-delete-match="${esc(match.id)}"
            style="margin-top:15px;background:#a62b50"
          >
            Excluir queda completa
          </button>
        ` : ''}
      </article>
    `;
  }).join('');
}

function renderTeams() {
  const target = $('teamSelect');
  if (!target) return;

  const previous = target.value;

  target.innerHTML = `
    <option value="">Selecione uma equipe</option>
    ${teams.map(team => `
      <option value="${esc(team.id)}">
        ${esc(team.name)}
      </option>
    `).join('')}
  `;

  if (teams.some(t => t.id === previous)) {
    target.value = previous;
  }
}

function createDayTabs() {
  let container = $('xtDayTabs');

  if (!container) {
    container = document.createElement('div');
    container.id = 'xtDayTabs';

    const ranking = $('ranking');

    if (ranking) {
      const section = ranking.closest('section');

      if (section) {
        section.parentNode.insertBefore(
          container,
          section
        );
      }
    }
  }

  container.style.cssText = `
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:10px;
    margin:20px 0;
  `;

  const options = [
    ['geral', '🏆 GERAL'],
    ['segunda', '📅 SEGUNDA'],
    ['quarta', '📅 QUARTA'],
    ['sexta', '📅 SEXTA']
  ];

  container.innerHTML = options.map(
    ([value, label]) => `
      <button
        type="button"
        data-xt-day="${value}"
        style="
          padding:15px 8px;
          border-radius:12px;
          border:1px solid #7045bd;
          background:${
            selectedDay === value
              ? '#7045bd'
              : '#201b2d'
          };
          color:white;
          font-weight:800;
          cursor:pointer;
        "
      >
        ${label}
      </button>
    `
  ).join('');

  container.querySelectorAll('[data-xt-day]')
    .forEach(button => {
      button.addEventListener('click', () => {
        selectedDay = button.dataset.xtDay;
        renderAll();
      });
    });
}

function createNavigation() {
  if ($('xtExtraNavigation')) return;

  const nav = document.createElement('div');
  nav.id = 'xtExtraNavigation';

  nav.style.cssText = `
    display:flex;
    justify-content:center;
    flex-wrap:wrap;
    gap:12px;
    margin:18px auto;
    padding:0 15px;
  `;

  nav.innerHTML = `
    <a
      href="./index.html"
      style="
        text-decoration:none;
        color:white;
        background:#393046;
        padding:13px 18px;
        border-radius:10px;
        font-weight:bold;
      "
    >
      📝 VOLTAR ÀS INSCRIÇÕES
    </a>

    <a
      href="#xtDayTabs"
      style="
        text-decoration:none;
        color:white;
        background:#7045bd;
        padding:13px 18px;
        border-radius:10px;
        font-weight:bold;
      "
    >
      🏆 VER TABELAS
    </a>
  `;

  const main = document.querySelector('main');

  if (main) {
    main.insertBefore(nav, main.firstChild);
  }
}

function renderAll() {
  createDayTabs();
  renderRanking();
  renderHistory();
  renderTeams();
}

onSnapshot(
  collection(db, 'publicTeams'),
  snapshot => {
    teams = snapshot.docs
      .filter(d => d.data().status === 'approved')
      .map(d => normalizeTeam({
        id: d.id,
        ...d.data()
      }));

    renderAll();
  },
  error => message(error.message, true)
);

onSnapshot(
  collection(db, 'xtMatches'),
  snapshot => {
    matches = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    matches.sort(
      (a, b) =>
        String(b.date).localeCompare(String(a.date)) ||
        Number(b.round) - Number(a.round)
    );

    renderAll();
  },
  error => message(error.message, true)
);

onAuthStateChanged(auth, async user => {
  admin = false;

  if (user) {
    try {
      const permission = await getDoc(
        doc(db, 'admins', user.uid)
      );

      admin = permission.exists();
    } catch (error) {
      message(error.message, true);
    }
  }

  $('xtAdminPanel')?.classList.toggle(
    'hide',
    !admin
  );

  $('xtLoginBox')?.classList.toggle(
    'hide',
    admin
  );

  renderAll();
});

$('xtLoginForm')?.addEventListener(
  'submit',
  async event => {
    event.preventDefault();

    try {
      await signInWithEmailAndPassword(
        auth,
        $('xtEmail').value.trim(),
        $('xtPassword').value
      );

      $('xtPassword').value = '';
      message('Login realizado.');
    } catch (error) {
      message(error.message, true);
    }
  }
);

$('xtLogout')?.addEventListener(
  'click',
  async () => {
    try {
      await signOut(auth);
      message('Você saiu do painel.');
    } catch (error) {
      message(error.message, true);
    }
  }
);

$('xtResultForm')?.addEventListener(
  'submit',
  async event => {
    event.preventDefault();

    if (!admin) {
      message(
        'Somente administradores podem salvar resultados.',
        true
      );
      return;
    }

    const button = event.currentTarget.querySelector(
      'button[type="submit"]'
    );

    if (button) button.disabled = true;

    try {
      const date = $('matchDate').value;
      const day = $('matchDay').value;
      const round = Number($('matchRound').value);

      if (
        !date ||
        !Object.keys(days).includes(day) ||
        !Number.isInteger(round) ||
        round < 1 ||
        round > 4
      ) {
        throw Error(
          'Preencha data, dia e queda corretamente.'
        );
      }

      const dateObject = new Date(
        `${date}T12:00:00`
      );

      const weekdays = {
        segunda: 1,
        quarta: 3,
        sexta: 5
      };

      if (
        Number.isNaN(dateObject.getTime()) ||
        dateObject.getDay() !== weekdays[day]
      ) {
        throw Error(
          'A data escolhida não corresponde ao dia do XTREINO.'
        );
      }

      const teamId = $('teamSelect').value;

      const team = teams.find(
        x => x.id === teamId
      );

      if (!team) {
        throw Error('Selecione uma equipe válida.');
      }

      const position = Number(
        $('matchPosition').value
      );

      const kills = Number(
        $('matchKills').value
      );

      pointsFor(position, kills);

      const matchId = `${date}_${day}_${round}`;

      const reference = doc(
        db,
        'xtMatches',
        matchId
      );

      const existing = await getDoc(reference);

      const data = existing.exists()
        ? existing.data()
        : {};

      const results = [
        ...(data.results || [])
      ];

      if (
        results.some(
          x =>
            x.teamId !== teamId &&
            Number(x.position) === position
        )
      ) {
        throw Error(
          'Essa colocação já pertence a outra equipe.'
        );
      }

      const index = results.findIndex(
        x => x.teamId === teamId
      );

      const result = {
        teamId,
        teamName: team.name,
        position,
        kills
      };

      if (index >= 0) {
        results[index] = result;
      } else {
        results.push(result);
      }

      await setDoc(reference, {
        date,
        day,
        round,
        map: maps[round - 1],
        results,
        updatedAt: serverTimestamp()
      });

      message(
        'Resultado salvo! A tabela foi atualizada.'
      );

    } catch (error) {
      message(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }
);

$('matchHistory')?.addEventListener(
  'click',
  async event => {
    const button = event.target.closest(
      '[data-delete-match]'
    );

    if (!button || !admin) return;

    if (!confirm(
      'Deseja excluir esta queda completa?'
    )) return;

    try {
      button.disabled = true;

      await deleteDoc(
        doc(
          db,
          'xtMatches',
          button.dataset.deleteMatch
        )
      );

      message('Queda excluída.');
    } catch (error) {
      message(error.message, true);
      button.disabled = false;
    }
  }
);

createNavigation();
createDayTabs();
renderAll();
