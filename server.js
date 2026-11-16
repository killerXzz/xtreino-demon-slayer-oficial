
const http = require("http");
const admin = require("firebase-admin");

const PORT = Number(process.env.PORT || 3000);
const PRICE = 10;
const ORIGIN = "https://killerxzz.github.io";
const MP = process.env.MP_ACCESS_TOKEN;
const ADMIN_UID = process.env.FIREBASE_ADMIN_UID;

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw Error("Configure FIREBASE_SERVICE_ACCOUNT_JSON no Render");
}

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  )
});

const db = admin.firestore();
const teams = db.collection("campeonato4v4_equipes");
const matches = db.collection("campeonato4v4_confrontos");
const stateRef = db.collection("campeonato4v4_config").doc("vagas");

function reply(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function fail(message, status = 400) {
  const e = Error(message);
  e.status = status;
  throw e;
}

async function body(req) {
  let s = "";
  for await (const b of req) {
    s += b;
    if (s.length > 15000) {
      fail("Dados muito grandes", 413);
    }
  }
  try {
    return JSON.parse(s);
  } catch {
    fail("JSON inválido");
  }
}

function str(x, max = 60) {
  return typeof x === "string" ? x.trim().slice(0, max) : "";
}

function logo(x) {
  const v = str(x, 500);
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? v : "";
  } catch {
    return "";
  }
}

async function authenticate(req) {
  const token = (req.headers.authorization || "")
    .match(/^Bearer (.+)$/)?.[1];

  if (!token) fail("Faça login no ADM Firebase", 401);

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token, true);
  } catch {
    fail("Login expirado ou inválido", 401);
  }

  if (ADMIN_UID && decoded.uid !== ADMIN_UID) {
    fail("Conta não autorizada", 403);
  }

  const doc = await db.collection("admins").doc(decoded.uid).get();
  if (!doc.exists) {
    fail("Conta não cadastrada em admins", 403);
  }

  return decoded;
}

async function mp(path, opts = {}) {
  if (!MP) fail("Configure MP_ACCESS_TOKEN", 503);

  const r = await fetch("https://api.mercadopago.com" + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + MP,
      "Content-Type": "application/json",
      ...(opts.headers || {})
    }
  });

  const d = await r.json();

  if (!r.ok) {
    console.error("Mercado Pago:", r.status, d.message);
    fail("Erro na API de pagamentos", 502);
  }

  return d;
}

async function list() {
  const [a, b] = await Promise.all([
    teams.where("status", "==", "confirmada").get(),
    matches.get()
  ]);

  const equipes = a.docs.map(d => ({
    id: d.id,
    equipe: d.get("equipe"),
    logo: d.get("logo"),
    slot: d.get("slot"),
    capitao: d.get("capitao")
  })).sort((x, y) => (x.slot || 99) - (y.slot || 99));

  const confrontos = b.docs.map(d => d.data());

  return { equipes, confrontos };
}

