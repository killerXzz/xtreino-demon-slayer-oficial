
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// FIREBASE - DEMON SLAYER XTREINO
const firebaseConfig = {
  apiKey: "AIzaSyBX6hLTNoeD9LhcUv-lG3qqW69MbJdGQN8",
  authDomain: "demon-slayer-xtreino-e81b7.firebaseapp.com",
  projectId: "demon-slayer-xtreino-e81b7",
  storageBucket: "demon-slayer-xtreino-e81b7.firebasestorage.app",
  messagingSenderId: "545991125458",
  appId: "1:545991125458:web:e9bdb3322edad31907800b",
  measurementId: "G-0H6S88RGGL"
};

// UID EXCLUSIVO DO ADMINISTRADOR
const ADMIN_UID = "tadNQeNTUQMGd5UTqT9HdnlTnfk2";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const DEFAULT_RULES =
  "Sem cavalo. Carros apenas para locomoção. " +
  "Proibido marcar na loja. " +
  "4 quedas: Bermuda, Purgatório, Kalahari e Nova Terra. " +
  "Pontuação LBFF 2021. Sem trapaças. " +
  "Apenas 1 emulador por equipe.";

const DEFAULT_CONFIG = {
  event: "XTREINO DEMꓳN SLꓥYER",
  capacity: 12,
  rules: DEFAULT_RULES
};

const col = name => collection(db, name);

function isAdmin() {
  return auth.currentUser?.uid === ADMIN_UID;
}

function requireAdmin() {
  if (!isAdmin()) {
    throw Error("Acesso permitido somente ao ADM.");
  }
}

function clean(value, max = 60) {
  return String(value ?? "").trim().slice(0, max);
}

function validateScore(value) {
  const n = Number(value);

  if (!Number.isInteger(n) || n < 0 || n > 10000) {
    throw Error("Pontuação inválida.");
  }

  return n;
}

function toTeam(snapshot) {
  return {
    id: snapshot.id,
    ...snapshot.data()
  };
}

function sortedRanking(teams) {
  return teams
    .filter(t => t.status === "approved")
    .sort((a, b) =>
      (Number(b.points) || 0) - (Number(a.points) || 0) ||
      (Number(b.kills) || 0) - (Number(a.kills) || 0)
    )
    .map((team, index) => ({
      team: team.team,
      status: "approved",
      position: index + 1,
      placement: Number(team.placement) || 0,
      kills: Number(team.kills) || 0,
      points: Number(team.points) || 0
    }));
}

function readableError(error) {
  const code = error?.code || "";

  const messages = {
    "auth/api-key-not-valid":
      "A chave API do Firebase não está sendo aceita. " +
      "Confira a chave e suas restrições no Google Cloud.",

    "auth/invalid-api-key":
      "Chave API inválida. Confira a configuração do Firebase.",

    "auth/invalid-credential":
      "E-mail ou senha incorretos.",

    "auth/wrong-password":
      "Senha incorreta.",

    "auth/user-not-found":
      "Usuário não encontrado no Firebase.",

    "auth/operation-not-allowed":
      "Ative E-mail/Senha em Firebase Authentication.",

    "auth/too-many-requests":
      "Muitas tentativas. Aguarde antes de tentar novamente.",

    "auth/network-request-failed":
      "Falha de conexão com o Firebase.",

    "permission-denied":
      "Permissão negada pelas regras do Firestore."
  };

  return new Error(messages[code] || error?.message || "Erro desconhecido.");
}

