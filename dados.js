
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

const firebaseConfig = {
  apiKey: "AIzaSyBX6hLTNoeD9LhcUv-lG3qqW69MbJdGQN8",
  authDomain: "demon-slayer-xtreino-e81b7.firebaseapp.com",
  projectId: "demon-slayer-xtreino-e81b7",
  storageBucket: "demon-slayer-xtreino-e81b7.firebasestorage.app",
  messagingSenderId: "545991125458",
  appId: "1:545991125458:web:e9bdb3322edad31907800b"
};

const ADMIN_UID = "tadNQeNTUQMGd5UTqT9HdnlTnfk2";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const DEFAULT_RULES =
  "Sem cavalo. Carros apenas para locomoção. " +
  "Proibido marcar na loja. 4 quedas: Bermuda, " +
  "Purgatório, Kalahari e Nova Terra. " +
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

const XT = {
  isAdmin,

  watchAuth(callback) {
    return onAuthStateChanged(auth, user => {
      callback(Boolean(user && user.uid === ADMIN_UID));
    });
  },

  async login(email, password) {
    const result = await signInWithEmailAndPassword(
      auth,
      email.trim(),
      password
    );

    if (result.user.uid !== ADMIN_UID) {
      await signOut(auth);
      throw Error("Esta conta não é administradora.");
    }

    return { ok: true };
  },

  async logout() {
    await signOut(auth);
    return { ok: true };
  },

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

    const unsubscribers = [];

    unsubscribers.push(
      onSnapshot(doc(db, "settings", "xt"), snap => {
        data.config = {
          ...DEFAULT_CONFIG,
          ...(snap.exists() ? snap.data() : {})
        };
        emit();
      }, onError)
    );

    unsubscribers.push(
      onSnapshot(col("publicTeams"), snap => {
        data.teams = snap.docs.map(toTeam);
        emit();
      }, onError)
    );

    unsubscribers.push(
      onSnapshot(col("history"), snap => {
        data.history = snap.docs.map(toTeam);
        emit();
      }, onError)
    );

    unsubscribers.push(
      onSnapshot(col("partners"), snap => {
        data.partners = snap.docs.map(toTeam);
        emit();
      }, onError)
    );

    emit();

    return () => unsubscribers.forEach(fn => fn());
  },

  watchRegistrations(callback, onError) {
    requireAdmin();

    return onSnapshot(col("registrations"), snap => {
      callback(snap.docs.map(toTeam));
    }, onError);
  },

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
      (logo && !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(logo))
    ) {
      throw Error("Logo inválida ou muito grande.");
    }

    const publicSnap = await getDocs(col("publicTeams"));
    const configSnap = await getDoc(doc(db, "settings", "xt"));

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

    return { ok: true };
  },

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

  async deleteTeam(id) {
    requireAdmin();

    const batch = writeBatch(db);
    batch.delete(doc(db, "registrations", id));
    batch.delete(doc(db, "publicTeams", id));
    await batch.commit();

    return { ok: true };
  },

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

  async finish(confirmText) {
    requireAdmin();

    if (confirmText !== "FINALIZAR XT") {
      throw Error("Digite FINALIZAR XT.");
    }

    const registrations = await getDocs(col("registrations"));
    const teams = await getDocs(col("publicTeams"));
    const configSnap = await getDoc(doc(db, "settings", "xt"));

    if (registrations.empty && teams.empty) {
      throw Error("Nenhuma equipe cadastrada.");
    }

    const config = {
      ...DEFAULT_CONFIG,
      ...(configSnap.exists() ? configSnap.data() : {})
    };

    const ranking = teams.docs
      .map(s => ({
        team: s.data().team,
        status: s.data().status,
        placement: Number(s.data().placement) || 0,
        kills: Number(s.data().kills) || 0,
        points: Number(s.data().points) || 0
      }))
      .filter(t => t.status === "approved")
      .sort((a, b) =>
        b.points - a.points || b.kills - a.kills
      );

    const batch = writeBatch(db);

    const historyRef = doc(col("history"));

    batch.set(historyRef, {
      event: config.event,
      finishedAt: serverTimestamp(),
      teamsCount: ranking.length,
      ranking
    });

    registrations.docs.forEach(s => batch.delete(s.ref));
    teams.docs.forEach(s => batch.delete(s.ref));

    if (registrations.size + teams.size + 1 > 500) {
      throw Error("Muitas equipes para finalizar em uma operação.");
    }

    await batch.commit();

    return {
      ok: true,
      removed: teams.size,
      message: "XT finalizado! Histórico salvo e vagas liberadas."
    };
  }
};

export default XT;

