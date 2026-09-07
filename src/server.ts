import express from 'express';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();

app.get('/', (req, res) => {
  res.send('TG Ezy AI OS is running');
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server listening');
});
