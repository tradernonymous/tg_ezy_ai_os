import express from 'express';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('TG Ezy AI OS is running');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
