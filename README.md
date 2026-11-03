# DEMꓳN SLꓥYER — Site de inscrições XTREINO

Projeto com site público, inscrições online e painel ADM usando Firebase Authentication + Firestore + Firebase Hosting.

## 1. Crie o projeto Firebase
1. Abra https://console.firebase.google.com/ e clique em **Adicionar projeto**.
2. No menu **Build > Authentication > Sign-in method**, ative **E-mail/senha**.
3. Em **Authentication > Users**, clique em **Adicionar usuário** e crie sua conta ADM com um e-mail seu e senha forte (não compartilhe a senha).
4. Em **Build > Firestore Database**, clique em **Criar banco de dados**. Escolha uma região próxima e o **modo de produção**.
5. Em **Configurações do projeto > Seus apps**, adicione um app **Web**. Copie os valores do objeto `firebaseConfig` e substitua os campos do arquivo `firebase-config.js`. A `apiKey` do Firebase é um identificador público, não uma senha de administrador.

## 2. Publique as regras de segurança (obrigatório)
1. Em **Firestore Database > Regras**, cole TODO o conteúdo de `firestore.rules` e clique em **Publicar**.
2. Em **Authentication > Users**, copie o **UID** da sua conta ADM.
3. Em **Firestore Database > Dados**, crie a coleção `admins`.
4. Crie um documento nessa coleção cujo **ID seja exatamente o UID** copiado. Adicione um campo de texto `role` com valor `admin`.
5. **Não crie documentos de ADM para outras pessoas.** As regras impedem que visitantes se tornem administradores.

## 3. Publique o site (sem escrever código)
Opção A — GitHub Pages:
1. Crie um repositório no GitHub e envie os arquivos `index.html`, `app.js`, `firebase-config.js` (na raiz).
2. Em **Settings > Pages > Build and deployment**, selecione **Deploy from a branch**, branch `main`, pasta `/ (root)`, e salve.
3. Em alguns minutos, o GitHub mostrará o endereço público do site. O Firebase Firestore continuará sendo o banco de dados.

Opção B — Firebase Hosting (requer comandos de terminal uma única vez):
1. Instale Node.js LTS: https://nodejs.org/ .
2. No terminal, na pasta do projeto: `npm install -g firebase-tools` e `firebase login`.
3. Execute `firebase use --add` e selecione o projeto criado.
4. Execute `firebase deploy --only hosting,firestore:rules`.
5. O terminal exibirá o link do site.

## 4. Como usar
- Visitantes enviam inscrições na página inicial.
- Clique em **Área ADM** e entre com o e-mail/senha criados no Firebase.
- No painel, altere cada inscrição para **Aprovar titular**, **Reserva**, **Recusar** ou **Pendente**.
- O painel impede aprovar mais de 12 titulares. Como apenas uma conta ADM está prevista, o limite é gerenciado no painel, não garantido como limite atômico no banco.
- O painel também edita as regras públicas.

## Atenção antes de divulgar
- É preciso configurar o Firebase e publicar as regras antes de o site funcionar. Não há servidor/banco já provisionado no ZIP.
- As inscrições são públicas, portanto podem receber spam. Para uma competição com alto tráfego, adicione Firebase App Check e proteção anti-bot, e considere moderação adicional.
- O Firebase Authentication pode exigir que você adicione o domínio do site à lista de **Domínios autorizados** em Authentication > Settings.
- O projeto armazena o contato do líder em coleção restrita ao ADM. Informe os participantes sobre a finalidade do uso e o período de retenção desses dados. A exclusão de inscrições pode ser feita no Console do Firebase.
- Fotos individuais dos jogadores não estão incluídas nesta versão: o formulário recebe a logo da equipe e os nicks. Isso evita coletar fotos pessoais desnecessariamente.
- Se mudar o limite de 12 vagas, atualize também o código e o texto da página.


## Versão 2 — novas funções
- Área pública com cartões e fotos de lines **confirmadas** e **reservas**, atualizados automaticamente.
- Central ADM com contadores de pendentes, titulares e reservas, além de botões de aprovação.
- As inscrições não são aprovadas automaticamente. O administrador escolhe o status.
- Para entrar no painel, o administrador usa o e-mail e a senha cadastrados no Firebase Authentication. **Não coloque a senha em nenhum arquivo.**
- É obrigatório criar manualmente o documento `admins/SEU_UID` no Firestore depois de criar seu usuário no Authentication. O UID deve ser exatamente o ID do usuário autenticado.
- Copie as regras do arquivo `firestore.rules` para o Firestore e publique-as.
- Copie os valores de configuração do seu aplicativo web Firebase para `firebase-config.js`.
- Ative Authentication > E-mail/senha e crie o banco Firestore. Publique o diretório `demon-slayer-xt` no Firebase Hosting (ou outro host HTTPS estático).

### Observação importante sobre as 12 vagas
A interface impede aprovar uma 13ª equipe, mas **isso não é uma garantia atômica no servidor** se vários administradores aprovarem simultaneamente. Para garantia absoluta em cenários simultâneos, é necessário implementar uma transação de aprovação no backend (Cloud Functions). Recomenda-se ter um único ADM aprovando por vez até essa etapa.

### Segurança
Não cadastre administradores diretamente pelo formulário público. O documento admins deve ser criado somente no console do Firebase por quem é dono do projeto. Nunca compartilhe sua senha ou credenciais de serviço.