const XT = {

  isAdmin,

  // AUTENTICAÇÃO
  watchAuth(callback) {
    return onAuthStateChanged(auth, user => {
      callback(Boolean(user && user.uid === ADMIN_UID));
    });
  },

  async login(email, password) {
    try {
      const result = await signInWithEmailAndPassword(
        auth,
        String(email).trim(),
        password
      );

      if (result.user.uid !== ADMIN_UID) {
        await signOut(auth);
        throw Error("Esta conta não é administradora.");
      }

      return { ok: true };

    } catch (error) {
      throw readableError(error);
    }
  },

  async logout() {
    await signOut(auth);
    return { ok: true };
  },

  // ATUALIZAÇÃO PÚBLICA EM TEMPO REAL
  watchPublic(callback, onError) {
    const data = {
      config: { ...DEFAULT_CONFIG },
      teams: [],
      history: [],
      partners: []
    };

    const emit = () => callback({
      config: { ...data.config },
      teams: [...data.teams],
      history: [...data.history],
      partners: [...data.partners]
    });

    const unsubs = [];

    unsubs.push(
      onSnapshot(doc(db, "settings", "xt"), snap => {
        data.config = {
          ...DEFAULT_CONFIG,
          ...(snap.exists() ? snap.data() : {})
        };
        emit();
      }, onError)
    );

    unsubs.push(
      onSnapshot(col("publicTeams"), snap => {
        data.teams = snap.docs.map(toTeam);
        emit();
      }, onError)
    );

    unsubs.push(
      onSnapshot(col("history"), snap => {
        data.history = snap.docs.map(toTeam);
        emit();
      }, onError)
    );

    unsubs.push(
      onSnapshot(col("partners"), snap => {
        data.partners = snap.docs.map(toTeam);
        emit();
      }, onError)
    );

    emit();

    return () => unsubs.forEach(fn => fn());
  },

  // INSCRIÇÕES - SOMENTE ADM
  watchRegistrations(callback, onError) {
    requireAdmin();

    return onSnapshot(col("registrations"), snap => {
      callback(snap.docs.map(toTeam));
    }, onError);
  },

  // CADASTRO DE LINE
  async register(team) {
    const required = [
      "name", "captain", "phone",
      "rush1", "rush2", "grenade", "support"
    ];

    const cleaned = {};

    for (const key of required) {
      cleaned[key] = clean(team[key], 50);

      if (!cleaned[key]) {
        throw Error("Preencha todos os campos obrigatórios.");
      }
    }

    if (!/^[+()\d\s-]{8,25}$/.test(cleaned.phone)) {
      throw Error("WhatsApp inválido.");
    }

    const logo = String(team.logo || "");

    if (
      logo.length > 80000 ||
      (logo &&
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(logo))
    ) {
      throw Error("Logo inválida ou muito grande.");
    }

    const [publicSnap, configSnap] = await Promise.all([
      getDocs(col("publicTeams")),
      getDoc(doc(db, "settings", "xt"))
    ]);

    const capacity = Number(
      configSnap.exists()
        ? configSnap.data().capacity
        : DEFAULT_CONFIG.capacity
    );

    const confirmed = publicSnap.docs.filter(s =>
      s.data().status === "approved"
    ).length;

    if (confirmed >= capacity) {
      throw Error("Todas as vagas estão ocupadas.");
    }

    await addDoc(col("registrations"), {
      team: cleaned.name,
      leader: cleaned.captain,
      contact: cleaned.phone,
      rush: cleaned.rush1,
      rush2: cleaned.rush2,
      grenadier: cleaned.grenade,
      support: cleaned.support,
      logo,
      status: "pending",
      createdAt: serverTimestamp()
    });

    return {
      ok: true,
      message: "Inscrição enviada com sucesso!"
    };
  },

  // APROVAR / RESERVA / RECUSAR
  async setStatus(id, status) {
    requireAdmin();

    if (!["approved", "reserve", "rejected", "pending"].includes(status)) {
      throw Error("Status inválido.");
    }

    const ref = doc(db, "registrations", id);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      throw Error("Inscrição não encontrada.");
    }

    const team = snap.data();
    const publicRef = doc(db, "publicTeams", id);

    if (status === "approved") {
      const configSnap = await getDoc(doc(db, "settings", "xt"));

      const capacity = Number(
        configSnap.exists()
          ? configSnap.data().capacity
          : DEFAULT_CONFIG.capacity
      );

      const publicSnap = await getDocs(col("publicTeams"));

      const approved = publicSnap.docs.filter(s =>
        s.id !== id && s.data().status === "approved"
      ).length;

      if (approved >= capacity) {
        throw Error("Todas as vagas confirmadas estão ocupadas.");
      }
    }

    const batch = writeBatch(db);
    batch.update(ref, { status });

    if (status === "approved" || status === "reserve") {
      const current = await getDoc(publicRef);
      const old = current.exists() ? current.data() : {};

      batch.set(publicRef, {
        team: team.team,
        logo: team.logo || "",
        status,
        placement: Number(old.placement) || 0,
        kills: Number(old.kills) || 0,
        points: Number(old.points) || 0
      });

    } else {
      batch.delete(publicRef);
    }

    await batch.commit();

    return { ok: true };
  },

  // SALVAR PONTUAÇÃO
  async saveScore(id, placement, kills, points) {
    requireAdmin();

    const ref = doc(db, "publicTeams", id);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      throw Error("Equipe não encontrada.");
    }

    await updateDoc(ref, {
      placement: validateScore(placement),
      kills: validateScore(kills),
      points: validateScore(points)
    });

    return { ok: true };
  },

  // EXCLUIR EQUIPE
  async deleteTeam(id) {
    requireAdmin();

    const batch = writeBatch(db);

    batch.delete(doc(db, "registrations", id));
    batch.delete(doc(db, "publicTeams", id));

    await batch.commit();

    return { ok: true };
  },

  // CONFIGURAÇÕES
  async saveConfig(config) {
    requireAdmin();

    const capacity = Number(config.capacity);

    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 100
    ) {
      throw Error("Limite de equipes inválido.");
    }

    const event = clean(config.event, 100);
    const rules = clean(config.rules, 3000);

    if (!event || !rules) {
      throw Error("Preencha todas as configurações.");
    }

    await setDoc(doc(db, "settings", "xt"), {
      event,
      capacity,
      rules
    });

    return { ok: true };
  },

  // PARCERIAS
  async savePartner(partner) {
    requireAdmin();

    const data = {
      name: clean(partner.name, 80),
      description: clean(partner.description, 500),
      url: clean(partner.url, 500),
      logo: String(partner.logo || "")
    };

    if (!data.name) {
      throw Error("Informe o nome da parceria.");
    }

    if (data.url && !/^https:\/\//i.test(data.url)) {
      throw Error("O link precisa começar com https://");
    }

    if (
      data.logo.length > 80000 ||
      (data.logo &&
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data.logo))
    ) {
      throw Error("Logo inválida.");
    }

    if (partner.id) {
      await setDoc(doc(db, "partners", partner.id), data);
    } else {
      await addDoc(col("partners"), data);
    }

    return { ok: true };
  },

  async deletePartner(id) {
    requireAdmin();

    await deleteDoc(doc(db, "partners", id));

    return { ok: true };
  },

  // RANKING
  async getRanking() {
    const snap = await getDocs(col("publicTeams"));
    return sortedRanking(snap.docs.map(toTeam));
  },

  // HISTÓRICO
  async getHistory() {
    const snap = await getDocs(col("history"));

    return snap.docs
      .map(toTeam)
      .sort((a, b) => {
        const ta = a.finishedAt?.toMillis?.() || 0;
        const tb = b.finishedAt?.toMillis?.() || 0;
        return tb - ta;
      });
  },

  // FINALIZAR XTREINO
  async finish(confirmText) {
    requireAdmin();

    if (confirmText !== "FINALIZAR XT") {
      throw Error("Digite FINALIZAR XT para confirmar.");
    }

    const [registrations, teams, configSnap] = await Promise.all([
      getDocs(col("registrations")),
      getDocs(col("publicTeams")),
      getDoc(doc(db, "settings", "xt"))
    ]);

    if (registrations.empty && teams.empty) {
      throw Error("Nenhuma equipe cadastrada para finalizar.");
    }

    const config = {
      ...DEFAULT_CONFIG,
      ...(configSnap.exists() ? configSnap.data() : {})
    };

    const currentTeams = teams.docs.map(toTeam);
    const ranking = sortedRanking(currentTeams);

    const reserves = currentTeams
      .filter(t => t.status === "reserve")
      .map(t => ({
        team: t.team,
        status: "reserve",
        position: 0,
        placement: Number(t.placement) || 0,
        kills: Number(t.kills) || 0,
        points: Number(t.points) || 0
      }));

    const operations = registrations.size + teams.size + 2;

    if (operations > 500) {
      throw Error("Muitas inscrições para finalizar em uma operação.");
    }

    const batch = writeBatch(db);
    const historyRef = doc(col("history"));

    // SALVAR HISTÓRICO
    batch.set(historyRef, {
      event: config.event,
      finishedAt: serverTimestamp(),
      teamsCount: ranking.length,
      registrationsCount: registrations.size,
      ranking: [...ranking, ...reserves]
    });

    // REMOVER INSCRIÇÕES
    registrations.docs.forEach(s => {
      batch.delete(s.ref);
    });

    // REMOVER EQUIPES E RESERVAS
    teams.docs.forEach(s => {
      batch.delete(s.ref);
    });

    // LIBERAR 12 VAGAS
    batch.set(doc(db, "settings", "xt"), {
      event: config.event,
      capacity: 12,
      rules: config.rules || DEFAULT_RULES
    });

    // EXECUTAR TUDO JUNTO
    await batch.commit();

    return {
      ok: true,
      removed: teams.size,
      registrationsRemoved: registrations.size,
      availableSlots: 12,
      historyId: historyRef.id,
      message:
        "XT FINALIZADO COM SUCESSO! " +
        "Histórico salvo e 12 vagas liberadas."
    };
  },

  // EXPORTAR BACKUP
  async exportBackup() {
    requireAdmin();

    const [
      registrations,
      teams,
      history,
      partners,
      settings
    ] = await Promise.all([
      getDocs(col("registrations")),
      getDocs(col("publicTeams")),
      getDocs(col("history")),
      getDocs(col("partners")),
      getDoc(doc(db, "settings", "xt"))
    ]);

    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      config: settings.exists()
        ? settings.data()
        : DEFAULT_CONFIG,
      registrations: registrations.docs.map(toTeam),
      teams: teams.docs.map(toTeam),
      history: history.docs.map(toTeam),
      partners: partners.docs.map(toTeam)
    }, (key, value) => {
      if (value && typeof value.toDate === "function") {
        return value.toDate().toISOString();
      }
      return value;
    }, 2);
  }
};

export default XT;
