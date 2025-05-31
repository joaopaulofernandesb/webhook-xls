require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const OpenAI = require('openai');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const cors = require('cors');
const app = express();
app.use(cors({
  origin: '*',
}));




const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.GPT_KEY });




// --- MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Conectado ao MongoDB!'))
  .catch((err) => console.error('❌ Erro ao conectar com MongoDB:', err));

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// --- Helper de coleções
const produtoCollection = () => mongoose.connection.db.collection('produto');
function saveData(collection, data) {
  if (!data.sessionId || !data.produto) throw new Error('sessionId e produto são obrigatórios!');
  return mongoose.connection.db.collection(collection).insertOne({ ...data, createdAt: new Date() });
}

// Criar produto
app.post('/api/produto', async (req, res) => {
  const { nome, slug, ativo, meta, landing_url } = req.body;
  if (!nome || !slug) return res.status(400).json({ ok: false, error: "Nome e slug são obrigatórios!" });
  try {
    const exist = await produtoCollection().findOne({ slug });
    if (exist) return res.status(400).json({ ok: false, error: "Já existe produto com esse slug!" });
    await produtoCollection().insertOne({ nome, slug, landing_url, ativo: ativo ?? true, meta: meta || {}, createdAt: new Date() });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Listar produtos
app.get('/api/produto', async (req, res) => {
  const produtos = await produtoCollection().find({}).toArray();
  res.json(produtos);
});

// Detalhar produto
app.get('/api/produto/:slug', async (req, res) => {
  const produto = await produtoCollection().findOne({ slug: req.params.slug });
  if (!produto) return res.status(404).json({ ok: false, error: "Produto não encontrado!" });
  res.json(produto);
});

// Atualizar produto
app.patch('/api/produto/:slug', async (req, res) => {
  const { nome, ativo, meta, landing_url } = req.body;
  const update = {};
  if (nome !== undefined) update.nome = nome;
  if (ativo !== undefined) update.ativo = ativo;
  if (meta !== undefined) update.meta = meta;
  if (landing_url !== undefined) update.landing_url = landing_url;
  const result = await produtoCollection().updateOne({ slug: req.params.slug }, { $set: update });
  if (result.matchedCount === 0) return res.status(404).json({ ok: false, error: "Produto não encontrado!" });
  res.json({ ok: true });
});

// --- SOCKET.IO para dashboard em tempo real ---
io.on('connection', (socket) => {
  console.log('🟢 Dashboard conectada via socket.io');
});
function emitDashboard(type, data) { io.emit('live_event', { type, data }); }

// --- Eventos principais
['session-replay', 'event','engagement', 'profile', 'error', 'mapaseletores'].forEach((coll) => {
  app.post(`/api/${coll.toLowerCase()}`, async (req, res) => {
    try {
      await saveData(coll, req.body);
      emitDashboard(coll, req.body);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });
});

// --- Session Replay GET ---
app.get('/api/session-replay/:sessionId/:produto', async (req, res) => {
  const { sessionId, produto } = req.params;
  try {
    const replays = await mongoose.connection.db.collection('sessionReplay')
      .find({ sessionId, produto }).sort({ createdAt: 1 }).toArray();
    const eventos = replays.flatMap(doc => doc.eventos || []);
    res.json({ sessionId, produto, eventos });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// --- Rota Unificada de Análise ---
app.get('/api/session-report/:sessionId/:produto', async (req, res) => {
  const { sessionId, produto } = req.params;
  try {
    const [events, engagement, profile, errors, replay] = await Promise.all([
      mongoose.connection.db.collection('event').find({ sessionId, produto }).toArray(),
      mongoose.connection.db.collection('engagement').find({ sessionId, produto }).toArray(),
      mongoose.connection.db.collection('profile').find({ sessionId, produto }).toArray(),
      mongoose.connection.db.collection('error').find({ sessionId, produto }).toArray(),
      mongoose.connection.db.collection('sessionReplay').find({ sessionId, produto }).toArray(),
    ]);
    res.json({ sessionId, produto, events, engagement, profile, errors, replay });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// --- Webhook integração externa
app.post('/api/webhook', async (req, res) => {
  try {
    const data = req.body;
    await saveData('webhook',data);
    emitDashboard('webhook', req.body);
    res.json({ ok: true, recebido: tipo || 'unknown' });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// --- Endpoint IA para análise ou sugestão automática (on demand ou batch)
app.post('/api/ia/analisar', async (req, res) => {
  const { prompt, dados } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é um analista de dados de funil de vendas. Dê sugestões para melhorar conversão." },
        { role: "user", content: prompt || "Analise estes dados e dê sugestões:" },
        { role: "user", content: JSON.stringify(dados) }
      ]
    });
    res.json({ ok: true, resposta: completion.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

app.post('/api/profile', async (req, res) => {
  try {
    await saveData('profile', req.body);
    emitDashboard('profile', req.body);

    let acoes = [];
    // Exemplo: se perfil é analítico E não rolou muito a página
    const perfil = req.body.perfil;
    const scrollPercentual = req.body.contexto?.scroll_percentual ?? null;

    // Simples: pode ser mais sofisticado cruzando outras coleções do MongoDB
    if (perfil === "analitico" && (!scrollPercentual || scrollPercentual < 30)) {
      acoes.push({
        tipo: "mostrar_popup",
        mensagem: "Veja como outras pessoas resolveram suas dúvidas — confira os depoimentos!",
      });
      acoes.push({
        tipo: "scroll_to",
        seletor: "#depoimentos"
      });
    }

    res.json({ ok: true, acoes }); // O front já executa automático!
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// --- Helper da coleção de mapa de seletores
const mapaSeletoresCollection = () => mongoose.connection.db.collection('mapaSeletores');

// --- ROTA PARA RECEBER INVENTÁRIO DE SELETORES DAS LANDINGS/PRODUTO ---
app.post('/api/mapa-seletores', async (req, res) => {
  try {
    // O frontend envia { produto, url, hora, seletores: [...] }
    const inventario = req.body;
    if (!inventario || !inventario.produto || !inventario.seletores) {
      return res.status(400).json({ ok: false, error: "Faltando produto ou seletores!" });
    }
    await mapaSeletoresCollection().insertOne({
      ...inventario,
      createdAt: new Date(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.post('/api/upload-ads-csv', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "Arquivo não enviado!" });

  const results = [];
  const { produto, utm_campaign } = req.body;
  if (!produto || !utm_campaign) return res.status(400).json({ ok: false, error: "produto e utm_campaign são obrigatórios" });

  // Ler e processar o CSV
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        // Salva no banco, conforme o seu modelo (coleção: adsReport)
        await mongoose.connection.db.collection('adsReport').insertOne({
          produto,
          utm_campaign,
          dados: results,
          createdAt: new Date()
        });
        fs.unlinkSync(req.file.path); // remove o arquivo temporário
        res.json({ ok: true, count: results.length });
      } catch (err) {
        fs.unlinkSync(req.file.path);
        res.status(500).json({ ok: false, error: err.message });
      }
    })
    .on('error', (err) => {
      fs.unlinkSync(req.file.path);
      res.status(500).json({ ok: false, error: err.message });
    });
});



// Cadastrar/Importar relatório Facebook Ads/Google Ads
app.post('/api/ads-report', async (req, res) => {
  const { produto, utm_campaign, dados } = req.body;
  if (!produto || !utm_campaign || !dados) return res.status(400).json({ ok: false, error: "Produto, utm_campaign e dados obrigatórios!" });
  try {
    await mongoose.connection.db.collection('adsReport').insertOne({ produto, utm_campaign, dados, createdAt: new Date() });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Listar/adicionar filtros depois conforme desejar.
app.get('/health', (req, res) => { res.json({ status: 'ok' }); });
app.get('/', (req, res) => {
  const mongoStatus = mongoose.connection.readyState;
  const status = mongoStatus === 1 ? '🟢 MongoDB conectado' : '🔴 MongoDB desconectado';
  res.json({ status: '✅ Webhook online!', mongo: status });
});



server.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
  console.log(`Socket.io dashboard ativo na porta ${PORT}`);
});

