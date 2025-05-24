const express = require('express');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Conexão com MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Conectado ao MongoDB!'))
  .catch((err) => console.error('❌ Erro ao conectar com MongoDB:', err));

// Schema e Model
// const DataSchema = new mongoose.Schema({
//   name: String,
//   email: String,
//   message: String,
//   createdAt: { type: Date, default: Date.now }
// });

const DataSchema = new mongoose.Schema({}, { strict: false });

const DataModel = mongoose.model('Webhook_Artimax', DataSchema);
const DataModelFirePower = mongoose.model('Webhook_Fire_Power', DataSchema)

// Middlewares
app.use(cors());
app.use(express.json());

// Webhook (POST)
app.post('/artimax/webhook', async (req, res) => {
  try {
    const data = new DataModel({ ...req.body });
    await data.save();

    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('❌ Erro ao salvar:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


app.post('/fire/power/webhook', async (req, res) => {
  try {
    const data = new DataModelFirePower({ ...req.body });
    await data.save();

    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('❌ Erro ao salvar:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get('/', (req, res) => {
  const mongoStatus = mongoose.connection.readyState;
  const status = mongoStatus === 1 ? '🟢 MongoDB conectado' : '🔴 MongoDB desconectado';

  console.log('ℹ️ Status MongoDB:', status);

  res.json({
    status: '✅ Webhook online!',
    mongo: status
  });
});


app.get('/metadados/all', async (req,res) =>{
  const dados = await DataModelFirePower.find({}).toArray()
res.json({...dados})
})
// Exportar dados para XLSX
app.get('/export', async (req, res) => {
  const data = await DataModel.find();

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Dados');

  worksheet.columns = [
    { header: 'Nome', key: 'name' },
    { header: 'Email', key: 'email' },
    { header: 'Mensagem', key: 'message' },
    { header: 'Data', key: 'createdAt' }
  ];

  data.forEach((item) => worksheet.addRow(item.toObject()));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=webhook-data.xlsx');

  await workbook.xlsx.write(res);
  res.end();
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em: https://webhook-xls-production.up.railway.app:${PORT}`);
});