async function status(id) {
  const ref = teams.doc(id);
  const snap = await ref.get();

  if (!snap.exists) fail("Inscrição não encontrada", 404);

  const t = snap.data();
  if (!t.pagamentoId) fail("Cobrança não encontrada", 404);

  const p = await mp(
    "/v1/payments/" + encodeURIComponent(t.pagamentoId)
  );

  const ok =
    p.status === "approved" &&
    p.payment_method_id === "pix" &&
    p.currency_id === "BRL" &&
    Number(p.transaction_amount) === PRICE &&
    String(p.id) === t.pagamentoId &&
    p.external_reference === id;

  if (ok) {
    await db.runTransaction(async tx => {
      const [state, fresh] = await Promise.all([
        tx.get(stateRef),
        tx.get(ref)
      ]);

      if (fresh.get("status") === "confirmada") return;

      const slots = state.exists ? (state.get("slots") || {}) : {};
      const used = new Set(Object.values(slots).map(Number));

      let slot = 1;
      while (used.has(slot) && slot <= 24) slot++;

      if (slot > 24) {
        tx.update(ref, { status: "pago_aguardando_vaga" });
        return;
      }

      slots[id] = slot;
      tx.set(stateRef, { slots }, { merge: true });

      tx.update(ref, {
        status: "confirmada",
        slot,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
  }

  const latest = await ref.get();

  return {
    inscricao_id: id,
    equipe: t.equipe,
    valor: PRICE,
    status: latest.get("status"),
    pagamento_confirmado: ok,
    slot: latest.get("slot") || null
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");

    if (req.method === "OPTIONS") {
      return reply(res, 204, {});
    }

    if (req.method === "GET" && u.pathname === "/") {
      return reply(res, 200, {
        status: "online",
        campeonato: "DEMON SLAYER 4V4",
        valor_inscricao: PRICE,
        pix_configurado: !!MP
      });
    }

    if (req.method === "GET" &&
        u.pathname === "/api/campeonato") {
      return reply(res, 200, await list());
    }

    // GERAR PIX
    if (req.method === "POST" &&
        u.pathname === "/api/pix/criar") {
      const d = await body(req);

      const equipe = str(d.equipe, 50);
      const email = str(d.email, 120);
      const capitao = str(d.capitao);
      const whatsapp = str(d.whatsapp, 25);
      const image = logo(d.logo);

      const jogadores = [1, 2, 3, 4].map(i =>
        str(d["jogador" + i])
      );

      if (
        equipe.length < 2 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !capitao ||
        !whatsapp ||
        !image ||
        jogadores.some(x => !x)
      ) {
        fail("Preencha todos os campos corretamente");
      }

      const currentState = await stateRef.get();

      if (
        Object.keys(currentState.get("slots") || {}).length >= 24
      ) {
        fail("Todas as vagas estão ocupadas");
      }

      const pending = await teams
        .where("equipeKey", "==", equipe.toLocaleLowerCase("pt-BR"))
        .get();

      if (pending.docs.some(x =>
        ["confirmada", "pendente", "pago_aguardando_vaga"]
          .includes(x.get("status"))
      )) {
        fail("Essa equipe já possui uma inscrição");
      }

      const ref = teams.doc();

      await ref.set({
        equipe,
        equipeKey: equipe.toLocaleLowerCase("pt-BR"),
        email,
        capitao,
        whatsapp,
        logo: image,
        jogadores,
        status: "criando_pix",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      try {
        const payment = await mp("/v1/payments", {
          method: "POST",
          headers: {
            "X-Idempotency-Key": ref.id
          },
          body: JSON.stringify({
            transaction_amount: PRICE,
            description: "Inscrição Campeonato 4V4 DEMON SLAYER",
            payment_method_id: "pix",
            external_reference: ref.id,
            payer: { email }
          })
        });

        await ref.update({
          pagamentoId: String(payment.id),
          status: "pendente"
        });

        const q = payment.point_of_interaction?.transaction_data || {};

        return reply(res, 201, {
          inscricao_id: ref.id,
          pagamento_id: payment.id,
          valor: PRICE,
          qr_code: q.qr_code,
          qr_code_base64: q.qr_code_base64,
          ticket_url: q.ticket_url
        });
      } catch (e) {
        await ref.update({ status: "erro_pix" });
        throw e;
      }
    }

    // VERIFICAR PAGAMENTO
    if (req.method === "GET" &&
        u.pathname === "/api/pix/status") {
      const id = u.searchParams.get("inscricao_id");

      if (!id || !/^[a-zA-Z0-9]{15,40}$/.test(id)) {
        fail("ID inválido");
      }

      return reply(res, 200, await status(id));
    }

    // LISTAR INSCRIÇÕES PARA O ADM
    if (req.method === "GET" &&
        u.pathname === "/api/admin/campeonato") {
      await authenticate(req);

      const all = await teams.get();

      return reply(res, 200, {
        ...(await list()),
        inscricoes: all.docs.map(d => ({
          id: d.id,
          ...d.data(),
          pagamentoId: undefined,
          email: undefined
        })).sort((a, b) =>
          (a.slot || 99) - (b.slot || 99)
        )
      });
    }

    // ADICIONAR EQUIPE MANUALMENTE
    if (req.method === "POST" &&
        u.pathname === "/api/admin/equipes") {
      await authenticate(req);

      const d = await body(req);
      const equipe = str(d.equipe, 50);
      const image = logo(d.logo);

      if (!equipe || !image) {
        fail("Equipe e logo HTTPS obrigatórias");
      }

      const ref = teams.doc();

      await db.runTransaction(async tx => {
        const state = await tx.get(stateRef);
        const slots = state.exists ? (state.get("slots") || {}) : {};
        const used = new Set(Object.values(slots).map(Number));

        let slot = 1;
        while (used.has(slot) && slot <= 24) slot++;

        if (slot > 24) {
          fail("Todas as vagas estão ocupadas");
        }

        slots[ref.id] = slot;

        tx.set(stateRef, { slots }, { merge: true });
        tx.set(ref, {
          equipe,
          equipeKey: equipe.toLocaleLowerCase("pt-BR"),
          logo: image,
          capitao: str(d.capitao),
          whatsapp: str(d.whatsapp),
          status: "confirmada",
          slot,
          manual: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      return reply(res, 201, { ok: true, id: ref.id });
    }

    // EXCLUIR EQUIPE
    if (req.method === "POST" &&
        u.pathname === "/api/admin/excluir") {
      await authenticate(req);

      const d = await body(req);
      const id = str(d.id, 100);

      if (!id) fail("ID obrigatório");

      const ref = teams.doc(id);

      await db.runTransaction(async tx => {
        const [state, snap] = await Promise.all([
          tx.get(stateRef),
          tx.get(ref)
        ]);

        if (!snap.exists) {
          fail("Equipe não encontrada", 404);
        }

        const slots = state.exists ? (state.get("slots") || {}) : {};
        delete slots[id];

        tx.set(stateRef, { slots }, { merge: true });
        tx.delete(ref);
      });

      return reply(res, 200, { ok: true });
    }

    // CONFIRMAR MANUALMENTE
    if (req.method === "POST" &&
        u.pathname === "/api/admin/confirmar") {
      await authenticate(req);

      const d = await body(req);
      const id = str(d.id, 100);
      const ref = teams.doc(id);

      await db.runTransaction(async tx => {
        const [state, snap] = await Promise.all([
          tx.get(stateRef),
          tx.get(ref)
        ]);

        if (!snap.exists) {
          fail("Equipe não encontrada", 404);
        }

        if (snap.get("status") === "confirmada") return;

        const slots = state.exists ? (state.get("slots") || {}) : {};
        const used = new Set(Object.values(slots).map(Number));

        let slot = 1;
        while (used.has(slot) && slot <= 24) slot++;

        if (slot > 24) {
          fail("Todas as vagas estão ocupadas");
        }

        slots[id] = slot;

        tx.set(stateRef, { slots }, { merge: true });
        tx.update(ref, {
          slot,
          status: "confirmada",
          manualApproval: true,
          confirmedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      return reply(res, 200, { ok: true });
    }

    // GERENCIAR CONFRONTOS
    if (req.method === "POST" &&
        u.pathname === "/api/admin/confrontos") {
      await authenticate(req);

      const d = await body(req);

      const phases = {
        "Oitavas de final": 8,
        "Quartas de final": 4,
        "Semifinal": 2,
        "Final": 1
      };

      if (
        !phases[d.fase] ||
        !Number.isInteger(d.numero) ||
        d.numero < 1 ||
        d.numero > phases[d.fase]
      ) {
        fail("Confronto inválido");
      }

      const time1 = str(d.time1, 100);
      const time2 = str(d.time2, 100);
      const vencedor = str(d.vencedor, 100);

      if (time1 && time1 === time2) {
        fail("Escolha equipes diferentes");
      }

      if (vencedor && ![time1, time2].includes(vencedor)) {
        fail("O vencedor deve participar do confronto");
      }

      for (const id of [time1, time2].filter(Boolean)) {
        const s = await teams.doc(id).get();

        if (!s.exists || s.get("status") !== "confirmada") {
          fail("Equipe não confirmada");
        }
      }

      const data = {
        fase: d.fase,
        numero: d.numero,
        time1,
        time2,
        vencedor
      };

      await matches.doc(d.fase + "_" + d.numero).set(data);

      return reply(res, 200, { ok: true });
    }

    return reply(res, 404, {
      erro: "Rota não encontrada"
    });

  } catch (e) {
    console.error(e.message);

    return reply(res, e.status || 500, {
      erro: e.status ? e.message : "Erro interno no servidor"
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    "Campeonato DEMON SLAYER online na porta " + PORT
  );
});

