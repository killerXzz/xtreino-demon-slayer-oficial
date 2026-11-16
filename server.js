
"use strict";

const http = require("http");
const crypto = require("crypto");
const admin = require("firebase-admin");

const PORT = Number(process.env.PORT || 3000);
const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
const ADMIN_UID = process.env.FIREBASE_ADMIN_UID;

const SITE = "https://killerxzz.github.io";
const PRECO = 10;
const TOTAL_VAGAS = 24;
const MAX_BODY = 450000;
const MAX_LOGO = 180000;

const FASES = {
  "Oitavas de final": 8,
  "Quartas de final": 4,
  "Semifinal": 2,
  "Final": 1
};

// CONFIGURAÇÃO FIREBASE
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw new Error(
    "Configure FIREBASE_SERVICE_ACCOUNT_JSON no Render"
  );
}

if (!ADMIN_UID) {
  throw new Error(
    "Configure FIREBASE_ADMIN_UID no Render"
  );
}

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const equipesRef = db.collection("campeonato4v4_equipes");
const confrontosRef = db.collection("campeonato4v4_confrontos");
const configRef = db
  .collection("campeonato4v4_config")
  .doc("vagas");

// RESPOSTAS DO SERVIDOR
function responder(res, status, dados) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": SITE,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  });

  if (status === 204) {
    return res.end();
  }

  res.end(JSON.stringify(dados));
}

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  throw e;
}

function texto(valor, limite = 60) {
  if (typeof valor !== "string") return "";
  return valor.trim().slice(0, limite);
}

function validarId(id) {
  return typeof id === "string" &&
    /^[A-Za-z0-9]{15,100}$/.test(id);
}

// RECEBER JSON COM LOGO
async function lerJSON(req) {
  let conteudo = "";
  let bytes = 0;

  for await (const parte of req) {
    bytes += parte.length;

    if (bytes > MAX_BODY) {
      erro("Imagem ou requisição muito grande", 413);
    }

    conteudo += parte.toString("utf8");
  }

  try {
    const dados = JSON.parse(conteudo);

    if (!dados || typeof dados !== "object" ||
        Array.isArray(dados)) {
      erro("Dados inválidos");
    }

    return dados;
  } catch (e) {
    if (e.status) throw e;
    erro("JSON inválido");
  }
}

// LOGO: HTTPS OU IMAGEM PROCESSADA EM BASE64
function validarLogo(valor) {
  if (typeof valor !== "string") {
    erro("Selecione a logo da equipe");
  }

  // Aceita JPEG, PNG e WebP comprimidos pelo HTML
  const match = valor.match(
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/
  );

  if (match) {
    if (valor.length > MAX_LOGO) {
      erro("A logo processada ficou muito grande", 413);
    }

    const imagem = Buffer.from(match[2], "base64");

    if (imagem.length < 20 ||
        imagem.length > 135000) {
      erro("Tamanho da logo inválido");
    }

    const tipo = match[1];

    const jpeg =
      imagem[0] === 0xff &&
      imagem[1] === 0xd8 &&
      imagem[2] === 0xff;

    const png =
      imagem.subarray(0, 8).equals(
        Buffer.from([
          137, 80, 78, 71, 13, 10, 26, 10
        ])
      );

    const webp =
      imagem.toString("ascii", 0, 4) === "RIFF" &&
      imagem.toString("ascii", 8, 12) === "WEBP";

    if (
      (tipo === "jpeg" && !jpeg) ||
      (tipo === "png" && !png) ||
      (tipo === "webp" && !webp)
    ) {
      erro("O conteúdo da imagem é inválido");
    }

    return valor;
  }

  // Compatibilidade com logos HTTPS antigas
  try {
    const url = new URL(valor);

    if (
      url.protocol === "https:" &&
      valor.length <= 500
    ) {
      return valor;
    }
  } catch {}

  erro("Escolha uma imagem válida do celular ou PC");
}

// VERIFICAR ADMINISTRADOR FIREBASE
async function verificarAdmin(req) {
  const authorization =
    req.headers.authorization || "";

  const match = authorization.match(
    /^Bearer\s+(.+)$/i
  );

  if (!match) {
    erro("Faça login no painel ADM", 401);
  }

  let usuario;

  try {
    usuario = await admin
      .auth()
      .verifyIdToken(match[1], true);
  } catch {
    erro("Login inválido ou expirado", 401);
  }

  if (usuario.uid !== ADMIN_UID) {
    erro("Você não tem autorização ADM", 403);
  }

  const cadastro = await db
    .collection("admins")
    .doc(usuario.uid)
    .get();

  if (!cadastro.exists) {
    erro("Administrador não cadastrado no Firebase", 403);
  }

  return usuario;
}

