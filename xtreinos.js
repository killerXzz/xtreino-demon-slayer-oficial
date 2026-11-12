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

const maps = ['Bermuda', 'Purgatório', 'Kalahari', 'Nova Terra'];
const placementPoints = [12, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0];

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
  if (!target) return;
  target.textContent = text;
  target.style.color = error ? '#ff7777' : '#86efac';
}

function validResult(r) {
  return Number.isInteger(Number(r.position)) &&
    Number(r.position) >= 1 &&
    Number(r.position) <= 12 &&
    Number.isInteger(Number(r.kills)) &&
    Number(r.kills) >= 0;
}

function pointsFor(position, kills) {
  if (!validResult({ position, kills })) {
    throw Error('Colocação ou abates inválidos.');
  }
  return placementPoints[Number(position) - 1] + Number(kills);
}

function normalizeTeam(x) {
  return { id: x.id, name: x.team || x.name || 'Equipe' };
}

function archiveMatches() {
  return archives.filter(a => a.kind === 'match' || a.kind === 'manual');
}

function currentMatches() {
  return matches.filter(m => m.kind !== 'closure');
}

function monthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function shownMatches() {
  const base = selectedMode === 'geral' || selectedMode === 'mensal'
    ? [...currentMatches(), ...archiveMatches()]
    : selectedMode === 'historico'
      ? archiveMatches()
      : currentMatches();

  const filtered = selectedMode === 'mensal'
    ? base.filter(m => String(m.date || '').slice(0, 7) === monthKey())
    : base.filter(m => selectedDay === 'geral' || m.day === selectedDay);

  return filtered.sort((a, b) =>
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
        const kills = Number(result.kills || 0);
        const booyahs = Number(result.booyahs || 0);
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
        team.kills += Number.isFinite(kills) && kills >= 0 ? kills : 0;
        team.booyahs += Number.isFinite(booyahs) && booyahs >= 0 ? booyahs : 0;
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
      if (Number(result.position) === 1) team.booyahs++;
    }
  }

  return [...totals.values()].sort((a, b) =>
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
      <a href="./index.html" style="
        color:white;background:${COLORS.secondary};padding:12px 16px;
        border-radius:10px;text-decoration:none">
        📝 INSCRIÇÕES
      </a>
      <a href="#xtDayTabs" style="
        color:white;background:${COLORS.red};padding:12px 16px;
        border-radius:10px;text-decoration:none">
        🏆 TABELAS
      </a>
    `;
    (document.querySelector('main') || document.body).prepend(nav);
  }

  if (!$('xtDayTabs')) {
    const box = document.createElement('div');
    box.id = 'xtDayTabs';
    box.style.cssText = `
      display:flex;flex-wrap:wrap;gap:10px;margin:20px 0;
    `;
    const ranking = $('ranking');
    if (ranking) (ranking.closest('section') || ranking).before(box);
  }

  if (!$('xtModeTabs')) {
    const box = document.createElement('div');
    box.id = 'xtModeTabs';
    box.style.cssText = `
      display:flex;flex-wrap:wrap;gap:10px;margin:12px 0;
    `;
    $('xtDayTabs')?.after(box);
  }

  if (!$('xtFinishControls') && $('xtAdminPanel')) {
    const box = document.createElement('section');
    box.id = 'xtFinishControls';
    box.style.cssText = `
      padding:20px;border:1px solid ${COLORS.border};border-radius:14px;
      margin:20px 0;background:${COLORS.dark};
    `;
    box.innerHTML = `
      <h2>🏁 Encerrar XTREINO</h2>
      <p>
        Arquiva as tabelas sem apagar equipes.
        A tabela semanal reinicia e a classificação geral continua acumulando.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        <button type="button" data-finish="segunda">FINALIZAR SEGUNDA</button>
        <button type="button" data-finish="quarta">FINALIZAR QUARTA</button>
        <button type="button" data-finish="sexta">FINALIZAR SEXTA</button>
        <button type="button" data-finish="semana">FINALIZAR SEMANA</button>
      </div>
      <p id="xtFinishInfo"></p>
    `;
    $('xtAdminPanel').append(box);
  }

  const finishBox = $('xtFinishControls');
  if (finishBox && !finishBox.dataset.listenerReady) {
    finishBox.dataset.listenerReady = 'true';
    finishBox.addEventListener('click', async event => {
      const button = event.target.closest('button[data-finish]');
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
    ].map(([id, label]) => `
      <button type="button" data-day="${id}"
        aria-pressed="${selectedDay === id}"
        style="background:${selectedDay === id ? COLORS.red : COLORS.panel};
        color:white;border:1px solid ${COLORS.border};padding:12px;
        border-radius:9px;cursor:pointer">${label}</button>
    `).join('');
  }

  if (modeBox) {
    modeBox.innerHTML = [
      ['semana', '📅 SEMANA ATUAL'],
      ['geral', '🏆 GERAL ACUMULADA'],
      ['mensal', '📊 MENSAL'],
      ['historico', '📜 HISTÓRICO']
    ].map(([id, label]) => `
      <button type="button" data-mode="${id}"
        aria-pressed="${selectedMode === id}"
        style="background:${selectedMode === id ? COLORS.red : COLORS.panel};
        color:white;border:1px solid ${COLORS.border};padding:12px;
        border-radius:9px;cursor:pointer">${label}</button>
    `).join('');
  }
}

function rankingTable(rows) {
  return `
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr><th>#</th><th>Equipe</th><th>Pontos</th><th>Abates</th><th>Booyahs</th></tr>
        </thead>
        <tbody>
          ${rows.map((team, index) => `
            <tr>
              <td>${index + 1}º</td>
              <td>${esc(team.name)}</td>
              <td>${team.points}</td>
              <td>${team.kills}</td>
              <td>${team.booyahs}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ${rows.length ? '' : '<p>Nenhuma equipe cadastrada.</p>'}
  `;
}

function monthlyRankingFor(items) {
  const merged = new Map();

  for (const row of rankingFor(items)) {
    const key = teamKey(row.name);
    if (!key) continue;

    if (!merged.has(key)) {
      merged.set(key, {
        id: key,
        name: row.name,
        points: 0,
        kills: 0,
        booyahs: 0,
        matches: 0
      });
    }

    const team = merged.get(key);
    team.points += row.points;
    team.kills += row.kills;
    team.booyahs += row.booyahs;
    team.matches += row.matches;
  }

  return [...merged.values()].sort((a, b) =>
    b.points - a.points ||
    b.booyahs - a.booyahs ||
    b.kills - a.kills ||
    a.name.localeCompare(b.name)
  );
}

function renderRanking() {
  const target = $('ranking');
  if (!target) return;

  const items = shownMatches();

  if (selectedMode === 'mensal') {
    const label = new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric'
    }).format(new Date());

    target.innerHTML = `
      <h3 style="color:${COLORS.bright};text-transform:capitalize">
        Ranking mensal — ${esc(label)}
      </h3>
      ${rankingTable(monthlyRankingFor(items))}
    `;
    return;
  }

  if (selectedMode === 'geral') {
    const allMatches = [...currentMatches(), ...archiveMatches()]
      .filter(match => selectedDay === 'geral' || match.day === selectedDay);

    if (selectedDay === 'geral') {
      target.innerHTML = ['segunda', 'quarta', 'sexta'].map(day => `
        <section style="margin:18px 0 28px">
          <h3 style="color:${COLORS.bright}">${esc(days[day])}</h3>
          ${rankingTable(rankingFor(allMatches.filter(match => match.day === day)))}
        </section>
      `).join('');
      return;
    }

    target.innerHTML = rankingTable(rankingFor(allMatches));
    return;
  }

  if (selectedDay === 'geral') {
    const sections = ['segunda', 'quarta', 'sexta'].map(day => {
      const rows = rankingFor(items.filter(match => match.day === day));
      return `
        <section style="margin:18px 0 28px">
          <h3 style="color:${COLORS.bright}">${esc(days[day])}</h3>
          ${rankingTable(rows)}
        </section>
      `;
    });
    target.innerHTML = sections.join('');
    return;
  }

  target.innerHTML = rankingTable(rankingFor(items));
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
          results.sort((a, b) =>
            Number(b.points) - Number(a.points) ||
            String(a.teamName).localeCompare(String(b.teamName))
          );
        } else {
          results.sort((a, b) => Number(a.position) - Number(b.position));
        }

        const rows = manual
          ? results.map((result, index) => `
              <tr>
                <td>${index + 1}º</td>
                <td>${esc(result.teamName)}</td>
                <td>${esc(result.points)}</td>
                <td>${esc(result.kills || 0)}</td>
                <td>${esc(result.booyahs || 0)}</td>
              </tr>
            `).join('')
          : results.filter(validResult).map(result => `
              <tr>
                <td>${esc(result.teamName)}</td>
                <td>${esc(result.position)}º</td>
                <td>${esc(result.kills)}</td>
                <td>${pointsFor(result.position, result.kills)}</td>
              </tr>
            `).join('');

        const headings = manual
          ? '<tr><th>#</th><th>Equipe</th><th>Pontos</th><th>Abates</th><th>Booyahs</th></tr>'
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
              <table><thead>${headings}</thead><tbody>${rows}</tbody></table>
            </div>
            ${admin && !match.archivedAt ? `
              <button type="button" data-delete-match="${esc(match.id)}"
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
  target.innerHTML = '<option value="">Selecione uma equipe</option>' +
    teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');

  if (teams.some(t => t.id === previous)) target.value = previous;
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

  const chosen = currentMatches().filter(m => day === 'semana' || m.day === day);
  if (!chosen.length) {
    message('Não existem quedas pendentes para finalizar.');
    return;
  }

  const label = day === 'semana' ? 'a semana inteira' : days[day];
  if (!confirm(
    `Finalizar ${label}? ${chosen.length} queda(s) serão arquivadas. A classificação geral permanecerá acumulada.`
  )) return;

  const typed = prompt('Para confirmar, digite FINALIZAR:');
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
        activeDocs.push(await tx.get(r.active));
        archiveDocs.push(await tx.get(r.archive));
      }

      if (activeDocs.some(d => !d.exists())) {
        throw Error('Alguma queda foi alterada. Atualize a página e tente novamente.');
      }
      if (archiveDocs.some(d => d.exists())) {
        throw Error('Uma queda já existe no histórico. Finalização cancelada para evitar sobrescrever dados.');
      }

      refs.forEach((r, i) => {
        tx.set(r.archive, {
          ...activeDocs[i].data(),
          kind: activeDocs[i].data().kind || 'match',
          archivedAt: serverTimestamp()
        });
        tx.delete(r.active);
      });
    });

    message(`${label} finalizada com sucesso! Histórico preservado e classificação geral mantida.`);
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
      .filter(d => d.data().status === 'approved')
      .map(d => normalizeTeam({ id: d.id, ...d.data() }));
    renderAll();
  },
  err => message('Equipes: ' + err.message, true)
);

/* FIREBASE - RESULTADOS */

onSnapshot(
  collection(db, 'xtMatches'),
  snap => {
    matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  },
  err => message('Resultados: ' + err.message, true)
);

/* FIREBASE - HISTÓRICO */

onSnapshot(
  collection(db, 'xtArchives'),
  snap => {
    archives = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  },
  err => message('Histórico: ' + err.message, true)
);

/* LOGIN ADMINISTRADOR */

onAuthStateChanged(auth, async user => {
  admin = false;

  if (user) {
    try {
      const permission = await getDoc(doc(db, 'admins', user.uid));
      admin = permission.exists();
    } catch (err) {
      message(err.message, true);
    }
  }

  $('xtAdminPanel')?.classList.toggle('hide', !admin);
  $('xtLoginBox')?.classList.toggle('hide', admin);
  renderAll();
});

/* NAVEGAÇÃO DAS TABELAS */

document.addEventListener('click', e => {
  const day = e.target.closest('#xtDayTabs [data-day]');
  const mode = e.target.closest('#xtModeTabs [data-mode]');

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

$('xtLoginForm')?.addEventListener('submit', async e => {
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
});

/* SAIR DO PAINEL ADM */

$('xtLogout')?.addEventListener('click', async () => {
  try {
    await signOut(auth);
    message('Você saiu do painel.');
  } catch (err) {
    message(err.message, true);
  }
});

/* SALVAR RESULTADO */

$('xtResultForm')?.addEventListener('submit', async e => {
  e.preventDefault();

  if (!admin || busy) {
    message('Somente o ADM pode salvar resultados.', true);
    return;
  }

  const button = e.currentTarget.querySelector('button[type="submit"]');
  if (button) button.disabled = true;

  try {
    const date = $('matchDate').value;
    const day = $('matchDay').value;
    const round = Number($('matchRound').value);

    if (!date || !days[day] || !Number.isInteger(round) || round < 1 || round > 4) {
      throw Error('Preencha data, dia e queda corretamente.');
    }

    const dateObj = new Date(date + 'T12:00:00');
    if (Number.isNaN(dateObj.getTime()) || dateObj.getDay() !== weekdays[day]) {
      throw Error('A data não corresponde ao dia selecionado.');
    }

    const team = teams.find(t => t.id === $('teamSelect').value);
    if (!team) throw Error('Selecione uma equipe válida.');

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

      const results = [...(current.exists() ? current.data().results || [] : [])];
      if (results.some(r => r.teamId !== team.id && Number(r.position) === position)) {
        throw Error('Essa colocação já pertence a outra equipe.');
      }

      const index = results.findIndex(r => r.teamId === team.id);
      const result = { teamId: team.id, teamName: team.name, position, kills };
      if (index >= 0) results[index] = result;
      else results.push(result);

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
  } catch (err) {
    message(err.message, true);
  } finally {
    if (button) button.disabled = false;
  }
});

function teamKey(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function parseBulkScores(text) {
  const byName = new Map(teams.map(team => [teamKey(team.name), team]));
  const used = new Set();
  const results = [];
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(item => item.line);

  if (!lines.length) {
    throw Error('Cole pelo menos uma equipe e seus pontos, abates e booyahs.');
  }

  for (const item of lines) {
    let teamName = '';
    let pointsText = '';
    let killsText = '0';
    let booyahsText = '0';

    const detailMatch = item.line.match(
      /^(.+?)\s+PONTOS\s*[:=]?\s*(\d+)\s+KILL\s*[:=]?\s*(\d+)(?:\s+(\d+)\s+BOOYAH)?\s*$/i
    );

    if (detailMatch) {
      [, teamName, pointsText, killsText, booyahsText = '0'] = detailMatch;
    } else {
      const delimiter = item.line.includes('\t')
        ? '\t'
        : item.line.includes(';')
          ? ';'
          : item.line.includes('|')
            ? '|'
            : ',';
      const parts = item.line.split(delimiter).map(part => part.trim());

      if (
        item.number === 1 &&
        parts.length >= 2 &&
        /^(equipe|line|time)$/i.test(parts[0])
      ) continue;

      if (parts.length < 2 || parts.length > 4 || !parts[0]) {
        throw Error(`Linha ${item.number}: use Equipe PONTOS104 KILL 61 3 BOOYAH, ou colunas separadas por TAB.`);
      }

      [teamName, pointsText, killsText = '0', booyahsText = '0'] = parts;
    }

    const team = byName.get(teamKey(teamName));
    if (!team) {
      throw Error(`Linha ${item.number}: equipe “${teamName}” não encontrada entre as equipes confirmadas.`);
    }
    if (used.has(team.id)) {
      throw Error(`Linha ${item.number}: a equipe “${team.name}” aparece mais de uma vez.`);
    }

    const points = Number(pointsText);
    const kills = Number(killsText || 0);
    const booyahs = Number(booyahsText || 0);
    if (![points, kills, booyahs].every(Number.isInteger) ||
        points < 0 || kills < 0 || booyahs < 0) {
      throw Error(`Linha ${item.number}: pontos, abates e booyahs precisam ser números inteiros iguais ou maiores que zero.`);
    }

    used.add(team.id);
    results.push({
      teamId: team.id,
      teamName: team.name,
      points,
      kills,
      booyahs
    });
  }

  if (!results.length) {
    throw Error('Não encontrei equipes para importar. Confira as linhas coladas.');
  }

  return results.sort((a, b) =>
    b.points - a.points ||
    b.booyahs - a.booyahs ||
    b.kills - a.kills ||
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
            <tr><th>#</th><th>Equipe</th><th>Pontos</th><th>Abates</th><th>Booyahs</th></tr>
          </thead>
          <tbody>
            ${rows.map((row, index) => `
              <tr>
                <td>${index + 1}º</td>
                <td>${esc(row.teamName)}</td>
                <td>${row.points}</td>
                <td>${row.kills}</td>
                <td>${row.booyahs}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (error) {
    target.innerHTML = `<p class="notice" style="color:#ff7777">${esc(error.message)}</p>`;
  }
}

