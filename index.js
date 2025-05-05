const express = require('express');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT;


// Conexão com MongoDB
// mongoose.connect(process.env.MONGO_URI, {
//   useNewUrlParser: true,
//   useUnifiedTopology: true
// });


mongoose.connect(process.env.MONGO_URI);

// Schema e Model
const DataSchema = new mongoose.Schema({
  name: String,
  email: String,
  message: String,
  createdAt: { type: Date, default: Date.now }
});

const DataModel = mongoose.model('WebhookData', DataSchema);


app.use(bodyParser.json());

// Webhook (POST)
app.post('/webhook', async (req, res) => {
  try {
    const data = await DataModel.create(req.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


app.get('/', (req, res) => {
  const mongoStatus = mongoose.connection.readyState; // 1 = conectado
  const status = mongoStatus === 1 ? '🟢 MongoDB conectado' : '🔴 MongoDB desconectado';
console.log(status)
  res.json({
    status: '✅ Webhook online!',
    mongo: status
  });
});

// Exportar para XLSX
app.get('/export', async (req, res) => {
  const data = await DataModel.find();

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Dados');

  // Cabeçalhos
  worksheet.columns = [
    { header: 'Nome', key: 'name' },
    { header: 'Email', key: 'email' },
    { header: 'Mensagem', key: 'message' },
    { header: 'Data', key: 'createdAt' }
  ];

  // Adiciona os dados
  data.forEach((item) => worksheet.addRow(item.toObject()));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=webhook-data.xlsx');

  await workbook.xlsx.write(res);
  res.end();
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em https://webhook-xls-production.up.railway.app : ${PORT}`);
});