// MERCADO PAGO
async function mercadoPago(caminho, opcoes = {}) {
  if (!MP_TOKEN) {
    erro("Mercado Pago não configurado", 503);
  }

  let resposta;

  try {
    resposta = await fetch(
      "https://api.mercadopago.com" + caminho,
      {
        ...opcoes,
        headers: {
          Authorization: "Bearer " + MP_TOKEN,
          "Content-Type": "application/json",
          ...(opcoes.headers || {})
        },
        signal: AbortSignal.timeout(20000)
      }
    );
  } catch {
    erro("Não foi possível conectar ao Mercado Pago", 502);
  }

  let dados;

  try {
    dados = await resposta.json();
  } catch {
    erro("Resposta inválida do Mercado Pago", 502);
  }

  if (!resposta.ok) {
    console.error(
      "Mercado Pago:",
      resposta.status,
      dados.message
    );

    erro("Falha na comunicação com Mercado Pago", 502);
  }

  return dados;
}

// BUSCAR EQUIPES E CONFRONTOS
async function listarCampeonato() {
  const [equipesSnap, confrontosSnap] =
    await Promise.all([
      equipesRef
        .where("status", "==", "confirmada")
        .get(),
      confrontosRef.get()
    ]);

  const equipes = equipesSnap.docs.map(doc => {
    const d = doc.data();

    return {
      id: doc.id,
      equipe: d.equipe,
      logo: d.logo,
      capitao: d.capitao || "",
      slot: d.slot || null
    };
  });

  equipes.sort(
    (a, b) => (a.slot || 99) - (b.slot || 99)
  );

  const confrontos = confrontosSnap.docs.map(
    doc => doc.data()
  );

  return { equipes, confrontos };
}