$('bulkScores')?.addEventListener('input', renderBulkPreview);

$('xtBulkScoreForm')?.addEventListener('submit', async event => {
  event.preventDefault();

  if (!admin || busy) {
    message('Somente o ADM pode salvar resultados.', true);
    return;
  }

  const button = event.currentTarget.querySelector('button[type="submit"]');
  if (button) button.disabled = true;

  try {
    const date = $('bulkMatchDate').value;
    const day = $('bulkMatchDay').value;
    if (!date || !days[day]) {
      throw Error('Preencha a data e o dia do XTREINO.');
    }

    const dateObj = new Date(date + 'T12:00:00');
    if (Number.isNaN(dateObj.getTime()) || dateObj.getDay() !== weekdays[day]) {
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

    message(`Tabela salva! ${results.length} equipe(s) ordenadas por pontos, com abates e booyahs registrados.`);
  } catch (error) {
    message(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
});

/* EXCLUIR QUEDA */

$('matchHistory')?.addEventListener('click', async e => {
  const button = e.target.closest('[data-delete-match]');
  if (!button || !admin || busy) return;
  if (!confirm('Excluir esta queda da tabela ativa?')) return;

  try {
    busy = true;
    const id = button.dataset.deleteMatch;

    await runTransaction(db, async tx => {
      const active = doc(db, 'xtMatches', id);
      const archived = doc(db, 'xtArchives', id);
      const a = await tx.get(active);
      const h = await tx.get(archived);

      if (h.exists()) throw Error('Queda já arquivada.');
      if (a.exists()) tx.delete(active);
    });

    message('Queda excluída.');
  } catch (err) {
    message(err.message, true);
  } finally {
    busy = false;
  }
});

/* INICIAR SISTEMA */

createControls();
renderAll();
