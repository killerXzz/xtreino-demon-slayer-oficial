
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "online",
    campeonato: "DEMON SLAYER 4V4",
    mensagem: "Servidor funcionando!"
  });
});


app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("Servidor iniciado!");
});
