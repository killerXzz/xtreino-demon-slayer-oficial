
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
  runTransaction,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const COLORS = {
  red: '#c51e34',
  bright: '#ff404d',
  hover: '#e12b43',
  dark: '#18090d',
  panel: '#291217',
  border: '#792635',
  secondary: '#48242b',
  danger: '#a51026',
  white: '#ffffff'
};

const days = {
  segunda: 'Segunda-feira',
  quarta: 'Quarta-feira',
  sexta: 'Sexta-feira'
};

const weekdays = {
  segunda: 1,
  quarta: 3,
  sexta: 5
};

const maps = [
  'Bermuda',
  'Purgatório',
  'Kalahari',
  'Nova Terra'
];

const placementPoints = [
  12, 9, 8, 7, 6, 5,
  4, 3, 2, 1, 0, 0
];

let admin = false;
let teams = [];
let matches = [];
let archives = [];
let selectedDay = 'geral';
let selectedMode = 'semana';
let busy = false;

const esc = value => String(value ?? '').replace(
  /[&<>"']/g,
  char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char])
);

function message(text, error = false) {
  const target = $('xtMessage');

  if (target) {
    target.textContent = text;
    target.style.color = error
      ? '#ff7777'
      : '#86efac';
  }
}

function validResult(r) {
  return (
    Number.isInteger(Number(r.position)) &&
    Number(r.position) >= 1 &&
    Number(r.position) <= 12 &&
    Number.isInteger(Number(r.kills)) &&
    Number(r.kills) >= 0
  );
}

function pointsFor(position, kills) {
  if (!validResult({ position, kills })) {
    throw Error('Colocação ou abates inválidos.');
  }

  return (
    placementPoints[Number(position) - 1] +
    Number(kills)
  );
}

function normalizeTeam(x) {
  return {
    id: x.id,
    name: x.team || x.name || 'Equipe'
  };
}

function archiveMatches() {
  return archives.filter(
    a => a.kind === 'match'
  );
}

function currentMatches() {
  return matches.filter(
    m => m.kind !== 'closure'
  );
}

function shownMatches() {
  const base = selectedMode === 'geral'
    ? [...currentMatches(), ...archiveMatches()]
    : selectedMode === 'historico'
      ? archiveMatches()
      : currentMatches();

  return base
    .filter(
      m => selectedDay === 'geral' ||
      m.day === selectedDay
    )
    .sort(
      (a, b) =>
        String(b.date).localeCompare(String(a.date)) ||
        Number(b.round) - Number(a.round)
    );
}

