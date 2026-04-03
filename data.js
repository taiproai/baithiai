require('dotenv').config();

const express = require('express');
const mysql = require('mysql');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// ====== KẾT NỐI DB CHUẨN ======
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'test'
});

db.connect(err => {
    if (err) {
        console.error('❌ Lỗi MySQL:', err);
        return;
    }
    console.log('✅ Kết nối MySQL thành công');
});

// ===== SOCKET =====
io.on("connection", (socket) => {
    socket.on("sendMessage", (data) => {
        const { qa_code, sender, role, message } = data;

        db.query(
            "INSERT INTO messages (qa_code, sender, role, message) VALUES (?, ?, ?, ?)",
            [qa_code, sender, role, message],
            (err) => {
                if (err) return console.error("Lỗi lưu tin nhắn:", err);

                io.emit("receiveMessage", {
                    qa_code,
                    sender,
                    role,
                    message,
                    timestamp: new Date()
                });
            }
        );
    });
});

// ===== API =====
app.get('/api/messages/:qa_code', (req, res) => {
    db.query(
        'SELECT * FROM messages WHERE qa_code = ? ORDER BY timestamp ASC',
        [req.params.qa_code],
        (err, results) => {
            if (err) return res.json([]);
            res.json(results);
        }
    );
});

// VIEW
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));

// LOGIN
app.post('/api/login', (req, res) => {
    db.query(
        'SELECT * FROM users WHERE username = ? AND password = ?',
        [req.body.username, req.body.password],
        (err, results) => {
            if (err) return res.json({ success: false });

            if (results.length > 0)
                res.json({ success: true, user: results[0] });
            else
                res.json({ success: false, message: 'Sai tài khoản hoặc mật khẩu' });
        }
    );
});

// ===== SERVER =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
});