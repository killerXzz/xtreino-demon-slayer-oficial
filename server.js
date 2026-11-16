
const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.MP_ACCESS_TOKEN;
const VALOR_INSCRICAO = 10.00;

// Origem autorizada do site do campeonato
const SITE = "https://killerxzz.github.io";

// Armazenamento temporário para testes
const inscricoes = new Map();

function responder(res, status, dados) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": SITE,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(dados));
}

async function mercadoPago(caminho, opcoes = {}) {
  const resposta = await fetch(
    "https://api.mercadopago.com" + caminho,
    {
      ...opcoes,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        ...(opcoes.headers || {})
      }
    }
  );

  const dados = await resposta.json();

  if (!resposta.ok) {
    console.error("Erro Mercado Pago:", {
      status: resposta.status,
      causa: dados.cause,
      mensagem: dados.message
    });
    throw new Error("Falha na comunicação com Mercado Pago");
  }

  return dados;
}

async function lerJSON(req) {
  let corpo = "";

  for await (const parte of req) {
    corpo += parte;

    if (corpo.length > 10000) {
      throw new Error("Requisição muito grande");
    }
  }

  return JSON.parse(corpo);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") {
    return responder(res, 204, {});
  }

  // Verificar servidor
  if (url.pathname === "/" && req.method === "GET") {
    return responder(res, 200, {
      status: "online",
      campeonato: "DEMON SLAYER 4V4",
      valor_inscricao: VALOR_INSCRICAO,
      pix_configurado: Boolean(TOKEN)
    });
  }

  // Criar cobrança Pix
  if (url.pathname === "/api/pix/criar" &&
      req.method === "POST") {
    try {
      if (!TOKEN) {
        return responder(res, 503, {
          erro: "Mercado Pago não configurado"
        });
      }

      const dados = await lerJSON(req);

      const equipe = String(dados.equipe || "").trim();
      const email = String(dados.email || "").trim();

      if (
        equipe.length < 2 ||
        equipe.length > 50 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        return responder(res, 400, {
          erro: "Informe equipe e e-mail válidos"
        });
      }

      const inscricaoId = crypto.randomUUID();

      // O preço é definido pelo servidor,
      // nunca pelo navegador do jogador.
      const pagamento = await mercadoPago(
        "/v1/payments",
        {
          method: "POST",
          headers: {
            "X-Idempotency-Key": inscricaoId
          },
          body: JSON.stringify({
            transaction_amount: VALOR_INSCRICAO,
            description: "Campeonato 4V4 DEMON SLAYER",
            payment_method_id: "pix",
            external_reference: inscricaoId,
            payer: {
              email
            }
          })
        }
      );

      inscricoes.set(inscricaoId, {
        equipe,
        email,
        pagamentoId: String(pagamento.id),
        status: "pendente"
      });

      const pix =
        pagamento.point_of_interaction
          ?.transaction_data || {};

      return responder(res, 201, {
        inscricao_id: inscricaoId,
        pagamento_id: pagamento.id,
        equipe,
        valor: VALOR_INSCRICAO,
        status: "pendente",
        qr_code: pix.qr_code,
        qr_code_base64: pix.qr_code_base64,
        ticket_url: pix.ticket_url
      });

    } catch (erro) {
      console.error(erro.message);

      return responder(res, 500, {
        erro: "Não foi possível gerar o Pix"
      });
    }
  }

  // Consultar pagamento
  if (url.pathname === "/api/pix/status" &&
      req.method === "GET") {
    try {
      const id = url.searchParams.get("inscricao_id");
      const inscricao = inscricoes.get(id);

      if (!inscricao) {
        return responder(res, 404, {
          erro: "Inscrição não encontrada"
        });
      }

      const pagamento = await mercadoPago(
        "/v1/payments/" + inscricao.pagamentoId
      );

      const aprovado =
        pagamento.status === "approved" &&
        pagamento.payment_method_id === "pix" &&
        pagamento.currency_id === "BRL" &&
        Number(pagamento.transaction_amount) ===
          VALOR_INSCRICAO &&
        String(pagamento.id) ===
          inscricao.pagamentoId &&
        pagamento.external_reference === id;

      if (aprovado) {
        inscricao.status = "pago";
      }

      return responder(res, 200, {
        inscricao_id: id,
        equipe: inscricao.equipe,
        valor: VALOR_INSCRICAO,
        status: inscricao.status,
        pagamento_confirmado: aprovado
      });

    } catch (erro) {
      console.error(erro.message);

      return responder(res, 500, {
        erro: "Não foi possível consultar o pagamento"
      });
    }
  }

  responder(res, 404, {
    erro: "Rota não encontrada"
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Servidor DEMON SLAYER online na porta ${PORT}`
  );
});