function rankingFor(items) {
  const totals = new Map(
    teams.map(t => [
      t.id,
      {
        ...t,
        points: 0,
        kills: 0,
        booyahs: 0,
        matches: 0
      }
    ])
  );

  for (const match of items) {
    for (const result of match.results || []) {
      if (!validResult(result) || !result.teamId) {
        continue;
      }

      if (!totals.has(result.teamId)) {
        totals.set(result.teamId, {
          id: result.teamId,
          name: result.teamName || 'Equipe',
          points: 0,
          kills: 0,
          booyahs: 0,
          matches: 0
        });
      }

      const t = totals.get(result.teamId);

      t.points += pointsFor(
        result.position,
        result.kills
      );

      t.kills += Number(result.kills);
      t.matches++;

      if (Number(result.position) === 1) {
        t.booyahs++;
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

/* TEMA VERMELHO E PRETO */

function applyTheme() {
  if ($('xtRedBlackTheme')) return;

  const style = document.createElement('style');
  style.id = 'xtRedBlackTheme';

  style.textContent = `
    :root {
      --purple: #c51e34 !important;
      --accent: #ff404d !important;
      --primary: #c51e34 !important;
    }

    #xtExtraNavigation a,
    #xtDayTabs button,
    #xtModeTabs button {
      color: white !important;
      border: 1px solid #792635 !important;
      transition: background .2s, transform .2s;
    }

    #xtExtraNavigation a:hover,
    #xtDayTabs button:hover,
    #xtModeTabs button:hover {
      background: #e12b43 !important;
      transform: translateY(-1px);
    }

    #xtDayTabs button[aria-pressed="true"],
    #xtModeTabs button[aria-pressed="true"] {
      background: #c51e34 !important;
      border-color: #ff404d !important;
    }

    #xtFinishControls {
      background: #18090d !important;
      border-color: #792635 !important;
    }

    #xtFinishControls button {
      background: #c51e34 !important;
      color: white !important;
    }

    #xtFinishControls button:hover {
      background: #e12b43 !important;
    }

    #xtFinishControls button[data-finish="semana"] {
      background: #a51026 !important;
    }

    #xtFinishControls button[data-finish="semana"]:hover {
      background: #d01b35 !important;
    }

    #xtRedBlackTheme ~ * {
      accent-color: #c51e34;
    }
  `;

  document.head.appendChild(style);
}

function createControls() {
  applyTheme();

  if (!$('xtExtraNavigation')) {
    const nav = document.createElement('div');

    nav.id = 'xtExtraNavigation';

    nav.style.cssText = `
      display:flex;
      gap:12px;
      flex-wrap:wrap;
      margin:20px 0;
    `;

    nav.innerHTML = `
      <a href="./index.html"
         style="
           color:white;
           background:${COLORS.secondary};
           padding:12px 16px;
           border-radius:10px;
           text-decoration:none;
         ">
        📝 INSCRIÇÕES
      </a>

      <a href="#xtDayTabs"
         style="
           color:white;
           background:${COLORS.red};
           padding:12px 16px;
           border-radius:10px;
           text-decoration:none;
         ">
        🏆 TABELAS
      </a>
    `;

    (
      document.querySelector('main') ||
      document.body
    ).prepend(nav);
  }

  if (!$('xtDayTabs')) {
    const box = document.createElement('div');

    box.id = 'xtDayTabs';

    box.style.cssText = `
      display:flex;
      flex-wrap:wrap;
      gap:10px;
      margin:20px 0;
    `;

    const ranking = $('ranking');

    if (ranking) {
      (
        ranking.closest('section') ||
        ranking
      ).before(box);
    }
  }

  if (!$('xtModeTabs')) {
    const box = document.createElement('div');

    box.id = 'xtModeTabs';

    box.style.cssText = `
      display:flex;
      flex-wrap:wrap;
      gap:10px;
      margin:12px 0;
    `;

    $('xtDayTabs')?.after(box);
  }

  if (!$('xtFinishControls') && $('xtAdminPanel')) {
    const box = document.createElement('section');

    box.id = 'xtFinishControls';

    box.style.cssText = `
      padding:20px;
      border:1px solid ${COLORS.border};
      border-radius:14px;
      margin:20px 0;
      background:${COLORS.dark};
    `;

    box.innerHTML = `
      <h2>🏁 Encerrar XTREINO</h2>

      <p>
        Arquiva as quedas sem apagar equipes.
        A tabela semanal reinicia e a classificação
        geral continua acumulando.
      </p>

      <div style="
        display:flex;
        flex-wrap:wrap;
        gap:10px;
      ">
        <button type="button" data-finish="segunda">
          FINALIZAR SEGUNDA
        </button>

        <button type="button" data-finish="quarta">
          FINALIZAR QUARTA
        </button>

        <button type="button" data-finish="sexta">
          FINALIZAR SEXTA
        </button>

        <button type="button" data-finish="semana">
          FINALIZAR SEMANA
        </button>
      </div>

      <p id="xtFinishInfo"></p>
    `;

    $('xtAdminPanel').append(box);
  }

  /* Funciona com controles criados pelo JS
     e também com os que já estão no HTML. */
  const finishBox = $('xtFinishControls');

  if (finishBox && !finishBox.dataset.listenerReady) {
    finishBox.dataset.listenerReady = 'true';

    finishBox.addEventListener('click', async event => {
      const button = event.target.closest(
        'button[data-finish]'
      );

      if (button && finishBox.contains(button)) {
        await finish(button.dataset.finish);
      }
    });
  }
}

function renderTabs() {
  const dayBox = $('xtDayTabs');
  const modeBox = $('xtModeTabs');

  if (dayBox) {
    dayBox.innerHTML = [
      ['geral', 'TODOS OS DIAS'],
      ['segunda', 'SEGUNDA'],
      ['quarta', 'QUARTA'],
      ['sexta', 'SEXTA']
    ].map(([id, label]) => {
      const active = selectedDay === id;

      return `
        <button
          type="button"
          data-day="${id}"
          aria-pressed="${active}"
          style="
            background:${
              active
                ? COLORS.red
                : COLORS.panel
            };
            color:white;
            border:1px solid ${COLORS.border};
            padding:12px;
            border-radius:9px;
            cursor:pointer;
          ">
          ${label}
        </button>
      `;
    }).join('');
  }

  if (modeBox) {
    modeBox.innerHTML = [
      ['semana', '📅 SEMANA ATUAL'],
      ['geral', '🏆 GERAL ACUMULADA'],
      ['historico', '📜 HISTÓRICO']
    ].map(([id, label]) => {
      const active = selectedMode === id;

      return `
        <button
          type="button"
          data-mode="${id}"
          aria-pressed="${active}"
          style="
            background:${
              active
                ? COLORS.red
                : COLORS.panel
            };
            color:white;
            border:1px solid ${COLORS.border};
            padding:12px;
            border-radius:9px;
            cursor:pointer;
          ">
          ${label}
        </button>
      `;
    }).join('');
  }
}

function renderRanking() {
  const target = $('ranking');
  if (!target) return;

  const rows = rankingFor(shownMatches());

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
          ${rows.map((t, i) => `
            <tr>
              <td>${i + 1}º</td>
              <td>${esc(t.name)}</td>
              <td>${t.points}</td>
              <td>${t.kills}</td>
              <td>${t.booyahs}</td>
              <td>${t.matches}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    ${
      rows.length
        ? ''
        : '<p>Nenhuma equipe cadastrada.</p>'
    }
  `;
}

function renderHistory() {
  const target = $('matchHistory');
  if (!target) return;

  const items = shownMatches();

  target.innerHTML = items.length
    ? items.map(m => `
      <article class="item">
        <h3>
          ${esc(m.date)} —
          ${esc(
            m.map ||
            maps[Number(m.round) - 1] ||
            ''
          )}
        </h3>

        <p>
          ${esc(days[m.day] || m.day)}
          • Queda ${esc(m.round)}
          ${m.archivedAt ? '• Arquivada' : ''}
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
              ${[...(m.results || [])]
                .filter(validResult)
                .sort(
                  (a, b) =>
                    Number(a.position) -
                    Number(b.position)
                )
                .map(r => `
                  <tr>
                    <td>${esc(r.teamName)}</td>
                    <td>${esc(r.position)}º</td>
                    <td>${esc(r.kills)}</td>
                    <td>${
                      pointsFor(
                        r.position,
                        r.kills
                      )
                    }</td>
                  </tr>
                `).join('')}
            </tbody>
          </table>
        </div>

        ${
          admin && !m.archivedAt
            ? `
              <button
                type="button"
                data-delete-match="${esc(m.id)}"
                style="
                  margin-top:12px;
                  background:${COLORS.danger};
                ">
                Excluir queda
              </button>
            `
            : ''
        }
      </article>
    `).join('')
    : '<p>Nenhum resultado registrado nesta seleção.</p>';
}

function renderTeams() {
  const target = $('teamSelect');
  if (!target) return;

  const previous = target.value;

  target.innerHTML =
    '<option value="">Selecione uma equipe</option>' +
    teams.map(t => `
      <option value="${esc(t.id)}">
        ${esc(t.name)}
      </option>
    `).join('');

  if (teams.some(t => t.id === previous)) {
    target.value = previous;
  }
}

function renderAll() {
  createControls();
  renderTabs();
  renderRanking();
  renderHistory();
  renderTeams();
}

async function finish(day) {
  if (!admin || busy) return;

  if (day !== 'semana' && !days[day]) {
    message('Dia inválido.', true);
    return;
  }

  const chosen = currentMatches().filter(
    m => day === 'semana' || m.day === day
  );

  if (!chosen.length) {
    message(
      'Não existem quedas pendentes para finalizar.'
    );
    return;
  }

  const label = day === 'semana'
    ? 'a semana inteira'
    : days[day];

  if (!confirm(
    `Finalizar ${label}? ${chosen.length} queda(s) serão arquivadas. A classificação geral permanecerá acumulada.`
  )) return;

  const typed = prompt(
    'Para confirmar, digite FINALIZAR:'
  );

  if (typed !== 'FINALIZAR') {
    message('Finalização cancelada.');
    return;
  }

  busy = true;

  try {
    await runTransaction(db, async tx => {
      const refs = chosen.map(m => ({
        active: doc(db, 'xtMatches', m.id),
        archive: doc(db, 'xtArchives', m.id)
      }));

      const activeDocs = [];
      const archiveDocs = [];

      for (const r of refs) {
        activeDocs.push(
          await tx.get(r.active)
        );

        archiveDocs.push(
          await tx.get(r.archive)
        );
      }

      if (activeDocs.some(d => !d.exists())) {
        throw Error(
          'Alguma queda foi alterada. Atualize a página e tente novamente.'
        );
      }

      if (archiveDocs.some(d => d.exists())) {
        throw Error(
          'Uma queda já existe no histórico. Finalização cancelada para evitar sobrescrever dados.'
        );
      }

      refs.forEach((r, i) => {
        tx.set(r.archive, {
          ...activeDocs[i].data(),
          kind: 'match',
          archivedAt: serverTimestamp()
        });

        tx.delete(r.active);
      });
    });

    message(
      `${label} finalizada com sucesso! Histórico preservado e classificação geral mantida.`
    );

  } catch (error) {
    message(
      'Erro ao finalizar: ' + error.message,
      true
    );
  } finally {
    busy = false;
  }
}

/* FIREBASE - EQUIPES */

onSnapshot(
  collection(db, 'publicTeams'),
  snap => {
    teams = snap.docs
      .filter(
        d => d.data().status === 'approved'
      )
      .map(d => normalizeTeam({
        id: d.id,
        ...d.data()
      }));

    renderAll();
  },
  err => message(
    'Equipes: ' + err.message,
    true
  )
);

/* FIREBASE - RESULTADOS */

onSnapshot(
  collection(db, 'xtMatches'),
  snap => {
    matches = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    renderAll();
  },
  err => message(
    'Resultados: ' + err.message,
    true
  )
);

/* FIREBASE - HISTÓRICO */

onSnapshot(
  collection(db, 'xtArchives'),
  snap => {
    archives = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    renderAll();
  },
  err => message(
    'Histórico: ' + err.message,
    true
  )
);

/* LOGIN ADMINISTRADOR */

onAuthStateChanged(auth, async user => {
  admin = false;

  if (user) {
    try {
      const permission = await getDoc(
        doc(db, 'admins', user.uid)
      );

      admin = permission.exists();

    } catch (err) {
      message(err.message, true);
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

/* NAVEGAÇÃO DAS TABELAS */

document.addEventListener('click', e => {
  const day = e.target.closest(
    '#xtDayTabs [data-day]'
  );

  const mode = e.target.closest(
    '#xtModeTabs [data-mode]'
  );

  if (day) {
    selectedDay = day.dataset.day;
    renderAll();
  }

  if (mode) {
    selectedMode = mode.dataset.mode;
    renderAll();
  }
});

/* ENTRAR NO PAINEL ADM */

$('xtLoginForm')?.addEventListener(
  'submit',
  async e => {
    e.preventDefault();

    try {
      await signInWithEmailAndPassword(
        auth,
        $('xtEmail').value.trim(),
        $('xtPassword').value
      );

      $('xtPassword').value = '';
      message('Login realizado.');

    } catch (err) {
      message(err.message, true);
    }
  }
);

/* SAIR DO PAINEL ADM */

$('xtLogout')?.addEventListener(
  'click',
  async () => {
    try {
      await signOut(auth);
      message('Você saiu do painel.');
    } catch (err) {
      message(err.message, true);
    }
  }
);

/* SALVAR RESULTADO */

$('xtResultForm')?.addEventListener(
  'submit',
  async e => {
    e.preventDefault();

    if (!admin || busy) {
      message(
        'Somente o ADM pode salvar resultados.',
        true
      );
      return;
    }

    const button = e.currentTarget.querySelector(
      'button[type="submit"]'
    );

    if (button) button.disabled = true;

    try {
      const date = $('matchDate').value;
      const day = $('matchDay').value;
      const round = Number(
        $('matchRound').value
      );

      if (
        !date ||
        !days[day] ||
        !Number.isInteger(round) ||
        round < 1 ||
        round > 4
      ) {
        throw Error(
          'Preencha data, dia e queda corretamente.'
        );
      }

      const dateObj = new Date(
        date + 'T12:00:00'
      );

      if (
        Number.isNaN(dateObj.getTime()) ||
        dateObj.getDay() !== weekdays[day]
      ) {
        throw Error(
          'A data não corresponde ao dia selecionado.'
        );
      }

      const team = teams.find(
        t => t.id === $('teamSelect').value
      );

      if (!team) {
        throw Error(
          'Selecione uma equipe válida.'
        );
      }

      const position = Number(
        $('matchPosition').value
      );

      const kills = Number(
        $('matchKills').value
      );

      pointsFor(position, kills);

      const id = `${date}_${day}_${round}`;

      await runTransaction(db, async tx => {
        const active = doc(
          db,
          'xtMatches',
          id
        );

        const archived = doc(
          db,
          'xtArchives',
          id
        );

        const current = await tx.get(active);
        const historical = await tx.get(archived);

        if (historical.exists()) {
          throw Error(
            'Esta queda já foi finalizada e não pode ser reaberta.'
          );
        }

        const results = [
          ...(current.exists()
            ? current.data().results || []
            : [])
        ];

        if (results.some(r =>
          r.teamId !== team.id &&
          Number(r.position) === position
        )) {
          throw Error(
            'Essa colocação já pertence a outra equipe.'
          );
        }

        const index = results.findIndex(
          r => r.teamId === team.id
        );

        const result = {
          teamId: team.id,
          teamName: team.name,
          position,
          kills
        };

        if (index >= 0) {
          results[index] = result;
        } else {
          results.push(result);
        }

        tx.set(active, {
          date,
          day,
          round,
          map: maps[round - 1],
          results,
          updatedAt: serverTimestamp()
        });
      });

      message(
        'Resultado salvo e classificação atualizada!'
      );

    } catch (err) {
      message(err.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }
);

/* EXCLUIR QUEDA */

$('matchHistory')?.addEventListener(
  'click',
  async e => {
    const button = e.target.closest(
      '[data-delete-match]'
    );

    if (!button || !admin || busy) return;

    if (!confirm(
      'Excluir esta queda da tabela ativa?'
    )) return;

    try {
      busy = true;

      const id = button.dataset.deleteMatch;

      await runTransaction(db, async tx => {
        const active = doc(
          db,
          'xtMatches',
          id
        );

        const archived = doc(
          db,
          'xtArchives',
          id
        );

        const a = await tx.get(active);
        const h = await tx.get(archived);

        if (h.exists()) {
          throw Error('Queda já arquivada.');
        }

        if (a.exists()) {
          tx.delete(active);
        }
      });

      message('Queda excluída.');

    } catch (err) {
      message(err.message, true);
    } finally {
      busy = false;
    }
  }
);

/* INICIAR SISTEMA */

createControls();
renderAll();