// DISTRIBUIR SLOT DE FORMA SEGURA
async function confirmarEquipe(id, manual = false) {
  const ref = equipesRef.doc(id);

  return db.runTransaction(async tx => {
    const [configSnap, equipeSnap] =
      await Promise.all([
        tx.get(configRef),
        tx.get(ref)
      ]);

    if (!equipeSnap.exists) {
      erro("Equipe não encontrada", 404);
    }

    const equipe = equipeSnap.data();

    if (equipe.status === "confirmada") {
      return {
        confirmado: true,
        slot: equipe.slot
      };
    }

    const slots = configSnap.exists
      ? { ...(configSnap.get("slots") || {}) }
      : {};

    const usados = new Set(
      Object.values(slots).map(Number)
    );

    let slot = 1;

    while (
      usados.has(slot) &&
      slot <= TOTAL_VAGAS
    ) {
      slot++;
    }

    if (slot > TOTAL_VAGAS) {
      tx.update(ref, {
        status: "pago_aguardando_vaga"
      });

      return {
        confirmado: false,
        slot: null
      };
    }

    slots[id] = slot;

    tx.set(
      configRef,
      { slots },
      { merge: true }
    );

    tx.update(ref, {
      status: "confirmada",
      slot,
      manualApproval: manual,
      confirmedAt:
        admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      confirmado: true,
      slot
    };
  });
}

// VERIFICAR PAGAMENTO DIRETAMENTE NO MERCADO PAGO
async function consultarPagamento(id) {
  if (!validarId(id)) {
    erro("ID da inscrição inválido");
  }

  const ref = equipesRef.doc(id);
  const snap = await ref.get();

  if (!snap.exists) {
    erro("Inscrição não encontrada", 404);
  }

  const equipe = snap.data();

  if (!equipe.pagamentoId) {
    erro("Pagamento não encontrado", 404);
  }

  const pagamento = await mercadoPago(
    "/v1/payments/" +
    encodeURIComponent(equipe.pagamentoId)
  );

  const aprovado =
    pagamento.status === "approved" &&
    pagamento.payment_method_id === "pix" &&
    pagamento.currency_id === "BRL" &&
    Number(pagamento.transaction_amount) === PRECO &&
    String(pagamento.id) ===
      String(equipe.pagamentoId) &&
    pagamento.external_reference === id;

  if (aprovado &&
      equipe.status !== "confirmada") {
    await confirmarEquipe(id);
  }

  const atualizado = await ref.get();
  const dados = atualizado.data();

  return {
    inscricao_id: id,
    equipe: dados.equipe,
    valor: PRECO,
    status: dados.status,
    pagamento_confirmado: aprovado,
    slot: dados.slot || null
  };
}

// SERVIDOR
const server = http.createServer(
  async (req, res) => {
    try {
      const url = new URL(
        req.url,
        "http://localhost"
      );

      const rota = url.pathname;
      const metodo = req.method;

      if (metodo === "OPTIONS") {
        return responder(res, 204, {});
      }

      // STATUS DO SERVIDOR
      if (
        metodo === "GET" &&
        rota === "/"
      ) {
        return responder(res, 200, {
          status: "online",
          campeonato: "DEMON SLAYER 4V4",
          valor_inscricao: PRECO,
          vagas: TOTAL_VAGAS,
          pix_configurado: Boolean(MP_TOKEN),
          firebase_configurado: true,
          upload_logo: true
        });
      }

      // CAMPEONATO PÚBLICO
      if (
        metodo === "GET" &&
        rota === "/api/campeonato"
      ) {
        return responder(
          res,
          200,
          await listarCampeonato()
        );
      }

      // CRIAR PIX
      if (
        metodo === "POST" &&
        rota === "/api/pix/criar"
      ) {
        const dados = await lerJSON(req);

        const equipe = texto(dados.equipe, 50);
        const email = texto(dados.email, 120);
        const capitao = texto(dados.capitao);
        const whatsapp = texto(
          dados.whatsapp,
          25
        );

        const logo = validarLogo(dados.logo);

        const jogadores = [
          texto(dados.jogador1),
          texto(dados.jogador2),
          texto(dados.jogador3),
          texto(dados.jogador4)
        ];

        if (
          equipe.length < 2 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          !capitao ||
          !whatsapp ||
          jogadores.some(j => !j)
        ) {
          erro("Preencha todos os dados da equipe");
        }

        const configSnap = await configRef.get();

        const slots = configSnap.exists
          ? configSnap.get("slots") || {}
          : {};

        if (
          Object.keys(slots).length >= TOTAL_VAGAS
        ) {
          erro("Todas as vagas estão ocupadas");
        }

        const chave = equipe.toLocaleLowerCase(
          "pt-BR"
        );

        const duplicadas = await equipesRef
          .where("equipeKey", "==", chave)
          .get();

        const existe = duplicadas.docs.some(
          doc => [
            "criando_pix",
            "pendente",
            "confirmada",
            "pago_aguardando_vaga"
          ].includes(doc.get("status"))
        );

        if (existe) {
          erro("Essa equipe já está inscrita");
        }

        const ref = equipesRef.doc();

        await ref.set({
          equipe,
          equipeKey: chave,
          email,
          capitao,
          whatsapp,
          logo,
          jogadores,
          status: "criando_pix",
          createdAt:
            admin.firestore.FieldValue.serverTimestamp()
        });

        try {
          const pagamento = await mercadoPago(
            "/v1/payments",
            {
              method: "POST",
              headers: {
                "X-Idempotency-Key": ref.id
              },
              body: JSON.stringify({
                transaction_amount: PRECO,
                description:
                  "Campeonato 4V4 DEMON SLAYER",
                payment_method_id: "pix",
                external_reference: ref.id,
                payer: { email }
              })
            }
          );

          await ref.update({
            pagamentoId: String(pagamento.id),
            status: "pendente"
          });

          const pix =
            pagamento.point_of_interaction
              ?.transaction_data || {};

          return responder(res, 201, {
            inscricao_id: ref.id,
            pagamento_id: pagamento.id,
            equipe,
            valor: PRECO,
            status: "pendente",
            qr_code: pix.qr_code || "",
            qr_code_base64:
              pix.qr_code_base64 || "",
            ticket_url: pix.ticket_url || ""
          });

        } catch (e) {
          await ref.update({
            status: "erro_pix"
          });

          throw e;
        }
      }

      // CONSULTAR PIX
      if (
        metodo === "GET" &&
        rota === "/api/pix/status"
      ) {
        const id = url.searchParams.get(
          "inscricao_id"
        );

        const resultado =
          await consultarPagamento(id);

        return responder(res, 200, resultado);
      }

      // PAINEL ADMINISTRATIVO
      if (
        metodo === "GET" &&
        rota === "/api/admin/campeonato"
      ) {
        await verificarAdmin(req);

        const snap = await equipesRef.get();

        const inscricoes = snap.docs.map(doc => {
          const d = doc.data();

          return {
            id: doc.id,
            equipe: d.equipe,
            logo: d.logo,
            capitao: d.capitao,
            whatsapp: d.whatsapp,
            jogadores: d.jogadores || [],
            status: d.status,
            slot: d.slot || null,
            manual: Boolean(d.manual)
          };
        });

        inscricoes.sort(
          (a, b) =>
            (a.slot || 99) -
            (b.slot || 99)
        );

        return responder(res, 200, {
          ...(await listarCampeonato()),
          inscricoes
        });
      }

      // ADM: ADICIONAR EQUIPE MANUALMENTE
      if (
        metodo === "POST" &&
        rota === "/api/admin/equipes"
      ) {
        await verificarAdmin(req);

        const dados = await lerJSON(req);

        const equipe = texto(dados.equipe, 50);
        const logo = validarLogo(dados.logo);
        const capitao = texto(dados.capitao);
        const whatsapp = texto(
          dados.whatsapp,
          25
        );

        if (
          !equipe ||
          !capitao ||
          !whatsapp
        ) {
          erro("Preencha os dados da equipe");
        }

        const ref = equipesRef.doc();

        await db.runTransaction(async tx => {
          const configSnap =
            await tx.get(configRef);

          const slots = configSnap.exists
            ? { ...(configSnap.get("slots") || {}) }
            : {};

          const usados = new Set(
            Object.values(slots).map(Number)
          );

          let slot = 1;

          while (
            usados.has(slot) &&
            slot <= TOTAL_VAGAS
          ) {
            slot++;
          }

          if (slot > TOTAL_VAGAS) {
            erro("Todas as vagas estão ocupadas");
          }

          slots[ref.id] = slot;

          tx.set(
            configRef,
            { slots },
            { merge: true }
          );

          tx.set(ref, {
            equipe,
            equipeKey:
              equipe.toLocaleLowerCase("pt-BR"),
            logo,
            capitao,
            whatsapp,
            slot,
            status: "confirmada",
            manual: true,
            createdAt:
              admin.firestore.FieldValue.serverTimestamp()
          });
        });

        return responder(res, 201, {
          ok: true,
          id: ref.id
        });
      }

      // ADM: CONFIRMAR EQUIPE MANUALMENTE
      if (
        metodo === "POST" &&
        rota === "/api/admin/confirmar"
      ) {
        await verificarAdmin(req);

        const dados = await lerJSON(req);
        const id = texto(dados.id, 100);

        if (!validarId(id)) {
          erro("ID da equipe inválido");
        }

        const resultado =
          await confirmarEquipe(id, true);

        return responder(res, 200, {
          ok: true,
          ...resultado
        });
      }

      // ADM: EXCLUIR EQUIPE
      if (
        metodo === "POST" &&
        rota === "/api/admin/excluir"
      ) {
        await verificarAdmin(req);

        const dados = await lerJSON(req);
        const id = texto(dados.id, 100);

        if (!validarId(id)) {
          erro("ID inválido");
        }

        const ref = equipesRef.doc(id);

        await db.runTransaction(async tx => {
          const [configSnap, equipeSnap] =
            await Promise.all([
              tx.get(configRef),
              tx.get(ref)
            ]);

          if (!equipeSnap.exists) {
            erro("Equipe não encontrada", 404);
          }

          const slots = configSnap.exists
            ? { ...(configSnap.get("slots") || {}) }
            : {};

          delete slots[id];

          // Substitui o mapa inteiro para remover
          // corretamente a vaga da equipe excluída.
          tx.set(configRef, { slots });

          tx.delete(ref);
        });

        return responder(res, 200, {
          ok: true
        });
      }

      // ADM: EDITAR CONFRONTOS
      if (
        metodo === "POST" &&
        rota === "/api/admin/confrontos"
      ) {
        await verificarAdmin(req);

        const dados = await lerJSON(req);

        const fase = texto(dados.fase, 50);
        const numero = dados.numero;

        const time1 = texto(dados.time1, 100);
        const time2 = texto(dados.time2, 100);
        const vencedor = texto(
          dados.vencedor,
          100
        );

        if (
          !FASES[fase] ||
          !Number.isInteger(numero) ||
          numero < 1 ||
          numero > FASES[fase]
        ) {
          erro("Confronto inválido");
        }

        if (
          time1 &&
          time2 &&
          time1 === time2
        ) {
          erro("Escolha equipes diferentes");
        }

        if (
          vencedor &&
          ![time1, time2].includes(vencedor)
        ) {
          erro(
            "O vencedor precisa participar do confronto"
          );
        }

        for (const id of [
          time1,
          time2
        ].filter(Boolean)) {
          if (!validarId(id)) {
            erro("ID de equipe inválido");
          }

          const snap = await equipesRef
            .doc(id)
            .get();

          if (
            !snap.exists ||
            snap.get("status") !== "confirmada"
          ) {
            erro("Equipe não confirmada");
          }
        }

        const confronto = {
          fase,
          numero,
          time1,
          time2,
          vencedor
        };

        await confrontosRef
          .doc(fase + "_" + numero)
          .set(confronto);

        return responder(res, 200, {
          ok: true
        });
      }

      return responder(res, 404, {
        erro: "Rota não encontrada"
      });

    } catch (e) {
      console.error(
        "Erro no servidor:",
        e.message
      );

      return responder(
        res,
        e.status || 500,
        {
          erro: e.status
            ? e.message
            : "Erro interno no servidor"
        }
      );
    }
  }
);

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    "Servidor DEMON SLAYER 4V4 online na porta " +
    PORT
  );
});
