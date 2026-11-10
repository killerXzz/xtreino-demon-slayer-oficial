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
    a => a.kind === 'match' || a.kind === 'manual'
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
    teams.map(team => [team.id, {
      id: team.id,
      name: team.name,
      points: 0,
      kills: 0,
      booyahs: 0,
      matches: 0
    }])
  );

  // Uma tabela manual já contém os pontos somados daquele XTREINO.
  // Evita somar novamente as quedas da mesma data e do mesmo dia.
  const manualEvents = new Set(
    items
      .filter(match => match.kind === 'manual')
      .map(match => `${match.date}_${match.day}`)
  );

  for (const match of items) {
    for (const result of match.results || []) {
      if (!result.teamId) continue;

      if (match.kind === 'manual') {
        const points = Number(result.points);
        if (!Number.isFinite(points) || points < 0) continue;

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

        const team = totals.get(result.teamId);
        team.points += points;
        team.matches++;
        continue;
      }

      if (manualEvents.has(`${match.date}_${match.day}`)) continue;
      if (!validResult(result)) continue;

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

      const team = totals.get(result.teamId);
      team.points += pointsFor(result.position, result.kills);
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
        Arquiva as tabelas sem apagar equipes.
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
            <th>Posição</th>
            <th>Equipe</th>
            <th>Pontuação total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((team, index) => `
            <tr>
              <td>${index + 1}º</td>
              <td>${esc(team.name)}</td>
              <td>${team.points}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ${rows.length ? '' : '<p>Nenhuma equipe cadastrada.</p>'}
  `;
}

function renderHistory() {
  const target = $('matchHistory');
  if (!target) return;

  const items = shownMatches();

  target.innerHTML = items.length
    ? items.map(match => {
        const manual = match.kind === 'manual';
        const results = [...(match.results || [])];

        if (manual) {
          results.sort(
            (a, b) =>
              Number(b.points) - Number(a.points) ||
              String(a.teamName).localeCompare(String(b.teamName))
          );
        } else {
          results.sort(
            (a, b) => Number(a.position) - Number(b.position)
          );
        }

        const rows = manual
          ? results.map((result, index) => `
              <tr>
                <td>${index + 1}º</td>
                <td>${esc(result.teamName)}</td>
                <td>${esc(result.points)}</td>
              </tr>
            `).join('')
          : results
              .filter(validResult)
              .map(result => `
                <tr>
                  <td>${esc(result.teamName)}</td>
                  <td>${esc(result.position)}º</td>
                  <td>${esc(result.kills)}</td>
                  <td>${pointsFor(result.position, result.kills)}</td>
                </tr>
              `).join('');

        const headings = manual
          ? '<tr><th>Posição</th><th>Equipe</th><th>Pontuação total</th></tr>'
          : '<tr><th>Equipe</th><th>Posição</th><th>Abates</th><th>Pontos</th></tr>';

        const title = manual
          ? 'Classificação final'
          : `Queda ${esc(match.round)} — ${esc(match.map || maps[Number(match.round) - 1] || '')}`;

        return `
          <article class="item">
            <h3>${esc(match.date)} — ${title}</h3>
            <p>
              ${esc(days[match.day] || match.day)}
              ${match.archivedAt ? '• Arquivada' : ''}
            </p>
            <div style="overflow-x:auto">
              <table>
                <thead>${headings}</thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            ${admin && !match.archivedAt ? `
              <button type="button"
                data-delete-match="${esc(match.id)}"
                style="margin-top:12px;background:${COLORS.danger}">
                Excluir tabela
              </button>
            ` : ''}
          </article>
        `;
      }).join('')
    : '<p>Nenhum resultado registrado nesta seleção.</p>';
}

function renderTeams() {
  const target = $('teamSelect');
  if (!target) return;

  const previous = target.value;

  target.innerHTML =
    '<option value="">Selecione uma equipe</option>' +
    teams.map(team => `
      <option value="${esc(team.id)}">
        ${esc(team.name)}
      </option>
    `).join('');

  if (teams.some(team => team.id === previous)) {
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
    match => day === 'semana' || match.day === day
  );

  if (!chosen.length) {
    message('Não existem tabelas pendentes para finalizar.');
    return;
  }

  const label = day === 'semana'
    ? 'a semana inteira'
    : days[day];

  if (!confirm(
    `Finalizar ${label}? ${chosen.length} tabela(s) serão arquivadas. A classificação geral permanecerá acumulada.`
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
      const refs = chosen.map(match => ({
        active: doc(db, 'xtMatches', match.id),
        archive: doc(db, 'xtArchives', match.id)
      }));

      const activeDocs = [];
      const archiveDocs = [];

      for (const ref of refs) {
        activeDocs.push(await tx.get(ref.active));
        archiveDocs.push(await tx.get(ref.archive));
      }

      if (activeDocs.some(document => !document.exists())) {
        throw Error(
          'Alguma tabela foi alterada. Atualize a página e tente novamente.'
        );
      }

      if (archiveDocs.some(document => document.exists())) {
        throw Error(
          'Uma tabela já existe no histórico. Finalização cancelada para evitar sobrescrever dados.'
        );
      }

      refs.forEach((ref, index) => {
        tx.set(ref.archive, {
          ...activeDocs[index].data(),
          kind: activeDocs[index].data().kind || 'match',
          archivedAt: serverTimestamp()
        });

        tx.delete(ref.active);
      });
    });

    message(
      `${label} finalizada com sucesso! Histórico preservado e classificação geral mantida.`
    );

  } catch (error) {
    message('Erro ao finalizar: ' + error.message, true);
  } finally {
    busy = false;
  }
}

/* FIREBASE - EQUIPES */

onSnapshot(
  collection(db, 'publicTeams'),
  snap => {
    teams = snap.docs
      .filter(document => document.data().status === 'approved')
      .map(document => normalizeTeam({
        id: document.id,
        ...document.data()
      }));

    renderAll();
  },
  error => message('Equipes: ' + error.message, true)
);

/* FIREBASE - RESULTADOS */

onSnapshot(
  collection(db, 'xtMatches'),
  snap => {
    matches = snap.docs.map(document => ({
      id: document.id,
      ...document.data()
    }));

    renderAll();
  },
  error => message('Resultados: ' + error.message, true)
);

/* FIREBASE - HISTÓRICO */

onSnapshot(
  collection(db, 'xtArchives'),
  snap => {
    archives = snap.docs.map(document => ({
      id: document.id,
      ...document.data()
    }));

    renderAll();
  },
  error => message('Histórico: ' + error.message, true)
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

    } catch (error) {
      message(error.message, true);
    }
  }

  $('xtAdminPanel')?.classList.toggle('hide', !admin);
  $('xtLoginBox')?.classList.toggle('hide', admin);

  renderAll();
});

/* NAVEGAÇÃO DAS TABELAS */

document.addEventListener('click', event => {
  const day = event.target.closest(
    '#xtDayTabs [data-day]'
  );

  const mode = event.target.closest(
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

/* SAIR DO PAINEL ADM */

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

/* COMPATIBILIDADE COM O FORMULÁRIO ANTIGO DE QUEDAS */

$('xtResultForm')?.addEventListener(
  'submit',
  async event => {
    event.preventDefault();

    if (!admin || busy) {
      message('Somente o ADM pode salvar resultados.', true);
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
        !days[day] ||
        !Number.isInteger(round) ||
        round < 1 ||
        round > 4
      ) {
        throw Error('Preencha data, dia e queda corretamente.');
      }

      const dateObj = new Date(date + 'T12:00:00');

      if (
        Number.isNaN(dateObj.getTime()) ||
        dateObj.getDay() !== weekdays[day]
      ) {
        throw Error('A data não corresponde ao dia selecionado.');
      }

      const team = teams.find(
        item => item.id === $('teamSelect').value
      );

      if (!team) {
        throw Error('Selecione uma equipe válida.');
      }

      const position = Number($('matchPosition').value);
      const kills = Number($('matchKills').value);

      pointsFor(position, kills);

      const id = `${date}_${day}_${round}`;

      await runTransaction(db, async tx => {
        const active = doc(db, 'xtMatches', id);
        const archived = doc(db, 'xtArchives', id);
        const current = await tx.get(active);
        const historical = await tx.get(archived);

        if (historical.exists()) {
          throw Error('Esta queda já foi finalizada e não pode ser reaberta.');
        }

        const results = [
          ...(current.exists()
            ? current.data().results || []
            : [])
        ];

        if (results.some(result =>
          result.teamId !== team.id &&
          Number(result.position) === position
        )) {
          throw Error('Essa colocação já pertence a outra equipe.');
        }

        const index = results.findIndex(
          result => result.teamId === team.id
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

      message('Resultado salvo e classificação atualizada!');

    } catch (error) {
      message(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }
);

function teamKey(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function parseBulkScores(text) {
  const teamsByName = new Map(
    teams.map(team => [teamKey(team.name), team])
  );

  const usedTeams = new Set();
  const results = [];

  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line, index) => ({
      line: line.trim(),
      number: index + 1
    }))
    .filter(item => item.line);

  if (!lines.length) {
    throw Error('Cole pelo menos uma equipe e sua pontuação total.');
  }

  for (const item of lines) {
    const delimiter = item.line.includes('\t')
      ? '\t'
      : item.line.includes(';')
        ? ';'
        : item.line.includes('|')
          ? '|'
          : ',';

    const parts = item.line
      .split(delimiter)
      .map(part => part.trim());

    if (
      item.number === 1 &&
      parts.length === 2 &&
      /^(equipe|line|time)$/i.test(parts[0]) &&
      /^(pontos?|pontuação|pontuacao|total|pontuação total|pontuacao total)$/i.test(parts[1])
    ) {
      continue;
    }

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw Error(`Linha ${item.number}: use Equipe [TAB] Pontuação.`);
    }

    const team = teamsByName.get(teamKey(parts[0]));

    if (!team) {
      throw Error(
        `Linha ${item.number}: equipe “${parts[0]}” não encontrada entre as equipes confirmadas.`
      );
    }

    if (usedTeams.has(team.id)) {
      throw Error(
        `Linha ${item.number}: a equipe “${team.name}” aparece mais de uma vez.`
      );
    }

    const scoreText = parts[1].replace(/\s/g, '');

    if (!/^\d+$/.test(scoreText)) {
      throw Error(
        `Linha ${item.number}: a pontuação de “${team.name}” precisa ser um número inteiro igual ou maior que zero.`
      );
    }

    usedTeams.add(team.id);

    results.push({
      teamId: team.id,
      teamName: team.name,
      points: Number(scoreText)
    });
  }

  if (!results.length) {
    throw Error('Não encontrei equipes para importar. Confira as linhas coladas.');
  }

  return results.sort(
    (a, b) =>
      b.points - a.points ||
      a.teamName.localeCompare(b.teamName)
  );
}

function renderBulkPreview() {
  const target = $('bulkScorePreview');
  if (!target) return;

  const text = $('bulkScores')?.value || '';

  if (!text.trim()) {
    target.innerHTML = '';
    return;
  }

  try {
    const rows = parseBulkScores(text);

    target.innerHTML = `
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>Posição</th>
              <th>Equipe</th>
              <th>Pontuação total</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, index) => `
              <tr>
                <td>${index + 1}º</td>
                <td>${esc(row.teamName)}</td>
                <td>${row.points}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (error) {
    target.innerHTML = `
      <p class="notice" style="color:#ff7777">
        ${esc(error.message)}
      </p>
    `;
  }
}

$('bulkScores')?.addEventListener(
  'input',
  renderBulkPreview
);

/* SALVAR TABELA COM PONTUAÇÃO TOTAL */

$('xtBulkScoreForm')?.addEventListener(
  'submit',
  async event => {
    event.preventDefault();

    if (!admin || busy) {
      message('Somente o ADM pode salvar resultados.', true);
      return;
    }

    const button = event.currentTarget.querySelector(
      'button[type="submit"]'
    );

    if (button) button.disabled = true;

    try {
      const date = $('bulkMatchDate').value;
      const day = $('bulkMatchDay').value;

      if (!date || !days[day]) {
        throw Error('Preencha a data e o dia do XTREINO.');
      }

      const dateObj = new Date(date + 'T12:00:00');

      if (
        Number.isNaN(dateObj.getTime()) ||
        dateObj.getDay() !== weekdays[day]
      ) {
        throw Error('A data não corresponde ao dia selecionado.');
      }

      const results = parseBulkScores($('bulkScores').value);
      const id = `${date}_${day}_manual_total`;

      await runTransaction(db, async tx => {
        const active = doc(db, 'xtMatches', id);
        const archived = doc(db, 'xtArchives', id);
        const current = await tx.get(active);
        const historical = await tx.get(archived);

        if (historical.exists()) {
          throw Error('Esta tabela já foi finalizada e arquivada.');
        }

        tx.set(active, {
          kind: 'manual',
          date,
          day,
          results,
          updatedAt: serverTimestamp(),
          createdAt: current.exists()
            ? current.data().createdAt || serverTimestamp()
            : serverTimestamp()
        });
      });

      message(
        `Tabela salva! ${results.length} equipe(s) ordenadas pela pontuação total.`
      );

    } catch (error) {
      message(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }
);

/* EXCLUIR RESULTADO OU TABELA */

$('matchHistory')?.addEventListener(
  'click',
  async event => {
    const button = event.target.closest(
      '[data-delete-match]'
    );

    if (!button || !admin || busy) return;

    if (!confirm('Excluir esta tabela ativa?')) return;

    try {
      busy = true;

      const id = button.dataset.deleteMatch;

      await runTransaction(db, async tx => {
        const active = doc(db, 'xtMatches', id);
        const archived = doc(db, 'xtArchives', id);
        const activeDoc = await tx.get(active);
        const archiveDoc = await tx.get(archived);

        if (archiveDoc.exists()) {
          throw Error('Esta tabela já foi arquivada.');
        }

        if (activeDoc.exists()) {
          tx.delete(active);
        }
      });

      message('Tabela excluída.');

    } catch (error) {
      message(error.message, true);
    } finally {
      busy = false;
    }
  }
);

/* INICIAR SISTEMA */

createControls();
renderAll();


